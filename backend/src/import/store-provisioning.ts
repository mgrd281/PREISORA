/**
 * Store locations for a newly provisioned retailer market.
 *
 * First choice: ONE Overpass API call per chain against the configured bbox, so the
 * stores are real OpenStreetMap data (© OpenStreetMap contributors, ODbL — see the
 * attribution note in backend/README.md). The public Overpass endpoints are flaky
 * through some egress paths, so a short list of mirrors is tried with a short
 * timeout each.
 *
 * Fallback: clearly-labeled REPRESENTATIVE demo locations. These are honest about
 * what they are — `externalRef` starts with `demo-location`, the name says
 * "(Beispiel-Standort)" and the street is the literal "Beispielstandort"; no real
 * street address is ever fabricated. Coordinates are plausible, distinct points in
 * the demo city so geo ranking has something to rank against.
 */

export interface StoreSpec {
  externalRef: string;
  name: string;
  lat: number;
  lng: number;
  street: string;
  postalCode: string;
  city: string;
}

export interface StoreProvisioningPlan {
  /** `osm` = real Overpass data; `demo` = labeled representative locations. */
  origin: 'osm' | 'demo';
  stores: StoreSpec[];
}

export interface OverpassOptions {
  endpoints: string[];
  /** south,west,north,east */
  bbox: [number, number, number, number];
  timeoutMs: number;
  userAgent: string;
  log?: (line: string) => void;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * One Overpass query for one chain's brand within the bbox. Returns `null` when no
 * endpoint answers (the caller falls back to demo locations) and `[]` when Overpass
 * answered but knows no such store there.
 */
export async function fetchStoresFromOverpass(
  brandRegex: string,
  fallbackName: string,
  options: OverpassOptions,
): Promise<StoreSpec[] | null> {
  const [s, w, n, e] = options.bbox;
  const query = `[out:json][timeout:${Math.floor(options.timeoutMs / 1000)}];nwr["shop"="supermarket"]["brand"~"${brandRegex}"](${s},${w},${n},${e});out center 50;`;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  for (const endpoint of options.endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': options.userAgent,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        log(`overpass ${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      const elements = payload.elements ?? [];
      return elements
        .map((element) => toStoreSpec(element, fallbackName))
        .filter((spec): spec is StoreSpec => spec !== null);
    } catch (error) {
      log(
        `overpass ${endpoint} unreachable: ${
          error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
        }`,
      );
    }
  }
  return null;
}

function toStoreSpec(element: OverpassElement, fallbackName: string): StoreSpec | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const tags = element.tags ?? {};
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  return {
    externalRef: `osm-${element.type}-${element.id}`,
    name: tags.name ?? fallbackName,
    lat,
    lng,
    // OSM data may lack address tags; empty strings are honest "unknown", the
    // columns are NOT NULL and nothing is invented to fill them.
    street: street || '',
    postalCode: tags['addr:postcode'] ?? '',
    city: tags['addr:city'] ?? '',
  };
}

/**
 * The labeled fallback. Three representative locations per chain around the demo
 * city center. Streets are NOT real addresses by design — see the module comment.
 */
export function demoStores(retailerName: string, retailerSlug: string, city: string, points: ReadonlyArray<readonly [number, number]>): StoreSpec[] {
  return points.map(([lat, lng], index) => ({
    externalRef: `demo-location-${retailerSlug}-${index + 1}`,
    name: `${retailerName} ${city} (Beispiel-Standort ${index + 1})`,
    lat,
    lng,
    street: 'Beispielstandort',
    postalCode: '',
    city,
  }));
}

/** Distinct, plausible points inside the Munich demo bbox (data, not logic — §24). */
export const MUNICH_DEMO_POINTS: ReadonlyArray<readonly [number, number]> = [
  [48.1355, 11.5712],
  [48.1214, 11.6011],
  [48.1552, 11.5453],
];

export const MUNICH_DEMO_POINTS_ALT: ReadonlyArray<readonly [number, number]> = [
  [48.1402, 11.5601],
  [48.1281, 11.5904],
  [48.1503, 11.6052],
];

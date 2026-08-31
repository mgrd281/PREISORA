// Registry of German retailer offer pages this tool knows how to harvest from.
// This is DATA, not code that fetches anything itself — see README.md for why.
export const CHAINS = {
  'aldi-sued': {
    retailerName: 'ALDI SÜD',
    countryCode: 'DE',
    currencyCode: 'EUR',
    sourceUrl: 'https://www.aldi-sued.de/de/angebote.html',
  },
  edeka: {
    retailerName: 'EDEKA',
    countryCode: 'DE',
    currencyCode: 'EUR',
    sourceUrl: 'https://www.edeka.de/angebote',
  },
  norma: {
    retailerName: 'NORMA',
    countryCode: 'DE',
    currencyCode: 'EUR',
    sourceUrl: 'https://www.norma-online.de/de/angebote/',
  },
};

// Chains tried and found NOT reachable this way (403, or a JS-only page with
// no readable offer data even through Claude's fetch) — recorded so nobody
// re-discovers this by hand each time. Re-check occasionally; retailers
// change their sites. See README.md "Known coverage" for the full picture.
export const KNOWN_UNREACHABLE = {
  rewe: '403 Forbidden',
  kaufland: '403 Forbidden',
  penny: 'store must be selected client-side; page ships no offer data without it',
  'aldi-nord': 'connection actively reset',
  rossmann: 'client-side load failure',
  hit: 'requires selecting a store first',
  netto: '403 Forbidden',
};

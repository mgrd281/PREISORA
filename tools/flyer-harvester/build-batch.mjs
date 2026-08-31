#!/usr/bin/env node
// Assembles backend/data/flyer-imports/<week>.json from one or more terse
// per-chain "rows" files, wrapping them in the full FlyerImportFile envelope
// (schemaVersion/batches/pricingScope/harvestedAt/etc.) so the tedious,
// error-prone part of the old manual workflow — typing that envelope by hand,
// every week, for every chain — is gone. Real schema validation still happens
// for free when `npm run import:flyers` runs against the output (see
// ../../backend/src/import/flyer-import-file.ts) — this script does not
// duplicate that logic, it only fills in what the rows files leave implicit.
//
// Usage:
//   node build-batch.mjs --week 2026-W37 aldi-sued=rows/aldi-sued.json edeka=rows/edeka.json
//
// Each rows file is a plain JSON array of FlyerOfferRow-shaped objects (name,
// brand?, quantityText?, priceMinor, oldPriceMinor?, validFrom?, validUntil?,
// kind?, gtin?) — exactly what a human reads off a retailer's own offer page
// and types in, minus the batch envelope.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAINS } from './chains.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_IMPORTS_DIR = path.resolve(HERE, '../../backend/data/flyer-imports');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  let week;
  const chainArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--week') week = argv[++i];
    else if (arg.startsWith('--week=')) week = arg.slice('--week='.length);
    else chainArgs.push(arg);
  }
  return { week, chainArgs };
}

function main() {
  const { week, chainArgs } = parseArgs(process.argv.slice(2));
  if (chainArgs.length === 0) {
    console.error('usage: node build-batch.mjs [--week ISO-WEEK] <slug>=<rows.json> [<slug>=<rows.json> ...]');
    console.error(`known chain slugs: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  const harvestedAt = today();
  const weekLabel = week ?? isoWeekLabel(new Date());
  const batches = [];

  for (const arg of chainArgs) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      console.error(`bad argument "${arg}" — expected <slug>=<rows-file.json>`);
      process.exit(1);
    }
    const slug = arg.slice(0, eq);
    const rowsPath = arg.slice(eq + 1);
    const chain = CHAINS[slug];
    if (!chain) {
      console.error(`unknown chain slug "${slug}" — add it to chains.mjs first. Known: ${Object.keys(CHAINS).join(', ')}`);
      process.exit(1);
    }
    if (!fs.existsSync(rowsPath)) {
      console.error(`rows file not found: ${rowsPath}`);
      process.exit(1);
    }
    const offers = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
    if (!Array.isArray(offers) || offers.length === 0) {
      console.error(`${rowsPath}: expected a non-empty JSON array of offer rows`);
      process.exit(1);
    }
    batches.push({
      retailerName: chain.retailerName,
      retailerSlug: slug,
      countryCode: chain.countryCode,
      currencyCode: chain.currencyCode,
      sourceUrl: chain.sourceUrl,
      harvestedAt,
      pricingScope: 'market',
      offers,
    });
    console.log(`  + ${slug}: ${offers.length} offer(s) from ${rowsPath}`);
  }

  const file = { schemaVersion: 1, batches };
  fs.mkdirSync(BACKEND_IMPORTS_DIR, { recursive: true });
  const outPath = path.join(BACKEND_IMPORTS_DIR, `${weekLabel}.json`);
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2) + '\n');
  console.log(`\nWrote ${outPath} (${batches.length} batch(es), ${batches.reduce((n, b) => n + b.offers.length, 0)} offer(s) total)`);
  console.log(`Next: cd ../backend && npm run import:flyers -- data/flyer-imports/${weekLabel}.json`);
}

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

main();

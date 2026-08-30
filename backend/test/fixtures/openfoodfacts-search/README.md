# Recorded Open Food Facts payloads for the flyer-import matcher

Recorded verbatim on 2026-08-30 from `world.openfoodfacts.org` (`cgi/search.pl`
searches and one `api/v2/product` record), User-Agent `PREISORA-dev/0.1`. Open Food
Facts data is © Open Food Facts contributors, licensed under the Open Database
License (ODbL) — see the attribution note in `backend/README.md`.

| File | Case it proves |
|---|---|
| `search-farmer-macadamia-gesalzen.json` | ONE confident match (brand + 125 g agree) |
| `search-rio-doro-orangennektar.json` | two distinct GTINs both pass every gate → ambiguous, refused |
| `search-ferrero-b-ready.json` | many size variants (22 g/44 g/220 g/330 g/152,8 g), none = 132 g → refused |
| `search-golden-seafood-garnelen.json` | zero results |
| `product-4061458056557.json` | full product record used by the offline e2e import |

# Open Food Facts fixtures

Recorded responses of

```
GET https://world.openfoodfacts.org/api/v2/product/{gtin}.json
    ?fields=code,product_name,product_name_de,product_name_en,product_name_fr,
            brands,quantity,lang,countries_tags,images,selected_images
```

captured once with `curl` (User-Agent `PREISORA/1.0 (https://preisora.de)`) so the
normalizer unit tests never touch the network.

| File | What it proves |
|---|---|
| `nutella-4008400402222.json` | `lang: de`, `product_name_de` present, `front_de` images with exact sizes. |
| `ritter-sport-4000417025005.json` | `lang: en` but a German name exists — locale preference must beat the product's own language. |
| `bounty-40111216.json` | German name exists, but there is **no** `front_de` image — image language must fall back. |
| `not-found-4012345000016.json` | `status: 0`. |
| `malformed-partial.json` | Hand-authored: blank names, blank quantity, a brands list starting with an empty entry, size entries missing `w`/`h`, a null `small` URL. Nothing here may throw or produce a partial `ImageAsset`. |

Open Food Facts data is licensed **ODbL**; see `backend/README.md` for the
attribution obligation.

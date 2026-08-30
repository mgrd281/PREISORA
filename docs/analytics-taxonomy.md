# PREISORA Analytics Taxonomy

One taxonomy across all platforms (constitution §18). Event names are identical on iOS, Android
and web; **platform is an event property, never part of the event name** (`ios_scan_success` is
forbidden).

## Naming rules

- `snake_case`, `object_action` order, past tense for completed facts.
- Money amounts as **minor units** (integer) + `currency_code` property (§24).
- Identifiers are canonical UUIDs / GTIN strings (§20). **No PII** in any property.

## Common properties (attached by the tracker, not call sites)

| Property | Example |
|---|---|
| `platform` | `ios` \| `android` \| `web` |
| `app_version` | `1.0.0` |
| `locale` | `de-DE` |
| `country_code` | `DE` |

## Core events (phase 1)

| Event | Fired when | Key properties |
|---|---|---|
| `scan_started` | scanner UI opened | `input_mode` (`camera` \| `manual`) |
| `barcode_detected` | GTIN recognized/entered and checksum-valid | `gtin` |
| `product_resolved` | product lookup succeeded | `product_id`, `gtin` |
| `prices_loaded` | offers response rendered | `product_id`, `offer_count`, `radius_meters` |
| `best_offer_viewed` | best offer visible to user | `product_id`, `store_id`, `amount_minor`, `currency_code` |
| `favorite_added` | favorite created | `product_id` |
| `alert_created` | price alert created | `product_id`, `target_amount_minor`, `currency_code` |
| `shopping_list_optimized` | optimization result rendered | `list_id`, `strategy`, `store_count`, `total_amount_minor`, `currency_code` |
| `search_performed` | search query submitted | `query_length`, `result_count` |
| `deep_link_opened` | app opened via canonical URL | `link_type` (`product` \| `store` \| …) |
| `error_shown` | error state rendered | `error_code` (from the error contract), `retryable` |

Adding an event = adding a row here first, then implementing. Platform-specific differentiation,
when analytically required, is done by filtering on the `platform` property — never by forking
the event name.

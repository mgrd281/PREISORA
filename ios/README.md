# PREISORA — iOS

Native SwiftUI app (Swift 5.10, iOS 17+, **zero third-party dependencies**) against the
platform-neutral backend in [`../backend`](../backend), built to the contract in
[`../api-contract`](../api-contract).

> **Honest disclaimer, read this first.** These sources were authored on Linux, with
> **no Xcode and no Swift compiler** — nothing here has ever been compiled. The API
> surface was kept deliberately conservative (no macros beyond `@Observable`, no typed
> throws, no Swift 6 strict concurrency, basic MapKit only) precisely to keep the
> first-build fix-up small, but **expect a short fix-up pass on your Mac**: a handful
> of signature or isolation adjustments, most likely around VisionKit's scanner
> delegate and SwiftUI toolbar/`@Bindable` details. Everything else — the Domain
> models, the error contract, the deep-link grammar, the tokens — was verified against
> the contract and the design spec by hand.

---

## 1 · Three steps on a Mac

```bash
brew install xcodegen         # 1 — tested with XcodeGen 2.x (ADR-0004)
cd ios && xcodegen generate   # 2 — writes Preisora.xcodeproj (gitignored)
open Preisora.xcodeproj       # 3 — select the Preisora scheme, ⌘R
```

`project.yml` is the source of truth for the project; `Preisora.xcodeproj` is
generated and never committed. Re-run `xcodegen generate` after adding files or
changing build settings.

**Toolchain.** Recommended: **Xcode 16 or newer** (iOS 18 SDK), where SwiftUI's
`View`/`App` protocols are `@MainActor`-isolated protocol-wide. The feature view
structs additionally carry explicit `@MainActor` annotations (a no-op on Xcode 16+),
so the sources are also annotated to build on **Xcode 15.3+** (iOS 17 SDK) — but
that path is untested.

Run the tests with `⌘U`, or headless:

```bash
xcodebuild test -project Preisora.xcodeproj -scheme Preisora \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

## 2 · Pointing the app at a backend

The base URL comes from the scheme environment variable **`PREISORA_API_BASE_URL`**,
default `http://localhost:3000/api/v1` (the local docker-compose stack). Settings →
*Backend* shows the URL the running app resolved.

Bring the backend up first:

```bash
cd ../backend
docker compose up -d --wait
npm run db:migrate && npm run seed && npm run start:dev
```

To change the target: Xcode → *Product ▸ Scheme ▸ Edit Scheme… ▸ Run ▸ Arguments ▸
Environment Variables* → `PREISORA_API_BASE_URL`.

**App Transport Security.** `Info.plist` sets `NSAllowsLocalNetworking`, which covers
`http://localhost`. Pointing a **physical device** at your Mac over plain HTTP
(`http://192.168.x.x:3000/...`) is *not* covered by that exception — either terminate
TLS in front of the backend, tunnel it, or add a temporary
`NSExceptionDomains` entry to `project.yml` while developing.

## 3 · What actually works

### In the Simulator (no camera)

| Step | How |
|---|---|
| Home → **Scan barcode** | Opens the scan sheet |
| Scanner surface | `DataScannerViewController` is unsupported in the Simulator, so `VisionBarcodeScanner` renders **`DemoScannerView`** instead — a list of tappable seeded demo GTINs |
| Manual GTIN entry | Always present, under the scanner, with a client-side checksum pre-flight |
| Product resolved | `GET /products/by-gtin/{gtin}` |
| Prices | `GET /products/{id}/offers?lat&lng&radiusMeters` — best offer highlighted, freshness + promotion badges, prices formatted from `Money` |
| Location | Simulator has none by default → the app falls back to **Berlin-Mitte (52.5219, 13.4132)** and says so |
| Stores map | `Map` + `Marker` + distances + *Open in Maps* |
| Search | Debounced (300 ms), cursor-paginated |
| Favorites | Anonymous session is created automatically on first use and stored in the Keychain |
| Settings | Backend URL, capabilities from `GET /capabilities`, app + token versions |
| Deep links | `xcrun simctl openurl booted "preisora://product/<uuid>"` |

> **The demo GTINs must match the backend seed.** They live in one place:
> `Preisora/Services/Mocks/MockBarcodeScanner.swift` → `MockBarcodeScanner.demoGTINs`.
> They are fictional codes in the `4012345…` range with valid GS1 check digits — the
> first five `SEED_PRODUCTS` of `backend/src/seed/seed-data.ts`. If
> `npm run seed` changes, update that array.

### On a device (camera)

`VisionBarcodeScanner` (VisionKit `DataScannerViewController`) is selected
automatically when `isSupported && isAvailable`. EAN-13 / EAN-8 / UPC-E / Code128 /
ITF-14 are recognized; the payload goes through the same GTIN pre-flight as manual
entry. Real Core Location replaces the Berlin fallback.

## 4 · What is stubbed

| Area | State |
|---|---|
| **Sign in with Apple** | Disabled placeholder in Settings. `/auth/oauth` is `x-preisora-status: stubbed` (501) and the app has no Sign-in-with-Apple capability. |
| **Push** | Reachable from Settings → *Account ▸ Enable push notifications*. `APNSPushRegistrar` asks for permission, registers, and POSTs `/devices` — but there is **no push entitlement**, so no usable APNs token arrives (expect `didFailToRegisterForRemoteNotifications`). Delivery is backend-side and stubbed there too. |
| **Universal links / AASA** | Deferred until `preisora.de` is live (they cannot be validated without it). The parsing layer is complete; the custom `preisora://` scheme makes it testable now. |
| **Alerts screen** | Typed empty state. `PriceAlert` + `/alerts` are fully modelled and loaded; the *creation* flow (target price + radius picker) is not built. |
| **Shopping lists / optimizer** | Typed empty state. `ShoppingList`, `ShoppingListItem` and `OptimizationResult` are complete; the optimizer UI is deferred. |
| **Price history chart** | A minimal token-styled bar list. Swift Charts deliberately deferred. |
| **Analytics** | `ConsoleAnalyticsTracker` (os.Logger) only. Names and properties are the real taxonomy; only the sink is a stub. |
| **User preferences** | `UserPreferences` is modelled; its endpoints answer 501 so nothing calls them yet. |

## 5 · Layout

```
ios/
├── project.yml                  XcodeGen spec (ADR-0004)
├── Config/Info.plist            generated by xcodegen, gitignored
├── Preisora/
│   ├── App/                     entry point, config, DI, routing, deep links
│   ├── Domain/                  Codable mirrors of the contract — platform-neutral
│   ├── Networking/              APIClient (actor), endpoints, error envelope
│   ├── Services/                the eight §6 abstractions + iOS impls + Mocks/
│   ├── Features/                one folder per screen: View + @Observable ViewModel
│   ├── DesignSystem/            Tokens.swift + shared components
│   └── Resources/               Localizable.xcstrings, InfoPlist.xcstrings, Assets
└── PreisoraTests/               GTIN, error decoding, Money, deep links
```

### Rules this code follows

- **Domain mirrors the contract 1:1.** Field names, optionality and nullability match
  `api-contract/dist/openapi.bundled.yaml`. No `CLLocationCoordinate2D`, no `MKMapItem`
  and no `UIImage` anywhere in `Domain/` (constitution §8/§9) — `Coordinate` is our own
  struct.
- **Money is never a Double.** `Money { amountMinor: Int, currencyCode: String }` with
  `Decimal`-based formatting, and the currency is never assumed to be EUR (§24).
- **The server is the authority.** `isBest`, `freshness` and `effectivePrice` are
  rendered, never recomputed (§22). The GTIN checksum here is UX only.
- **Errors are one shape.** `{code, messageKey, details, retryable}` → `APIError`. All
  ten catalog codes are typed, unknown codes degrade to `.unknown(String)`, and a
  **retry button appears only when `retryable` is true**.
- **`messageKey` is the localization key.** The backend never sends UI text (§33), so
  `error.product_not_found` & co. are literally the keys in `Localizable.xcstrings`.
- **Platform is an analytics property, never part of an event name** (§18). The common
  properties (`platform`, `app_version`, `locale`, `country_code`) are attached once,
  centrally, in the tracker — call sites never pass them.
- **Tokens are not hand-picked colours.** `DesignSystem/Tokens.swift` mirrors
  `design-spec/tokens.json`; `Tokens.version` must equal the JSON `version` (a unit
  test pins it). Feature code never writes a hex value.

## 6 · Known first-build friction

Ranked by how likely they are to need a touch-up on the Mac:

1. **VisionKit delegate isolation** — `DataScannerViewControllerDelegate` is
   main-actor-annotated in recent SDKs. `DataScannerRepresentable.Coordinator` is
   deliberately *non*-isolated (a wider implementation satisfies a narrower
   requirement). If your SDK disagrees, add `@MainActor` to the `Coordinator` class.
   `dismantleUIViewController` is intentionally not implemented for the same reason.
2. **Xcode 15 (iOS 17 SDK) actor isolation** — on Xcode 16+ SwiftUI's `View` protocol
   is `@MainActor` protocol-wide, so the explicit `@MainActor` on every feature view
   struct (and `RootView.swift`) is a no-op there. On Xcode 15.3+ those annotations
   are what lets the explicit view inits (`ProductDetailView(reference:)`,
   `StoresMapView(productId:)`) call `@MainActor` view-model initializers and lets
   the non-`body` helper properties read the `@Observable` `@MainActor` view models.
   That toolchain is annotated for but untested.
3. **`@Bindable` in `RootView`/`HomeView`** — `@Bindable var router: AppRouter` as a
   stored view property is the documented iOS 17 pattern; if it complains, switch to
   `@Environment(AppRouter.self)` plus a local `@Bindable var router = router` in
   `body`.
4. **`MKMapItem.openInMaps(launchOptions:)`** is deprecated in newer SDKs — a warning,
   not an error.
5. **`InfoPlist.xcstrings`** is hand-written. If Xcode does not pick up the localized
   permission strings, the German defaults in `project.yml` still ship correctly.
6. **AppIcon** is an empty 1024 placeholder set — expect an asset-catalog *warning*,
   not a failure. Drop a real 1024×1024 PNG into
   `Preisora/Resources/Assets.xcassets/AppIcon.appiconset/` and add its `filename`.

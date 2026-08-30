# PREISORA — iOS

Native SwiftUI app (Swift 5.10, iOS 17+, **zero third-party dependencies**) against the
platform-neutral backend in [`../backend`](../backend), built to the contract in
[`../api-contract`](../api-contract).

> **What has and has not been verified.** These sources were authored on Linux without
> Xcode. Since then a real **Swift 6.0.3 compiler** was run against them here: all 66
> files parse, and the entire Foundation layer — every `Domain` model, `APIClient`,
> `APIError`, `Route`, `DemoURLProtocol` — **type-checks and passes 78 unit tests**,
> including tests that decode real captured backend responses into the real models.
> What still cannot be checked without Xcode are the **SwiftUI view bodies** (Apple
> frameworks do not exist on Linux), so a short first-build fix-up is still possible —
> most likely a type-check-time or `MapContentBuilder` detail, not a broken contract.
> See §7 for the ranked list of remaining unknowns.

---

## 1 · Two steps on a Mac (Xcode only — no Homebrew, no Docker)

```bash
cd ios
curl -L -o xcodegen.zip https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip
unzip -q xcodegen.zip && ./xcodegen/bin/xcodegen generate    # writes Preisora.xcodeproj
open Preisora.xcodeproj                                      # select the Preisora scheme, ⌘R
```

*(If you do have Homebrew, `brew install xcodegen && xcodegen generate` is equivalent —
ADR-0004 pins XcodeGen 2.x.)* `project.yml` is the source of truth; `Preisora.xcodeproj`
is generated and never committed. Re-run `xcodegen generate` after adding files or
changing build settings.

**Toolchain.** Recommended: **Xcode 16 or newer** (iOS 18 SDK), where SwiftUI's
`View`/`App` protocols are `@MainActor`-isolated protocol-wide. The view structs also
carry explicit `@MainActor` annotations (a no-op on Xcode 16+), so the sources are
annotated to build on **Xcode 15.3+** (iOS 17 SDK) too — that path is untested.

## 2 · What you can do on first run — no backend needed

The app ships in **Demo Mode** (on by default, Settings ▸ *Demo-Modus*). It serves
responses captured verbatim from the real running backend, *below* `APIClient` — so
headers, JSON decoding, the error envelope, anonymous auth and refresh all execute the
real production code path. A banner marks it as demo data.

Walk the core journey in the simulator:

| step | how |
|---|---|
| Scan | Home ▸ *Scannen*. The simulator has no camera, so use **manual GTIN entry** or the demo buttons. |
| Demo GTINs | `4012345000016` Vollmilch · `4012345000023` Butter · `4012345000030` Nuss-Nougat-Creme · `4012345000047` Mehl · `4012345000054` Eier |
| Compare prices | The product screen ranks real offers, highlights the best one, and shows freshness + promotion badges. |
| Not-found path | Any other valid GTIN (e.g. `4099999000005`) returns the real `PRODUCT_NOT_FOUND` envelope, so you can see the error state. |
| Stores map | Product ▸ map — Berlin store pins with distances (location permission optional; there is a Berlin fallback). |
| Search / favourites | Search accepts `milch`, `butter`, …; favourites persist for the session. |

Run the tests with `⌘U`, or headless:

```bash
xcodebuild test -project Preisora.xcodeproj -scheme Preisora \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

## 3 · Optional: run against the live backend

Requires **Docker Desktop** and **Node 22** on the Mac. Turn *Demo-Modus* off in
Settings (relaunch the app), then:

```bash
cd ../backend
cp .env.example .env
docker compose up -d --wait
npm install && npm run db:migrate && npm run seed && npm run start:dev
```

## 4 · What actually works

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

## 5 · What is stubbed

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

## 6 · Layout

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

## 7 · Known first-build friction

**What is already settled.** A real Swift 6.0.3 compiler was run against these sources
on Linux: all 66 files parse, and everything that does not need an Apple framework
(`Domain/`, `Networking/` including `APIClient` and `DemoURLProtocol`, `Route`,
`AnalyticsEvent`, `RecentScansStore`, `ShareLinkService`) type-checks and passes
**78 unit tests** — the four original suites plus suites that decode real captured
backend responses into the real models and exercise the whole demo routing table
through an actual `URLSession` round trip. The VisionKit coordinator isolation, the
`@Bindable` pattern and the deprecated `openInMaps` call listed in earlier revisions of
this file have all been fixed and their replacements were validated against
framework-free replicas under both `-swift-version 5` and `-swift-version 6`.

**What remains unverified: the SwiftUI view bodies.** They cannot be type-checked
without Apple's frameworks. Ranked by how likely they are to need a touch-up:

1. **`ProductDetailView` type-check time** — `body`/`historyBody` nest a
   `GeometryReader` with `CGFloat` arithmetic in a `ViewBuilder`. The likely symptom is
   *"unable to type-check this expression in reasonable time"*, not a hard error; the
   fix is to annotate the intermediate values or split the helper further.
2. **`Map` / `Marker` / `UserAnnotation` in `StoresMapView`** — believed correct for
   iOS 17, but `MapContentBuilder` cannot be checked here. `Marker(store.name, …)`
   relies on the `StringProtocol` overload.
3. **`MKMapItem.openMaps(with:launchOptions:)`** — deprecated again on the iOS 26 SDK
   in favour of the `from:` variants. A warning, never an error.
4. **`@Environment(AppRouter.self)`** is now a *runtime* contract: the non-optional form
   traps if the value is missing. It is injected on `RootView` in `PreisoraApp`, which
   covers every descendant.
5. **`InfoPlist.xcstrings`** is hand-written. If Xcode does not pick up the localized
   permission strings, the German defaults in `project.yml` still ship correctly.
6. **AppIcon** is an empty 1024 placeholder set — expect an asset-catalog *warning*,
   not a failure. Drop a real 1024×1024 PNG into
   `Preisora/Resources/Assets.xcassets/AppIcon.appiconset/` and add its `filename`.
7. **Demo fixtures bundling** — XcodeGen puts `Resources/DemoData/*.json` into the
   resources phase automatically. If they ever fail to copy, the app says so plainly
   (Settings shows a red *"Beispieldaten fehlen in diesem Build"* row naming the files)
   rather than failing mysteriously; the fix is in `project.yml`, adding
   `{path: Preisora/Resources/DemoData, buildPhase: resources}` alongside an
   `excludes:` on the main `Preisora` source entry.

If the build does error, paste the Xcode output back into the session — the failure
surface is now small and concentrated in these files.

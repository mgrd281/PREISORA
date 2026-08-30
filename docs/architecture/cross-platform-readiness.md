# PREISORA — Android Expansion & Cross-Platform Readiness

> **Status: Constitution.** This document is the founding architecture specification for PREISORA,
> reproduced verbatim as provided by the product owner. All code in this repository must comply
> with it. Deviations require an ADR in `docs/adr/`.

---

ANDROID EXPANSION & CROSS-PLATFORM READINESS

PREISORA launches as a premium native iOS application first.

However, the entire product architecture must be designed from day one so PREISORA can later expand to Android without rebuilding the platform from scratch.

The goal is:

Native-first today. Multi-platform ready tomorrow.

Do NOT compromise iOS quality in order to achieve premature cross-platform compatibility.

The iOS application must remain fully native:

Swift
SwiftUI
VisionKit
AVFoundation
MapKit
CoreLocation

A future Android application should also be native where practical:

Kotlin
Jetpack Compose
CameraX
ML Kit / Android barcode scanning APIs
Google Maps / appropriate mapping provider
Android location APIs

---

## 1 — PLATFORM STRATEGY

PREISORA should follow this architecture:

```
                    PREISORA PLATFORM
                          Backend
                             │
              ┌──────────────┼──────────────┐
              │              │              │
          Products         Prices         Users
              │              │              │
           Stores       Promotions        Lists
              │              │              │
          Search          Alerts        Favorites
              │              │              │
              └──────────────┬──────────────┘
                             │
                      Versioned API
                             │
                 ┌───────────┴───────────┐
                 │                       │
              iOS App                Android App
            SwiftUI                    Compose
                 │                       │
             iPhone                  Android
```

Business data and business rules must primarily live in shared backend/domain services where appropriate.

Platform-specific UI and device capabilities remain native.

---

## 2 — NEVER COUPLE BACKEND TO IOS

The backend must NEVER assume that the client is an iPhone.

Do not return structures based on SwiftUI views.

Do not use Apple-specific naming in core API models.

Do not put MapKit-specific concepts into shared store APIs.

Do not put Apple notification identifiers into generic user models.

Instead create platform-neutral entities.

Good:

```
Product
Offer
Retailer
Store
Location
PriceObservation
Promotion
Favorite
PriceAlert
ShoppingList
```

Bad:

```
AppleProductCard
MapKitStore
SwiftPriceModel
IOSFavorite
```

---

## 3 — VERSIONED PLATFORM-NEUTRAL API

All clients must communicate through a stable versioned API.

Example:

```
/api/v1/products
/api/v1/prices
/api/v1/stores
/api/v1/search
/api/v1/favorites
/api/v1/alerts
/api/v1/shopping-lists
```

The API must be usable by:

iOS

Android

Web

internal admin tools

future partner integrations

without changing the underlying business model.

---

## 4 — API CONTRACT

Create a formal API contract.

Prefer:

OpenAPI specification

or another strongly defined schema system.

Generate or validate client models where appropriate.

The API contract should define:

request models

response models

validation

error models

pagination

authentication

versioning

localization

currency

country

feature capabilities

This reduces differences between iOS and future Android implementations.

---

## 5 — SHARED DOMAIN LANGUAGE

Use consistent domain terminology across:

backend

iOS

future Android

analytics

documentation

Examples:

Product

GTIN

Offer

PriceObservation

Retailer

Store

Promotion

PriceAlert

ShoppingList

OptimizationResult

Do not call the same object:

PriceResult on iOS

Deal on backend

OfferItem on Android

unless there is a clear technical reason.

Maintain one canonical product vocabulary.

---

## 6 — PLATFORM-SPECIFIC LAYERS

Device capabilities must be abstracted.

Examples:

```
BarcodeScanner
LocationService
MapsService
NotificationService
SecureStorage
AnalyticsService
ImageService
ShareService
```

iOS implementations:

```
VisionBarcodeScanner
CoreLocationService
MapKitService
APNSNotificationService
KeychainService
```

Future Android implementations:

```
CameraXBarcodeScanner
AndroidLocationService
GoogleMapsService
FCMNotificationService
AndroidKeystoreService
```

Feature code should depend on abstractions where practical.

---

## 7 — BARCODE SCANNING

Barcode recognition is platform-specific.

Business logic after barcode recognition is not.

Expected flow:

```
Native Camera
      ↓
GTIN detected
      ↓
GTIN validation
      ↓
PREISORA Product API
      ↓
Product
      ↓
Price API
      ↓
Offers
```

iOS:

VisionKit / AVFoundation

Android future:

CameraX + supported barcode recognition solution.

Do not embed product matching logic directly into the camera layer.

---

## 8 — LOCATION

Create a generic geographic model:

```
latitude
longitude
accuracy
postalCode
city
countryCode
```

Backend price queries should accept geographic parameters independently of Apple or Google location APIs.

Example:

```
GET /products/{id}/prices
?lat=
&lng=
&radius=
```

Both iOS and Android should receive identical price intelligence.

---

## 9 — MAP PROVIDER INDEPENDENCE

Maps are client-specific.

iOS may use MapKit.

Android may later use Google Maps or another suitable native provider.

Backend must return:

store ID

latitude

longitude

address

distance-related raw information when appropriate

and never return Apple-specific map objects.

---

## 10 — PUSH NOTIFICATIONS

Create a platform-neutral notification architecture.

Generic device registration:

```
Device
id
userId
platform
pushToken
appVersion
locale
createdAt
lastSeenAt
```

Platform:

```
ios
android
```

Delivery providers:

iOS:
APNs

Android:
FCM

Price alerts must be generated by one backend alert engine.

Example:

```
Price Alert Engine
        │
        ├── APNs → iPhone
        │
        └── FCM → Android
```

Do not duplicate price-alert business logic by platform.

---

## 11 — AUTHENTICATION

Authentication architecture must support multiple platforms.

Potential providers:

Sign in with Apple

Email

future Google sign-in

Authentication must resolve to one PREISORA user identity.

Do not make Apple ID the database primary identity.

Use PREISORA's own internal user ID.

Example:

```
User
 ├── Apple identity
 ├── Google identity
 └── Email identity
```

One account should later work on iOS and Android.

---

## 12 — CROSS-DEVICE SYNCHRONIZATION

Server-side synchronization should eventually support:

Favorites

Price alerts

Shopping lists

Preferred stores

Search radius

Preferences

Price history preferences

Recent activity when appropriate

A user switching from iPhone to Android should not lose their PREISORA data.

---

## 13 — DESIGN SYSTEM PORTABILITY

The PREISORA brand design system should be platform-independent conceptually.

Shared brand tokens:

colors

semantic colors

spacing scale

corner philosophy

typographic hierarchy

icon principles

motion philosophy

content hierarchy

But implementation remains native.

iOS:

SwiftUI design tokens.

Android:

Jetpack Compose theme/tokens.

Do NOT attempt to force pixel-identical UI across iOS and Android.

Target:

same brand, native platform behavior.

---

## 14 — IOS AND ANDROID MUST NOT BE IDENTICAL

Android must not simply be a mechanical copy of the iPhone UI.

Both apps should share:

brand

information hierarchy

product logic

feature set

core interactions

But each should respect its platform.

Examples:

iOS:
native sheets
Apple navigation behavior
SF Symbols where appropriate

Android:
Material/native Compose interactions where appropriate
Android back navigation
platform-native permission flows

Consistency should be conceptual, not artificial.

---

## 15 — SHARED DESIGN TOKENS

Maintain a platform-neutral design specification.

Example:

```
color.background.primary
color.background.secondary
color.text.primary
color.text.secondary
color.accent.primary
color.success
color.warning
color.error
spacing.xs
spacing.sm
spacing.md
spacing.lg
spacing.xl
radius.small
radius.medium
radius.large
```

Each platform maps these to its own native implementation.

---

## 16 — FEATURE CAPABILITY MODEL

Do not assume every feature is available identically on every platform.

Backend can optionally expose capabilities.

Example:

```json
{
  "features": {
    "priceHistory": true,
    "priceAlerts": true,
    "shoppingOptimizer": true,
    "receiptScanner": false,
    "visualProductScan": false
  }
}
```

This allows controlled platform rollout.

---

## 17 — FEATURE FLAGS

Feature flags should support:

global

country

platform

app version

user cohort

Example:

```
receiptScanner:
iOS = true
Android = false
visualProductScan:
iOS Beta = true
Android = false
```

Never require both platforms to release a feature simultaneously.

---

## 18 — ANALYTICS CONSISTENCY

Use the same analytics taxonomy across platforms.

Example:

```
scan_started
barcode_detected
product_resolved
prices_loaded
best_offer_viewed
favorite_added
alert_created
shopping_list_optimized
```

Do not create:

```
ios_scan_success
android_scan_success
```

unless platform differentiation is analytically required.

Attach platform as an event property instead.

---

## 19 — DEEP LINKS

Design deep links from day one.

Potential canonical URL:

```
https://preisora.de/product/{productId}
```

This can later open:

iOS app

Android app

web fallback

Examples:

Product

Store

Shopping list invitation

Price alert

Promotion

Do not create an iOS-only deep-link model.

---

## 20 — UNIVERSAL PRODUCT LINKS

Products should have permanent canonical IDs.

Do not use platform-local database IDs as public identifiers.

Example:

```
Product UUID
GTIN
canonical slug
```

The same product link must resolve consistently across iOS, Android, and web.

---

## 21 — LOCAL DATABASE STRATEGY

iOS may use SwiftData or another native persistence layer.

Android may later use Room or another native database.

Do NOT design synchronization around SwiftData internals.

Local databases are caches/client state.

The backend remains the authoritative shared source for synchronized account data.

---

## 22 — SHARED BUSINESS LOGIC

Evaluate which business rules should live server-side.

Strong candidates:

offer validation

price freshness

promotion eligibility

best-price ranking

shopping basket optimization

price history aggregation

price alerts

product matching

provider normalization

This avoids implementing slightly different rules on iOS and Android.

Client-side logic may handle:

UI sorting

presentation

local filtering

temporary interactions

device-specific behavior

---

## 23 — SHOPPING OPTIMIZER

Shopping-list optimization should be implemented in the backend or in a platform-neutral service.

Input:

```
products
quantity
location
radius
preferences
optimizationMode
```

Output:

```
stores
items per store
total price
estimated savings
missing items
distance
confidence
```

Both iOS and Android should use exactly the same optimization results.

---

## 24 — INTERNATIONAL EXPANSION

Architecture must also prepare for markets beyond Germany.

Do not hardcode:

Germany

EUR

German units

German retailer assumptions

throughout business logic.

Support fields such as:

```
countryCode
currencyCode
locale
measurementSystem
timezone
```

Initial values:

```
countryCode = DE
currencyCode = EUR
locale = de-DE
```

Future:

AT

CH

NL

FR

etc.

---

## 25 — RETAILER COUNTRY MODEL

Retailers may operate in multiple countries.

Model this correctly.

Example:

```
Retailer
RetailerMarket
Store
```

Do not assume every Lidl entity uses identical offers across Germany, Austria, or Switzerland.

---

## 26 — ANDROID ROADMAP

Do not build Android during the initial iOS phase unless explicitly requested.

But maintain readiness.

Recommended rollout:

PHASE 1

PREISORA iOS

Build and validate core product-market fit.

PHASE 2

Stabilize backend APIs.

Document OpenAPI contract.

Ensure provider and price engine independence.

PHASE 3

Create Android design adaptation.

Jetpack Compose design system.

PHASE 4

Build Android core journey:

Home

Scan

Product result

Price comparison

Search

Location

Map

Favorites

PHASE 5

Add:

alerts

shopping lists

optimizer

accounts

history

PHASE 6

Parity review.

Do not delay iOS launch waiting for Android parity.

---

## 27 — POSSIBLE KOTLIN MULTIPLATFORM

Kotlin Multiplatform may be evaluated later for selected shared logic.

Possible candidates:

API models

networking logic

validation

domain logic

But do NOT introduce Kotlin Multiplatform into the initial iOS project unless there is a demonstrated business benefit.

Avoid premature infrastructure complexity.

PREISORA should prefer:

simple

native

maintainable

architecture.

---

## 28 — DO NOT CHOOSE CROSS-PLATFORM FRAMEWORK PREMATURELY

Do NOT switch the project to Flutter or React Native merely because Android is planned later.

The initial goal is the highest-quality iOS experience.

Future Android expansion is enabled through:

shared backend

stable API contracts

shared domain definitions

portable product logic

shared design language

not through sacrificing native platform quality.

---

## 29 — REPOSITORY STRATEGY

Prepare project organization for eventual multi-platform development.

Possible future structure:

```
preisora/
│
├── backend/
│
├── ios/
│
├── android/
│
├── api-contract/
│
├── design-spec/
│
├── docs/
│
└── infrastructure/
```

Initial project may contain only:

```
backend/
ios/
api-contract/
design-spec/
```

Android folder should be added only when Android work begins.

---

## 30 — CI/CD READINESS

Architecture should later allow separate pipelines:

iOS:

build

unit tests

UI tests

TestFlight

App Store

Android:

build

unit tests

instrumentation tests

internal testing

Google Play

Backend:

lint

tests

database migrations

deploy staging

deploy production

One platform failure should not unnecessarily block another platform deployment.

---

## 31 — SHARED API TESTING

Create contract tests so future Android implementation receives the same behavior as iOS.

Backend tests should verify:

EAN lookup

price response

location queries

alerts

favorites

shopping lists

optimizer

error structure

authentication

pagination

This reduces client-specific interpretation.

---

## 32 — ERROR MODEL

Use one platform-neutral error contract.

Example:

```
code
messageKey
details
retryable
```

Examples:

```
PRODUCT_NOT_FOUND
NO_CURRENT_PRICES
INVALID_GTIN
LOCATION_REQUIRED
RATE_LIMITED
SERVICE_TEMPORARILY_UNAVAILABLE
```

Clients decide how to display localized user-facing messages.

Do not send Swift-specific errors from backend.

---

## 33 — LOCALIZATION

Localization identifiers should conceptually align across clients where practical.

Example:

```
product.scan
price.best
offer.updated
alert.create
shopping.optimize
```

iOS and Android maintain their own native localization resources.

Do not return all user interface copy directly from the backend unless dynamic server-controlled content specifically requires it.

---

## 34 — IMAGE DELIVERY

Product image infrastructure must work across:

iOS

Android

web

Use normalized CDN/image URLs where possible.

Support:

multiple sizes

modern formats

cache headers

fallback

Do not generate iOS-specific image representations in backend APIs.

---

## 35 — PERFORMANCE

Backend performance targets must be device-independent.

Both platforms should benefit from:

EAN caching

Redis

optimized product indexes

geospatial indexes

parallel provider aggregation

progressive price results where architecture supports it

Android should not require a separate price backend later.

---

## 36 — SECURITY ACROSS PLATFORMS

Use platform-native secure storage:

iOS:
Keychain

Android:
Android Keystore / encrypted storage

Never distribute backend provider secrets to either app.

Authentication and authorization behavior must remain consistent across platforms.

---

## 37 — ANDROID DESIGN QUALITY TARGET

When Android development starts, it must receive the same level of quality as iOS.

Do not treat Android as a secondary low-quality port.

Android version must be:

fast

premium

native

accessible

polished

responsive

tablet-ready later if business value supports it.

Use Jetpack Compose rather than legacy XML for new UI unless a specific technical requirement justifies otherwise.

---

## 38 — ANDROID CAMERA EXPERIENCE

Future Android scanner should provide equivalent product value:

camera

barcode recognition

flashlight

manual GTIN

haptic feedback

duplicate suppression

product resolving

fast transition to comparison

The exact animation may differ from iOS.

Do not require pixel-identical scanner UI.

---

## 39 — ANDROID MAP EXPERIENCE

Future Android map must support:

price pins

store selection

address

distance

route action

The routing provider may differ.

All underlying store data comes from the same PREISORA backend.

---

## 40 — CROSS-PLATFORM DEFINITION OF DONE

Any core backend feature should be considered platform-ready only when:

API is platform-neutral.

No iOS-specific fields leak into domain model.

API contract is documented.

Errors are standardized.

Authentication is not Apple-exclusive.

Business logic is not duplicated unnecessarily in iOS.

Data identifiers are stable.

Localization is supported.

Country/currency assumptions are configurable.

Future Android implementation can consume the feature without backend redesign.

---

## 41 — FINAL CROSS-PLATFORM PRINCIPLE

Build PREISORA with this philosophy:

One intelligence platform. Multiple native experiences.

Shared:

Product database

Price engine

Retailer data

Store data

Search

Offers

Promotions

Price history

Price alerts

Shopping optimizer

User synchronization

API contracts

Platform-specific:

Camera

Navigation

Maps UI

Permissions

Push delivery implementation

Secure storage

Native interaction patterns

Native UI implementation

PREISORA must launch as an exceptional native iPhone app while its technical foundation is already prepared to support a first-class Android application later.

Never sacrifice current iOS product quality for theoretical portability.

Never create technical debt that requires rebuilding the entire system when Android begins.

Design the foundation once.

Deliver native excellence on each platform.

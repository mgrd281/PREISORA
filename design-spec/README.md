# PREISORA Design Specification

**Same brand, native platform behavior.** (Constitution §13–15)

This directory is the platform-neutral definition of the PREISORA brand system. It describes
*what the brand is* — colors, spacing, corners, type hierarchy, motion philosophy — not *how any
platform renders it*. Each platform maps these tokens to its own native idiom and keeps native
interaction patterns. Pixel-identical UI across iOS and Android is explicitly a **non-goal**
(§13–14).

## Files

| File | Purpose |
|---|---|
| `tokens.json` | Canonical design tokens, [W3C DTCG draft format](https://tr.designtokens.org/format/) (`$type`/`$value`). Dark-mode values live in `$extensions["de.preisora.dark"]`. `version` gates client syncs. |
| `mapping/ios.md` | How tokens map to SwiftUI (this repo's `ios/Preisora/DesignSystem/Tokens.swift`). |
| `mapping/android.md` | Placeholder: mapping rules Jetpack Compose will follow when Android begins. No Compose code before then (§26). |

## Rules

1. **Tokens are semantic, not raw.** Screens consume `color.accent.subtle`, never `#E3F3EC`.
   Adding a raw hex to a screen is a spec violation.
2. **Typography maps to platform text styles**, never fixed pixel sizes — Dynamic Type (iOS) and
   font scaling (Android) must keep working. The `role` values in `tokens.json` are conceptual
   (`large-title`, `body`, …); each platform picks its native equivalent.
3. **Price figures always use monospaced digits** (`typography.price`) so columns of prices align.
4. **Corner philosophy:** one default corner (`radius.medium`) for cards and containers; `small`
   for chips/badges; `large` only for sheets and hero surfaces. Do not invent radii per screen.
5. **Motion confirms intelligence, never decorates:** the two moments worth emphasis are
   scan-resolved and prices-arrived (`motion.duration.emphasized`). Everything else is `fast` or
   `standard`. Reduce-motion settings are respected unconditionally.
6. **Dark mode is first-class:** every color token carries a dark value. A platform may not ship
   a screen that ignores the dark variants.
7. **Changing `tokens.json` requires bumping `version`** and updating every platform mapping in
   the same change (iOS: `Tokens.swift` mirrors it by hand until codegen lands — the version
   constant is the drift guard).

## What stays platform-specific (deliberately)

Navigation patterns, sheets/dialogs, permission flows, haptics, SF Symbols vs Material icons,
map rendering, scanner UI chrome — native on each platform, sharing only the brand and the
information hierarchy (§14).

# Token mapping — Android (Jetpack Compose) — PLACEHOLDER

> Android development has not started (constitution §26). This file fixes the mapping **rules**
> Android will follow so the design system ports without redesign. It intentionally contains no
> Compose code.

## Rules (to apply when Android work begins)

- `color.*` → a Compose `ColorScheme`/custom theme object built from the same hex pairs
  (`$value` light, `$extensions["de.preisora.dark"]` dark); dark mode follows the system setting.
- `spacing.*` → `Dp` constants (4/8/16/24/32); same five stops, no additions without a spec change.
- `radius.*` → `RoundedCornerShape` values; `medium` is the default card shape.
- `typography.*` → Material type roles (not fixed sp where avoidable): `display`→display/headline
  role, `body`→bodyLarge, `caption`→labelMedium equivalent; `price` uses tabular figures
  (`FontFeatureSettings "tnum"`). Font scaling must keep working.
- `motion.duration.*` → the same three durations; respect `Settings.Global.ANIMATOR_DURATION_SCALE`
  and reduce-motion preferences.
- Interaction patterns stay native Material/Compose: back navigation, permission flows, sheets —
  shared brand, native behavior (§14). Android is a first-class app, not a port (§37).

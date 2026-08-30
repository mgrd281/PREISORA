# Token mapping — iOS (SwiftUI)

Implementation lives in `ios/Preisora/DesignSystem/Tokens.swift`, hand-maintained to mirror
`design-spec/tokens.json` **exactly** (same paths, same values). `Tokens.version` must equal the
JSON `version` field — bump both together (drift guard until codegen lands, see ADR note in the
file header).

## Mapping rules

| Token group | SwiftUI mapping |
|---|---|
| `color.*` | `Color(light:dark:)` pairs built from the `$value` + `$extensions["de.preisora.dark"]` hex values; exposed as `Tokens.Color.backgroundPrimary` etc. Never use raw hex in feature code. |
| `spacing.*` | `CGFloat` constants (`Tokens.Spacing.md == 16`). Used for padding/stack spacing; grid comes from these five stops only. |
| `radius.*` | `CGFloat` constants applied via `.clipShape(RoundedRectangle(cornerRadius:))` with `.continuous` style — the iOS expression of the corner philosophy. |
| `typography.*` | Platform text styles, never fixed sizes: `display`→`.largeTitle.bold()`, `title`→`.title2.weight(.semibold)`, `headline`→`.headline`, `body`→`.body`, `caption`→`.footnote`; `price`→`.title.bold().monospacedDigit()`. Dynamic Type keeps working by construction. |
| `motion.duration.*` | `TimeInterval` constants used with `withAnimation(.easeOut(duration:))`; wrap emphasized moments in `UIAccessibility.isReduceMotionEnabled` checks (or `.animation(nil)` fallbacks). |

## iOS-native decisions (outside the shared spec, per §14)

SF Symbols for iconography; native sheets (`.sheet`, `.presentationDetents`); standard
NavigationStack behavior; system haptics on scan success (`.sensoryFeedback`); system
light/dark switching drives which token variant renders (no in-app theme toggle).

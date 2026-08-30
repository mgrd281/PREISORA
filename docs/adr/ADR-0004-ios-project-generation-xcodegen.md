# ADR-0004: iOS project generation via XcodeGen

**Status:** Accepted · **Date:** 2026-08-30

## Context

The foundation is authored in a Linux environment without Xcode. `.xcodeproj` (pbxproj) files are
fragile to write by hand and hostile to code review and merges. Options: hand-written pbxproj,
Tuist, XcodeGen.

## Decision

- A declarative **`ios/project.yml`** (XcodeGen) is committed; `Preisora.xcodeproj` is
  **gitignored** and generated on a Mac with `xcodegen generate`.
- Tested against **XcodeGen 2.x** (`brew install xcodegen`); the spec avoids exotic settings to
  minimize version sensitivity.
- Tuist rejected as heavier than needed for a single app target; hand-written pbxproj rejected as
  unreviewable and unauthorable without Xcode.

## Consequences

- Project structure diffs are reviewable YAML.
- Every fresh checkout needs one extra step (`xcodegen generate`) — documented in `ios/README.md`.
- Swift sources are authored without a compiler; a small first-build fix-up pass on the Mac is
  expected and acceptable for the skeleton phase.

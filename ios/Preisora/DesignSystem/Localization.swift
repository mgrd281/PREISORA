//
//  Localization.swift
//  DesignSystem — runtime lookup for keys that are not source literals.
//
//  The backend NEVER sends user-facing copy (§33): it sends `messageKey`, and the
//  client resolves it. Those keys are only known at runtime, so they cannot be
//  written as `Text("literal")`; this helper resolves them against the same
//  `Localizable.xcstrings` catalog.
//
//  Keys that ARE literals stay literals (`Text("tab.home")`) so Xcode can keep the
//  catalog in sync.
//

import Foundation

enum L10n {

    /// Resolves a dot-namespaced key at runtime. Returns the key itself when it is
    /// missing from the catalog, which is a visible-but-harmless failure mode.
    static func string(_ key: String) -> String {
        String(localized: String.LocalizationValue(key))
    }

    /// Resolves a key and substitutes a single `%@` placeholder.
    static func string(_ key: String, _ argument: String) -> String {
        String(format: string(key), argument)
    }
}

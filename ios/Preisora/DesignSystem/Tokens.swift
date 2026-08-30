//
//  Tokens.swift
//  PREISORA
//
//  MIRROR OF `design-spec/tokens.json` — HAND-MAINTAINED.
//
//  DRIFT RISK (accepted, see design-spec/mapping/ios.md and ADR-0004):
//  there is no token codegen yet, so this file is a manual transcription of the
//  W3C-DTCG token document. Every value below appears verbatim in tokens.json;
//  the original `$value` string is kept in a trailing comment on each line so a
//  reviewer can diff the two files by eye.
//
//  VERSION GUARD: `Tokens.version` MUST equal the `version` field of
//  design-spec/tokens.json. Bump both in the same change — `TokensVersionTests`
//  (and any future codegen) treat a mismatch as a build-blocking defect.
//
//  Feature code never uses raw hex, raw point values or raw durations: it uses
//  these constants only.
//

import SwiftUI
import UIKit

enum Tokens {

    /// Must equal `version` in design-spec/tokens.json.
    static let version: String = "1.0.0"

    // MARK: - color.*

    /// `color.*` — light `$value` + dark `$extensions["de.preisora.dark"]` pairs.
    enum Color {
        // color.background.*
        static let backgroundPrimary: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xFFFFFF, darkHex: 0x0E1116) // #FFFFFF / #0E1116
        static let backgroundSecondary: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xF4F6F8, darkHex: 0x171C23) // #F4F6F8 / #171C23
        static let backgroundElevated: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xFFFFFF, darkHex: 0x1E242D) // #FFFFFF / #1E242D

        // color.text.*
        static let textPrimary: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0x101418, darkHex: 0xF2F5F7) // #101418 / #F2F5F7
        static let textSecondary: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0x5B6673, darkHex: 0x9AA6B2) // #5B6673 / #9AA6B2
        static let textOnAccent: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xFFFFFF, darkHex: 0xFFFFFF) // #FFFFFF / #FFFFFF

        // color.accent.*
        static let accentPrimary: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0x0A7D4F, darkHex: 0x2FB37D) // #0A7D4F / #2FB37D
        static let accentSubtle: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xE3F3EC, darkHex: 0x12291F) // #E3F3EC / #12291F

        // color.success / warning / error
        static let success: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0x1E8E3E, darkHex: 0x4CBB6C) // #1E8E3E / #4CBB6C
        static let warning: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xB26A00, darkHex: 0xE0A23E) // #B26A00 / #E0A23E
        static let error: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xC4271B, darkHex: 0xE5675C) // #C4271B / #E5675C

        // color.border.*
        static let borderSubtle: SwiftUI.Color =
            SwiftUI.Color(lightHex: 0xE2E7EC, darkHex: 0x2A323C) // #E2E7EC / #2A323C
    }

    // MARK: - spacing.*

    /// `spacing.*` — the only five grid stops. Values are the `$value` px numbers.
    enum Spacing {
        static let xs: CGFloat = 4   // 4px
        static let sm: CGFloat = 8   // 8px
        static let md: CGFloat = 16  // 16px
        static let lg: CGFloat = 24  // 24px
        static let xl: CGFloat = 32  // 32px
    }

    // MARK: - radius.*

    /// `radius.*` — applied through `.clipShape(RoundedRectangle(cornerRadius:style: .continuous))`.
    enum Radius {
        static let small: CGFloat = 8   // 8px  — chips, badges, small controls
        static let medium: CGFloat = 12 // 12px — cards, list containers (default corner)
        static let large: CGFloat = 20  // 20px — sheets, hero surfaces
    }

    // MARK: - typography.*

    /// `typography.*` — platform text styles, never fixed sizes (Dynamic Type by construction).
    enum Typography {
        /// display → large-title / bold
        static let display: Font = .largeTitle.bold()
        /// title → title-2 / semibold
        static let title: Font = .title2.weight(.semibold)
        /// headline → headline / semibold
        static let headline: Font = .headline
        /// body → body / regular
        static let body: Font = .body
        /// caption → footnote / regular
        static let caption: Font = .footnote
        /// price → title-1 / bold / monospaced digits (lists align)
        static let price: Font = .title.bold().monospacedDigit()
    }

    // MARK: - motion.duration.*

    /// `motion.duration.*` in seconds (JSON expresses them in ms).
    /// Philosophy: motion confirms intelligence, never decorates. Always respect
    /// reduce-motion — see `Tokens.Motion.animation(_:)`.
    enum Motion {
        static let fast: TimeInterval = 0.150       // 150ms
        static let standard: TimeInterval = 0.250   // 250ms
        static let emphasized: TimeInterval = 0.400 // 400ms

        /// Reduce-motion-aware animation for a token duration.
        /// Returns `nil` when the system asks for reduced motion, which SwiftUI
        /// treats as "no animation".
        static func animation(_ duration: TimeInterval) -> Animation? {
            if UIAccessibility.isReduceMotionEnabled {
                return nil
            }
            return .easeOut(duration: duration)
        }
    }
}

// MARK: - Hex helpers

extension SwiftUI.Color {
    /// Builds a light/dark token pair from the two hex values in tokens.json.
    /// The system light/dark setting drives which variant renders — there is no
    /// in-app theme toggle (design-spec/mapping/ios.md).
    init(lightHex: UInt32, darkHex: UInt32) {
        let dynamic = UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(rgbHex: darkHex)
                : UIColor(rgbHex: lightHex)
        }
        self.init(uiColor: dynamic)
    }
}

extension UIColor {
    /// 0xRRGGBB, fully opaque, sRGB.
    convenience init(rgbHex: UInt32) {
        let red = CGFloat((rgbHex >> 16) & 0xFF) / 255.0
        let green = CGFloat((rgbHex >> 8) & 0xFF) / 255.0
        let blue = CGFloat(rgbHex & 0xFF) / 255.0
        self.init(red: red, green: green, blue: blue, alpha: 1.0)
    }
}

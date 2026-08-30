//
//  Badges.swift
//  DesignSystem — freshness, promotion and best-offer badges.
//
//  Freshness is SERVER-COMPUTED (`Offer.freshness`); the badge only picks a colour
//  and a localized word. An unknown future class renders neutrally instead of
//  disappearing — the user still sees that the server said something.
//

import Foundation
import SwiftUI

struct FreshnessBadge: View {

    let freshness: Freshness
    let observedAt: Date?

    init(freshness: Freshness, observedAt: Date? = nil) {
        self.freshness = freshness
        self.observedAt = observedAt
    }

    var body: some View {
        HStack(spacing: Tokens.Spacing.xs) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
            Text(L10n.string(labelKey))
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)
            if let observedAt {
                Text(verbatim: RelativeDateFormatting.string(for: observedAt))
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch freshness {
        case .fresh: return Tokens.Color.success
        case .aging: return Tokens.Color.warning
        case .stale: return Tokens.Color.error
        case .unknown: return Tokens.Color.textSecondary
        }
    }

    private var labelKey: String {
        switch freshness {
        case .fresh: return "freshness.fresh"
        case .aging: return "freshness.aging"
        case .stale: return "freshness.stale"
        case .unknown: return "freshness.unknown"
        }
    }
}

/// Renders a promotion the server attached to an offer. The discount itself was
/// already applied to `effectivePrice` server-side — this is labelling, not maths.
struct PromotionBadge: View {

    let promotion: Promotion

    var body: some View {
        HStack(spacing: Tokens.Spacing.xs) {
            Image(systemName: "tag.fill")
                .font(.caption2)
            Text(label)
                .font(Tokens.Typography.caption)
        }
        .padding(.horizontal, Tokens.Spacing.sm)
        .padding(.vertical, Tokens.Spacing.xs)
        .foregroundStyle(Tokens.Color.textOnAccent)
        .background(Tokens.Color.accentPrimary)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.small, style: .continuous))
    }

    private var label: String {
        switch promotion.type {
        case .percentage:
            if let percentOff = promotion.percentOff {
                return L10n.string("promotion.percent_off", String(percentOff))
            }
            return L10n.string("promotion.generic")
        case .absolute:
            if let amountOff = promotion.amountOff {
                return L10n.string("promotion.amount_off", amountOff.formatted())
            }
            return L10n.string("promotion.generic")
        case .multibuy:
            return L10n.string("promotion.multibuy")
        case .loyalty:
            return L10n.string("promotion.loyalty")
        case .unknown:
            return L10n.string("promotion.generic")
        }
    }
}

/// "Best price" marker. `isBest` is server-computed — at most one per response.
struct BestOfferBadge: View {
    var body: some View {
        Text("price.best")
            .font(Tokens.Typography.caption)
            .padding(.horizontal, Tokens.Spacing.sm)
            .padding(.vertical, Tokens.Spacing.xs)
            .foregroundStyle(Tokens.Color.accentPrimary)
            .background(Tokens.Color.accentSubtle)
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.small, style: .continuous))
    }
}

/// Integer-meter distances formatted for humans ("420 m", "1,8 km").
enum DistanceFormatting {

    static func string(meters: Int, locale: Locale = .current) -> String {
        if meters < 1000 {
            return "\(meters) m"
        }
        let kilometres = Decimal(meters) / Decimal(1000)
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        let number = NSDecimalNumber(decimal: kilometres)
        let text = formatter.string(from: number) ?? number.stringValue
        return "\(text) km"
    }
}

/// "vor 2 Std." style stamps for `observedAt`.
enum RelativeDateFormatting {

    private static let formatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    static func string(for date: Date, relativeTo reference: Date = Date()) -> String {
        formatter.localizedString(for: date, relativeTo: reference)
    }
}

//
//  PriceLabel.swift
//  DesignSystem — the one place a price becomes text.
//
//  Formatting always goes through `Money.formatted(locale:)` (Decimal, never Double),
//  and always renders the offer's own currency — never an assumed EUR (§24).
//  The `price` type token carries monospaced digits so columns of prices align.
//

import SwiftUI

struct PriceLabel: View {

    enum Size {
        /// `typography.price` — the product-detail hero.
        case hero
        /// `typography.headline` — list rows.
        case row
    }

    let price: Money
    /// Shown struck-through above/next to `price` when a promotion moved it.
    let strikethrough: Money?
    let size: Size
    let emphasize: Bool

    init(price: Money, strikethrough: Money? = nil, size: Size = .row, emphasize: Bool = false) {
        self.price = price
        self.strikethrough = strikethrough
        self.size = size
        self.emphasize = emphasize
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Spacing.xs) {
            Text(price.formatted())
                .font(font)
                .foregroundStyle(emphasize ? Tokens.Color.accentPrimary : Tokens.Color.textPrimary)
                .accessibilityLabel(Text(price.formatted()))

            if let strikethrough, strikethrough.amountMinor != price.amountMinor {
                Text(strikethrough.formatted())
                    .font(Tokens.Typography.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Color.textSecondary)
                    .strikethrough(true, color: Tokens.Color.textSecondary)
                    .accessibilityHidden(true)
            }
        }
    }

    private var font: Font {
        switch size {
        case .hero:
            return Tokens.Typography.price
        case .row:
            return Tokens.Typography.headline.monospacedDigit()
        }
    }
}

/// Secondary "per unit" line, e.g. `1,19 € / 1 l`.
struct UnitPriceLabel: View {

    let unitPrice: Money
    let quantityText: String?

    var body: some View {
        Text(text)
            .font(Tokens.Typography.caption)
            .foregroundStyle(Tokens.Color.textSecondary)
    }

    private var text: String {
        guard let quantityText, !quantityText.isEmpty else {
            return unitPrice.formatted()
        }
        return "\(unitPrice.formatted()) / \(quantityText)"
    }
}

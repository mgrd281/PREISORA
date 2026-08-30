//
//  OfferRow.swift
//  DesignSystem — one offer in a list.
//
//  Everything shown here was decided server-side (§22): which offer is best, how
//  fresh it is, what the promotion does to the price. The row ranks nothing and
//  computes no discount.
//
//  `retailerName` is resolved from `Offer.retailerMarketId` via `GET /retailers`
//  (the contract embeds markets exactly so this needs no extra round trip).
//

import SwiftUI

struct OfferRow: View {

    let offer: Offer
    let retailerName: String?

    init(offer: Offer, retailerName: String? = nil) {
        self.offer = offer
        self.retailerName = retailerName
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(titleText)
                        .font(Tokens.Typography.headline)
                        .foregroundStyle(Tokens.Color.textPrimary)

                    if let subtitle = subtitleText {
                        Text(subtitle)
                            .font(Tokens.Typography.caption)
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }
                }

                Spacer(minLength: Tokens.Spacing.sm)

                VStack(alignment: .trailing, spacing: Tokens.Spacing.xs) {
                    PriceLabel(
                        price: offer.effectivePrice,
                        strikethrough: offer.hasPriceReduction ? offer.price : nil,
                        size: .row,
                        emphasize: offer.isBest
                    )
                    if let unitPrice = offer.unitPrice {
                        UnitPriceLabel(
                            unitPrice: unitPrice,
                            quantityText: offer.unitPriceQuantityText
                        )
                    }
                }
            }

            HStack(spacing: Tokens.Spacing.sm) {
                if offer.isBest {
                    BestOfferBadge()
                }
                if let promotion = offer.promotion {
                    PromotionBadge(promotion: promotion)
                }
                FreshnessBadge(freshness: offer.freshness, observedAt: offer.observedAt)
                Spacer(minLength: 0)
            }
        }
        .padding(Tokens.Spacing.md)
        .background(offer.isBest ? Tokens.Color.accentSubtle : Tokens.Color.backgroundElevated)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous)
                .stroke(
                    offer.isBest ? Tokens.Color.accentPrimary : Tokens.Color.borderSubtle,
                    lineWidth: offer.isBest ? 1.5 : 1
                )
        )
    }

    private var titleText: String {
        if let name = offer.store?.name, !name.isEmpty {
            return name
        }
        if let retailerName, !retailerName.isEmpty {
            return retailerName
        }
        return L10n.string("offer.market_wide")
    }

    private var subtitleText: String? {
        var parts: [String] = []
        if offer.store != nil, let retailerName, !retailerName.isEmpty {
            parts.append(retailerName)
        }
        if let distanceMeters = offer.distanceMeters {
            parts.append(DistanceFormatting.string(meters: distanceMeters))
        } else if offer.storeId == nil {
            parts.append(L10n.string("offer.market_wide_hint"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

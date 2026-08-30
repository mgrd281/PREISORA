//
//  ProductDetailView.swift
//  Features/ProductDetail
//
//  Product header · best offer highlighted · offer list with freshness and promotion
//  badges · price history (capability-gated) · favorite toggle · share.
//

import SwiftUI

@MainActor
struct ProductDetailView: View {

    @Environment(\.services) private var services
    @State private var viewModel: ProductDetailViewModel

    init(reference: ProductReference) {
        _viewModel = State(initialValue: ProductDetailViewModel(reference: reference))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                switch viewModel.productState {
                case .idle, .loading:
                    LoadingView(messageKey: "product.loading")
                        .frame(height: 240)
                case .failed(let error):
                    ErrorStateView(error: error) {
                        Task { await viewModel.retry(services: services) }
                    }
                case .loaded(let product):
                    header(product)
                    offersSection(product)
                    if viewModel.capabilities.features.priceHistory {
                        historySection
                    }
                }
            }
            .padding(Tokens.Spacing.md)
        }
        .background(Tokens.Color.backgroundPrimary)
        .navigationTitle(Text(verbatim: viewModel.product?.name ?? L10n.string("product.title")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let product = viewModel.product {
                    ShareLink(item: services.sharing.productURL(id: product.id)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    Button {
                        Task { await viewModel.toggleFavorite(services: services) }
                    } label: {
                        Image(systemName: viewModel.isFavorite ? "heart.fill" : "heart")
                    }
                    .disabled(viewModel.favoriteInFlight)
                    .tint(Tokens.Color.accentPrimary)
                }
            }
        }
        .task {
            await viewModel.loadIfNeeded(services: services)
        }
    }

    // MARK: - Header

    private func header(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            HStack(alignment: .top, spacing: Tokens.Spacing.md) {
                RemoteImage(url: product.primaryImage?.imageURL)
                    .frame(width: 96, height: 96)
                    .clipShape(
                        RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(verbatim: product.name)
                        .font(Tokens.Typography.title)
                        .foregroundStyle(Tokens.Color.textPrimary)

                    if !product.subtitleText.isEmpty {
                        Text(verbatim: product.subtitleText)
                            .font(Tokens.Typography.body)
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }

                    Text(verbatim: product.gtin)
                        .font(Tokens.Typography.caption.monospacedDigit())
                        .foregroundStyle(Tokens.Color.textSecondary)
                }
                Spacer(minLength: 0)
            }

            if let best = viewModel.bestOffer {
                bestOfferCard(best)
            }
        }
    }

    private func bestOfferCard(_ offer: Offer) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack {
                BestOfferBadge()
                Spacer()
                FreshnessBadge(freshness: offer.freshness, observedAt: offer.observedAt)
            }

            PriceLabel(
                price: offer.effectivePrice,
                strikethrough: offer.hasPriceReduction ? offer.price : nil,
                size: .hero,
                emphasize: true
            )

            if let unitPrice = offer.unitPrice {
                UnitPriceLabel(unitPrice: unitPrice, quantityText: offer.unitPriceQuantityText)
            }

            if let store = offer.store {
                Text(verbatim: store.name)
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Text(verbatim: store.address.singleLine)
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            } else if let name = viewModel.retailerName(for: offer) {
                Text(verbatim: name)
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
            }

            if let promotion = offer.promotion {
                PromotionBadge(promotion: promotion)
            }
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Color.accentSubtle)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.large, style: .continuous))
    }

    // MARK: - Offers

    @ViewBuilder
    private func offersSection(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack {
                Text("offers.title")
                    .font(Tokens.Typography.title)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Spacer()
                NavigationLink(value: Route.storesMap(productId: product.id)) {
                    HStack(spacing: Tokens.Spacing.xs) {
                        Image(systemName: "map")
                        Text("offers.show_map")
                            .font(Tokens.Typography.caption)
                    }
                }
                .tint(Tokens.Color.accentPrimary)
            }

            if viewModel.usedFallbackLocation {
                Text("location.fallback_notice")
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            }

            switch viewModel.offersState {
            case .idle, .loading:
                LoadingView(messageKey: "offers.loading")
                    .frame(height: 120)
            case .failed(let error):
                ErrorStateView(error: error) {
                    Task { await viewModel.reloadOffers(services: services) }
                }
            case .loaded(let offers):
                if offers.isEmpty {
                    EmptyStateView(
                        systemImage: "tag.slash",
                        titleKey: "offers.empty.title",
                        messageKey: "offers.empty.message"
                    )
                } else {
                    ForEach(offers) { offer in
                        OfferRow(offer: offer, retailerName: viewModel.retailerName(for: offer))
                    }
                }
            }
        }
    }

    // MARK: - Price history (capability-gated)

    @ViewBuilder
    private var historySection: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            Text("history.title")
                .font(Tokens.Typography.title)
                .foregroundStyle(Tokens.Color.textPrimary)

            switch viewModel.historyState {
            case .idle, .loading:
                LoadingView()
                    .frame(height: 80)
            case .failed(let error):
                ErrorStateView(error: error) {
                    Task { await viewModel.reloadHistory(services: services) }
                }
            case .loaded(let history):
                if history.points.isEmpty {
                    EmptyStateView(
                        systemImage: "chart.line.uptrend.xyaxis",
                        titleKey: "history.empty.title"
                    )
                } else {
                    historyBody(history)
                }
            }
        }
    }

    private func historyBody(_ history: PriceHistory) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            if let lowest = history.lowestPoint {
                HStack {
                    Text("history.lowest")
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                    Spacer()
                    PriceLabel(price: lowest.minPrice, size: .row)
                }
            }

            // Minimal token-styled bars; Swift Charts is deliberately deferred.
            ForEach(history.points.suffix(14)) { point in
                HStack(spacing: Tokens.Spacing.sm) {
                    Text(verbatim: point.date)
                        .font(Tokens.Typography.caption.monospacedDigit())
                        .foregroundStyle(Tokens.Color.textSecondary)
                        .frame(width: 92, alignment: .leading)

                    GeometryReader { geometry in
                        let fraction = barFraction(for: point, in: history)
                        RoundedRectangle(cornerRadius: Tokens.Radius.small, style: .continuous)
                            .fill(Tokens.Color.accentPrimary)
                            .frame(width: max(2, geometry.size.width * fraction))
                    }
                    .frame(height: 10)

                    Text(verbatim: point.minPrice.formatted())
                        .font(Tokens.Typography.caption.monospacedDigit())
                        .foregroundStyle(Tokens.Color.textPrimary)
                }
            }
        }
        .padding(Tokens.Spacing.md)
        .background(Tokens.Color.backgroundSecondary)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
    }

    /// Bar length relative to the range's highest daily minimum. Presentation only —
    /// this is not price maths, it is a width.
    private func barFraction(for point: PriceHistoryPoint, in history: PriceHistory) -> CGFloat {
        guard let highest = history.highestPoint?.minAmountMinor, highest > 0 else {
            return 0
        }
        let ratio = Double(point.minAmountMinor) / Double(highest)
        return CGFloat(min(1.0, max(0.0, ratio)))
    }
}

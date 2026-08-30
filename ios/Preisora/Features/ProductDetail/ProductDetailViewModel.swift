//
//  ProductDetailViewModel.swift
//  Features/ProductDetail — the heart of the journey.
//
//  Sequence: resolve the product (by id / GTIN / slug) → resolve a location →
//  load geo-ranked offers → resolve retailer display names → optionally load price
//  history (gated on `capabilities.priceHistory`).
//
//  NOTHING is re-ranked here. `isBest`, `freshness` and `effectivePrice` arrive
//  computed (§22); the view renders them.
//

import Foundation
import Observation

@MainActor
@Observable
final class ProductDetailViewModel {

    let reference: ProductReference

    private(set) var productState: LoadState<Product> = .idle
    private(set) var offersState: LoadState<[Offer]> = .idle
    private(set) var historyState: LoadState<PriceHistory> = .idle
    private(set) var capabilities: Capabilities = .allDisabled
    /// `retailerMarketId` → market display name.
    private(set) var retailerNames: [String: String] = [:]
    private(set) var isFavorite = false
    private(set) var favoriteInFlight = false
    private(set) var usedFallbackLocation = false

    /// Contract default; also the maximum the offers endpoint accepts is 50000.
    var radiusMeters: Int = 5000
    var historyRange: PriceHistoryRange = .thirtyDays

    private var queryCoordinate: Coordinate?
    private var hasLoadedOnce = false

    init(reference: ProductReference) {
        self.reference = reference
    }

    var product: Product? { productState.value }

    var offers: [Offer] { offersState.value ?? [] }

    var bestOffer: Offer? { offers.first(where: { $0.isBest }) }

    /// Offers without the best one, in server order.
    var otherOffers: [Offer] {
        guard let best = bestOffer else { return offers }
        return offers.filter { $0.id != best.id }
    }

    func retailerName(for offer: Offer) -> String? {
        retailerNames[offer.retailerMarketId]
    }

    // MARK: - Loading

    func loadIfNeeded(services: AppServices) async {
        guard !hasLoadedOnce else { return }
        hasLoadedOnce = true
        await load(services: services)
    }

    func load(services: AppServices) async {
        await loadProduct(services: services)
        guard let product = productState.value else { return }

        await loadCapabilities(services: services)
        await resolveCoordinate(services: services)
        await loadRetailers(services: services)
        await loadOffers(productId: product.id, services: services)
        await refreshFavoriteState(productId: product.id, services: services)

        if capabilities.features.priceHistory {
            await loadHistory(productId: product.id, services: services)
        }
    }

    func retry(services: AppServices) async {
        await load(services: services)
    }

    func reloadOffers(services: AppServices) async {
        guard let product = productState.value else { return }
        await loadOffers(productId: product.id, services: services)
    }

    func reloadHistory(services: AppServices) async {
        guard let product = productState.value, capabilities.features.priceHistory else { return }
        await loadHistory(productId: product.id, services: services)
    }

    private func loadProduct(services: AppServices) async {
        productState = .loading
        do {
            let product: Product
            switch reference {
            case .id(let id):
                product = try await services.api.product(id: id)
            case .gtin(let gtin):
                product = try await services.api.product(gtin: gtin)
            case .slug(let slug):
                product = try await services.api.product(slug: slug)
            }
            productState = .loaded(product)
            services.analytics.track(
                .productResolved(productId: product.id, gtin: product.gtin)
            )
            services.recentScans.record(
                RecentScan(
                    gtin: product.gtin,
                    productId: product.id,
                    productName: product.name,
                    scannedAt: Date()
                )
            )
        } catch {
            let apiError = APIError.from(error)
            productState = .failed(apiError)
            track(apiError, services: services)
        }
    }

    private func loadCapabilities(services: AppServices) async {
        do {
            capabilities = try await services.api.capabilities()
        } catch {
            // Capabilities are a gate, not content: failing closed is correct.
            capabilities = .allDisabled
        }
    }

    private func resolveCoordinate(services: AppServices) async {
        if services.location.authorization == .notDetermined {
            services.location.requestAuthorization()
        }
        if let location = await services.location.currentLocation() {
            queryCoordinate = location.coordinate
            usedFallbackLocation = false
        } else {
            // Permission denied / unavailable: the demo still works around Berlin.
            queryCoordinate = Coordinate.berlinFallback
            usedFallbackLocation = true
        }
    }

    private func loadRetailers(services: AppServices) async {
        do {
            let page = try await services.api.retailers()
            var names: [String: String] = [:]
            for retailer in page.data {
                for market in retailer.markets {
                    names[market.id] = market.displayName
                }
            }
            retailerNames = names
        } catch {
            retailerNames = [:]
        }
    }

    private func loadOffers(productId: String, services: AppServices) async {
        let coordinate = queryCoordinate ?? Coordinate.berlinFallback
        offersState = .loading
        do {
            let page = try await services.api.offers(
                productId: productId,
                coordinate: coordinate,
                radiusMeters: radiusMeters
            )
            offersState = .loaded(page.data)
            services.analytics.track(
                .pricesLoaded(
                    productId: productId,
                    offerCount: page.data.count,
                    radiusMeters: radiusMeters
                )
            )
            if let best = page.data.first(where: { $0.isBest }) {
                services.analytics.track(
                    .bestOfferViewed(
                        productId: productId,
                        storeId: best.storeId,
                        amountMinor: best.effectivePrice.amountMinor,
                        currencyCode: best.effectivePrice.currencyCode
                    )
                )
            }
        } catch {
            let apiError = APIError.from(error)
            offersState = .failed(apiError)
            track(apiError, services: services)
        }
    }

    private func loadHistory(productId: String, services: AppServices) async {
        historyState = .loading
        do {
            let history = try await services.api.priceHistory(
                productId: productId,
                range: historyRange
            )
            historyState = .loaded(history)
        } catch {
            historyState = .failed(APIError.from(error))
        }
    }

    // MARK: - Favorites

    private func refreshFavoriteState(productId: String, services: AppServices) async {
        do {
            let page = try await services.api.favorites(limit: 50)
            isFavorite = page.data.contains { $0.productId == productId }
        } catch {
            // Favorites need a session; a failure here must not break the screen.
            isFavorite = false
        }
    }

    func toggleFavorite(services: AppServices) async {
        guard let product = productState.value, !favoriteInFlight else { return }
        favoriteInFlight = true
        defer { favoriteInFlight = false }

        do {
            if isFavorite {
                try await services.api.removeFavorite(productId: product.id)
                isFavorite = false
            } else {
                _ = try await services.api.addFavorite(productId: product.id)
                isFavorite = true
                services.analytics.track(.favoriteAdded(productId: product.id))
            }
        } catch {
            let apiError = APIError.from(error)
            track(apiError, services: services)
        }
    }

    // MARK: - Helpers

    private func track(_ error: APIError, services: AppServices) {
        services.analytics.track(
            .errorShown(errorCode: error.code.wireValue, retryable: error.retryable)
        )
    }
}

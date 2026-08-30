//
//  StoresMapViewModel.swift
//  Features/StoresMap
//
//  Two sources, one screen:
//   • scoped to a product  → the stores embedded in that product's ranked offers
//   • unscoped             → `GET /stores?lat&lng&radiusMeters`
//
//  Distances are the server's integer meters — never recomputed on the client.
//

import Foundation
import Observation

@MainActor
@Observable
final class StoresMapViewModel {

    let productId: String?

    private(set) var storesState: LoadState<[Store]> = .idle
    private(set) var centerCoordinate: Coordinate = .berlinFallback
    private(set) var usedFallbackLocation = false

    var radiusMeters: Int = 5000

    private var hasLoadedOnce = false

    init(productId: String?) {
        self.productId = productId
    }

    var stores: [Store] { storesState.value ?? [] }

    func loadIfNeeded(services: AppServices) async {
        guard !hasLoadedOnce else { return }
        hasLoadedOnce = true
        await load(services: services)
    }

    func load(services: AppServices) async {
        storesState = .loading

        if services.location.authorization == .notDetermined {
            services.location.requestAuthorization()
        }
        if let location = await services.location.currentLocation() {
            centerCoordinate = location.coordinate
            usedFallbackLocation = false
        } else {
            centerCoordinate = .berlinFallback
            usedFallbackLocation = true
        }

        do {
            if let productId {
                let page = try await services.api.offers(
                    productId: productId,
                    coordinate: centerCoordinate,
                    radiusMeters: radiusMeters
                )
                storesState = .loaded(StoresMapViewModel.uniqueStores(from: page.data))
            } else {
                let page = try await services.api.stores(
                    coordinate: centerCoordinate,
                    radiusMeters: radiusMeters
                )
                storesState = .loaded(page.data)
            }
        } catch {
            let apiError = APIError.from(error)
            storesState = .failed(apiError)
            services.analytics.track(
                .errorShown(errorCode: apiError.code.wireValue, retryable: apiError.retryable)
            )
        }
    }

    /// Market-wide offers carry no store; store-specific ones may repeat.
    private static func uniqueStores(from offers: [Offer]) -> [Store] {
        var seen = Set<String>()
        var result: [Store] = []
        for offer in offers {
            guard let store = offer.store else { continue }
            if seen.insert(store.id).inserted {
                result.append(store)
            }
        }
        return result
    }
}

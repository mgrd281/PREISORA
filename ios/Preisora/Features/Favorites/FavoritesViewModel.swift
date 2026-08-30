//
//  FavoritesViewModel.swift
//  Features/Favorites
//
//  Favorites are user-scoped, so the first load bootstraps the anonymous session
//  transparently inside `APIClient` (§11 scan-before-signup funnel).
//

import Foundation
import Observation

@MainActor
@Observable
final class FavoritesViewModel {

    private(set) var state: LoadState<[Favorite]> = .idle

    private let pageLimit = 50

    init() {}

    var favorites: [Favorite] { state.value ?? [] }

    func load(services: AppServices) async {
        state = .loading
        do {
            let page = try await services.api.favorites(limit: pageLimit)
            state = .loaded(page.data)
        } catch {
            let apiError = APIError.from(error)
            state = .failed(apiError)
            services.analytics.track(
                .errorShown(errorCode: apiError.code.wireValue, retryable: apiError.retryable)
            )
        }
    }

    /// DELETE is idempotent server-side, so an already-removed favorite still ends in
    /// the same local state.
    func remove(productId: String, services: AppServices) async {
        do {
            try await services.api.removeFavorite(productId: productId)
            if let current = state.value {
                state = .loaded(current.filter { $0.productId != productId })
            }
        } catch {
            await load(services: services)
        }
    }
}

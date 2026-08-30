//
//  HomeViewModel.swift
//  Features/Home
//
//  Home is the scan CTA plus the local recent-scan list. It deliberately shows NO
//  prices: a cached price is a wrong price (§22), so a recent scan carries identity
//  only and re-resolves on tap.
//

import Foundation
import Observation

@MainActor
@Observable
final class HomeViewModel {

    private(set) var recentScans: [RecentScan] = []
    private(set) var backendStatus: LoadState<HealthStatus> = .idle

    init() {}

    func refresh(services: AppServices) {
        recentScans = services.recentScans.load()
    }

    /// Best-effort health probe so the demo shows immediately whether the backend is
    /// reachable. Never blocks the UI and never shows a blocking error.
    func probeBackend(services: AppServices) async {
        backendStatus = .loading
        do {
            let health = try await services.api.health()
            backendStatus = .loaded(health)
        } catch let error as APIError {
            backendStatus = .failed(error)
        } catch {
            backendStatus = .failed(APIError.transportFailure(underlying: error))
        }
    }

    func clearRecents(services: AppServices) {
        services.recentScans.clear()
        recentScans = []
    }
}

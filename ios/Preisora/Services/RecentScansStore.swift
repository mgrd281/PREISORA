//
//  RecentScansStore.swift
//  Services — the Home screen's "recently scanned" list.
//
//  Deliberately UserDefaults, not the Keychain and not the backend: this is a local
//  convenience cache of public catalog data, it must survive an app restart, and it
//  must never become a second source of truth for prices. Prices are ALWAYS refetched
//  (§22) — a recent scan stores identity only.
//

import Foundation

/// One entry of the recent-scan list. Local-only, so it is not a contract type.
struct RecentScan: Codable, Hashable, Identifiable {
    let gtin: String
    let productId: String?
    let productName: String
    let scannedAt: Date

    var id: String { gtin }
}

final class RecentScansStore {

    private let defaults: UserDefaults
    private let storageKey = "de.preisora.app.recentScans"
    private let limit: Int

    init(defaults: UserDefaults = .standard, limit: Int = 12) {
        self.defaults = defaults
        self.limit = limit
    }

    func load() -> [RecentScan] {
        guard let data = defaults.data(forKey: storageKey) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let scans = try? decoder.decode([RecentScan].self, from: data) else { return [] }
        return scans
    }

    /// Inserts newest-first, de-duplicated by GTIN, capped at `limit`.
    func record(_ scan: RecentScan) {
        var scans = load().filter { $0.gtin != scan.gtin }
        scans.insert(scan, at: 0)
        if scans.count > limit {
            scans = Array(scans.prefix(limit))
        }
        persist(scans)
    }

    func clear() {
        defaults.removeObject(forKey: storageKey)
    }

    private func persist(_ scans: [RecentScan]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(scans) else { return }
        defaults.set(data, forKey: storageKey)
    }
}

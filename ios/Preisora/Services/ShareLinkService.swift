//
//  ShareLinkService.swift
//  Services — `Sharing`: canonical deep links only.
//
//  docs/deep-links.md is the grammar; this type is its only construction site, so a
//  shared link and a parsed link can never drift (`RouteDeepLinkTests` round-trips
//  the two).
//
//  Presentation is SwiftUI's `ShareLink` at the call site — a share sheet is a view,
//  not a service.
//

import Foundation

struct ShareLinkService: Sharing {

    /// Canonical public host (docs/deep-links.md). Not the API host.
    static let canonicalHost = "preisora.de"

    private let baseURL: URL

    init(baseURL: URL = URL(string: "https://\(ShareLinkService.canonicalHost)")!) {
        self.baseURL = baseURL
    }

    func productURL(id: String) -> URL {
        baseURL.appendingPathComponent("product").appendingPathComponent(id)
    }

    func productURL(slug: String) -> URL {
        baseURL.appendingPathComponent("p").appendingPathComponent(slug)
    }

    func storeURL(id: String) -> URL {
        baseURL.appendingPathComponent("store").appendingPathComponent(id)
    }
}

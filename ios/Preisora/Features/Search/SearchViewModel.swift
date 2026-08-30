//
//  SearchViewModel.swift
//  Features/Search — debounced query, real `(name, id)` cursor pagination (ADR-0002).
//
//  The cursor is opaque: it is passed back verbatim and never inspected.
//

import Foundation
import Observation

@MainActor
@Observable
final class SearchViewModel {

    var query: String = ""

    private(set) var state: LoadState<[Product]> = .idle
    private(set) var isLoadingMore = false

    private var nextCursor: String?
    private var hasMore = false
    private var activeQuery: String = ""

    /// Contract: `limit` max 50, default 20.
    private let pageLimit = 20
    /// Debounce before hitting the backend on every keystroke.
    let debounce: Duration = .milliseconds(300)

    init() {}

    var results: [Product] { state.value ?? [] }

    var canLoadMore: Bool { hasMore && nextCursor != nil && !isLoadingMore }

    /// Runs the debounce and then the first page. Cancellation-aware: SwiftUI's
    /// `.task(id:)` cancels this when the query changes again.
    func runDebouncedSearch(services: AppServices) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            state = .idle
            nextCursor = nil
            hasMore = false
            activeQuery = ""
            return
        }

        do {
            try await Task.sleep(for: debounce)
        } catch {
            return // cancelled — a newer keystroke owns the search now
        }
        guard !Task.isCancelled else { return }

        await search(trimmed, services: services)
    }

    func search(_ text: String, services: AppServices) async {
        activeQuery = text
        state = .loading
        nextCursor = nil
        hasMore = false

        do {
            let page = try await services.api.searchProducts(query: text, limit: pageLimit)
            guard !Task.isCancelled else { return }
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
            hasMore = page.pageInfo.hasMore
            services.analytics.track(
                .searchPerformed(queryLength: text.count, resultCount: page.data.count)
            )
        } catch {
            guard !Task.isCancelled else { return }
            let apiError = APIError.from(error)
            state = .failed(apiError)
            services.analytics.track(
                .errorShown(errorCode: apiError.code.wireValue, retryable: apiError.retryable)
            )
        }
    }

    func loadMore(services: AppServices) async {
        guard canLoadMore, let cursor = nextCursor, !activeQuery.isEmpty else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await services.api.searchProducts(
                query: activeQuery,
                cursor: cursor,
                limit: pageLimit
            )
            var combined = state.value ?? []
            combined.append(contentsOf: page.data)
            state = .loaded(combined)
            nextCursor = page.pageInfo.nextCursor
            hasMore = page.pageInfo.hasMore
        } catch {
            // A failed "load more" keeps the already-loaded page on screen.
            hasMore = false
        }
    }

    func retry(services: AppServices) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await search(trimmed, services: services)
    }
}

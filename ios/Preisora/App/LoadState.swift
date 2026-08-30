//
//  LoadState.swift
//  App — the one shape every screen's async data takes.
//
//  Having a single state enum is what makes "error states are rendered, with retry
//  only when `retryable`" a property of the app rather than of each screen.
//

import Foundation

enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

//
//  MockServices.swift
//  Services/Mocks — inert implementations for previews, tests and the
//  `AppServices` environment default.
//
//  None of these types is actor-isolated, so `AppServices.preview` can be a plain
//  static constant that any context (including an `EnvironmentKey.defaultValue`)
//  may construct.
//

import Foundation

/// Location that answers instantly with a fixed coordinate (Berlin Mitte).
final class MockLocationProvider: LocationProviding {

    private let fixedLocation: Location?
    let authorization: LocationAuthorization

    init(
        location: Location? = Location(coordinate: .berlinFallback, accuracy: 25),
        authorization: LocationAuthorization = .authorized
    ) {
        self.fixedLocation = location
        self.authorization = authorization
    }

    func requestAuthorization() {}

    func currentLocation() async -> Location? {
        fixedLocation
    }
}

/// Records the last directions request instead of leaving the app.
final class MockMapsService: MapsProviding {

    private(set) var lastDestinationName: String?

    @MainActor
    func openDirections(to coordinate: Coordinate, name: String) {
        lastDestinationName = name
    }
}

/// Never asks for permission, never registers, never posts a device.
final class MockPushRegistrar: PushRegistering {

    func requestAuthorization() async -> Bool { false }

    @MainActor
    func registerForRemoteNotifications() {}

    @discardableResult
    func submitDeviceToken(_ token: String) async throws -> Device {
        throw APIError(
            code: .featureNotAvailable,
            messageKey: "error.feature_not_available",
            details: nil,
            retryable: false,
            httpStatus: nil
        )
    }

    func enablePushDelivery() async {}
}

/// In-memory `SecureStoring`. Used by previews and unit tests — never in the app.
final class InMemorySecureStorage: SecureStoring {

    private var storage: [String: String] = [:]
    private let lock = NSLock()

    init(initialValues: [String: String] = [:]) {
        self.storage = initialValues
    }

    func string(forKey key: String) throws -> String? {
        lock.lock()
        defer { lock.unlock() }
        return storage[key]
    }

    func setString(_ value: String, forKey key: String) throws {
        lock.lock()
        defer { lock.unlock() }
        storage[key] = value
    }

    func removeValue(forKey key: String) throws {
        lock.lock()
        defer { lock.unlock() }
        storage.removeValue(forKey: key)
    }
}

/// Collects events in memory so tests can assert on the taxonomy.
final class RecordingAnalyticsTracker: AnalyticsTracking {

    private(set) var events: [AnalyticsEvent] = []
    private let lock = NSLock()

    func track(_ event: AnalyticsEvent) {
        lock.lock()
        events.append(event)
        lock.unlock()
    }

    var recordedNames: [String] {
        lock.lock()
        defer { lock.unlock() }
        return events.map { $0.name }
    }
}

/// Always fails, so components exercise their placeholder path.
final class MockImageLoader: ImageLoading {

    func imageData(for url: URL) async throws -> Data {
        throw APIError.malformedResponse(httpStatus: nil)
    }
}

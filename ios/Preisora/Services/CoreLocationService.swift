//
//  CoreLocationService.swift
//  Services — `LocationProviding` on CoreLocation.
//
//  CoreLocation types never leave this file: the output is the contract's generic
//  `Location` (constitution §8). Callers that get `nil` fall back to
//  `Coordinate.berlinFallback` so the demo journey still works with permission denied.
//
//  A five-second watchdog guarantees `currentLocation()` always returns: a one-shot
//  `requestLocation()` that never calls back (a common simulator state) must not
//  strand a screen in its loading state.
//

import Foundation
import CoreLocation

final class CoreLocationService: NSObject, LocationProviding, CLLocationManagerDelegate {

    private let manager: CLLocationManager
    private let lock = NSLock()
    private var pendingRequests: [LocationRequestBox] = []
    private let timeout: TimeInterval

    init(timeout: TimeInterval = 5.0) {
        self.manager = CLLocationManager()
        self.timeout = timeout
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    // MARK: - LocationProviding

    var authorization: LocationAuthorization {
        switch manager.authorizationStatus {
        case .notDetermined:
            return .notDetermined
        case .restricted:
            return .restricted
        case .denied:
            return .denied
        case .authorizedAlways, .authorizedWhenInUse:
            return .authorized
        @unknown default:
            return .notDetermined
        }
    }

    func requestAuthorization() {
        guard manager.authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }

    func currentLocation() async -> Location? {
        guard authorization.isUsable else { return nil }

        // Fast path: a recent fix is good enough for a 5 km radius query.
        if let cached = manager.location {
            return CoreLocationService.makeLocation(from: cached)
        }

        return await withCheckedContinuation { (continuation: CheckedContinuation<Location?, Never>) in
            let box = LocationRequestBox(continuation: continuation)
            lock.lock()
            pendingRequests.append(box)
            lock.unlock()

            // `currentLocation()` is nonisolated async, so it may resume on any
            // thread. The manager was created on the main run loop (that is where its
            // delegate callbacks arrive), so drive it from there too.
            DispatchQueue.main.async { [weak self] in
                self?.manager.requestLocation()
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                guard let self else {
                    box.finish(with: nil)
                    return
                }
                // Whatever CoreLocation managed to produce by now — often still nil.
                let fallback = self.manager.location.map(CoreLocationService.makeLocation(from:))
                self.drainPendingRequests(with: fallback)
            }
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last.map(CoreLocationService.makeLocation(from:))
        drainPendingRequests(with: location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        drainPendingRequests(with: nil)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // A denial must not leave a request hanging.
        if !authorization.isUsable {
            drainPendingRequests(with: nil)
        }
    }

    // MARK: - Private

    private func drainPendingRequests(with location: Location?) {
        lock.lock()
        let requests = pendingRequests
        pendingRequests.removeAll()
        lock.unlock()
        for request in requests {
            request.finish(with: location)
        }
    }

    /// The ONLY CoreLocation → Domain conversion in the app.
    private static func makeLocation(from location: CLLocation) -> Location {
        Location(
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        )
    }
}

/// Guarantees a continuation is resumed exactly once, whichever of delegate callback,
/// authorization change or watchdog gets there first.
private final class LocationRequestBox {
    private var continuation: CheckedContinuation<Location?, Never>?
    private let lock = NSLock()

    init(continuation: CheckedContinuation<Location?, Never>) {
        self.continuation = continuation
    }

    func finish(with location: Location?) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: location)
    }
}

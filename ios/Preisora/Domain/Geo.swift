//
//  Geo.swift
//  Domain — mirrors `GeoPoint.yaml` and `Location.yaml`.
//
//  PLATFORM-NEUTRAL ONLY: no CLLocationCoordinate2D, no MKMapItem, no Google LatLng
//  anywhere in Domain (constitution §8/§9). Conversions to MapKit/CoreLocation types
//  live in Services/ and Features/, never here.
//

import Foundation

/// App-internal WGS-84 coordinate. Not a wire type — the platform-neutral value the
/// UI and the service protocols pass around instead of a `CLLocationCoordinate2D`.
struct Coordinate: Hashable {
    let latitude: Double
    let longitude: Double

    init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    /// Fallback used when location permission is denied or unavailable
    /// (Berlin Mitte — matches the seeded demo stores).
    static let berlinFallback = Coordinate(latitude: 52.5219, longitude: 13.4132)

    var geoPoint: GeoPoint {
        GeoPoint(lat: latitude, lng: longitude)
    }
}

/// Contract: `GeoPoint` — a bare WGS-84 coordinate pair.
struct GeoPoint: Codable, Hashable {
    let lat: Double
    let lng: Double

    init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }

    var coordinate: Coordinate {
        Coordinate(latitude: lat, longitude: lng)
    }
}

/// Contract: `Location` — the generic geographic model of constitution §8 and the
/// platform-neutral output type of `LocationProviding`.
///
/// Required: `lat`, `lng`. Optional: `accuracy`, `postalCode`, `city`, `countryCode`.
struct Location: Codable, Hashable {
    let lat: Double
    let lng: Double
    /// Horizontal accuracy radius in meters, when the client knows it.
    let accuracy: Double?
    let postalCode: String?
    let city: String?
    let countryCode: String?

    init(
        lat: Double,
        lng: Double,
        accuracy: Double? = nil,
        postalCode: String? = nil,
        city: String? = nil,
        countryCode: String? = nil
    ) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
        self.postalCode = postalCode
        self.city = city
        self.countryCode = countryCode
    }

    init(coordinate: Coordinate, accuracy: Double? = nil) {
        self.init(lat: coordinate.latitude, lng: coordinate.longitude, accuracy: accuracy)
    }

    var coordinate: Coordinate {
        Coordinate(latitude: lat, longitude: lng)
    }
}

//
//  MapKitService.swift
//  Services — `MapsProviding` on MapKit.
//
//  Only the "hand off to the maps app" side of MapKit lives here. Map RENDERING is
//  SwiftUI's `Map` inside the StoresMap feature; either way no MapKit type ever
//  reaches Domain (constitution §9).
//

import Foundation
import MapKit

struct MapKitService: MapsProviding {

    @MainActor
    func openDirections(to coordinate: Coordinate, name: String) {
        let placemark = MKPlacemark(
            coordinate: CLLocationCoordinate2D(
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
        )
        let mapItem = MKMapItem(placemark: placemark)
        mapItem.name = name
        // `MKMapItem.openMaps(with:launchOptions:)` rather than the instance
        // `openInMaps(launchOptions:)`, which newer SDKs deprecate. Same behaviour:
        // hand the destination to the system maps app in driving-directions mode.
        _ = MKMapItem.openMaps(
            with: [mapItem],
            launchOptions: [
                MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
            ]
        )
    }
}

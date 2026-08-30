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
        mapItem.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
        ])
    }
}

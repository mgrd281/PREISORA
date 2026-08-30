//
//  StoresMapView.swift
//  Features/StoresMap — basic SwiftUI MapKit (Map + Marker + UserAnnotation).
//
//  MapKit types exist ONLY inside this view and `MapKitService`; the model layer
//  keeps `Store` / `Coordinate` (constitution §9).
//

import SwiftUI
import MapKit

@MainActor
struct StoresMapView: View {

    @Environment(\.services) private var services
    @State private var viewModel: StoresMapViewModel
    @State private var cameraPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: Coordinate.berlinFallback.latitude,
                longitude: Coordinate.berlinFallback.longitude
            ),
            span: MKCoordinateSpan(latitudeDelta: 0.06, longitudeDelta: 0.06)
        )
    )

    init(productId: String?) {
        _viewModel = State(initialValue: StoresMapViewModel(productId: productId))
    }

    var body: some View {
        VStack(spacing: 0) {
            Map(position: $cameraPosition) {
                UserAnnotation()
                ForEach(viewModel.stores) { store in
                    Marker(
                        store.name,
                        coordinate: CLLocationCoordinate2D(
                            latitude: store.lat,
                            longitude: store.lng
                        )
                    )
                    .tint(Tokens.Color.accentPrimary)
                }
            }
            .frame(height: 280)

            content
        }
        .background(Tokens.Color.backgroundPrimary)
        .navigationTitle(Text("stores.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadIfNeeded(services: services)
            recenterCamera()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.storesState {
        case .idle, .loading:
            LoadingView(messageKey: "stores.loading")
        case .failed(let error):
            ScrollView {
                ErrorStateView(error: error) {
                    Task {
                        await viewModel.load(services: services)
                        recenterCamera()
                    }
                }
                .padding(Tokens.Spacing.md)
            }
        case .loaded(let stores):
            if stores.isEmpty {
                EmptyStateView(
                    systemImage: "mappin.slash",
                    titleKey: "stores.empty.title",
                    messageKey: "stores.empty.message"
                )
            } else {
                List(stores) { store in
                    storeRow(store)
                        .listRowBackground(Tokens.Color.backgroundPrimary)
                }
                .listStyle(.plain)
            }
        }
    }

    private func storeRow(_ store: Store) -> some View {
        HStack(spacing: Tokens.Spacing.md) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(verbatim: store.name)
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Text(verbatim: store.address.singleLine)
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
                if let distanceMeters = store.distanceMeters {
                    Text(verbatim: DistanceFormatting.string(meters: distanceMeters))
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                }
            }

            Spacer(minLength: Tokens.Spacing.sm)

            Button {
                services.maps.openDirections(to: store.coordinate, name: store.name)
            } label: {
                Image(systemName: "arrow.triangle.turn.up.right.circle.fill")
                    .font(.title2)
            }
            .buttonStyle(.plain)
            .tint(Tokens.Color.accentPrimary)
            .accessibilityLabel(Text("stores.directions"))
        }
        .padding(.vertical, Tokens.Spacing.xs)
    }

    private func recenterCamera() {
        let center = viewModel.centerCoordinate
        cameraPosition = .region(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: center.latitude,
                    longitude: center.longitude
                ),
                span: MKCoordinateSpan(latitudeDelta: 0.06, longitudeDelta: 0.06)
            )
        )
    }
}

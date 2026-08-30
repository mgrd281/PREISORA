//
//  FavoritesView.swift
//  Features/Favorites
//

import SwiftUI

struct FavoritesView: View {

    @Environment(\.services) private var services
    @State private var viewModel = FavoritesViewModel()

    var body: some View {
        content
            .background(Tokens.Color.backgroundPrimary)
            .navigationTitle(Text("tab.favorites"))
            .task {
                await viewModel.load(services: services)
            }
            .refreshable {
                await viewModel.load(services: services)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(messageKey: "favorites.loading")
        case .failed(let error):
            ScrollView {
                ErrorStateView(error: error) {
                    Task { await viewModel.load(services: services) }
                }
                .padding(Tokens.Spacing.md)
            }
        case .loaded(let favorites):
            if favorites.isEmpty {
                EmptyStateView(
                    systemImage: "heart",
                    titleKey: "favorites.empty.title",
                    messageKey: "favorites.empty.message"
                )
            } else {
                List {
                    ForEach(favorites) { favorite in
                        NavigationLink(value: Route.product(.id(favorite.productId))) {
                            ProductSummaryRow(product: favorite.product)
                        }
                        .listRowBackground(Tokens.Color.backgroundPrimary)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task {
                                    await viewModel.remove(
                                        productId: favorite.productId,
                                        services: services
                                    )
                                }
                            } label: {
                                Label("action.remove", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
    }
}

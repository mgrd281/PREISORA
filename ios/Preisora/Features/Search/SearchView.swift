//
//  SearchView.swift
//  Features/Search
//

import SwiftUI

struct SearchView: View {

    @Environment(\.services) private var services
    @State private var viewModel = SearchViewModel()

    var body: some View {
        content
            .background(Tokens.Color.backgroundPrimary)
            .navigationTitle(Text("tab.search"))
            .searchable(
                text: $viewModel.query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("search.placeholder")
            )
            .task(id: viewModel.query) {
                await viewModel.runDebouncedSearch(services: services)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle:
            EmptyStateView(
                systemImage: "magnifyingglass",
                titleKey: "search.empty.title",
                messageKey: "search.empty.message"
            )
        case .loading:
            LoadingView(messageKey: "search.loading")
        case .failed(let error):
            ScrollView {
                ErrorStateView(error: error) {
                    Task { await viewModel.retry(services: services) }
                }
                .padding(Tokens.Spacing.md)
            }
        case .loaded(let products):
            if products.isEmpty {
                EmptyStateView(
                    systemImage: "questionmark.folder",
                    titleKey: "search.no_results.title",
                    messageKey: "search.no_results.message"
                )
            } else {
                List {
                    ForEach(products) { product in
                        NavigationLink(value: Route.product(.id(product.id))) {
                            ProductSummaryRow(product: product)
                        }
                        .listRowBackground(Tokens.Color.backgroundPrimary)
                    }

                    if viewModel.canLoadMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowBackground(Tokens.Color.backgroundPrimary)
                        .task {
                            await viewModel.loadMore(services: services)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
    }
}

/// Compact product row shared by Search and Favorites.
struct ProductSummaryRow: View {

    let product: Product

    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            RemoteImage(url: product.primaryImage?.imageURL)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.small, style: .continuous))

            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(product.name)
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
                if !product.subtitleText.isEmpty {
                    Text(product.subtitleText)
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Tokens.Spacing.xs)
    }
}

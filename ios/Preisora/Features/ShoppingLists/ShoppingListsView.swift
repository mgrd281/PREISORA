//
//  ShoppingListsView.swift
//  Features/ShoppingLists — TYPED EMPTY STATE (phase 1).
//
//  STUBBED UI, FINAL MODEL: `ShoppingList`, `ShoppingListItem` and
//  `OptimizationResult` are complete, and `/shopping-lists` is implemented backend
//  side. What is deferred is the optimizer UI (strategy picker, per-store route
//  rendering) — so this screen lists what exists and stops there.
//
//  Gated on `capabilities.shoppingOptimizer`.
//

import SwiftUI
import Observation

@MainActor
@Observable
final class ShoppingListsViewModel {

    private(set) var state: LoadState<[ShoppingList]> = .idle
    private(set) var capabilities: Capabilities = .allDisabled

    init() {}

    func load(services: AppServices) async {
        state = .loading
        capabilities = (try? await services.api.capabilities()) ?? .allDisabled

        do {
            let page = try await services.api.shoppingLists()
            state = .loaded(page.data)
        } catch {
            state = .failed(APIError.from(error))
        }
    }
}

struct ShoppingListsView: View {

    @Environment(\.services) private var services
    @State private var viewModel = ShoppingListsViewModel()

    var body: some View {
        content
            .background(Tokens.Color.backgroundPrimary)
            .navigationTitle(Text("tab.lists"))
            .task {
                await viewModel.load(services: services)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .failed(let error):
            ScrollView {
                ErrorStateView(error: error) {
                    Task { await viewModel.load(services: services) }
                }
                .padding(Tokens.Spacing.md)
            }
        case .loaded(let lists):
            if lists.isEmpty {
                EmptyStateView(
                    systemImage: "list.bullet.rectangle",
                    titleKey: "lists.empty.title",
                    messageKey: "lists.empty.message"
                )
            } else {
                List(lists) { list in
                    VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                        Text(list.name)
                            .font(Tokens.Typography.headline)
                            .foregroundStyle(Tokens.Color.textPrimary)
                        Text(L10n.string("lists.item_count", String(list.items.count)))
                            .font(Tokens.Typography.caption)
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }
                    .listRowBackground(Tokens.Color.backgroundPrimary)
                }
                .listStyle(.plain)
            }
        }
    }
}

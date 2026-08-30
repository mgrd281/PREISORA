//
//  StateViews.swift
//  DesignSystem — loading, empty and error states.
//
//  THE RETRY RULE (CONVENTIONS.md): a retry affordance is offered if and only if the
//  error envelope says `retryable: true`. Never on a 404, never on a validation
//  failure — retrying those cannot help and teaches the user to distrust the button.
//

import SwiftUI

/// Centered progress indicator with an optional token-styled caption.
struct LoadingView: View {

    let messageKey: String?

    init(messageKey: String? = nil) {
        self.messageKey = messageKey
    }

    var body: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            ProgressView()
            if let messageKey {
                Text(L10n.string(messageKey))
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Tokens.Spacing.lg)
    }
}

/// Neutral empty state: SF Symbol, title, optional body, optional action.
struct EmptyStateView: View {

    let systemImage: String
    let titleKey: String
    let messageKey: String?
    let actionTitleKey: String?
    let action: (() -> Void)?

    init(
        systemImage: String,
        titleKey: String,
        messageKey: String? = nil,
        actionTitleKey: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.systemImage = systemImage
        self.titleKey = titleKey
        self.messageKey = messageKey
        self.actionTitleKey = actionTitleKey
        self.action = action
    }

    var body: some View {
        VStack(spacing: Tokens.Spacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(Tokens.Color.textSecondary)

            Text(L10n.string(titleKey))
                .font(Tokens.Typography.title)
                .foregroundStyle(Tokens.Color.textPrimary)
                .multilineTextAlignment(.center)

            if let messageKey {
                Text(L10n.string(messageKey))
                    .font(Tokens.Typography.body)
                    .foregroundStyle(Tokens.Color.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if let actionTitleKey, let action {
                Button(action: action) {
                    Text(L10n.string(actionTitleKey))
                        .font(Tokens.Typography.headline)
                }
                .buttonStyle(.borderedProminent)
                .tint(Tokens.Color.accentPrimary)
            }
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity)
    }
}

/// Renders an `APIError` using its `messageKey` and shows "Retry" only when the
/// envelope marked the failure retryable.
struct ErrorStateView: View {

    let error: APIError
    let onRetry: (() -> Void)?

    init(error: APIError, onRetry: (() -> Void)? = nil) {
        self.error = error
        self.onRetry = onRetry
    }

    var body: some View {
        VStack(spacing: Tokens.Spacing.md) {
            Image(systemName: symbolName)
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Tokens.Color.error)

            Text(L10n.string(error.localizationKey))
                .font(Tokens.Typography.body)
                .foregroundStyle(Tokens.Color.textPrimary)
                .multilineTextAlignment(.center)

            if error.retryable, let onRetry {
                Button(action: onRetry) {
                    Text("action.retry")
                        .font(Tokens.Typography.headline)
                }
                .buttonStyle(.borderedProminent)
                .tint(Tokens.Color.accentPrimary)
            }
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity)
        .background(Tokens.Color.backgroundSecondary)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
    }

    private var symbolName: String {
        switch error.code {
        case .productNotFound, .resourceNotFound:
            return "magnifyingglass"
        case .noCurrentPrices:
            return "tag.slash"
        case .invalidGTIN:
            return "barcode.viewfinder"
        case .locationRequired:
            return "location.slash"
        case .rateLimited:
            return "hourglass"
        case .serviceTemporarilyUnavailable:
            return "antenna.radiowaves.left.and.right.slash"
        case .validationFailed:
            return "exclamationmark.triangle"
        case .featureNotAvailable:
            return "wrench.and.screwdriver"
        case .unauthorized:
            return "lock"
        case .unknown:
            return "exclamationmark.circle"
        }
    }
}

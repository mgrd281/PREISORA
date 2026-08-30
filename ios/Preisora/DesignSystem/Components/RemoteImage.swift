//
//  RemoteImage.swift
//  DesignSystem — product imagery through the `ImageLoading` abstraction.
//
//  `Product.images` is nullable in the contract (constitution §34 seam) and seed data
//  may leave it empty, so the placeholder path is the NORMAL path, not an error path.
//

import Foundation
import SwiftUI
import UIKit

struct RemoteImage: View {

    @Environment(\.services) private var services

    let url: URL?
    let placeholderSystemImage: String

    @State private var imageData: Data?

    init(url: URL?, placeholderSystemImage: String = "photo") {
        self.url = url
        self.placeholderSystemImage = placeholderSystemImage
    }

    var body: some View {
        ZStack {
            if let imageData, let uiImage = UIImage(data: imageData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
            } else {
                placeholder
            }
        }
        .task(id: url) {
            await load()
        }
    }

    private var placeholder: some View {
        ZStack {
            Tokens.Color.backgroundSecondary
            Image(systemName: placeholderSystemImage)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(Tokens.Color.textSecondary)
        }
    }

    private func load() async {
        guard let url else {
            imageData = nil
            return
        }
        do {
            imageData = try await services.images.imageData(for: url)
        } catch {
            // Placeholder is the normal fallback — imagery is optional by contract.
            imageData = nil
        }
    }
}

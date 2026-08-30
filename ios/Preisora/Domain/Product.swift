//
//  Product.swift
//  Domain — mirrors `Product.yaml` and `ImageAsset.yaml`.
//

import Foundation

/// Contract: `Product`.
///
/// Every property below is `required` in the schema; the optionals are the fields
/// the schema declares nullable (`brand`, `quantityText`, `images`).
struct Product: Codable, Hashable, Identifiable {
    /// Permanent canonical product UUID (deep link `https://preisora.de/product/{id}`).
    let id: String
    /// GTIN-8 / 12 / 13 / 14 — ALWAYS a string, leading zeros are significant.
    let gtin: String
    /// Canonical URL slug (`https://preisora.de/p/{slug}`).
    let slug: String
    let name: String
    /// `null` when unbranded/unknown.
    let brand: String?
    /// Human-readable pack size ("1 L", "250 g"); `null` when unknown.
    let quantityText: String?
    /// `null` when no imagery exists yet (constitution §34 seam).
    let images: [ImageAsset]?
    /// ISO-3166-1 alpha-2 country the catalog entry belongs to.
    let countryCode: String
    let createdAt: Date
    let updatedAt: Date

    init(
        id: String,
        gtin: String,
        slug: String,
        name: String,
        brand: String?,
        quantityText: String?,
        images: [ImageAsset]?,
        countryCode: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gtin = gtin
        self.slug = slug
        self.name = name
        self.brand = brand
        self.quantityText = quantityText
        self.images = images
        self.countryCode = countryCode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Best available rendition for a header image, or `nil`.
    var primaryImage: ImageAsset? {
        images?.first
    }

    /// "Marktfrisch · 1 L" style subtitle; empty when neither is known.
    var subtitleText: String {
        [brand, quantityText]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// Contract: `ImageAsset`.
struct ImageAsset: Codable, Hashable {
    /// Absolute URL of the image (`format: uri` on the wire — kept as `String` so a
    /// malformed URL degrades to "no image" instead of failing the whole decode).
    let url: String
    let widthPx: Int
    let heightPx: Int

    init(url: String, widthPx: Int, heightPx: Int) {
        self.url = url
        self.widthPx = widthPx
        self.heightPx = heightPx
    }

    var imageURL: URL? {
        URL(string: url)
    }
}

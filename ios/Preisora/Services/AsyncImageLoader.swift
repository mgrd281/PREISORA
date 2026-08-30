//
//  AsyncImageLoader.swift
//  Services — `ImageLoading` on URLSession with a small in-memory cache.
//
//  Product imagery is a §34 seam: `Product.images` may legitimately be `null` in seed
//  data, so every call site must render fine without an image. This loader therefore
//  fails quietly (throws) and the component falls back to a placeholder.
//

import Foundation

final class AsyncImageLoader: ImageLoading {

    private let urlSession: URLSession
    private let cache: NSCache<NSString, NSData>

    init(urlSession: URLSession = .shared, countLimit: Int = 120) {
        self.urlSession = urlSession
        self.cache = NSCache<NSString, NSData>()
        self.cache.countLimit = countLimit
    }

    func imageData(for url: URL) async throws -> Data {
        let key = url.absoluteString as NSString
        if let cached = cache.object(forKey: key) {
            return cached as Data
        }

        let (data, response) = try await fetch(url: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.malformedResponse(httpStatus: http.statusCode)
        }
        cache.setObject(data as NSData, forKey: key)
        return data
    }

    private func fetch(url: URL) async throws -> (Data, URLResponse) {
        do {
            return try await urlSession.data(from: url)
        } catch {
            throw APIError.transportFailure(underlying: error)
        }
    }
}

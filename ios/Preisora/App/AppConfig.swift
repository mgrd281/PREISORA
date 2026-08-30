//
//  AppConfig.swift
//  App — everything environment-dependent, resolved once at launch.
//
//  The backend base URL comes from the `PREISORA_API_BASE_URL` scheme environment
//  variable (set in ios/project.yml), falling back to the local docker-compose stack.
//  Nothing else in the app may read `ProcessInfo`.
//
//  NOTE ON DEFAULTS (§24): `de-DE` / `DE` appear here as CLIENT REQUEST CONTEXT only.
//  They are what the device reports, not business rules — the backend resolves the
//  authoritative country/currency/locale and every price carries its own currency.
//

import Foundation

struct AppConfig {

    /// Local `backend/` docker-compose stack.
    static let defaultBaseURLString = "http://localhost:3000/api/v1"

    /// Environment variable read from the Xcode scheme (or a real environment).
    static let baseURLEnvironmentKey = "PREISORA_API_BASE_URL"

    let apiBaseURL: URL
    let appVersion: String
    let buildNumber: String
    /// `Accept-Language` header value.
    let acceptLanguage: String
    /// BCP-47 identifier reported to `/devices` and analytics (`de-DE`).
    let deviceLocaleIdentifier: String
    /// ISO-3166-1 alpha-2 of the device region, for analytics context.
    let countryCode: String

    init(
        apiBaseURL: URL,
        appVersion: String,
        buildNumber: String,
        acceptLanguage: String,
        deviceLocaleIdentifier: String,
        countryCode: String
    ) {
        self.apiBaseURL = apiBaseURL
        self.appVersion = appVersion
        self.buildNumber = buildNumber
        self.acceptLanguage = acceptLanguage
        self.deviceLocaleIdentifier = deviceLocaleIdentifier
        self.countryCode = countryCode
    }

    /// Builds the launch configuration from the process environment and bundle.
    static func resolve(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundle: Bundle = .main,
        locale: Locale = .current
    ) -> AppConfig {
        let raw = environment[baseURLEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let candidate = raw.isEmpty ? defaultBaseURLString : raw
        let normalized = candidate.hasSuffix("/") ? String(candidate.dropLast()) : candidate
        // The fallback literal is a compile-time-valid URL, so this cannot be nil.
        let url = URL(string: normalized) ?? URL(string: defaultBaseURLString)!

        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        return AppConfig(
            apiBaseURL: url,
            appVersion: version ?? "1.0.0",
            buildNumber: build ?? "1",
            acceptLanguage: AppConfig.acceptLanguageHeader(),
            deviceLocaleIdentifier: AppConfig.bcp47Identifier(for: locale),
            countryCode: locale.region?.identifier ?? "DE"
        )
    }

    /// `Accept-Language` from the user's preferred languages, highest first.
    /// Locale precedence server-side is `?locale > user profile > Accept-Language > de-DE`.
    private static func acceptLanguageHeader(
        preferred: [String] = Locale.preferredLanguages
    ) -> String {
        let languages = preferred.prefix(3)
        guard !languages.isEmpty else { return "de-DE" }
        var parts: [String] = []
        for (index, language) in languages.enumerated() {
            if index == 0 {
                parts.append(language)
            } else {
                let quality = max(0.1, 1.0 - (Double(index) * 0.1))
                parts.append(String(format: "%@;q=%.1f", language, quality))
            }
        }
        return parts.joined(separator: ", ")
    }

    /// `de-DE` style identifier (the contract's `^[a-z]{2}(-[A-Z]{2})?$`).
    private static func bcp47Identifier(for locale: Locale) -> String {
        let language = locale.language.languageCode?.identifier ?? "de"
        if let region = locale.region?.identifier {
            return "\(language)-\(region)"
        }
        return language
    }

    /// Used by Settings to show where the app is pointed without exposing secrets.
    var displayBaseURL: String {
        apiBaseURL.absoluteString
    }
}

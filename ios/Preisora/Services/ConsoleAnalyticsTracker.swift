//
//  ConsoleAnalyticsTracker.swift
//  Services — `AnalyticsTracking` on os.Logger (console sink only, phase 1).
//
//  THE COMMON PROPERTIES ARE ATTACHED HERE, CENTRALLY:
//      platform · app_version · locale · country_code
//  Call sites pass event-specific properties only — that is what keeps the taxonomy
//  identical across iOS, Android and web (docs/analytics-taxonomy.md, §18).
//
//  Swapping in a real sink means replacing this type; no call site changes.
//

import Foundation
import os

final class ConsoleAnalyticsTracker: AnalyticsTracking {

    private let logger = Logger(subsystem: "de.preisora.app", category: "Analytics")
    private let commonProperties: [String: AnalyticsPropertyValue]

    init(config: AppConfig) {
        self.commonProperties = [
            // Platform is a PROPERTY, never part of the event name (§18).
            "platform": .string("ios"),
            "app_version": .string(config.appVersion),
            "locale": .string(config.deviceLocaleIdentifier),
            "country_code": .string(config.countryCode)
        ]
    }

    func track(_ event: AnalyticsEvent) {
        var properties = commonProperties
        for (key, value) in event.properties {
            properties[key] = value
        }
        let rendered = properties
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value.loggableDescription)" }
            .joined(separator: " ")
        logger.info("[analytics] \(event.name, privacy: .public) \(rendered, privacy: .public)")
    }
}

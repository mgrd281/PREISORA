//
//  ScanViewModel.swift
//  Features/Scan
//
//  THE CHECKSUM CHECK HERE IS UX ONLY. `GTINValidator` stops obvious mis-reads from
//  becoming a round trip and gives the manual field inline feedback — but the server
//  validates every GTIN again and its 400 `INVALID_GTIN` always wins (§7, §22).
//
//  Manual entry is available on EVERY build, camera or not: it is the fallback that
//  makes the scan journey demonstrable in the Simulator.
//

import Foundation
import Observation

@MainActor
@Observable
final class ScanViewModel {

    /// Text of the manual GTIN field.
    var manualEntry: String = ""
    /// Localization key of the inline validation hint, or `nil`.
    private(set) var validationMessageKey: String?
    /// Set once a payload has been accepted, so a continuously-scanning camera does
    /// not fire the same GTIN repeatedly.
    private(set) var acceptedGTIN: String?

    init() {}

    var isManualEntryValid: Bool {
        GTINValidator.normalizedIfValid(manualEntry) != nil
    }

    /// Called for every payload the platform scanner recognizes.
    /// Returns the normalized GTIN when it passes the pre-flight, else `nil`.
    @discardableResult
    func handleScannedPayload(_ payload: String, services: AppServices) -> String? {
        guard acceptedGTIN == nil else { return nil }
        guard let gtin = GTINValidator.normalizedIfValid(payload) else {
            validationMessageKey = "scan.invalid_gtin"
            return nil
        }
        accept(gtin, services: services)
        return gtin
    }

    /// Called when the user submits the manual field.
    @discardableResult
    func submitManualEntry(services: AppServices) -> String? {
        guard let gtin = GTINValidator.normalizedIfValid(manualEntry) else {
            validationMessageKey = "scan.invalid_gtin"
            return nil
        }
        accept(gtin, services: services)
        return gtin
    }

    func trackOpened(services: AppServices) {
        let mode: ScanInputMode = services.scanner.isLiveScanningAvailable ? .camera : .manual
        services.analytics.track(.scanStarted(inputMode: mode))
    }

    func reset() {
        acceptedGTIN = nil
        validationMessageKey = nil
        manualEntry = ""
    }

    private func accept(_ gtin: String, services: AppServices) {
        validationMessageKey = nil
        acceptedGTIN = gtin
        services.analytics.track(.barcodeDetected(gtin: gtin))
    }
}

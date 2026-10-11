import Foundation
import CoreLocation

public enum TrackingMode: Sendable, Equatable {
    /// Not tracking.
    case off
    /// Online but idle: coarse, battery-friendly. Enough for dispatch to know roughly where we are.
    case idle
    /// On an active delivery: best accuracy, continuous, keeps running in the background.
    case activeDelivery
}

/// Battery-aware wrapper around CLLocationManager.
/// - `.idle` uses significant-change updates (cell/Wi-Fi, wakes the app, very low power)
/// - `.activeDelivery` uses continuous high-accuracy updates with a 10m distance filter, and the
///   background location indicator so the user always knows
/// Info.plist needs NSLocationWhenInUse/AlwaysAndWhenInUse usage strings and UIBackgroundModes=location.
@MainActor
public final class LocationTracker: NSObject, CLLocationManagerDelegate {
    public var onSample: (@MainActor (CLLocation) -> Void)?
    public private(set) var mode: TrackingMode = .off
    public private(set) var authorization: CLAuthorizationStatus = .notDetermined

    private let manager = CLLocationManager()

    public override init() {
        super.init()
        manager.delegate = self
        authorization = manager.authorizationStatus
    }

    public func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    public func setMode(_ newMode: TrackingMode) {
        guard newMode != mode else { return }
        stopAll()
        mode = newMode
        switch newMode {
        case .off:
            break
        case .idle:
            manager.desiredAccuracy = kCLLocationAccuracyKilometer
            #if os(iOS)
            manager.allowsBackgroundLocationUpdates = true
            manager.pausesLocationUpdatesAutomatically = true
            manager.startMonitoringSignificantLocationChanges()
            #else
            manager.startUpdatingLocation()
            #endif
        case .activeDelivery:
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = 10
            #if os(iOS)
            manager.activityType = .automotiveNavigation
            manager.allowsBackgroundLocationUpdates = true
            manager.pausesLocationUpdatesAutomatically = false
            manager.showsBackgroundLocationIndicator = true
            #endif
            manager.startUpdatingLocation()
        }
    }

    private func stopAll() {
        manager.stopUpdatingLocation()
        #if os(iOS)
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        manager.showsBackgroundLocationIndicator = false
        #endif
    }

    // MARK: CLLocationManagerDelegate (called on the main thread because the manager was created there)

    nonisolated public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            for location in locations where location.horizontalAccuracy >= 0 { self.onSample?(location) }
        }
    }

    nonisolated public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorization = status }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown is transient: Core Location keeps trying. Nothing to do.
    }
}

import Foundation

/// TBI (driver app): CLLocationManager wrapper.
///  - background location mode, allowsBackgroundLocationUpdates, pausesLocationUpdatesAutomatically
///  - adaptive accuracy (high while on an active delivery, significant-change otherwise)
///  - throttle + dedup before sending; buffer to disk while offline, replay in order with `seq`
///  - explain the battery trade-offs in an ADR
public struct LocationSample: Sendable, Codable, Equatable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double
    public let speed: Double?
    public let recordedAt: Date
    public let seq: Int

    public init(lat: Double, lng: Double, accuracy: Double, speed: Double?, recordedAt: Date, seq: Int) {
        self.lat = lat; self.lng = lng; self.accuracy = accuracy
        self.speed = speed; self.recordedAt = recordedAt; self.seq = seq
    }
}

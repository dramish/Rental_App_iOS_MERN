import Foundation
import Networking

/// Pure, disk-backed FIFO of unsent samples. Survives app kills, so a driver in a tunnel loses nothing.
/// Bounded: when full, the OLDEST samples are dropped (fresh position matters more than old breadcrumbs).
public struct SampleBuffer: Codable, Sendable, Equatable {
    public private(set) var samples: [LocationSample] = []
    public let capacity: Int

    public init(capacity: Int = 500) { self.capacity = capacity }

    public mutating func append(_ sample: LocationSample) {
        samples.append(sample)
        if samples.count > capacity { samples.removeFirst(samples.count - capacity) }
    }

    /// Next batch, in seq order, without removing it (remove only after the server accepted it).
    public func batch(max: Int) -> [LocationSample] {
        Array(samples.sorted { $0.seq < $1.seq }.prefix(max))
    }

    public mutating func remove(upToSeq seq: Int) {
        samples.removeAll { $0.seq <= seq }
    }

    public var isEmpty: Bool { samples.isEmpty }
}

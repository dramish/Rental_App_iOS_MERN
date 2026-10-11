import Foundation

/// Exponential backoff with FULL jitter: delay = random(0 ... min(cap, base * 2^attempt)).
/// Jitter spreads reconnects so thousands of clients dropped by one server restart don't stampede it.
public struct Backoff: Sendable {
    public let base: TimeInterval
    public let cap: TimeInterval
    public init(base: TimeInterval = 0.5, cap: TimeInterval = 30) { self.base = base; self.cap = cap }

    public func ceiling(attempt: Int) -> TimeInterval {
        min(cap, base * pow(2, Double(max(0, min(attempt, 30)))))
    }

    public func delay(attempt: Int, random: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }) -> TimeInterval {
        random(0...ceiling(attempt: attempt))
    }
}

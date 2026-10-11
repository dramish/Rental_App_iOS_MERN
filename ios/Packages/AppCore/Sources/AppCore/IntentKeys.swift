import Foundation

/// Idempotency keys must be generated ONCE per user intent and reused on every retry of that intent.
/// A fresh key per attempt would defeat the point (a retry after a dropped response would act twice).
/// Call `key(for:)` to get (or create) the key, and `clear(_:)` once the server has given a definitive answer.
public final class IntentKeys: @unchecked Sendable {
    private var keys: [String: String] = [:]
    private let lock = NSLock()
    public init() {}

    public func key(for intent: String) -> String {
        lock.lock(); defer { lock.unlock() }
        if let existing = keys[intent] { return existing }
        let new = UUID().uuidString
        keys[intent] = new
        return new
    }

    public func clear(_ intent: String) {
        lock.lock(); defer { lock.unlock() }
        keys[intent] = nil
    }
}

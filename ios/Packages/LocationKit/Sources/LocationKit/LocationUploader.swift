import Foundation
import Networking

/// Buffers samples and uploads them in ordered batches.
/// - `seq` is monotonic across launches (persisted), which is what lets the server drop replays.
/// - On failure the batch stays buffered and the next flush retries (the server is idempotent per seq).
public actor LocationUploader {
    public typealias Send = @Sendable ([LocationSample]) async throws -> Void

    private var buffer: SampleBuffer
    private let fileURL: URL
    private let defaults: UserDefaults
    private let send: Send
    private let batchSize: Int
    private var flushing = false

    public init(fileURL: URL, defaults: UserDefaults = .standard, batchSize: Int = 50, send: @escaping Send) {
        self.fileURL = fileURL
        self.defaults = defaults
        self.send = send
        self.batchSize = batchSize
        if let data = try? Data(contentsOf: fileURL), let saved = try? JSONDecoder().decode(SampleBuffer.self, from: data) {
            buffer = saved
        } else {
            buffer = SampleBuffer()
        }
    }

    public func nextSeq() -> Int {
        let next = defaults.integer(forKey: "lend.location.seq") + 1
        defaults.set(next, forKey: "lend.location.seq")
        return next
    }

    public var pendingCount: Int { buffer.samples.count }

    public func enqueue(lat: Double, lng: Double, accuracy: Double, speed: Double?, at date: Date) async {
        let sample = LocationSample(lat: lat, lng: lng, accuracy: accuracy, speed: speed, recordedAt: date, seq: nextSeq())
        buffer.append(sample)
        persist()
        await flush()
    }

    /// Sends everything buffered, batch by batch. Stops at the first failure (still offline) and keeps the rest.
    public func flush() async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        while !buffer.isEmpty {
            let batch = buffer.batch(max: batchSize)
            guard let last = batch.last else { return }
            do {
                try await send(batch)
                buffer.remove(upToSeq: last.seq)
                persist()
            } catch {
                return
            }
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(buffer) { try? data.write(to: fileURL, options: .atomic) }
    }
}

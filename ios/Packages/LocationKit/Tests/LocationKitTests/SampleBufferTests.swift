import XCTest
@testable import LocationKit
import Networking

final class SampleBufferTests: XCTestCase {
    private func s(_ seq: Int) -> LocationSample {
        LocationSample(lat: 28.6, lng: 77.2, accuracy: 5, speed: nil, recordedAt: Date(timeIntervalSince1970: Double(seq)), seq: seq)
    }

    func testBatchIsOrderedBySeqAndNotRemoved() {
        var b = SampleBuffer()
        [3, 1, 2].forEach { b.append(s($0)) }
        XCTAssertEqual(b.batch(max: 2).map(\.seq), [1, 2])
        XCTAssertEqual(b.samples.count, 3)
    }

    func testRemoveUpToSeqKeepsLaterSamples() {
        var b = SampleBuffer()
        (1...5).forEach { b.append(s($0)) }
        b.remove(upToSeq: 3)
        XCTAssertEqual(b.samples.map(\.seq), [4, 5])
    }

    func testCapacityDropsOldestFirst() {
        var b = SampleBuffer(capacity: 3)
        (1...6).forEach { b.append(s($0)) }
        XCTAssertEqual(b.samples.map(\.seq), [4, 5, 6])
    }

    func testUploaderKeepsSamplesWhenOfflineAndDrainsInOrderWhenBack() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("buf-\(UUID().uuidString).json")
        let defaults = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let online = Flag(false)
        let sent = Box()
        let uploader = LocationUploader(fileURL: url, defaults: defaults, batchSize: 2) { batch in
            guard online.value else { throw URLError(.notConnectedToInternet) }
            await sent.add(batch.map(\.seq))
        }

        for i in 0..<5 { await uploader.enqueue(lat: 28.6, lng: 77.2 + Double(i), accuracy: 5, speed: nil, at: Date()) }
        let pendingOffline = await uploader.pendingCount
        XCTAssertEqual(pendingOffline, 5)

        online.value = true
        await uploader.flush()
        let pendingOnline = await uploader.pendingCount
        XCTAssertEqual(pendingOnline, 0)
        let all = await sent.all
        XCTAssertEqual(all, [1, 2, 3, 4, 5]) // in order, none lost
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var v: Bool
    init(_ v: Bool) { self.v = v }
    var value: Bool { get { lock.lock(); defer { lock.unlock() }; return v } set { lock.lock(); v = newValue; lock.unlock() } }
}

actor Box {
    private(set) var all: [Int] = []
    func add(_ xs: [Int]) { all.append(contentsOf: xs) }
}

import XCTest
@testable import Realtime

final class BackoffTests: XCTestCase {
    func testCeilingDoublesThenCaps() {
        let b = Backoff(base: 0.5, cap: 30)
        XCTAssertEqual(b.ceiling(attempt: 0), 0.5)
        XCTAssertEqual(b.ceiling(attempt: 1), 1)
        XCTAssertEqual(b.ceiling(attempt: 3), 4)
        XCTAssertEqual(b.ceiling(attempt: 10), 30)
        XCTAssertEqual(b.ceiling(attempt: 500), 30) // no overflow for huge attempt counts
    }

    func testJitterStaysWithinZeroAndCeiling() {
        let b = Backoff(base: 1, cap: 8)
        XCTAssertEqual(b.delay(attempt: 2, random: { $0.lowerBound }), 0)
        XCTAssertEqual(b.delay(attempt: 2, random: { $0.upperBound }), 4)
        for attempt in 0..<20 {
            let d = b.delay(attempt: attempt)
            XCTAssertTrue((0...8).contains(d))
        }
    }

    func testParsesServerFrames() {
        let frame = RealtimeClient.parse(#"{"type":"event","room":"order:1","event":"order.updated","data":{"status":"CONFIRMED","version":2}}"#)
        XCTAssertEqual(frame?["room"] as? String, "order:1")
        XCTAssertNil(RealtimeClient.parse("not json"))
    }
}

import XCTest
@testable import AppCore

final class AppCoreTests: XCTestCase {
    func testIntentKeyIsStableUntilCleared() {
        let keys = IntentKeys()
        let a = keys.key(for: "place-order")
        XCTAssertEqual(a, keys.key(for: "place-order")) // a retry reuses the key
        XCTAssertNotEqual(a, keys.key(for: "cancel-order"))
        keys.clear("place-order")
        XCTAssertNotEqual(a, keys.key(for: "place-order")) // a new intent gets a new key
    }

    func testDayStringUsesTheCalendarDayTheUserSees() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Kolkata")!
        let lateEvening = cal.date(from: DateComponents(year: 2030, month: 3, day: 1, hour: 23, minute: 30))!
        XCTAssertEqual(DayString.from(lateEvening, calendar: cal), "2030-03-01") // UTC would say 03-01 too, but 00:30 IST would differ
        let earlyMorning = cal.date(from: DateComponents(year: 2030, month: 3, day: 2, hour: 0, minute: 30))!
        XCTAssertEqual(DayString.from(earlyMorning, calendar: cal), "2030-03-02") // in UTC this instant is still March 1
    }

    func testParsesServerTimestampsWithAndWithoutFractions() {
        XCTAssertNotNil(ISODate.parse("2030-01-01T10:00:00.123Z"))
        XCTAssertNotNil(ISODate.parse("2030-01-01T10:00:00Z"))
        XCTAssertNil(ISODate.parse("nope"))
    }
}

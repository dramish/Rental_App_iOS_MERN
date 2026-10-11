#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// Shared by the app (starts the activity) and the widget extension (renders it).
/// ContentState must match the `content-state` the backend pushes (see notifier.ts):
/// { status, etaMinutes (nullable), version }.
public struct OrderActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var status: String
        public var etaMinutes: Int?
        public var version: Int
        public init(status: String, etaMinutes: Int?, version: Int) {
            self.status = status; self.etaMinutes = etaMinutes; self.version = version
        }
    }
    public var orderId: String
    public var title: String
    public init(orderId: String, title: String) { self.orderId = orderId; self.title = title }
}
#endif

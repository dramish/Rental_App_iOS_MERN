import Foundation
import Networking

#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import LiveActivityShared

/// Starts, updates and ends the order's Live Activity.
/// While the app is open we update it locally; when it is closed the backend pushes updates to the
/// activity's push token (registered here), so the lock screen and Dynamic Island keep moving.
@MainActor
enum LiveActivityController {
    static func sync(order: Order, etaMinutes: Int?, api: LendAPI) async {
        let state = OrderActivityAttributes.ContentState(status: order.status.rawValue, etaMinutes: etaMinutes, version: order.version)
        let existing = Activity<OrderActivityAttributes>.activities.first { $0.attributes.orderId == order.id }

        if order.status.isTerminal || order.status == .delivered {
            await existing?.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(.now + 3600))
            return
        }
        // Only show it while something is happening on the way to the customer.
        guard order.status == .outForDelivery || order.status == .confirmed || order.status == .returnScheduled else { return }

        if let existing {
            await existing.update(ActivityContent(state: state, staleDate: nil))
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = OrderActivityAttributes(orderId: order.id, title: order.items.first?.title ?? "Your rental")
        guard let activity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: .token) else { return }
        Task {
            for await tokenData in activity.pushTokenUpdates {
                let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                try? await api.registerLiveActivity(orderId: order.id, pushToken: hex)
            }
        }
    }
}
#else
@MainActor
enum LiveActivityController {
    static func sync(order: Order, etaMinutes: Int?, api: LendAPI) async {}
}
#endif

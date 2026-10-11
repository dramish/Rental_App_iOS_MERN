import ActivityKit
import SwiftUI
import WidgetKit
import LiveActivityShared

@main
struct LendWidgets: WidgetBundle {
    var body: some Widget { OrderLiveActivity() }
}

struct OrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrderActivityAttributes.self) { context in
            // Lock screen / banner
            VStack(alignment: .leading, spacing: 6) {
                Text(context.attributes.title).font(.headline)
                Text(label(context.state.status)).font(.subheadline)
                if let eta = context.state.etaMinutes {
                    Label("About \(eta) min away", systemImage: "clock").font(.footnote)
                }
            }
            .padding()
            .activityBackgroundTint(.black.opacity(0.7))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "shippingbox.fill") }
                DynamicIslandExpandedRegion(.trailing) {
                    if let eta = context.state.etaMinutes { Text("\(eta) min").font(.title3.bold()) }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("\(context.attributes.title): \(label(context.state.status))")
                }
            } compactLeading: {
                Image(systemName: "shippingbox.fill")
            } compactTrailing: {
                Text(context.state.etaMinutes.map { "\($0)m" } ?? "")
            } minimal: {
                Image(systemName: "shippingbox.fill")
            }
        }
    }

    private func label(_ status: String) -> String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

import SwiftUI
import MapKit
import AppCore
import Networking
import DesignSystem

public struct DriverRootView: View {
    private let session: Session
    @State private var model: DriverViewModel

    public init(session: Session) {
        self.session = session
        _model = State(initialValue: DriverViewModel(session: session))
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("Online", isOn: Binding(get: { model.online }, set: { on in Task { await model.setOnline(on) } }))
                        .accessibilityHint("Go online to receive delivery requests")
                    if model.online && model.pendingUploads > 0 {
                        Label("\(model.pendingUploads) location updates waiting to upload", systemImage: "icloud.and.arrow.up")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    #if os(iOS)
                    if model.online && (model.authorization == .denied || model.authorization == .restricted) {
                        ErrorBanner("Location access is off. Enable it in Settings to receive jobs.")
                    }
                    #endif
                }
                if let error = model.error { Section { ErrorBanner(error) } }

                Section("Offers") {
                    let offers = model.tasks.filter { $0.status == .offered }
                    if offers.isEmpty { Text(model.online ? "Waiting for requests…" : "Go online to get requests").foregroundStyle(.secondary) }
                    ForEach(offers) { task in OfferRow(task: task, model: model) }
                }

                Section("Active jobs") {
                    let active = model.tasks.filter { $0.status == .assigned }
                    if active.isEmpty { Text("No active jobs").foregroundStyle(.secondary) }
                    ForEach(active) { task in ActiveJobRow(task: task, model: model) }
                }

                Section { Button("Sign out", role: .destructive) { Task { await model.setOnline(false); await session.signOut() } } }
            }
            .navigationTitle("Driver")
            .refreshable { await model.refresh() }
            .task { await model.run() }
        }
    }
}

private struct OfferRow: View {
    let task: DeliveryTask
    let model: DriverViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Text(task.leg == .delivery ? "Delivery" : "Return pickup").font(.headline)
                Spacer()
                if let expires = task.offerExpiresAt.flatMap(ISODate.parse) {
                    Text(expires, style: .timer).monospacedDigit().foregroundStyle(.orange)
                        .accessibilityLabel("Offer expires soon")
                }
            }
            RouteMap(pickup: task.pickup, dropoff: task.dropoff).frame(height: 140)
            HStack {
                Button("Decline", role: .destructive) { Task { await model.decline(task) } }
                Spacer()
                Button("Accept") { Task { await model.accept(task) } }.buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

private struct ActiveJobRow: View {
    let task: DeliveryTask
    let model: DriverViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Text(task.leg == .delivery ? "Delivery" : "Return pickup").font(.headline)
                Spacer()
                if let order = model.orders[task.orderId] { StatusBadge(order.status.title) }
            }
            RouteMap(pickup: task.pickup, dropoff: task.dropoff).frame(height: 140)
            if let action = model.action(for: task) {
                Button(action.title) { Task { await model.perform(action, task: task) } }
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

private struct RouteMap: View {
    let pickup: GeoJSONPoint
    let dropoff: GeoJSONPoint

    var body: some View {
        Map {
            Marker("Pickup", systemImage: "shippingbox.fill", coordinate: CLLocationCoordinate2D(latitude: pickup.lat, longitude: pickup.lng)).tint(.orange)
            Marker("Dropoff", systemImage: "mappin", coordinate: CLLocationCoordinate2D(latitude: dropoff.lat, longitude: dropoff.lng)).tint(.blue)
        }
        .accessibilityLabel("Map with pickup and dropoff points")
    }
}

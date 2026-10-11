import SwiftUI
import MapKit
import AppCore
import Networking
import Realtime
import Persistence
import DesignSystem

// MARK: - Orders list

@MainActor
@Observable
final class OrdersViewModel {
    var orders: [Order] = []
    var error: String?
    private let session: Session
    private var cursor: String?
    private var reachedEnd = false
    private var loading = false

    init(session: Session) { self.session = session }

    func reload() async {
        cursor = nil; reachedEnd = false
        await load(reset: true)
    }

    func loadMoreIfNeeded(current: Order) async {
        guard current.id == orders.last?.id else { return }
        await load(reset: false)
    }

    private func load(reset: Bool) async {
        guard !loading, reset || !reachedEnd else { return }
        loading = true; defer { loading = false }
        do {
            let page = try await session.api.orders(cursor: reset ? nil : cursor)
            orders = reset ? page.items : orders + page.items
            cursor = page.nextCursor
            reachedEnd = page.nextCursor == nil
            error = nil
        } catch {
            self.error = "Could not load orders."
        }
    }

    /// The user room delivers `order.updated` for every order of mine: refresh the list when one changes.
    func listen() async {
        let events = await session.realtime.events()
        for await event in events where event.name == "order.updated" { await reload() }
    }
}

struct OrdersView: View {
    let session: Session
    @State private var model: OrdersViewModel

    init(session: Session) {
        self.session = session
        _model = State(initialValue: OrdersViewModel(session: session))
    }

    var body: some View {
        List {
            if let error = model.error { ErrorBanner(error) }
            ForEach(model.orders) { order in
                NavigationLink(value: order) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            Text(order.items.first?.title ?? "Order").font(.headline)
                            Spacer()
                            StatusBadge(order.status.title, tint: order.status.isTerminal ? .gray : .accentColor)
                        }
                        Text("\(order.rentalStart) to \(order.rentalEnd) · \(Money.format(minor: order.totalMinor, currency: order.currency))")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                .task { await model.loadMoreIfNeeded(current: order) }
            }
            if model.orders.isEmpty && model.error == nil { Text("No orders yet.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Orders")
        .refreshable { await model.reload() }
        .task { await model.reload() }
        .task { await model.listen() }
        .navigationDestination(for: Order.self) { OrderDetailView(session: session, order: $0) }
    }
}

// MARK: - Order detail with live tracking

@MainActor
@Observable
final class OrderDetailViewModel {
    var order: Order
    var driver: DriverLocation?
    var connection: ConnectionState = .disconnected
    var error: String?

    private let session: Session
    private let keys = IntentKeys()
    private var room: String { "order:\(order.id)" }

    init(session: Session, order: Order) {
        self.session = session
        self.order = order
    }

    /// Everything the screen needs, in one place: load truth over REST, then keep it fresh from the socket.
    func run() async {
        await refresh()
        await session.realtime.subscribe(room)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.eventLoop() }
            group.addTask { await self.stateLoop() }
        }
    }

    func stop() async { await session.realtime.unsubscribe(room) }

    func refresh() async {
        do {
            async let latest = session.api.order(id: order.id)
            async let tracking = session.api.tracking(orderId: order.id)
            order = try await latest
            let t = try await tracking
            if let loc = t.driverLocation, loc.seq >= (driver?.seq ?? -1) { driver = loc }
            error = nil
            await LiveActivityController.sync(order: order, etaMinutes: driver?.etaMinutes, api: session.api)
        } catch {
            self.error = "Could not refresh. Pull to retry."
        }
    }

    private func eventLoop() async {
        let events = await session.realtime.events()
        for await event in events where event.room == room {
            switch event.name {
            case "order.updated":
                // The event is a hint with a version. If it is newer than what we hold, fetch the truth.
                if let e = event.decode(OrderUpdatedEvent.self), e.version > order.version { await refresh() }
            case "driver.location":
                if let e = event.decode(DriverLocationEvent.self), e.seq > (driver?.seq ?? -1) {
                    driver = DriverLocation(lat: e.lat, lng: e.lng, recordedAt: "", seq: e.seq, etaMinutes: e.etaMinutes)
                }
            case "order.driver_assigned":
                await refresh()
            default:
                break
            }
        }
    }

    private func stateLoop() async {
        var wasConnected = false
        let states = await session.realtime.states()
        for await state in states {
            connection = state
            // Reconnected after a gap: we may have missed events, so resync over REST.
            if state == .connected, wasConnected == false { await refresh() }
            wasConnected = (state == .connected)
        }
    }

    // MARK: Actions

    var canCancel: Bool { order.status == .pendingPayment || order.status == .confirmed }
    var canRequestReturn: Bool { order.status == .inUse || order.status == .overdue }

    func cancel() async { await send("CUSTOMER_CANCEL") }
    func requestReturn() async { await send("REQUEST_RETURN") }

    private func send(_ event: String) async {
        let intent = "\(order.id):\(event)"
        do {
            order = try await session.api.sendEvent(orderId: order.id, event: event, idempotencyKey: keys.key(for: intent))
            keys.clear(intent)
        } catch let APIError.server(status, _, message) where status < 500 {
            keys.clear(intent)
            error = message ?? "Action not allowed."
        } catch {
            self.error = "Network problem. Tap again to retry safely." // key kept: the retry cannot act twice
        }
    }
}

struct OrderDetailView: View {
    @State private var model: OrderDetailViewModel

    init(session: Session, order: Order) {
        _model = State(initialValue: OrderDetailViewModel(session: session, order: order))
    }

    var body: some View {
        let order = model.order
        List {
            Section {
                HStack {
                    Text(order.items.first?.title ?? "Order").font(.headline)
                    Spacer()
                    StatusBadge(order.status.title)
                }
                LabeledContent("Dates", value: "\(order.rentalStart) to \(order.rentalEnd)")
                LabeledContent("Total hold", value: Money.format(minor: order.totalMinor, currency: order.currency))
                if model.connection != .connected {
                    Label("Reconnecting for live updates…", systemImage: "antenna.radiowaves.left.and.right.slash").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let error = model.error { Section { ErrorBanner(error) } }

            if showMap {
                Section("Live tracking") {
                    TrackingMap(order: order, driver: model.driver)
                        .frame(height: 260)
                        .listRowInsets(EdgeInsets())
                    if let eta = model.driver?.etaMinutes {
                        Label("About \(eta) min away", systemImage: "clock").accessibilityLabel("About \(eta) minutes away")
                    }
                }
            }

            Section {
                if model.canRequestReturn { Button("Schedule return pickup") { Task { await model.requestReturn() } } }
                if model.canCancel { Button("Cancel order", role: .destructive) { Task { await model.cancel() } } }
            }
        }
        .navigationTitle("Order")
        .inlineTitle()
        .refreshable { await model.refresh() }
        .task { await model.run() }
        .onDisappear { Task { await model.stop() } }
    }

    private var showMap: Bool {
        [.confirmed, .outForDelivery, .returnScheduled, .pickedUp].contains(model.order.status)
    }
}

struct TrackingMap: View {
    let order: Order
    let driver: DriverLocation?

    var body: some View {
        Map {
            Marker("Delivery address", systemImage: "house.fill", coordinate: CLLocationCoordinate2D(latitude: order.address.location.lat, longitude: order.address.location.lng))
                .tint(.blue)
            if let driver {
                Marker("Driver", systemImage: "car.fill", coordinate: CLLocationCoordinate2D(latitude: driver.lat, longitude: driver.lng))
                    .tint(.orange)
            }
        }
        .accessibilityLabel("Map showing your delivery address and driver position")
    }
}

// MARK: - Root

public struct CustomerRootView: View {
    private let session: Session
    private let cache: SkuCache?
    @Binding private var deepLinkOrderId: String?
    @State private var tab = 0
    @State private var ordersPath: [Order] = []

    /// `deepLinkOrderId` is set when the user taps a push notification: we open that order.
    public init(session: Session, cache: SkuCache?, deepLinkOrderId: Binding<String?>) {
        self.session = session
        self.cache = cache
        _deepLinkOrderId = deepLinkOrderId
    }

    public var body: some View {
        TabView(selection: $tab) {
            NavigationStack { BrowseView(session: session, cache: cache) }
                .tabItem { Label("Rent", systemImage: "shippingbox") }.tag(0)
            NavigationStack(path: $ordersPath) { OrdersView(session: session) }
                .tabItem { Label("Orders", systemImage: "list.bullet.rectangle") }.tag(1)
            NavigationStack { AccountView(session: session) }
                .tabItem { Label("Account", systemImage: "person.crop.circle") }.tag(2)
        }
        .task(id: deepLinkOrderId) {
            guard let id = deepLinkOrderId else { return }
            if let order = try? await session.api.order(id: id) {
                tab = 1
                ordersPath = [order]
            }
            deepLinkOrderId = nil
        }
    }
}

struct AccountView: View {
    let session: Session
    var body: some View {
        List {
            if let user = session.user {
                LabeledContent("Name", value: user.name)
                if let email = user.email { LabeledContent("Email", value: email) }
            }
            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
        }
        .navigationTitle("Account")
    }
}

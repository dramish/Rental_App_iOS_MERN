import Foundation
import Observation
import CoreLocation
import AppCore
import Networking
import Realtime
import LocationKit

@MainActor
@Observable
final class DriverViewModel {
    var online = false
    var tasks: [DeliveryTask] = []
    var orders: [String: Order] = [:]
    var error: String?
    var pendingUploads = 0
    var authorization: CLAuthorizationStatus = .notDetermined

    private let session: Session
    private let tracker = LocationTracker()
    private let uploader: LocationUploader
    private let keys = IntentKeys()

    init(session: Session) {
        self.session = session
        let file = (FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("location-buffer.json")
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let api = session.api
        uploader = LocationUploader(fileURL: file) { batch in try await api.postLocations(batch) }
        tracker.onSample = { [weak self] location in
            guard let self else { return }
            Task { await self.record(location) }
        }
    }

    private func record(_ location: CLLocation) async {
        await uploader.enqueue(
            lat: location.coordinate.latitude, lng: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy, speed: location.speed >= 0 ? location.speed : nil, at: location.timestamp)
        pendingUploads = await uploader.pendingCount
    }

    // MARK: Online / offline

    func setOnline(_ on: Bool) async {
        error = nil
        if on { tracker.requestAuthorization() }
        do {
            try await session.api.setDriverStatus(online: on, lat: nil, lng: nil)
            online = on
            applyTrackingMode()
            if on { await refresh() } else { tasks = [] }
        } catch {
            self.error = "Could not change status."
        }
    }

    /// Battery policy: precise, continuous tracking only while a delivery is assigned; coarse otherwise.
    private func applyTrackingMode() {
        let hasAssigned = tasks.contains { $0.status == .assigned }
        tracker.setMode(!online ? .off : (hasAssigned ? .activeDelivery : .idle))
        authorization = tracker.authorization
    }

    // MARK: Work

    func refresh() async {
        do {
            tasks = try await session.api.driverTasks()
            for task in tasks where task.status == .assigned {
                orders[task.orderId] = try? await session.api.order(id: task.orderId)
            }
            applyTrackingMode()
            await uploader.flush()
            pendingUploads = await uploader.pendingCount
            error = nil
        } catch {
            self.error = "Could not refresh."
        }
    }

    /// Listen for offers and order changes (hints), and resync over REST after any reconnect.
    func run() async {
        await refresh()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.eventLoop() }
            group.addTask { await self.stateLoop() }
        }
    }

    private func eventLoop() async {
        let events = await session.realtime.events()
        for await event in events where event.name == "task.offer" || event.name == "order.updated" || event.name == "order.driver_assigned" {
            await refresh()
        }
    }

    private func stateLoop() async {
        var wasConnected = false
        let states = await session.realtime.states()
        for await state in states {
            if state == .connected, !wasConnected { await refresh() }
            wasConnected = (state == .connected)
        }
    }

    func accept(_ task: DeliveryTask) async {
        do {
            try await session.api.acceptTask(id: task.id)
        } catch {
            self.error = "That offer is no longer available."
        }
        await refresh()
    }

    func decline(_ task: DeliveryTask) async {
        try? await session.api.declineTask(id: task.id)
        await refresh()
    }

    // MARK: Status buttons

    struct Action: Identifiable {
        let id: String
        let title: String
        let event: String
        let needsProof: Bool
    }

    func action(for task: DeliveryTask) -> Action? {
        guard task.status == .assigned, let order = orders[task.orderId] else { return nil }
        switch (task.leg, order.status) {
        case (.delivery, .confirmed): return Action(id: "pickup", title: "Picked up from shop", event: "DRIVER_PICKED_UP_FROM_SHOP", needsProof: false)
        case (.delivery, .outForDelivery): return Action(id: "delivered", title: "Delivered", event: "DRIVER_DELIVERED", needsProof: true)
        case (.return, .returnScheduled): return Action(id: "return", title: "Picked up return", event: "DRIVER_PICKED_UP_RETURN", needsProof: true)
        default: return nil
        }
    }

    func perform(_ action: Action, task: DeliveryTask) async {
        let intent = "\(task.orderId):\(action.event)"
        var payload: [String: String]?
        if action.needsProof {
            // TBI: capture a photo, upload it with a presigned URL, and send that URL.
            #if DEBUG
            payload = ["proofPhotoUrl": "https://example.com/dev-proof.jpg"]
            #else
            error = "Proof photo upload is not available yet."
            return
            #endif
        }
        do {
            orders[task.orderId] = try await session.api.sendEvent(orderId: task.orderId, event: action.event, payload: payload, idempotencyKey: keys.key(for: intent))
            keys.clear(intent)
            await refresh()
        } catch let APIError.server(status, _, message) where status < 500 {
            keys.clear(intent)
            error = message ?? "Action not allowed."
        } catch {
            self.error = "Network problem. Tap again to retry safely."
        }
    }
}

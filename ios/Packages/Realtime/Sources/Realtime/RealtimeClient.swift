import Foundation

public enum ConnectionState: Sendable, Equatable {
    case disconnected, connecting, connected
}

public struct RealtimeEvent: Sendable {
    public let room: String
    public let name: String
    public let data: Data // raw JSON of the event payload; decode into a typed struct at the call site

    public func decode<T: Decodable>(_ type: T.Type) -> T? { try? JSONDecoder().decode(T.self, from: data) }
}

/// WebSocket client for the Lend backend (plain JSON frames, see backend/src/realtime/hub.ts).
/// - reconnects with exponential backoff + full jitter
/// - re-subscribes to its rooms after every reconnect
/// - broadcasts events and state changes to any number of listeners (each call to `events()` / `states()` is independent)
/// - a `.connected` after a gap is the signal to resync over REST (the socket is a hint, REST is the truth)
public actor RealtimeClient {
    private let url: URL
    private let tokenProvider: @Sendable () async -> String?
    private let session: URLSession
    private let backoff: Backoff

    private var desiredRooms = Set<String>()
    private var task: URLSessionWebSocketTask?
    private var runner: Task<Void, Never>?
    private var state: ConnectionState = .disconnected
    private var eventListeners: [UUID: AsyncStream<RealtimeEvent>.Continuation] = [:]
    private var stateListeners: [UUID: AsyncStream<ConnectionState>.Continuation] = [:]

    public init(url: URL, session: URLSession = .shared, backoff: Backoff = Backoff(), tokenProvider: @escaping @Sendable () async -> String?) {
        self.url = url
        self.session = session
        self.backoff = backoff
        self.tokenProvider = tokenProvider
    }

    // MARK: - Listening

    public func events() -> AsyncStream<RealtimeEvent> {
        let id = UUID()
        let made = AsyncStream.makeStream(of: RealtimeEvent.self, bufferingPolicy: .bufferingNewest(200))
        eventListeners[id] = made.continuation
        made.continuation.onTermination = { [weak self] _ in Task { await self?.removeEventListener(id) } }
        return made.stream
    }

    /// Emits the current state first, then every change.
    public func states() -> AsyncStream<ConnectionState> {
        let id = UUID()
        let made = AsyncStream.makeStream(of: ConnectionState.self, bufferingPolicy: .bufferingNewest(10))
        stateListeners[id] = made.continuation
        made.continuation.yield(state)
        made.continuation.onTermination = { [weak self] _ in Task { await self?.removeStateListener(id) } }
        return made.stream
    }

    private func removeEventListener(_ id: UUID) { eventListeners[id] = nil }
    private func removeStateListener(_ id: UUID) { stateListeners[id] = nil }

    private func set(_ newState: ConnectionState) {
        state = newState
        for c in stateListeners.values { c.yield(newState) }
    }

    // MARK: - Lifecycle

    public func start() {
        guard runner == nil else { return }
        runner = Task { await self.run() }
    }

    /// Call on logout and when the app goes to the background (iOS suspends sockets anyway).
    public func stop() {
        runner?.cancel()
        runner = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        set(.disconnected)
    }

    public func subscribe(_ room: String) {
        desiredRooms.insert(room)
        sendSubscribe(room)
    }

    public func unsubscribe(_ room: String) {
        desiredRooms.remove(room)
        send(["type": "unsubscribe", "room": room])
    }

    // MARK: - Run loop

    private func run() async {
        var attempt = 0
        while !Task.isCancelled {
            set(.connecting)
            do {
                try await connectAndListen(onConnected: { attempt = 0 })
            } catch {
                // fall through to backoff
            }
            task = nil
            set(.disconnected)
            if Task.isCancelled { break }
            let delay = backoff.delay(attempt: attempt)
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }

    private func connectAndListen(onConnected: () -> Void) async throws {
        guard let token = await tokenProvider() else { throw URLError(.userAuthenticationRequired) }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let ws = session.webSocketTask(with: request)
        task = ws
        ws.resume()

        // The server sends {"type":"hello"} once the upgrade is accepted.
        var greeted = false
        while !Task.isCancelled {
            let message = try await ws.receive()
            guard case let .string(text) = message, let frame = Self.parse(text) else { continue }
            if !greeted, frame["type"] as? String == "hello" {
                greeted = true
                onConnected()
                set(.connected)
                for room in desiredRooms { sendSubscribe(room) } // re-subscribe after every reconnect
                continue
            }
            handle(frame)
        }
    }

    private func handle(_ frame: [String: Any]) {
        switch frame["type"] as? String {
        case "event":
            guard let room = frame["room"] as? String, let name = frame["event"] as? String else { return }
            let payload = (try? JSONSerialization.data(withJSONObject: frame["data"] ?? [String: Any]())) ?? Data()
            let event = RealtimeEvent(room: room, name: name, data: payload)
            for c in eventListeners.values { c.yield(event) }
        case "ack":
            // ok == false: the server refused the subscription (not a participant). Stop asking for it.
            if (frame["ok"] as? Bool) == false, let id = frame["id"] as? String, id.hasPrefix("sub:") {
                desiredRooms.remove(String(id.dropFirst(4)))
            }
        default:
            break
        }
    }

    private func sendSubscribe(_ room: String) {
        send(["type": "subscribe", "room": room, "id": "sub:\(room)"])
    }

    private func send(_ object: [String: String]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    static func parse(_ text: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
    }
}

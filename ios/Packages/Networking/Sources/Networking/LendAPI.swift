import Foundation

/// Typed wrapper over APIClient. One method per backend endpoint the apps use.
public struct LendAPI: Sendable {
    public let client: APIClient
    public init(client: APIClient) { self.client = client }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    private func body<T: Encodable>(_ value: T) -> Data { (try? Self.encoder.encode(value)) ?? Data() }

    // MARK: Auth
    public func register(email: String, password: String, name: String, role: Role) async throws -> AuthResponse {
        struct Body: Encodable { let email, password, name, role: String }
        return try await client.send(Endpoint(path: "v1/auth/register", method: .post, body: body(Body(email: email, password: password, name: name, role: role.rawValue)), requiresAuth: false))
    }
    public func login(email: String, password: String) async throws -> AuthResponse {
        try await client.send(Endpoint(path: "v1/auth/login", method: .post, body: body(["email": email, "password": password]), requiresAuth: false))
    }
    public func apple(identityToken: String, nonce: String, fullName: String?) async throws -> AuthResponse {
        struct Body: Encodable { let identityToken: String; let nonce: String; let fullName: String? }
        return try await client.send(Endpoint(path: "v1/auth/apple", method: .post, body: body(Body(identityToken: identityToken, nonce: nonce, fullName: fullName)), requiresAuth: false))
    }
    public func me() async throws -> User { try await client.send(Endpoint(path: "v1/auth/me")) }
    public func logout(refreshToken: String) async {
        _ = try? await client.sendRaw(Endpoint(path: "v1/auth/logout", method: .post, body: body(["refreshToken": refreshToken]), requiresAuth: false))
    }

    // MARK: Catalog
    public func skus(query: String?, category: String?, cursor: String?) async throws -> Page<Sku> {
        var items: [URLQueryItem] = []
        if let query, !query.isEmpty { items.append(.init(name: "q", value: query)) }
        if let category { items.append(.init(name: "category", value: category)) }
        if let cursor { items.append(.init(name: "cursor", value: cursor)) }
        return try await client.send(Endpoint(path: "v1/skus", query: items, requiresAuth: false))
    }
    public func availability(skuId: String, from: String, to: String) async throws -> [DayAvailability] {
        struct Res: Decodable, Sendable { let days: [DayAvailability] }
        let res: Res = try await client.send(Endpoint(path: "v1/skus/\(skuId)/availability", query: [.init(name: "from", value: from), .init(name: "to", value: to)], requiresAuth: false))
        return res.days
    }

    // MARK: Orders
    public func placeOrder(_ req: PlaceOrderRequest, idempotencyKey: String) async throws -> PlacedOrder {
        try await client.send(Endpoint(path: "v1/orders", method: .post, body: body(req), idempotencyKey: idempotencyKey))
    }
    public func orders(cursor: String?) async throws -> Page<Order> {
        try await client.send(Endpoint(path: "v1/orders", query: cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? []))
    }
    public func order(id: String) async throws -> Order { try await client.send(Endpoint(path: "v1/orders/\(id)")) }
    public func tracking(orderId: String) async throws -> Tracking { try await client.send(Endpoint(path: "v1/orders/\(orderId)/tracking")) }

    /// Every user-driven state change. Generate the key ONCE per user intent and reuse it on retries.
    public func sendEvent(orderId: String, event: String, payload: [String: String]? = nil, idempotencyKey: String) async throws -> Order {
        struct Body: Encodable { let event: String; let payload: [String: String]? }
        return try await client.send(Endpoint(path: "v1/orders/\(orderId)/events", method: .post, body: body(Body(event: event, payload: payload)), idempotencyKey: idempotencyKey))
    }
    /// Dev only (fake payment provider): pretend the customer paid.
    public func simulatePayment(orderId: String) async throws {
        _ = try await client.sendRaw(Endpoint(path: "v1/dev/payments/\(orderId)/authorize", method: .post))
    }

    // MARK: Push
    public func registerDevice(token: String, bundleId: String) async throws {
        _ = try await client.sendRaw(Endpoint(path: "v1/devices", method: .post, body: body(["token": token, "bundleId": bundleId])))
    }
    public func registerLiveActivity(orderId: String, pushToken: String) async throws {
        _ = try await client.sendRaw(Endpoint(path: "v1/orders/\(orderId)/live-activity", method: .post, body: body(["pushToken": pushToken])))
    }

    // MARK: Driver
    public func setDriverStatus(online: Bool, lat: Double?, lng: Double?) async throws {
        struct Body: Encodable { let online: Bool; let lat: Double?; let lng: Double? }
        _ = try await client.sendRaw(Endpoint(path: "v1/drivers/me", method: .put, body: body(Body(online: online, lat: lat, lng: lng))))
    }
    public func driverTasks() async throws -> [DeliveryTask] {
        struct Res: Decodable, Sendable { let items: [DeliveryTask] }
        let res: Res = try await client.send(Endpoint(path: "v1/drivers/tasks"))
        return res.items
    }
    public func acceptTask(id: String) async throws { _ = try await client.sendRaw(Endpoint(path: "v1/tasks/\(id)/accept", method: .post)) }
    public func declineTask(id: String) async throws { _ = try await client.sendRaw(Endpoint(path: "v1/tasks/\(id)/decline", method: .post)) }
    public func postLocations(_ points: [LocationPointDTO]) async throws {
        struct Body: Encodable { let points: [LocationPointDTO] }
        _ = try await client.sendRaw(Endpoint(path: "v1/drivers/location", method: .post, body: body(Body(points: points))))
    }
}

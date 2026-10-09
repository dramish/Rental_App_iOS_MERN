import Foundation

public struct AuthTokens: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public init(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}

public protocol TokenStore: Sendable {
    func load() async -> AuthTokens?
    func save(_ tokens: AuthTokens) async
    func clear() async
}

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
}

public struct Endpoint: Sendable {
    public var path: String
    public var method: HTTPMethod
    public var query: [URLQueryItem]
    public var body: Data?
    public var requiresAuth: Bool
    public var idempotencyKey: String?

    public init(
        path: String,
        method: HTTPMethod = .get,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        requiresAuth: Bool = true,
        idempotencyKey: String? = nil
    ) {
        self.path = path
        self.method = method
        self.query = query
        self.body = body
        self.requiresAuth = requiresAuth
        self.idempotencyKey = idempotencyKey
    }
}

public enum APIError: Error, Sendable, Equatable {
    case unauthorized
    case server(status: Int, code: String?, message: String?)
    case invalidResponse
}

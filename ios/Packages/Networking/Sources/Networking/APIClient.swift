import Foundation

/// Actor-based API client.
/// - Attaches the access token, and on a 401 refreshes once and retries once.
/// - Single in-flight refresh: concurrent 401s share one refresh call (no thundering herd).
///   This matters because the backend treats refresh-token reuse as theft and revokes the family.
public actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokenStore: TokenStore
    private let decoder = JSONDecoder()
    private var refreshTask: Task<AuthTokens, Error>?

    public init(baseURL: URL, session: URLSession = .shared, tokenStore: TokenStore) {
        self.baseURL = baseURL
        self.session = session
        self.tokenStore = tokenStore
    }

    public func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type = T.self) async throws -> T {
        let data = try await sendRaw(endpoint)
        return try decoder.decode(T.self, from: data)
    }

    public func sendRaw(_ endpoint: Endpoint) async throws -> Data {
        let tokenUsed: String? = endpoint.requiresAuth ? await tokenStore.load()?.accessToken : nil
        do {
            return try await perform(endpoint, accessToken: tokenUsed)
        } catch APIError.unauthorized where endpoint.requiresAuth {
            let fresh = try await refreshTokens(staleAccessToken: tokenUsed)
            return try await perform(endpoint, accessToken: fresh.accessToken)
        }
    }

    // MARK: - Refresh (single flight)

    private func refreshTokens(staleAccessToken: String?) async throws -> AuthTokens {
        if let task = refreshTask { return try await task.value }
        // Someone may have refreshed while this request was in flight.
        if let current = await tokenStore.load(), current.accessToken != staleAccessToken {
            return current
        }
        let task = Task { try await self.doRefresh() }
        refreshTask = task
        return try await task.value
    }

    private func doRefresh() async throws -> AuthTokens {
        defer { refreshTask = nil }
        guard let current = await tokenStore.load() else { throw APIError.unauthorized }

        var request = URLRequest(url: baseURL.appendingPathComponent("v1/auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refreshToken": current.refreshToken])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200:
            let tokens = try decoder.decode(AuthTokens.self, from: data)
            await tokenStore.save(tokens)
            return tokens
        case 401:
            await tokenStore.clear() // refresh rejected: session is over, force re-login
            throw APIError.unauthorized
        default:
            throw APIError.server(status: http.statusCode, code: nil, message: nil)
        }
    }

    // MARK: - Request

    private struct ErrorEnvelope: Decodable {
        struct Body: Decodable { let code: String?; let message: String? }
        let error: Body
    }

    private func perform(_ endpoint: Endpoint, accessToken: String?) async throws -> Data {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false
        ) else { throw APIError.invalidResponse }
        if !endpoint.query.isEmpty { components.queryItems = endpoint.query }
        guard let url = components.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        if endpoint.body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let key = endpoint.idempotencyKey { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        if let token = accessToken { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw APIError.unauthorized
        default:
            let envelope = try? decoder.decode(ErrorEnvelope.self, from: data)
            throw APIError.server(status: http.statusCode, code: envelope?.error.code, message: envelope?.error.message)
        }
    }
}

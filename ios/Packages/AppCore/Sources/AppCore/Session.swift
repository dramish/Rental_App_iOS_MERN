import Foundation
import Observation
import Networking
import Persistence
import Realtime

/// App-wide state: who is signed in, the typed API, and the realtime connection.
@MainActor
@Observable
public final class Session {
    public private(set) var user: User?
    public private(set) var isRestoring = true

    public let api: LendAPI
    public let realtime: RealtimeClient
    public let baseURL: URL
    private let tokenStore: TokenStore

    public init(baseURL: URL, tokenStore: TokenStore = KeychainTokenStore()) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        let api = LendAPI(client: APIClient(baseURL: baseURL, tokenStore: tokenStore))
        self.api = api

        var ws = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        ws.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        ws.path = "/ws"
        self.realtime = RealtimeClient(url: ws.url ?? baseURL) {
            _ = try? await api.me() // a cheap authenticated call refreshes an expired access token first
            return await tokenStore.load()?.accessToken
        }
    }

    /// Called at launch: if tokens exist and still work (or refresh), we are signed in.
    public func restore() async {
        defer { isRestoring = false }
        guard await tokenStore.load() != nil else { return }
        if let me = try? await api.me() {
            user = me
            await realtime.start()
        }
    }

    public func login(email: String, password: String) async throws {
        try await complete(api.login(email: email, password: password))
    }

    public func register(email: String, password: String, name: String, role: Role) async throws {
        try await complete(api.register(email: email, password: password, name: name, role: role))
    }

    public func signInWithApple(identityToken: String, rawNonce: String, fullName: String?) async throws {
        try await complete(api.apple(identityToken: identityToken, nonce: rawNonce, fullName: fullName))
    }

    public func signOut() async {
        if let tokens = await tokenStore.load() { await api.logout(refreshToken: tokens.refreshToken) }
        await tokenStore.clear()
        await realtime.stop()
        user = nil
    }

    private func complete(_ response: AuthResponse) async throws {
        await tokenStore.save(AuthTokens(accessToken: response.accessToken, refreshToken: response.refreshToken))
        user = response.user
        await realtime.start()
    }
}

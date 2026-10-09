import XCTest
@testable import Networking

final class MockURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.handler, let url = request.url else { return }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.lock(); count += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

actor InMemoryTokenStore: TokenStore {
    private var tokens: AuthTokens?
    init(_ tokens: AuthTokens?) { self.tokens = tokens }
    func load() async -> AuthTokens? { tokens }
    func save(_ tokens: AuthTokens) async { self.tokens = tokens }
    func clear() async { tokens = nil }
}

final class APIClientTests: XCTestCase {
    private func makeClient(store: TokenStore) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return APIClient(baseURL: URL(string: "https://api.test")!, session: URLSession(configuration: config), tokenStore: store)
    }

    func testConcurrent401sTriggerSingleRefresh() async throws {
        let refreshCount = Counter()
        MockURLProtocol.handler = { request in
            if request.url?.path == "/v1/auth/refresh" {
                refreshCount.increment()
                Thread.sleep(forTimeInterval: 0.1)
                return (200, Data(#"{"accessToken":"new","refreshToken":"r2"}"#.utf8))
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer new" {
                return (200, Data(#"{"ok":true}"#.utf8))
            }
            return (401, Data())
        }
        let store = InMemoryTokenStore(AuthTokens(accessToken: "old", refreshToken: "r1"))
        let client = makeClient(store: store)

        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<10 {
                group.addTask { _ = try await client.sendRaw(Endpoint(path: "v1/skus")) }
            }
            try await group.waitForAll()
        }

        XCTAssertEqual(refreshCount.value, 1)
        let saved = await store.load()
        XCTAssertEqual(saved?.refreshToken, "r2")
    }

    func testRejectedRefreshClearsSession() async throws {
        MockURLProtocol.handler = { _ in (401, Data()) }
        let store = InMemoryTokenStore(AuthTokens(accessToken: "old", refreshToken: "r1"))
        let client = makeClient(store: store)

        do {
            _ = try await client.sendRaw(Endpoint(path: "v1/skus"))
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        let remaining = await store.load()
        XCTAssertNil(remaining)
    }
}

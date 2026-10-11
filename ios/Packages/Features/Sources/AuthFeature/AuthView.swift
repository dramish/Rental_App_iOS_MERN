import SwiftUI
import AuthenticationServices
import CryptoKit
import AppCore
import Networking
import DesignSystem

public struct AuthView: View {
    private let session: Session
    private let role: Role
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var isRegistering = false
    @State private var busy = false
    @State private var error: String?
    @State private var rawNonce = ""

    public init(session: Session, role: Role) {
        self.session = session
        self.role = role
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isRegistering { TextField("Name", text: $name).fieldKind(.name) }
                    TextField("Email", text: $email).fieldKind(.email)
                    SecureField("Password (8+ characters)", text: $password).fieldKind(isRegistering ? .newPassword : .password)
                }
                if let error { Section { ErrorBanner(error) } }
                Section {
                    Button(isRegistering ? "Create account" : "Sign in") { Task { await submit() } }
                        .disabled(busy || email.isEmpty || password.count < 8 || (isRegistering && name.isEmpty))
                    Button(isRegistering ? "I already have an account" : "New here? Create an account") { isRegistering.toggle(); error = nil }
                        .font(.footnote)
                }
                if role == .customer {
                    Section {
                        SignInWithAppleButton(.signIn) { request in
                            rawNonce = AuthView.randomNonce()
                            request.requestedScopes = [.fullName, .email]
                            request.nonce = AuthView.sha256Hex(rawNonce) // Apple embeds the HASH; the server checks it against the raw nonce
                        } onCompletion: { result in
                            Task { await handleApple(result) }
                        }
                        .frame(height: 44)
                    }
                }
            }
            .navigationTitle(role == .driver ? "Lend Driver" : "Lend")
            .inlineTitle()
            .disabled(busy)
        }
    }

    private func submit() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            if isRegistering {
                try await session.register(email: email, password: password, name: name, role: role)
            } else {
                try await session.login(email: email, password: password)
            }
        } catch let APIError.server(_, code, message) {
            error = message ?? code ?? "Something went wrong"
        } catch {
            self.error = "Could not reach the server. Check your connection."
        }
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        busy = true; error = nil
        defer { busy = false }
        switch result {
        case .failure(let err):
            if (err as? ASAuthorizationError)?.code != .canceled { error = "Sign in with Apple failed." }
        case .success(let auth):
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = cred.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else { error = "Apple did not return a token."; return }
            // Apple only provides the name on the FIRST authorization.
            let fullName = [cred.fullName?.givenName, cred.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
            do {
                try await session.signInWithApple(identityToken: token, rawNonce: rawNonce, fullName: fullName.isEmpty ? nil : fullName)
            } catch {
                self.error = "Sign in with Apple was rejected by the server."
            }
        }
    }

    static func randomNonce(length: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func sha256Hex(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

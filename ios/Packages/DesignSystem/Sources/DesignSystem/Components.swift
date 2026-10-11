import SwiftUI

public struct StatusBadge: View {
    private let text: String
    private let tint: Color
    public init(_ text: String, tint: Color = .accentColor) { self.text = text; self.tint = tint }
    public var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, Spacing.s)
            .padding(.vertical, Spacing.xs)
            .background(tint.opacity(0.15), in: Capsule())
            .foregroundStyle(tint)
            .accessibilityLabel("Status: \(text)")
    }
}

public struct PrimaryButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.m)
            .background(Color.accentColor.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
    }
}

public struct ErrorBanner: View {
    private let message: String
    public init(_ message: String) { self.message = message }
    public var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.footnote)
            .padding(Spacing.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            .foregroundStyle(.red)
    }
}

public enum FieldKind { case email, name, password, newPassword, street, city, postalCode }

public extension View {
    /// Keyboard/autofill traits for common fields. iOS only; a no-op elsewhere so the packages also build on macOS CI.
    @ViewBuilder func fieldKind(_ kind: FieldKind) -> some View {
        #if os(iOS)
        switch kind {
        case .email: self.textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        case .name: self.textContentType(.name)
        case .password: self.textContentType(.password)
        case .newPassword: self.textContentType(.newPassword)
        case .street: self.textContentType(.streetAddressLine1)
        case .city: self.textContentType(.addressCity)
        case .postalCode: self.textContentType(.postalCode).keyboardType(.numbersAndPunctuation)
        }
        #else
        self
        #endif
    }

    @ViewBuilder func inlineTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
}

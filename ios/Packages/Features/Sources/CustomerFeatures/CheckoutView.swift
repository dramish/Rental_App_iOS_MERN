import SwiftUI
import CoreLocation
import AppCore
import Networking
import DesignSystem

@MainActor
@Observable
final class CheckoutViewModel {
    enum Step { case editing, placing, awaitingPayment(PlacedOrder), paid(Order) }

    var step: Step = .editing
    var line1 = ""
    var city = ""
    var postalCode = ""
    var error: String?

    private let session: Session
    private let keys = IntentKeys()
    private let sku: Sku
    private let qty: Int
    private let start: String
    private let end: String

    init(session: Session, sku: Sku, qty: Int, start: String, end: String) {
        self.session = session; self.sku = sku; self.qty = qty; self.start = start; self.end = end
    }

    var canPlace: Bool { !line1.isEmpty && !city.isEmpty && postalCode.count >= 3 }

    func place() async {
        error = nil
        step = .placing
        do {
            let coordinate = try await geocode("\(line1), \(city) \(postalCode)")
            let request = PlaceOrderRequest(
                items: [.init(skuId: sku.id, qty: qty)], rentalStart: start, rentalEnd: end,
                address: .init(line1: line1, city: city, postalCode: postalCode, lat: coordinate.latitude, lng: coordinate.longitude))
            // One key per intent: if the response is lost and the user taps again, the server replays the same order.
            let placed = try await session.api.placeOrder(request, idempotencyKey: keys.key(for: "place-order"))
            keys.clear("place-order")
            step = .awaitingPayment(placed)
        } catch let APIError.server(status, code, message) {
            if status < 500 { keys.clear("place-order") } // definitive answer: a corrected retry is a new intent
            error = code == "sold_out" ? "Sorry, someone just booked those dates." : (message ?? "Could not place the order.")
            step = .editing
        } catch {
            // Network error: KEEP the key so a retry cannot create a second order.
            self.error = "Network problem. Tap again to retry safely."
            step = .editing
        }
    }

    /// Dev builds only: the server's fake payment provider confirms the payment.
    /// TBI: Stripe PaymentSheet using `clientSecret` for real card entry.
    func simulatePayment(_ placed: PlacedOrder) async {
        do {
            try await session.api.simulatePayment(orderId: placed.order.id)
            step = .paid(try await session.api.order(id: placed.order.id))
        } catch {
            self.error = "Payment could not be confirmed."
        }
    }

    private func geocode(_ address: String) async throws -> CLLocationCoordinate2D {
        let marks = try await CLGeocoder().geocodeAddressString(address)
        guard let c = marks.first?.location?.coordinate else { throw APIError.server(status: 422, code: "address_not_found", message: "We could not find that address.") }
        return c
    }
}

struct CheckoutView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: CheckoutViewModel
    private let sku: Sku

    init(session: Session, sku: Sku, qty: Int, start: String, end: String) {
        self.sku = sku
        _model = State(initialValue: CheckoutViewModel(session: session, sku: sku, qty: qty, start: start, end: end))
    }

    var body: some View {
        NavigationStack {
            Form {
                switch model.step {
                case .editing, .placing:
                    Section("Delivery address") {
                        TextField("Street address", text: $model.line1).fieldKind(.street)
                        TextField("City", text: $model.city).fieldKind(.city)
                        TextField("Postal code", text: $model.postalCode).fieldKind(.postalCode)
                    }
                    if let error = model.error { Section { ErrorBanner(error) } }
                    Section {
                        Button("Place order") { Task { await model.place() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(!model.canPlace || isPlacing)
                            .listRowInsets(EdgeInsets())
                    }
                case .awaitingPayment(let placed):
                    Section("Payment") {
                        LabeledContent("Authorize", value: Money.format(minor: placed.order.totalMinor, currency: placed.order.currency))
                        Text("Your card is authorized for rent plus a refundable deposit. You are only charged for the rental and any late fee or damage.")
                            .font(.footnote).foregroundStyle(.secondary)
                        #if DEBUG
                        Button("Simulate payment (dev)") { Task { await model.simulatePayment(placed) } }
                        #endif
                    }
                    if let error = model.error { Section { ErrorBanner(error) } }
                case .paid(let order):
                    Section {
                        Label("Order confirmed", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        Text("We are finding a driver. Track it under Orders. Status: \(order.status.title)")
                    }
                    Button("Done") { dismiss() }
                }
            }
            .navigationTitle("Checkout")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private var isPlacing: Bool { if case .placing = model.step { return true } else { return false } }
}

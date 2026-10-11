import SwiftUI
import AppCore
import Networking
import DesignSystem

struct SkuDetailView: View {
    let session: Session
    let sku: Sku

    @State private var start = Calendar.current.date(byAdding: .day, value: 2, to: .now) ?? .now
    @State private var end = Calendar.current.date(byAdding: .day, value: 4, to: .now) ?? .now
    @State private var qty = 1
    @State private var days: [DayAvailability] = []
    @State private var loading = false
    @State private var showCheckout = false

    private var rentalDays: Int {
        max(1, (Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: start), to: Calendar.current.startOfDay(for: end)).day ?? 0) + 1)
    }
    private var maxAvailable: Int { days.map(\.available).min() ?? sku.totalQty }
    private var rent: Int { sku.dailyPriceMinor * qty * rentalDays }

    var body: some View {
        Form {
            Section {
                Text(sku.title).font(.title2.bold())
                if !sku.details.isEmpty { Text(sku.details) }
                LabeledContent("Per day", value: Money.format(minor: sku.dailyPriceMinor, currency: sku.currency))
                LabeledContent("Refundable deposit", value: Money.format(minor: sku.depositMinor, currency: sku.currency))
            }
            Section("Dates") {
                DatePicker("From", selection: $start, in: Date()..., displayedComponents: .date)
                DatePicker("To", selection: $end, in: start..., displayedComponents: .date)
                Stepper("Quantity: \(qty)", value: $qty, in: 1...max(1, min(maxAvailable, sku.totalQty)))
                availabilityRow
            }
            Section("Summary") {
                LabeledContent("Rent (\(rentalDays) days)", value: Money.format(minor: rent, currency: sku.currency))
                LabeledContent("Deposit hold", value: Money.format(minor: sku.depositMinor * qty, currency: sku.currency))
            }
            Section {
                Button("Continue to checkout") { showCheckout = true }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(maxAvailable < 1 || loading)
                    .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle("Details")
        .inlineTitle()
        .task(id: "\(DayString.from(start))-\(DayString.from(end))") { await loadAvailability() }
        .sheet(isPresented: $showCheckout) {
            CheckoutView(session: session, sku: sku, qty: qty, start: DayString.from(start), end: DayString.from(end))
        }
    }

    @ViewBuilder private var availabilityRow: some View {
        if loading {
            ProgressView()
        } else if maxAvailable < 1 {
            Label("Not available for these dates", systemImage: "xmark.circle.fill").foregroundStyle(.red)
        } else {
            Label("\(maxAvailable) available for the whole period", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        }
    }

    private func loadAvailability() async {
        loading = true
        defer { loading = false }
        // Show the buffer days around the rental too: they are blocked for turnaround.
        if let result = try? await session.api.availability(skuId: sku.id, from: DayString.from(start), to: DayString.from(end)) {
            days = result
            qty = min(qty, max(1, maxAvailable))
        }
    }
}

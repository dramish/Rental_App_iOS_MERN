import SwiftUI
import AppCore
import Networking
import Persistence
import DesignSystem

@MainActor
@Observable
final class BrowseViewModel {
    var skus: [Sku] = []
    var query = ""
    var isLoading = false
    var offline = false
    var errorMessage: String?

    private let session: Session
    private let cache: SkuCache?
    private var nextCursor: String?
    private var reachedEnd = false

    init(session: Session, cache: SkuCache?) {
        self.session = session
        self.cache = cache
    }

    func reload() async {
        nextCursor = nil
        reachedEnd = false
        skus = []
        await loadMore()
    }

    func loadMoreIfNeeded(current: Sku) async {
        guard current.id == skus.last?.id else { return }
        await loadMore()
    }

    func loadMore() async {
        guard !isLoading, !reachedEnd else { return }
        isLoading = true
        defer { isLoading = false }
        let firstPage = nextCursor == nil
        do {
            let page = try await session.api.skus(query: query, category: nil, cursor: nextCursor)
            skus += page.items
            nextCursor = page.nextCursor
            reachedEnd = page.nextCursor == nil
            offline = false
            errorMessage = nil
            if firstPage && query.isEmpty, let cache { await cache.replace(with: page.items) }
        } catch {
            // Offline browsing: fall back to the last catalog we saw.
            if firstPage, let cache {
                let cached = await cache.all()
                if !cached.isEmpty { skus = cached; offline = true; reachedEnd = true; return }
            }
            errorMessage = "Could not load items."
        }
    }
}

struct BrowseView: View {
    let session: Session
    @State private var model: BrowseViewModel

    init(session: Session, cache: SkuCache?) {
        self.session = session
        _model = State(initialValue: BrowseViewModel(session: session, cache: cache))
    }

    var body: some View {
        List {
            if model.offline { Label("Offline: showing saved items", systemImage: "wifi.slash").font(.footnote).foregroundStyle(.secondary) }
            if let message = model.errorMessage { ErrorBanner(message) }
            ForEach(model.skus) { sku in
                NavigationLink(value: sku) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(sku.title).font(.headline)
                        Text("\(Money.format(minor: sku.dailyPriceMinor, currency: sku.currency)) / day · \(sku.category)")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                .task { await model.loadMoreIfNeeded(current: sku) }
            }
            if model.isLoading { ProgressView().frame(maxWidth: .infinity) }
        }
        .navigationTitle("Rent")
        .searchable(text: $model.query)
        .onSubmit(of: .search) { Task { await model.reload() } }
        .refreshable { await model.reload() }
        .task { if model.skus.isEmpty { await model.reload() } }
        .navigationDestination(for: Sku.self) { SkuDetailView(session: session, sku: $0) }
    }
}

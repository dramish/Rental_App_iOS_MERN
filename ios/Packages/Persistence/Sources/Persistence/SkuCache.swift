import Foundation
import SwiftData
import Networking

/// Offline copy of the catalog. The JSON blob keeps the model decoupled from API changes;
/// only id/cachedAt are columns. Network is the source of truth; this is a fallback for offline browsing.
@Model
public final class CachedSku {
    @Attribute(.unique) public var id: String
    public var json: Data
    public var cachedAt: Date
    public init(id: String, json: Data, cachedAt: Date = .now) {
        self.id = id; self.json = json; self.cachedAt = cachedAt
    }
}

@ModelActor
public actor SkuCache {
    public static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        try ModelContainer(for: CachedSku.self, configurations: ModelConfiguration(isStoredInMemoryOnly: inMemory))
    }

    public func replace(with skus: [Sku]) {
        try? modelContext.delete(model: CachedSku.self)
        let encoder = JSONEncoder()
        for sku in skus {
            if let data = try? encoder.encode(sku) { modelContext.insert(CachedSku(id: sku.id, json: data)) }
        }
        try? modelContext.save()
    }

    public func all() -> [Sku] {
        let rows = (try? modelContext.fetch(FetchDescriptor<CachedSku>(sortBy: [SortDescriptor(\.cachedAt, order: .reverse)]))) ?? []
        let decoder = JSONDecoder()
        return rows.compactMap { try? decoder.decode(Sku.self, from: $0.json) }
    }
}

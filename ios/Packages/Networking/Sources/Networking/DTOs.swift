import Foundation

public struct GeoJSONPoint: Codable, Sendable, Hashable {
    public let type: String
    public let coordinates: [Double] // [lng, lat]
    public var lng: Double { coordinates.first ?? 0 }
    public var lat: Double { coordinates.count > 1 ? coordinates[1] : 0 }
    public init(lat: Double, lng: Double) { type = "Point"; coordinates = [lng, lat] }
}

public enum Role: String, Codable, Sendable { case customer, shop, driver, admin }

public struct User: Codable, Sendable, Equatable {
    public let id: String
    public let email: String?
    public let name: String
    public let role: Role
}

public struct AuthResponse: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let user: User
}

public struct Sku: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let shopId: String
    public let title: String
    public let details: String
    public let category: String
    public let images: [String]
    public let totalQty: Int
    public let bufferDays: Int
    public let dailyPriceMinor: Int
    public let depositMinor: Int
    public let currency: String

    enum CodingKeys: String, CodingKey {
        case id = "_id", shopId, title, details = "description", category, images, totalQty, bufferDays
        case dailyPriceMinor, depositMinor, currency
    }
}

public struct Page<T: Codable & Sendable>: Codable, Sendable {
    public let items: [T]
    public let nextCursor: String?
}

public struct DayAvailability: Codable, Sendable, Hashable {
    public let date: String
    public let available: Int
}

public enum OrderStatus: String, Codable, Sendable {
    case pendingPayment = "PENDING_PAYMENT", paymentFailed = "PAYMENT_FAILED", confirmed = "CONFIRMED"
    case outForDelivery = "OUT_FOR_DELIVERY", delivered = "DELIVERED", inUse = "IN_USE", overdue = "OVERDUE"
    case returnScheduled = "RETURN_SCHEDULED", pickedUp = "PICKED_UP", inspected = "INSPECTED"
    case settled = "SETTLED", cancelled = "CANCELLED", unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = OrderStatus(rawValue: raw) ?? .unknown
    }

    public var title: String {
        rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    }
    public var isTerminal: Bool { self == .settled || self == .cancelled || self == .paymentFailed }
}

public struct OrderItem: Codable, Sendable, Hashable {
    public let skuId: String
    public let title: String
    public let qty: Int
    public let dailyPriceMinor: Int
    public let depositMinor: Int
}

public struct OrderAddress: Codable, Sendable, Hashable {
    public let line1: String
    public let city: String
    public let postalCode: String
    public let location: GeoJSONPoint
}

public struct Order: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let customerId: String
    public let shopId: String
    public let items: [OrderItem]
    public let rentalStart: String
    public let rentalEnd: String
    public let days: Int
    public let address: OrderAddress
    public let pickupLocation: GeoJSONPoint
    public let currency: String
    public let rentMinor: Int
    public let depositMinor: Int
    public let totalMinor: Int
    public let status: OrderStatus
    public let version: Int
    public let deliveryDriverId: String?
    public let returnDriverId: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id", customerId, shopId, items, rentalStart, rentalEnd, days, address, pickupLocation
        case currency, rentMinor, depositMinor, totalMinor, status, version, deliveryDriverId, returnDriverId
    }
}

public struct PlacedOrder: Codable, Sendable {
    public let order: Order
    public let clientSecret: String
}

public struct PlaceOrderRequest: Codable, Sendable {
    public struct Line: Codable, Sendable { public let skuId: String; public let qty: Int
        public init(skuId: String, qty: Int) { self.skuId = skuId; self.qty = qty } }
    public struct Address: Codable, Sendable {
        public let line1: String, city: String, postalCode: String, lat: Double, lng: Double
        public init(line1: String, city: String, postalCode: String, lat: Double, lng: Double) {
            self.line1 = line1; self.city = city; self.postalCode = postalCode; self.lat = lat; self.lng = lng }
    }
    public let items: [Line]
    public let rentalStart: String
    public let rentalEnd: String
    public let address: Address
    public init(items: [Line], rentalStart: String, rentalEnd: String, address: Address) {
        self.items = items; self.rentalStart = rentalStart; self.rentalEnd = rentalEnd; self.address = address }
}

public struct LocationPointDTO: Codable, Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double
    public let speed: Double?
    public let recordedAt: Date
    public let seq: Int
    public init(lat: Double, lng: Double, accuracy: Double, speed: Double?, recordedAt: Date, seq: Int) {
        self.lat = lat; self.lng = lng; self.accuracy = accuracy; self.speed = speed; self.recordedAt = recordedAt; self.seq = seq
    }
}

public struct DriverLocation: Codable, Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let recordedAt: String
    public let seq: Int
    public let etaMinutes: Int?
}

public struct Tracking: Codable, Sendable {
    public let orderId: String
    public let status: OrderStatus
    public let version: Int
    public let driverLocation: DriverLocation?
}

public enum TaskLeg: String, Codable, Sendable { case delivery = "DELIVERY", `return` = "RETURN" }
public enum TaskStatus: String, Codable, Sendable { case open = "OPEN", offered = "OFFERED", assigned = "ASSIGNED", done = "DONE", cancelled = "CANCELLED" }

public struct DeliveryTask: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let orderId: String
    public let leg: TaskLeg
    public let status: TaskStatus
    public let pickup: GeoJSONPoint
    public let dropoff: GeoJSONPoint
    public let offerExpiresAt: String?

    enum CodingKeys: String, CodingKey { case id = "_id", orderId, leg, status, pickup, dropoff, offerExpiresAt }
}

public struct TaskOfferEvent: Codable, Sendable {
    public let taskId: String
    public let orderId: String
    public let leg: TaskLeg
    public let expiresAt: String
}

public struct OrderUpdatedEvent: Codable, Sendable {
    public let orderId: String
    public let status: OrderStatus
    public let version: Int
}

public struct DriverLocationEvent: Codable, Sendable {
    public let orderId: String
    public let lat: Double
    public let lng: Double
    public let seq: Int
    public let etaMinutes: Int?
}

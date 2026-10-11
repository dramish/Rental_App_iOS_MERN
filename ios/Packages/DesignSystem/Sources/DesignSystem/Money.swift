import Foundation

public enum Money {
    /// Amounts are integer minor units (paise/cents). Formatting happens only at the edge.
    public static func format(minor: Int, currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: Double(minor) / 100)) ?? "\(minor)"
    }
}

import SwiftUI
import UIKit
import UserNotifications
import AppCore
import AuthFeature
import CustomerFeatures
import Networking
import Persistence

enum AppConfig {
    /// Set LendAPIURL in Info.plist (project.yml) for device builds; the simulator can use localhost.
    static var apiURL: URL {
        let raw = Bundle.main.object(forInfoDictionaryKey: "LendAPIURL") as? String ?? "http://localhost:3000"
        return URL(string: raw) ?? URL(string: "http://localhost:3000")!
    }
}

@MainActor
final class PushCenter {
    static let shared = PushCenter()
    var session: Session?
    var onOpenOrder: ((String) -> Void)?
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        Task { @MainActor in try? await PushCenter.shared.session?.api.registerDevice(token: hex, bundleId: bundleId) }
    }

    // Show banners even while the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // Tapping a notification deep-links to the order.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let orderId = response.notification.request.content.userInfo["orderId"] as? String else { return }
        await MainActor.run { PushCenter.shared.onOpenOrder?(orderId) }
    }
}

@main
struct LendCustomerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var session = Session(baseURL: AppConfig.apiURL)
    @State private var deepLinkOrderId: String?
    private let cache: SkuCache? = (try? SkuCache.makeContainer()).map { SkuCache(modelContainer: $0) }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isRestoring {
                    ProgressView()
                } else if session.user != nil {
                    CustomerRootView(session: session, cache: cache, deepLinkOrderId: $deepLinkOrderId)
                } else {
                    AuthView(session: session, role: .customer)
                }
            }
            .task {
                PushCenter.shared.session = session
                PushCenter.shared.onOpenOrder = { deepLinkOrderId = $0 }
                await session.restore()
            }
            .task(id: session.user?.id) {
                guard session.user != nil else { return }
                let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
                if granted { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }
}

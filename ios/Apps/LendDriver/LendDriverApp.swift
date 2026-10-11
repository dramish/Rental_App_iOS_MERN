import SwiftUI
import UIKit
import UserNotifications
import AppCore
import AuthFeature
import DriverFeatures
import Networking

enum AppConfig {
    static var apiURL: URL {
        let raw = Bundle.main.object(forInfoDictionaryKey: "LendAPIURL") as? String ?? "http://localhost:3000"
        return URL(string: raw) ?? URL(string: "http://localhost:3000")!
    }
}

@MainActor
final class PushCenter {
    static let shared = PushCenter()
    var session: Session?
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

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

@main
struct LendDriverApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var session = Session(baseURL: AppConfig.apiURL)

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isRestoring {
                    ProgressView()
                } else if session.user != nil {
                    DriverRootView(session: session)
                } else {
                    AuthView(session: session, role: .driver)
                }
            }
            .task {
                PushCenter.shared.session = session
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

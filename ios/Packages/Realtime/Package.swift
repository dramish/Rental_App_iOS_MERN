// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Realtime",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "Realtime", targets: ["Realtime"])],
    targets: [
        .target(name: "Realtime"),
        .testTarget(name: "RealtimeTests", dependencies: ["Realtime"]),
    ]
)

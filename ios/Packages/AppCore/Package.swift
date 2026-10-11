// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AppCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "AppCore", targets: ["AppCore"])],
    dependencies: [
        .package(path: "../Networking"),
        .package(path: "../Persistence"),
        .package(path: "../Realtime"),
    ],
    targets: [
        .target(name: "AppCore", dependencies: [
            .product(name: "Networking", package: "Networking"),
            .product(name: "Persistence", package: "Persistence"),
            .product(name: "Realtime", package: "Realtime"),
        ]),
        .testTarget(name: "AppCoreTests", dependencies: ["AppCore"]),
    ]
)

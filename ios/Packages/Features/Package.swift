// swift-tools-version:5.9
import PackageDescription

let deps: [Target.Dependency] = [
    .product(name: "AppCore", package: "AppCore"),
    .product(name: "Networking", package: "Networking"),
    .product(name: "Persistence", package: "Persistence"),
    .product(name: "Realtime", package: "Realtime"),
    .product(name: "DesignSystem", package: "DesignSystem"),
]

let package = Package(
    name: "Features",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AuthFeature", targets: ["AuthFeature"]),
        .library(name: "CustomerFeatures", targets: ["CustomerFeatures"]),
        .library(name: "DriverFeatures", targets: ["DriverFeatures"]),
    ],
    dependencies: [
        .package(path: "../AppCore"),
        .package(path: "../Networking"),
        .package(path: "../Persistence"),
        .package(path: "../Realtime"),
        .package(path: "../DesignSystem"),
        .package(path: "../LocationKit"),
        .package(path: "../LiveActivityShared"),
    ],
    targets: [
        .target(name: "AuthFeature", dependencies: deps),
        .target(name: "CustomerFeatures", dependencies: deps + [.product(name: "LiveActivityShared", package: "LiveActivityShared")]),
        .target(name: "DriverFeatures", dependencies: deps + [.product(name: "LocationKit", package: "LocationKit")]),
    ]
)

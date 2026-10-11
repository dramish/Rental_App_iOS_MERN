// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LocationKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LocationKit", targets: ["LocationKit"])],
    dependencies: [.package(path: "../Networking")],
    targets: [
        .target(name: "LocationKit", dependencies: [.product(name: "Networking", package: "Networking")]),
        .testTarget(name: "LocationKitTests", dependencies: ["LocationKit"]),
    ]
)

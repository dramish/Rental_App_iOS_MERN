// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Persistence",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "Persistence", targets: ["Persistence"])],
    dependencies: [.package(path: "../Networking")],
    targets: [
        .target(name: "Persistence", dependencies: [.product(name: "Networking", package: "Networking")]),
    ]
)

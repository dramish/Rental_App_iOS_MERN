// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LocationKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LocationKit", targets: ["LocationKit"])],
    targets: [.target(name: "LocationKit")]
)

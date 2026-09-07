// swift-tools-version:5.9
// Created once by @contractkit/plugin-swift. Yours to edit — it is never regenerated.
import PackageDescription

let package = Package(
    name: "ExampleSdk",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .tvOS(.v15),
        .watchOS(.v8),
    ],
    products: [
        .library(name: "ExampleSdk", targets: ["ExampleSdk"]),
    ],
    targets: [
        .target(name: "ExampleSdk"),
    ]
)

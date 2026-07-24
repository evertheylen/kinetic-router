// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "KineticRouterNative",
    platforms: [
        .iOS(.v26),
    ],
    products: [
        .library(
            name: "KineticRouterNative",
            targets: ["KineticRouterNative"]
        ),
    ],
    targets: [
        .target(
            name: "KineticRouterNative"
        ),
        .testTarget(
            name: "KineticRouterNativeTests",
            dependencies: ["KineticRouterNative"]
        ),
    ]
)

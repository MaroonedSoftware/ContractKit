/**
 * The `Package.swift` a generated SDK needs to build on its own.
 *
 * Emitted with `ifAbsent`, so it is created once and then belongs to the user: a project will add
 * dependencies, a test target, and platforms of its own, and regenerating over that would throw
 * the work away. Generated Swift sources are rewritten every run; this file is not.
 */

/**
 * What the scaffold pins. One object so a bump is one edit. The platform floors are the oldest
 * releases with `async`/`await` and the `URLSession` the runtime uses.
 */
export const SCAFFOLD = {
    toolsVersion: '5.9',
    platforms: {
        iOS: 'v15',
        macOS: 'v12',
        tvOS: 'v15',
        watchOS: 'v8',
    },
} as const;

export function generatePackageSwift(moduleName: string): string {
    const platforms = Object.entries(SCAFFOLD.platforms)
        .map(([platform, version]) => `        .${platform}(.${version}),`)
        .join('\n');
    return `// swift-tools-version:${SCAFFOLD.toolsVersion}
// Created once by @contractkit/plugin-swift. Yours to edit — it is never regenerated.
import PackageDescription

let package = Package(
    name: "${moduleName}",
    platforms: [
${platforms}
    ],
    products: [
        .library(name: "${moduleName}", targets: ["${moduleName}"]),
    ],
    targets: [
        .target(name: "${moduleName}"),
    ]
)
`;
}

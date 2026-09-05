/**
 * The Gradle files a generated SDK needs to build on its own.
 *
 * Emitted with `ifAbsent`, so they are created once and then belong to the user: a project will
 * add targets, a group, a publishing block, and a version of its own, and regenerating over that
 * would throw the work away. Generated Kotlin sources are rewritten every run; these are not.
 */

/**
 * Versions the scaffold pins. One object so a bump is one edit, and so the set is visibly a
 * matched pair — kotlinx.serialization tracks the compiler plugin's version closely.
 */
export const SCAFFOLD_VERSIONS = {
    kotlin: '2.3.0',
    serialization: '1.10.0',
    datetime: '0.8.0',
    coroutines: '1.10.2',
    ktor: '3.3.3',
} as const;

export function generateBuildGradleKts(): string {
    const v = SCAFFOLD_VERSIONS;
    return `// Created once by @contractkit/plugin-kotlin. Yours to edit — it is never regenerated.
plugins {
    kotlin("multiplatform") version "${v.kotlin}"
    kotlin("plugin.serialization") version "${v.kotlin}"
}

repositories {
    mavenCentral()
}

kotlin {
    jvm()
    // Add the targets you ship, for example:
    //     iosArm64(); iosSimulatorArm64(); js(IR) { browser() }
    // Each target needs a Ktor engine of its own — ktor-client-darwin, ktor-client-js, and so on.
    // Without one on the classpath, HttpClient() has no engine to find at runtime.

    sourceSets {
        commonMain.dependencies {
            // \`api\` rather than \`implementation\`: the generated types appear in the SDK's public
            // signatures, so callers need these on their own compile classpath.
            api("io.ktor:ktor-client-core:${v.ktor}")
            api("org.jetbrains.kotlinx:kotlinx-serialization-json:${v.serialization}")
            api("org.jetbrains.kotlinx:kotlinx-datetime:${v.datetime}")
            api("org.jetbrains.kotlinx:kotlinx-coroutines-core:${v.coroutines}")
        }
        jvmMain.dependencies {
            implementation("io.ktor:ktor-client-cio:${v.ktor}")
        }
    }
}
`;
}

export function generateSettingsGradleKts(sdkName: string): string {
    return `// Created once by @contractkit/plugin-kotlin. Yours to edit — it is never regenerated.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "${toGradleProjectName(sdkName)}"
`;
}

export function generateGradleProperties(): string {
    return `# Created once by @contractkit/plugin-kotlin. Yours to edit — it is never regenerated.
kotlin.code.style=official
org.gradle.jvmargs=-Xmx2g
`;
}

/** A Gradle project name from the SDK class name: `AcmeSdk` becomes `acme-sdk`. */
function toGradleProjectName(sdkName: string): string {
    return (
        sdkName
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'sdk'
    );
}

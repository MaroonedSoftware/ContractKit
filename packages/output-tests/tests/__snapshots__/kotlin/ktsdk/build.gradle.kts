// Created once by @contractkit/plugin-kotlin. Yours to edit — it is never regenerated.
plugins {
    kotlin("multiplatform") version "2.3.0"
    kotlin("plugin.serialization") version "2.3.0"
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
            // `api` rather than `implementation`: the generated types appear in the SDK's public
            // signatures, so callers need these on their own compile classpath.
            api("io.ktor:ktor-client-core:3.3.3")
            api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.10.0")
            api("org.jetbrains.kotlinx:kotlinx-datetime:0.8.0")
            api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
        }
        jvmMain.dependencies {
            implementation("io.ktor:ktor-client-cio:3.3.3")
        }
    }
}

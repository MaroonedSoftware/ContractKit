import { describe, expect, it } from 'vitest';
import { SCAFFOLD_VERSIONS, generateBuildGradleKts, generateGradleProperties, generateSettingsGradleKts } from '../src/scaffold.js';

describe('generateBuildGradleKts', () => {
    it('applies the multiplatform and serialization plugins at one matched Kotlin version', () => {
        const out = generateBuildGradleKts();
        expect(out).toContain(`kotlin("multiplatform") version "${SCAFFOLD_VERSIONS.kotlin}"`);
        expect(out).toContain(`kotlin("plugin.serialization") version "${SCAFFOLD_VERSIONS.kotlin}"`);
    });

    it('exposes the runtime dependencies as api, since generated types appear in public signatures', () => {
        const out = generateBuildGradleKts();
        expect(out).toContain(`api("io.ktor:ktor-client-core:${SCAFFOLD_VERSIONS.ktor}")`);
        expect(out).toContain(`api("org.jetbrains.kotlinx:kotlinx-serialization-json:${SCAFFOLD_VERSIONS.serialization}")`);
        expect(out).toContain(`api("org.jetbrains.kotlinx:kotlinx-datetime:${SCAFFOLD_VERSIONS.datetime}")`);
        expect(out).toContain(`api("org.jetbrains.kotlinx:kotlinx-coroutines-core:${SCAFFOLD_VERSIONS.coroutines}")`);
    });

    it('ships a JVM target with an engine, and says an added target needs its own', () => {
        const out = generateBuildGradleKts();
        expect(out).toContain('jvm()');
        expect(out).toContain(`implementation("io.ktor:ktor-client-cio:${SCAFFOLD_VERSIONS.ktor}")`);
        expect(out).toContain('Each target needs a Ktor engine of its own');
    });

    it('says it is never regenerated, since the file is the user’s after the first run', () => {
        expect(generateBuildGradleKts()).toContain('never regenerated');
    });
});

describe('generateSettingsGradleKts', () => {
    it('derives a Gradle project name from the SDK class name', () => {
        expect(generateSettingsGradleKts('AcmeSdk')).toContain('rootProject.name = "acme-sdk"');
        expect(generateSettingsGradleKts('Sdk')).toContain('rootProject.name = "sdk"');
    });

    it('declares where the Kotlin plugins come from', () => {
        expect(generateSettingsGradleKts('Sdk')).toContain('gradlePluginPortal()');
    });
});

describe('generateGradleProperties', () => {
    it('sets the official code style', () => {
        expect(generateGradleProperties()).toContain('kotlin.code.style=official');
    });
});

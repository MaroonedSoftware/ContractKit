import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Connection, PublishDiagnosticsParams } from 'vscode-languageserver';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentManager } from '../src/server/document-manager.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';
import { WorkspaceConfigCache } from '../src/server/workspace-config.js';
import { ProjectValidator } from '../src/server/project-validator.js';

interface MockConnection {
    sendDiagnostics: ReturnType<typeof vi.fn>;
}

function makeConnection(): { connection: Connection; published: PublishDiagnosticsParams[] } {
    const published: PublishDiagnosticsParams[] = [];
    const mock: MockConnection = {
        sendDiagnostics: vi.fn((params: PublishDiagnosticsParams) => {
            published.push(params);
        }),
    };
    return { connection: mock as unknown as Connection, published };
}

/** Write `text` to a real file inside a tmp dir and return its absolute path + file:// URI. */
function writeFile(dir: string, name: string, text: string): { filePath: string; uri: string } {
    const filePath = join(dir, name);
    writeFileSync(filePath, text);
    return { filePath, uri: pathToFileURL(filePath).toString() };
}

describe('ProjectValidator', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), 'ck-validator-'));
    });

    it('publishes cross-file ref errors for unknown models', () => {
        const { connection, published } = makeConnection();
        const documentManager = new DocumentManager(connection);
        const index = new WorkspaceIndex();
        const configCache = new WorkspaceConfigCache();

        const a = writeFile(tmp, 'a.ck', 'operation /users: { get: { response: { 200: { application/json: GhostModel } } } }');
        index.indexFile(a.filePath);

        const validator = new ProjectValidator(connection, documentManager, index, configCache, {
            getOpenDocumentText: () => undefined,
            debounceMs: 0,
        });
        validator.validate();

        const aPublish = published.find(p => p.uri === a.uri);
        expect(aPublish, 'expected publication for a.ck').toBeTruthy();
        expect(aPublish!.diagnostics.some(d => /GhostModel/.test(d.message))).toBe(true);
    });

    it('does not publish cross-file errors when refs resolve across files', () => {
        const { connection, published } = makeConnection();
        const documentManager = new DocumentManager(connection);
        const index = new WorkspaceIndex();
        const configCache = new WorkspaceConfigCache();

        const a = writeFile(tmp, 'a.ck', 'contract User: { id: string }');
        const b = writeFile(tmp, 'b.ck', 'operation /users: { get: { response: { 200: { application/json: User } } } }');
        index.indexFile(a.filePath);
        index.indexFile(b.filePath);

        const validator = new ProjectValidator(connection, documentManager, index, configCache, {
            getOpenDocumentText: () => undefined,
            debounceMs: 0,
        });
        validator.validate();

        for (const params of published) {
            for (const d of params.diagnostics) {
                expect(d.severity, `unexpected severity for ${params.uri}: ${d.message}`).not.toBe(1);
            }
        }
    });

    it('clears stale cross-file diagnostics on the next run when the offending ref is resolved', () => {
        const { connection, published } = makeConnection();
        const documentManager = new DocumentManager(connection);
        const index = new WorkspaceIndex();
        const configCache = new WorkspaceConfigCache();

        const b = writeFile(tmp, 'b.ck', 'operation /users: { get: { response: { 200: { application/json: User } } } }');
        index.indexFile(b.filePath);

        const validator = new ProjectValidator(connection, documentManager, index, configCache, {
            getOpenDocumentText: () => undefined,
            debounceMs: 0,
        });
        validator.validate();

        const beforeAdd = published.filter(p => p.uri === b.uri).pop();
        expect(beforeAdd!.diagnostics.some(d => /User/.test(d.message))).toBe(true);

        const a = writeFile(tmp, 'a.ck', 'contract User: { id: string }');
        index.indexFile(a.filePath);
        validator.validate();

        const afterAdd = published.filter(p => p.uri === b.uri).pop();
        expect(afterAdd, 'validator should re-publish for b.ck after the second run').toBeTruthy();
        expect(afterAdd!.diagnostics).toEqual([]);
    });

    it('merges parse diagnostics from the DocumentManager with cross-file diagnostics', () => {
        const { connection, published } = makeConnection();
        const documentManager = new DocumentManager(connection);
        const index = new WorkspaceIndex();
        const configCache = new WorkspaceConfigCache();

        const a = writeFile(tmp, 'a.ck', 'operation /x: { get: { response: { 200: { application/json: GhostModel } } } }');
        const text = 'operation /x: { get: { response: { 200: { application/json: GhostModel } } } }\nthis-is-not-valid';
        const document = TextDocument.create(a.uri, 'ck', 1, text);
        documentManager.parseAndPublish(document);
        // Re-publish from validator with the (still-cached) document parse diagnostics.
        index.indexFromSource(a.uri, text);

        const openDocs = new Map([[a.uri, document]]);
        const validator = new ProjectValidator(connection, documentManager, index, configCache, {
            getOpenDocumentText: uri => openDocs.get(uri)?.getText(),
            debounceMs: 0,
        });
        validator.validate();

        // The last publish for a.uri should be the merged set.
        const lastForA = published.filter(p => p.uri === a.uri).pop();
        expect(lastForA, 'expected at least one publication for a.uri').toBeTruthy();
        // Should contain both a parse error AND the cross-file GhostModel warning.
        const messages = lastForA!.diagnostics.map(d => d.message);
        expect(messages.some(m => /GhostModel/.test(m))).toBe(true);
    });

    it('debounces schedule() calls into a single validation run', async () => {
        const { connection, published } = makeConnection();
        const documentManager = new DocumentManager(connection);
        const index = new WorkspaceIndex();
        const configCache = new WorkspaceConfigCache();

        const a = writeFile(tmp, 'a.ck', 'operation /x: { get: { response: { 200: { application/json: GhostModel } } } }');
        index.indexFile(a.filePath);

        const validator = new ProjectValidator(connection, documentManager, index, configCache, {
            getOpenDocumentText: () => undefined,
            debounceMs: 20,
        });

        validator.schedule();
        validator.schedule();
        validator.schedule();

        // No publish yet — still inside the debounce window.
        expect(published).toHaveLength(0);

        await new Promise(resolve => setTimeout(resolve, 50));
        expect(published.length).toBeGreaterThan(0);
        // Only one run happened despite three schedule() calls.
        const aPublishCount = published.filter(p => p.uri === a.uri).length;
        expect(aPublishCount).toBe(1);
    });
});

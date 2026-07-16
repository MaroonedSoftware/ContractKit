import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import { getDefinition } from '../src/server/definition-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';
import { WorkspaceConfigCache } from '../src/server/workspace-config.js';
import type { ParsedDocument } from '../src/server/document-manager.js';

describe('getDefinition', () => {
    it('returns null when cursor is not on an identifier', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: string\n}');
        const index = new WorkspaceIndex();
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 0 } }, doc, index);
        expect(def).toBeNull();
    });

    it('jumps to model declaration with precise range pointing at the name', () => {
        const userSrc = `\
# Comment line
contract User: {
    name: string
}
`;
        const doc = TextDocument.create('file:///main.ck', 'contract-ck', 1, 'contract Wrapper: {\n    user: User\n}');
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);

        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 12 } }, doc, index);

        expect(def).not.toBeNull();
        expect(def!.uri).toBe('file:///user.ck');
        // `contract User:` is on the second line (zero-based 1); `User` starts at column 9
        expect(def!.range).toEqual({
            start: { line: 1, character: 9 },
            end: { line: 1, character: 13 },
        });
    });

    it('jumps to service declaration in options.services block', () => {
        const opSrc = `\
options {
    services: {
        PaymentsService: "#src/services/payments.service.js"
    }
}

operation /payments: {
    get: {
        service: PaymentsService.list
    }
}
`;
        const doc = TextDocument.create('file:///ops.ck', 'contract-ck', 1, opSrc);
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///ops.ck', opSrc);

        // Cursor on `PaymentsService` in the `service:` line
        const usageLine = 8;
        const usageChar = opSrc.split('\n')[usageLine]!.indexOf('PaymentsService') + 3;
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: usageLine, character: usageChar } }, doc, index);

        expect(def).not.toBeNull();
        expect(def!.uri).toBe('file:///ops.ck');
        // `PaymentsService:` is on line index 2, indented 8 spaces
        expect(def!.range).toEqual({
            start: { line: 2, character: 8 },
            end: { line: 2, character: 23 },
        });
    });

    it('returns null for unknown words', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: Unknown\n}');
        const index = new WorkspaceIndex();
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 9 } }, doc, index);
        expect(def).toBeNull();
    });

    it('resolves a model name that is the last token on a line when the cursor is at end-of-line', () => {
        const lineText = '    user: User';
        const doc = TextDocument.create('file:///main.ck', 'contract-ck', 1, `contract Wrapper: {\n${lineText}\n}`);
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: {\n    name: string\n}\n');
        // Cursor immediately after the trailing `User` reference — character === line length
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: lineText.length } }, doc, index);
        expect(def).not.toBeNull();
        expect(def!.uri).toBe('file:///user.ck');
    });
});

describe('getDefinition — service method resolution', () => {
    const TMP = path.join(os.tmpdir(), `ck-def-service-${process.pid}`);
    const CK_FILE = path.join(TMP, 'contracts', 'pet.ck');
    const SERVICE_TS = path.join(TMP, 'apps', 'api', 'src', 'modules', 'pet', 'pet.service.ts');

    const CK_SOURCE = `\
options {
    services: {
        PetService: "#src/modules/pet/pet.service.js"
    }
}

operation /pets/{id}: {
    params: { id: uuid }
    get: {
        service: PetService.getById
    }
}
`;

    const SERVICE_SOURCE = `\
export class PetService {
    async getById(id: string) {
        return { id };
    }
}
`;

    function parsedFor(source: string): ParsedDocument {
        const diag = new DiagnosticCollector();
        return { ast: parseCk(source, CK_FILE, diag), version: 1 };
    }

    beforeAll(() => {
        fs.mkdirSync(path.dirname(CK_FILE), { recursive: true });
        fs.mkdirSync(path.dirname(SERVICE_TS), { recursive: true });
        fs.writeFileSync(CK_FILE, CK_SOURCE);
        fs.writeFileSync(SERVICE_TS, SERVICE_SOURCE);
        fs.writeFileSync(
            path.join(TMP, 'apps', 'api', 'package.json'),
            JSON.stringify({ name: 'api', imports: { '#src/*': './src/*' } }),
        );
        fs.writeFileSync(
            path.join(TMP, 'contractkit.config.json'),
            JSON.stringify({
                rootDir: '.',
                plugins: { '@contractkit/plugin-typescript': { server: { baseDir: 'apps/api/' } } },
            }),
        );
    });

    afterAll(() => {
        fs.rmSync(TMP, { recursive: true, force: true });
    });

    it('jumps to the TS service method when the cursor is on the method segment', () => {
        const uri = pathToFileURL(CK_FILE).toString();
        const doc = TextDocument.create(uri, 'contract-ck', 1, CK_SOURCE);
        const index = new WorkspaceIndex();
        index.indexFromSource(uri, CK_SOURCE);

        const methodLine = CK_SOURCE.split('\n').findIndex(l => l.includes('service: PetService.getById'));
        const methodChar = CK_SOURCE.split('\n')[methodLine]!.indexOf('getById') + 2;

        const def = getDefinition(
            { textDocument: { uri }, position: { line: methodLine, character: methodChar } },
            doc,
            index,
            parsedFor(CK_SOURCE),
            new WorkspaceConfigCache(),
        );

        expect(def).not.toBeNull();
        expect(def!.uri).toBe(pathToFileURL(SERVICE_TS).toString());
        // `async getById(` is on line index 1; `getById` starts at column 10.
        expect(def!.range).toEqual({
            start: { line: 1, character: 10 },
            end: { line: 1, character: 17 },
        });
    });

    it('still jumps to the .ck service declaration when the cursor is on the class segment', () => {
        const uri = pathToFileURL(CK_FILE).toString();
        const doc = TextDocument.create(uri, 'contract-ck', 1, CK_SOURCE);
        const index = new WorkspaceIndex();
        index.indexFromSource(uri, CK_SOURCE);

        const usageLine = CK_SOURCE.split('\n').findIndex(l => l.includes('service: PetService.getById'));
        const usageChar = CK_SOURCE.split('\n')[usageLine]!.indexOf('PetService') + 2;

        const def = getDefinition(
            { textDocument: { uri }, position: { line: usageLine, character: usageChar } },
            doc,
            index,
            parsedFor(CK_SOURCE),
            new WorkspaceConfigCache(),
        );

        expect(def).not.toBeNull();
        expect(def!.uri).toBe(uri);
        // Points at the `PetService:` declaration inside options.services (line index 2).
        expect(def!.range.start.line).toBe(2);
    });

    it('returns null on the method segment when parsed/config context is absent', () => {
        const uri = pathToFileURL(CK_FILE).toString();
        const doc = TextDocument.create(uri, 'contract-ck', 1, CK_SOURCE);
        const index = new WorkspaceIndex();
        index.indexFromSource(uri, CK_SOURCE);

        const methodLine = CK_SOURCE.split('\n').findIndex(l => l.includes('service: PetService.getById'));
        const methodChar = CK_SOURCE.split('\n')[methodLine]!.indexOf('getById') + 2;

        const def = getDefinition({ textDocument: { uri }, position: { line: methodLine, character: methodChar } }, doc, index);
        expect(def).toBeNull();
    });
});

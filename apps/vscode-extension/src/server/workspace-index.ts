import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import type { ModelNode, OpRouteNode } from '@contractkit/core';

export interface ModelEntry {
    uri: string;
    line: number;
    /** Zero-based column where the model name starts on its declaration line. */
    column: number;
    model: ModelNode;
}

export interface RouteEntry {
    uri: string;
    line: number;
    route: OpRouteNode;
}

export interface ServiceEntry {
    uri: string;
    line: number;
    serviceName: string;
}

/** Location of a service declaration inside an `options { services { ... } }` block. */
export interface ServiceDeclEntry {
    uri: string;
    line: number;
    column: number;
}

/** A single textual reference site for a model or service name. */
export interface Reference {
    uri: string;
    /** 1-based line number, matching the AST `SourceLocation.line` convention. */
    line: number;
    /** 0-based column where the identifier starts. */
    column: number;
    /** Identifier length in characters — useful when constructing an LSP `Range`. */
    length: number;
    /** True if this reference site is the declaration itself (the line where the model/service is defined). */
    isDeclaration?: boolean;
}

export class WorkspaceIndex {
    private models = new Map<string, ModelEntry>();
    private routes = new Map<string, RouteEntry>();
    private services: ServiceEntry[] = [];
    private serviceDecls = new Map<string, ServiceDeclEntry>();
    /** All reference sites for a given model name, including the declaration site (flagged with `isDeclaration`). */
    private referencesByModel = new Map<string, Reference[]>();
    /** All reference sites for a given service name (the prefix in `service: Foo.bar`), including the decl. */
    private referencesByService = new Map<string, Reference[]>();
    /** Bumped on every `indexSource` / `removeFile` call so consumers (e.g. CodeLens) can detect change without diffing. */
    private versionCounter = 0;

    getModel(name: string): ModelEntry | undefined {
        return this.models.get(name);
    }

    getAllModelNames(): string[] {
        return [...this.models.keys()];
    }

    getAllServiceNames(): string[] {
        return [...new Set(this.services.map(s => s.serviceName))];
    }

    getServiceDecl(name: string): ServiceDeclEntry | undefined {
        return this.serviceDecls.get(name);
    }

    getAllServiceDeclNames(): string[] {
        return [...this.serviceDecls.keys()];
    }

    getRoute(routePath: string): RouteEntry | undefined {
        return this.routes.get(routePath);
    }

    getAllRoutePaths(): string[] {
        return [...this.routes.keys()];
    }

    /** All reference sites for a model name. */
    getModelReferences(name: string, includeDeclaration = false): Reference[] {
        const all = this.referencesByModel.get(name) ?? [];
        return includeDeclaration ? all : all.filter(r => !r.isDeclaration);
    }

    /** All reference sites for a service name (the prefix in `service: Foo.bar`). */
    getServiceReferences(name: string, includeDeclaration = false): Reference[] {
        const all = this.referencesByService.get(name) ?? [];
        return includeDeclaration ? all : all.filter(r => !r.isDeclaration);
    }

    /** Monotonic counter incremented whenever the index changes. */
    version(): number {
        return this.versionCounter;
    }

    async indexWorkspace(workspaceFolders: string[]): Promise<void> {
        const allFiles: string[] = [];
        for (const folder of workspaceFolders) {
            allFiles.push(...(await this.walkDir(folder)));
        }
        // Two-pass: first index every file's declarations, then scan every file for references.
        // Without two passes, an early file's references to a later file's declarations would be missed.
        const fileTexts = new Map<string, string>();
        for (const filePath of allFiles) {
            try {
                const text = fs.readFileSync(filePath, 'utf-8');
                fileTexts.set(filePath, text);
                this.indexFileDecls(filePath, text);
            } catch {
                // Skip unreadable
            }
        }
        for (const [filePath, text] of fileTexts) {
            this.scanReferences(pathToUri(filePath), text);
        }
        this.versionCounter++;
    }

    async indexFolder(folder: string): Promise<void> {
        const entries = await this.walkDir(folder);
        for (const filePath of entries) {
            this.indexFile(filePath);
        }
    }

    indexFile(filePath: string): void {
        const uri = pathToUri(filePath);
        this.removeFile(uri);

        let text: string;
        try {
            text = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return;
        }

        this.indexFileDecls(filePath, text);
        this.scanReferences(uri, text);
        this.versionCounter++;
    }

    indexFromSource(uri: string, text: string): void {
        this.removeFile(uri);
        const filePath = uriToFilePath(uri);
        this.indexFileDecls(filePath, text);
        this.scanReferences(uri, text);
        this.versionCounter++;
    }

    private indexFileDecls(filePath: string, text: string): void {
        const uri = pathToUri(filePath);
        const diag = new DiagnosticCollector();
        try {
            const ast = parseCk(text, filePath, diag);
            const lines = text.split('\n');
            for (const model of ast.models) {
                const column = findIdentifierColumn(lines, model.loc.line, model.name);
                this.models.set(model.name, { uri, line: model.loc.line, column, model });
            }
            for (const route of ast.routes) {
                this.routes.set(route.path, { uri, line: route.loc.line, route });
                for (const op of route.operations) {
                    if (op.service) {
                        this.services.push({
                            uri,
                            line: op.loc.line,
                            serviceName: op.service,
                        });
                    }
                }
            }
            if (ast.services) {
                for (const serviceName of Object.keys(ast.services)) {
                    const decl = findServiceDeclLocation(lines, serviceName);
                    if (decl) {
                        this.serviceDecls.set(serviceName, { uri, ...decl });
                    }
                }
            }
        } catch {
            // Skip files that fail to parse
        }
    }

    /** Scan a file's text for `\bName\b` occurrences of every known model and service. */
    private scanReferences(uri: string, text: string): void {
        const lines = text.split('\n');
        const modelNames = [...this.models.keys()];
        const serviceNames = [...this.serviceDecls.keys()];
        if (modelNames.length === 0 && serviceNames.length === 0) return;

        const modelRe = modelNames.length > 0 ? new RegExp(`\\b(${modelNames.map(escapeRegex).join('|')})\\b`, 'g') : null;
        const serviceRe = serviceNames.length > 0 ? new RegExp(`\\b(${serviceNames.map(escapeRegex).join('|')})\\b`, 'g') : null;

        for (let i = 0; i < lines.length; i++) {
            const scannable = stripStringsAndComments(lines[i]!);
            const lineNum = i + 1;
            if (modelRe) {
                for (const m of scannable.matchAll(modelRe)) {
                    const name = m[1]!;
                    const decl = this.models.get(name);
                    const isDeclaration = !!decl && decl.uri === uri && decl.line === lineNum && decl.column === m.index;
                    appendRef(this.referencesByModel, name, { uri, line: lineNum, column: m.index!, length: name.length, isDeclaration });
                }
            }
            if (serviceRe) {
                for (const m of scannable.matchAll(serviceRe)) {
                    const name = m[1]!;
                    const decl = this.serviceDecls.get(name);
                    const isDeclaration = !!decl && decl.uri === uri && decl.line === lineNum && decl.column === m.index;
                    appendRef(this.referencesByService, name, { uri, line: lineNum, column: m.index!, length: name.length, isDeclaration });
                }
            }
        }
    }

    removeFile(uri: string): void {
        for (const [name, entry] of this.models) {
            if (entry.uri === uri) this.models.delete(name);
        }
        for (const [routePath, entry] of this.routes) {
            if (entry.uri === uri) this.routes.delete(routePath);
        }
        for (const [name, entry] of this.serviceDecls) {
            if (entry.uri === uri) this.serviceDecls.delete(name);
        }
        this.services = this.services.filter(s => s.uri !== uri);
        for (const [name, refs] of this.referencesByModel) {
            const filtered = refs.filter(r => r.uri !== uri);
            if (filtered.length === 0) this.referencesByModel.delete(name);
            else this.referencesByModel.set(name, filtered);
        }
        for (const [name, refs] of this.referencesByService) {
            const filtered = refs.filter(r => r.uri !== uri);
            if (filtered.length === 0) this.referencesByService.delete(name);
            else this.referencesByService.set(name, filtered);
        }
        this.versionCounter++;
    }

    private async walkDir(dir: string): Promise<string[]> {
        const results: string[] = [];
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                if (entry.isDirectory()) {
                    results.push(...(await this.walkDir(fullPath)));
                } else if (entry.name.endsWith('.ck')) {
                    results.push(fullPath);
                }
            }
        } catch {
            // Directory not accessible
        }
        return results;
    }
}

function pathToUri(filePath: string): string {
    return pathToFileURL(filePath).toString();
}

function uriToFilePath(uri: string): string {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Locate the zero-based column of `name` on a given 1-based line. Returns 0 if not found. */
function findIdentifierColumn(lines: string[], line1Based: number, name: string): number {
    const idx = line1Based - 1;
    if (idx < 0 || idx >= lines.length) return 0;
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const m = re.exec(lines[idx]!);
    return m ? m.index : 0;
}

/** Find the line/column of `Name:` declarations inside an `options { services { ... } }` block. */
function findServiceDeclLocation(lines: string[], name: string): { line: number; column: number } | undefined {
    const re = new RegExp(`^(\\s*)${escapeRegex(name)}\\s*:\\s*["']`);
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (m) return { line: i + 1, column: m[1]!.length };
    }
    return undefined;
}

/** Replace string literal contents and `#`-comment tails with spaces so identifier scans skip them
 * while column positions of remaining tokens stay stable. */
function stripStringsAndComments(line: string): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
        const ch = line[i]!;
        if (ch === '#') {
            // Rest of the line is a comment.
            out += ' '.repeat(line.length - i);
            break;
        }
        if (ch === '"') {
            out += ' '; // opening quote
            i++;
            while (i < line.length && line[i] !== '"') {
                if (line[i] === '\\' && i + 1 < line.length) {
                    out += '  ';
                    i += 2;
                    continue;
                }
                out += ' ';
                i++;
            }
            if (i < line.length) {
                out += ' '; // closing quote
                i++;
            }
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

function appendRef(map: Map<string, Reference[]>, name: string, ref: Reference): void {
    const list = map.get(name);
    if (list) list.push(ref);
    else map.set(name, [ref]);
}

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

export class WorkspaceIndex {
    private models = new Map<string, ModelEntry>();
    private routes = new Map<string, RouteEntry>();
    private services: ServiceEntry[] = [];
    private serviceDecls = new Map<string, ServiceDeclEntry>();

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

    async indexWorkspace(workspaceFolders: string[]): Promise<void> {
        for (const folder of workspaceFolders) {
            await this.indexFolder(folder);
        }
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

        this.indexSource(uri, filePath, text);
    }

    indexFromSource(uri: string, text: string): void {
        this.removeFile(uri);
        const filePath = uriToFilePath(uri);
        this.indexSource(uri, filePath, text);
    }

    private indexSource(uri: string, filePath: string, text: string): void {
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

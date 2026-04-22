import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseCk, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import type { ModelNode, OpRouteNode } from '@maroonedsoftware/contractkit';

export interface ModelEntry {
    uri: string;
    line: number;
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

export class WorkspaceIndex {
    private models = new Map<string, ModelEntry>();
    private routes = new Map<string, RouteEntry>();
    private services: ServiceEntry[] = [];

    getModel(name: string): ModelEntry | undefined {
        return this.models.get(name);
    }

    getAllModelNames(): string[] {
        return [...this.models.keys()];
    }

    getAllServiceNames(): string[] {
        return [...new Set(this.services.map(s => s.serviceName))];
    }

    getRoute(routePath: string): RouteEntry | undefined {
        return this.routes.get(routePath);
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
            for (const model of ast.models) {
                this.models.set(model.name, { uri, line: model.loc.line, model });
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

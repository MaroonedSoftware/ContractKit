import * as vscode from 'vscode';
import { operationId } from '@contractkit/explorer-ui';
import type { ItemSelection, PreviewData, PreviewWarning, ResolvedOperation } from '@contractkit/explorer-ui';
import type { PreviewDataStore } from './preview-data-store.js';

/** Strategy the tree uses to bucket operations into folders. `flat` skips grouping entirely. */
export type GroupingMode = 'file' | 'area' | 'method' | 'flat';

type Node =
    | { kind: 'section'; section: 'overview' | 'endpoints' | 'models' }
    | { kind: 'group'; group: string; mode: GroupingMode }
    | { kind: 'operation'; op: ResolvedOperation }
    | { kind: 'model'; name: string };

/**
 * Native tree view for the Explorer container. Groups operations by the active GroupingMode, lists
 * models alphabetically. Warning badges appear on group nodes whose source files have diagnostics.
 * A non-empty filter narrows visible operations and models by case-insensitive substring match.
 */
export class ApiTreeProvider implements vscode.TreeDataProvider<Node> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private grouping: GroupingMode = 'file';
    private filter = '';

    constructor(private readonly store: PreviewDataStore) {
        store.onDidChangeData(() => this._onDidChangeTreeData.fire(undefined));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getGrouping(): GroupingMode {
        return this.grouping;
    }

    setGrouping(mode: GroupingMode): void {
        if (mode === this.grouping) return;
        this.grouping = mode;
        this._onDidChangeTreeData.fire(undefined);
    }

    getFilter(): string {
        return this.filter;
    }

    setFilter(filter: string): void {
        if (filter === this.filter) return;
        this.filter = filter;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: Node): vscode.TreeItem {
        switch (node.kind) {
            case 'section': {
                const label =
                    node.section === 'overview'
                        ? 'Overview'
                        : node.section === 'endpoints'
                            ? `Endpoints${this.filter ? ` (filtered: ${escapeShort(this.filter)})` : ''}`
                            : 'Models';
                const state =
                    node.section === 'overview'
                        ? vscode.TreeItemCollapsibleState.None
                        : vscode.TreeItemCollapsibleState.Expanded;
                const item = new vscode.TreeItem(label, state);
                item.iconPath = new vscode.ThemeIcon(
                    node.section === 'overview'
                        ? 'info'
                        : node.section === 'endpoints'
                            ? 'globe'
                            : 'symbol-class',
                );
                item.contextValue = `section.${node.section}`;
                if (node.section === 'overview') {
                    item.command = {
                        command: 'contractkit.openApiItem',
                        title: 'Open API Overview',
                        arguments: [{ kind: 'overview' } satisfies ItemSelection],
                    };
                }
                return item;
            }
            case 'group': {
                const item = new vscode.TreeItem(node.group, vscode.TreeItemCollapsibleState.Collapsed);
                const data = this.store.getData();
                const warnings = data ? this.warningsForGroup(node, data) : [];
                item.iconPath = warnings.length > 0
                    ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
                    : new vscode.ThemeIcon(groupIcon(node.mode));
                if (warnings.length > 0) {
                    item.description = `${warnings.length} ⚠`;
                    item.tooltip = buildGroupTooltip(node.group, warnings);
                }
                item.contextValue = 'group';
                return item;
            }
            case 'operation': {
                const label = node.op.op.name ?? node.op.op.sdk ?? node.op.routePath;
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
                item.description = node.op.method.toUpperCase();
                item.tooltip = buildOperationTooltip(node.op);
                item.contextValue = 'operation';
                item.command = {
                    command: 'contractkit.openApiItem',
                    title: 'Open API operation',
                    arguments: [{ kind: 'operation', id: operationId(node.op) } satisfies ItemSelection],
                };
                item.resourceUri = vscode.Uri.file(node.op.filePath);
                return item;
            }
            case 'model': {
                const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('symbol-class');
                item.contextValue = 'model';
                item.command = {
                    command: 'contractkit.openApiItem',
                    title: 'Open API model',
                    arguments: [{ kind: 'model', name: node.name } satisfies ItemSelection],
                };
                const data = this.store.getData();
                const m = data?.models.find(m => m.model.name === node.name);
                if (m) item.resourceUri = vscode.Uri.file(m.filePath);
                return item;
            }
        }
    }

    getChildren(node?: Node): Node[] {
        const data = this.store.getData();
        if (!node) {
            const roots: Node[] = [{ kind: 'section', section: 'overview' }];
            if (!data) return roots;
            const operations = this.filteredOperations(data);
            const models = this.filteredModels(data);
            if (operations.length > 0 || this.filter !== '') roots.push({ kind: 'section', section: 'endpoints' });
            if (models.length > 0 || this.filter !== '') roots.push({ kind: 'section', section: 'models' });
            return roots;
        }
        if (!data) return [];

        if (node.kind === 'section' && node.section === 'endpoints') {
            return this.groupOperations(this.filteredOperations(data));
        }
        if (node.kind === 'section' && node.section === 'models') {
            return this.filteredModels(data)
                .sort((a, b) => a.model.name.localeCompare(b.model.name))
                .map(m => ({ kind: 'model', name: m.model.name }) as Node);
        }
        if (node.kind === 'group') {
            const ops = this.filteredOperations(data);
            return ops
                .filter(op => groupKey(op, node.mode) === node.group)
                .sort(compareOperations)
                .map(op => ({ kind: 'operation', op }) as Node);
        }
        return [];
    }

    private groupOperations(ops: ResolvedOperation[]): Node[] {
        if (this.grouping === 'flat') return ops.sort(compareOperations).map(op => ({ kind: 'operation', op }) as Node);
        const seen = new Set<string>();
        const groups: string[] = [];
        for (const op of ops) {
            const key = groupKey(op, this.grouping);
            if (!seen.has(key)) {
                seen.add(key);
                groups.push(key);
            }
        }
        return groups.sort().map(group => ({ kind: 'group', group, mode: this.grouping }) as Node);
    }

    private filteredOperations(data: PreviewData): ResolvedOperation[] {
        if (!this.filter) return data.operations;
        const needle = this.filter.toLowerCase();
        return data.operations.filter(op => {
            return (
                op.routePath.toLowerCase().includes(needle) ||
                op.method.toLowerCase().includes(needle) ||
                op.fileGroup.toLowerCase().includes(needle) ||
                (op.op.name?.toLowerCase().includes(needle) ?? false) ||
                (op.op.sdk?.toLowerCase().includes(needle) ?? false) ||
                (op.op.service?.toLowerCase().includes(needle) ?? false)
            );
        });
    }

    private filteredModels(data: PreviewData): typeof data.models {
        if (!this.filter) return data.models;
        const needle = this.filter.toLowerCase();
        return data.models.filter(m => m.model.name.toLowerCase().includes(needle));
    }

    private warningsForGroup(node: Extract<Node, { kind: 'group' }>, data: PreviewData): PreviewWarning[] {
        const files = new Set<string>();
        for (const op of data.operations) {
            if (groupKey(op, node.mode) === node.group) files.add(op.filePath);
        }
        return data.warnings.filter(w => w.file && files.has(w.file));
    }
}

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'] as const;

function compareOperations(a: ResolvedOperation, b: ResolvedOperation): number {
    const pathCmp = a.routePath.localeCompare(b.routePath);
    if (pathCmp !== 0) return pathCmp;
    return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
}

function groupKey(op: ResolvedOperation, mode: GroupingMode): string {
    switch (mode) {
        case 'file':
            return op.fileGroup;
        case 'area':
            return op.op.service?.split('.')[0] ?? op.fileGroup;
        case 'method':
            return op.method.toUpperCase();
        case 'flat':
            return '';
    }
}

function groupIcon(mode: GroupingMode): string {
    switch (mode) {
        case 'method':
            return 'symbol-event';
        case 'area':
            return 'symbol-namespace';
        case 'file':
        case 'flat':
        default:
            return 'folder';
    }
}

function buildOperationTooltip(op: ResolvedOperation): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${op.method.toUpperCase()}** \`${op.routePath}\`\n\n`);
    if (op.op.description) md.appendMarkdown(`${op.op.description}\n\n`);
    md.appendMarkdown(`\`${op.filePath}:${op.op.loc.line}\``);
    return md;
}

function buildGroupTooltip(name: string, warnings: PreviewWarning[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${name}**\n\n⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}\n\n`);
    for (const w of warnings.slice(0, 8)) {
        md.appendMarkdown(`- ${w.message}${w.line ? ` _(line ${w.line})_` : ''}\n`);
    }
    if (warnings.length > 8) md.appendMarkdown(`\n…and ${warnings.length - 8} more.\n`);
    return md;
}

function escapeShort(value: string): string {
    return value.length > 20 ? value.slice(0, 20) + '…' : value;
}

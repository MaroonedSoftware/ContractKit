import { renderEditor, type Rendered } from './editor.ts';
import { renderPipeline } from './diagram.ts';
import { excerpt } from './excerpt.ts';
import type { Palette } from './palette.ts';
import { renderWindow } from './window.ts';

export interface Figure {
    /** File stem. Rendered to `assets/figures/<name>-dark.svg` and `-light.svg`. */
    name: string;
    /** Accessible label, and the `alt` text the docs should use. */
    title: string;
    build: (palette: Palette) => Promise<Rendered>;
}

const BILLING = 'contracts/examples/billing/subscriptions.ck';
const CATALOG = 'contracts/examples/commerce/catalog.ck';
const ORDERS = 'contracts/examples/commerce/orders.ck';
const AUTH = 'contracts/examples/identity/auth.ck';

/** Closing brace of a top-level declaration. */
const TOP_CLOSE = /^\}$/;

export const FIGURES: Figure[] = [
    {
        name: 'hero',
        title: 'A ContractKit contract: a Subscription model and the operation that creates one',
        build: async palette => {
            const model = excerpt(BILLING, "# A customer's subscription to a plan.", TOP_CLOSE);
            // The route's other verb is dropped for length; every line shown is verbatim.
            const create = excerpt(BILLING, '    post: { # start a subscription', /^ {4}\}$/);
            return await renderEditor(
                {
                    code: `${model.code}\n\noperation /subscriptions: {\n${create.code}\n}`,
                    lang: 'ck',
                    filename: 'subscriptions.ck',
                    lineNumbers: false,
                },
                palette,
            );
        },
    },
    {
        name: 'pipeline',
        title: 'One .ck file compiles to Zod schemas, a Koa router, two SDKs, OpenAPI, docs, a Bruno collection, and MCP tools',
        build: async palette => renderPipeline(palette),
    },
    {
        name: 'sdk-usage',
        title: 'Calling the generated TypeScript SDK, with types and grouping derived from the contract',
        build: async palette =>
            await renderEditor(
                {
                    code: SDK_USAGE,
                    lang: 'typescript',
                    filename: 'checkout.ts',
                    lineNumbers: false,
                },
                palette,
            ),
    },
    {
        name: 'vscode-explorer',
        title: 'The ContractKit Explorer listing every endpoint in the workspace beside the contract source',
        build: async palette => {
            const source = excerpt(CATALOG, 'operation /products/{slug}: {', '            404: { application/json: Problem }');
            return await renderWindow(
                {
                    title: 'catalog.ck — acme-api',
                    sidebar: {
                        title: 'ContractKit Explorer',
                        items: [
                            { depth: 0, label: 'commerce', expanded: true },
                            { depth: 1, label: 'catalog', expanded: true },
                            { depth: 2, label: '/products', method: 'GET', detail: 'search', selected: true },
                            { depth: 2, label: '/products', method: 'POST', detail: 'create' },
                            { depth: 2, label: '/products/{slug}', method: 'GET', detail: 'getBySlug' },
                            { depth: 2, label: '/products/{slug}', method: 'PATCH', detail: 'update' },
                            { depth: 1, label: 'orders', expanded: false, warnings: 1 },
                            { depth: 1, label: 'webhooks', expanded: false },
                            { depth: 0, label: 'identity', expanded: true },
                            { depth: 1, label: '/auth/login', method: 'POST', detail: 'login' },
                            { depth: 1, label: '/me', method: 'GET', detail: 'me' },
                            { depth: 1, label: '/me', method: 'PATCH', detail: 'updateMe' },
                        ],
                    },
                    editor: { code: source.code, lang: 'ck', filename: 'catalog.ck', firstLine: source.firstLine, columns: 62 },
                    statusBar: ['Acme API', '18 endpoints', '24 models', '1 warning'],
                },
                palette,
            );
        },
    },
    {
        name: 'vscode-preview',
        title: 'The API preview panel for POST /orders, rendered from the contract and refreshed as you type',
        build: async palette => {
            const source = excerpt(ORDERS, '    post: { # place an order', /^ {4}\}$/);
            return await renderWindow(
                {
                    title: 'orders.ck — acme-api',
                    editor: { code: source.code, lang: 'ck', filename: 'orders.ck', firstLine: source.firstLine, columns: 54 },
                    panel: {
                        method: 'POST',
                        route: '/orders',
                        subtitle: 'Place an order',
                        sections: [
                            {
                                heading: 'Security',
                                rows: [{ label: 'policy', value: 'ordersWrite' }],
                            },
                            {
                                heading: 'Headers',
                                rows: [
                                    { label: 'authorization', value: 'string', dim: 'from options' },
                                    { label: 'x-idempotency-key', value: 'string', dim: 'min 8' },
                                ],
                            },
                            {
                                heading: 'Request',
                                rows: [{ label: 'application/json', value: 'CreateOrder', dim: 'expand' }],
                            },
                            {
                                heading: 'Responses',
                                statuses: [
                                    { code: '201', label: 'Order', kind: 'ok' },
                                    { code: '402', label: 'Problem', kind: 'error' },
                                    { code: '409', label: 'Problem', kind: 'error' },
                                    { code: '422', label: 'Problem', kind: 'error' },
                                ],
                            },
                        ],
                    },
                    statusBar: ['Acme API', 'Try it out', 'Copy as cURL'],
                },
                palette,
            );
        },
    },
    {
        name: 'vscode-hover',
        title: 'Hovering a model reference shows its declaration, pulled from the file that declares it',
        build: async palette => {
            const source = excerpt(ORDERS, '# `Product` and `Money` come from catalog.ck', /^\}$/);
            return await renderEditor(
                {
                    code: source.code,
                    lang: 'ck',
                    filename: 'orders.ck',
                    firstLine: source.firstLine,
                    columns: 58,
                    cards: [
                        {
                            line: 6,
                            col: 8,
                            // The card shows exactly what the hover provider would: the
                            // declaration as it stands in the other file.
                            code: excerpt(CATALOG, 'contract Money: {', TOP_CLOSE).code,
                            body: ['**catalog.ck**', 'An amount in the smallest unit of its currency,', 'so nothing is ever a float.'],
                        },
                    ],
                },
                palette,
            );
        },
    },
    {
        name: 'vscode-completion',
        title: 'Completion offering the models declared across the workspace, not just the current file',
        build: async palette =>
            await renderEditor(
                {
                    code: COMPLETION_SNIPPET,
                    lang: 'ck',
                    filename: 'orders.ck',
                    firstLine: 61,
                    columns: 56,
                    cards: [
                        {
                            line: 4,
                            col: 13,
                            items: [
                                { icon: '◆', label: 'PaymentMethod', detail: 'discriminated · orders.ck' },
                                { icon: '◆', label: 'CardPayment', detail: 'contract · orders.ck' },
                                { icon: '◆', label: 'BankPayment', detail: 'contract · orders.ck' },
                                { icon: '◆', label: 'GiftCardPayment', detail: 'contract · orders.ck' },
                                { icon: '◇', label: 'Money', detail: 'contract · catalog.ck' },
                            ],
                        },
                    ],
                },
                palette,
            ),
    },
    {
        name: 'vscode-inlay-hints',
        title: 'Inlay hints listing inherited fields, with a reference count above each declaration',
        build: async palette => {
            // Auditable, User, and Admin: three declarations, so the third closing brace.
            const source = excerpt(AUTH, '# Fields every persisted row carries.', TOP_CLOSE, 3);
            return await renderEditor(
                {
                    code: source.code,
                    lang: 'ck',
                    filename: 'auth.ck',
                    firstLine: source.firstLine,
                    columns: 58,
                    codeLenses: [
                        { line: 2, label: '2 references' },
                        { line: 7, label: '4 references' },
                        { line: 19, label: '1 reference' },
                    ],
                    inlayHints: [
                        { line: 7, label: '+ createdAt, updatedAt' },
                        { line: 19, label: '+ id, email, displayName, …' },
                    ],
                },
                palette,
            );
        },
    },
    {
        name: 'vscode-diagnostics',
        title: 'A misspelled model reference flagged as you type, with a quick fix offering the closest name',
        build: async palette =>
            await renderEditor(
                {
                    code: DIAGNOSTIC_SNIPPET,
                    lang: 'ck',
                    filename: 'orders.ck',
                    firstLine: 61,
                    columns: 56,
                    diagnostics: [{ line: 4, col: 13, length: 13, severity: 'warning' }],
                    cards: [
                        {
                            line: 4,
                            col: 8,
                            body: ['**Unknown model: PaymentMehod**', 'ContractKit · unknown-model', '', 'Quick Fix…  Change to PaymentMethod'],
                        },
                    ],
                },
                palette,
            ),
    },
];

const SDK_USAGE = `import { AcmeSdk } from '@acme/sdk';

const sdk = new AcmeSdk({ baseUrl: 'https://api.acme.com', token });

// sdk.<area>.<subarea>.<method> — the grouping comes from the contract's keys.
const page = await sdk.commerce.catalog.search({ query: { q: 'kettle', limit: 24 } });

const order = await sdk.commerce.orders.create({
    headers: { 'x-idempotency-key': crypto.randomUUID() },
    body: {
        customerId: page.data[0].id,
        items: [{ productId, variantSku: 'KT-01-BLK', quantity: 1 }],
        payment: { kind: 'card', brand: 'visa', last4: '4242' },
        shipTo: { line1: '1 Anywhere St', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' },
    },
});

// order.status is 'pending' | 'paid' | 'fulfilled' | 'refunded' | 'canceled'
if (order.status === 'pending') await sdk.commerce.orders.get({ params: { id: order.id } });
`;

const COMPLETION_SNIPPET = `contract Order: {
    id: readonly uuid
    customerId: uuid
    payment: Pay
    shipTo: Address
}`;

const DIAGNOSTIC_SNIPPET = `contract Order: {
    id: readonly uuid
    customerId: uuid
    payment: PaymentMehod
    shipTo: Address
}`;

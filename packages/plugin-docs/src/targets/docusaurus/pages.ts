import { relative } from 'node:path/posix';
import { renderEndpointBody, renderModelBody } from '../markdown/codegen.js';
import { frontmatter, page } from '../../frontmatter.js';
import type { MarkdownDialect } from '../markdown/codegen.js';
import type { EndpointEntry, ModelEntry } from '../../naming.js';
import type { ModelNode } from '@contractkit/core';

/**
 * Markdown page rendering for Docusaurus.
 *
 * Unlike the Mintlify pages, these carry their whole body: there is no spec for Docusaurus to
 * render parameters and schemas from, so the same renderer that produces the single-file Markdown
 * reference produces each page here, with a dialect that swaps GitHub alerts for Docusaurus
 * admonitions and in-document anchors for links between pages.
 */

/**
 * Every page opts into CommonMark.
 *
 * Docusaurus parses `.md` as MDX by default, which would reject the raw `<details>` blocks, the
 * `<br>` inside table cells, and any unescaped `{` in a description. `mdx.format: md` is the
 * per-file opt-out, so a site needs no `markdown.format` configuration to take these pages.
 */
const COMMONMARK = { format: 'md' } as const;

/** Docs-root-relative path of a page, without the extension. */
export type PagePath = string;

/**
 * Where every model page lives, keyed by model name. A model missing from the map has no page —
 * either model pages are off, or the reference names something the contracts do not define — and
 * its references render as plain code.
 */
export type ModelPages = ReadonlyMap<string, PagePath>;

/**
 * The Docusaurus dialect for one page.
 *
 * A dialect is built per page because a cross-reference is a relative link: the same model is
 * `../models/user.md` from an endpoint page and `./user.md` from a sibling model page.
 */
export function docusaurusDialect(fromDir: string, modelPages: ModelPages): MarkdownDialect {
    return {
        admonition(block) {
            const head = `:::${block.kind}${block.title ? `[${block.title}]` : ''}`;
            return [head, ...block.lines, ':::'];
        },
        modelLink(name) {
            const target = modelPages.get(name);
            if (target === undefined) return undefined;
            const rel = relative(fromDir, `${target}.md`);
            // `relative` drops the leading `./` for a sibling, which Docusaurus would read as a
            // doc id rather than a file path.
            return rel.startsWith('.') ? rel : `./${rel}`;
        },
    };
}

/**
 * One endpoint page.
 *
 * The description is rendered as a lead paragraph only when it is not already the title: a
 * contract that gives no `name:` has its description promoted to the title by `deriveTitle`, and
 * printing it again below would say the same thing twice.
 */
export function renderEndpointPage(
    entry: EndpointEntry,
    opts: { position: number; fromDir: string; modelPages: ModelPages; modelIndex: Map<string, ModelNode> },
): string {
    const { op, route, title } = entry;
    const dialect = docusaurusDialect(opts.fromDir, opts.modelPages);
    const body: string[] = [];

    if (op.name && op.description) {
        body.push(op.description, '');
    }
    body.push(...renderEndpointBody(route, op, { subHeadingLevel: 2, dialect, modelIndex: opts.modelIndex }));

    return page(
        frontmatter([
            ['title', title],
            ['sidebar_label', title],
            ['sidebar_position', opts.position],
            ['mdx', COMMONMARK],
        ]),
        body.join('\n'),
    );
}

/** One model page. */
export function renderModelPage(entry: ModelEntry, opts: { position: number; fromDir: string; modelPages: ModelPages }): string {
    const { model, title } = entry;
    const dialect = docusaurusDialect(opts.fromDir, opts.modelPages);
    return page(
        frontmatter([
            ['title', title],
            ['sidebar_position', opts.position],
            ['mdx', COMMONMARK],
        ]),
        renderModelBody(model, dialect).join('\n'),
    );
}

/**
 * Starter landing page for the generated category, and the one file here the user owns. Written
 * once, so it says as little as possible: anything opinionated would be something to delete.
 */
export function renderIndexPage(label: string): string {
    return page(
        frontmatter([
            ['title', label],
            ['sidebar_position', 0],
            ['mdx', COMMONMARK],
        ]),
        [
            `This section is the generated ${label}.`,
            '',
            'This page is yours to edit — it is created once and never overwritten. The pages',
            'alongside it are generated from the contracts on every build.',
        ].join('\n'),
    );
}

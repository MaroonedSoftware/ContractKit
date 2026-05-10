import { ParameterInformation, SignatureHelp, SignatureHelpParams, SignatureInformation } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

interface ConstraintSignature {
    label: string;
    parameters: { label: string; doc: string }[];
    summary: string;
}

const SIGNATURES: Record<string, ConstraintSignature> = {
    string: {
        label: 'string(min, max, len, regex)',
        summary: 'Text string with optional length and pattern constraints.',
        parameters: [
            { label: 'min', doc: 'Minimum length (inclusive). Example: `string(min=1)`' },
            { label: 'max', doc: 'Maximum length (inclusive). Example: `string(max=255)`' },
            { label: 'len', doc: 'Exact length. Example: `string(len=3)`' },
            { label: 'regex', doc: 'Regex pattern. Example: `string(regex=/^[a-z]+$/)`' },
        ],
    },
    number: {
        label: 'number(min, max)',
        summary: 'Floating-point number with optional bounds.',
        parameters: [
            { label: 'min', doc: 'Minimum value (inclusive).' },
            { label: 'max', doc: 'Maximum value (inclusive).' },
        ],
    },
    int: {
        label: 'int(min, max)',
        summary: 'Integer number with optional bounds.',
        parameters: [
            { label: 'min', doc: 'Minimum value (inclusive).' },
            { label: 'max', doc: 'Maximum value (inclusive).' },
        ],
    },
    bigint: {
        label: 'bigint(min, max)',
        summary: 'Arbitrary-precision integer with optional bounds.',
        parameters: [
            { label: 'min', doc: 'Minimum value (inclusive).' },
            { label: 'max', doc: 'Maximum value (inclusive).' },
        ],
    },
    array: {
        label: 'array(item, min, max)',
        summary: 'Array type. The first argument is the item type; `min`/`max` constrain length.',
        parameters: [
            { label: 'item', doc: 'Element type, e.g. `string`, `User`, `array(int)`.' },
            { label: 'min', doc: 'Minimum length (inclusive).' },
            { label: 'max', doc: 'Maximum length (inclusive).' },
        ],
    },
    record: {
        label: 'record(key, value)',
        summary: 'Object with arbitrary string keys mapping to a value type.',
        parameters: [
            { label: 'key', doc: 'Key type — typically `string`.' },
            { label: 'value', doc: 'Value type, e.g. `string`, `User`, `int`.' },
        ],
    },
    enum: {
        label: 'enum(values...)',
        summary: 'Closed string enumeration. Each argument is a literal value.',
        parameters: [{ label: 'values', doc: 'One or more identifier or string literals.' }],
    },
    discriminated: {
        label: 'discriminated(by=<field>, A | B | ...)',
        summary: 'Tagged union — the first argument names the discriminator field; the rest are the union members.',
        parameters: [
            { label: 'by', doc: 'Discriminator field name. Example: `by=type`.' },
            { label: 'members', doc: 'Two or more model refs or inline objects, separated by `|`.' },
        ],
    },
    literal: {
        label: 'literal(value)',
        summary: 'A single string, number, or boolean literal value.',
        parameters: [{ label: 'value', doc: 'Literal value.' }],
    },
    lazy: {
        label: 'lazy(type)',
        summary: 'Defers resolution of a recursive type reference.',
        parameters: [{ label: 'type', doc: 'Recursive type expression.' }],
    },
};

export function getSignatureHelp(params: SignatureHelpParams, document: TextDocument): SignatureHelp | null {
    const ctx = parseCallContext(document, params.position.line, params.position.character);
    if (!ctx) return null;
    const sig = SIGNATURES[ctx.callee];
    if (!sig) return null;
    return {
        signatures: [
            {
                label: sig.label,
                documentation: { kind: 'markdown', value: sig.summary },
                parameters: sig.parameters.map<ParameterInformation>(p => ({
                    label: p.label,
                    documentation: { kind: 'markdown', value: p.doc },
                })),
            } satisfies SignatureInformation,
        ],
        activeSignature: 0,
        activeParameter: Math.min(ctx.activeParam, sig.parameters.length - 1),
    };
}

interface CallContext {
    callee: string;
    activeParam: number;
}

/** Walk back from the cursor to find the nearest unmatched `(` and the identifier before it. */
function parseCallContext(document: TextDocument, line: number, character: number): CallContext | null {
    const text = document.getText();
    const lines = text.split('\n');
    if (line >= lines.length) return null;
    const lineText = lines[line]!;
    if (character > lineText.length) return null;

    let depth = 0;
    let activeParam = 0;
    for (let i = character - 1; i >= 0; i--) {
        const ch = lineText[i]!;
        if (ch === ')') depth++;
        else if (ch === '(') {
            if (depth === 0) {
                const end = i;
                let start = i;
                while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1]!)) start--;
                if (start === end) return null;
                return { callee: lineText.slice(start, end), activeParam };
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            activeParam++;
        }
    }
    return null;
}

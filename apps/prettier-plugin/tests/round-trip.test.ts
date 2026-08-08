import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { printCk } from '../src/print-ck.js';
import { parseCk, DiagnosticCollector } from '@contractkit/core';

/**
 * Formatting a `.ck` file must not change it.
 *
 * The prettier plugin used to fold standalone `#` comment blocks into trailing comments on the
 * following declaration, reorder operation body keys, drop blank lines between operations, and
 * expand single-line response bodies — all of which silently rewrote a user's file on
 * `pnpm format`. These tests pin the guarantee: parse → print is the identity on well-formed
 * source, and printing is idempotent.
 */

function format(source: string, file = 'test.ck'): string {
    const diag = new DiagnosticCollector();
    const ast = parseCk(source, file, diag);
    expect(diag.hasErrors()).toBe(false);
    return printCk(ast);
}

// ─── Repository contracts ────────────────────────────────────────────────────

const CONTRACTS_DIR = new URL('../../../contracts', import.meta.url).pathname;
const ckFiles = readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.ck'));

describe('round-trip — repository .ck files', () => {
    it('finds .ck files to check', () => {
        expect(ckFiles.length).toBeGreaterThan(0);
    });

    for (const name of ckFiles) {
        it(`formats ${name} to itself`, () => {
            const source = readFileSync(join(CONTRACTS_DIR, name), 'utf8');
            expect(format(source, name)).toBe(source);
        });
    }
});

// ─── Constructs that previously round-tripped lossily ────────────────────────

describe('round-trip — comment placement', () => {
    it('keeps a standalone comment block above the declaration it precedes', () => {
        const source = `# ─── Pet endpoints ───

operation /pet: {
    get: {
        response: {
            200:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a contract doc comment on its own line', () => {
        const source = `# A pet for sale
contract Pet: {
    id: int
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a contract doc comment inline when written inline', () => {
        const source = `contract Pet: { # A pet for sale
    id: int
}
`;
        expect(format(source)).toBe(source);
    });

    it('distinguishes a divider from the doc comment below it', () => {
        const source = `# ─── Models ───

# A pet for sale
contract Pet: {
    id: int
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps an operation doc comment on its own line', () => {
        const source = `operation /pet: {
    # update an existing pet
    put: {
        response: {
            200:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps an operation doc comment inline when written inline', () => {
        const source = `operation /pet: {
    put: { # update an existing pet
        response: {
            200:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });
});

describe('round-trip — comments in the options block', () => {
    it('keeps a comment above a sub-block', () => {
        const source = `options {
    # where these come from
    keys: {
        area: ledger
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a comment run above the sub-block it precedes', () => {
        const source = `options {
    keys: {
        area: ledger
    }
    # service wiring
    # one per module
    services: {
        UserService: "#src/user.js"
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a trailing comment before the closing brace', () => {
        const source = `options {
    keys: {
        area: ledger
    }
    # nothing below
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps an options block that holds nothing but a comment', () => {
        const source = `options {
    # a note
}
`;
        expect(format(source)).toBe(source);
    });
});

describe('round-trip — operation body key order', () => {
    it('does not reorder keys into a canonical order', () => {
        const source = `operation /pet: {
    put: {
        sdk: updatePet
        service: PetService.update
        response: {
            200:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('preserves the opposite order just as faithfully', () => {
        const source = `operation /pet: {
    put: {
        service: PetService.update
        sdk: updatePet
        response: {
            200:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });
});

describe('round-trip — layout', () => {
    it('keeps blank lines between operations', () => {
        const source = `operation /pet: {
    get: {
        response: {
            200:
        }
    }

    post: {
        response: {
            201:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps operations packed when the source has no blank line', () => {
        const source = `operation /pet: {
    get: {
        response: {
            200:
        }
    }
    post: {
        response: {
            201:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a single-line response body on one line', () => {
        const source = `operation /pet: {
    get: {
        response: {
            200: { application/json: Pet }
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps an expanded response body expanded', () => {
        const source = `operation /pet: {
    get: {
        response: {
            200: {
                application/json: Pet
            }
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps an empty status block, which means emitted with no body', () => {
        const source = `operation /art/{id}: {
    get: {
        response: {
            200: { application/json: Art }
            304: {}
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps a bare status bare', () => {
        const source = `operation /art/{id}: {
    get: {
        response: {
            200: { application/json: Art }
            304:
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps the documented modifier on a status', () => {
        const source = `operation /pet: {
    get: {
        response: {
            200: { application/json: Pet }
            404(documented): { application/json: Problem }
            410(documented):
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });

    it('keeps every declared mime for a status, in source order', () => {
        const source = `operation /art/{id}: {
    get: {
        response: {
            200: {
                image/png: binary
                image/jpeg: binary
                headers: {
                    etag?: string
                }
            }
        }
    }
}
`;
        expect(format(source)).toBe(source);
    });
});

// ─── Idempotence ─────────────────────────────────────────────────────────────

describe('round-trip — idempotence', () => {
    const sources = [
        ...ckFiles.map(name => readFileSync(join(CONTRACTS_DIR, name), 'utf8')),
        // Non-canonical spacing: formatting once must reach a fixed point.
        `operation /pet: {\n    get: {\n        response: {\n            200:\n        }\n    }\n}\n`,
    ];

    for (const [i, source] of sources.entries()) {
        it(`formatting is a fixed point for source #${i}`, () => {
            const once = format(source);
            expect(format(once)).toBe(once);
        });
    }
});

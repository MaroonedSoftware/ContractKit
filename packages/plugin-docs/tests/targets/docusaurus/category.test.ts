import { describe, it, expect } from 'vitest';
import { generatedIndex, renderCategory } from '../../../src/targets/docusaurus/category.js';

describe('renderCategory', () => {
    it('writes the label with the repo four-space JSON style and a trailing newline', () => {
        expect(renderCategory({ label: 'Billing' })).toBe('{\n    "label": "Billing"\n}\n');
    });

    it('omits an unset position rather than writing a null', () => {
        expect(renderCategory({ label: 'Billing' })).not.toContain('position');
    });

    it('writes a position when given one', () => {
        expect(JSON.parse(renderCategory({ label: 'Billing', position: 2 }))).toEqual({ label: 'Billing', position: 2 });
    });

    it('keeps position 0, which is a real sort key and not an absent one', () => {
        expect(renderCategory({ label: 'Billing', position: 0 })).toContain('"position": 0');
    });

    it('writes a generated index link', () => {
        expect(JSON.parse(renderCategory({ label: 'Models', link: generatedIndex('Models') }))).toEqual({
            label: 'Models',
            link: { type: 'generated-index', title: 'Models' },
        });
    });
});

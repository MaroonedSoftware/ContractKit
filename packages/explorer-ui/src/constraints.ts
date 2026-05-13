import type { ScalarTypeNode } from '@contractkit/core';

/** Formats the constraint parameters on a scalar type (min/max/len/regex/format) as a parenthesized suffix. */
export function constraintSummary(scalar: ScalarTypeNode): string {
    const parts: string[] = [];
    if (scalar.min !== undefined) parts.push(`min=${scalar.min}`);
    if (scalar.max !== undefined) parts.push(`max=${scalar.max}`);
    if (scalar.len !== undefined) parts.push(`len=${scalar.len}`);
    if (scalar.regex !== undefined) parts.push(`regex=/${scalar.regex}/`);
    if (scalar.format !== undefined) parts.push(`format=${scalar.format}`);
    return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

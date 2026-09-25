/**
 * The wire grammar of a `decimal`: an optionally negative run of digits, optionally followed by a
 * point and at least one more digit. No exponent, no hex or binary prefix, no `+`, no `_`
 * separators, no bare `.5` or `5.`, no whitespace, and no `NaN` or `Infinity`.
 *
 * This is the one definition every generator uses: plugin-docs publishes it as the OpenAPI
 * `pattern`, and each SDK and server runtime checks it before handing the text to its own decimal
 * library, which on its own accepts far more (decimal.js parses `"1e5"`, `"0x1F"` and `"NaN"`).
 *
 * Written with `[0-9]` rather than `\d`, which matches non-ASCII digits in Python, .NET and ICU
 * (Swift) but not in JavaScript or the JVM. Under ECMA-262, which OpenAPI patterns follow, the two
 * spellings are equivalent, and this one means the same thing in every language that embeds it.
 */
export const DECIMAL_PATTERN = '^-?[0-9]+(\\.[0-9]+)?$';

/**
 * The wire pattern for a `decimal`, narrowed by `scale` when one is declared.
 *
 * `scale` counts decimal places after trailing zeros are dropped: the value `1.10` has one place,
 * so `"1.10"` passes `scale=1`. That is the meaning the language documents ("a validation
 * constraint, not a formatting directive"), the one pydantic's `condecimal(decimal_places=)`
 * shares, and what the TypeScript validator's `decimalPlaces() <= scale` check computes. The
 * pattern therefore allows any run of trailing zeros past the first `scale` fraction digits.
 *
 * `scale=0` needs its own form, since `[0-9]{1,0}` is not a valid quantifier: only an all-zero
 * fraction is allowed.
 */
export function decimalPattern(scale?: number): string {
    if (scale === undefined) return DECIMAL_PATTERN;
    if (scale === 0) return '^-?[0-9]+(\\.0+)?$';
    return `^-?[0-9]+(\\.[0-9]{1,${scale}}0*)?$`;
}

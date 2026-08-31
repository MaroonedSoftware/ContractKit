# Exercises the `decimal` scalar in every constrained form, so `round-trip.test.ts` proves the
# printer reproduces each one byte-for-byte. Constraint order here is the printer's canonical
# order (format, min, max, len, scale, regex) — any other order would reformat.

# A single payslip line. `scale=2` caps the decimal places accepted; it does not pad the wire
# value, which stays decimal.js-normalized.
contract PayslipLine: {
    id: uuid
    description: string
    rate: decimal # unconstrained — any exact decimal
    hours: decimal(min=0, max=744) # bounds compare as exact strings, never via a float
    gross: decimal(min=0.01, max=999999.99, scale=2)
    deduction?: decimal(scale=2) # optional and nullable both have to survive the round trip
    adjustment: decimal(scale=2) | null
}

# Collections and nested models are the paths that taint an outer model transitively.
contract Payslip: {
    id: uuid
    lines: array(PayslipLine)
    total: decimal(min=0, scale=2)
    byCategory: record(string, decimal(scale=2))
}

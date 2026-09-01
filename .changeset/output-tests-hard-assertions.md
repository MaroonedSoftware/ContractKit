---
---

Turn the output-tests baselines into hard assertions, so a regression is a red test rather than a diff someone has to notice.

The compile and parse checks were recorded as snapshots on purpose while the defects they described were still being fixed: asserting empty at the start would have landed a red test, and the shrinking file was the progress indicator. Every defect they recorded is now fixed, so they assert instead:

- **TypeScript** — `tsc` diagnostics `toEqual([])` for both the server and the SDK programs.
- **OpenAPI** — every `responses` key parses as a string.
- **Python** — no syntax errors, no f-string interpolating a name its method does not bind, no URL left with an unsubstituted placeholder.

Each was verified by reintroducing the original defect and confirming the test goes red, rather than by trusting that a passing assertion is a meaningful one.

**One exception remains, deliberately pinned rather than asserted.** A hyphenated path param (`operation /invoices/{invoice-id}`) is a valid contract but not a valid TypeScript identifier, so the generators emit `async getInvoice(invoice-id: string)` and the file does not parse. That is a real defect, and a separate one from everything in this batch — the Python side of it is fixed, the TypeScript side is not. It lives in a fixture of its own so the rest of the output can assert clean, and its diagnostics are pinned by count and content so the damage cannot spread or worsen unnoticed.

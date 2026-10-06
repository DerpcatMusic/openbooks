# Country pack template

Copy this folder to `packages/countries/<iso2>`, rename the package to `@openbooks/country-<iso2>`, then:

1. `src/manifest.ts`: names, currency, business types (`treatment` decides cross-border attribution), default chart of accounts.
2. `tables/<year>.json`: every number with a `sources` entry (`{ "field.path": { "url", "effective" } }`). Add the year in `src/index.ts`.
3. `src/schema.ts`: the table's Effect Schema (extends `TaxTableBase`).
4. `src/calc.ts`: pure functions `(input, table) → result`. No Effect, no I/O, no Date.now().
5. `playbook.json`: sourced moves (`PlaybookItem`), `strings/{en,he}.json`: `biz.<type>` and `biz.<type>.sub` at least.
6. Tests from worked examples (official calculators, guides), each citing where the expected number comes from.
7. Residence countries implement `crossBorder`. Register the pack in the server's pack list (docs/architecture.md § Country packs).

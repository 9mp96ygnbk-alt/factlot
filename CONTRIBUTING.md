# Contributing to FactLot

Thanks for helping build the open fact layer for commercial real estate.

## Ground rules

- **Correctness is the product.** Every calculator change needs test cases with expected values
  computed independently of the implementation, such as by hand, in a spreadsheet, or in another
  language. Say in the test how they were computed.
- **Formulas are versioned.** If a change can alter a calculator's output for any valid input,
  bump that calculator's `version` and note the change in the PR.
- **ID rules are permanent.** Changes to `@factlot/id` must never change the ID produced for
  existing input. Add new rules alongside the old ones; never edit them in place.
- **Cite sources.** New predicates, rules, or jurisdiction logic should link the statute,
  standard, or lease convention they encode.
- Keep pull requests small and focused. `npm run check` must pass.

## Setup

```bash
npm install
npm run check
```

Tests use `node:test` and run directly on TypeScript source. Use only erasable TypeScript
syntax: no `enum`, `namespace`, or constructor parameter properties.

## Licensing

By contributing you agree that your contribution is licensed under the license of the package
you are changing: MIT for `packages/schema`, Apache-2.0 for everything else.

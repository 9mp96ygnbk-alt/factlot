## What and why

<!-- One paragraph. Link the issue if there is one. For a calculator or rule, name the
convention, standard, or statute it encodes. -->

## Checklist

Mirrors [AGENTS.md](https://github.com/9mp96ygnbk-alt/factlot/blob/main/AGENTS.md) and
[CONTRIBUTING.md](https://github.com/9mp96ygnbk-alt/factlot/blob/main/CONTRIBUTING.md).
Tick what applies; delete lines that do not.

- [ ] `npm run check` passes locally.
- [ ] **Both SDKs changed together.** Any calculator, rule, or ID change is in `packages/*/src`
      _and_ `python/src/factlot`, and `npm run test:python` and `npm run differential` pass.
- [ ] **Expected values were computed independently** of FactLot (by hand, spreadsheet, or
      Python `decimal`), and the test or vector says how. New vectors are in `spec/vectors`.
- [ ] **Formula versions.** If any valid input could now produce a different output, the
      calculator's `version` is bumped in both registries and in its vector file.
- [ ] **IDs are unchanged** for every existing input (`@factlot/id` rules are permanent; new
      rules are added alongside old ones).
- [ ] **`npm run schemas`** was run after any input-schema change, and `spec/schemas` and
      `python/src/factlot/schemas` are committed.
- [ ] Every new input field has a `.describe()`.
- [ ] Sources are cited for new predicates, rules, or jurisdiction logic.
- [ ] **CHANGELOG.md** has a line under `## [Unreleased]` for any user-visible change.
- [ ] No AI model identifiers, API keys, or real personal data in code, fixtures, or docs.

## How it was tested

<!-- Commands run and, for data or rules work, which official file or text you checked against. -->

# AGENTS.md

These are instructions for AI coding agents working in this repository. Humans should read
[CONTRIBUTING.md](CONTRIBUTING.md) too.

## What this repo is

FactLot is an open fact layer for commercial real estate AI agents. It is a TypeScript monorepo
(`packages/*`) plus a Python SDK (`python/`). The two must produce identical results.

## Commands

```bash
npm install
npm run check          # lint, format, typecheck, TS tests, build — must pass before committing
npm run test:python    # Python SDK against the shared vectors
npm run differential   # random inputs through TS and Python; fails on any difference
npm run schemas        # regenerate spec/schemas from the TS source and copy them into the Python SDK
```

## Rules that matter here

0. **The catalog is the source of truth.** Tools are defined once in `packages/tools/src/catalog.ts`.
   MCP, REST, OpenAPI, every provider format, and the Python definitions are generated from it
   with `npm run schemas`. Never hand-edit `spec/schemas`.
1. **Both SDKs change together.** Any change to a calculator or ID rule goes into
   `packages/*/src` _and_ `python/src/factlot`. Then run `npm run test:python` and
   `npm run differential`.
2. **Expected values come from outside the code.** New vectors in `spec/vectors` must be computed
   independently, by hand or with Python `decimal`, never by running FactLot.
3. **Version formulas.** If any valid input could produce a different output, bump that calculator's
   `version` in both registries and in its vector file.
4. **Never break IDs.** `@factlot/id` must return the same ID for the same input forever.
5. **Determinism.**
   - Use `powInt` / `pow_int` for integer exponents, never `**` or `Math.pow`.
   - Round only with `round` / `round_`, which reduce to 15 significant digits and then round
     half away from zero.
   - Sum in the same order in both languages.
6. **Describe every input field** with `.describe()`. A test enforces this, because agents read
   these descriptions to fill tool arguments.
7. **TypeScript must be erasable.** Tests run with type stripping, so no `enum`, no `namespace`,
   and no constructor parameter properties.
8. After changing an input schema, run `npm run schemas` and commit `spec/schemas` and
   `python/src/factlot/schemas`.

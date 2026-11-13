# Install verification

Every way an agent developer could install FactLot on 3 November 2026, run end to end by hand on a
clean checkout of version 0.1.0, with the exact commands and results. This record has not been
re-run by hand since: the repository has since gone public and releases up to v0.5.0 have been
published, and its tool counts, file names and "not available yet" list describe 0.1.0, not the
current release. What runs on every change and every release tag instead is automated: CI
(`ci.yml`) builds the packages and the Claude Desktop extension and runs the end-to-end MCP test,
and on each tag `release-assets.yml` installs each release file the way a user would and tests it,
and `container.yml` tests the Docker image.

- **When:** 2026-11-03, 01:10 to 02:30 EST.
- **Where:** macOS 27.2 on arm64, Node.js 26.8.1, npm 11.19.0, Python 3.14.4, Docker 29.0.1.
  CI runs the same checks on Ubuntu with Node.js 22 and Python 3.12.
- **What:** branch `agent-readiness` from `main` at `b4d11c9`. Two install paths were broken
  and are fixed on this branch (marked **fixed** below).
- **Not available yet:** no npm or PyPI packages, no public repository, no GitHub release, no
  GHCR image, no hosted endpoint. Release URLs were simulated by serving the same files from a
  local HTTP server.

## Results

| #   | Install path                                                          | Result                                     |
| --- | --------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Source build, stdio MCP server (`packages/mcp/dist/bin.js`)           | Pass                                       |
| 2   | Source build, remote server: Streamable HTTP MCP, REST, OpenAPI       | Pass                                       |
| 3   | OpenAPI 3.1 and 3.0 documents, offline validation                     | 3.0 failed, **fixed**, pass                |
| 4   | Docker: `docker build`, `docker run`, HTTP and stdio                  | Pass                                       |
| 5   | Claude Desktop extension (`.mcpb`): manifest, then the bundled server | Server crashed at startup, **fixed**, pass |
| 6   | Python wheel and sdist, fresh virtual environments                    | Pass                                       |
| 7   | Python from git (`pip install "git+…#subdirectory=python"`)           | Pass (against `git+file://`)               |
| 8   | npm tarballs (`npm pack`), installed into a scratch project           | Pass                                       |
| 9   | `npx` and `npm install` from tarball URLs                             | Pass (URLs served locally)                 |
| 10  | Standalone tarball for one-line `npx -y <url>`                        | Pass (new)                                 |
| 11  | `server.json` for the MCP Registry                                    | Pass (schema validation)                   |
| 12  | New workflow files                                                    | Pass (actionlint, action-validator)        |
| 13  | Repository checks                                                     | Pass                                       |

## 1 and 2. Source build, stdio and remote MCP

```bash
npm install
npm run build
npm run test:e2e
```

`npm run test:e2e` (new, [scripts/e2e/run.ts](../scripts/e2e/run.ts)) uses the official MCP
TypeScript SDK client. Over **stdio** against `node packages/mcp/dist/bin.js`, and over
**Streamable HTTP** against `node packages/server/dist/bin.js` on a free local port, it checks:

- `initialize`: server name `factlot`, a semver version, the tools capability, and instructions.
- `tools/list`: all 19 tools that need no registry, unique names, object input schemas,
  descriptions, and `readOnlyHint: true`.
- `tools/call calc_debt_sizing`: `max_loan` 9,750,000, binding constraint `ltv`, formula ID,
  audit steps, and the same result in the text content.
- `tools/call id_parcel`: `fl:parcel:us-06037:5432001012` and a `flp_` short ID.
- `tools/call fact_validate`: a cited fact is valid; an uncited `extracted` fact is not.
- Invalid calls: wrong argument types (`isError`, names the field), a malformed URN (`isError`),
  an unknown tool (rejected), and the server still answers afterwards.

Over HTTP it also checks `GET /` and `/health`, `GET /v1/tools`, `POST /v1/calc/debt_sizing`,
`/v1/id/parcel`, and `/v1/facts/validate`, a 400 `CalcInputError` with issues for bad input, and
a 404 for an unknown route.

Result: 15 of 15 pass. One assertion was corrected while writing the test: calculator input
errors are named `CalcInputError`, not `InputError`.

## 3. OpenAPI

`npm run test:e2e` fetches `/openapi.json` and `/openapi-3.0.json` and checks the version, `info`,
`servers`, that every `$ref` resolves inside the document, that `operationId`s are unique, that
every operation has responses, and that every REST tool has a `POST` operation. Pass.

Then Redocly CLI, which needs no login:

```bash
REDOCLY_TELEMETRY=off npx -y @redocly/cli@2.72.1 lint --extends=spec \
  spec/schemas/openapi-3.1.json spec/schemas/openapi-3.0.json
```

- 3.1: valid.
- 3.0: **failed** with one error. The `fact` schema carried `propertyNames`, which the
  OpenAPI 3.0 Schema Object does not allow (some importers reject the document).
  **Fixed** in `toOpenApi30Schema` (`packages/tools/src/providers.ts`), with a unit test, and
  `npm run schemas` regenerated both copies. Now valid. CI runs this lint.
- Redocly's default `recommended` ruleset additionally reports `security-defined` for every
  operation, a missing `info.license`, a localhost `servers` URL, and an unused `bearerAuth`
  scheme. These are style rules, not spec violations: the server adds `security` to the served
  document when a key is configured, and derives `servers` from the request. Not changed.

## 4. Docker

```bash
docker build -t factlot:e2e .                                  # 1 min 59 s, 266 MB
docker run -d --name factlot-e2e -p 127.0.0.1:18787:8787 factlot:e2e
curl -s localhost:18787/health                                 # {"ok": true, "version": "0.1.0"}
docker exec factlot-e2e id                                     # uid=1000(node): not root
FACTLOT_E2E_ONLY=http FACTLOT_E2E_URL=http://127.0.0.1:18787 npm run test:e2e
FACTLOT_E2E_ONLY=stdio \
  FACTLOT_E2E_STDIO='["docker","run","-i","--rm","factlot:e2e","node","packages/mcp/dist/bin.js"]' \
  npm run test:e2e
docker rm -f factlot-e2e
```

Result: the full multi-stage build ran (it could not in the original sandbox; see
[connectors/README.md](../connectors/README.md)). HTTP 9 of 9 and stdio 6 of 6 pass. The same
image therefore serves both the remote connector and a stdio server for `docker run -i`, which
is how the MCP Registry's OCI package entry runs it.

## 5. Claude Desktop extension (`.mcpb`)

```bash
npm run build:mcpb                          # validates the manifest with mcpb 2.1.2, packs dist/factlot.mcpb
npx mcpb unpack dist/factlot.mcpb /tmp/mcpb
npx mcpb validate /tmp/mcpb/manifest.json   # Manifest schema validation passes!
npx mcpb info dist/factlot.mcpb             # 318 KB, not signed
FACTLOT_E2E_ONLY=stdio FACTLOT_E2E_STDIO='["node","/tmp/mcpb/server/index.mjs"]' npm run test:e2e
```

- Manifest: valid against the MCPB schema (`manifest_version` 0.3).
- Bundled server: **failed**. It exited immediately with
  `SyntaxError: Identifier 'createRequire' has already been declared`: the esbuild banner and
  the bundled registry module both imported `createRequire`. Every `.mcpb` built since the
  registry tools were added would have failed to start in Claude Desktop, and `mcpb validate`
  cannot see it because it checks only the manifest.
- **Fixed** in `scripts/build-mcpb.ts` by aliasing the banner import. `npm run build:mcpb` now
  also starts the bundled server, sends `initialize` and `tools/list`, and fails unless the
  listed tools equal the manifest's (confirmed to fail on the old banner). CI and
  `release-assets.yml` run the e2e test against the unpacked archive.
- Now: 6 of 6 pass against the unpacked archive. Installing through the Claude Desktop
  interface was not tested here.

## 6 and 7. Python

```bash
python3 -m venv venv-build && venv-build/bin/pip install build    # build 1.6.1, hatchling 1.33.0
venv-build/bin/python -m build --outdir pybuild python
# factlot-0.1.0-py3-none-any.whl (366 KB) and factlot-0.1.0.tar.gz (396 KB)

for f in pybuild/factlot-0.1.0-py3-none-any.whl pybuild/factlot-0.1.0.tar.gz; do
  python3 -m venv v && v/bin/pip install "$f"
  v/bin/python -I scripts/e2e/python_smoke.py 0.1.0 && rm -rf v
done

python3 -m venv v && v/bin/pip install "git+file://$PWD#subdirectory=python"
v/bin/python -I scripts/e2e/python_smoke.py 0.1.0
python3 -m venv v2 && v2/bin/pip install "factlot @ git+file://$PWD@main#subdirectory=python"
v2/bin/python -I scripts/e2e/python_smoke.py 0.1.0
```

[scripts/e2e/python_smoke.py](../scripts/e2e/python_smoke.py) (new) runs with `-I` so the import
must come from site-packages, not the checkout. It checks `__version__`, `anthropic_tools()`
(27 tools, object schemas, JSON-serializable) and `openai_tools()`, `run_tool` for
`calc_debt_sizing`, `id_parcel`, and `fact_validate`, input errors returned as data, and that the
packaged schemas load (`factlot.openapi()`).

Result: wheel, sdist, `git+file://`, and `git+file://…@main` all pass. The command shape
`pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"` is
therefore correct; it works over HTTPS once the repository is public.

## 8 to 10. npm tarballs and `npx` before the npm registry

```bash
for p in schema id calc tools mcp server; do npm pack ./packages/$p --pack-destination tgz; done
# factlot-{schema,id,calc,tools,mcp,server}-0.1.0.tgz, 10 to 100 KB each

mkdir proj && cd proj && npm init -y && npm pkg set type=module
npm install ../tgz/factlot-{schema,id,calc,tools,mcp,server}-0.1.0.tgz     # added 101 packages
node lib.mjs     # imports @factlot/calc, id, tools, mcp, server; debtSizing and parcelId values checked
FACTLOT_E2E_ONLY=stdio FACTLOT_E2E_STDIO='["proj/node_modules/.bin/factlot-mcp"]' npm run test:e2e
PORT=18788 proj/node_modules/.bin/factlot-server &
FACTLOT_E2E_ONLY=http FACTLOT_E2E_URL=http://127.0.0.1:18788 npm run test:e2e
```

Result: pass (stdio 6 of 6, HTTP 9 of 9). The tarballs must be installed together: each depends
on the others at the exact version, and npm resolves those to the tarballs given on the same
command line instead of the (empty) registry.

Release URLs, simulated with `python3 -m http.server` serving the same files:

```bash
npx -y -p <url>/factlot-schema-0.1.0.tgz -p <url>/factlot-id-0.1.0.tgz -p <url>/factlot-calc-0.1.0.tgz \
  -p <url>/factlot-tools-0.1.0.tgz -p <url>/factlot-mcp-0.1.0.tgz factlot-mcp      # e2e stdio: pass
npm install <url>/factlot-schema-0.1.0.tgz <url>/factlot-id-0.1.0.tgz \
  <url>/factlot-calc-0.1.0.tgz <url>/factlot-tools-0.1.0.tgz                      # pass
```

That works but is long, so this branch adds a **standalone tarball**
([scripts/release/pack-standalone.mjs](../scripts/release/pack-standalone.mjs)): the same
single-file bundle the `.mcpb` runs, with no dependencies, packed as `factlot-mcp-standalone`
with a `factlot-mcp` bin.

```bash
npm run build:mcpb && node scripts/release/pack-standalone.mjs out    # factlot-mcp-standalone-0.1.0.tgz, 4 files
npx -y <url>/factlot-mcp-standalone-0.1.0.tgz                           # e2e stdio: 6 of 6 pass
```

`npx -y ./factlot-mcp-standalone-0.1.0.tgz` with a **local path** fails ("Permission denied"):
npx treats a path as a command to execute, not a package. Use a URL, or
`npx -y -p ./file.tgz factlot-mcp`.

## 11. MCP Registry `server.json`

`server.json` was validated with Python `jsonschema` against the official schema
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`: 0 errors (a
deliberately broken copy produced the expected 2 errors). The `jq` rewrite in
`mcp-registry.yml` was run locally for a sample version and the result also validated.
`mcp-publisher validate` itself was not run locally; the workflow runs it before publishing.
`GET https://registry.modelcontextprotocol.io/v0.1/servers/io.github.9mp96ygnbk-alt%2Ffactlot/versions/0.1.0`
returns 404 today, as expected before the first publish.

## 12. Workflow files

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 .github/workflows/*.yml   # exit 0
npx -y @action-validator/cli@0.6.0 .github/workflows/<file>.yml                           # each: ok
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/<file>.yml"))'            # each: ok
```

actionlint found one shellcheck warning (unquoted command substitution) in
`release-assets.yml`; fixed. None of the new workflows has run on GitHub yet: they trigger on a
`v*` tag, a push to `main` under `site/`, or a manual dispatch, and nothing was pushed.

## 13. Repository checks

```bash
npm run check          # lint, format, typecheck, unit tests, build: pass
npm run test:python    # 243 tests, OK (1 skipped)
npm run schemas:check  # pass after committing the regenerated OpenAPI 3.0 files
```

## Not verified

- Anything that needs the repository to be public or a tag: real release-asset URLs,
  `pip install git+https://…`, the GHCR image, GitHub Pages, and the MCP Registry publish.
- Installing the `.mcpb` through the Claude Desktop interface, and live connections from the
  claude.ai, ChatGPT, Copilot, Gemini, and Bedrock consoles (these need a public HTTPS host).
- Node.js 20 inside Claude Desktop's bundled runtime (the bundle targets `node20`; it was run
  here on Node.js 26 and runs in CI on Node.js 22).

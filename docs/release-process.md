# Release process

How a maintainer ships a FactLot release: one version across the six `@factlot/*` npm packages
and the `factlot` Python package, a changelog entry, a `vX.Y.Z` tag, and a GitHub release with the
Claude Desktop extension (`.mcpb`) attached. The workflow that does the publishing is
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

Four more workflows need **no npm or PyPI account**, only the repository's own `GITHUB_TOKEN` or
GitHub OIDC, so every release is installable from GitHub whether or not npm and PyPI publishing
is configured:

| Workflow                                                        | Trigger                                  | What it does                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`release-assets.yml`](../.github/workflows/release-assets.yml) | `v*` tag, or by hand on an existing tag  | Builds the `.mcpb`, the six npm tarballs, `factlot-mcp-standalone-X.Y.Z.tgz` (for `npx -y <url>`), the Python wheel and sdist; installs and tests each one; attaches them and `SHA256SUMS` to the GitHub release `vX.Y.Z`, creating it with the changelog notes if it is missing. |
| [`container.yml`](../.github/workflows/container.yml)           | `v*` tag, or by hand on an existing tag  | Builds the Dockerfile, runs the end-to-end test against the container (HTTP and stdio), then pushes `ghcr.io/9mp96ygnbk-alt/factlot:X.Y.Z`, `:X.Y`, and `:latest` for linux/amd64 and linux/arm64 with OCI labels and the MCP Registry ownership label.                           |
| [`pages.yml`](../.github/workflows/pages.yml)                   | Push to `main` that changes the workflow | Publishes a redirect from the old GitHub Pages address to factlot.com.                                                                                                                                                                                                            |
| [`mcp-registry.yml`](../.github/workflows/mcp-registry.yml)     | By hand only; dry run unless unticked    | Publishes [`server.json`](../server.json) to the official MCP Registry as `io.github.9mp96ygnbk-alt/factlot`, logging in with GitHub OIDC. See [MCP Registry](#mcp-registry).                                                                                                     |

Every action in these workflows is pinned to a full commit SHA with the version in a comment, and
each job declares only the permissions it needs (`contents: read` by default; `contents: write`
only to attach release assets; `packages: write` only to push the image; `pages: write` and
`id-token: write` only to deploy Pages; `id-token: write` only to log in to the MCP Registry).

> **Without npm and PyPI credentials:** pushing a `vX.Y.Z` tag runs
> `release.yml`'s checks and builds and then skips npm and PyPI with a notice instead of failing;
> `release-assets.yml` and `container.yml` still publish the GitHub release assets and the GHCR
> image. The MCP Registry workflow publishes the `.mcpb` package alone while the GHCR package is
> still private, and adds the OCI package once it is public.

## Cutting a release

1. **Add a changelog section and tag.**

   ```bash
   git switch main && git pull --ff-only
   node scripts/release/changelog.mjs release X.Y.Z
   git commit -am "Release X.Y.Z"
   git tag -a vX.Y.Z -m "FactLot X.Y.Z"
   git push origin main vX.Y.Z
   ```

   The tag starts `release-assets.yml`, `container.yml`, and `release.yml`.

2. **Check the release** has `factlot-X.Y.Z.mcpb`, `factlot-mcp-standalone-X.Y.Z.tgz`, the six
   `factlot-*-X.Y.Z.tgz`, the wheel, the sdist, and `SHA256SUMS`. Then, from any machine:

   ```bash
   npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/vX.Y.Z/factlot-mcp-standalone-X.Y.Z.tgz < /dev/null
   pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git@vX.Y.Z#subdirectory=python"
   docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:X.Y.Z
   ```

3. **Publish to the MCP Registry:** Actions, **MCP Registry**, Run workflow, version `X.Y.Z`,
   leave **dry run** ticked first. When it passes (`mcp-publisher validate` and the `.mcpb`
   checksum), run it again with dry run unticked.

If a workflow fails, fix the cause on `main`, then re-run it by hand with the tag as input
(`release-assets.yml` and `container.yml` replace what they published before). Do not move or
re-push a tag that has been released.

## Prerequisites (once)

npm and PyPI publishing need these, set up once by a repository owner. Until they exist the
workflow skips npm and PyPI in its first job, so a tag cannot half-publish.

1. **npm org `@factlot`.** Create it at npmjs.com, then create a _granular access token_ with
   read and write access to the `@factlot` scope and "bypass 2FA" enabled for automation. Save it
   as the repository secret **`NPM_TOKEN`** (Settings, Secrets and variables, Actions).
   Publishing uses `--provenance`, so the repository must be public or the org must allow
   provenance for private repositories at the time of the release.
2. **PyPI project `factlot` with trusted publishing.** On pypi.org, Account settings, Publishing,
   add a _pending publisher_ (or, once the project exists, a publisher on the project):
   owner `9mp96ygnbk-alt`, repository `factlot`, workflow `release.yml`, environment `pypi`.
   In GitHub, create the environment **`pypi`** (Settings, Environments) and, optionally, require
   a reviewer on it so a tag push waits for a click before uploading. Then set the repository
   variable **`PYPI_TRUSTED_PUBLISHING`** to `ready`. The variable is the switch the workflow
   checks early; without it, the npm publish would succeed and the PyPI upload would fail late.
3. **Optional: extension signing.** See [Signing the extension](#signing-the-extension).

Local tools: Node 22 or newer, Python 3.10 or newer, `git`, and the GitHub CLI `gh` for watching
the run.

## Cutting a release

Work on a clean `main` that CI has passed.

```bash
git switch main && git pull --ff-only
git status --porcelain            # must print nothing

# 1. Bump every package to the new version (patch, minor, major, or an explicit x.y.z).
node scripts/release/bump.mjs minor

# 2. Regenerate the OpenAPI documents, which embed the version, and check nothing else moved.
npm run schemas
npm run check && npm run test:python && npm run differential

# 3. Move the Unreleased section of CHANGELOG.md under the new version (today's date).
node scripts/release/changelog.mjs release 0.2.0
#    Read it. Every user-visible change since the last release should be there; add what is
#    missing, and mention any calculator whose formula version was bumped.

# 4. Commit and tag. The tag must be v + the exact version.
git add -A
git commit -m "Release 0.2.0"
git tag -a v0.2.0 -m "FactLot 0.2.0"
git push origin main v0.2.0

# 5. Watch the run. Approve the `pypi` environment if it requires a reviewer.
gh run watch --workflow release.yml
```

What the workflow does, in order, and what to expect:

| Job                       | What it does                                                                                                                                                               | Fails when                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `preflight`               | Reads the version, checks every package agrees and the tag matches, checks `CHANGELOG.md` has a `## [x.y.z]` section, checks `NPM_TOKEN` and `PYPI_TRUSTED_PUBLISHING`.    | Anything is inconsistent, or A5 is not done. Nothing has been published yet.      |
| `check`                   | The same steps as `ci.yml` on Node 22 and 24.                                                                                                                              | Lint, format, typecheck, tests, or build fail.                                    |
| `python-and-differential` | The same Python, bench, connector, schema, `.mcpb`, and differential steps as `ci.yml`.                                                                                    | Any of them fail, including stale `spec/schemas` (forgot `npm run schemas`).      |
| `build`                   | `npm pack` of every package, `python -m build` (wheel and sdist), `npm run build:mcpb`, optional `mcpb sign`, and the release notes. Uploads everything as a run artifact. | A build fails. Download the artifact to inspect exactly what would be shipped.    |
| `publish-npm`             | `npm publish --access public --provenance` for schema, id, calc, tools, mcp, server, in that order. Versions already on npm are skipped, so a failed run can be re-run.    | npm rejects a package. Earlier packages in the order are already live.            |
| `publish-pypi`            | Uploads the wheel and sdist with trusted publishing (no token).                                                                                                            | The trusted publisher is not configured for `release.yml` and environment `pypi`. |
| `github-release`          | Creates the GitHub release `vX.Y.Z` with the changelog section as notes and attaches the `.mcpb`, wheel, and sdist. Re-runs upload assets with `--clobber`.                |                                                                                   |
| `verify`                  | Polls npm for all six packages, starts `npx -y @factlot/mcp@X.Y.Z`, then `pip install factlot==X.Y.Z` and loads the tools.                                                 | A registry has not propagated yet (re-run the job) or a package is broken.        |

## Verifying by hand

After `verify` is green, confirm from a machine that has never built FactLot:

```bash
npx -y @factlot/mcp@latest          # starts the stdio MCP server; Ctrl-C to stop
claude mcp add factlot -- npx -y @factlot/mcp   # or any MCP client, then call calc_npv

python3 -m venv /tmp/fl && . /tmp/fl/bin/activate
pip install factlot
python -c "import factlot; print(factlot.__version__, len(factlot.anthropic_tools()))"
```

Open the GitHub release, download `factlot-X.Y.Z.mcpb`, and install it in Claude Desktop
(Settings, Extensions). Then update anything that points at the old version: the hosted connector
image, if one is deployed, and `README.md`.

## Dry runs

Any time, without a tag: Actions, **Release**, **Run workflow**, leave **dry run** ticked. It runs
`preflight` (without the credentials check), both check jobs, and `build`, and publishes nothing.
The `release-X.Y.Z` artifact on the run contains the exact tarballs, wheel, sdist, `.mcpb`, and
notes a real release would ship. Use it before the first release and after changing the workflow.

Un-ticking **dry run** on a manual run publishes only when the run is dispatched on a `v*` tag; on
a branch it stops in `preflight`.

## Signing the extension

`mcpb sign` (from `@anthropic-ai/mcpb`, already a dev dependency) signs the bundle with an X.509
certificate and private key in PEM format, and `mcpb verify` checks it. The workflow signs when
both repository secrets **`MCPB_SIGNING_CERT`** and **`MCPB_SIGNING_KEY`** are set (paste the
PEM contents, including the `BEGIN`/`END` lines); otherwise it attaches the bundle unsigned and
prints a notice. A self-signed certificate (`mcpb sign --self-signed`) proves integrity but not
identity, so obtain a code-signing certificate for FactLot before relying on signatures.

To sign by hand instead:

```bash
npm run build:mcpb
npx mcpb sign dist/factlot.mcpb --cert cert.pem --key key.pem    # add -i intermediate.pem ... if your CA needs it
npx mcpb verify dist/factlot.mcpb
gh release upload vX.Y.Z dist/factlot.mcpb --clobber
```

Keep `key.pem` out of the repository (it is not in `.gitignore` by name; store it in a password
manager).

## MCP Registry

[`server.json`](../server.json) describes FactLot for the official MCP Registry
(<https://registry.modelcontextprotocol.io>), from which MCP clients and other registries discover
servers. It lists the packages that exist without npm or PyPI accounts:

- **`oci`**: `ghcr.io/9mp96ygnbk-alt/factlot:X.Y.Z`, run as a stdio server
  (`docker run -i --rm <image> node packages/mcp/dist/bin.js`). Ownership is proven by the image
  label `io.modelcontextprotocol.server.name=io.github.9mp96ygnbk-alt/factlot`, which
  `container.yml` sets; the registry reads the image config anonymously, so the GHCR package
  must be public. OCI entries must not carry `version`, `registryBaseUrl`, or `fileSha256`.
- **`mcpb`**: `https://github.com/9mp96ygnbk-alt/factlot/releases/download/vX.Y.Z/factlot-X.Y.Z.mcpb`
  with its `fileSha256`. The URL must be a GitHub or GitLab release and contain "mcp" (the
  `.mcpb` extension does). The registry does not check the hash, but clients do before installing.

The committed file holds version `0.1.0` and a placeholder SHA-256 of zeros. `mcp-registry.yml`
rewrites the version, both identifiers, and `fileSha256` (from the downloaded release asset,
cross-checked against `SHA256SUMS`) before it validates and publishes, so the file needs no edit
per release.

**Namespace.** `io.github.<owner>/<name>` requires GitHub authentication as that owner. From
Actions, `mcp-publisher login github-oidc` with `id-token: write` proves the repository owner
with no secret. `9mp96ygnbk-alt` is a user account, so this is a personal namespace; publishing
under an organization namespace would need an org Owner.

**Follow-ups after first publish** (not in `server.json` today, because those packages do not
exist yet):

- npm: add
  `{"registryType": "npm", "identifier": "@factlot/mcp", "version": "X.Y.Z", "transport": {"type": "stdio"}}`.
  The registry checks that the published `package.json` has `"mcpName": "io.github.9mp96ygnbk-alt/factlot"`;
  `packages/mcp/package.json` already has it. Have `mcp-registry.yml` set `version` with the
  others.
- PyPI: none. The Python package is an SDK, not an MCP server. If one is added, its README needs
  a line `<!-- mcp-name: io.github.9mp96ygnbk-alt/factlot -->`.
- A `remotes` entry for the hosted endpoint (`{"type": "streamable-http", "url": "https://api.factlot.com/mcp"}`).

**Interaction with `release.yml`.** Once npm and PyPI publishing is configured, `release.yml`'s `github-release` job uploads
its own `.mcpb` with `--clobber`. That rebuild has a different SHA-256 from the one
`release-assets.yml` attached and recorded in `SHA256SUMS`, so for a release that has already been
published to the MCP Registry, either skip that upload or re-run `release-assets.yml` (which
rewrites the `.mcpb` and `SHA256SUMS` together) **before** running `mcp-registry.yml`. The
workflow refuses to publish when the asset and `SHA256SUMS` disagree.

Published registry versions are immutable; to withdraw one, use
`mcp-publisher status --status deprecated --message "…" io.github.9mp96ygnbk-alt/factlot X.Y.Z`
after `mcp-publisher login github`.

**Sources** (read 2026-11-03, registry repository at commit `a75c727`):

- Publishing with GitHub Actions and OIDC, pinned and Sigstore-verified `mcp-publisher`:
  <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.mdx>
- Package types and ownership verification (npm `mcpName`, PyPI `mcp-name:`, OCI label, MCPB URL
  and `fileSha256`):
  <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx>
- Namespaces and GitHub authentication:
  <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx>
- Official registry requirements (allowed registries, `_meta` rules):
  <https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md>
- `server.json` schema 2025-12-11:
  <https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json>
- `mcp-publisher` commands (`validate`, `publish`, `status`):
  <https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md>
- OCI validation source (labels read from the image config, anonymous pull):
  <https://github.com/modelcontextprotocol/registry/blob/main/internal/validators/registries/oci.go>
- `mcp-publisher` release `v1.8.7` (latest on 2026-10-30):
  <https://github.com/modelcontextprotocol/registry/releases/tag/v1.8.7>

## Rollback

Published versions are immutable on both registries; a rollback is a new version plus marking
the bad one.

- **npm:** `npm deprecate @factlot/<pkg>@X.Y.Z "Broken: use X.Y.Z+1"` for each affected package.
  Do not `npm unpublish` once anyone may depend on it (npm forbids it after 72 hours in any
  case). If a lower version should be `latest` again: `npm dist-tag add @factlot/<pkg>@X.Y.W latest`.
- **PyPI:** on the project's release page, **Yank** the release with a reason. Yanked versions
  are skipped by `pip install factlot` but still installable when pinned exactly.
- **GitHub:** edit the release notes to say it is withdrawn, or delete the release (the tag
  stays, so history remains honest).
- Then fix forward: bump `patch`, add the fix to the changelog, tag, push.

If a run fails halfway (for example npm published but PyPI did not), fix the cause and re-run the
failed jobs: `publish-npm` skips versions that already exist and `github-release` updates assets
in place.

## Versioning rules

- One version for everything, Semantic Versioning. Before 1.0, a `minor` bump may contain
  breaking changes; say so in the changelog.
- A change in any calculator's output for any valid input bumps that calculator's formula
  `version` (AGENTS.md rule 3) _and_ is a `minor` release at least.
- `@factlot/id` must return the same ID for the same input forever, so nothing there is ever a
  "breaking" change; a new rule is a `minor` bump.
- Internal dependencies between `@factlot/*` packages are pinned to the exact shared version;
  `bump.mjs` keeps them in step.

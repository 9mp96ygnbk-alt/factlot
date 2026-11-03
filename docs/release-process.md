# Release process

How a maintainer ships a FactLot release: one version across the six `@factlot/*` npm packages
and the `factlot` Python package, a changelog entry, a `vX.Y.Z` tag, and a GitHub release with the
Claude Desktop extension (`.mcpb`) attached. The workflow that does the publishing is
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Prerequisites (once)

These need accounts only the project owner can create (backlog item **A5**). Until they exist
the workflow stops in its first job with a message naming A5, so a tag cannot half-publish.

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

# Launch-day checklist (2026-11-03, post at 12:00 EST)

Work top to bottom. Each item carries one tag:

- **[automatable now]** an agent can do it with no account and no public repository
- **[needs the repo public]** an agent or the founder can do it once `github.com/9mp96ygnbk-alt/factlot` is public
- **[needs npm/PyPI accounts]** blocked on backlog A5
- **[needs a hosted endpoint]** blocked on backlog A4 (and, for some, A7: privacy policy and terms)
- **[founder posts it]** a person with a personal account must click; drafts are in `posts/`

The plan and the reasoning are in [`strategy.md`](strategy.md). Nothing here is done yet.

## Before 09:00 EST: prepare

- [x] [automatable now] Merge the `launch-kit` branch to `main` after the checks pass (`npm run format:check`). **Status 2026-11-03: done (59800f3).**
- [x] [automatable now] Read the five install paths in `llms.txt` once on a clean machine and fix any command that fails (clone, `npm install`, `npm run build`, run the stdio server; `docker build`; `pip install` from the Git URL). **Status 2026-11-03: done: npx from the release URL, the GHCR image, pip from the tag and the .mcpb verified from a clean scratch directory with no credentials.**
- [x] [automatable now] Build the extension: `npm run build:mcpb`, then `shasum -a 256 dist/factlot.mcpb`; keep the hash for the MCP Registry entry. **Status 2026-11-03: done: built and attached by release-assets.yml; SHA-256 in the release's SHA256SUMS.**
- [x] [automatable now] Deploy `site/` (Cloudflare Pages, Vercel or GitHub Pages; see `site/README.md`) and point `factlot.com` at it; confirm `https://factlot.com/llms.txt` returns text and the canonical link matches the final URL. **Status 2026-11-03: deployed to GitHub Pages (https://9mp96ygnbk-alt.github.io/factlot/); pointing factlot.com at it is the founder's DNS step (factlot.com currently serves the founder's coming-soon page).**
- [ ] [founder posts it] Confirm the `contact@factlot.com` mailbox receives mail. **Status 2026-11-03: it cannot: factlot.com publishes a null MX (`0 .`) and `v=spf1 -all`, and Cloudflare Email Routing is off for the zone. Turn on Email Routing for factlot.com (Cloudflare dashboard, Email, Email Routing) and route contact@ to the founder's inbox.**
- [ ] [founder posts it] Read the rules page of every subreddit before choosing any in `posts/reddit.md`; Reddit blocked automated reads when this kit was written.

## 09:00 to 11:30 EST: make the repository public and listable

- [x] [founder posts it] Make `github.com/9mp96ygnbk-alt/factlot` public (Settings, General, Danger Zone, Change visibility). **Status 2026-11-03: done.**
- [x] [needs the repo public] Apply the description and topics from `github-metadata.md` (Settings, or the gear next to About). **Status 2026-11-03: done (20 topics).**
- [x] [needs the repo public] Enable Discussions and Issues; create a "Welcome" discussion from `posts/github-discussions.md`; pin it. **Status 2026-11-03: done; welcome post is discussion #26 (pinning is a founder click).**
- [x] [needs the repo public] Open three `good first issue` issues taken from `docs/BACKLOG.md` so a visitor has a place to start. **Status 2026-11-03: done (#27, #28, #29).**
- [x] [needs the repo public] Create release `v0.1.0` with `dist/factlot.mcpb` attached (use `docs/release-process.md`; without npm and PyPI accounts the workflow stops early, so attach the file by hand). Note the asset URL. **Status 2026-11-03: done: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.1.0 (release.yml skips npm/PyPI with a notice until A5).**
- [x] [needs the repo public] Check the first-screen README renders: tagline, early-access line, quick start from GitHub. **Status 2026-11-03: done: the README now leads with the one-line install.**
- [ ] [founder posts it] Upload the social preview image (Settings, General, Social preview) so links look right on LinkedIn and X. **Status 2026-11-03: the image is ready at `docs/launch/assets/social-preview.png` (1280x640); GitHub accepts it only through the website.**
- [ ] [founder posts it] In Cloudflare, turn off Browser Integrity Check for `api.factlot.com` (Security, Settings, or a Configuration Rule for that hostname). **Status 2026-11-03: it returns error 1010 to Python's default `urllib` user agent, which agents commonly use; curl, requests and Node pass.**
- [ ] [founder posts it] Submit the Claude Code plugin to Anthropic's plugin directory through its web form, https://clau.de/plugin-directory-submission (PRs to anthropics/claude-plugins-community are closed automatically). Plugin: `plugins/factlot`; marketplace: `9mp96ygnbk-alt/factlot`.
- [ ] [founder posts it] Merge the Dependabot pull requests that bump GitHub Actions (#20, #22, #23, #24, #25; CI passes on each). Close #21 (`@types/node` 26 while the engines field supports Node 22.6+). The agent's merge was blocked by its permission check.

## 11:30 to 12:00 EST: registry and lists (these only need a public repo)

Also opened on 2026-11-03 (not in the original list): [etewiah/awesome-real-estate#120](https://github.com/etewiah/awesome-real-estate/pull/120) and [docker/mcp-registry#6533](https://github.com/docker/mcp-registry/pull/6533) (Docker MCP Catalog). The awesome-mcp-servers PR waits for Glama to index the server.

- [x] [needs the repo public] Official MCP Registry, MCPB route: write `server.json` from `submissions/mcp-registry.md` with the asset URL and hash, then `mcp-publisher login github` and `mcp-publisher publish`. Verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot"`. **Status 2026-11-03: done: io.github.9mp96ygnbk-alt/factlot 0.1.0 is active with the OCI and MCPB packages.**
- [ ] [needs the repo public] Glama: add or claim the server at [glama.ai/mcp/servers](https://glama.ai/mcp/servers) (button "Add Server"); wait for the score badge to appear.
- [ ] [needs the repo public] mcp.so: submit the repository URL at [mcp.so/submit](https://mcp.so/submit) using `submissions/directories.md`.
- [ ] [needs the repo public] awesome-mcp-servers: open the PR with the text in `submissions/awesome-mcp-servers.md` once the Glama badge URL resolves.
- [ ] [needs the repo public] Cline marketplace: test that Cline can install from the README alone, then open the issue from `submissions/directories.md`.

## Registry sample

- [x] Published `registry-sample-dc-2026-11-03` on 2026-11-03 with the founder's approval
      (v0.1.0 stays the latest release). It is a 19.7 MB SQLite registry of 18,077 District of
      Columbia commercial parcels, 5,513 owning entities and 7,908 cited ownership links, built
      only from Open Data DC files licensed CC BY 4.0 with AI use permitted, organisation owners
      only, with `ATTRIBUTION.md`. Verified with no credentials: checksums match, and the v0.1.0
      MCP server answers `registry_search_entities` and `registry_owned_by` from it. Its download
      line is in the README install block, `llms.txt` and the landing page's registry card.

## 12:00 EST: post

- [ ] [founder posts it] Show HN: title and first comment from `posts/show-hn.md`. Post it from the founder's own account; do not ask anyone to upvote.
- [ ] [founder posts it] LinkedIn: `posts/linkedin.md`.
- [ ] [founder posts it] X thread: `posts/x-thread.md`.
- [ ] [founder posts it] Reddit: only the subreddits whose rules you have read and that allow it (`posts/reddit.md`). Skip a subreddit rather than bend a rule.

## 12:00 to 15:00 EST: stay on the thread

- [ ] [founder posts it] Answer every Show HN comment, including critical ones; say plainly what is not done (no npm or PyPI, no hosted endpoint, Bench not run, survey simulated).
- [ ] [founder posts it] Reply to early-access emails with `early-access-reply.md` within one working day; first replies today.
- [ ] [automatable now] Log first-day numbers in a private notes file: stars, unique visitors, unique cloners, top referrers, release downloads, emails (see "What to measure" in `strategy.md`).

## After launch day: items waiting on something else

### Needs npm/PyPI accounts (backlog A5)

- [ ] [needs npm/PyPI accounts] Create the `@factlot` npm organisation and a PyPI account; set `NPM_TOKEN` and the PyPI trusted publisher as in `docs/release-process.md`.
- [ ] [needs npm/PyPI accounts] Add `mcpName` (`io.github.9mp96ygnbk-alt/factlot`) to `packages/mcp/package.json` before the first npm publish; the MCP Registry checks it. (Code change: not part of this kit.)
- [ ] [needs npm/PyPI accounts] Tag a release so the workflow publishes; then republish the MCP Registry entry with the npm package.
- [ ] [needs npm/PyPI accounts] Vercel AI SDK tools registry entry, LangChain listing issue, LlamaIndex and CrewAI how-to pages (`submissions/frameworks.md`).
- [ ] [needs npm/PyPI accounts] Update `llms.txt`, README and the site so the install line is `npx -y @factlot/mcp` and `pip install factlot`.

### Needs a hosted endpoint (backlog A4, plus A7 for legal pages)

- [x] [needs a hosted endpoint] Deploy behind HTTPS. **Status 2026-11-03: done: `https://api.factlot.com` (Cloudflare Worker, `deploy/cloudflare`), free tier 60 requests a minute per address, paid keys through Stripe once `STRIPE_SECRET_KEY` is set; factlot.com now serves the landing page from the same Worker.**
- [x] [needs a hosted endpoint] Publish privacy policy and terms pages (A7). **Status 2026-11-03: done: https://factlot.com/privacy and https://factlot.com/terms. The founder should read both (and have counsel review the terms) before the first paid customer.**
- [ ] [needs a hosted endpoint] Connect in the Claude custom connector UI, ChatGPT developer mode, Copilot Studio, Gemini CLI and a Bedrock agent, and record the dated results in `connectors/README.md`.
- [ ] [needs a hosted endpoint] Anthropic Connectors Directory submission (`submissions/platform-directories.md`).
- [ ] [needs a hosted endpoint] ChatGPT apps directory submission (same file).
- [ ] [needs a hosted endpoint] Smithery remote entry at [smithery.ai/new](https://smithery.ai/new).
- [ ] [needs a hosted endpoint] Microsoft Copilot Studio certification (Partner Center), only after the above.
- [x] [needs a hosted endpoint] Replace "no hosted endpoint" on the site, README and `llms.txt`. **Status 2026-11-03: done; the hosted registry is not open yet (it needs Workers Paid for the database writes), and the pricing copy says registry regions open over time.**

### Needs model spend (backlog A3)

- [ ] [founder posts it] Run FactLot Bench on current models and publish the result, wins and losses. Until then no post claims a Bench number.

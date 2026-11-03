# Launch-day checklist (2026-11-03, post at 12:00 EST)

Work top to bottom. Each item carries one tag:

- **[automatable now]** an agent can do it with no account and no public repository
- **[needs the repo public]** an agent or the founder can do it once `github.com/9mp96ygnbk-alt/factlot` is public
- **[needs npm/PyPI accounts]** blocked on backlog A5
- **[needs a hosted endpoint]** blocked on backlog A4 (and, for some, A7: privacy policy and terms)
- **[founder posts it]** a person with a personal account must click; drafts are in `posts/`

The plan and the reasoning are in [`strategy.md`](strategy.md). Nothing here is done yet.

## Before 09:00 EST: prepare

- [ ] [automatable now] Merge the `launch-kit` branch to `main` after the checks pass (`npm run format:check`).
- [ ] [automatable now] Read the five install paths in `llms.txt` once on a clean machine and fix any command that fails (clone, `npm install`, `npm run build`, run the stdio server; `docker build`; `pip install` from the Git URL).
- [ ] [automatable now] Build the extension: `npm run build:mcpb`, then `shasum -a 256 dist/factlot.mcpb`; keep the hash for the MCP Registry entry.
- [ ] [automatable now] Deploy `site/` (Cloudflare Pages, Vercel or GitHub Pages; see `site/README.md`) and point `factlot.com` at it; confirm `https://factlot.com/llms.txt` returns text and the canonical link matches the final URL.
- [ ] [founder posts it] Confirm the `contact@factlot.com` mailbox receives mail, since the early-access link on the site and in the README depends on it.
- [ ] [founder posts it] Read the rules page of every subreddit before choosing any in `posts/reddit.md`; Reddit blocked automated reads when this kit was written.

## 09:00 to 11:30 EST: make the repository public and listable

- [ ] [founder posts it] Make `github.com/9mp96ygnbk-alt/factlot` public (Settings, General, Danger Zone, Change visibility).
- [ ] [needs the repo public] Apply the description and topics from `github-metadata.md` (Settings, or the gear next to About).
- [ ] [needs the repo public] Enable Discussions and Issues; create a "Welcome" discussion from `posts/github-discussions.md`; pin it.
- [ ] [needs the repo public] Open three `good first issue` issues taken from `docs/BACKLOG.md` so a visitor has a place to start.
- [ ] [needs the repo public] Create release `v0.1.0` with `dist/factlot.mcpb` attached (use `docs/release-process.md`; without npm and PyPI accounts the workflow stops early, so attach the file by hand). Note the asset URL.
- [ ] [needs the repo public] Check the first-screen README renders: tagline, early-access line, quick start from GitHub.
- [ ] [needs the repo public] Upload a social preview image (Settings, General, Social preview) so links look right on LinkedIn and X. The image is not part of this kit.

## 11:30 to 12:00 EST: registry and lists (these only need a public repo)

- [ ] [needs the repo public] Official MCP Registry, MCPB route: write `server.json` from `submissions/mcp-registry.md` with the asset URL and hash, then `mcp-publisher login github` and `mcp-publisher publish`. Verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot"`.
- [ ] [needs the repo public] Glama: add or claim the server at [glama.ai/mcp/servers](https://glama.ai/mcp/servers) (button "Add Server"); wait for the score badge to appear.
- [ ] [needs the repo public] mcp.so: submit the repository URL at [mcp.so/submit](https://mcp.so/submit) using `submissions/directories.md`.
- [ ] [needs the repo public] awesome-mcp-servers: open the PR with the text in `submissions/awesome-mcp-servers.md` once the Glama badge URL resolves.
- [ ] [needs the repo public] Cline marketplace: test that Cline can install from the README alone, then open the issue from `submissions/directories.md`.

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

- [ ] [needs a hosted endpoint] Deploy the Docker image behind HTTPS (for example `mcp.factlot.com`); set `FACTLOT_PUBLIC_URL`.
- [ ] [needs a hosted endpoint] Publish privacy policy and terms pages (A7), needed by the Anthropic and OpenAI directories.
- [ ] [needs a hosted endpoint] Connect in the Claude custom connector UI, ChatGPT developer mode, Copilot Studio, Gemini CLI and a Bedrock agent, and record the dated results in `connectors/README.md`.
- [ ] [needs a hosted endpoint] Anthropic Connectors Directory submission (`submissions/platform-directories.md`).
- [ ] [needs a hosted endpoint] ChatGPT apps directory submission (same file).
- [ ] [needs a hosted endpoint] Smithery remote entry at [smithery.ai/new](https://smithery.ai/new).
- [ ] [needs a hosted endpoint] Microsoft Copilot Studio certification (Partner Center), only after the above.
- [ ] [needs a hosted endpoint] Replace "no hosted endpoint" on the site, README and `llms.txt`, and remove or change the early-access call to action only if the hosted registry is actually open.

### Needs model spend (backlog A3)

- [ ] [founder posts it] Run FactLot Bench on current models and publish the result, wins and losses. Until then no post claims a Bench number.

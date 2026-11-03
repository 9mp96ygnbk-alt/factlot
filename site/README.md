# factlot.com landing page

A single static page: `index.html` and `styles.css`. No JavaScript, no framework, no build
step, no external scripts or fonts, no tracking. Every number on the page comes from the
repository's docs (`README.md`, `docs/roadmap.md`, `docs/registry/sources/README.md`,
`packages/calc/README.md`); update the page when those change.

## Preview locally

```bash
python3 -m http.server 8000 --directory site
# then open http://localhost:8000/
```

## Deploy

The folder is the whole site, so any static host works. Point the host at `site/` with no build
command.

| Host             | Settings                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Pages | Connect the repository; build command empty; build output directory `site`. Or without Git: `npx wrangler pages deploy site --project-name factlot`.                                                                                                         |
| Vercel           | Import the repository; Framework Preset "Other"; Root Directory `site`; build command and output directory empty. Or `vercel deploy site`.                                                                                                                   |
| GitHub Pages     | Settings, Pages, Source "GitHub Actions", with a workflow that runs `actions/upload-pages-artifact` with `path: site` and then `actions/deploy-pages`. (Pages' "deploy from a branch" option serves only `/` or `/docs`, which is why a workflow is needed.) |
| Anything else    | Copy `site/` to the web root.                                                                                                                                                                                                                                |

Then point `factlot.com` at the host following its custom-domain instructions.

## Checks

`CHECKS.md` lists what was verified before the page was committed and how to repeat it.
Formatting is covered by the repository's `npm run format:check` (Prettier formats the HTML and
CSS too).

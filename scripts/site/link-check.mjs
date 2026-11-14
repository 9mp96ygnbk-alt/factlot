// The build's last check of the folder it wrote: every internal link resolves to a file of the site, nothing
// loads from another origin, the only scripts are JSON-LD and the /try/ files, JSON-LD parses, and no
// placeholder is left unfilled. build.mjs fails on any problem this returns.

import fs from "node:fs";
import path from "node:path";

/**
 * Link targets that are no file of the site because the Worker answers them itself: the lookup pages
 * (/lookup/?q=..., /lookup/<county>/<parcel id>). Nothing else the Worker answers is exempt, so a link
 * to a mistyped API or billing path still fails the build.
 */
export const workerAnswered = (p) =>
  p === "/lookup" || p.startsWith("/lookup/");

/** Whether the site link `u` (starting "/") resolves in the built folder `out`. */
export function linkResolves(out, u) {
  const p = decodeURIComponent(u.split(/[?#]/)[0]);
  const f = path.join(out, p);
  return (
    p === "/" ||
    workerAnswered(p.replace(/\/+$/, "")) ||
    fs.existsSync(path.join(f, "index.html")) ||
    (fs.existsSync(f) && fs.statSync(f).isFile()) ||
    fs.existsSync(`${f}.html`)
  );
}

/** Every problem in the HTML files of the built folder `out`, one line each. */
export function siteProblems(out) {
  const problems = [];
  for (const f of fs
    .readdirSync(out, { recursive: true })
    .filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(out, f), "utf8");
    for (const [, u] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (u.startsWith("/") && !u.startsWith("//") && !linkResolves(out, u))
        problems.push(`${f}: broken link ${u}`);
    }
    for (const [tag] of html.matchAll(
      /<script\b[^>]*>|<link\b[^>]*rel="stylesheet"[^>]*>/g,
    )) {
      if (/(?:src|href)="(?:https?:)?\/\//.test(tag))
        problems.push(`${f}: external resource ${tag}`);
      // The only scripts besides JSON-LD are same-origin files under /try/.
      if (
        tag.startsWith("<script") &&
        !tag.includes("application/ld+json") &&
        !/^<script src="\/try\/[a-z-]+\.js" defer>$/.test(tag)
      )
        problems.push(`${f}: script that is not JSON-LD or a /try/ file`);
    }
    for (const [, j] of html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    )) {
      try {
        JSON.parse(j);
      } catch (e) {
        problems.push(`${f}: JSON-LD does not parse: ${e.message}`);
      }
    }
    if (/\{\{[A-Z_]+\}\}/.test(html))
      problems.push(`${f}: unfilled placeholder`);
  }
  return problems;
}

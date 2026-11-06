#!/usr/bin/env node
// Tells IndexNow search engines (Bing, Yandex, Naver, Seznam, Yep) which factlot.com URLs changed
// in a deploy. `save` records the live sitemap before deploying; `ping` compares it with the
// deployed one and submits only new URLs and URLs whose lastmod moved. Never fails a deploy.
//
//   node scripts/site/indexnow.mjs save   (before wrangler deploy)
//   node scripts/site/indexnow.mjs ping   (after it)
/* global fetch */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const HOST = "factlot.com";
const before = path.join(root, "deploy/cloudflare/.indexnow-before.xml");
const built = path.join(root, "deploy/cloudflare/public/sitemap.xml");

const entries = (xml) =>
  new Map(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map(
      (m) => [m[1], m[2]],
    ),
  );

function key() {
  const dir = path.join(root, "site");
  const f = fs.readdirSync(dir).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (
    !f ||
    fs.readFileSync(path.join(dir, f), "utf8").trim() !== f.slice(0, -4)
  )
    throw new Error(
      "no IndexNow key file (32 hex characters, content equal to its name) in site/",
    );
  return f.slice(0, -4);
}

async function main(cmd) {
  if (cmd === "save") {
    const res = await fetch(`https://${HOST}/sitemap.xml`);
    fs.writeFileSync(before, res.ok ? await res.text() : "");
    console.log(`indexnow: saved the live sitemap (${res.status})`);
    return;
  }
  if (cmd !== "ping") throw new Error("usage: indexnow.mjs save|ping");
  const old = entries(
    fs.existsSync(before) ? fs.readFileSync(before, "utf8") : "",
  );
  const changed = [...entries(fs.readFileSync(built, "utf8"))]
    .filter(([loc, mod]) => old.get(loc) !== mod)
    .map(([loc]) => loc);
  if (!changed.length) return console.log("indexnow: nothing changed");
  const k = key();
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: HOST,
      key: k,
      keyLocation: `https://${HOST}/${k}.txt`,
      urlList: changed,
    }),
  });
  console.log(
    `indexnow: submitted ${changed.length} URL(s), HTTP ${res.status}`,
  );
}

main(process.argv[2]).catch((e) =>
  console.warn(`indexnow: skipped (${e.message})`),
);

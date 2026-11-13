// Data stories on the site: the build renders only stories whose verification stamp matches the story file's
// SHA-256, builds nothing (and links nothing) without them, and refuses an unverified or edited story.
// The fixture is a synthetic story (python/tests/test_registry_story.py writes it; invented values).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { indexBody, loadStories, storyBody, strayNumbers } from "./stories.mjs";

const root = new URL("../../", import.meta.url);
const FIXTURES = new URL("./fixtures/stories/", import.meta.url).pathname;
const SLUG = "loving-county-tx-commercial-roll-values-2022-2024";
const canBuild = existsSync(new URL("packages/tools/dist/index.js", root));

const tmp = () => mkdtempSync(join(tmpdir(), "factlot-stories-"));
const copyFixture = () => {
  const dir = tmp();
  for (const f of readdirSync(FIXTURES))
    copyFileSync(join(FIXTURES, f), join(dir, f));
  return dir;
};
const restamp = (dir: string, story: unknown) => {
  const file = join(dir, `${SLUG}.json`);
  writeFileSync(file, JSON.stringify(story, null, 2) + "\n");
  const stamp = JSON.parse(
    readFileSync(join(dir, `${SLUG}.stamp.json`), "utf8"),
  );
  stamp.story_sha256 = createHash("sha256")
    .update(readFileSync(file))
    .digest("hex");
  writeFileSync(
    join(dir, `${SLUG}.stamp.json`),
    JSON.stringify(stamp, null, 2) + "\n",
  );
};
const build = (storiesDir: string | null) => {
  const out = tmp();
  const r = spawnSync("node", ["scripts/site/build.mjs", out], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(storiesDir ? { FACTLOT_STORIES_DIR: storiesDir } : {}),
    },
  });
  return { out, status: r.status, stderr: r.stderr };
};

describe("loadStories", () => {
  it("loads the verified fixture and nothing from a missing folder", () => {
    assert.equal(loadStories(FIXTURES).length, 1);
    assert.deepEqual(loadStories(join(tmp(), "none")), []);
  });
  it("refuses a story with no stamp", () => {
    const dir = copyFixture();
    execFileSync("rm", [join(dir, `${SLUG}.stamp.json`)]);
    assert.throws(() => loadStories(dir), /no verification stamp/);
  });
  it("refuses a story edited after it was verified", () => {
    const dir = copyFixture();
    const file = join(dir, `${SLUG}.json`);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"value": 26', '"value": 27'),
    );
    assert.throws(() => loadStories(dir), /changed after it was verified/);
  });
  it("refuses a stamp that is not a pass", () => {
    const dir = copyFixture();
    const sf = join(dir, `${SLUG}.stamp.json`);
    const stamp = JSON.parse(readFileSync(sf, "utf8"));
    stamp.result = "fail";
    writeFileSync(sf, JSON.stringify(stamp));
    assert.throws(() => loadStories(dir), /not a pass/);
  });
  it("refuses a sentence with a number that is not one of its figures, even with a matching stamp", () => {
    const dir = copyFixture();
    const story = JSON.parse(readFileSync(join(dir, `${SLUG}.json`), "utf8"));
    story.sentences[1].text += " About 4,242 more changed.";
    restamp(dir, story);
    assert.throws(
      () => loadStories(dir),
      /number 4,242 is not one of its figures/,
    );
  });
  it("refuses a small table cell outside a county total and owner names that were not asked for", () => {
    const dir = copyFixture();
    const story = JSON.parse(readFileSync(join(dir, `${SLUG}.json`), "utf8"));
    const t = story.tables.find(
      (x: { id: string }) => x.id === "t.group_change",
    );
    t.rows[1][3] = 4;
    restamp(dir, story);
    assert.throws(() => loadStories(dir), /a cell built from 4 parcels/);
    const story2 = JSON.parse(
      readFileSync(join(FIXTURES, `${SLUG}.json`), "utf8"),
    );
    story2.tables.push({
      id: "t.owners",
      title: "x",
      columns: [],
      rule: "x",
      rows: [["ACME LLC", 11, 1]],
      sources: [],
    });
    restamp(dir, story2);
    assert.throws(() => loadStories(dir), /owner names/);
  });
});

describe("story page", () => {
  const { story, stamp } = loadStories(FIXTURES)[0]!;
  const body = storyBody(story, stamp, null);
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("prints every sentence and every figure's value", () => {
    for (const s of story.sentences)
      assert.ok(text.includes(s.text.replaceAll("&", "&amp;")), s.id);
    assert.deepEqual(strayNumbers(story), []);
  });
  it("names the source files with their as-of dates and the attribution", () => {
    for (const s of story.sources) {
      assert.ok(text.includes(s.source_id), s.source_id);
      assert.ok(text.includes(s.attribution));
    }
    assert.ok(text.includes("as of July 25, 2022"));
  });
  it("carries the boundary text", () => {
    assert.ok(
      text.includes(
        "stated values of Fixture Central Appraisal District as published in the files named above",
      ),
    );
    assert.ok(
      text.includes(
        "not an appraisal or an opinion of value, and not legal, tax or other advice",
      ),
    );
  });
  it("leaves a small cell empty and says why", () => {
    assert.ok(text.includes("fewer than 10 parcels"));
  });
  it("links the hosted tools, and the county page only when the county is hosted", () => {
    assert.ok(body.includes('<a href="/try/">'));
    assert.ok(!body.includes('href="/texas/'));
    assert.ok(
      storyBody(story, stamp, "harris").includes('href="/texas/harris/"'),
    );
  });
  it("uses no style attribute and no script", () => {
    assert.ok(
      !/style=|<script|on\w+=/.test(
        body + indexBody([{ story, stamp, sha256: "" }]),
      ),
    );
  });
});

describe("site build with stories", { skip: !canBuild }, () => {
  it("renders /data/ and the story, adds sitemap entries and a footer link, and loads nothing external", () => {
    const { out, status, stderr } = build(FIXTURES);
    assert.equal(status, 0, stderr);
    const page = readFileSync(`${out}/data/${SLUG}/index.html`, "utf8");
    const index = readFileSync(`${out}/data/index.html`, "utf8");
    assert.ok(
      page.includes(
        `<link rel="canonical" href="https://factlot.com/data/${SLUG}/" />`,
      ),
    );
    assert.ok(index.includes(`href="/data/${SLUG}/"`));
    const sitemap = readFileSync(`${out}/sitemap.xml`, "utf8");
    assert.ok(
      sitemap.includes(
        `<loc>https://factlot.com/data/${SLUG}/</loc><lastmod>2026-11-12</lastmod>`,
      ),
    );
    assert.ok(sitemap.includes("<loc>https://factlot.com/data/</loc>"));
    assert.ok(
      readFileSync(`${out}/texas/index.html`, "utf8").includes(
        '<a href="/data/">Data stories</a>',
      ),
    );
    for (const tag of page.match(/<(?:script|link|img|iframe)\b[^>]*>/g) ?? [])
      assert.ok(
        !/(?:src|href)="(?:https?:)?\/\//.test(tag) ||
          tag.includes("canonical"),
        tag,
      );
    assert.ok(!/style=/.test(page));
  });
  it("builds no /data/ section and no link when there are no stories", () => {
    const empty = tmp();
    for (const dir of [empty, null]) {
      const { out, status, stderr } = build(dir);
      assert.equal(status, 0, stderr);
      assert.ok(!existsSync(`${out}/data`));
      assert.ok(!readFileSync(`${out}/sitemap.xml`, "utf8").includes("/data/"));
      assert.ok(
        !readFileSync(`${out}/texas/index.html`, "utf8").includes(
          "Data stories",
        ),
      );
    }
  });
  it("refuses to build with an unverified or edited story", () => {
    const noStamp = copyFixture();
    execFileSync("rm", [join(noStamp, `${SLUG}.stamp.json`)]);
    const a = build(noStamp);
    assert.notEqual(a.status, 0);
    assert.match(a.stderr, /no verification stamp/);
    const edited = copyFixture();
    const file = join(edited, `${SLUG}.json`);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"value": 26', '"value": 27'),
    );
    const b = build(edited);
    assert.notEqual(b.status, 0);
    assert.match(b.stderr, /changed after it was verified/);
  });
});

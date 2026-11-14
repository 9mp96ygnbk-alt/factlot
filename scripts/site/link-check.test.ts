// The build's link check (link-check.mjs): a broken internal link fails the build, and the only links
// exempt from resolving to a file are the lookup pages, which the Worker answers itself.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { linkResolves, siteProblems, workerAnswered } from "./link-check.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** A built folder with one page linking to each of `hrefs`, and the files a link may resolve to. */
function folder(hrefs: string[]): string {
  const out = mkdtempSync(join(tmpdir(), "factlot-link-check-"));
  mkdirSync(join(out, "pricing"));
  writeFileSync(join(out, "pricing", "index.html"), "<p>pricing</p>");
  writeFileSync(join(out, "styles.css"), "");
  writeFileSync(
    join(out, "index.html"),
    hrefs.map((h) => `<a href="${h}">x</a>`).join("\n"),
  );
  return out;
}

describe("the build's link check", () => {
  it("fails a mistyped link under any path the Worker answers, except the lookup pages", () => {
    const broken = [
      "/billing/chekout",
      "/billing",
      "/v1/registry/serch_address",
      "/v1",
      "/mcp/signn",
      "/health/x",
      "/openapi-3.1.json",
      "/pricng/",
    ];
    const fine = [
      "/",
      "/pricing/",
      "/pricing/#free",
      "/styles.css",
      "/lookup",
      "/lookup/",
      "/lookup/?q=1000+Louisiana+St&amp;state=TX",
      "/lookup/us-48201/0011440000001",
    ];
    const out = folder([...broken, ...fine]);
    assert.deepEqual(
      siteProblems(out),
      broken.map((u) => `index.html: broken link ${u}`),
    );
    for (const u of fine) assert.ok(linkResolves(out, u), u);
    assert.ok(workerAnswered("/lookup") && workerAnswered("/lookup/x"));
    for (const p of ["/lookups", "/v1", "/billing", "/mcp", "/health"])
      assert.ok(!workerAnswered(p), p);
  });

  it("is what the build runs last, and a problem stops the build", () => {
    assert.match(
      readFileSync(join(root, "scripts/site/build.mjs"), "utf8"),
      /const problems = siteProblems\(out\);\nif \(problems\.length\) \{\n {2}console\.error\(problems\.join\("\\n"\)\);\n {2}process\.exit\(1\);\n\}/,
    );
  });

  it(
    "passes the real site, and fails it once a page holds a broken internal link",
    { skip: !existsSync(join(root, "packages/tools/dist/index.js")) },
    () => {
      const out = mkdtempSync(join(tmpdir(), "factlot-site-links-"));
      execFileSync("node", ["scripts/site/build.mjs", out], {
        cwd: root,
        stdio: "pipe",
      });
      assert.deepEqual(siteProblems(out), []);
      const page = join(out, "pricing", "index.html");
      writeFileSync(
        page,
        readFileSync(page, "utf8").replace(
          "</main>",
          '<a href="/billing/chekout">checkout</a></main>',
        ),
      );
      assert.deepEqual(siteProblems(out), [
        `${join("pricing", "index.html")}: broken link /billing/chekout`,
      ]);
    },
  );
});

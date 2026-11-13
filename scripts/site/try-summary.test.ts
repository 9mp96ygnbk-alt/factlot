// /try/: the plain summary shown before the cited record, its three actions, and the section for
// people without an AI assistant.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  OWNER_NOT_ORGANISATION,
  OWNER_NOT_PUBLISHED,
} from "../../packages/reports/src/index.ts";
import { REPORTS_PER_MONTH } from "../../deploy/cloudflare/src/plans.ts";
import { ownerNamesAPerson } from "../../deploy/cloudflare/src/property-pages.ts";
import { propertyPath } from "../../deploy/registry/src/page-rules.ts";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const js = read("site/try/try.js");
const html = read("site/_content/try.html");

/** The text between two marker comments of try.js. */
function block(name: string): string {
  const start = js.indexOf(`// ${name}:start`);
  const end = js.indexOf(`// ${name}:end`);
  assert.ok(start >= 0 && end > start, `${name} markers`);
  return js.slice(start, end);
}
const summary = block("summary");

/** A string constant of try.js, as written. */
function constant(name: string): string {
  const m = new RegExp(`var ${name} =\\s*"([^"]*)";`).exec(js);
  assert.ok(m, name);
  return m[1]!;
}

describe("/try/ plain summary", () => {
  it("uses plain words: no URN, MCP or JSON in anything the summary writes", () => {
    const strings = [...summary.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(
      (m) => m[1]!,
    );
    assert.ok(strings.length > 40);
    for (const s of strings)
      assert.ok(!/\b(URN|MCP|JSON)\b/i.test(s), `plain words: ${s}`);
  });

  it("draws every value row through one function", () => {
    assert.match(summary, /function valueRow\(v\)/);
    assert.equal([...summary.matchAll(/valueRow\(/g)].length, 2);
    assert.equal([...js.matchAll(/valueRow\(/g)].length, 2);
  });

  it("words a missing owner as the sheet does, and withholds an owner written like a person's trust by the pages' rule", () => {
    assert.equal(constant("OWNER_NOT_PUBLISHED"), OWNER_NOT_PUBLISHED);
    assert.equal(constant("OWNER_NOT_ORGANISATION"), OWNER_NOT_ORGANISATION);
    const rule = block("person-rule").replace("// person-rule:start", "");
    const reads = new Function(`${rule}; return ownerReadsAsPerson;`)() as (
      v: string,
    ) => boolean;
    for (const owner of [
      "LOUISIANA TOWER HOLDINGS LLC",
      "SMITH FAMILY TRUST DTD 1999",
      "ESTATE OF JOHN DOE",
      "REAL ESTATE OF TEXAS LLC",
      "JONES JOHN TR",
      "BOARD OF TRUSTEES OF THE UNIVERSITY",
      "TRUSTEES OF FIRST BAPTIST CHURCH",
      "DOE HEIRS",
      "ACME REVOCABLE TRUST",
      "LIFE ESTATE PROPERTIES",
    ])
      assert.equal(reads(owner), ownerNamesAPerson(owner), owner);
  });

  it("links a property page by the pages' own path rule, after asking the site whether it serves one", () => {
    const re = new RegExp(
      /var PARCEL_ID = \/(.+)\/;/.exec(summary)![1]!.replace(/\\\//g, "/"),
    );
    for (const urn of [
      "fl:parcel:us-48201:0011440000001",
      "fl:parcel:us-11001:0376-0068",
      "fl:parcel:us-06037:5151015013",
      "fl:entity:us-tx:1",
      "fl:parcel:us-48201:ABC",
    ]) {
      const m = re.exec(urn);
      assert.equal(
        m ? `/property/${m[1]}/${m[2]}` : null,
        propertyPath(urn),
        urn,
      );
    }
    assert.match(
      summary,
      /fetch\(path, \{ method: "HEAD", credentials: "omit", cache: "no-store" \}\)/,
    );
    assert.match(summary, /res\.status === 200/);
  });

  it("asks for a property_sheet PDF of this parcel only, and follows only the report service's own link", () => {
    assert.match(
      summary,
      /post\(REPORTS, \{\s*kind: "property_sheet",\s*format: "pdf",\s*arguments: \{ urn: urn \},\s*\}\)/,
    );
    // The download link is the report service's own, followed as a path on this site.
    const re = new RegExp(
      /function downloadLink\(u\) \{[\s\S]*?\/(\^https:.*\$)\/\.exec/
        .exec(summary)![1]!
        .replace(/\\\//g, "/"),
    );
    const token = "a".repeat(43);
    assert.equal(
      re.exec(`https://api.factlot.com/v1/reports/d/${token}`)?.[1],
      `/v1/reports/d/${token}`,
    );
    for (const bad of [
      `http://api.factlot.com/v1/reports/d/${token}`,
      `https://evil.example/x/v1/reports/d/${token}`,
      `https://api.factlot.com/v1/reports/d/${token}?x=1`,
      "javascript:alert(1)",
    ])
      assert.equal(re.exec(bad), null, bad);
  });

  it("says what a sheet uses, with the free plan's own numbers", () => {
    assert.equal(REPORTS_PER_MONTH.anonymous, 3);
    assert.match(
      constant("SHEET_NOTE"),
      /one of the free tier's 3 reports a month and one lookup/,
    );
    assert.match(
      html.replace(/\s+/g, " "),
      /uses one of the free tier's 3 reports a month and one lookup/,
    );
    for (const label of [
      "Download a one-page sheet (PDF)",
      "Open this property's page",
      "Copy as text",
    ])
      assert.ok(summary.includes(`"${label}"`), label);
  });

  it("loads nothing from another origin: every request is a same-origin path", () => {
    assert.ok(!/https?:\/\//.test(js), "no absolute URL in the script");
    assert.equal([...js.matchAll(/\bfetch\(/g)].length, 2);
    assert.match(js, /return fetch\(path, \{/);
    assert.match(
      summary,
      /var path = "\/property\/" \+ m\[1\] \+ "\/" \+ m\[2\];/,
    );
    assert.ok(!/\bon[a-z]+\s*=/.test(js), "no inline event handlers");
    assert.ok(!/\bon[a-z]+="/.test(html), "no inline handlers in the page");
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "eval("])
      assert.ok(!js.includes(bad), bad);
  });

  it("lists several matching parcels with what tells them apart, and shows the API's message for none", () => {
    assert.match(
      js,
      /el\("span", \{ class: "small", text: distinguish\(it\) \}\)/,
    );
    assert.match(
      js,
      /typeof r\.data\.message === "string" \? r\.data\.message : ""/,
    );
  });
});

describe("/try/ without an AI assistant", () => {
  const flat = html.replace(/\s+/g, " ");
  it("explains the page, the sheet, the property pages and the calculators' worked examples", () => {
    assert.ok(
      flat.includes(
        '<h2 id="without-an-assistant">Using FactLot without an AI assistant</h2>',
      ),
    );
    for (const s of [
      "<strong>This page</strong>",
      "<strong>The property sheet</strong>",
      "<strong>A property page</strong>",
      '<a href="/calculators/">the calculators page</a>',
    ])
      assert.ok(flat.includes(s), s);
    assert.ok(
      !/\b(URN|MCP|JSON)\b/.test(
        flat.slice(
          flat.indexOf("without-an-assistant"),
          flat.indexOf('id="next"'),
        ),
      ),
    );
  });
});

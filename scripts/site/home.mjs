// The home page's figures that state facts: the fact card, the diagram of how an answer is made
// and the coverage preview. Each is drawn from the data another page is already built from (the
// Harris County worked example, the coverage geometry, the hosted counties), so the home page
// cannot show a number those pages do not. build.mjs puts them where site/index.html names them.
import { INSETS, insetSvg } from "./coverage-maps.mjs";
import { exampleFacts, exampleSources } from "./texas-pages.mjs";

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The facts of the worked example the card shows, in order. */
const CARD_FACTS = [
  "parcel.market_value",
  "parcel.improvement_area_sf",
  "parcel.year_built",
  "parcel.building_class",
];

const pick = (e, predicates) => {
  const facts = exampleFacts(e);
  return predicates.map((p) => {
    const f = facts.find((x) => x.predicate === p);
    if (!f) throw new Error(`home: the worked example has no ${p}`);
    return f;
  });
};

/**
 * The fact card: one parcel of the worked example as an agent receives it, each value with the
 * source and record it cites. `e`: an entry of site/_data/texas-examples.json. `href`: its page.
 */
export function factCard(e, href) {
  const rows = pick(e, CARD_FACTS);
  const sources = exampleSources(e).filter((s) =>
    rows.some((r) => r.source === s.n),
  );
  return `<article class="factcard" aria-labelledby="fc-title">
<p class="factcard-bar"><span><b>registry_get</b></span><span>as of ${esc(rows[0].as_of)}</span></p>
<div class="factcard-head">
<h2 id="fc-title">${esc(e.label)}</h2>
<p>${esc(e.urn)}</p>
</div>
<dl class="factrows">
${rows
  .map(
    (r, i) =>
      `<div><dt>${esc(r.label)}</dt><dd${i === 0 ? ' class="big"' : ""}>${r.value}</dd><dd class="src"><span class="cite"><b>${r.source}</b> ${esc(r.locator)}</span></dd></div>`,
  )
  .join("\n")}
</dl>
<div class="factcard-foot">
<ol>
${sources.map((s) => `<li data-n="${s.n}">${esc(s.title)}, retrieved ${esc(s.retrieved)}</li>`).join("\n")}
</ol>
<p><a href="${esc(href)}">The worked example</a></p>
</div>
</article>`;
}

/** The plat behind the card: a street grid with the card's corner inside the subject block. */
export function platSvg() {
  const W = 1200;
  const H = 1000;
  const CX = 300;
  const CY = 260;
  const bw = 132;
  const bh = 104;
  const st = 26;
  const sx = CX - 74;
  const sy = CY - 62;
  const blocks = [];
  const lots = [];
  for (let r = -3; r < 8; r += 1)
    for (let c = -3; c < 8; c += 1) {
      if (c === 0 && r === 0) continue;
      const x = sx + c * (bw + st) + (c >= 2 ? 14 : 0);
      const y = sy + r * (bh + st);
      blocks.push(`M${x} ${y}h${bw}v${bh}h-${bw}z`);
      const n = (((c + r) % 3) + 3) % 3 ? 4 : 3;
      for (let i = 1; i < n; i += 1)
        lots.push(`M${x + Math.round((bw / n) * i)} ${y}v${bh}`);
      if ((((c * 3 + r) % 4) + 4) % 4 !== 0)
        lots.push(`M${x} ${y + Math.floor(bh / 2)}h${bw}`);
    }
  let hatch = "";
  for (let k = 13; k < bw + bh; k += 13) {
    const a = k <= bh ? [sx, sy + k] : [sx + k - bh, sy + bh];
    const b = k <= bw ? [sx + k, sy] : [sx + bw, sy + k - bw];
    hatch += `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  }
  const mons = [
    [0, 0],
    [bw, 0],
    [0, bh],
  ]
    .map(
      ([dx, dy]) =>
        `<circle class="mon" cx="${sx + dx}" cy="${sy + dy}" r="4.5"/>`,
    )
    .join("");
  return `<svg class="plat" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">
<g transform="rotate(-7 ${CX} ${CY})">
<path class="blocks" d="${blocks.join("")}"/>
<path class="lots" d="${lots.join("")}"/>
<path class="subject" d="M${sx} ${sy}h${bw}v${bh}h-${bw}z"/>
<path class="hatch" d="${hatch}"/>
${mons}
</g>
</svg>`;
}

/** What the diagram shows of the worked example: two cited values, the record and the file. */
function drawn(e) {
  const [value, year] = pick(e, ["parcel.market_value", "parcel.year_built"]);
  const src = exampleSources(e).find((s) => s.n === value.source);
  const [file, ...rest] = value.locator.split(" ");
  return {
    urn: e.urn,
    value,
    year,
    chip: `[${value.source}] ${value.locator}`,
    file,
    record: rest.join(" "),
    publisher: src.title.split(": ")[0],
    retrieved: src.retrieved,
  };
}

const DESC =
  "Your agent or app calls a FactLot tool. FactLot's calculators, IDs and registry produce the answer. The answer is a cited record: each value names the file and the record it was read from. The citation points at the public source.";

/** A long publisher name on up to three lines of at most `max` characters. */
const lines = (s, max) => {
  const out = [""];
  for (const w of s.split(" ")) {
    const last = out[out.length - 1];
    if (last && `${last} ${w}`.length > max) out.push(w);
    else out[out.length - 1] = last ? `${last} ${w}` : w;
  }
  return out.slice(0, 3);
};

/** How an answer is made, for a wide screen. */
export function flowWide(e) {
  const d = drawn(e);
  const who = lines(d.publisher, 20);
  return `<svg class="wide" viewBox="0 0 1180 372" role="img" aria-labelledby="flow-t flow-d">
<title id="flow-t">How a FactLot answer is made</title>
<desc id="flow-d">${esc(DESC)}</desc>
<text class="t-l" x="0" y="18">01 · YOUR AGENT OR APP</text>
<rect class="box" x="0.6" y="34" width="218" height="132" rx="8"/>
<text class="t-l" x="16" y="60">TOOL CALL</text>
<text class="t-m" x="16" y="86">registry_get(</text>
<text class="t-m" x="28" y="106">"${esc(d.urn.slice(0, d.urn.lastIndexOf(":") + 1))}…"</text>
<text class="t-m" x="16" y="126">)</text>
<text class="t-l" x="16" y="150">MCP · REST · PYTHON</text>
<rect class="soft" x="0.6" y="206" width="218" height="132" rx="8"/>
<text class="t-l" x="16" y="232">WHAT COMES BACK</text>
<circle class="pin" cx="20" cy="253" r="3"/><text class="t-m" x="32" y="257">the value</text>
<circle class="pin" cx="20" cy="275" r="3"/><text class="t-m" x="32" y="279">the method or formula ID</text>
<circle class="pin" cx="20" cy="297" r="3"/><text class="t-m" x="32" y="301">the source and record</text>
<circle class="pin" cx="20" cy="319" r="3"/><text class="t-m" x="32" y="323">the rights that travel</text>
<path class="go" d="M219 100H290"/><path class="head" d="M300 100l-11-5.5v11z"/>
<path class="go" d="M300 272H229"/><path class="head" d="M219 272l11-5.5v11z"/>
<text class="t-l" x="300" y="18">02 · FACTLOT</text>
<rect class="box" x="300.6" y="34" width="286" height="92" rx="8"/>
<text class="t-h" x="318" y="64">Calculators</text>
<text class="t-m" x="318" y="88">steps · warnings · formula ID</text>
<text class="t-m" x="318" y="108">calc.net_effective_rent@1</text>
<rect class="box" x="300.6" y="140" width="286" height="92" rx="8"/>
<text class="t-h" x="318" y="170">IDs</text>
<text class="t-m" x="318" y="194">parcels · entities · documents</text>
<text class="t-m" x="318" y="214">${esc(d.urn)}</text>
<rect class="box" x="300.6" y="246" width="286" height="92" rx="8"/>
<text class="t-h" x="318" y="276">Registry</text>
<text class="t-m" x="318" y="300">parcel › owner of record › entity</text>
<text class="t-m" x="318" y="320">from public records only</text>
<path class="accl" d="M300.6 60v252"/>
<circle class="acc" cx="300.6" cy="80" r="4.5"/><circle class="acc" cx="300.6" cy="186" r="4.5"/><circle class="acc" cx="300.6" cy="292" r="4.5"/>
<path class="go" d="M587 292H614V186H630"/><path class="head" d="M640 186l-11-5.5v11z"/>
<text class="t-l" x="640" y="18">03 · THE CITED RECORD</text>
<rect class="box" x="640.6" y="34" width="292" height="304" rx="8"/>
<text class="t-m" x="658" y="62">${esc(d.value.predicate)}</text>
<text class="t-v" x="658" y="88">${d.value.value}</text>
<rect class="chip" x="658" y="100" width="258" height="24" rx="4"/>
<text class="t-c" x="666" y="116">${esc(d.chip)}</text>
<path class="rule" d="M658 142H916"/>
<text class="t-m" x="658" y="166">${esc(d.year.predicate)}</text>
<text class="t-v" x="658" y="192">${d.year.value}</text>
<rect class="chip" x="658" y="204" width="258" height="24" rx="4"/>
<text class="t-c" x="666" y="220">${esc(`[${d.year.source}] ${d.year.locator}`)}</text>
<path class="rule" d="M658 246H916"/>
<text class="t-l" x="658" y="270">METHOD</text><text class="t-m" x="738" y="270">public_record</text>
<text class="t-l" x="658" y="292">AS OF</text><text class="t-m" x="738" y="292">${esc(d.value.as_of)}</text>
<text class="t-l" x="658" y="314">RIGHTS</text><text class="t-m" x="738" y="314">licence · AI use</text>
<path class="thread" d="M916 112C966 112 964 150 1012 150"/>
<path class="thread" d="M916 216C966 216 964 150 1012 150"/>
<circle class="pin" cx="916" cy="112" r="4"/><circle class="pin" cx="916" cy="216" r="4"/>
<text class="t-l" x="1002" y="18">04 · THE PUBLIC SOURCE</text>
<path class="box" d="M1010.6 34H1114L1145.4 65V250a8 8 0 0 1-8 8H1018.6a8 8 0 0 1-8-8V42a8 8 0 0 1 8-8Z"/>
<path class="rule" d="M1114 34V65H1145.4"/>
<text class="t-m" x="1024" y="62">${esc(d.file)}</text>
<path class="rule" d="M1024 84H1132M1024 102H1132M1024 120H1132M1024 180H1132M1024 198H1132M1024 216H1132M1024 234H1116"/>
<rect class="hit" x="1018" y="138" width="120" height="24" rx="4"/>
<text class="t-c sm" x="1024" y="154">${esc(d.record)}</text>
<circle class="pin" cx="1012" cy="150" r="4"/>
${who.map((l, i) => `<text class="t-h sm2" x="1010" y="${286 + i * 18}">${esc(l)}</text>`).join("\n")}
<text class="t-l" x="1010" y="${292 + who.length * 18}">RETRIEVED ${esc(d.retrieved)}</text>
</svg>`;
}

/** The same, top to bottom, for a narrow screen. */
export function flowTall(e) {
  const d = drawn(e);
  const who = lines(d.publisher, 14);
  return `<svg class="tall" viewBox="0 0 360 1010" role="img" aria-labelledby="flowt-t flowt-d">
<title id="flowt-t">How a FactLot answer is made</title>
<desc id="flowt-d">${esc(DESC)}</desc>
<text class="t-l" x="0" y="14">01 · YOUR AGENT OR APP</text>
<rect class="box" x="0.6" y="28" width="358.8" height="112" rx="8"/>
<text class="t-l" x="16" y="54">TOOL CALL</text>
<text class="t-m" x="16" y="80">registry_get(</text>
<text class="t-m" x="28" y="100">"${esc(d.urn)}"</text>
<text class="t-m" x="16" y="120">)</text>
<path class="go" d="M180 140V170"/><path class="head" d="M180 180l-5.5-11h11z"/>
<text class="t-l" x="0" y="204">02 · FACTLOT</text>
<rect class="box" x="0.6" y="218" width="358.8" height="76" rx="8"/>
<text class="t-h" x="20" y="246">Calculators</text>
<text class="t-m" x="20" y="270">steps · warnings · formula ID</text>
<rect class="box" x="0.6" y="304" width="358.8" height="76" rx="8"/>
<text class="t-h" x="20" y="332">IDs</text>
<text class="t-m" x="20" y="356">${esc(d.urn)}</text>
<rect class="box" x="0.6" y="390" width="358.8" height="76" rx="8"/>
<text class="t-h" x="20" y="418">Registry</text>
<text class="t-m" x="20" y="442">parcel › owner of record › entity</text>
<path class="accl" d="M0.6 240v204"/>
<circle class="acc" cx="0.6" cy="256" r="4.5"/><circle class="acc" cx="0.6" cy="342" r="4.5"/><circle class="acc" cx="0.6" cy="428" r="4.5"/>
<path class="go" d="M180 466V496"/><path class="head" d="M180 506l-5.5-11h11z"/>
<text class="t-l" x="0" y="530">03 · THE CITED RECORD</text>
<rect class="box" x="0.6" y="544" width="358.8" height="216" rx="8"/>
<text class="t-m" x="18" y="572">${esc(d.value.predicate)}</text>
<text class="t-v" x="18" y="598">${d.value.value}</text>
<rect class="chip" x="18" y="610" width="252" height="24" rx="4"/>
<text class="t-c" x="26" y="626">${esc(d.chip)}</text>
<path class="rule" d="M18 652H342"/>
<text class="t-m" x="18" y="676">${esc(d.year.predicate)}</text>
<text class="t-v" x="18" y="702">${d.year.value}</text>
<rect class="chip" x="18" y="714" width="252" height="24" rx="4"/>
<text class="t-c" x="26" y="730">${esc(`[${d.year.source}] ${d.year.locator}`)}</text>
<path class="thread" d="M270 622C330 622 322 800 322 880H200"/>
<path class="thread" d="M270 726C306 726 322 760 322 800"/>
<circle class="pin" cx="270" cy="622" r="4"/><circle class="pin" cx="270" cy="726" r="4"/>
<text class="t-l" x="0" y="794">04 · THE PUBLIC SOURCE</text>
<path class="box" d="M8.6 808H170L200.4 838V994a8 8 0 0 1-8 8H8.6a8 8 0 0 1-8-8V816a8 8 0 0 1 8-8Z"/>
<path class="rule" d="M170 808V838H200.4"/>
<text class="t-m" x="16" y="836">${esc(d.file)}</text>
<path class="rule" d="M16 854H184M16 910H184M16 928H184M16 946H184M16 964H184M16 982H150"/>
<rect class="hit" x="10" y="868" width="182" height="24" rx="4"/>
<text class="t-c" x="18" y="884">${esc(d.record)}</text>
<circle class="pin" cx="200" cy="880" r="4"/>
${who.map((l, i) => `<text class="t-h sm2" x="222" y="${920 + i * 18}">${esc(l)}</text>`).join("\n")}
<text class="t-l" x="222" y="${926 + who.length * 18}">RETRIEVED</text>
<text class="t-l" x="222" y="${942 + who.length * 18}">${esc(d.retrieved)}</text>
</svg>`;
}

/**
 * The coverage preview: the national map (a file, loaded as an image) and the insets, hosted
 * counties only. `counties`: [{ fips, title }] of the hosted counties.
 */
export function coveragePreview(geo, counties) {
  const shown = counties.map((c) => ({ ...c, cls: "hosted" }));
  return `<a class="mapframe" href="/coverage/">
<img src="/coverage/map-mini.svg" width="975" height="610" alt="Map of the United States with the counties the hosted registry answers for marked. Open the full coverage map." />
</a>
<div class="insets">
${INSETS.map((i) => `<div class="insetfig">\n${insetSvg(geo, i, shown, { idPrefix: "home" })}\n<p>${esc(i.name)}</p>\n</div>`).join("\n")}
</div>`;
}

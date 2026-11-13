// The small maps drawn from site/_content/coverage-geometry.json: the national map of hosted
// counties (a file, so pages that show it do not carry its paths) and the insets, where the
// hosted counties are large enough to read. Pure functions: build.mjs writes what they return,
// and site.test.ts calls them, so a map cannot show a county the coverage data does not hold.

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The bounding box of a path made of M, l and Z commands (the geometry file's only commands). */
export function box(d) {
  const xs = [];
  const ys = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, body] of d.matchAll(/([MlZ])([^MlZ]*)/g)) {
    const nums = (body.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "M") {
      [x, y] = nums;
      xs.push(x);
      ys.push(y);
    }
    if (cmd === "l")
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x += nums[i];
        y += nums[i + 1];
        xs.push(x);
        ys.push(y);
      }
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

/** Alaska and Hawaii (state FIPS). */
const OFF_MAP = ["02", "15"];

const meets = (b, [x, y, w, h]) =>
  b.x1 >= x && b.x0 <= x + w && b.y1 >= y && b.y0 <= y + h;

/**
 * The insets: a name, the part of the national map shown (x, y, width, height in the geometry's
 * 975 by 610 units), the states drawn when the inset stands alone (those with a hosted county,
 * and the ones between them), and the labels, each a place the pages already name, set beside
 * the county `at` (5-digit FIPS) on the side given.
 */
export const INSETS = [
  {
    id: "texas",
    name: "Texas",
    view: [246, 343, 348, 261],
    states: ["48"],
    labels: [
      ["48201", "Harris", "s"],
      ["48113", "Dallas", "e"],
      ["48453", "Travis", "w"],
      ["48061", "Cameron", "w"],
      ["48355", "Nueces", "e"],
      ["48245", "Jefferson", "e"],
      ["48041", "Brazos", "w"],
      ["48329", "Midland", "e"],
      ["48135", "Ector", "w"],
    ],
  },
  {
    id: "northeast",
    name: "Maryland to Boston",
    view: [748, 148, 200, 150],
    states: ["24", "11", "36", "09", "25", "34", "42", "10", "44"],
    labels: [
      ["11001", "District of Columbia", "w"],
      ["24031", "Maryland", "n"],
      ["36061", "New York City", "w"],
      ["09003", "Connecticut", "n"],
      ["25025", "Boston", "n"],
    ],
  },
  {
    id: "west",
    name: "Utah, Denver and California",
    view: [5, 150, 400, 300],
    states: ["49", "08", "06", "32", "04"],
    labels: [
      ["49023", "Juab", "w"],
      ["49043", "Summit", "e"],
      ["08031", "Denver", "e"],
      ["06037", "Los Angeles", "e"],
      ["06075", "San Francisco", "e"],
    ],
  },
];

/**
 * One inset as inline SVG. `counties`: [{ fips, cls, title, href? }], the coloured counties; those
 * outside the view are left out. A county with `href` is a link. `width`: the width in CSS pixels
 * the drawing is designed for, which sizes its labels and dots. `refs`: the page already holds
 * the full map (the nation as #cov-nation, the meshes as #cov-cmesh and #cov-smesh, each county
 * as <path id="p<fips>">), so the inset points at those instead of repeating them.
 */
export function insetSvg(
  geo,
  inset,
  counties,
  { width = 440, idPrefix, refs = false } = {},
) {
  const [x, y, w, h] = inset.view;
  const u = w / width; // geometry units per CSS pixel
  const n = (v) => String(Math.round(v * 100) / 100);
  const id = `${idPrefix ?? "inset"}-${inset.id}`;
  // Alaska and Hawaii are drawn below the south-west on the national map: an inset leaves them out.
  const apart = OFF_MAP.map((f) => box(geo.states[f].d)).filter((b) =>
    meets(b, inset.view),
  );
  const clip = apart.length
    ? `<clipPath id="${id}-c"><path clip-rule="evenodd" d="M${x} ${y}h${w}v${h}h${-w}z${apart.map((b) => `M${n(b.x0 - 2)} ${n(b.y0 - 2)}h${n(b.x1 - b.x0 + 4)}v${n(b.y1 - b.y0 + 4)}h${n(b.x0 - b.x1 - 4)}z`).join("")}"/></clipPath>\n`
    : "";
  const clipped = apart.length ? ` clip-path="url(#${id}-c)"` : "";
  const land = refs
    ? `${clip}<use class="nation" href="#cov-nation"${clipped}/>`
    : `<path class="land" d="${inset.states.map((f) => geo.states[f].d).join("")}"/>`;
  const mesh = refs
    ? `<use class="cmesh" href="#cov-cmesh"${clipped}/>\n<use class="smesh" href="#cov-smesh"${clipped}/>\n`
    : "";
  const boxes = new Map();
  const shown = counties.filter((c) => {
    const b = box(geo.counties[c.fips].d);
    boxes.set(c.fips, b);
    return meets(b, inset.view);
  });
  const shapes = shown
    .map((c) => {
      const b = boxes.get(c.fips);
      const small = Math.max(b.x1 - b.x0, b.y1 - b.y0) < 9 * u;
      const dot = small
        ? `<circle class="dot" cx="${n((b.x0 + b.x1) / 2)}" cy="${n((b.y0 + b.y1) / 2)}" r="${n(4.5 * u)}"/>`
        : "";
      const inner = refs
        ? `<use href="#p${c.fips}"/>${dot}`
        : `<title>${esc(c.title)}</title><path d="${geo.counties[c.fips].d}"/>${dot}`;
      return c.href
        ? `<a class="cty cov-${c.cls}" href="${esc(c.href)}">${inner}</a>`
        : `<g class="cty cov-${c.cls}">${inner}</g>`;
    })
    .join("\n");
  const labels = inset.labels
    .filter(([fips]) => boxes.has(fips) && meets(boxes.get(fips), inset.view))
    .map(([fips, text, side]) => {
      const b = boxes.get(fips);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      const gap = Math.max(5 * u, 0);
      const half = Math.max((b.x1 - b.x0) / 2, 4.5 * u);
      const halfY = Math.max((b.y1 - b.y0) / 2, 4.5 * u);
      const at =
        side === "e"
          ? [cx + half + gap, cy + 3.5 * u, "start"]
          : side === "w"
            ? [cx - half - gap, cy + 3.5 * u, "end"]
            : side === "n"
              ? [cx, cy - halfY - gap, "middle"]
              : [cx, cy + halfY + gap + 8 * u, "middle"];
      return `<text x="${n(at[0])}" y="${n(at[1])}" text-anchor="${at[2]}" font-size="${n(10.5 * u)}">${esc(text)}</text>`;
    })
    .join("\n");
  return `<svg class="covsvg inset" viewBox="${x} ${y} ${w} ${h}" role="img" aria-labelledby="${id}-t" xmlns="http://www.w3.org/2000/svg">
<title id="${id}-t">${esc(inset.name)}: counties with hosted data</title>
${land}
${shapes}
${mesh}${labels}
</svg>`;
}

/**
 * The national map of hosted counties as a file of its own (loaded as an image, so it carries
 * its own colours for both themes).
 */
export function miniMapSvg(geo, hostedFips) {
  const paths = [];
  const dots = [];
  for (const fips of hostedFips) {
    const d = geo.counties[fips].d;
    const b = box(d);
    paths.push(d);
    if (Math.max(b.x1 - b.x0, b.y1 - b.y0) < 6)
      dots.push(
        `<circle cx="${((b.x0 + b.x1) / 2).toFixed(1)}" cy="${((b.y0 + b.y1) / 2).toFixed(1)}" r="5"/>`,
      );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geo.viewBox}" width="975" height="610">
<title>Counties the hosted FactLot registry answers for</title>
<style>
.n{fill:#e3ded1}.s{fill:none;stroke:#fcfbf7;stroke-width:1.2}.h{fill:#c8400b;stroke:#c8400b;stroke-width:.8;stroke-linejoin:round}.d{fill:#c8400b;stroke:#fcfbf7;stroke-width:1.4}
@media (prefers-color-scheme:dark){.n{fill:#232b32}.s{stroke:#161c21}.h{fill:#ff7d45;stroke:#ff7d45}.d{fill:#ff7d45;stroke:#161c21}}
</style>
<path class="n" d="${geo.nation}"/>
<path class="s" d="${geo.stateMesh}"/>
<path class="h" d="${paths.join("")}"/>
<g class="d">${dots.join("")}</g>
</svg>
`;
}

// Run once (not part of the build): npx -p us-atlas@3.0.1 -p topojson-client@3 -p topojson-simplify@3 ... or from a scratch folder with those
// three packages installed: MINW=1 node coverage-geometry.mjs <repo>/site/_content/coverage-geometry.json
// Pre-projects nothing (us-atlas albers is already projected to 975x610); turns TopoJSON into SVG path strings.
import fs from "node:fs";
import * as tc from "topojson-client";
import * as ts from "topojson-simplify";
const MINW = Number(process.env.MINW ?? 0.25);
const topo = ts.simplify(
  ts.presimplify(
    JSON.parse(
      fs.readFileSync("node_modules/us-atlas/counties-albers-10m.json", "utf8"),
    ),
  ),
  MINW,
);
const r = (n) => Math.round(n * 10) / 10;
const n = (v) => {
  const t = String(Math.round(v * 10) / 10);
  return t.startsWith("0.")
    ? t.slice(1)
    : t.startsWith("-0.")
      ? "-" + t.slice(2)
      : t;
};
function ring(coords) {
  let d = "",
    px,
    py,
    k = 0;
  coords.forEach(([x, y], i) => {
    x = r(x);
    y = r(y);
    if (i && x === px && y === py) return;
    if (!i) d += "M" + x + "," + y;
    else {
      const dx = n(x - px),
        dy = n(y - py);
      d +=
        (k++ ? (dx.startsWith("-") ? "" : " ") : "l") +
        dx +
        (dy.startsWith("-") ? "" : " ") +
        dy;
    }
    px = x;
    py = y;
  });
  return d;
}
function pathOf(geom) {
  if (!geom) return "";
  const t = geom.type;
  const polys =
    t === "Polygon"
      ? [geom.coordinates]
      : t === "MultiPolygon"
        ? geom.coordinates
        : t === "MultiLineString"
          ? [geom.coordinates]
          : t === "LineString"
            ? [[geom.coordinates]]
            : [];
  const closed = t.endsWith("Polygon");
  return polys
    .map((p) => p.map((c) => ring(c) + (closed ? "Z" : "")).join(""))
    .join("");
}
const counties = {};
for (const f of tc.feature(topo, topo.objects.counties).features)
  counties[f.id] = { name: f.properties.name, d: pathOf(f.geometry) };
const states = {};
for (const f of tc.feature(topo, topo.objects.states).features)
  states[f.id] = { name: f.properties.name, d: pathOf(f.geometry) };
const out = {
  _source: `us-atlas 3.0.1 counties-albers-10m.json (ISC licence, Mike Bostock), derived from the US Census Bureau cartographic boundary files, 2017 edition (public domain); projected with d3.geoAlbersUsa to a 975x610 viewport. Simplified (topojson-simplify, minimum weight ${MINW} px²), paths rounded to 0.1 px by scripts/site/coverage-geometry.mjs.`,
  viewBox: "0 0 975 610",
  nation: pathOf(tc.feature(topo, topo.objects.nation).features[0].geometry),
  stateMesh: pathOf(tc.mesh(topo, topo.objects.states, (a, b) => a !== b)),
  countyMesh: pathOf(
    tc.mesh(
      topo,
      topo.objects.counties,
      (a, b) => a !== b && a.id.slice(0, 2) === b.id.slice(0, 2),
    ),
  ),
  states,
  counties,
};
fs.writeFileSync(process.argv[2] ?? "geometry.json", JSON.stringify(out));
console.log(
  Object.keys(counties).length,
  "counties",
  Object.keys(states).length,
  "states",
);
for (const k of ["nation", "stateMesh", "countyMesh"])
  console.log(k, out[k].length);
console.log(
  "counties total",
  Object.values(counties).reduce((s, c) => s + c.d.length, 0),
);

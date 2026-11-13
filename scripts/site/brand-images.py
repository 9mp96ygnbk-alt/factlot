#!/usr/bin/env python3
"""Draws the images whose text must not depend on installed fonts: the README images (light and
dark), the social image and its PNG, and the icons, from the mark and the site's own typefaces.

Run by hand when the mark, the palette or the Harris County worked example changes (not part of
the build). It needs fonttools, brotli, uharfbuzz and resvg-py:

  python3 -m venv /tmp/brand && /tmp/brand/bin/pip install fonttools brotli uharfbuzz resvg-py
  /tmp/brand/bin/python scripts/site/brand-images.py

Text is shaped with HarfBuzz and drawn as outlines; each glyph is defined once and reused. The
parcel shown is the Harris County worked example (site/_data/texas-examples.json); what was drawn
is recorded in docs/assets/drawn-from.json, and a test fails when the example no longer says it.
"""
import io
import json
import pathlib

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

REPO = pathlib.Path(__file__).resolve().parents[2]
SITE = REPO / "site"
ASSETS = REPO / "docs/assets"
FONTS = {
    "sans": SITE / "fonts/instrument-sans-latin-wght-normal.woff2",
    "mono": SITE / "fonts/geist-mono-latin-wght-normal.woff2",
}
TAGLINE = "An open fact layer for commercial real estate AI agents"


def example():
    """The facts the images show, from the worked example."""
    e = next(
        x
        for x in json.loads((SITE / "_data/texas-examples.json").read_text())["examples"]
        if x["county"] == "harris"
    )
    fact = {f["predicate"]: f for f in e["parcel_facts"]}
    mv, yb = fact["parcel.market_value"], fact["parcel.year_built"]
    return {
        "example": e["county"],
        "urn": e["urn"],
        "label": e["label"],
        "market_value": mv["value"],
        "year_built": yb["value"],
        "as_of": mv["as_of"],
        "locator": mv["locator"],
    }


DRAWN = example()
_inst = {}


def face(family, wght):
    key = (family, wght)
    if key not in _inst:
        f = instancer.instantiateVariableFont(TTFont(FONTS[family]), {"wght": wght})
        f.flavor = None
        buf = io.BytesIO()
        f.save(buf)
        data = buf.getvalue()
        _inst[key] = (TTFont(io.BytesIO(data)), hb.Font(hb.Face(data)))
    return _inst[key]


class Sheet:
    """Collects glyph outlines (in font units) and writes <use> runs that place them."""

    def __init__(self):
        self.defs = {}

    def text(self, s, x, y, size, family="sans", wght=400, fill="#000", track=0.0, anchor="start"):
        tt, font = face(family, wght)
        buf = hb.Buffer()
        buf.add_str(s)
        buf.guess_segment_properties()
        hb.shape(font, buf, {"kern": True, "liga": False})
        upm = tt["head"].unitsPerEm
        k = size / upm
        order = tt.getGlyphOrder()
        gs = tt.getGlyphSet()
        n = len(buf.glyph_infos)
        width = sum(p.x_advance for p in buf.glyph_positions) * k + track * size * (n - 1)
        if anchor == "end":
            x -= width
        elif anchor == "middle":
            x -= width / 2
        uses, cx = [], 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            name = order[info.codepoint]
            gid = f"{family[0]}{wght}-{info.codepoint}"
            if gid not in self.defs:
                pen = SVGPathPen(gs, ntos=lambda v: str(int(round(v))))
                gs[name].draw(pen)
                self.defs[gid] = pen.getCommands()
            if self.defs[gid]:
                uses.append(f'<use href="#{gid}" x="{round(cx / k)}"/>')
            cx += pos.x_advance * k + track * size
        return (
            f'<g transform="translate({x:.1f} {y:.1f}) scale({k:.5f} {-k:.5f})" fill="{fill}">' + "".join(uses) + "</g>",
            width,
        )

    def defs_svg(self):
        return "<defs>" + "".join(f'<path id="{i}" d="{d}"/>' for i, d in self.defs.items() if d) + "</defs>"


def plat_lines(cx, cy, w, h, stroke_a, stroke_b, accent, soft, paper):
    """The same block-and-lot drawing as the site hero, with the subject block at (cx, cy)."""
    bw, bh, st = 132, 104, 26
    sx, sy = cx - 74, cy - 62
    blocks, lots = [], []
    for r in range(-4, 6):
        for c in range(-6, 6):
            if (c, r) == (0, 0):
                continue
            x = sx + c * (bw + st) + (14 if c >= 2 else 0)
            y = sy + r * (bh + st)
            blocks.append(f"M{x} {y}h{bw}v{bh}h-{bw}z")
            n = 4 if (c + r) % 3 else 3
            for i in range(1, n):
                lots.append(f"M{x + round(bw / n * i)} {y}v{bh}")
            if (c * 3 + r) % 4 != 0:
                lots.append(f"M{x} {y + bh // 2}h{bw}")
    hatch = ""
    for kk in range(13, bw + bh, 13):
        ax, ay = (sx, sy + kk) if kk <= bh else (sx + kk - bh, sy + bh)
        bx, by = (sx + kk, sy) if kk <= bw else (sx + bw, sy + kk - bw)
        hatch += f"M{ax} {ay}L{bx} {by}"
    mons = "".join(
        f'<circle cx="{sx + dx}" cy="{sy + dy}" r="5" fill="{paper}" stroke="{accent}" stroke-width="2"/>'
        for dx, dy in ((0, 0), (bw, 0), (0, bh))
    )
    return (
        f'<g transform="rotate(-7 {cx} {cy})" fill="none">'
        f'<path d="{"".join(lots)}" stroke="{stroke_b}"/>'
        f'<path d="{"".join(blocks)}" stroke="{stroke_a}"/>'
        f'<path d="M{sx} {sy}h{bw}v{bh}h-{bw}z" fill="{soft}" stroke="{accent}" stroke-width="2"/>'
        f'<path d="{hatch}" stroke="{accent}" stroke-opacity=".5"/>{mons}</g>'
    )


def mark(x, y, size, ink, accent, bg):
    k = size / 24
    return (
        f'<g transform="translate({x} {y}) scale({k})">'
        f'<path d="M4.5 7 17.5 4 20 17.5 6 20.5Z" fill="none" stroke="{ink}" stroke-width="2.2" stroke-linejoin="round"/>'
        f'<circle cx="17.5" cy="4" r="3" fill="{accent}" stroke="{bg}" stroke-width="1.6"/></g>'
    )


def card(sh, x, y, w, t):
    """The fact card: two values of the Harris worked example, each with its citation."""
    r = x + w - 26
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="306" rx="12" fill="{t["surface"]}" stroke="{t["ink"]}" stroke-width="1.5"/>',
        sh.text("registry_get", x + 24, y + 29, 13.5, "mono", 500, t["ink"])[0],
        sh.text(f'as of {DRAWN["as_of"]}', r, y + 29, 13.5, "mono", 400, t["muted"], anchor="end")[0],
        f'<path d="M{x} {y + 46}h{w}" stroke="{t["line"]}"/>',
        sh.text(DRAWN["label"], x + 24, y + 82, 19.5, "sans", 600, t["ink"], track=-0.01)[0],
        sh.text(DRAWN["urn"], x + 24, y + 104, 12.5, "mono", 400, t["muted"])[0],
        f'<path d="M{x} {y + 122}h{w}" stroke="{t["line"]}"/>',
    ]
    yy = y + 152
    for label, value, big in (
        ("Market value", f'${DRAWN["market_value"]:,}', 23),
        ("Year built", str(DRAWN["year_built"]), 19),
    ):
        out += [
            sh.text(label, x + 24, yy, 15, "sans", 400, t["muted"])[0],
            sh.text(value, r, yy + 2, big, "mono", 500, t["ink"], track=-0.03, anchor="end")[0],
            f'<rect x="{x + 24}" y="{yy + 13}" width="304" height="26" rx="4" fill="{t["cited_bg"]}" stroke="{t["cited_line"]}"/>',
            sh.text(f'[1] {DRAWN["locator"]}', x + 34, yy + 30.5, 12.5, "mono", 500, t["cited"])[0],
        ]
        if label == "Market value":
            out.append(f'<path d="M{x + 24} {yy + 56}H{r}" stroke="{t["line2"]}" stroke-dasharray="3 4"/>')
        yy += 84
    # corner ticks
    a = t["accent"]
    out.append(f'<path d="M{x + w - 8} {y + 306 + 8}h16v-16" fill="none" stroke="{a}" stroke-width="2.5"/>')
    return "".join(out)


DARK = dict(
    bg="#0d1114", surface="#161c21", ink="#ece8df", muted="#9ba4ac", faint="#6b7783", line="#27303a", line2="#3d4852",
    plat_a="#2a333d", plat_b="#1c232a", accent="#ff7d45", soft="#3a2015", cited="#62d2b3", cited_bg="#11302a", cited_line="#1f5a4c",
)
LIGHT = dict(
    bg="#f4f1ea", surface="#fcfbf7", ink="#12171c", muted="#5b636b", faint="#857e6e", line="#d6d0c2", line2="#b4ad9c",
    plat_a="#c4bdac", plat_b="#dcd6c8", accent="#b83707", soft="#f6dccf", cited="#0a6a57", cited_bg="#ddece5", cited_line="#9cc9bb",
)


def readme_hero(t):
    sh = Sheet()
    W, H = 1200, 400
    body = [
        f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="18" fill="{t["bg"]}"/>',
        f'<g clip-path="url(#panel)"><g opacity=".9">{plat_lines(706, 52, W, H, t["plat_a"], t["plat_b"], t["accent"], t["soft"], t["bg"])}</g>'
        f'<rect width="640" height="{H}" fill="url(#fade)"/></g>',
        mark(62, 44, 40, t["ink"], t["accent"], t["bg"]),
        sh.text("FactLot", 112, 75, 31, "sans", 650, t["ink"], track=-0.03)[0],
    ]
    seg, w1 = sh.text("Every number", 62, 178, 76, "sans", 600, t["ink"], track=-0.045)
    body.append(seg)
    seg, w2 = sh.text("has a ", 62, 256, 76, "sans", 600, t["ink"], track=-0.045)
    body.append(seg)
    seg, w3 = sh.text("source", 62 + w2 + 76 * -0.045, 256, 76, "sans", 600, t["accent"], track=-0.045)
    body.append(seg)
    body.append(sh.text(".", 62 + w2 + w3 + 2 * 76 * -0.045, 256, 76, "sans", 600, t["ink"])[0])
    body.append(sh.text(TAGLINE, 64, 312, 21, "sans", 400, t["muted"])[0])
    body.append(sh.text("MCP · REST · PYTHON", 64, 356, 13, "mono", 500, t["faint"], track=0.08)[0])
    body.append(sh.text("APACHE-2.0 · MIT", 300, 356, 13, "mono", 500, t["faint"], track=0.08)[0])
    body.append(card(sh, 706, 52, 432, t))
    body.append(f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="18" fill="none" stroke="{t["line2"]}" stroke-width="2"/>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">'
        '<title id="t">FactLot: every number has a source</title>'
        f'<desc id="d">{TAGLINE}. A parcel record from the Harris County '
        "worked example, each value with the file and record it was read from.</desc>"
        f'{sh.defs_svg()[:-7]}<clipPath id="panel"><rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="18"/></clipPath>'
        f'<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset=".72" stop-color="{t["bg"]}"/>'
        f'<stop offset="1" stop-color="{t["bg"]}" stop-opacity="0"/></linearGradient></defs>'
        + "".join(body)
        + "</svg>\n"
    )


def social_preview():
    t, sh = LIGHT, Sheet()
    W, H = 1200, 630
    body = [
        f'<rect width="{W}" height="{H}" fill="{t["bg"]}"/>',
        f'{plat_lines(700, 156, W, H, t["plat_a"], t["plat_b"], t["accent"], t["soft"], t["bg"])}',
        f'<rect width="660" height="{H}" fill="url(#fade)"/>',
        mark(64, 58, 48, t["ink"], t["accent"], t["bg"]),
        sh.text("FactLot", 124, 96, 38, "sans", 650, t["ink"], track=-0.03)[0],
    ]
    S = 92
    seg, _ = sh.text("Every number", 62, 268, S, "sans", 600, t["ink"], track=-0.045)
    body.append(seg)
    seg, w2 = sh.text("has a ", 62, 364, S, "sans", 600, t["ink"], track=-0.045)
    body.append(seg)
    seg, w3 = sh.text("source", 62 + w2 + S * -0.045, 364, S, "sans", 600, t["accent"], track=-0.045)
    body.append(seg)
    body.append(sh.text(".", 62 + w2 + w3 + 2 * S * -0.045, 364, S, "sans", 600, t["ink"])[0])
    cut = TAGLINE.index(" real estate")
    body.append(sh.text(TAGLINE[:cut], 64, 440, 28, "sans", 400, t["muted"])[0])
    body.append(sh.text(TAGLINE[cut + 1 :], 64, 478, 28, "sans", 400, t["muted"])[0])
    body.append(sh.text("FACTLOT.COM", 64, 566, 15, "mono", 500, t["faint"], track=0.1)[0])
    body.append(sh.text("MCP · REST · PYTHON", 250, 566, 15, "mono", 500, t["faint"], track=0.1)[0])
    body.append(f'<g transform="translate(700 156) scale(1.04) translate(-700 -156)">{card(sh, 700, 156, 432, t)}</g>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="FactLot: every number has a source">'
        f'{sh.defs_svg()[:-7]}<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset=".7" stop-color="{t["bg"]}"/>'
        f'<stop offset="1" stop-color="{t["bg"]}" stop-opacity="0"/></linearGradient></defs>'
        + "".join(body)
        + "</svg>\n"
    )


FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#12171c"/>
  <path d="M7.5 11 20.5 7.5 24 22 10 25.5Z" fill="none" stroke="#f4f1ea" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="20.5" cy="7.5" r="4.2" fill="#ff7d45" stroke="#12171c" stroke-width="1.8"/>
</svg>
"""

# The touch icon is a full square: the system rounds it.
TOUCH = FAVICON.replace(' rx="7"', "")


def png(svg, size, path):
    data = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    path.write_bytes(bytes(data))


if __name__ == "__main__":
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, theme in (("dark", DARK), ("light", LIGHT)):
        hero = readme_hero(theme)
        (ASSETS / f"readme-hero-{name}.svg").write_text(hero)
        print(f"readme-hero-{name}", len(hero))
    social = social_preview()
    (ASSETS / "social-preview.svg").write_text(social)
    (SITE / "social-preview.png").write_bytes(
        bytes(resvg_py.svg_to_bytes(svg_string=social, width=1200, height=630))
    )
    (SITE / "favicon.svg").write_text(FAVICON)
    for size in (48, 192, 512):
        png(FAVICON, size, SITE / f"icon-{size}.png")
    png(TOUCH, 180, SITE / "apple-touch-icon.png")
    (ASSETS / "drawn-from.json").write_text(json.dumps(DRAWN, indent=2) + "\n")
    print("social-preview", len(social))

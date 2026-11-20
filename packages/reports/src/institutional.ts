/**
 * The institutional style: a restrained, precise page layout for client-facing research papers,
 * on pdf-lib's standard fonts (Times for the title, headings and quotations; Helvetica for text,
 * tables and labels; Courier for identifiers), so nothing is embedded. It is a second writer
 * beside pdf.ts, which the other report kinds keep using unchanged; a kind adopts the style by
 * building its pages with this class (expense_audit is the first).
 *
 * The palette is fixed: ink for text, deep navy for the title, headings and main rules, slate
 * for secondary text, hairline grey for table rules, and one muted bronze accent. There are no
 * boxes, fills or zebra stripes. Output is deterministic: the same calls give the same bytes.
 *
 * Page content is written as PDF operator text and compressed once per page, as in pdf.ts.
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import { stripControls } from "./format.ts";
import { MAX_PDF_LINES, REPLACE, capText } from "./pdf.ts";
import { ReportInputError } from "./validate.ts";

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const IN = 72;
/** Margins: 0.95 in left and right, 0.9 in top, 0.85 in bottom. */
const ML = 0.95 * IN;
const MT = 0.9 * IN;
const MB = 0.85 * IN;
/** The width tables and bands use. */
export const CONTENT_W = PAGE_W - 2 * ML;
/** Running text is set no wider than this (5.6 in). */
export const TEXT_W = 5.6 * IN;
/** The top of the content area, and the lowest line it may reach (above the footer). */
const TOP = PAGE_H - MT;
const BOTTOM = MB + 16;
/** A number as a cell shows it: never broken across lines. */
const NUMERIC = /^[-+(]?-?\$?-?[\d,]*\.?\d+(?:%|x|\/SF|\))?$/;
/** Characters after which a long word may break (identifiers, URLs, paths). */
const BREAK_AFTER = /(?<=[_\-/.:;,?&=#@|])/;
const URL_CELL = /^https?:\/\/\S+$/;
/** An ISO date or a long date's pieces, kept on one line. */
const DATE_WORD = /^\d{4}-\d{2}-\d{2}[,;.)]?$/;
/** Smallest text a table shrinks to so its numbers fit their columns. */
const MIN_TABLE_SIZE = 5.5;

const c = (hex: string): RGB =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
export const COLORS = {
  ink: c("#14181F"),
  navy: c("#0B2545"),
  slate: c("#5A6270"),
  hair: c("#C8CDD5"),
  bronze: c("#8A6A3B"),
};
type Color = keyof typeof COLORS;

const FONTS = {
  sans: StandardFonts.Helvetica,
  sansBold: StandardFonts.HelveticaBold,
  serif: StandardFonts.TimesRoman,
  serifBold: StandardFonts.TimesRomanBold,
  serifItalic: StandardFonts.TimesRomanItalic,
  mono: StandardFonts.Courier,
} as const;
export type FontKey = keyof typeof FONTS;
const FONT_NAMES: Record<FontKey, string> = {
  sans: "F1",
  sansBold: "F2",
  serif: "F3",
  serifBold: "F4",
  serifItalic: "F5",
  mono: "F6",
};

/** A number as PDF operator text: at most three decimals, never an exponent. */
const n = (x: number): string => {
  const s = (Math.round(x * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const rgbOp = (col: RGB): string =>
  `${n(col.red)} ${n(col.green)} ${n(col.blue)}`;

export interface Cell {
  /** The figure or word, large. */
  figure: string;
  /** The label under it. */
  label: string;
}

export interface InstitutionalColumn {
  header: string;
  /** Relative width; the shares are scaled to the content width. */
  width: number;
  align?: "left" | "right";
  /** Courier, for identifiers. */
  mono?: boolean;
}

export interface DataTableOptions {
  /** Body size (default 8.75); the table may shrink it to fit the page width. */
  size?: number;
  /** Row indexes set in bold with a hairline above (totals, the median). */
  bold?: Set<number>;
  /** A list of label and value rows: no header, no hairlines between rows. */
  headerless?: boolean;
  /** A hairline between rows; by default only when a cell wraps. */
  rules?: boolean;
  padY?: number;
  /** Rows kept with the header at a page foot (default 2). */
  keepRows?: number;
  /** Allow a short table to split over a page instead of moving whole. */
  splitShort?: boolean;
}

export interface InstitutionalMeta {
  title: string;
  subject: string;
  /** Page 1, left of the top rule ("FactLot"). */
  brand: string;
  /** Page 1, right of the top rule. */
  mastheadRight: string;
  /** Left of the running header on pages 2 onward. */
  runningHeader: string;
  /** The line at the foot of every page. */
  footer: string;
  producer: string;
  keywords: string[];
  created: Date;
}

interface Page {
  page: PDFPage;
  ops: string[];
  /** Page size: a landscape page swaps the two. */
  w: number;
  h: number;
  links: { rect: number[]; uri: string }[];
}

export class InstitutionalWriter {
  private doc!: PDFDocument;
  private fonts!: Record<FontKey, PDFFont>;
  private charset!: Set<number>;
  private cur!: Page;
  private readonly pages: Page[] = [];
  private y = TOP;
  private lines = 0;
  private readonly advance = new Map<FontKey, Map<string, number>>();
  private readonly meta: InstitutionalMeta;

  private constructor(meta: InstitutionalMeta) {
    this.meta = meta;
  }

  static async create(meta: InstitutionalMeta): Promise<InstitutionalWriter> {
    const w = new InstitutionalWriter(meta);
    w.doc = await PDFDocument.create({ updateMetadata: false });
    const entries = await Promise.all(
      (Object.keys(FONTS) as FontKey[]).map(
        async (k) => [k, await w.doc.embedFont(FONTS[k])] as const,
      ),
    );
    w.fonts = Object.fromEntries(entries) as Record<FontKey, PDFFont>;
    w.charset = new Set(w.fonts.sans.getCharacterSet());
    w.newPage();
    return w;
  }

  // --- text measurement ---------------------------------------------------------------------

  /** Text the standard fonts can encode (as in pdf.ts: close ASCII equivalents, else "?"). */
  clean(s: string): string {
    let out = "";
    for (const ch of stripControls(s.replace(/\r\n?/g, "\n")).replace(
      /\t/g,
      "    ",
    )) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n" || this.charset.has(cp)) out += ch;
      else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
      else {
        const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        out +=
          [...base].every((x) => this.charset.has(x.codePointAt(0)!)) && base
            ? base
            : "?";
      }
    }
    return out;
  }

  private charW(ch: string, font: FontKey): number {
    let m = this.advance.get(font);
    if (!m) this.advance.set(font, (m = new Map()));
    let w = m.get(ch);
    if (w === undefined) {
      w = this.fonts[font].widthOfTextAtSize(ch, 1);
      m.set(ch, w);
    }
    return w;
  }

  /** Width of cleaned text. */
  width(s: string, size: number, font: FontKey): number {
    let w = 0;
    for (const ch of s) w += this.charW(ch, font);
    return w * size;
  }

  /** Wrap text into lines no wider than `w`, breaking at spaces (and after - / for long words). */
  wrap(text: string, size: number, w: number, font: FontKey): string[] {
    const lines: string[] = [];
    const space = this.charW(" ", font) * size;
    for (const para of this.clean(capText(text)).split("\n")) {
      if (para === "") {
        lines.push("");
        continue;
      }
      let line = "";
      let lineW = 0;
      for (const word of para.split(/ +/)) {
        const wordW = this.width(word, size, font);
        if (line && lineW + space + wordW <= w) {
          line += ` ${word}`;
          lineW += space + wordW;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        lineW = 0;
        if (wordW <= w) {
          line = word;
          lineW = wordW;
          continue;
        }
        for (const piece of word.split(/(?<=[_\-/.:;,?&=#@|])/)) {
          const pw = this.width(piece, size, font);
          if (lineW + pw <= w) {
            line += piece;
            lineW += pw;
            continue;
          }
          if (line) lines.push(line);
          line = "";
          lineW = 0;
          for (const ch of piece) {
            const cw = this.charW(ch, font) * size;
            if (line && lineW + cw > w) {
              lines.push(line);
              line = "";
              lineW = 0;
            }
            line += ch;
            lineW += cw;
          }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // --- drawing primitives -------------------------------------------------------------------

  private newPage(
    landscape = this.cur ? this.cur.w > this.cur.h : false,
  ): void {
    const [w, h] = landscape ? [PAGE_H, PAGE_W] : [PAGE_W, PAGE_H];
    this.cur = { page: this.doc.addPage([w, h]), ops: [], w, h, links: [] };
    this.pages.push(this.cur);
    this.y = this.top;
  }

  /** The width tables and bands use on the current page (a landscape page is wider). */
  get cw(): number {
    return this.cur.w - 2 * ML;
  }

  /** The top of the content area of the current page. */
  private get top(): number {
    return this.cur.h - MT;
  }

  /**
   * Continue on pages of this orientation: a new page when it changes, unless the current page
   * is still empty (then it is replaced).
   */
  orientation(landscape: boolean): void {
    if (this.cur.w > this.cur.h === landscape) return;
    if (this.atTop) {
      this.doc.removePage(this.pages.length - 1);
      this.pages.pop();
    }
    this.newPage(landscape);
  }

  /** The current page is empty of content (nothing drawn since it was added). */
  private get atTop(): boolean {
    return this.y >= this.top - 0.01;
  }

  private ensure(h: number): void {
    if (this.y - h < BOTTOM && !this.atTop) this.newPage();
  }

  /** Space left on this page before the footer. */
  get room(): number {
    return this.y - BOTTOM;
  }

  pageBreak(): void {
    if (!this.atTop) this.newPage();
  }

  private text(
    s: string,
    x: number,
    baseline: number,
    size: number,
    font: FontKey,
    color: Color = "ink",
  ): void {
    if (!s) return;
    if (++this.lines > MAX_PDF_LINES)
      throw new ReportInputError(
        "TooLarge",
        `the PDF would draw more than ${MAX_PDF_LINES.toLocaleString("en-US")} lines of text; ask for the xlsx format, or send less text`,
      );
    this.cur.ops.push(
      `${rgbOp(COLORS[color])} rg BT /${FONT_NAMES[font]} ${n(size)} Tf ${n(x)} ${n(baseline)} Td ${this.fonts[font].encodeText(s).toString()} Tj ET`,
    );
  }

  private rule(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    color: Color,
  ): void {
    this.cur.ops.push(
      `${rgbOp(COLORS[color])} RG ${n(thickness)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`,
    );
  }

  private hline(
    y: number,
    color: Color,
    thickness: number,
    x = ML,
    w = this.cw,
  ) {
    this.rule(x, y, x + w, y, thickness, color);
  }

  /** The baseline of line k of a text block of `size` and `leading`, whose top is `top`. */
  private base(top: number, size: number, leading: number, k = 0): number {
    return top - ((leading - size) / 2 + 0.78 * size) - k * leading;
  }

  space(h: number): void {
    this.y -= h;
  }

  // --- page 1 -------------------------------------------------------------------------------

  /** The title block, from about 1.5 in below the top edge. */
  titleBlock(opts: {
    title: string;
    line: string;
    preparedFor?: string | undefined;
    asOf: string;
  }): void {
    this.y = PAGE_H - 1.5 * IN;
    for (const l of this.wrap(opts.title, 25, this.cw, "serif")) {
      this.text(l, ML, this.base(this.y, 25, 28), 25, "serif", "navy");
      this.y -= 28;
    }
    this.y -= 6;
    for (const l of this.wrap(opts.line, 11, this.cw, "sans")) {
      this.text(l, ML, this.base(this.y, 11, 15), 11, "sans", "slate");
      this.y -= 15;
    }
    this.y -= 3;
    const meta = [
      ...(opts.preparedFor ? [`Prepared for ${opts.preparedFor}`] : []),
      `As of ${opts.asOf}`,
    ];
    for (const m of meta)
      for (const l of this.wrap(m, 9.25, this.cw, "sans")) {
        this.text(l, ML, this.base(this.y, 9.25, 13.5), 9.25, "sans", "slate");
        this.y -= 13.5;
      }
    this.y -= 9;
    this.rule(ML, this.y, ML + 1.2 * IN, this.y, 1.25, "bronze");
    this.y -= 26;
  }

  // --- bands of figures ---------------------------------------------------------------------

  /**
   * A row of figures separated by hairline vertical rules, no boxes: each a large figure over a
   * small label, with a hairline above and below. `accent` draws the rule above in bronze.
   */
  band(
    cells: Cell[],
    opts: { figureSize: number; accent?: boolean; labelSize?: number } = {
      figureSize: 21,
    },
  ): void {
    const fs = opts.figureSize;
    const ls = opts.labelSize ?? 7.5;
    const pad = 12;
    const natural = cells.map((cell, i) => {
      const f = this.width(this.clean(cell.figure), fs, "serif");
      const l = Math.max(
        0,
        ...this.clean(cell.label)
          .split(/ +/)
          .map((word) => this.width(word, ls, "sans")),
      );
      return Math.max(f, l, 66) + (i === 0 ? pad : 2 * pad);
    });
    const sum = natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((x) => x + ((this.cw - sum) * x) / sum);
    const wrapped = cells.map((cell, i) =>
      this.wrap(
        cell.label,
        ls,
        widths[i]! - (i === 0 ? 0 : pad) - pad - 2,
        "sans",
      ),
    );
    const labelLines = Math.max(...wrapped.map((l) => l.length));
    const figH = fs * 1.15;
    const h = 12 + figH + 4 + labelLines * ls * 1.4 + 11;
    this.ensure(h + 8);
    const top = this.y;
    this.hline(top, opts.accent ? "bronze" : "hair", opts.accent ? 1 : 0.5);
    let x = ML;
    cells.forEach((cell, i) => {
      const inset = i === 0 ? 0 : pad;
      const tx = x + inset;
      this.text(
        this.clean(cell.figure),
        tx,
        top - 12 - fs * 0.82,
        fs,
        "serif",
        "navy",
      );
      wrapped[i]!.forEach((l, k) =>
        this.text(
          l,
          tx,
          top - 12 - figH - 4 - ls * 1.4 * k - ls * 0.95,
          ls,
          "sans",
          "slate",
        ),
      );
      if (i > 0) this.rule(x, top - 9, x, top - h + 9, 0.5, "hair");
      x += widths[i]!;
    });
    this.hline(top - h, "hair", 0.5);
    this.y = top - h;
  }

  // --- headings and text --------------------------------------------------------------------

  /** A section heading: Times bold 13.5, 18 above and 6 below; keeps `keep` points with it. */
  section(text: string, keep = 40): void {
    const lines = this.wrap(text, 13.5, this.cw, "serifBold");
    const above = this.atTop ? 0 : 18;
    this.ensure(above + lines.length * 17 + 6 + keep);
    if (!this.atTop) this.y -= above;
    for (const l of lines) {
      this.text(l, ML, this.base(this.y, 13.5, 17), 13.5, "serifBold", "navy");
      this.y -= 17;
    }
    this.y -= 6;
  }

  /** A smaller heading inside a section (Times bold 10.5 navy). */
  subhead(text: string, keep = 40): void {
    this.ensure(10 + 14 + 3 + keep);
    if (!this.atTop) this.y -= 10;
    this.text(
      this.clean(text),
      ML,
      this.base(this.y, 10.5, 14),
      10.5,
      "serifBold",
      "navy",
    );
    this.y -= 14 + 3;
  }

  /** A small slate label (7.5 pt). */
  label(text: string): void {
    this.ensure(11);
    this.text(
      this.clean(text),
      ML,
      this.base(this.y, 7.5, 11),
      7.5,
      "sans",
      "slate",
    );
    this.y -= 11;
  }

  /** Running text, no wider than 5.6 in. Keeps its first two lines together. */
  para(
    text: string,
    opts: {
      size?: number;
      leading?: number;
      color?: Color;
      font?: FontKey;
      width?: number;
      after?: number;
      indent?: number;
    } = {},
  ): void {
    const size = opts.size ?? 9.25;
    const lead = opts.leading ?? (size === 9.25 ? 13.5 : size * 1.45);
    const font = opts.font ?? "sans";
    const x = ML + (opts.indent ?? 0);
    const lines = this.wrap(
      text,
      size,
      (opts.width ?? TEXT_W) - (opts.indent ?? 0),
      font,
    );
    lines.forEach((l, k) => {
      if (k === 0) this.ensure(Math.min(lines.length, 2) * lead);
      else this.ensure(lead);
      this.text(
        l,
        x,
        this.base(this.y, size, lead),
        size,
        font,
        opts.color ?? "ink",
      );
      this.y -= lead;
    });
    this.y -= opts.after ?? 5;
  }

  /** A short note with a bold lead-in line (no box). */
  note(title: string, text: string): void {
    this.subhead(title, this.paraHeight(text, 8.5, 12.5));
    this.para(text, { size: 8.5, leading: 12.5 });
  }

  /** Numbered steps (hanging number), body text. */
  steps(items: string[]): void {
    items.forEach((item, i) => {
      const lines = this.wrap(item, 9.25, TEXT_W - 20, "sans");
      lines.forEach((l, k) => {
        this.ensure(k === 0 ? Math.min(lines.length, 2) * 13.5 : 13.5);
        if (k === 0)
          this.text(
            `${i + 1}.`,
            ML,
            this.base(this.y, 9.25, 13.5),
            9.25,
            "sans",
            "slate",
          );
        this.text(l, ML + 20, this.base(this.y, 9.25, 13.5), 9.25, "sans");
        this.y -= 13.5;
      });
      this.y -= 2.5;
    });
    this.y -= 2;
  }

  /** A bullet list, body text. */
  bullets(items: string[], size = 9.25): void {
    const lead = size === 9.25 ? 13.5 : size * 1.45;
    for (const item of items) {
      const lines = this.wrap(item, size, TEXT_W - 14, "sans");
      lines.forEach((l, k) => {
        this.ensure(k === 0 ? Math.min(lines.length, 2) * lead : lead);
        if (k === 0)
          this.text(
            "•",
            ML + 2,
            this.base(this.y, size, lead),
            size,
            "sans",
            "slate",
          );
        this.text(l, ML + 14, this.base(this.y, size, lead), size, "sans");
        this.y -= lead;
      });
      this.y -= 2.5;
    }
    this.y -= 2;
  }

  /**
   * A block quotation: a 1 pt navy rule at its left, the quote in Times italic 9.5, and beneath
   * it a source line in slate 7.5. The quote and its source stay together on a page.
   */
  quote(text: string, source: string): void {
    const lead = 13.5;
    const lines = this.wrap(text, 9.5, TEXT_W - 16, "serifItalic");
    const h = lines.length * lead + 3 + 11 + 9;
    this.ensure(Math.min(h, 4 * lead + 14 + 9));
    // A long quotation may continue over a page: each page's piece gets its own rule.
    let from = 0;
    while (from < lines.length) {
      const fit = Math.max(
        1,
        Math.min(
          lines.length - from,
          Math.floor((this.y - BOTTOM - 14) / lead),
        ),
      );
      const last = from + fit >= lines.length;
      const top = this.y;
      lines
        .slice(from, from + fit)
        .forEach((l, k) =>
          this.text(
            l,
            ML + 14,
            this.base(top, 9.5, lead, k),
            9.5,
            "serifItalic",
            "ink",
          ),
        );
      let bottom = top - fit * lead;
      if (last) {
        this.text(
          this.clean(source),
          ML + 14,
          bottom - 3 - 7.5 * 0.95,
          7.5,
          "sans",
          "slate",
        );
        bottom -= 3 + 11;
      }
      this.rule(ML + 3, top - 1.5, ML + 3, bottom + (last ? 1 : 0), 1, "navy");
      this.y = bottom - 9;
      from += fit;
      if (!last) this.newPage();
    }
  }

  /** The height `definitions(rows)` will take, to keep a heading with its list. */
  definitionsHeight(rows: [string, string][], labelW = 150): number {
    const size = 8.75;
    let h = 8;
    for (const [label, value] of rows) {
      const k = Math.max(
        this.wrap(label, size, labelW - 10, "sans").length,
        this.wrap(value, size, this.cw - labelW, "sans").length,
      );
      h += k * 12.5 + 8;
    }
    return h;
  }

  /** Height of a paragraph as `para` sets it. */
  paraHeight(text: string, size: number, leading: number): number {
    return this.wrap(text, size, TEXT_W, "sans").length * leading;
  }

  /** A two-column definition list: slate labels at the left, values at the right. */
  definitions(rows: [string, string][], labelW = 150): void {
    const size = 8.75;
    const lead = 12.5;
    const hair = 4;
    rows.forEach(([label, value], r) => {
      const ls = this.wrap(label, size, labelW - 10, "sans");
      const vs = this.wrap(value, size, this.cw - labelW, "sans");
      const k = Math.max(ls.length, vs.length);
      const h = k * lead + 2 * hair;
      this.ensure(h + (r === 0 ? 8 : 0));
      if (r === 0) this.hline(this.y, "navy", 0.75);
      const top = this.y;
      ls.forEach((l, i) =>
        this.text(
          l,
          ML,
          this.base(top + 0 - hair, size, lead, i),
          size,
          "sans",
          "slate",
        ),
      );
      vs.forEach((l, i) =>
        this.text(
          l,
          ML + labelW,
          this.base(top - hair, size, lead, i),
          size,
          "sans",
        ),
      );
      this.y = top - h;
      this.hline(
        this.y,
        r === rows.length - 1 ? "navy" : "hair",
        r === rows.length - 1 ? 0.75 : 0.5,
      );
    });
    this.y -= 8;
  }

  // --- tables -------------------------------------------------------------------------------

  /**
   * A book-style table: a 0.75 pt navy rule above the header and below the last row, a hairline
   * under the header, no vertical rules, no fills. Numbers right-aligned. The header repeats on
   * each page. `totalRow` sets the last row in bold with a hairline above it.
   */
  table(
    columns: InstitutionalColumn[],
    rows: string[][],
    opts: {
      size?: number;
      totalRow?: boolean;
      keepRows?: number;
      padY?: number;
    } = {},
  ): void {
    const size = opts.size ?? 8.75;
    const lead = size * 1.4;
    const padY = opts.padY ?? 4.5;
    const padX = 4;
    const total = columns.reduce((s, col) => s + col.width, 0);
    const widths = columns.map((col) => (col.width / total) * this.cw);
    const xs = widths.map(
      (_, i) => ML + widths.slice(0, i).reduce((s, w) => s + w, 0),
    );
    const fontOf = (i: number, bold: boolean): FontKey =>
      columns[i]!.mono ? "mono" : bold ? "sansBold" : "sans";
    const sizeOf = (i: number) => (columns[i]!.mono ? 7 : size);
    const cellLines = (row: string[], bold: boolean) =>
      row.map((cell, i) => {
        const room = widths[i]! - 2 * padX - (i === 0 ? 0 : 0);
        return columns[i]!.align === "right"
          ? [this.clean(cell ?? "")]
          : this.wrap(cell ?? "", sizeOf(i), room, fontOf(i, bold));
      });
    const hSize = 7.5;
    const headLines = columns.map((col, i) =>
      this.wrap(col.header, hSize, widths[i]! - 2 * padX, "sansBold"),
    );
    const headH =
      Math.max(1, ...headLines.map((l) => l.length)) * hSize * 1.35 + 9;
    const drawHeader = () => {
      this.hline(this.y, "navy", 0.75);
      const top = this.y;
      headLines.forEach((ls, i) =>
        ls.forEach((l, k) => {
          const w = this.width(l, hSize, "sansBold");
          const x =
            columns[i]!.align === "right"
              ? xs[i]! + widths[i]! - padX - w
              : xs[i]! + padX;
          this.text(
            l,
            x,
            top - 6 - hSize * 0.8 - k * hSize * 1.35,
            hSize,
            "sansBold",
            "slate",
          );
        }),
      );
      this.y = top - headH;
      this.hline(this.y, "hair", 0.5);
    };
    const heights = rows.map((row, r) => {
      const bold = Boolean(opts.totalRow) && r === rows.length - 1;
      return (
        Math.max(1, ...cellLines(row, bold).map((l) => l.length)) * lead +
        2 * padY
      );
    });
    // Keep the header with the first row(s).
    const first = heights
      .slice(0, opts.keepRows ?? 2)
      .reduce((s, h) => s + h, 0);
    this.ensure(headH + first + 4);
    drawHeader();
    rows.forEach((row, r) => {
      const bold = Boolean(opts.totalRow) && r === rows.length - 1;
      const lines = cellLines(row, bold);
      const h = heights[r]!;
      if (this.y - h < BOTTOM) {
        this.newPage();
        drawHeader();
      }
      const top = this.y;
      if (bold) this.hline(top, "hair", 0.5);
      lines.forEach((ls, i) =>
        ls.forEach((l, k) => {
          const sz = sizeOf(i);
          const font = fontOf(i, bold);
          const w = this.width(l, sz, font);
          const x =
            columns[i]!.align === "right"
              ? xs[i]! + widths[i]! - padX - w
              : xs[i]! + padX;
          this.text(
            l,
            x,
            top - padY - (lead - sz) / 2 - 0.78 * sz - k * lead,
            sz,
            font,
            "ink",
          );
        }),
      );
      this.y = top - h;
    });
    this.hline(this.y, "navy", 0.75);
    this.y -= 10;
  }

  // --- statements and signature (estoppel_certificate) -------------------------------------

  /**
   * A numbered statement with the tenant's answer set beside it: a hairline above, the heading
   * (Times bold 10.5), a slate tag and the statement at the left (3.9 in), and at the right the
   * answer's label, its headline in bold and its detail lines. Kept on one page, with `keep`
   * points of what follows (its quotations) if they fit.
   */
  statementHead(opts: {
    heading: string;
    tag: string;
    text: string;
    answerLabel: string;
    answerHead: string;
    answerLines: string[];
    keep?: number;
  }): void {
    const LW = 3.9 * IN;
    const GAP = 0.25 * IN;
    const RX = ML + LW + GAP;
    const RW = CONTENT_W - LW - GAP;
    const pad = 9;
    const hl = this.wrap(opts.heading, 10.5, LW, "serifBold");
    const tl = this.wrap(opts.text, 9.25, LW, "sans");
    const ah = this.wrap(opts.answerHead, 8.75, RW, "sansBold");
    const al = opts.answerLines.flatMap((l) => this.wrap(l, 8.25, RW, "sans"));
    const leftH = hl.length * 14 + 11 + 5 + tl.length * 13.5;
    const rightH = 11 + 4 + ah.length * 12.5 + al.length * 11.5;
    const h = 2 * pad + Math.max(leftH, rightH);
    this.ensure(h + (opts.keep ?? 0));
    const top = this.y;
    this.hline(top, "hair", 0.5);
    let y = top - pad;
    hl.forEach((l, k) =>
      this.text(l, ML, this.base(y, 10.5, 14, k), 10.5, "serifBold", "navy"),
    );
    y -= hl.length * 14;
    this.text(
      this.clean(opts.tag),
      ML,
      this.base(y, 7.5, 11),
      7.5,
      "sans",
      "slate",
    );
    y -= 11 + 5;
    tl.forEach((l, k) =>
      this.text(l, ML, this.base(y, 9.25, 13.5, k), 9.25, "sans", "ink"),
    );
    let ry = top - pad;
    this.text(
      this.clean(opts.answerLabel),
      RX,
      this.base(ry, 7.5, 11),
      7.5,
      "sans",
      "slate",
    );
    ry -= 11 + 4;
    ah.forEach((l, k) =>
      this.text(l, RX, this.base(ry, 8.75, 12.5, k), 8.75, "sansBold", "ink"),
    );
    ry -= ah.length * 12.5;
    al.forEach((l, k) =>
      this.text(l, RX, this.base(ry, 8.25, 11.5, k), 8.25, "sans", "slate"),
    );
    this.y = top - h;
  }

  /**
   * Signature lines: each label in slate under a hairline, 34 points apart. The block stays on
   * one page.
   */
  signatureLines(labels: string[]): void {
    const step = 34;
    this.ensure(labels.length * step + 6);
    for (const label of labels) {
      this.y -= step - 12;
      this.hline(this.y, "navy", 0.5, ML, 3.6 * IN);
      this.text(this.clean(label), ML, this.y - 10, 7.5, "sans", "slate");
      this.y -= 12;
    }
    this.y -= 6;
  }

  // --- notes and data tables ----------------------------------------------------------------

  /**
   * A required or cautionary statement set apart without a box: a 1 pt bronze rule at its left
   * and the text beside it in body type. A long one continues over a page.
   */
  callout(text: string, size = 8.75): void {
    const lead = size * 1.45;
    const lines = this.wrap(text, size, TEXT_W - 14, "sans");
    this.ensure(Math.min(lines.length, 3) * lead + 8);
    let from = 0;
    while (from < lines.length) {
      const fit = Math.max(
        1,
        Math.min(lines.length - from, Math.floor((this.y - BOTTOM) / lead)),
      );
      const top = this.y;
      lines
        .slice(from, from + fit)
        .forEach((l, k) =>
          this.text(l, ML + 12, this.base(top, size, lead, k), size, "sans"),
        );
      const bottom = top - fit * lead;
      this.rule(ML + 2, top - 2, ML + 2, bottom + 2, 1, "bronze");
      this.y = bottom - 7;
      from += fit;
      if (from < lines.length) this.newPage();
    }
  }

  /**
   * Column widths and a text size at which every number fits its column on one line and every
   * word (or separator-delimited piece of one) fits its column: the shares are the starting
   * point, columns that need more take it from columns with room, and when the page is too
   * narrow for all of them the text shrinks (down to MIN_TABLE_SIZE).
   */
  private fitColumns(
    columns: InstitutionalColumn[],
    rows: string[][],
    size: number,
    hsize: number,
    pad: number,
    headerless: boolean,
  ): { widths: number[]; size: number; hsize: number } {
    const cw = this.cw;
    const total = columns.reduce((s, col) => s + col.width, 0);
    const desired = columns.map((col) => (col.width / total) * cw);
    const unbreakable = (
      text: string,
      sz: number,
      font: FontKey,
      numeric: boolean,
    ): number => {
      const t = this.clean(capText(text));
      if (numeric && NUMERIC.test(t)) return this.width(t, sz, font);
      let m = 0;
      for (const word of t.split(/[ \n]+/))
        for (const piece of DATE_WORD.test(word)
          ? [word]
          : word.split(BREAK_AFTER))
          m = Math.max(m, this.width(piece, sz, font));
      return m;
    };
    const need = (sz: number, hsz: number) =>
      columns.map((col, i) => {
        const numeric = col.align === "right";
        const font: FontKey = col.mono ? "mono" : "sansBold";
        const csz = col.mono ? Math.min(sz, 7) : sz;
        let m = headerless
          ? 0
          : unbreakable(col.header, hsz, "sansBold", false);
        for (const row of rows)
          m = Math.max(m, unbreakable(row[i] ?? "", csz, font, numeric));
        // A text column never claims more than 40% of the page for one long token.
        return Math.min(m + 2 * pad + 0.5, numeric ? cw : cw * 0.4);
      });
    let sz = size;
    let hsz = hsize;
    let min = need(sz, hsz);
    let sum = min.reduce((a, b) => a + b, 0);
    if (sum > cw) {
      const k = Math.max(MIN_TABLE_SIZE / sz, (cw / sum) * 0.98);
      sz = Math.max(MIN_TABLE_SIZE, sz * k);
      hsz = Math.max(MIN_TABLE_SIZE, hsz * k);
      min = need(sz, hsz);
      sum = min.reduce((a, b) => a + b, 0);
    }
    if (sum > cw)
      return { widths: min.map((m) => (m / sum) * cw), size: sz, hsize: hsz };
    const widths = desired.map((d, i) => Math.max(d, min[i]!));
    const excess = widths.reduce((a, b) => a + b, 0) - cw;
    if (excess > 0) {
      const slack = widths.map((w, i) => w - min[i]!);
      const room = slack.reduce((a, b) => a + b, 0);
      for (let i = 0; i < widths.length; i++)
        widths[i] = widths[i]! - (excess * slack[i]!) / room;
    }
    return { widths, size: sz, hsize: hsz };
  }

  /** The geometry of a data table: column widths, sizes, wrapped cells and row heights. */
  private tablePlan(
    columns: InstitutionalColumn[],
    rows: string[][],
    opts: DataTableOptions,
  ) {
    const padX = 4;
    const padY = opts.padY ?? 3.5;
    const fit = this.fitColumns(
      columns,
      rows,
      opts.size ?? 8.75,
      opts.headerless ? (opts.size ?? 8.75) : 7.5,
      padX,
      opts.headerless ?? false,
    );
    const size = fit.size;
    const hSize = Math.min(7.5, fit.hsize);
    const lead = size * 1.4;
    const widths = fit.widths;
    const xs = widths.map(
      (_, i) => ML + widths.slice(0, i).reduce((a, b) => a + b, 0),
    );
    const bold = opts.bold ?? new Set<number>();
    const fontOf = (i: number, isBold: boolean): FontKey =>
      columns[i]!.mono ? "mono" : isBold ? "sansBold" : "sans";
    const sizeOf = (i: number) => (columns[i]!.mono ? Math.min(7, size) : size);
    const isNumber = (i: number, cell: string) =>
      columns[i]!.align === "right" && NUMERIC.test(this.clean(cell));
    const cellLines = (row: string[], isBold: boolean) =>
      row.map((cell, i) =>
        isNumber(i, cell ?? "")
          ? [this.clean(cell)]
          : this.wrap(
              cell ?? "",
              sizeOf(i),
              widths[i]! - 2 * padX,
              fontOf(i, isBold),
            ),
      );
    const heads = columns.map((col, i) =>
      this.wrap(col.header, hSize, widths[i]! - 2 * padX, "sansBold"),
    );
    const headH = opts.headerless
      ? 0
      : Math.max(1, ...heads.map((l) => l.length)) * hSize * 1.35 + 9;
    const cells = rows.map((row, r) => cellLines(row, bold.has(r)));
    const heights = cells.map(
      (ls) => Math.max(1, ...ls.map((l) => l.length)) * lead + 2 * padY,
    );
    return {
      padX,
      padY,
      size,
      hSize,
      lead,
      widths,
      xs,
      bold,
      fontOf,
      sizeOf,
      isNumber,
      heads,
      headH,
      cells,
      heights,
    };
  }

  /** How much of a table must fit below a heading for the heading to stay with it. */
  dataTableKeep(
    columns: InstitutionalColumn[],
    rows: string[][],
    opts: DataTableOptions = {},
  ): number {
    const t = this.tablePlan(columns, rows, opts);
    const first = t.heights
      .slice(0, opts.keepRows ?? 2)
      .reduce((a, b) => a + b, 0);
    const whole = t.headH + t.heights.reduce((a, b) => a + b, 0) + 4;
    return whole < (this.top - BOTTOM) * 0.3 && !opts.splitShort
      ? whole
      : t.headH + first + 4;
  }

  /** The height `dataTable` will take on one page (a longer table continues over pages). */
  dataTableHeight(
    columns: InstitutionalColumn[],
    rows: string[][],
    opts: DataTableOptions = {},
  ): number {
    const t = this.tablePlan(columns, rows, opts);
    return t.headH + t.heights.reduce((a, b) => a + b, 0) + 10;
  }

  /**
   * A book-style table that adapts to its content: column widths grow so no number breaks and
   * the text shrinks (to 5.5 pt) when the page is too narrow; the header repeats on each page; a
   * row taller than a page continues over pages. A web address in a cell is a link. `bold` sets
   * rows in bold (totals, the median) with a hairline above; `headerless` makes a list of
   * label and value rows. Rules are a navy line above and below, a hairline under the header,
   * and, when any cell wraps or `rules` is set, a hairline between rows. No fills.
   */
  dataTable(
    columns: InstitutionalColumn[],
    rows: string[][],
    opts: DataTableOptions = {},
  ): void {
    const t = this.tablePlan(columns, rows, opts);
    const { padX, padY, hSize, lead, widths, xs } = t;
    const between =
      opts.rules ??
      (opts.headerless
        ? false
        : t.heights.some((h) => h > t.lead + 2 * padY + 0.5));
    const header = () => {
      if (opts.headerless) {
        this.hline(this.y, "navy", 0.75);
        return;
      }
      this.hline(this.y, "navy", 0.75);
      const top = this.y;
      t.heads.forEach((ls, i) =>
        ls.forEach((l, k) => {
          const w = this.width(l, hSize, "sansBold");
          const x =
            columns[i]!.align === "right"
              ? xs[i]! + widths[i]! - padX - w
              : xs[i]! + padX;
          this.text(
            l,
            x,
            top - 6 - hSize * 0.8 - k * hSize * 1.35,
            hSize,
            "sansBold",
            "slate",
          );
        }),
      );
      this.y = top - t.headH;
      this.hline(this.y, "hair", 0.5);
    };
    const drawRow = (
      lines: string[][],
      isBold: boolean,
      raw: string[],
      ruleAbove: boolean,
    ) => {
      const top = this.y;
      const h = Math.max(1, ...lines.map((l) => l.length)) * lead + 2 * padY;
      if (ruleAbove) this.hline(top, "hair", 0.35);
      lines.forEach((ls, i) => {
        const sz = t.sizeOf(i);
        const font = t.fontOf(i, isBold);
        const room = widths[i]! - 2 * padX;
        const uri = URL_CELL.test((raw[i] ?? "").trim()) ? raw[i]!.trim() : "";
        ls.forEach((l, k) => {
          let csz = sz;
          let w = this.width(l, csz, font);
          if (w > room && ls.length === 1 && t.isNumber(i, l)) {
            csz = (sz * room) / w;
            w = room;
          }
          const x =
            columns[i]!.align === "right"
              ? xs[i]! + widths[i]! - padX - w
              : xs[i]! + padX;
          const baseline =
            top - padY - (lead - csz) / 2 - 0.78 * csz - k * lead;
          this.text(l, x, baseline, csz, font, uri ? "navy" : "ink");
          if (uri && l)
            this.cur.links.push({
              rect: [x, baseline - csz * 0.25, x + w, baseline + csz * 0.95],
              uri,
            });
        });
      });
      this.y = top - h;
    };
    // Keep the header with the first rows; keep a short table whole.
    const page = this.top - BOTTOM;
    this.ensure(this.dataTableKeep(columns, rows, opts));
    header();
    rows.forEach((row, r) => {
      const isBold = t.bold.has(r);
      const lines = t.cells[r]!;
      const h = t.heights[r]!;
      const ruleAbove =
        (isBold && r > 0) || (between && r > 0 && !t.bold.has(r - 1));
      if (this.y - h < BOTTOM) {
        if (h > page - t.headH - 40) {
          // A row taller than a page: split its lines over pages.
          let start = 0;
          const max = Math.max(...lines.map((l) => l.length));
          while (start < max) {
            if (this.y - lead - 2 * padY < BOTTOM) {
              this.newPage();
              header();
            }
            const fitLines = Math.max(
              1,
              Math.floor((this.y - BOTTOM - 2 * padY) / lead),
            );
            drawRow(
              lines.map((l) => l.slice(start, start + fitLines)),
              isBold,
              row,
              false,
            );
            start += fitLines;
          }
          return;
        }
        this.newPage();
        header();
        drawRow(lines, isBold, row, false);
        return;
      }
      drawRow(lines, isBold, row, ruleAbove);
    });
    this.hline(this.y, "navy", 0.75);
    this.y -= 10;
  }

  // --- output -------------------------------------------------------------------------------

  async bytes(): Promise<Uint8Array> {
    const m = this.meta;
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      this.cur = p;
      const top = p.h - MT;
      const cw = this.cw;
      if (i === 0) {
        // The brand line above a thin navy rule across the top margin.
        const ry = top + 12;
        this.text("FactLot", ML, ry + 6, 9, "sansBold", "navy");
        const right = this.clean(m.mastheadRight);
        this.text(
          right,
          ML + cw - this.width(right, 8, "sans"),
          ry + 6,
          8,
          "sans",
          "slate",
        );
        this.hline(ry, "navy", 0.75);
      } else {
        const hy = top + 12;
        this.text(
          this.clean(m.runningHeader),
          ML,
          hy + 4,
          7.5,
          "sans",
          "slate",
        );
        const label = `Page ${i + 1} of ${total}`;
        this.text(
          label,
          ML + cw - this.width(label, 7.5, "sans"),
          hy + 4,
          7.5,
          "sans",
          "slate",
        );
        this.hline(hy, "hair", 0.5);
      }
      this.hline(MB, "hair", 0.5);
      // The footer is one line; a longer one (required wording) wraps, up to three lines.
      this.wrap(m.footer, 7, cw, "sans")
        .slice(0, 3)
        .forEach((l, k) =>
          this.text(l, ML, MB - 11 - k * 8.5, 7, "sans", "slate"),
        );
    });
    const ctx = this.doc.context;
    for (const p of this.pages) {
      for (const k of Object.keys(FONTS) as FontKey[])
        p.page.node.setFontDictionary(
          PDFName.of(FONT_NAMES[k]),
          this.fonts[k].ref,
        );
      p.page.node.addContentStream(
        ctx.register(ctx.flateStream(p.ops.join("\n"))),
      );
      p.ops = [];
      if (p.links.length) {
        const annots = ctx.obj([]) as PDFArray;
        for (const l of p.links)
          annots.push(
            ctx.register(
              ctx.obj({
                Type: "Annot",
                Subtype: "Link",
                Rect: l.rect.map((x) => Math.round(x * 100) / 100),
                Border: [0, 0, 0],
                A: { Type: "Action", S: "URI", URI: PDFString.of(l.uri) },
              }),
            ),
          );
        p.page.node.set(PDFName.of("Annots"), annots);
      }
    }
    this.doc.setTitle(this.clean(m.title), { showInWindowTitleBar: true });
    this.doc.setSubject(this.clean(m.subject));
    this.doc.setAuthor("FactLot");
    this.doc.setCreator(this.clean(m.producer));
    this.doc.setProducer(this.clean(m.producer));
    this.doc.setKeywords(m.keywords.map((k) => this.clean(k)));
    this.doc.setCreationDate(m.created);
    this.doc.setModificationDate(m.created);
    return this.doc.save({ useObjectStreams: false });
  }
}

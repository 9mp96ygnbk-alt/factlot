/**
 * A minimal .xlsx (Office Open XML SpreadsheetML) writer with live formulas, the TypeScript twin
 * of examples/reconciliation/xlsx_lite.py: inline strings, a fixed style table (number formats,
 * bold headers, input and output fills), column widths, frozen panes and print setup.
 *
 * Every formula is evaluated here before the file is written and its result stored as the cell's
 * cached value, so viewers that do not recalculate still show numbers (Excel recalculates on
 * open). The evaluator supports exactly the syntax this package writes: numbers, "strings",
 * references and ranges (Sheet!$A$1:$B$2), + - * / & = <> < > <= >=, unary minus, and ROUND,
 * SUM, PRODUCT, MEDIAN, MIN, MAX, ABS, IF and COUNTIF (exact-match criteria). Anything else
 * throws, so a workbook never holds a formula this module did not evaluate.
 */
import { round } from "@factlot/calc";

import { zip } from "./zip.ts";

// --- addresses ----------------------------------------------------------------------------------

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

export function addr(row: number, col: number, absolute = false): string {
  return absolute ? `$${colLetter(col)}$${row}` : `${colLetter(col)}${row}`;
}

function splitAddr(a: string): { row: number; col: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a);
  if (!m) throw new Error(`bad address ${a}`);
  return { row: Number(m[2]), col: colNumber(m[1]!) };
}

/** Excel's 1900 date system: 2027-01-01 → 46388. */
export function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000,
  );
}

/** A range between two absolute references on one sheet: Sheet!$A$1:$B$2. */
export function range(a: string, b: string): string {
  return `${a}:${b.split("!").pop()}`;
}

// --- styles -------------------------------------------------------------------------------------

const FONTS = [
  "normal",
  "bold",
  "blue",
  "white_bold",
  "red_bold",
  "grey_italic",
  "title",
  "grey",
] as const;
const FILLS = [
  "none",
  "gray125",
  "header",
  "input",
  "good",
  "warn",
  "band",
] as const;
const NUMFMT_CODES: Record<number, string> = {
  164: "#,##0.00",
  165: "0.0000",
  166: "0.0000%",
  167: "#,##0",
  168: "yyyy\\-mm\\-dd",
  169: "0.000000",
  170: "0.00000000",
  171: "0.00%",
  172: '0.00"x"',
  173: "#,##0.0000",
  174: "0.000000%",
};
const NUMFMTS = {
  general: 0,
  money: 164,
  num4: 165,
  pct4: 166,
  int: 167,
  date: 168,
  num6: 169,
  num8: 170,
  pct2: 171,
  times: 172,
  psf: 173,
  pct6: 174,
} as const;
type Font = (typeof FONTS)[number];
type Fill = (typeof FILLS)[number];
type Fmt = keyof typeof NUMFMTS;

const STYLE_TABLE = {
  default: ["normal", "none", "general", false],
  text: ["normal", "none", "general", true],
  bold: ["bold", "none", "general", false],
  bold_text: ["bold", "none", "general", true],
  title: ["title", "none", "general", false],
  header: ["white_bold", "header", "general", true],
  note: ["grey_italic", "none", "general", true],
  small: ["grey", "none", "general", true],
  warn: ["red_bold", "warn", "general", true],
  money: ["normal", "none", "money", false],
  num4: ["normal", "none", "num4", false],
  num6: ["normal", "none", "num6", false],
  num8: ["normal", "none", "num8", false],
  pct2: ["normal", "none", "pct2", false],
  pct4: ["normal", "none", "pct4", false],
  pct6: ["normal", "none", "pct6", false],
  int: ["normal", "none", "int", false],
  date: ["normal", "none", "date", false],
  times: ["normal", "none", "times", false],
  psf: ["normal", "none", "psf", false],
  in_text: ["blue", "input", "general", false],
  in_money: ["blue", "input", "money", false],
  in_num4: ["blue", "input", "num4", false],
  in_pct4: ["blue", "input", "pct4", false],
  in_int: ["blue", "input", "int", false],
  in_date: ["blue", "input", "date", false],
  fl_money: ["bold", "good", "money", false],
  fl_num4: ["bold", "good", "num4", false],
  fl_num6: ["bold", "good", "num6", false],
  fl_num8: ["bold", "good", "num8", false],
  fl_pct4: ["bold", "good", "pct4", false],
  fl_int: ["bold", "good", "int", false],
  fl_text: ["bold", "good", "general", false],
  diff: ["bold", "none", "money", false],
  total_money: ["bold", "band", "money", false],
  total_text: ["bold", "band", "general", false],
} as const satisfies Record<string, readonly [Font, Fill, Fmt, boolean]>;
export type Style = keyof typeof STYLE_TABLE;
const STYLE_NAMES = Object.keys(STYLE_TABLE) as Style[];

const esc = (s: string) =>
  s
    // XML 1.0 forbids most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function stylesXml(): string {
  const fonts: Record<Font, string> = {
    normal: '<font><sz val="11"/><name val="Calibri"/></font>',
    bold: '<font><b/><sz val="11"/><name val="Calibri"/></font>',
    blue: '<font><sz val="11"/><color rgb="FF0000FF"/><name val="Calibri"/></font>',
    white_bold:
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    red_bold:
      '<font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>',
    grey_italic:
      '<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font>',
    title: '<font><b/><sz val="14"/><name val="Calibri"/></font>',
    grey: '<font><sz val="9"/><color rgb="FF595959"/><name val="Calibri"/></font>',
  };
  const solid = (rgb: string) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/></patternFill></fill>`;
  const fills: Record<Fill, string> = {
    none: '<fill><patternFill patternType="none"/></fill>',
    gray125: '<fill><patternFill patternType="gray125"/></fill>',
    header: solid("FF1F3864"),
    input: solid("FFFFF2CC"),
    good: solid("FFE2EFDA"),
    warn: solid("FFFCE4D6"),
    band: solid("FFF2F2F2"),
  };
  const xfs = STYLE_NAMES.map((name) => {
    const [font, fill, fmt, wrap] = STYLE_TABLE[name];
    const align = wrap ? '<alignment vertical="top" wrapText="1"/>' : "";
    return `<xf numFmtId="${NUMFMTS[fmt]}" fontId="${FONTS.indexOf(font)}" fillId="${FILLS.indexOf(fill)}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"${wrap ? ' applyAlignment="1"' : ""}>${align}</xf>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${Object.keys(NUMFMT_CODES).length}">` +
    Object.entries(NUMFMT_CODES)
      .map(
        ([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`,
      )
      .join("") +
    "</numFmts>" +
    `<fonts count="${FONTS.length}">${FONTS.map((f) => fonts[f]).join("")}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.map((f) => fills[f]).join("")}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

// --- model --------------------------------------------------------------------------------------

export type CellValue = number | string | boolean | null;

export interface Formula {
  formula: string;
}

/** A live formula for Sheet.put: fx("=ROUND(A1,2)"). */
export const fx = (formula: string): Formula => ({ formula });

interface Cell {
  value: CellValue;
  formula?: string;
  style: Style;
  cached?: CellValue;
}

/** Excel's limit on a cell's text. */
const MAX_CELL_TEXT = 32_767;

export class Sheet {
  readonly name: string;
  readonly cells = new Map<string, Cell>();
  readonly widths = new Map<number, number>();
  freeze: string | undefined;
  landscape = false;

  constructor(name: string) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(name))
      throw new Error(
        "sheet names are letters, digits and underscores, at most 31 (no quoting needed)",
      );
    this.name = name;
  }

  /**
   * Write a value, or a formula given as fx("=..."). Text is always stored as text (a string that
   * starts with "=" stays a string), so supplied text can never become a formula. Returns
   * Sheet!$A$1.
   */
  put(
    row: number,
    col: number,
    content: CellValue | Formula,
    style: Style = "default",
  ): string {
    if (typeof content === "object" && content !== null)
      this.cells.set(`${row},${col}`, {
        value: null,
        formula: content.formula.replace(/^=/, ""),
        style,
      });
    else {
      if (typeof content === "number" && !Number.isFinite(content))
        throw new Error(`non-finite number at ${this.name}!${addr(row, col)}`);
      this.cells.set(`${row},${col}`, {
        value:
          typeof content === "string"
            ? content.slice(0, MAX_CELL_TEXT)
            : content,
        style,
      });
    }
    return `${this.name}!${addr(row, col, true)}`;
  }

  width(col: number, w: number): void {
    this.widths.set(col, w);
  }

  get(row: number, col: number): Cell | undefined {
    return this.cells.get(`${row},${col}`);
  }
}

export interface WorkbookMeta {
  title: string;
  creator: string;
  /** ISO time (W3CDTF) written as the document's creation time. */
  created: string;
  /** Printed in each sheet's page footer (Excel caps a footer at 255 characters). */
  footer?: string;
}

export class Workbook {
  readonly sheets: Sheet[] = [];
  readonly meta: WorkbookMeta;

  constructor(meta: WorkbookMeta) {
    this.meta = meta;
  }

  sheet(name: string): Sheet {
    if (this.sheets.some((s) => s.name === name))
      throw new Error(`duplicate sheet ${name}`);
    const s = new Sheet(name);
    this.sheets.push(s);
    return s;
  }

  getSheet(name: string): Sheet {
    const s = this.sheets.find((x) => x.name === name);
    if (!s) throw new Error(`no sheet ${name}`);
    return s;
  }

  /** Evaluate every formula and store its result as the cached value. */
  evaluate(): void {
    const ev = new Evaluator(this);
    for (const s of this.sheets)
      for (const [k, cell] of s.cells)
        if (cell.formula !== undefined) {
          const [r, c] = k.split(",").map(Number) as [number, number];
          cell.cached = ev.cellValue(s.name, r, c);
        }
  }

  /** The value at Sheet!$A$1 (a formula's cached result). */
  valueAt(ref: string): CellValue {
    const [sheet, a] = ref.replace(/\$/g, "").split("!") as [string, string];
    const { row, col } = splitAddr(a);
    const cell = this.getSheet(sheet).get(row, col);
    if (!cell) return null;
    return cell.formula !== undefined ? (cell.cached ?? null) : cell.value;
  }

  async bytes(): Promise<Uint8Array> {
    this.evaluate();
    return zip(this.parts().map(([name, data]) => ({ name, data })));
  }

  parts(): [string, string][] {
    const n = this.sheets.length;
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const ct =
      xml +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      this.sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      "</Types>";
    const rels =
      xml +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>";
    const core =
      xml +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(this.meta.title)}</dc:title><dc:creator>${esc(this.meta.creator)}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${esc(this.meta.created)}</dcterms:created>` +
      "</cp:coreProperties>";
    const wb =
      xml +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      this.sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
    const wbrels =
      xml +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      this.sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    return [
      ["[Content_Types].xml", ct],
      ["_rels/.rels", rels],
      ["docProps/core.xml", core],
      ["xl/workbook.xml", wb],
      ["xl/_rels/workbook.xml.rels", wbrels],
      ["xl/styles.xml", stylesXml()],
      ...this.sheets.map(
        (s, i) =>
          [
            `xl/worksheets/sheet${i + 1}.xml`,
            sheetXml(s, this.meta.footer),
          ] as [string, string],
      ),
    ];
  }
}

function fmtNum(x: number | boolean): string {
  if (typeof x === "boolean") return x ? "1" : "0";
  return String(x);
}

/** Header/footer text: & is a code character there, so it is doubled. */
const hfText = (s: string) => esc(s.slice(0, 200).replace(/&/g, "&&"));

function sheetXml(s: Sheet, footer: string | undefined): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
  ];
  if (s.freeze) {
    const { row, col } = splitAddr(s.freeze);
    const pane = `<pane${col > 1 ? ` xSplit="${col - 1}"` : ""}${row > 1 ? ` ySplit="${row - 1}"` : ""} topLeftCell="${s.freeze}" activePane="${col > 1 && row > 1 ? "bottomRight" : row > 1 ? "bottomLeft" : "topRight"}" state="frozen"/>`;
    out.push(
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`,
    );
  }
  if (s.widths.size) {
    out.push("<cols>");
    for (const c of [...s.widths.keys()].sort((a, b) => a - b))
      out.push(
        `<col min="${c}" max="${c}" width="${s.widths.get(c)}" customWidth="1"/>`,
      );
    out.push("</cols>");
  }
  out.push("<sheetData>");
  const rows = new Map<number, number[]>();
  for (const k of s.cells.keys()) {
    const [r, c] = k.split(",").map(Number) as [number, number];
    const list = rows.get(r) ?? [];
    list.push(c);
    rows.set(r, list);
  }
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    out.push(`<row r="${r}">`);
    for (const c of rows.get(r)!.sort((a, b) => a - b)) {
      const cell = s.get(r, c)!;
      const sid = STYLE_NAMES.indexOf(cell.style);
      const a = addr(r, c);
      if (cell.formula !== undefined) {
        const v = cell.cached;
        const f = esc(cell.formula);
        if (typeof v === "boolean")
          out.push(
            `<c r="${a}" s="${sid}" t="b"><f>${f}</f><v>${v ? 1 : 0}</v></c>`,
          );
        else if (typeof v === "string")
          out.push(
            `<c r="${a}" s="${sid}" t="str"><f>${f}</f><v>${esc(v)}</v></c>`,
          );
        else if (v === null || v === undefined)
          out.push(`<c r="${a}" s="${sid}"><f>${f}</f></c>`);
        else
          out.push(`<c r="${a}" s="${sid}"><f>${f}</f><v>${fmtNum(v)}</v></c>`);
      } else if (cell.value === null) out.push(`<c r="${a}" s="${sid}"/>`);
      else if (typeof cell.value === "boolean")
        out.push(
          `<c r="${a}" s="${sid}" t="b"><v>${cell.value ? 1 : 0}</v></c>`,
        );
      else if (typeof cell.value === "number")
        out.push(`<c r="${a}" s="${sid}"><v>${fmtNum(cell.value)}</v></c>`);
      else
        out.push(
          `<c r="${a}" s="${sid}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`,
        );
    }
    out.push("</row>");
  }
  out.push("</sheetData>");
  out.push(
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.75" header="0.3" footer="0.3"/>',
  );
  out.push(
    `<pageSetup orientation="${s.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`,
  );
  if (footer)
    out.push(
      `<headerFooter><oddFooter>&amp;L&amp;8${hfText(footer)}&amp;R&amp;8Page &amp;P of &amp;N</oddFooter></headerFooter>`,
    );
  out.push("</worksheet>");
  return out.join("");
}

// --- evaluator ----------------------------------------------------------------------------------

type Value = CellValue | Value[][];

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; sheet: string; a: string; b?: string }
  | { t: "fn"; name: string; args: Node[] }
  | { t: "neg"; e: Node }
  | { t: "bin"; op: string; l: Node; r: Node };

const TOKEN =
  /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|("(?:[^"]|"")*")|((?:[A-Za-z][A-Za-z0-9_]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])|([A-Z][A-Z0-9.]*)\(|(<>|<=|>=|[-+*/&=<>(),]))/y;

function tokenize(src: string): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  TOKEN.lastIndex = 0;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`cannot parse formula at ${src.slice(i)}`);
    if (m[1] !== undefined) out.push({ k: "num", v: m[1] });
    else if (m[2] !== undefined) out.push({ k: "str", v: m[2] });
    else if (m[3] !== undefined) out.push({ k: "ref", v: m[3] });
    else if (m[4] !== undefined) out.push({ k: "fn", v: m[4] });
    else out.push({ k: "op", v: m[5]! });
    i = TOKEN.lastIndex;
  }
  return out;
}

function parse(src: string, sheet: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = (v?: string) => {
    const t = toks[p++];
    if (!t || (v !== undefined && t.v !== v))
      throw new Error(`formula ${src}: expected ${v ?? "a token"}`);
    return t;
  };
  const LEVELS = [
    ["=", "<>", "<", ">", "<=", ">="],
    ["&"],
    ["+", "-"],
    ["*", "/"],
  ];
  const binary = (level: number): Node => {
    if (level === LEVELS.length) return unary();
    let l = binary(level + 1);
    while (peek()?.k === "op" && LEVELS[level]!.includes(peek()!.v)) {
      const op = take().v;
      l = { t: "bin", op, l, r: binary(level + 1) };
    }
    return l;
  };
  const unary = (): Node => {
    if (peek()?.k === "op" && peek()!.v === "-") {
      take();
      return { t: "neg", e: unary() };
    }
    if (peek()?.k === "op" && peek()!.v === "+") {
      take();
      return unary();
    }
    return atom();
  };
  const atom = (): Node => {
    const t = take();
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "str")
      return { t: "str", v: t.v.slice(1, -1).replace(/""/g, '"') };
    if (t.k === "ref") {
      const [sh, rest] = t.v.includes("!") ? t.v.split("!") : [sheet, t.v];
      const [a, b] = rest!.replace(/\$/g, "").split(":");
      return { t: "ref", sheet: sh!, a: a!, ...(b ? { b } : {}) };
    }
    if (t.k === "fn") {
      const args: Node[] = [];
      if (!(peek()?.k === "op" && peek()!.v === ")"))
        for (;;) {
          args.push(binary(0));
          if (peek()?.k === "op" && peek()!.v === ",") take();
          else break;
        }
      take(")");
      return { t: "fn", name: t.v, args };
    }
    if (t.v === "(") {
      const e = binary(0);
      take(")");
      return e;
    }
    throw new Error(`formula ${src}: unexpected ${t.v}`);
  };
  const node = binary(0);
  if (p !== toks.length) throw new Error(`formula ${src}: trailing input`);
  return node;
}

const numOf = (v: Value): number => {
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`not a number: ${JSON.stringify(v)}`);
};

/** Numbers in arguments (ranges skip text and blanks, as Excel's SUM does). */
function numbers(args: Value[]): number[] {
  const out: number[] = [];
  for (const a of args)
    if (Array.isArray(a)) {
      for (const row of a)
        for (const v of row) if (typeof v === "number") out.push(v);
    } else out.push(numOf(a));
  return out;
}

class Evaluator {
  private readonly wb: Workbook;
  private readonly memo = new Map<string, CellValue>();
  private readonly busy = new Set<string>();
  private readonly parsed = new Map<string, Node>();

  constructor(wb: Workbook) {
    this.wb = wb;
  }

  cellValue(sheet: string, row: number, col: number): CellValue {
    const key = `${sheet}!${row},${col}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    const cell = this.wb.getSheet(sheet).get(row, col);
    if (!cell) return null;
    if (cell.formula === undefined) return cell.value;
    if (this.busy.has(key)) throw new Error(`circular reference at ${key}`);
    this.busy.add(key);
    let node = this.parsed.get(key);
    if (!node) {
      node = parse(cell.formula, sheet);
      this.parsed.set(key, node);
    }
    const v = this.eval(node);
    this.busy.delete(key);
    if (Array.isArray(v)) throw new Error(`range as a value at ${key}`);
    const out = typeof v === "number" && Object.is(v, -0) ? 0 : v;
    this.memo.set(key, out);
    return out;
  }

  private eval(n: Node): Value {
    switch (n.t) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "neg":
        return -numOf(this.eval(n.e));
      case "ref": {
        const a = splitAddr(n.a);
        if (!n.b) return this.cellValue(n.sheet, a.row, a.col);
        const b = splitAddr(n.b);
        const rows: Value[][] = [];
        for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
          const row: Value[] = [];
          for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++)
            row.push(this.cellValue(n.sheet, r, c));
          rows.push(row);
        }
        return rows;
      }
      case "bin": {
        const l = this.eval(n.l);
        const r = this.eval(n.r);
        switch (n.op) {
          case "+":
            return numOf(l) + numOf(r);
          case "-":
            return numOf(l) - numOf(r);
          case "*":
            return numOf(l) * numOf(r);
          case "/": {
            const d = numOf(r);
            if (d === 0) throw new Error("division by zero");
            return numOf(l) / d;
          }
          case "&":
            return `${String(l ?? "")}${String(r ?? "")}`;
          default: {
            const cmp =
              typeof l === "string" || typeof r === "string"
                ? String(l ?? "").localeCompare(String(r ?? ""))
                : numOf(l) - numOf(r);
            return n.op === "="
              ? cmp === 0
              : n.op === "<>"
                ? cmp !== 0
                : n.op === "<"
                  ? cmp < 0
                  : n.op === ">"
                    ? cmp > 0
                    : n.op === "<="
                      ? cmp <= 0
                      : cmp >= 0;
          }
        }
      }
      case "fn": {
        if (n.name === "IF") {
          const c = this.eval(n.args[0]!);
          return this.eval(n.args[numOf(c as CellValue) !== 0 ? 1 : 2]!);
        }
        const args = n.args.map((a) => this.eval(a));
        switch (n.name) {
          case "ROUND":
            return round(numOf(args[0]!), numOf(args[1]!));
          case "SUM":
            return numbers(args).reduce((s, x) => s + x, 0);
          case "PRODUCT":
            return numbers(args).reduce((s, x) => s * x, 1);
          case "MIN":
            return Math.min(...numbers(args));
          case "MAX":
            return Math.max(...numbers(args));
          case "ABS":
            return Math.abs(numOf(args[0]!));
          case "MEDIAN": {
            const xs = numbers(args).sort((a, b) => a - b);
            if (!xs.length) throw new Error("MEDIAN of nothing");
            const m = xs.length >> 1;
            return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
          }
          case "COUNTIF": {
            const rng = args[0];
            if (!Array.isArray(rng)) throw new Error("COUNTIF needs a range");
            const crit = args[1];
            let k = 0;
            for (const row of rng) for (const v of row) if (v === crit) k++;
            return k;
          }
          default:
            throw new Error(`unsupported function ${n.name}`);
        }
      }
    }
  }
}

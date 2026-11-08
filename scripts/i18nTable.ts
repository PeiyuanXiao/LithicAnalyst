// The interface text as a table, and back: every `{ en: '…', zh: '…', … }` literal in the sources
// (ui/strings.ts, the field labels of core/fields.ts) and the language list of ui/i18n.ts. Used by
// scripts/i18n.ts; no DOM, no three.js. The sources stay the one place the text lives: the table is
// made from them and written back into them, a literal at a time.
import { inflateRawSync } from 'node:zlib';
import ts from 'typescript';
import { zipStored } from '../src/io/zip';

/** A language code as a column heading: `en`, `zh`, `ja`, `pt-BR`, `zh-TW`. */
export const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** `{name}` in a text: filled in by the program; every language must keep the same ones. */
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;

/** The rows that hold each language's own name and its short label (the language button). */
export const LANG_NAME_ID = '@lang.name';
export const LANG_SHORT_ID = '@lang.short';

export interface TextEntry {
  id: string;
  /** Repo-relative path of the source file. */
  file: string;
  /** The literal's span in the file. */
  start: number;
  end: number;
  values: Record<string, string>;
  /** Its properties in source order. */
  order: string[];
}

export interface LangInfo {
  code: string;
  label: string;
  short: string;
}

const propName = (n: ts.PropertyName): string | null => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null);
const stringValue = (n: ts.Expression): string | null => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);

/** `{ en: '…', zh: '…' }`: string properties only, every name a language code, English among them. */
function langLiteral(node: ts.Node): { values: Record<string, string>; order: string[] } | null {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length < 2) return null;
  const values: Record<string, string> = {};
  const order: string[] = [];
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p)) return null;
    const name = propName(p.name);
    const value = stringValue(p.initializer);
    if (name === null || value === null || !LANG_CODE.test(name)) return null;
    values[name] = value;
    order.push(name);
  }
  return 'en' in values ? { values, order } : null;
}

/** The string property `key` of an object literal (what tells an option or a field from its siblings). */
function ownKey(obj: ts.ObjectLiteralExpression): string | null {
  for (const k of ['key', 'value', 'code', 'id'])
    for (const p of obj.properties)
      if (ts.isPropertyAssignment(p) && propName(p.name) === k) {
        const v = stringValue(p.initializer);
        if (v !== null) return v;
      }
  return null;
}

/**
 * Where a literal sits, as an id. In the `STRINGS` table: its key. Elsewhere: the file, the variable
 * (`SCAR_FIELDS` → `scar`), the `key` / `value` of each object it is in, and the property unless it is `label`:
 * `fields.scar.completeness.point_complete.short`.
 */
function idOf(node: ts.ObjectLiteralExpression, file: string): string {
  const holder = node.parent;
  const prop = ts.isPropertyAssignment(holder) ? propName(holder.name) : null;
  let table: ts.Node | undefined = holder.parent?.parent;
  while (table && (ts.isAsExpression(table) || ts.isSatisfiesExpression(table) || ts.isParenthesizedExpression(table))) table = table.parent;
  if (prop !== null && table && ts.isVariableDeclaration(table) && ts.isIdentifier(table.name) && table.name.text === 'STRINGS') return prop;
  const segs: string[] = [];
  for (let n: ts.Node | undefined = holder.parent; n; n = n.parent) {
    if (ts.isObjectLiteralExpression(n)) {
      const k = ownKey(n);
      if (k !== null) segs.unshift(k);
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      segs.unshift(n.name.text.replace(/_FIELDS$/, '').toLowerCase());
      break;
    }
  }
  const stem = file.replace(/^.*\//, '').replace(/\.ts$/, '');
  return [stem, ...segs, ...(prop && prop !== 'label' ? [prop] : [])].join('.');
}

/** Every language literal of one source file. */
export function collectTexts(file: string, text: string): TextEntry[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: TextEntry[] = [];
  const visit = (n: ts.Node): void => {
    const lit = langLiteral(n);
    if (lit) {
      out.push({ id: idOf(n as ts.ObjectLiteralExpression, file), file, start: n.getStart(sf), end: n.getEnd(), ...lit });
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The `LANGS` list of ui/i18n.ts, and its span. */
export function readLangs(text: string): { langs: LangInfo[]; start: number; end: number } {
  const sf = ts.createSourceFile('i18n.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const find = (n: ts.Node): ts.VariableDeclaration | undefined =>
    ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'LANGS' ? n : ts.forEachChild(n, find);
  const decl = find(sf);
  let arr = decl?.initializer;
  if (arr && ts.isAsExpression(arr)) arr = arr.expression;
  if (!arr || !ts.isArrayLiteralExpression(arr)) throw new Error('no LANGS array in ui/i18n.ts');
  const langs = arr.elements.map((el) => {
    if (!ts.isObjectLiteralExpression(el)) throw new Error('LANGS: an entry is not an object literal');
    const get = (k: string): string => {
      for (const p of el.properties) if (ts.isPropertyAssignment(p) && propName(p.name) === k) return stringValue(p.initializer) ?? '';
      return '';
    };
    return { code: get('code'), label: get('label'), short: get('short') };
  });
  return { langs, start: arr.getStart(sf), end: arr.getEnd() };
}

/** A string literal as the sources write it: single quotes, double ones when the text has a single quote. */
export function quote(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .split(q)
    .join(`\\${q}`);
  return q + body + q;
}

const propKey = (code: string): string => (/^[a-z]+$/.test(code) ? code : quote(code));

/** The literal as text, in its first line's indentation when it was on several lines. */
function literalText(values: Record<string, string>, order: string[], multiline: string | null): string {
  const props = order.filter((k) => k in values).map((k) => `${propKey(k)}: ${quote(values[k])}`);
  return multiline === null ? `{ ${props.join(', ')} }` : `{\n${props.map((p) => `${multiline}  ${p},`).join('\n')}\n${multiline}}`;
}

/** The text with the spans replaced (spans do not overlap). */
function splice(text: string, edits: Array<{ start: number; end: number; text: string }>): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** `{name}` placeholders of a text, sorted. */
export const placeholders = (s: string): string[] => [...(s.match(PLACEHOLDER) ?? [])].sort();

// ------------------------------------------------------------------ the table

export interface Table {
  /** Language codes, in column order (English first). */
  langs: string[];
  /** id → language → text ('' when that language has none). */
  rows: Map<string, Record<string, string>>;
}

/** The table of everything, English first, then the languages of LANGS. */
export function tableOf(entries: TextEntry[], langs: LangInfo[]): Table {
  const codes = ['en', ...langs.map((l) => l.code).filter((c) => c !== 'en')];
  for (const e of entries) for (const k of Object.keys(e.values)) if (!codes.includes(k)) codes.push(k);
  const rows = new Map<string, Record<string, string>>();
  rows.set(LANG_NAME_ID, Object.fromEntries(langs.map((l) => [l.code, l.label])));
  rows.set(LANG_SHORT_ID, Object.fromEntries(langs.map((l) => [l.code, l.short])));
  for (const e of entries) rows.set(e.id, { ...e.values });
  return { langs: codes, rows };
}

export interface ApplyResult {
  /** Path → new text, for the files that change. */
  files: Map<string, string>;
  /** Texts changed, by language. */
  changed: Record<string, number>;
  /** Languages that were not in the sources before. */
  added: string[];
  /** What could not be applied, or looks wrong; nothing of a row with an error is applied. */
  errors: string[];
  warnings: string[];
}

/**
 * Write a table back into the sources. A cell left empty: in English or Chinese an error (the row is
 * left as it is), in another language no text (English stands in). A language column new to the sources
 * needs its name and short label in the rows `@lang.name` and `@lang.short`; it is added to LANGS.
 */
export function applyTable(table: Table, sources: Map<string, string>, entries: TextEntry[], i18nPath: string): ApplyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const changed: Record<string, number> = {};
  const known = new Map(entries.map((e) => [e.id, e]));
  const edits = new Map<string, Array<{ start: number; end: number; text: string }>>();
  const { langs: oldLangs, start: lStart, end: lEnd } = readLangs(sources.get(i18nPath)!);
  const oldCodes = new Set(oldLangs.map((l) => l.code));
  const codes = table.langs.filter((c) => LANG_CODE.test(c));
  const added = codes.filter((c) => !oldCodes.has(c));
  for (const id of table.rows.keys()) if (!id.startsWith('@') && !known.has(id)) warnings.push(`${id}: not in the sources (a text the program no longer has, or an id changed by hand); left out`);
  for (const e of entries) if (!table.rows.has(e.id)) warnings.push(`${e.id}: not in the table; left as it is`);

  for (const e of entries) {
    const row = table.rows.get(e.id);
    if (!row) continue;
    const next: Record<string, string> = { ...e.values };
    let bad = false;
    for (const c of codes) {
      const v = row[c] ?? '';
      if (v.trim() === '') {
        if (c === 'en' || c === 'zh') {
          errors.push(`${e.id} [${c}]: empty`);
          bad = true;
        } else delete next[c];
        continue;
      }
      if (v !== v.trim() && v !== e.values[c]) warnings.push(`${e.id} [${c}]: spaces at the start or end`);
      next[c] = v;
    }
    const want = placeholders(next.en ?? '').join(' ');
    for (const c of codes)
      if (next[c] !== undefined && placeholders(next[c]).join(' ') !== want) {
        errors.push(`${e.id} [${c}]: placeholders ${placeholders(next[c]).join(' ') || '(none)'} differ from English ${want || '(none)'}`);
        bad = true;
      }
    if (bad) continue;
    const order = [...e.order.filter((k) => k in next), ...codes.filter((c) => c in next && !e.order.includes(c))];
    const same = order.length === e.order.length && order.every((k, i) => k === e.order[i] && next[k] === e.values[k]);
    if (same) continue;
    for (const k of order) if (next[k] !== e.values[k]) changed[k] = (changed[k] ?? 0) + 1;
    const text = sources.get(e.file)!;
    const original = text.slice(e.start, e.end);
    const lineStart = text.lastIndexOf('\n', e.start) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    const list = edits.get(e.file) ?? edits.set(e.file, []).get(e.file)!;
    list.push({ start: e.start, end: e.end, text: literalText(next, order, original.includes('\n') ? indent : null) });
  }

  // the language list: names and short labels from their rows; a new column, a new entry
  const names = table.rows.get(LANG_NAME_ID) ?? {};
  const shorts = table.rows.get(LANG_SHORT_ID) ?? {};
  const langs: LangInfo[] = codes.map((code) => {
    const old = oldLangs.find((l) => l.code === code);
    const label = (names[code] ?? '').trim() || old?.label || '';
    const short = (shorts[code] ?? '').trim() || old?.short || '';
    if (!label || !short) errors.push(`${code}: the language needs its own name (${LANG_NAME_ID}) and a short label (${LANG_SHORT_ID})`);
    return { code, label, short };
  });
  for (const l of oldLangs)
    if (!codes.includes(l.code)) {
      warnings.push(`${l.code}: no column in the table; the language stays as it is`);
      langs.push(l);
    }
  const langText = `[\n${langs.map((l) => `  { code: ${quote(l.code)}, label: ${quote(l.label)}, short: ${quote(l.short)} },`).join('\n')}\n]`;
  const i18nText = sources.get(i18nPath)!;
  if (langText !== i18nText.slice(lStart, lEnd)) (edits.get(i18nPath) ?? edits.set(i18nPath, []).get(i18nPath)!).push({ start: lStart, end: lEnd, text: langText });

  const files = new Map<string, string>();
  for (const [file, list] of edits) files.set(file, splice(sources.get(file)!, list));
  return { files, changed, added, errors, warnings };
}

// ------------------------------------------------------------------ xlsx

export interface SheetColumn {
  header: string;
  /** In characters. */
  width: number;
  /** grey: text to read, not to change. */
  style?: 'text' | 'grey';
}

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: string[][];
  /** Freeze the header row and this many columns. */
  freezeCols?: number;
  /** Columns after the last one that also take text (wrapped), for languages added by hand. */
  spare?: number;
  filter?: boolean;
}

const xmlEsc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // control characters other than tab and newline cannot be in XML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => `_x${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`);

/** Column letters: 0 → A, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const colIndex = (letters: string): number => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

// cell formats: 0 default, 1 header, 2 text (wrapped, top), 3 grey text
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">` +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><sz val="11"/><color rgb="FF7A7468"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6DCAE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function sheetXml(s: Sheet): string {
  const style = (c: SheetColumn | undefined): number => (c?.style === 'grey' ? 3 : 2);
  const fc = s.freezeCols ?? 0;
  const pane = `<pane${fc ? ` xSplit="${fc}"` : ''} ySplit="1" topLeftCell="${colName(fc)}2" activePane="${fc ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>`;
  const cols = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" style="${style(c)}" customWidth="1"/>`);
  if (s.spare) cols.push(`<col min="${s.columns.length + 1}" max="${s.columns.length + s.spare}" width="40" style="2" customWidth="1"/>`);
  const cell = (r: number, i: number, v: string, st: number) => `<c r="${colName(i)}${r}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const rows = [
    `<row r="1">${s.columns.map((c, i) => cell(1, i, c.header, 1)).join('')}</row>`,
    ...s.rows.map((row, k) => `<row r="${k + 2}">${row.map((v, i) => (v === '' ? '' : cell(k + 2, i, v, style(s.columns[i])))).join('')}</row>`),
  ];
  const ref = `A1:${colName(s.columns.length - 1)}${s.rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols.join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (s.filter ? `<autoFilter ref="${ref}"/>` : '') +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
  );
}

/** A workbook of plain text sheets (every cell text, so nothing is read as a number, a date or a formula). */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const enc = new TextEncoder();
  const file = (name: string, text: string) => ({ name, data: enc.encode(text) });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const filters = sheets
    .map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.name}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : ''))
    .join('');
  return zipStored([
    file(
      '[Content_Types].xml',
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ),
    file('_rels/.rels', `${head}<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file(
      'xl/workbook.xml',
      `${head}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView/></bookViews><sheets>` +
        sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>`,
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      `${head}<Relationships xmlns="${NS_PKG}">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
    ),
    file('xl/styles.xml', STYLES),
    ...sheets.map((s, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ]);
}

/** The files of a ZIP archive (stored or deflated), by name. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a ZIP file (an .xlsx is one)');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('broken ZIP directory');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw)));
    else throw new Error(`${name}: ZIP method ${method} not supported`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    // Excel's escape of characters XML cannot hold
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** The text of an `<si>` or `<is>`: its runs, without the phonetic guides Excel adds to East Asian text. */
const richText = (xml: string): string =>
  [...xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g)].map((m) => unescapeXml(m[1] ?? '')).join('');

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

/** The cells of one sheet of a workbook (by name; else the first), as rows of text. */
export function readXlsx(bytes: Uint8Array, sheetName?: string): string[][] {
  const files = unzip(bytes);
  const text = (name: string): string | null => {
    const f = files.get(name) ?? files.get(name.replace(/^\//, ''));
    return f ? new TextDecoder().decode(f) : null;
  };
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('no workbook in the file');
  const sheets = [...wb.matchAll(/<(?:\w+:)?sheet\s[^>]*>/g)].map((m) => ({ name: attr(m[0], 'name') ?? '', rid: attr(m[0], 'r:id') ?? attr(m[0], '[\\w]+:id') ?? '' }));
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];
  if (!sheet) throw new Error('no sheet in the workbook');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const rel = [...rels.matchAll(/<(?:\w+:)?Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === sheet.rid);
  const target = rel ? attr(rel, 'Target')! : 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const xml = text(path);
  if (!xml) throw new Error(`no ${path} in the file`);
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => richText(m[1]));
  const rows: string[][] = [];
  let next = 0;
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = attr(`<row${rm[1]}>`, 'r');
    const ri = r ? Number(r) - 1 : next;
    next = ri + 1;
    const row: string[] = [];
    let col = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const tag = `<c${cm[1]}>`;
      const ref = attr(tag, 'r');
      const ci = ref ? colIndex(/^[A-Z]+/.exec(ref)![0]) : col;
      col = ci + 1;
      const body = cm[2] ?? '';
      const type = attr(tag, 't');
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = richText(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body)?.[1] ?? '');
      else if (v !== undefined) value = unescapeXml(v);
      while (row.length < ci) row.push('');
      row[ci] = value;
    }
    while (rows.length < ri) rows.push([]);
    rows[ri] = row;
  }
  return rows;
}

/** A sheet's rows as a table: the header row names the columns (`id`, and a language code for each language). */
export function tableFromRows(rows: string[][]): Table {
  const header = (rows[0] ?? []).map((h) => h.trim());
  const idCol = header.indexOf('id');
  if (idCol < 0) throw new Error('no column headed "id"');
  // (`id` is the ids' column, though it looks like a language code)
  const langCols = header.map((h, i) => [h, i] as const).filter(([h, i]) => i !== idCol && LANG_CODE.test(h));
  if (!langCols.some(([h]) => h === 'en')) throw new Error('no column headed "en"');
  const table: Table = { langs: langCols.map(([h]) => h), rows: new Map() };
  for (const row of rows.slice(1)) {
    const id = (row[idCol] ?? '').trim();
    if (!id) continue;
    // line ends as the sources write them
    table.rows.set(id, Object.fromEntries(langCols.map(([h, i]) => [h, (row[i] ?? '').replace(/\r\n?/g, '\n')])));
  }
  return table;
}

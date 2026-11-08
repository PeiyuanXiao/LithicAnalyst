import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURVE_FIELDS, REGION_FIELDS, SCAR_FIELDS } from '../src/core/fields';
import type { LocalizedText } from '../src/core/types';
import { zipStored } from '../src/io/zip';
import { STRINGS } from '../src/ui/strings';
import {
  applyTable,
  collectTexts,
  LANG_NAME_ID,
  LANG_SHORT_ID,
  placeholders,
  quote,
  readLangs,
  readXlsx,
  tableFromRows,
  tableOf,
  writeXlsx,
  type Table,
} from '../scripts/i18nTable';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Every label of the field lists. */
const fieldTexts = (): LocalizedText[] =>
  [...SCAR_FIELDS, ...CURVE_FIELDS, ...REGION_FIELDS].flatMap((f) => [f.label, ...(f.options ?? []).flatMap((o) => [o.label, ...(o.short ? [o.short] : [])])]);

describe('the interface text', () => {
  it('has English and Chinese for every text, with the same placeholders in every language', () => {
    const all: Array<[string, LocalizedText]> = [...Object.entries(STRINGS as Record<string, LocalizedText>), ...fieldTexts().map((x, i) => [`field ${i}`, x] as [string, LocalizedText])];
    expect(all.length).toBeGreaterThan(800);
    for (const [id, text] of all) {
      expect(text.en?.trim(), id).toBeTruthy();
      expect(text.zh?.trim(), id).toBeTruthy();
      for (const [lang, v] of Object.entries(text)) expect(placeholders(v ?? ''), `${id} ${lang}`).toEqual(placeholders(text.en));
    }
  });

  it('is found in the sources as the table has it: the keys of STRINGS, the field labels by their place', () => {
    const strings = collectTexts('src/ui/strings.ts', read('src/ui/strings.ts'));
    expect(strings.map((e) => e.id)).toEqual(Object.keys(STRINGS));
    expect(strings.find((e) => e.id === 'header.openMesh')!.values).toMatchObject({ zh: '打开模型', en: 'Open model' });
    // a text on several lines is one text
    expect(strings.find((e) => e.id === 'error.webgl')!.values.zh).toContain('WebGL');
    const fields = collectTexts('src/core/fields.ts', read('src/core/fields.ts'));
    expect(fields).toHaveLength(fieldTexts().length);
    expect(fields.map((e) => e.id)).toContain('fields.scar.completeness');
    expect(fields.find((e) => e.id === 'fields.scar.completeness.bulb_truncated.short')!.values.en).toBe('Bulb only');
    expect(fields.find((e) => e.id === 'fields.region.type.cortex')!.values.zh).toBe('石皮');
    expect(new Set(fields.map((e) => e.id)).size).toBe(fields.length);
    // the language list: English first, then Chinese; every language named in itself
    const langs = readLangs(read('src/ui/i18n.ts')).langs;
    expect(langs.slice(0, 2).map((l) => l.code)).toEqual(['en', 'zh']);
    for (const l of langs) expect(l.label && l.short, l.code).toBeTruthy();
  });

  it('writes a literal as the sources do', () => {
    expect(quote('Open model')).toBe("'Open model'");
    expect(quote("Cohen's κ")).toBe('"Cohen\'s κ"');
    expect(quote(`a 'b' "c"`)).toBe(`'a \\'b\\' "c"'`);
    expect(quote('two\nlines \\ ')).toBe("'two\\nlines \\\\ '");
  });
});

const SOURCES = (): Map<string, string> =>
  new Map([
    ['src/ui/strings.ts', "export const STRINGS = {\n  'a.one': { zh: '一', en: 'One' },\n  'a.count': { zh: '{n} 个', en: '{n} items' },\n  'a.long': {\n    zh: '长',\n    en: 'Long',\n  },\n} as const;\n"],
    ['src/core/fields.ts', "export const SCAR_FIELDS = [\n  { key: 'k', label: { zh: '字段', en: 'Field' }, options: [{ value: 'v', label: { zh: '值', en: 'Value' }, short: { zh: '值', en: 'Val.' } }] },\n];\n"],
    ['src/ui/i18n.ts', "export const LANGS = [\n  { code: 'en', label: 'English', short: 'EN' },\n  { code: 'zh', label: '中文', short: '中' },\n] as const;\n"],
  ]);

const entriesOf = (src: Map<string, string>) => [...src].flatMap(([f, text]) => collectTexts(f, text));

describe('the table and back', () => {
  it('a table of the sources, unchanged, writes nothing', () => {
    const src = SOURCES();
    const entries = entriesOf(src);
    expect(entries.map((e) => e.id)).toEqual(['a.one', 'a.count', 'a.long', 'fields.scar.k', 'fields.scar.k.v', 'fields.scar.k.v.short']);
    const table = tableOf(entries, readLangs(src.get('src/ui/i18n.ts')!).langs);
    expect(table.langs).toEqual(['en', 'zh']);
    expect(table.rows.get(LANG_NAME_ID)).toEqual({ en: 'English', zh: '中文' });
    const r = applyTable(table, src, entries, 'src/ui/i18n.ts');
    expect(r.errors).toEqual([]);
    expect(r.files.size).toBe(0);
  });

  it('writes a changed text into its literal, and a new language into every literal and the language list', () => {
    const src = SOURCES();
    const entries = entriesOf(src);
    const table: Table = tableOf(entries, readLangs(src.get('src/ui/i18n.ts')!).langs);
    table.langs.push('ja');
    table.rows.get('a.one')!.zh = '壹';
    table.rows.get('a.one')!.ja = "一つ'";
    table.rows.get('a.count')!.ja = '{n} 個';
    table.rows.get('a.long')!.ja = '長い';
    table.rows.get('fields.scar.k.v')!.ja = '値';
    table.rows.get(LANG_NAME_ID)!.ja = '日本語';
    table.rows.get(LANG_SHORT_ID)!.ja = '日';
    const r = applyTable(table, src, entries, 'src/ui/i18n.ts');
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual(['ja']);
    expect(r.changed).toEqual({ zh: 1, ja: 4 });
    const strings = r.files.get('src/ui/strings.ts')!;
    expect(strings).toContain(`'a.one': { zh: '壹', en: 'One', ja: "一つ'" },`);
    expect(strings).toContain("'a.count': { zh: '{n} 个', en: '{n} items', ja: '{n} 個' },");
    // on several lines, it stays so
    expect(strings).toContain("  'a.long': {\n    zh: '长',\n    en: 'Long',\n    ja: '長い',\n  },");
    // what has no text in the new language stays without it (English stands in)
    const fields = r.files.get('src/core/fields.ts')!;
    expect(fields).toContain("label: { zh: '值', en: 'Value', ja: '値' }");
    expect(fields).toContain("label: { zh: '字段', en: 'Field' }");
    expect(r.files.get('src/ui/i18n.ts')).toContain("  { code: 'ja', label: '日本語', short: '日' },\n] as const;");
    // the result reads back as the table
    const again = new Map([...src, ...r.files]);
    const back = tableOf(entriesOf(again), readLangs(again.get('src/ui/i18n.ts')!).langs);
    expect(back.langs).toEqual(['en', 'zh', 'ja']);
    expect(back.rows.get('a.one')).toEqual({ zh: '壹', en: 'One', ja: "一つ'" });
  });

  it('refuses empty English or Chinese, placeholders that differ, and a language without its name', () => {
    const src = SOURCES();
    const entries = entriesOf(src);
    const table = tableOf(entries, readLangs(src.get('src/ui/i18n.ts')!).langs);
    table.rows.get('a.one')!.en = ' ';
    table.rows.get('a.count')!.zh = '{m} 个';
    table.langs.push('fr');
    table.rows.get('a.long')!.fr = 'Long';
    const r = applyTable(table, src, entries, 'src/ui/i18n.ts');
    expect(r.errors).toEqual([
      'a.one [en]: empty',
      'a.count [zh]: placeholders {m} differ from English {n}',
      `fr: the language needs its own name (${LANG_NAME_ID}) and a short label (${LANG_SHORT_ID})`,
    ]);
  });
});

describe('xlsx', () => {
  it('reads back what it writes: every cell text, as it is', () => {
    const cells = [
      ['header.openMesh', 'Open model', '打开模型'],
      ['x', '=1+1', '1/2'],
      ['y', '  spaced  ', 'two\nlines & <tags> "q"'],
      ['z', '', '只有中文'],
    ];
    const bytes = writeXlsx([
      { name: 'texts', columns: [{ header: 'id', width: 20 }, { header: 'en', width: 30 }, { header: 'zh', width: 30 }], rows: cells, freezeCols: 1, filter: true, spare: 4 },
      { name: '说明', columns: [{ header: 'readme', width: 50 }], rows: [['a']] },
    ]);
    expect(readXlsx(bytes, 'texts')).toEqual([['id', 'en', 'zh'], ...cells.map((r) => (r[1] === '' ? [r[0], '', r[2]] : r))]);
    expect(readXlsx(bytes, '说明')).toEqual([['readme'], ['a']]);
    const t = tableFromRows(readXlsx(bytes));
    expect(t.langs).toEqual(['en', 'zh']);
    expect(t.rows.get('y')!.zh).toBe('two\nlines & <tags> "q"');
  });

  it('reads a workbook as Excel saves it: shared strings, runs, phonetic guides, cells left out, deflated', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const enc = (s: string) => new TextEncoder().encode(s);
    const files = [
      { name: 'xl/workbook.xml', data: enc('<workbook xmlns:r="r"><sheets><sheet name="other" sheetId="1" r:id="rId1"/><sheet name="texts" sheetId="2" r:id="rId2"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>') },
      {
        name: 'xl/sharedStrings.xml',
        data: enc('<sst><si><t>id</t></si><si><t>en</t></si><si><t>ja</t></si><si><t>a.b</t></si><si><r><t>Op</t></r><r><rPr/><t xml:space="preserve">en &amp; </t></r></si><si><t>開く</t><rPh sb="0" eb="1"><t>ヒラ</t></rPh></si><si><t>_x000D_x</t></si></sst>'),
      },
      { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong</t></is></c></row></sheetData></worksheet>') },
      {
        name: 'xl/worksheets/sheet2.xml',
        data: new Uint8Array(
          deflateRawSync(enc('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="s"><v>4</v></c><c r="D3" t="s"><v>5</v></c></row><row r="4"><c r="A4" t="s"><v>6</v></c><c r="C4"><v>2</v></c></row></sheetData></worksheet>')),
        ),
      },
    ];
    // a ZIP with the sheet deflated: stored ZIP, then the method and sizes of that entry changed
    const zip = zipStored(files);
    const view = new DataView(zip.buffer);
    let p = 0;
    for (const f of files) {
      const nameLen = view.getUint16(p + 26, true);
      if (f.name.endsWith('sheet2.xml')) view.setUint16(p + 8, 8, true);
      p += 30 + nameLen + f.data.length;
    }
    for (const f of files) {
      const nameLen = view.getUint16(p + 28, true);
      if (f.name.endsWith('sheet2.xml')) view.setUint16(p + 10, 8, true);
      p += 46 + nameLen;
    }
    const rows = readXlsx(zip, 'texts');
    expect(rows).toEqual([['id', '', 'en', 'ja'], [], ['a.b', '', 'Open & ', '開く'], ['\rx', '', '2']]);
    const t = tableFromRows(rows);
    expect(t.langs).toEqual(['en', 'ja']);
    expect(t.rows.get('a.b')).toEqual({ en: 'Open & ', ja: '開く' });
  });
});

// The interface text in a spreadsheet, for reading it over and for translating it, and back into the sources.
// Usage: npm run i18n -- export [file.xlsx]        every text, a column per language (default i18n/texts.xlsx)
//        npm run i18n -- import file.xlsx [--dry]  write the table's texts (and any new language column) into the sources
//        npm run i18n -- check                     what looks wrong: placeholders, empty texts, keys missing or unused
// A language is added by adding a column headed with its code (ja, ko, fr, de, es, pt-BR, …) and importing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  applyTable,
  collectTexts,
  LANG_NAME_ID,
  LANG_SHORT_ID,
  placeholders,
  readLangs,
  readXlsx,
  tableFromRows,
  tableOf,
  writeXlsx,
  type Sheet,
  type Table,
  type TextEntry,
} from './i18nTable';

const ROOT = process.cwd();
const STRINGS_FILE = 'src/ui/strings.ts';
const I18N_FILE = 'src/ui/i18n.ts';
const SHEET = 'texts';

/** Where a text is seen, by the first part of its id (a guide for whoever reads the table). */
const AREAS: Record<string, string> = {
  '@lang': '语言菜单 Language menu',
  header: '顶栏 Top bar',
  sidebar: '侧栏 Sidebar',
  start: '起始页 Start page',
  theme: '深浅色按钮 Theme button',
  appMode: '模式（顶栏） Modes',
  sec: '侧栏区块标题 Sidebar sections',
  workspace: '文件夹 Folder',
  batch: '批量处理 Batch',
  export: '导出 Export',
  figure: '出图（展示模式） Figures',
  compare: '比较模式 Compare mode',
  agree: '一致性表（比较模式） Agreement',
  field: '标本信息 Specimen',
  specimen: '标本信息 Specimen',
  status: '标注状态（视图左下角） Annotation status',
  mode: '工具条 Toolbar',
  tool: '工具条 Toolbar',
  hover: '选择工具的悬停提示 Hover tips',
  count: '计数 Counts',
  color: '箭头着色 Arrow colours',
  axis: '技术轴 Technical axis',
  arrows: '片疤箭头 Scar arrows',
  curves: '曲线 Curves',
  region: '区域 Regions',
  plane: '拟合平面 Planes',
  landmark: '地标 Landmarks',
  semi: '曲线半地标 Curve semilandmarks',
  relation: '打破关系 Relations',
  sequence: '剥片序列 Sequences',
  harris: 'Harris 矩阵 Harris matrix',
  measure: '测量 Measures',
  flake: '石片测量 Flake measures',
  edge: '刃角 Edge angles',
  edges: '刃缘 Working edges',
  retouch: '修理模式 Retouch',
  gm: '几何形态测量 GM',
  config: '体积构型（石核） Configuration',
  nodule: '石皮拟合球 Cortex sphere',
  split: '体积切分 Volume split',
  section: '截面 Sections',
  profile: '剖面面板 Profile panel',
  frame: '标本定向 Orientation',
  display: '显示面板 Display panel',
  shading: '显示面板 Display panel',
  snap: '吸附 Snapping',
  view: '视图按钮 View buttons',
  unit: '单位 Units',
  mesh: '模型信息 Model info',
  load: '载入进度 Loading',
  dlg: '对话框 Dialogs',
  toast: '提示消息 Messages',
  error: '错误 Errors',
  cmd: '撤销 / 重做的步骤名 Undo steps',
  help: '快捷键对话框 Shortcuts dialog',
  panel: '浮动面板 Floating panels',
  'fields.scar': '片疤属性 Scar attributes',
  'fields.curve': '曲线类型 Curve types',
  'fields.region': '区域类型 Region types',
};

/** What a translator needs to know about one text. */
const NOTES: Record<string, string> = {
  [LANG_NAME_ID]: '该语言自己的名称，用该语言写（语言菜单） The language’s name, in itself',
  [LANG_SHORT_ID]: '语言按钮上的 1–2 个字 1–2 characters on the language button',
};

const area = (id: string): string => AREAS[id.split('.').slice(0, 2).join('.')] ?? AREAS[id.split('.')[0]] ?? '';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function load(): { sources: Map<string, string>; entries: TextEntry[] } {
  const sources = new Map(sourceFiles('src').map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
  const entries = [...sources].flatMap(([f, text]) => collectTexts(f, text));
  const seen = new Map<string, TextEntry>();
  for (const e of entries) {
    const before = seen.get(e.id);
    if (before) throw new Error(`two texts with the id ${e.id} (${before.file}, ${e.file})`);
    seen.set(e.id, e);
  }
  return { sources, entries };
}

interface Issue {
  kind: string;
  id: string;
  detail: string;
}

/** What looks wrong in the texts and in their use. */
function check(sources: Map<string, string>, entries: TextEntry[], langs: string[]): Issue[] {
  const issues: Issue[] = [];
  const keys = new Set(entries.filter((e) => e.file === STRINGS_FILE).map((e) => e.id));
  const code = [...sources].filter(([f]) => f !== STRINGS_FILE).map(([, text]) => text);
  // texts: empty, spaces around, placeholders that differ from English, languages without a text
  for (const e of entries) {
    for (const l of langs) {
      const v = e.values[l];
      if (v === undefined || v.trim() === '') issues.push({ kind: l === 'en' || l === 'zh' ? '空白 empty' : '未翻译 untranslated', id: e.id, detail: l });
      else if (v !== v.trim()) issues.push({ kind: '首尾空格 spaces', id: e.id, detail: `${l}: “${v}”` });
    }
    const want = placeholders(e.values.en).join(' ');
    for (const [l, v] of Object.entries(e.values))
      if (placeholders(v).join(' ') !== want) issues.push({ kind: '占位符不一致 placeholders', id: e.id, detail: `${l}: ${placeholders(v).join(' ') || '—'} / en: ${want || '—'}` });
  }
  // keys the code asks for that are not in the table
  const asked = new Set<string>();
  for (const text of code) for (const m of text.matchAll(/\b(?:t|notify|hint)\(\s*(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) asked.add(m[2]);
  for (const k of asked) if (!keys.has(k)) issues.push({ kind: '缺少 missing', id: k, detail: 'used in the code, not in ui/strings.ts' });
  // keys no code names: whole, or by a prefix the key is put together from at run time
  // (`edge.method.${m}`, 'agree.' + group, or code('config.relation', v))
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  for (const text of code) {
    for (const m of text.matchAll(/(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) literals.add(m[2]);
    for (const m of text.matchAll(/`([A-Za-z][\w.-]*\.)\$\{/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/(['"])([A-Za-z][\w.-]*\.)\1\s*\+/g)) prefixes.add(m[2]);
  }
  for (const k of keys) {
    if (literals.has(k)) continue;
    const parts = k.split('.');
    if (parts.slice(2).some((_, i) => literals.has(parts.slice(0, i + 2).join('.')))) continue;
    if ([...prefixes].some((p) => k.startsWith(p))) continue;
    issues.push({ kind: '未用到？ unused?', id: k, detail: 'no code names it (it may be put together in a way this check does not see)' });
  }
  // the same English said two ways in Chinese, and the other way round
  for (const [a, b] of [
    ['en', 'zh'],
    ['zh', 'en'],
  ] as const) {
    const by = new Map<string, Map<string, string[]>>();
    for (const e of entries) {
      const from = e.values[a], to = e.values[b];
      if (!from || !to) continue;
      const m = by.get(from) ?? by.set(from, new Map()).get(from)!;
      (m.get(to) ?? m.set(to, []).get(to)!).push(e.id);
    }
    for (const [from, tos] of by)
      if (tos.size > 1)
        issues.push({
          kind: a === 'en' ? '同一英文、不同中文 same en' : '同一中文、不同英文 same zh',
          id: [...tos.values()].flat().join(', '),
          detail: `${from} → ${[...tos.keys()].join(' | ')}`,
        });
  }
  return issues;
}

function exportTable(out: string): void {
  const { sources, entries } = load();
  const { langs } = readLangs(sources.get(I18N_FILE)!);
  const table = tableOf(entries, langs);
  const issues = check(sources, entries, table.langs);
  const flags = new Map<string, string[]>();
  for (const i of issues) for (const id of i.id.split(', ')) (flags.get(id) ?? flags.set(id, []).get(id)!).push(i.kind.split(' ')[0]);
  const rows = [...table.rows].map(([id, values]) => {
    const notes = [NOTES[id], placeholders(values.en ?? '').length ? `保留 keep ${placeholders(values.en).join(' ')}` : ''].filter(Boolean).join('；');
    return [id, area(id), ...table.langs.map((l) => values[l] ?? ''), notes, (flags.get(id) ?? []).join('、'), ''];
  });
  const texts: Sheet = {
    name: SHEET,
    columns: [
      { header: 'id', width: 30, style: 'grey' },
      { header: '位置 where', width: 18, style: 'grey' },
      ...table.langs.map((l) => ({ header: l, width: 42 })),
      { header: '说明 notes', width: 24, style: 'grey' },
      { header: '检查 checks', width: 14, style: 'grey' },
      { header: '备注 comments', width: 30 },
    ],
    rows,
    freezeCols: 1,
    filter: true,
  };
  const checks: Sheet = {
    name: 'checks',
    columns: [
      { header: '类型 kind', width: 24, style: 'grey' },
      { header: 'id', width: 44, style: 'grey' },
      { header: '内容 detail', width: 90, style: 'grey' },
    ],
    rows: issues.map((i) => [i.kind, i.id, i.detail]),
    filter: true,
  };
  const readme: Sheet = {
    name: '说明 readme',
    columns: [{ header: 'LithicAnalyst 界面文本 Interface texts', width: 120 }],
    rows: README.map((l) => [l]),
  };
  mkdirSync(dirname(join(ROOT, out)), { recursive: true });
  writeFileSync(join(ROOT, out), writeXlsx([texts, checks, readme]));
  console.log(`${table.rows.size} texts in ${table.langs.join(', ')} → ${out}; ${issues.length} things to look at (sheet "checks")`);
}

const README = [
  '这张表由 npm run i18n -- export 从源代码生成；改好后用 npm run i18n -- import <文件> 写回源代码。',
  'Made from the sources by npm run i18n -- export; written back with npm run i18n -- import <file>.',
  '',
  '改文字：直接改 en、zh 等语言列里的单元格。不要改 id 列，不要删行；行的顺序可以随意排。',
  'To change a text: edit its cell in a language column. Keep the id column as it is and keep every row; rows can be sorted.',
  '',
  '加一种语言：在最后一个语言列后面插入一列，表头写语言代码（ja、ko、fr、de、es、ru、pt-BR、zh-TW……），',
  '前两行 @lang.name、@lang.short 写该语言自己的名称（如「日本語」）和语言按钮上的 1–2 个字（如「日」）。',
  '没填的格子在界面上显示英文，可以分几次译完。',
  'To add a language: insert a column after the last language, headed with its code; fill in @lang.name (its name in itself) and',
  '@lang.short (1–2 characters for the button). Cells left empty show English, so a language can be translated a part at a time.',
  '',
  '{n}、{name} 这样的花括号是程序填入的数字或名称：每种语言都要原样保留，可以挪位置。',
  'Words in braces, like {n} or {name}, are filled in by the program: keep them in every language (they may move).',
  '',
  '英文和中文不能留空。保持简短：界面只放标签，不写说明。',
  'English and Chinese cannot be left empty. Keep texts short: the interface has labels, not explanations.',
  '',
  '「检查 checks」列和 checks 表是自动检查的结果，仅供参考：占位符不一致、空白、同一英文对应不同中文（或反过来）、代码里没用到的文字等。',
  'The checks column and the checks sheet list what an automatic check found: placeholders, empty cells, one English text said two ways, texts no code uses.',
  '「备注 comments」列留给你写意见；导入时不读这一列。',
  'The comments column is yours; the import does not read it.',
  '',
  '保存为 .xlsx（Excel 或 WPS 都可以）。',
  'Save as .xlsx (Excel or WPS).',
];

function importTable(file: string, dry: boolean): void {
  const { sources, entries } = load();
  const table: Table = tableFromRows(readXlsx(new Uint8Array(readFileSync(file)), SHEET));
  const r = applyTable(table, sources, entries, I18N_FILE);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  if (r.errors.length) {
    for (const e of r.errors) console.error(`error: ${e}`);
    console.error(`${r.errors.length} errors: nothing written`);
    process.exitCode = 1;
    return;
  }
  const summary = Object.entries(r.changed).map(([l, n]) => `${l} ${n}`).join(', ') || 'nothing';
  console.log(`changed: ${summary}${r.added.length ? `; new languages: ${r.added.join(', ')}` : ''}`);
  for (const [f, text] of r.files) {
    console.log(`${dry ? 'would write' : 'writing'} ${relative(ROOT, join(ROOT, f)).replace(/\\/g, '/')}`);
    if (!dry) writeFileSync(join(ROOT, f), text);
  }
}

function checkOnly(): void {
  const { sources, entries } = load();
  const { langs } = readLangs(sources.get(I18N_FILE)!);
  const issues = check(sources, entries, tableOf(entries, langs).langs);
  for (const i of issues) console.log(`${i.kind}\t${i.id}\t${i.detail}`);
  console.log(`${entries.length} texts; ${issues.length} things to look at`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'export') exportTable(args[0] ?? 'i18n/texts.xlsx');
else if (cmd === 'import' && args[0]) importTable(args.find((a) => !a.startsWith('--'))!, args.includes('--dry'));
else if (cmd === 'check') checkOnly();
else {
  console.error('usage: npm run i18n -- export [file.xlsx] | import <file.xlsx> [--dry] | check');
  process.exitCode = 1;
}

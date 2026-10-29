import type { AttributeValue, LocalizedText } from './types';

/**
 * Fields recorded for every scar vector. The inspector, list summaries, colour
 * modes and CSV columns are all generated from this list, so adding a field
 * here is enough to carry it through the whole app.
 *
 * Enum values are the codes written to CSV and project files; keep them stable
 * once data exist. Labels can change freely.
 */

export interface FieldOption {
  value: string;
  label: LocalizedText;
  /** Compact label for the arrow list. */
  short?: LocalizedText;
}

export interface FieldDef {
  key: string;
  label: LocalizedText;
  type: 'enum' | 'text';
  options?: FieldOption[];
  default: AttributeValue;
  /** Number keys 1…n set this field on the selected arrow. */
  numberKeys?: boolean;
  /** Shift + number keys 1…n set this field on the selected arrow. */
  shiftNumberKeys?: boolean;
  /** When to show the value in the arrow list. */
  listSummary?: 'always' | 'nonDefault';
}

export const SCAR_FIELDS: FieldDef[] = [
  {
    key: 'completeness',
    label: { zh: '完整性', en: 'Completeness' },
    type: 'enum',
    default: 'point_complete',
    numberKeys: true,
    listSummary: 'always',
    options: [
      {
        value: 'point_complete',
        label: { zh: '可见打击点+尾端完整', en: 'Point of percussion + termination' },
        short: { zh: '打击点+尾端', en: 'Point + term.' },
      },
      {
        value: 'bulb_complete',
        label: { zh: '可见负向打击泡+尾端完整', en: 'Negative bulb + termination' },
        short: { zh: '负向泡+尾端', en: 'Bulb + term.' },
      },
      {
        value: 'proximal_missing',
        label: { zh: '打击点缺失+尾端完整', en: 'Proximal end missing + termination' },
        short: { zh: '仅尾端', en: 'Term. only' },
      },
      {
        value: 'point_truncated',
        label: { zh: '可见打击点+尾端缺失', en: 'Point of percussion, termination missing' },
        short: { zh: '仅打击点', en: 'Point only' },
      },
      {
        value: 'bulb_truncated',
        label: { zh: '可见负向打击泡+尾端缺失', en: 'Negative bulb, termination missing' },
        short: { zh: '仅负向泡', en: 'Bulb only' },
      },
      {
        value: 'both_missing',
        label: { zh: '两端缺失', en: 'Both ends missing' },
        short: { zh: '两端缺失', en: 'Neither end' },
      },
    ],
  },
  {
    // empty (null) until judged; `na` means looked at and there is no termination
    key: 'termination',
    label: { zh: '尾端形态', en: 'Termination' },
    type: 'enum',
    default: null,
    shiftNumberKeys: true,
    options: [
      { value: 'feather', label: { zh: '羽状', en: 'Feather' } },
      { value: 'step', label: { zh: '阶梯状', en: 'Step' } },
      { value: 'hinge', label: { zh: '铰链状', en: 'Hinge' } },
      { value: 'overshot', label: { zh: '过击', en: 'Overshot' } },
      { value: 'na', label: { zh: '缺失', en: 'NA' } },
    ],
  },
  {
    key: 'certainty',
    label: { zh: '方向可信度', en: 'Direction certainty' },
    type: 'enum',
    default: 'certain',
    listSummary: 'nonDefault',
    options: [
      { value: 'certain', label: { zh: '确定', en: 'Certain' } },
      { value: 'probable', label: { zh: '较确定', en: 'Probable' } },
      { value: 'uncertain', label: { zh: '不确定', en: 'Uncertain' } },
    ],
  },
  {
    key: 'note',
    label: { zh: '备注', en: 'Note' },
    type: 'text',
    default: '',
  },
];

/** Fields recorded for every traced curve; same rules as SCAR_FIELDS. */
export const CURVE_FIELDS: FieldDef[] = [
  {
    key: 'type',
    label: { zh: '类型', en: 'Type' },
    type: 'enum',
    default: 'other',
    numberKeys: true,
    listSummary: 'nonDefault',
    options: [
      { value: 'edge', label: { zh: '刃缘', en: 'Edge' } },
      { value: 'ridge', label: { zh: '棱脊', en: 'Ridge' } },
      { value: 'scar_boundary', label: { zh: '片疤边界', en: 'Scar boundary' } },
      { value: 'other', label: { zh: '其他', en: 'Other' } },
    ],
  },
  {
    key: 'note',
    label: { zh: '备注', en: 'Note' },
    type: 'text',
    default: '',
  },
];

/** Surface region types: scar (worked), cortex and joint surfaces (unworked), damage. Keys 1–4. */
export const REGION_FIELDS: FieldDef[] = [
  {
    key: 'type',
    label: { zh: '类型', en: 'Type' },
    type: 'enum',
    default: 'scar',
    numberKeys: true,
    listSummary: 'always',
    options: [
      { value: 'scar', label: { zh: '片疤', en: 'Scar' } },
      { value: 'cortex', label: { zh: '石皮', en: 'Cortex' } },
      { value: 'joint', label: { zh: '节理面', en: 'Joint surface' } },
      { value: 'damage', label: { zh: '破损', en: 'Damage' } },
    ],
  },
];

export const REGION_TYPES = ['scar', 'cortex', 'joint', 'damage'] as const;

function defaultsOf(fields: FieldDef[]): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const f of fields) out[f.key] = f.default;
  return out;
}

export const defaultAttributes = (): Record<string, AttributeValue> => defaultsOf(SCAR_FIELDS);

export const defaultCurveAttributes = (): Record<string, AttributeValue> => defaultsOf(CURVE_FIELDS);

export const fieldByKey = (key: string): FieldDef | undefined => SCAR_FIELDS.find((f) => f.key === key);

export const curveFieldByKey = (key: string): FieldDef | undefined => CURVE_FIELDS.find((f) => f.key === key);

/** The enum field that number keys 1…n set on the selected item. */
export const numberKeyField = (fields: FieldDef[] = SCAR_FIELDS): FieldDef | undefined =>
  fields.find((f) => f.numberKeys && f.type === 'enum' && f.options?.length);

/** The enum field that Shift + number keys 1…n set on the selected item. */
export const shiftNumberKeyField = (fields: FieldDef[] = SCAR_FIELDS): FieldDef | undefined =>
  fields.find((f) => f.shiftNumberKeys && f.type === 'enum' && f.options?.length);

/** Completeness codes without a termination: the termination is then `na`, and stays so. */
export const TERMINATION_MISSING: readonly string[] = ['point_truncated', 'bulb_truncated', 'both_missing'];

/** The field cannot be set by hand (the termination of a scar whose termination is missing). */
export const fieldLocked = (attributes: Readonly<Record<string, AttributeValue>>, key: string): boolean =>
  key === 'termination' && TERMINATION_MISSING.includes(String(attributes.completeness));

/**
 * The attributes with one field set, and the fields that follow from it: a
 * completeness without a termination sets the termination to `na`; back to one
 * with a termination, an `na` termination is cleared (not judged yet). Null
 * when the field is locked to another value.
 */
export function withAttribute(attributes: Readonly<Record<string, AttributeValue>>, key: string, value: AttributeValue): Record<string, AttributeValue> | null {
  if (fieldLocked(attributes, key) && value !== 'na') return null;
  const out = { ...attributes, [key]: value };
  if (key === 'completeness') {
    if (TERMINATION_MISSING.includes(String(value))) out.termination = 'na';
    else if (out.termination === 'na') out.termination = null;
  }
  return out;
}

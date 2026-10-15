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

export function defaultAttributes(): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const f of SCAR_FIELDS) out[f.key] = f.default;
  return out;
}

export const fieldByKey = (key: string): FieldDef | undefined => SCAR_FIELDS.find((f) => f.key === key);

export const numberKeyField = (): FieldDef | undefined =>
  SCAR_FIELDS.find((f) => f.numberKeys && f.type === 'enum' && f.options?.length);

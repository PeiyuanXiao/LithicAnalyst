import type { AttributeValue, LocalizedText } from './types';

/**
 * Fields recorded for every scar vector. The inspector, list summaries, colour
 * modes and CSV columns are all generated from this list, so adding a field
 * here is enough to carry it through the whole app.
 *
 * Enum values are the codes written to CSV and project files; keep them stable
 * once data exist. Labels can change freely.
 */

/** What a specimen is. Written to project files; keep the codes. */
export const SPECIMEN_TYPES = ['core', 'flake', 'generic'] as const;
export type SpecimenType = (typeof SPECIMEN_TYPES)[number];

export interface FieldOption {
  value: string;
  label: LocalizedText;
  /** Compact label for the arrow list. */
  short?: LocalizedText;
  /** Read from older files and shown with its label, but no longer offered. */
  legacy?: boolean;
  /** Offered only for these types of specimen (shown, not offered, for the others). */
  types?: readonly SpecimenType[];
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
  /** Besides its options, the user's own text (stored as the value); the number key after the options asks for it. */
  allowCustom?: boolean;
}

export const SCAR_FIELDS: FieldDef[] = [
  {
    key: 'completeness',
    label: { zh: '完整性', en: 'Completeness', it: 'Completezza', fr: 'Complétude' },
    type: 'enum',
    default: 'point_complete',
    numberKeys: true,
    listSummary: 'always',
    options: [
      {
        value: 'point_complete',
        label: { zh: '可见打击点+尾端完整', en: 'Point of percussion + termination', it: 'Punto d’impatto + terminazione', fr: 'Point d’impact + terminaison' },
        short: { zh: '打击点+尾端', en: 'Point + term.', it: 'Impatto + term.', fr: 'Impact + term.' },
      },
      {
        value: 'bulb_complete',
        label: { zh: '可见负向打击泡+尾端完整', en: 'Negative bulb + termination', it: 'Controbulbo + terminazione', fr: 'Contre-bulbe + terminaison' },
        short: { zh: '负向泡+尾端', en: 'Bulb + term.', it: 'Controb. + term.', fr: 'Contre-b. + term.' },
      },
      {
        value: 'proximal_missing',
        label: { zh: '打击点缺失+尾端完整', en: 'Proximal end missing + termination', it: 'Estremità prossimale mancante + terminazione', fr: 'Extrémité proximale manquante + terminaison' },
        short: { zh: '仅尾端', en: 'Term. only', it: 'Solo term.', fr: 'Term. seule' },
      },
      {
        value: 'point_truncated',
        label: { zh: '可见打击点+尾端缺失', en: 'Point of percussion, termination missing', it: 'Punto d’impatto, terminazione mancante', fr: 'Point d’impact, terminaison manquante' },
        short: { zh: '仅打击点', en: 'Point only', it: 'Solo impatto', fr: 'Impact seul' },
      },
      {
        value: 'bulb_truncated',
        label: { zh: '可见负向打击泡+尾端缺失', en: 'Negative bulb, termination missing', it: 'Controbulbo, terminazione mancante', fr: 'Contre-bulbe, terminaison manquante' },
        short: { zh: '仅负向泡', en: 'Bulb only', it: 'Solo controb.', fr: 'Contre-b. seul' },
      },
      {
        value: 'both_missing',
        label: { zh: '两端缺失', en: 'Both ends missing', it: 'Entrambe le estremità mancanti', fr: 'Deux extrémités manquantes' },
        short: { zh: '两端缺失', en: 'Neither end', it: 'Nessuna estremità', fr: 'Aucune extrémité' },
      },
    ],
  },
  {
    // empty (null) until judged; `na` means looked at and there is no termination
    key: 'termination',
    label: { zh: '尾端形态', en: 'Termination', it: 'Terminazione', fr: 'Terminaison' },
    type: 'enum',
    default: null,
    shiftNumberKeys: true,
    options: [
      { value: 'feather', label: { zh: '羽状', en: 'Feather', it: 'A piuma', fr: 'En plume' } },
      { value: 'step', label: { zh: '阶梯状', en: 'Step', it: 'A gradino', fr: 'Rebroussée' } },
      { value: 'hinge', label: { zh: '铰链状', en: 'Hinge', it: 'Riflessa', fr: 'Réfléchie' } },
      { value: 'overshot', label: { zh: '过击', en: 'Overshot', it: 'Sorpassata', fr: 'Outrepassée' } },
      { value: 'na', label: { zh: '缺失', en: 'NA', it: 'N/D', fr: 'N/D' } },
    ],
  },
  {
    key: 'certainty',
    label: { zh: '方向可信度', en: 'Direction certainty', it: 'Affidabilità della direzione', fr: 'Fiabilité de la direction' },
    type: 'enum',
    default: 'certain',
    listSummary: 'nonDefault',
    options: [
      { value: 'certain', label: { zh: '确定', en: 'Certain', it: 'Certa', fr: 'Certaine' } },
      { value: 'probable', label: { zh: '较确定', en: 'Probable', it: 'Probabile', fr: 'Probable' } },
      { value: 'uncertain', label: { zh: '不确定', en: 'Uncertain', it: 'Incerta', fr: 'Incertaine' } },
    ],
  },
  {
    key: 'note',
    label: { zh: '备注', en: 'Note', it: 'Nota', fr: 'Note' },
    type: 'text',
    default: '',
  },
];

/** Fields recorded for every traced curve; same rules as SCAR_FIELDS. */
export const CURVE_FIELDS: FieldDef[] = [
  {
    key: 'type',
    label: { zh: '类型', en: 'Type', it: 'Tipo', fr: 'Type' },
    type: 'enum',
    // not filled in until chosen
    default: '',
    numberKeys: true,
    listSummary: 'always',
    allowCustom: true,
    options: [
      { value: 'scar_boundary', label: { zh: '片疤轮廓', en: 'Scar outline', it: 'Contorno del negativo', fr: 'Contour du négatif' } },
      { value: 'core_edge', label: { zh: '石核边缘', en: 'Core edge', it: 'Margine del nucleo', fr: 'Bord du nucléus' }, types: ['core'] },
      { value: 'edge', label: { zh: '石片边缘', en: 'Flake edge', it: 'Margine della scheggia', fr: 'Bord de l’éclat' }, types: ['flake'] },
      { value: 'cortex', label: { zh: '石皮', en: 'Cortex', it: 'Cortice', fr: 'Cortex' } },
      { value: 'joint', label: { zh: '节理面', en: 'Joint surface', it: 'Superficie di diaclasi', fr: 'Surface de diaclase' } },
      { value: 'platform_outline', label: { zh: '台面轮廓', en: 'Platform outline', it: 'Contorno del tallone', fr: 'Contour du talon' }, types: ['flake'] },
      { value: 'retouch', label: { zh: '修理', en: 'Retouch', it: 'Ritocco', fr: 'Retouche' } },
      // older codes: read and written as they are
      { value: 'ridge', label: { zh: '棱脊', en: 'Ridge', it: 'Nervatura', fr: 'Nervure' }, legacy: true },
      { value: 'other', label: { zh: '其他', en: 'Other', it: 'Altro', fr: 'Autre' }, legacy: true },
    ],
  },
  {
    key: 'note',
    label: { zh: '备注', en: 'Note', it: 'Nota', fr: 'Note' },
    type: 'text',
    default: '',
  },
];

/** The curve that outlines a flake's platform (one per flake, closed). */
export const PLATFORM_OUTLINE = 'platform_outline';

/** Whether a curve of this type bounds the upper layer of regions: a flake's edge and platform outline, a core's edges; a generic specimen has no upper layer. */
export const isBoundaryCurve = (type: AttributeValue | undefined, specimen: SpecimenType): boolean =>
  specimen === 'flake' ? type === 'edge' || type === PLATFORM_OUTLINE : specimen === 'core' && type === 'core_edge';

/** Which curves cut each layer of regions: the lower layer along all of them, the upper along the boundary curves alone. */
export const layerCurves = <T extends { attributes: Readonly<Record<string, AttributeValue>> }>(curves: readonly T[], specimen: SpecimenType): { lower: T[]; upper: T[] } => ({
  lower: [...curves],
  upper: curves.filter((c) => isBoundaryCurve(c.attributes.type, specimen)),
});

/**
 * Surface region types. The lower layer: scar (worked), cortex and joint surfaces (unworked), damage, retouch, or the
 * user's own text. The upper layer, parts of the specimen that lower regions lie in: a core's flaking surfaces
 * and platforms; a flake's platform, ventral and dorsal faces. The user's own text is always the last choice.
 */
export const REGION_FIELDS: FieldDef[] = [
  {
    key: 'type',
    label: { zh: '类型', en: 'Type', it: 'Tipo', fr: 'Type' },
    type: 'enum',
    default: 'scar',
    numberKeys: true,
    listSummary: 'always',
    allowCustom: true,
    options: [
      { value: 'scar', label: { zh: '片疤', en: 'Scar', it: 'Negativo', fr: 'Négatif' } },
      { value: 'cortex', label: { zh: '石皮', en: 'Cortex', it: 'Cortice', fr: 'Cortex' } },
      { value: 'joint', label: { zh: '节理面', en: 'Joint surface', it: 'Superficie di diaclasi', fr: 'Surface de diaclase' } },
      { value: 'damage', label: { zh: '破损', en: 'Damage', it: 'Danneggiamento', fr: 'Endommagement' } },
      { value: 'flaking_surface', label: { zh: '剥片面', en: 'Flaking surface', it: 'Superficie di scheggiatura', fr: 'Surface de débitage' }, types: ['core'] },
      { value: 'platform', label: { zh: '台面', en: 'Platform', it: 'Piano di percussione / tallone', fr: 'Plan de frappe / talon' } },
      { value: 'ventral', label: { zh: '腹面', en: 'Ventral face', it: 'Faccia ventrale', fr: 'Face ventrale' }, types: ['flake'] },
      { value: 'dorsal', label: { zh: '背面', en: 'Dorsal face', it: 'Faccia dorsale', fr: 'Face dorsale' }, types: ['flake'] },
      { value: 'retouch', label: { zh: '修理', en: 'Retouch', it: 'Ritocco', fr: 'Retouche' } },
    ],
  },
];

export const REGION_TYPES = ['scar', 'cortex', 'joint', 'damage', 'flaking_surface', 'platform', 'ventral', 'dorsal', 'retouch'] as const;

/** What a new region of a generic specimen is until the user says: free text like any other, since a region has a type. */
export const GENERIC_REGION_TYPE = 'region';

/** The retouch layers on offer; 1 is the nearest the edge. */
export const RETOUCH_LAYERS = [1, 2, 3, 4, 5] as const;

/** The region types of the upper layer (bounded by the boundary curves alone, so lower regions lie inside them). */
export const UPPER_REGION_TYPES: readonly string[] = ['flaking_surface', 'platform', 'ventral', 'dorsal'];
export const isUpperRegion = (type: string, specimen: SpecimenType = 'core'): boolean => specimen !== 'generic' && UPPER_REGION_TYPES.includes(type);

/** Edge angles and working edges belong to flakes. On another type their data stay in the file and nothing of them shows or is computed. */
export const hasEdgeAngles = (specimen: SpecimenType): boolean => specimen === 'flake';

/** The volume split and its upper and lower volumes belong to cores (the bicone stands on it); the same holds. */
export const hasVolumeSplit = (specimen: SpecimenType): boolean => specimen === 'core';

/** Whether a curve's edge angles are measured: only on a flake; as the user said, else an edge is (a core's too, when its specimen has become a flake, so what it measured still shows). */
export const measuresEdgeAngle = (c: { edgeAngle?: boolean; attributes: Readonly<Record<string, AttributeValue>> }, specimen: SpecimenType): boolean =>
  hasEdgeAngles(specimen) && (c.edgeAngle ?? (c.attributes.type === 'edge' || c.attributes.type === 'core_edge'));

/**
 * Volumetric configuration of a core (after the Logical Analytical System): the
 * six faces of its box, their roles, and the codes of the results. These codes
 * are written to project files and CSV; keep them. Labels are in ui/strings.ts.
 */
export const CONFIG_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type ConfigFace = (typeof CONFIG_FACES)[number];
/** In the order the interface shows them. */
export const CONFIG_ROLES = ['flaking', 'platform', 'both', 'none'] as const;
export type ConfigRole = (typeof CONFIG_ROLES)[number];
export const FACIAL_CHARACTERS = ['unifacial', 'bifacial', 'multifacial'] as const;
export type FacialCharacter = (typeof FACIAL_CHARACTERS)[number];
export const FACE_RELATIONS = ['opposite', 'adjacent', 'mixed'] as const;
export type FaceRelation = (typeof FACE_RELATIONS)[number];
export const PLATFORM_RELATIONS = ['peripheral', 'single', ...FACE_RELATIONS] as const;
export type PlatformRelation = (typeof PLATFORM_RELATIONS)[number];
export const POLARITIES = ['unipolar_longitudinal', 'bipolar_opposed', 'bipolar_orthogonal', 'multipolar_centripetal', 'multipolar_orthogonal', 'multipolar_multidirectional'] as const;
export type Polarity = (typeof POLARITIES)[number];
/** `unclear`: automatic only (the box is too even to tell). */
export const SURFACE_TYPES = ['wide', 'narrow', 'unclear'] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];
/** `na`: automatic only (centripetal, or no platforms on one axis). */
export const EXPLOITATION_AXES = ['long', 'short', 'na'] as const;
export type ExploitationAxis = (typeof EXPLOITATION_AXES)[number];
/** The model of the configuration: the box (six faces) or the bicone (two cones on the split curve). */
export const CONFIG_MODELS = ['box', 'bicone'] as const;
export type ConfigModel = (typeof CONFIG_MODELS)[number];
/** The bicone's cones, upper first (`faces` in flaking_surfaces.csv). */
export const BICONE_CONES = ['upper', 'lower'] as const;
export type BiconeCone = (typeof BICONE_CONES)[number];
/** Physical sides of the bicone: the side the split curve's normal points to (by its `upHint`), and the other. */
export const BICONE_SIDES = ['positive', 'negative'] as const;
export type BiconeSide = (typeof BICONE_SIDES)[number];
/** In the order the interface shows them. */
export const BICONE_ROLES = ['flaking', 'none'] as const;
export type BiconeRole = (typeof BICONE_ROLES)[number];

function defaultsOf(fields: FieldDef[]): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const f of fields) out[f.key] = f.default;
  return out;
}

export const defaultAttributes = (): Record<string, AttributeValue> => defaultsOf(SCAR_FIELDS);

export const defaultCurveAttributes = (): Record<string, AttributeValue> => defaultsOf(CURVE_FIELDS);

export const fieldByKey = (key: string): FieldDef | undefined => SCAR_FIELDS.find((f) => f.key === key);

export const curveFieldByKey = (key: string): FieldDef | undefined => CURVE_FIELDS.find((f) => f.key === key);

/** The options offered for picking on this type of specimen (not those kept only for older files or for another type); a generic specimen has only the user's own text where a field takes it. */
export const offeredOptions = (f: FieldDef, type: SpecimenType = 'core'): FieldOption[] =>
  (f.options ?? []).filter((o) => !o.legacy && (o.types ? o.types.includes(type) : type !== 'generic' || !f.allowCustom));

/** What the number keys 1, 2, … pick on this type of specimen: its options and, always last, "custom" (a field that takes the user's own text). */
export function keyedOptions(f: FieldDef, type: SpecimenType = 'core'): Array<FieldOption | 'custom'> {
  const offered = offeredOptions(f, type);
  return f.allowCustom ? [...offered, 'custom'] : offered;
}

/** A value of a field that takes the user's own text, as that text: not empty and none of its codes. */
export const isCustomValue = (f: FieldDef, v: AttributeValue | undefined): v is string =>
  !!f.allowCustom && typeof v === 'string' && v !== '' && !(f.options ?? []).some((o) => o.value === v);

/** What to store for the user's own text: trimmed; an offered option's code when it is that code or one of its labels (any case). */
export function customValue(f: FieldDef, text: string, type: SpecimenType = 'core'): string {
  const s = text.trim();
  const low = s.toLowerCase();
  const preset = offeredOptions(f, type).find((o) => [o.value, ...Object.values(o.label)].some((x) => x?.toLowerCase() === low));
  return preset ? preset.value : s;
}

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

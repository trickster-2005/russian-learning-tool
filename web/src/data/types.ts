export type Pos = "NOUN" | "VERB" | "ADJ" | "ADV" | "NUM" | "PRON" | "FUNC" | "OTHER";
export type MorphType = "PREF" | "ROOT" | "SUFF" | "END" | "POSTFIX" | "LINK" | "HYPH";
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "beyond";
export const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2", "beyond"];
export const POS_LIST: Pos[] = ["NOUN", "VERB", "ADJ", "ADV", "NUM", "PRON", "FUNC", "OTHER"];

export interface FamilyNode {
  id: string;
  lemma: string;
  key?: string;
  pos: Pos;
  is_path_node: boolean;
}

export interface FamilyEdge {
  parent: string;
  child: string;
  added_prefixes: string[];
  added_suffixes: string[];
  added_postfixes: string[];
  root_alternation: boolean;
  pos_change: string;
  semantic_type: string | null;
}

export interface CrossLink {
  from: string;
  family_id: string;
  lemma: string;
  key: string;
}

export interface RelatedFamily {
  id: string;
  root_lemma: string;
  label: string;
}

export interface Family {
  id: string;
  root_lemma: string;
  nodes: FamilyNode[];
  edges: FamilyEdge[];
  cross_links: CrossLink[];
  related_families: RelatedFamily[];
}

export interface Morpheme {
  text: string;
  type: MorphType;
}

export interface Features {
  gender?: string;
  animacy?: string;
  aspect?: string;
  reflexive?: boolean;
  transitivity?: string;
  motion_verb?: boolean;
}

export interface Gloss {
  text: string;
  source: string;
}

export interface LexEntry {
  lemma: string;
  pos: Pos;
  stressed: string;
  stress_source: string;
  segmentation: { morphemes: Morpheme[]; source: string; confidence: number; uncertain: boolean } | null;
  features: Features;
  gloss_en: Gloss | null;
  gloss_zh: Gloss | null;
  freq_stars: number;
  zipf: number;
  lexicalized_participle: boolean;
  verb_forms?: { participles: string[]; gerunds: string[] };
  family_id: string;
  is_path_node?: boolean;
}

export interface Meta {
  built: string;
  stats: Record<string, number>;
  lexicon_shards: string[];
  forms_shards: string[];
  example_shards: string[];
  semantic_types: string[];
  pos_changes: string[];
  estimate_medians: Record<string, number>;
}

export interface Example {
  ru: string;
  en: string;
  form: string;
}

export interface AffixEntry {
  affix: string;
  variants?: string[];
  meaning_en: string;
  meaning_zh: string;
  examples?: string[];
  input_pos?: Pos | Pos[];
  output_pos?: Pos;
  semantic_type?: string;
}

export interface AffixTable {
  prefixes: AffixEntry[];
  suffixes: AffixEntry[];
  postfixes: AffixEntry[];
}

/** Compact lexicon summary row: [pos, stars, gender, animacy, aspect, refl, trans, motion, uncertain] */
export type SummaryRow = [Pos, number, string, string, string, 0 | 1, string, 0 | 1, 0 | 1];

/** families_index member row: [key, parentIndex, pos_change, semantic_type, "affix|affix"] */
export type MemberRow = [string, number, string, string, string];

export interface FamilyIndexEntry {
  id: string;
  root_lemma: string;
  root_key: string;
  size: number;
  pos_counts: Record<string, number>;
  pos_changes: Record<string, number>;
  affixes: Record<string, number>;
  root_morph: string | null;
  members: MemberRow[];
}

export interface Topics {
  lemmas: Record<string, string[]>;
  topics: Record<string, { en: string }>;
}

export type LevelMaps = { kelly: Record<string, Level>; smartool: Record<string, Level>; estimated: Record<string, Level> };

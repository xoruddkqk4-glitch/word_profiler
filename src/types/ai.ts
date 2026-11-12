export type ApiKeyStorageMode = 'session' | 'local';

export type InspectorBodyTab = 'ai' | 'ignore';

export type SettingsSectionId = 'display' | 'word' | 'ai';

export interface OpenRouterConfig {
  apiKey: string;
  storageMode: ApiKeyStorageMode;
  modelId: string;
}

export interface RecommendedModelOption {
  id: string;
  label: string;
}

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.8-flash';

/**
 * Model ids that OpenRouter no longer serves under these slugs.
 * Still-valid older presets (e.g. gemini-2.5-flash, gpt-4o-mini) are kept.
 */
export const RETIRED_OPENROUTER_MODELS: readonly string[] = [
  'anthropic/claude-3.5-haiku',
];

// Slugs verified against https://openrouter.ai/api/v1/models (2026-11-12).
export const RECOMMENDED_OPENROUTER_MODELS: RecommendedModelOption[] = [
  {
    id: 'google/gemini-3.8-flash',
    label: 'Google: Gemini 3.8 Flash (빠름 · 권장)',
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'OpenAI: GPT-6 Luna (저비용)',
  },
  {
    id: 'anthropic/claude-haiku-5.5',
    label: 'Anthropic: Claude Haiku 5.5 (저비용)',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    label: 'DeepSeek: DeepSeek V4.1 Flash (저비용)',
  },
  {
    id: 'qwen/qwen3.8-flash',
    label: 'Qwen: Qwen3.8 Flash (저비용)',
  },
  {
    id: 'x-ai/grok-4.7',
    label: 'xAI: Grok 4.7',
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    label: 'Anthropic: Claude Sonnet 5.5 (고품질)',
  },
  {
    id: 'openai/gpt-6.1-terra',
    label: 'OpenAI: GPT-6.1 Terra (고품질)',
  },
  {
    id: 'google/gemini-4-argon',
    label: 'Google: Gemini 4 Argon (고품질)',
  },
];

export interface TokenSpanSelection {
  /** 0-based inclusive start index into DocumentProfileResult.tokens */
  startTokenIdx: number;
  /** 0-based inclusive end index into DocumentProfileResult.tokens */
  endTokenIdx: number;
  /** Exact surface substring from start token through end token */
  rawText: string;
}

export interface VerifiedLexiconStatus {
  inActiveList: boolean;
  withinTargetCap: boolean;
  kind: 'level' | 'ignored' | 'out';
  statLevelNumber: number | null;
  activeLevelIndex: number;
  listId: string | null;
  listName: string;
  headword: string;
  inBuiltinMasterFamily: boolean;
  masterHeadword: string | null;
  inactiveListMatchName: string | null;
}

export type MorphRelationKind =
  | 'lemma'
  | 'derivational_base'
  | 'root'
  | 'family_member'
  | 'compound_part';

export interface VerifiedMorphCandidate {
  form: string;
  relation: MorphRelationKind;
  relationLabelKo: string;
  noteKo: string;
  status: VerifiedLexiconStatus;
}

export interface MorphologyAnalysisResult {
  targetToken: string;
  enclosingSentence: string;
  contextPos: string;
  explanationKo: string;
  candidates: VerifiedMorphCandidate[];
}

export interface VerifiedSynonymCandidate {
  replacementText: string;
  baseForm: string;
  meaningKo: string;
  nuanceKo: string;
  isMultiWord: boolean;
  allTokensWithinCap: boolean;
  allTokensInActiveLists: boolean;
  highestLevelNumber: number | null;
  primaryListId: string | null;
  primaryListName: string;
  primaryLevelIndex: number;
  previewSentence: string;
}

export interface AuditedMiniToken {
  token: string;
  trailingWs: string;
  withinCap: boolean;
  kind: 'level' | 'ignored' | 'out';
  activeLevelIndex: number;
  listId: string | null;
  listName: string;
  statLevelNumber: number;
}

export interface VerifiedParaphraseCandidate {
  styleLabelKo: string;
  rewrittenText: string;
  noteKo: string;
  tokens: AuditedMiniToken[];
  leadingWs: string;
  remainingOutWords: string[];
  outWordCount: number;
  totalTokens: number;
  inTargetPercentage: number;
}

/** Combined AI suggestion payload shown in the recommendation modal. */
export interface CombinedSuggestionResult {
  /** Surface text of the selected word or expression. */
  targetText: string;
  spanStartIdx: number;
  spanEndIdx: number;
  enclosingSentence: string;
  targetMaxLevel: number;
  /** Original document text of the profile that produced this result. */
  sourceOriginalText: string;
  /** Source id of the profile (`__inline__` or file id). */
  sourceId: string;
  synonymCandidates: VerifiedSynonymCandidate[];
  paraphraseCandidates: VerifiedParaphraseCandidate[];
  paraphraseSpanStartIdx: number;
  paraphraseSpanEndIdx: number;
  repaired: boolean;
}


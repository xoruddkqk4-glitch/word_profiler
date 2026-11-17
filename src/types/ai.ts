export type ApiKeyStorageMode = 'session' | 'local';

export type AiProviderId = 'gemini' | 'openrouter';

export type InspectorBodyTab = 'ai' | 'ignore';

export type SettingsSectionId = 'display' | 'word' | 'ai';

export interface OpenRouterConfig {
  provider?: AiProviderId;
  apiKey: string;
  storageMode: ApiKeyStorageMode;
  modelId: string;
  geminiApiKey?: string;
  geminiModelId?: string;
}

export interface RecommendedModelOption {
  id: string;
  label: string;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_OVERLOAD_FALLBACK_MODELS: readonly string[] = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest',
];

export const RECOMMENDED_GEMINI_MODELS: RecommendedModelOption[] = [
  {
    id: 'gemini-3.8-flash',
    label: 'Google: Gemini 3.8 Flash (빠름 · 무료 티어 권장)',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Google: Gemini 3.5 Flash-Lite (초고속 · 혼잡 적음 · 무료 한도 넉넉함)',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Google: Gemini Flash Latest (최신 안정 Flash 자동 연결)',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Google: Gemini 2.5 Flash (안정 호환 · 무료 지원)',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Google: Gemini 4 Hydrogen (차세대 고속 · 고성능)',
  },
  {
    id: 'gemini-4-argon',
    label: 'Google: Gemini 4 Argon (고품질 정밀 분석)',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Google: Gemini 2.5 Flash-Lite (경량 호환)',
  },
];

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

export function normalizeGeminiModelId(raw: string | null | undefined): string {
  const cleaned = (typeof raw === 'string' ? raw : '')
    .trim()
    .replace(/^(?:models\/|google\/)/i, '');
  return cleaned || DEFAULT_GEMINI_MODEL;
}

export function getActiveAiProvider(config: OpenRouterConfig): AiProviderId {
  return config.provider === 'gemini' ? 'gemini' : 'openrouter';
}

export function getActiveAiApiKey(config: OpenRouterConfig): string {
  return getActiveAiProvider(config) === 'gemini'
    ? (config.geminiApiKey ?? '').trim()
    : config.apiKey.trim();
}

export function getActiveAiModelId(config: OpenRouterConfig): string {
  return getActiveAiProvider(config) === 'gemini'
    ? normalizeGeminiModelId(config.geminiModelId)
    : config.modelId.trim() || DEFAULT_OPENROUTER_MODEL;
}

export function hasActiveAiApiKey(config: OpenRouterConfig): boolean {
  return Boolean(getActiveAiApiKey(config));
}

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

export type AiSuggestionTrackFilter = 'all' | 'in_list' | 'free';

export interface VerifiedSynonymCandidate {
  replacementText: string;
  baseForm: string;
  meaningKo: string;
  nuanceKo: string;
  isMultiWord: boolean;
  allTokensWithinCap: boolean;
  allTokensInActiveLists: boolean;
  outTokens: string[];
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
  /** Group A: up to 3 replacement words strictly inside active Word Lists. */
  inListSynonymCandidates: VerifiedSynonymCandidate[];
  /** Group B: up to 3 natural replacement words allowed outside Word Lists. */
  freeSynonymCandidates: VerifiedSynonymCandidate[];
  /** Group C: up to 3 paraphrases prioritizing 100% active Word List coverage. */
  inListParaphraseCandidates: VerifiedParaphraseCandidate[];
  /** Group D: up to 3 natural paraphrases freely including out-of-list vocabulary. */
  freeParaphraseCandidates: VerifiedParaphraseCandidate[];
  /** Backward-compatible alias equal to `inListSynonymCandidates`. */
  synonymCandidates: VerifiedSynonymCandidate[];
  /** Backward-compatible alias equal to `inListParaphraseCandidates`. */
  paraphraseCandidates: VerifiedParaphraseCandidate[];
  paraphraseSpanStartIdx: number;
  paraphraseSpanEndIdx: number;
  repaired: boolean;
}

export interface BilingualSentencePair {
  /** 0-based sentence unit index */
  index: number;
  /** English sentence unit */
  en: string;
  /** Corresponding Korean translation (1 sentence, or 2 sentences when split for naturalness) */
  ko: string;
  /** 0-based paragraph index so paragraph breaks match between left and right panes */
  paragraphIndex: number;
}

export interface SavedPassageTranslation {
  /** Clean English passage text at the time the translation was saved */
  sourceEnglishText: string;
  /** 1:1 aligned English-Korean sentence pairs */
  pairs: BilingualSentencePair[];
  /** Paragraph-formatted Korean full text saved under [우리말 해석] in .txt files */
  koreanFullText: string;
  /** Epoch ms when saved/updated */
  updatedAt: number;
  /** Provider/model label or '파일에서 불러옴' */
  modelLabel?: string;
}


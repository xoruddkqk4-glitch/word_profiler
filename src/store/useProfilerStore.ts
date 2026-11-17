import { create } from 'zustand';
import {
  analyzeMorphologyAndRoots,
  suggestReplacementsAndParaphrases,
} from '../ai/lexicalAssistantService';
import {
  buildReplacedDocumentText,
  getVerifierContext,
  sanitizeSingleTokenReplacement,
  sliceProfileSpanText,
} from '../ai/lexiconVerifier';
import {
  clearGeminiApiKey,
  clearOpenRouterApiKey,
  loadOpenRouterConfig,
  saveOpenRouterConfig,
} from '../ai/openRouterClient';
import {
  DEFAULT_IGNORE_COLOR,
  DEFAULT_OUT_HIGHLIGHT_COLOR,
  ensureReadableOnDark,
  ensureReadableOnLight,
  getDefaultLevelColorPair,
  type LevelColorPair,
} from '../core/colorPalette';
import {
  isManifestEntryLoaded,
  parseRawFamilyGroups,
} from '../core/wordlistParser';
import {
  parsePassageSet,
  updatePassageContentAt,
  type PassageItem,
} from '../core/passageSetParser';
import {
  getActiveAiModelId,
  getActiveAiProvider,
  hasActiveAiApiKey,
  type CombinedSuggestionResult,
  type InspectorBodyTab,
  type MorphologyAnalysisResult,
  type OpenRouterConfig,
  type SettingsSectionId,
  type TokenSpanSelection,
} from '../types/ai';
import type {
  AuxiliaryListState,
  CoverageWordItem,
  DocumentProfileResult,
  DuplicateEntryRecord,
  MainTabId,
  ProfilerSettings,
  ReferenceListSource,
  StatsSubTabId,
  TargetFileItem,
  WordlistManifest,
} from '../types/domain';
import type { CorpusStatisticsBundle } from '../types/stats';
import { profilerWorkerClient } from '../workers/workerClient';

export const DEFAULT_SETTINGS: ProfilerSettings = {
  tokenDefinition: '[\\p{L}]+',
  ignoreCase: true,
  showLevels: true,
  defaultTab: 'profiler',
  nationFormat: 'auto',
  stripCurriculumAnnotations: true,
  fontSizePx: 18,
  showFullPathsInStats: false,
};

export const SAMPLE_ENGLISH_PASSAGE = `Language learning depends heavily on vocabulary knowledge. Research in applied linguistics demonstrates that readers generally need to recognize between ninety-five and ninety-eight percent of the running words in a passage to achieve adequate comprehension without external assistance.

When educators design reading materials for elementary or secondary classrooms, lexical profiling helps identify unfamiliar academic terminology before instruction begins. By comparing target texts against graded curriculum word families, teachers can decide which items merit explicit instruction, which words learners can infer from context, and where simplified phrasing may improve accessibility.`;

const STORAGE_KEY = 'antwordprofiler_web_prefs_v1';
const PREFS_SCHEMA_VERSION = 2;

interface PersistedPrefs {
  prefsVersion?: number;
  theme: 'light' | 'dark';
  settings: ProfilerSettings;
  activePresetId: string;
  extraIgnoreWords: string[];
}

export interface DocumentHistoryEntry {
  stack: string[];
  index: number;
}

function loadPersistedPrefs(): PersistedPrefs {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const fallback: PersistedPrefs = {
    prefsVersion: PREFS_SCHEMA_VERSION,
    theme: prefersDark ? 'dark' : 'light',
    settings: { ...DEFAULT_SETTINGS },
    activePresetId: 'gsl-awl',
    extraIgnoreWords: [],
  };

  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedPrefs>;
    const mergedSettings: ProfilerSettings = {
      ...DEFAULT_SETTINGS,
      ...(parsed.settings ?? {}),
    };
    if (
      (parsed.prefsVersion ?? 1) < PREFS_SCHEMA_VERSION &&
      mergedSettings.fontSizePx <= 16
    ) {
      mergedSettings.fontSizePx = DEFAULT_SETTINGS.fontSizePx;
    }
    return {
      prefsVersion: PREFS_SCHEMA_VERSION,
      theme:
        parsed.theme === 'dark' || parsed.theme === 'light'
          ? parsed.theme
          : fallback.theme,
      settings: mergedSettings,
      activePresetId: parsed.activePresetId || 'gsl-awl',
      extraIgnoreWords: Array.isArray(parsed.extraIgnoreWords)
        ? parsed.extraIgnoreWords.map(String)
        : [],
    };
  } catch {
    return fallback;
  }
}

function savePersistedPrefs(prefs: PersistedPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prefs, prefsVersion: PREFS_SCHEMA_VERSION }),
    );
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Resolves static asset URLs relative to Vite `BASE_URL` so GitHub Pages
 * subpath deployments (`https://<user>.github.io/<repo>/`) work without 404s.
 */
export function resolvePublicAssetUrl(assetPath: string): string {
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const cleanRel = assetPath.replace(/^\.?\/+/, '');
  const base = import.meta.env.BASE_URL || './';
  if (base === './' || base === '.') {
    return `./${cleanRel}`;
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${cleanRel}`;
}

const fetchedTextCache = new Map<string, string>();

async function fetchStaticText(url: string): Promise<string> {
  const resolvedUrl = resolvePublicAssetUrl(url);
  const hit = fetchedTextCache.get(resolvedUrl);
  if (hit !== undefined) return hit;
  const res = await fetch(resolvedUrl);
  if (!res.ok) {
    throw new Error(
      `단어장 파일을 불러오지 못했습니다 (${res.status}): ${resolvedUrl}`,
    );
  }
  const text = (await res.text())
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  fetchedTextCache.set(resolvedUrl, text);
  return text;
}

let profileJobEpoch = 0;
let statsJobEpoch = 0;
let initAppPromise: Promise<void> | null = null;
let activeAiAbortController: AbortController | null = null;
const MAX_AI_SUGGESTION_CACHE = 32;
const aiSuggestionCache = new Map<string, CombinedSuggestionResult>();

function cancelActiveAiCall(): boolean {
  if (activeAiAbortController) {
    activeAiAbortController.abort();
    activeAiAbortController = null;
    return true;
  }
  return false;
}

function countParsedWordlistEntries(
  content: string,
  settings: ProfilerSettings,
): number {
  const groups = parseRawFamilyGroups(content, {
    ignoreCase: settings.ignoreCase,
    formatMode: settings.nationFormat,
    stripAnnotations: settings.stripCurriculumAnnotations,
  });
  let count = 0;
  for (const g of groups) count += g.members.length;
  return count;
}

export interface CoverageModalPayload {
  title: string;
  subtitle: string;
  words: CoverageWordItem[];
}

export interface ValidationModalPayload {
  duplicates: DuplicateEntryRecord[];
  checkedListCount: number;
  elapsedMs: number;
}

export interface ProfilerStoreState {
  // Environment & Theme
  initialized: boolean;
  theme: 'light' | 'dark';
  manifest: WordlistManifest | null;
  activePresetId: string | null;
  builtinMasterRawCache: string;

  // Navigation
  activeMainTab: MainTabId;
  activeStatsSubTab: StatsSubTabId;
  inspectorTab: InspectorBodyTab;

  // Target Corpus & Inline / File Edit Histories
  targetFiles: TargetFileItem[];
  fileHistories: Record<string, DocumentHistoryEntry>;
  filePassageIndices: Record<string, number>;
  selectedTargetIds: string[];
  activeTargetFileId: string | null; // null = inline text mode
  inlineEditorOpen: boolean;
  inlineText: string;
  inlinePassageIndex: number;
  inlineHistory: string[];
  inlineHistoryIndex: number;
  editorMode: 'profiled' | 'edit';
  plainFormatView: boolean; // Clear Format state
  editSelectionText: string; // Active selection inside textarea in Edit Text mode

  // Reference Lists & Auxiliary Lists
  referenceLists: ReferenceListSource[];
  ignoreEnabled: boolean;
  ignoreColor: LevelColorPair;
  outColor: LevelColorPair;
  ignoreList: AuxiliaryListState;
  extraIgnoreWords: string[];
  masterList: AuxiliaryListState;

  // Settings
  settings: ProfilerSettings;

  // Profile & Selection & Search Outputs
  activeProfile: DocumentProfileResult | null;
  selectedWordKey: string | null;
  selectedRawToken: string | null;
  selectedTokenSpan: TokenSpanSelection | null;
  searchQuery: string;
  searchMatchTokenIndices: number[];
  activeSearchCursor: number; // 0-based index into searchMatchTokenIndices

  statsBundle: CorpusStatisticsBundle | null;
  statsStale: boolean;

  // Async Progress & Status
  isBusy: boolean;
  progressPercent: number;
  statusMessage: string;
  errorBanner: string | null;

  // Modals
  settingsModalOpen: boolean;
  settingsInitialSection: SettingsSectionId;
  helpModalTab: 'guide' | 'shortcuts' | 'about' | null;
  coverageModal: CoverageModalPayload | null;
  validationModal: ValidationModalPayload | null;

  // OpenRouter AI Assistant State
  openRouterConfig: OpenRouterConfig;
  aiLoading: boolean;
  aiError: string | null;
  morphologyResult: MorphologyAnalysisResult | null;
  aiSuggestionModalOpen: boolean;
  combinedSuggestionResult: CombinedSuggestionResult | null;
  lastAddedReferenceListId: string | null;

  // Actions
  initializeApp: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveMainTab: (tab: MainTabId) => void;
  setActiveStatsSubTab: (subTab: StatsSubTabId) => void;
  setInspectorTab: (tab: InspectorBodyTab) => void;
  dismissErrorBanner: () => void;
  setErrorBanner: (msg: string) => void;

  // Presets & Lists
  applyPreset: (presetId: string) => Promise<void>;
  addBundledReferenceList: (manifestListId: string) => Promise<void>;
  addCustomReferenceLists: (
    lists: { name: string; path: string; content: string }[],
    priorError?: string | null,
  ) => Promise<void>;
  toggleReferenceList: (id: string) => Promise<void>;
  moveReferenceList: (id: string, direction: 'up' | 'down') => Promise<void>;
  setReferenceListColor: (id: string, hexColor: string) => void;
  closeDeactivatedReferenceLists: () => Promise<void>;
  closeAllReferenceLists: () => Promise<void>;
  removeReferenceList: (id: string) => Promise<void>;

  setIgnoreEnabled: (enabled: boolean) => Promise<void>;
  setIgnoreColor: (hexColor: string) => void;
  setOutColor: (hexColor: string) => void;
  loadCustomIgnoreList: (
    name: string,
    path: string,
    content: string,
  ) => Promise<void>;
  closeIgnoreListFile: () => Promise<void>;
  toggleBuiltinMasterList: (enable: boolean) => Promise<void>;
  loadCustomMasterList: (
    name: string,
    path: string,
    content: string,
  ) => Promise<void>;
  closeMasterList: () => Promise<void>;

  // Extra Ignore Words
  addExtraIgnoreWord: (word: string) => Promise<void>;
  removeExtraIgnoreWords: (words: string[]) => Promise<void>;
  clearAllExtraIgnoreWords: () => Promise<void>;
  replaceExtraIgnoreWords: (words: string[]) => Promise<void>;
  pasteIntoExtraIgnoreWords: (
    rawText: string,
  ) => Promise<{ added: number; skippedInLists: number }>;

  // Target Files & Document Editing / Undo-Redo
  addTargetFiles: (items: TargetFileItem[]) => Promise<void>;
  setSelectedTargetIds: (ids: string[]) => void;
  openTargetFileInProfiler: (id: string) => Promise<void>;
  openEmptyInlineEditor: () => void;
  switchToInlineEditor: (
    initialText?: string,
    options?: { mode?: 'profiled' | 'edit' },
  ) => Promise<void>;
  loadSamplePassage: () => Promise<void>;
  closeTargetFileById: (id: string) => Promise<void>;
  removeSelectedTargetFiles: () => Promise<void>;
  clearAllTargetFiles: () => Promise<void>;

  updateInlineText: (nextText: string) => void;
  updateActiveEditableText: (nextText: string) => void;
  setEditSelectionText: (text: string) => void;
  setActivePassageIndex: (index: number) => Promise<void>;
  stepActivePassage: (direction: 'prev' | 'next') => Promise<void>;
  undoInlineText: () => void;
  redoInlineText: () => void;
  canUndoActiveDocument: () => boolean;
  canRedoActiveDocument: () => boolean;
  applyTokenSpanReplacement: (
    startIdx: number,
    endIdx: number,
    replacementText: string,
  ) => Promise<void>;
  replaceAllMatchingWordTokens: (
    lookupKey: string,
    replacementText: string,
  ) => Promise<number>;
  setEditorMode: (mode: 'profiled' | 'edit') => void;
  clearProfileFormat: () => void;

  // Execution & Search & Selection
  runProfileActive: () => Promise<void>;
  runUpdateStatistics: () => Promise<void>;
  runValidateLists: () => Promise<void>;
  clearTokenSelection: () => void;
  selectWordForInspector: (rawToken: string | null) => void;
  selectTokenInstance: (
    tokenIdx: number,
    options?: { toggleIfSelected?: boolean },
  ) => void;
  selectTokenRange: (startIdx: number, endIdx: number) => void;
  setSearchQuery: (q: string) => void;
  stepSearchMatch: (direction: 'next' | 'prev') => void;

  // Settings & Modals
  updateSettings: (patch: Partial<ProfilerSettings>) => Promise<void>;
  resetDefaultSettings: () => Promise<void>;
  adjustFontSize: (delta: number) => void;
  setSettingsModalOpen: (open: boolean, section?: SettingsSectionId) => void;
  setHelpModalTab: (tab: 'guide' | 'shortcuts' | 'about' | null) => void;
  openCoverageModalForKey: (key: string) => void;
  closeCoverageModal: () => void;
  closeValidationModal: () => void;

  // AI Assistant Actions
  updateOpenRouterConfig: (next: OpenRouterConfig) => void;
  clearOpenRouterKey: () => void;
  clearGeminiKey: () => void;
  cancelAiRequest: () => void;
  runAiMorphologyCheck: () => Promise<void>;
  openAiSuggestionModal: (options?: {
    forceRefresh?: boolean;
  }) => Promise<void>;
  closeAiSuggestionModal: () => void;
}

function computeSearchMatches(
  profile: DocumentProfileResult | null,
  query: string,
  ignoreCase: boolean,
): number[] {
  if (!profile || !query.trim()) return [];
  const q = query.trim();
  const flags = ignoreCase ? 'iu' : 'u';
  let regex: RegExp;
  try {
    const candidate = new RegExp(q, flags);
    if (candidate.test('')) {
      throw new Error('Zero-length regex match');
    }
    regex = candidate;
  } catch {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, flags);
  }

  const hits: number[] = [];
  for (let i = 0; i < profile.tokens.length; i++) {
    if (regex.test(profile.tokens[i].token)) {
      hits.push(i);
    }
  }
  return hits;
}

/** AI vocabulary ceiling: every enabled Reference List in the sidebar. */
function activeReferenceLevelCap(referenceLists: ReferenceListSource[]): number {
  return Math.max(1, referenceLists.filter((r) => r.enabled).length);
}

export interface ActivePassageContext {
  isInline: boolean;
  activeFile: TargetFileItem | null;
  fullDocumentText: string;
  passages: PassageItem[];
  isMultiPassage: boolean;
  activePassageIndex: number;
  activePassage: PassageItem;
  sourceId: string;
  sourceName: string;
}

export function resolveActivePassageContext(
  st: Pick<
    ProfilerStoreState,
    | 'activeTargetFileId'
    | 'targetFiles'
    | 'filePassageIndices'
    | 'inlineText'
    | 'inlinePassageIndex'
  >,
): ActivePassageContext {
  const activeFile = st.activeTargetFileId
    ? st.targetFiles.find((f) => f.id === st.activeTargetFileId) ?? null
    : null;
  const isInline = activeFile === null;
  const fullDocumentText = activeFile ? activeFile.content : st.inlineText;
  const passages = parsePassageSet(fullDocumentText);
  const isMultiPassage = passages.length > 1;
  const rawIdx = activeFile
    ? st.filePassageIndices[activeFile.id] ?? 0
    : st.inlinePassageIndex;
  const activePassageIndex = Math.max(
    0,
    Math.min(rawIdx, passages.length - 1),
  );
  const activePassage = passages[activePassageIndex];
  const baseId = activeFile ? activeFile.id : '__inline__';
  const baseName = activeFile ? activeFile.name : 'Inline Text';

  return {
    isInline,
    activeFile,
    fullDocumentText,
    passages,
    isMultiPassage,
    activePassageIndex,
    activePassage,
    sourceId: isMultiPassage ? `${baseId}#p${activePassageIndex}` : baseId,
    sourceName: isMultiPassage
      ? `${baseName} (${activePassageIndex + 1}/${passages.length} · ${activePassage.label})`
      : baseName,
  };
}

function expandFilesForStatistics(files: TargetFileItem[]): TargetFileItem[] {
  const expanded: TargetFileItem[] = [];
  for (const f of files) {
    const passages = parsePassageSet(f.content);
    if (passages.length <= 1) {
      expanded.push(f);
    } else {
      for (const p of passages) {
        expanded.push({
          ...f,
          id: `${f.id}#p${p.index}`,
          name: `${f.name} [${p.index + 1}/${passages.length} · ${p.label}]`,
          path: `${f.path}#${p.index + 1}`,
          content: p.content,
          sizeBytes: new Blob([p.content]).size,
        });
      }
    }
  }
  return expanded;
}

const initialPrefs = loadPersistedPrefs();
const initialOpenRouterConfig = loadOpenRouterConfig();

export const useProfilerStore = create<ProfilerStoreState>((set, get) => {
  const clearAiResults = () => ({
    morphologyResult: null as MorphologyAnalysisResult | null,
    combinedSuggestionResult: null as CombinedSuggestionResult | null,
  });

  /** Abort in-flight AI and clear loading/error/results/modal together. */
  const abortAndResetAiSession = () => {
    cancelActiveAiCall();
    aiSuggestionCache.clear();
    set({
      aiLoading: false,
      aiError: null,
      aiSuggestionModalOpen: false,
      ...clearAiResults(),
    });
  };

  const abortAiAndClearLoading = () => {
    cancelActiveAiCall();
    set({ aiLoading: false });
  };

  const getActiveDocumentText = (): string => {
    return resolveActivePassageContext(get()).activePassage.content;
  };

  const assertProfileStillCurrent = (
    sourceOriginalText: string,
    sourceId: string,
  ): boolean => {
    const profile = get().activeProfile;
    if (!profile) return false;
    if (
      profile.sourceId !== sourceId ||
      profile.originalText !== sourceOriginalText
    ) {
      return false;
    }
    return getActiveDocumentText() === profile.originalText;
  };

  const persistSnapshot = () => {
    const st = get();
    savePersistedPrefs({
      theme: st.theme,
      settings: st.settings,
      activePresetId: st.activePresetId ?? 'custom',
      extraIgnoreWords: st.extraIgnoreWords,
    });
  };

  const ensureBuiltinMasterRaw = async (): Promise<string> => {
    const st = get();
    if (st.builtinMasterRawCache) return st.builtinMasterRawCache;
    if (st.masterList.isBuiltin && st.masterList.content) {
      set({ builtinMasterRawCache: st.masterList.content });
      return st.masterList.content;
    }
    const url = st.manifest?.auxiliary.builtinMasterFamilies.url;
    if (!url) return '';
    try {
      const content = await fetchStaticText(url);
      set({ builtinMasterRawCache: content });
      return content;
    } catch {
      return '';
    }
  };

  const commitActiveDocumentText = (nextPassageText: string): boolean => {
    const st = get();
    const ctx = resolveActivePassageContext(st);
    const nextFullText = ctx.isMultiPassage
      ? updatePassageContentAt(
          ctx.fullDocumentText,
          ctx.activePassageIndex,
          nextPassageText,
        ).fullText
      : nextPassageText;

    if (ctx.isInline) {
      const cur = st.inlineHistory[st.inlineHistoryIndex] ?? '';
      if (nextFullText === cur) return false;
      const sliced = st.inlineHistory.slice(0, st.inlineHistoryIndex + 1);
      const capped = [...sliced.slice(-49), nextFullText];
      set({
        inlineText: nextFullText,
        inlinePassageIndex: ctx.activePassageIndex,
        inlineHistory: capped,
        inlineHistoryIndex: capped.length - 1,
        statsStale: true,
      });
      return true;
    }

    const fileId = ctx.activeFile!.id;
    const targetFile = ctx.activeFile!;
    if (targetFile.content === nextFullText) return false;

    const existingHist = st.fileHistories[fileId] ?? {
      stack: [targetFile.content],
      index: 0,
    };
    const sliced = existingHist.stack.slice(0, existingHist.index + 1);
    const capped = [...sliced.slice(-49), nextFullText];

    set({
      targetFiles: st.targetFiles.map((f) =>
        f.id === fileId
          ? {
              ...f,
              content: nextFullText,
              sizeBytes: new Blob([nextFullText]).size,
            }
          : f,
      ),
      filePassageIndices: {
        ...st.filePassageIndices,
        [fileId]: ctx.activePassageIndex,
      },
      fileHistories: {
        ...st.fileHistories,
        [fileId]: { stack: capped, index: capped.length - 1 },
      },
      statsStale: true,
    });
    return true;
  };

  return {
    initialized: false,
    theme: initialPrefs.theme,
    manifest: null,
    activePresetId: initialPrefs.activePresetId,
    builtinMasterRawCache: '',

    activeMainTab: initialPrefs.settings.defaultTab,
    activeStatsSubTab: 'coverage',
    inspectorTab: 'ai',

    targetFiles: [],
    fileHistories: {},
    filePassageIndices: {},
    selectedTargetIds: [],
    activeTargetFileId: null,
    inlineEditorOpen: false,
    inlineText: '',
    inlinePassageIndex: 0,
    inlineHistory: [''],
    inlineHistoryIndex: 0,
    editorMode: 'edit',
    plainFormatView: false,
    editSelectionText: '',

    referenceLists: [],
    ignoreEnabled: true,
    ignoreColor: { ...DEFAULT_IGNORE_COLOR },
    outColor: { ...DEFAULT_OUT_HIGHLIGHT_COLOR },
    ignoreList: {
      enabled: false,
      name: 'ignore_list',
      path: '',
      content: '',
    },
    extraIgnoreWords: initialPrefs.extraIgnoreWords,
    masterList: {
      enabled: false,
      name: 'master_list',
      path: '',
      content: '',
    },

    settings: initialPrefs.settings,

    activeProfile: null,
    selectedWordKey: null,
    selectedRawToken: null,
    selectedTokenSpan: null,
    searchQuery: '',
    searchMatchTokenIndices: [],
    activeSearchCursor: 0,

    statsBundle: null,
    statsStale: true,

    isBusy: false,
    progressPercent: 0,
    statusMessage: '초기화 준비 중...',
    errorBanner: null,

    settingsModalOpen: false,
    settingsInitialSection: 'display',
    helpModalTab: null,
    coverageModal: null,
    validationModal: null,

    openRouterConfig: initialOpenRouterConfig,
    aiLoading: false,
    aiError: null,
    morphologyResult: null,
    aiSuggestionModalOpen: false,
    combinedSuggestionResult: null,
    lastAddedReferenceListId: null,

    initializeApp: async () => {
      if (get().initialized) return;
      if (initAppPromise) return initAppPromise;

      initAppPromise = (async () => {
        const curTheme = get().theme;
        document.documentElement.dataset.theme = curTheme;
        document.documentElement.classList.toggle('dark', curTheme === 'dark');
        set({
          isBusy: true,
          statusMessage: '내장 단어장 매니페스트 로드 중...',
        });

        try {
          const res = await fetch(
            resolvePublicAssetUrl('wordlists/manifest.json'),
          );
          if (!res.ok) {
            throw new Error(`매니페스트 로드 실패 (${res.status})`);
          }
          const manifest = (await res.json()) as WordlistManifest;
          set({ manifest, initialized: true });

          const desiredPreset =
            manifest.presets.find((p) => p.id === get().activePresetId)?.id ??
            manifest.presets[0].id;
          await get().applyPreset(desiredPreset);
        } catch (err) {
          set({
            initialized: true,
            isBusy: false,
            errorBanner:
              err instanceof Error ? err.message : '초기화에 실패했습니다.',
            statusMessage: '초기화 오류',
          });
        }
      })().finally(() => {
        initAppPromise = null;
      });

      return initAppPromise;
    },

    setTheme: (theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
      set({ theme });
      persistSnapshot();
    },

    toggleTheme: () => {
      const next = get().theme === 'light' ? 'dark' : 'light';
      get().setTheme(next);
    },

    setActiveMainTab: (tab) => {
      set({ activeMainTab: tab });
      if (tab === 'statistics') {
        const st = get();
        const hasAnyText =
          st.targetFiles.length > 0 || st.inlineText.trim().length > 0;
        if (hasAnyText && (st.statsStale || !st.statsBundle)) {
          void st.runUpdateStatistics();
        }
      }
    },

    setActiveStatsSubTab: (subTab) => {
      set({ activeStatsSubTab: subTab });
    },

    setInspectorTab: (tab) => {
      set({ inspectorTab: tab });
    },

    dismissErrorBanner: () => set({ errorBanner: null }),
    setErrorBanner: (msg) => set({ errorBanner: msg }),

    applyPreset: async (presetId) => {
      const { manifest } = get();
      if (!manifest) return;
      const preset = manifest.presets.find((p) => p.id === presetId);
      if (!preset) return;

      abortAndResetAiSession();
      set({
        isBusy: true,
        progressPercent: 15,
        lastAddedReferenceListId: null,
        statusMessage: `'${preset.shortLabel}' 단어장 로드 중...`,
      });

      try {
        const listEntries = preset.listIds
          .map((id) => manifest.lists.find((l) => l.id === id))
          .filter((x): x is NonNullable<typeof x> => Boolean(x));

        const [contents, masterText] = await Promise.all([
          Promise.all(listEntries.map((entry) => fetchStaticText(entry.url))),
          preset.enableBuiltinMaster
            ? fetchStaticText(manifest.auxiliary.builtinMasterFamilies.url)
            : Promise.resolve(null),
        ]);

        const nextRefs: ReferenceListSource[] = listEntries.map(
          (entry, idx) => {
            const pair = getDefaultLevelColorPair(idx);
            return {
              id: `${entry.id}-${idx}`,
              name: entry.name,
              displayName: entry.displayName,
              path: entry.url,
              content: contents[idx],
              enabled: true,
              colorLight: pair.light,
              colorDark: pair.dark,
              isBuiltin: true,
            };
          },
        );

        let nextMaster = get().masterList;
        if (preset.enableBuiltinMaster && masterText !== null) {
          nextMaster = {
            enabled: true,
            name: manifest.auxiliary.builtinMasterFamilies.name,
            path: manifest.auxiliary.builtinMasterFamilies.url,
            content: masterText,
            isBuiltin: true,
          };
          set({ builtinMasterRawCache: masterText });
        } else if (nextMaster.isBuiltin) {
          nextMaster = {
            enabled: false,
            name: 'master_list',
            path: '',
            content: '',
          };
        }

        set({
          activePresetId: presetId,
          referenceLists: nextRefs,
          masterList: nextMaster,
          ...clearAiResults(),
          statsStale: true,
          isBusy: false,
          progressPercent: 100,
          statusMessage: `프리셋 적용됨: ${preset.label} (${nextRefs.length}개 리스트)`,
        });
        persistSnapshot();

        const st = get();
        if (st.activeTargetFileId || st.inlineText.trim().length > 0) {
          await st.runProfileActive();
        }
        if (
          st.activeMainTab === 'statistics' &&
          (st.targetFiles.length > 0 || st.inlineText.trim().length > 0)
        ) {
          await st.runUpdateStatistics();
        }
      } catch (err) {
        set({
          isBusy: false,
          errorBanner:
            err instanceof Error
              ? err.message
              : '프리셋 로드 중 오류가 발생했습니다.',
        });
      }
    },

    addBundledReferenceList: async (manifestListId) => {
      const { manifest, referenceLists, settings } = get();
      if (!manifest) return;
      const entry = manifest.lists.find((l) => l.id === manifestListId);
      if (!entry) return;

      if (isManifestEntryLoaded(referenceLists, entry)) {
        set({
          errorBanner: `이미 추가된 단어장입니다: ${entry.displayName}`,
        });
        return;
      }

      abortAndResetAiSession();
      set({ isBusy: true, statusMessage: `${entry.name} 추가 중...` });
      try {
        const content = await fetchStaticText(entry.url);
        const entryCount = countParsedWordlistEntries(content, settings);
        if (entryCount === 0) {
          set({
            isBusy: false,
            errorBanner: `단어가 하나도 파싱되지 않았습니다: ${entry.name}`,
          });
          return;
        }
        const pair = getDefaultLevelColorPair(referenceLists.length);
        const added: ReferenceListSource = {
          id: `bundled-${entry.id}-${Date.now()}`,
          name: entry.name,
          displayName: entry.displayName,
          path: entry.url,
          content,
          enabled: true,
          colorLight: pair.light,
          colorDark: pair.dark,
          isBuiltin: true,
        };
        const nextLists = [...referenceLists, added];
        set({
          activePresetId: null,
          referenceLists: nextLists,
          ...clearAiResults(),
          lastAddedReferenceListId: added.id,
          statsStale: true,
          isBusy: false,
          statusMessage: `레퍼런스 리스트 추가됨: ${entry.name} (${entryCount.toLocaleString()} 어형)`,
        });
        setTimeout(() => {
          if (get().lastAddedReferenceListId === added.id) {
            set({ lastAddedReferenceListId: null });
          }
        }, 1600);
        persistSnapshot();
        await get().runProfileActive();
      } catch (err) {
        set({
          isBusy: false,
          errorBanner: err instanceof Error ? err.message : String(err),
        });
      }
    },

    addCustomReferenceLists: async (lists, priorError) => {
      if (lists.length === 0) {
        if (priorError) set({ errorBanner: priorError });
        return;
      }
      const current = get().referenceLists;
      const settings = get().settings;
      const additions: ReferenceListSource[] = [];
      const rejected: string[] = [];

      lists.forEach((l, i) => {
        const entryCount = countParsedWordlistEntries(l.content, settings);
        if (entryCount === 0) {
          rejected.push(l.name);
          return;
        }
        const pair = getDefaultLevelColorPair(current.length + additions.length);
        additions.push({
          id: `custom-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: l.name,
          displayName: l.name,
          path: l.path,
          content: l.content,
          enabled: true,
          colorLight: pair.light,
          colorDark: pair.dark,
          isBuiltin: false,
        });
      });

      const rejectMessage =
        rejected.length > 0
          ? `단어가 파싱되지 않아 제외됨: ${rejected.join(', ')}`
          : null;
      const combinedError = [priorError, rejectMessage]
        .filter(Boolean)
        .join(' · ');
      if (combinedError) {
        set({ errorBanner: combinedError });
      }
      if (additions.length === 0) return;

      abortAndResetAiSession();
      const nextLists = [...current, ...additions];
      const lastId = additions[additions.length - 1].id;
      set({
        activePresetId: null,
        referenceLists: nextLists,
        ...clearAiResults(),
        lastAddedReferenceListId: lastId,
        statsStale: true,
        statusMessage: `${additions.length}개 사용자 레퍼런스 리스트 추가됨`,
      });
      setTimeout(() => {
        if (get().lastAddedReferenceListId === lastId) {
          set({ lastAddedReferenceListId: null });
        }
      }, 1600);
      persistSnapshot();
      await get().runProfileActive();
    },

    toggleReferenceList: async (id) => {
      abortAndResetAiSession();
      set((st) => {
        const nextLists = st.referenceLists.map((r) =>
          r.id === id ? { ...r, enabled: !r.enabled } : r,
        );
        return {
          referenceLists: nextLists,
          ...clearAiResults(),
          statsStale: true,
        };
      });
      await get().runProfileActive();
    },

    moveReferenceList: async (id, direction) => {
      const list = [...get().referenceLists];
      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= list.length) return;
      const [item] = list.splice(idx, 1);
      list.splice(targetIdx, 0, item);
      abortAndResetAiSession();
      set({
        activePresetId: null,
        referenceLists: list,
        ...clearAiResults(),
        statsStale: true,
      });
      await get().runProfileActive();
    },

    setReferenceListColor: (id, hexColor) => {
      const theme = get().theme;
      const nextLight =
        theme === 'dark' ? ensureReadableOnLight(hexColor) : hexColor;
      const nextDark =
        theme === 'dark' ? hexColor : ensureReadableOnDark(hexColor);
      set((st) => ({
        referenceLists: st.referenceLists.map((r) =>
          r.id === id
            ? { ...r, colorLight: nextLight, colorDark: nextDark }
            : r,
        ),
      }));
    },

    closeDeactivatedReferenceLists: async () => {
      const kept = get().referenceLists.filter((r) => r.enabled);
      abortAndResetAiSession();
      set({
        activePresetId: null,
        referenceLists: kept,
        ...clearAiResults(),
        statsStale: true,
        statusMessage: '비활성 레퍼런스 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    closeAllReferenceLists: async () => {
      abortAndResetAiSession();
      set({
        activePresetId: null,
        referenceLists: [],
        lastAddedReferenceListId: null,
        ...clearAiResults(),
        statsStale: true,
        statusMessage: '모든 레퍼런스 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    removeReferenceList: async (id) => {
      abortAndResetAiSession();
      set((st) => {
        const nextLists = st.referenceLists.filter((r) => r.id !== id);
        return {
          activePresetId: null,
          referenceLists: nextLists,
          ...clearAiResults(),
          statsStale: true,
        };
      });
      await get().runProfileActive();
    },

    setIgnoreEnabled: async (enabled) => {
      abortAndResetAiSession();
      set({ ignoreEnabled: enabled, statsStale: true });
      await get().runProfileActive();
    },

    setIgnoreColor: (hexColor) => {
      const theme = get().theme;
      const nextLight =
        theme === 'dark' ? ensureReadableOnLight(hexColor) : hexColor;
      const nextDark =
        theme === 'dark' ? hexColor : ensureReadableOnDark(hexColor);
      set({
        ignoreColor: { light: nextLight, dark: nextDark },
      });
    },

    setOutColor: (hexColor) => {
      const theme = get().theme;
      const nextLight =
        theme === 'dark' ? ensureReadableOnLight(hexColor) : hexColor;
      const nextDark =
        theme === 'dark' ? hexColor : ensureReadableOnDark(hexColor);
      set({
        outColor: { light: nextLight, dark: nextDark },
      });
    },

    loadCustomIgnoreList: async (name, path, content) => {
      abortAndResetAiSession();
      set({
        ignoreList: { enabled: true, name, path, content, isBuiltin: false },
        ignoreEnabled: true,
        statsStale: true,
        statusMessage: `Ignore 리스트 적용됨: ${name}`,
      });
      await get().runProfileActive();
    },

    closeIgnoreListFile: async () => {
      abortAndResetAiSession();
      set({
        ignoreList: {
          enabled: false,
          name: 'ignore_list',
          path: '',
          content: '',
        },
        statsStale: true,
        statusMessage: 'Ignore 리스트 파일을 닫았습니다.',
      });
      await get().runProfileActive();
    },

    toggleBuiltinMasterList: async (enable) => {
      const { manifest } = get();
      abortAndResetAiSession();
      if (!enable) {
        set({
          masterList: {
            enabled: false,
            name: 'master_list',
            path: '',
            content: '',
          },
          statsStale: true,
          statusMessage: 'Master 패밀리 확장이 해제되었습니다.',
        });
        await get().runProfileActive();
        return;
      }
      if (!manifest) return;
      set({
        isBusy: true,
        statusMessage: '내장 Master 패밀리 사전 로드 중...',
      });
      try {
        const content = await fetchStaticText(
          manifest.auxiliary.builtinMasterFamilies.url,
        );
        set({
          builtinMasterRawCache: content,
          masterList: {
            enabled: true,
            name: manifest.auxiliary.builtinMasterFamilies.name,
            path: manifest.auxiliary.builtinMasterFamilies.url,
            content,
            isBuiltin: true,
          },
          isBusy: false,
          statsStale: true,
          statusMessage: '내장 Master 패밀리 사전(3,463 패밀리) 활성화됨',
        });
        await get().runProfileActive();
      } catch (err) {
        set({
          isBusy: false,
          errorBanner: err instanceof Error ? err.message : String(err),
        });
      }
    },

    loadCustomMasterList: async (name, path, content) => {
      abortAndResetAiSession();
      set({
        masterList: { enabled: true, name, path, content, isBuiltin: false },
        statsStale: true,
        statusMessage: `사용자 Master 리스트 적용됨: ${name}`,
      });
      await get().runProfileActive();
    },

    closeMasterList: async () => {
      abortAndResetAiSession();
      set({
        masterList: {
          enabled: false,
          name: 'master_list',
          path: '',
          content: '',
        },
        statsStale: true,
        statusMessage: 'Master 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    addExtraIgnoreWord: async (word) => {
      const norm = get().settings.ignoreCase
        ? word.trim().toLowerCase()
        : word.trim();
      if (!norm) return;
      abortAndResetAiSession();
      const existing = new Set(get().extraIgnoreWords);
      existing.add(norm);
      const sorted = Array.from(existing).sort((a, b) => a.localeCompare(b));
      set({
        extraIgnoreWords: sorted,
        ignoreEnabled: true,
        statsStale: true,
        statusMessage: `'${norm}' 단어를 Extra Ignore Words에 추가했습니다.`,
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    removeExtraIgnoreWords: async (words) => {
      abortAndResetAiSession();
      const toRemove = new Set(words);
      const next = get().extraIgnoreWords.filter((w) => !toRemove.has(w));
      set({
        extraIgnoreWords: next,
        statsStale: true,
        statusMessage: `${words.length}개 단어를 Extra Ignore Words에서 제거했습니다.`,
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    clearAllExtraIgnoreWords: async () => {
      abortAndResetAiSession();
      set({
        extraIgnoreWords: [],
        statsStale: true,
        statusMessage: 'Extra Ignore Words를 모두 비웠습니다.',
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    replaceExtraIgnoreWords: async (words) => {
      abortAndResetAiSession();
      const ignoreCase = get().settings.ignoreCase;
      const dedup = new Set<string>();
      for (const raw of words) {
        const cleaned = ignoreCase ? raw.trim().toLowerCase() : raw.trim();
        if (cleaned) dedup.add(cleaned);
      }
      const sorted = Array.from(dedup).sort((a, b) => a.localeCompare(b));
      set({
        extraIgnoreWords: sorted,
        ignoreEnabled: sorted.length > 0 ? true : get().ignoreEnabled,
        statsStale: true,
        statusMessage: `Extra Ignore Words ${sorted.length}개 적용됨`,
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    pasteIntoExtraIgnoreWords: async (rawText) => {
      const st = get();
      abortAndResetAiSession();
      const res = await profilerWorkerClient.filterPastedIgnoreWords({
        rawText,
        referenceLists: st.referenceLists,
        masterList: st.masterList,
        settings: st.settings,
      });

      const merged = new Set(get().extraIgnoreWords);
      let addedCount = 0;
      for (const c of res.candidates) {
        if (!merged.has(c)) {
          merged.add(c);
          addedCount += 1;
        }
      }

      const sorted = Array.from(merged).sort((a, b) => a.localeCompare(b));
      set({
        extraIgnoreWords: sorted,
        ignoreEnabled: true,
        statsStale: true,
        statusMessage: `Extra Ignore 추가: 신규 ${addedCount}개 (레퍼런스 리스트 기등재 ${res.skippedInListsCount}개 자동 제외)`,
      });
      persistSnapshot();
      await get().runProfileActive();
      return { added: addedCount, skippedInLists: res.skippedInListsCount };
    },

    addTargetFiles: async (items) => {
      if (items.length === 0) return;
      const prev = get().targetFiles;
      const next = [...prev, ...items];
      const nextHistories = { ...get().fileHistories };
      const nextPassageIndices = { ...get().filePassageIndices };
      for (const it of items) {
        nextHistories[it.id] = { stack: [it.content], index: 0 };
        nextPassageIndices[it.id] = 0;
      }
      const firstId = items[0].id;
      const firstPassages = parsePassageSet(items[0].content);
      abortAndResetAiSession();
      set({
        targetFiles: next,
        fileHistories: nextHistories,
        filePassageIndices: nextPassageIndices,
        selectedTargetIds: [firstId],
        activeTargetFileId: firstId,
        inlineEditorOpen: false,
        editorMode: 'profiled',
        plainFormatView: false,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
        statusMessage:
          firstPassages.length > 1
            ? `세트 파일 로드됨: ${items[0].name} (총 ${firstPassages.length}개 문항 감지 — 이전/다음 문항 버튼으로 이동 가능)`
            : `${items.length}개 타겟 파일 로드됨`,
      });
      await get().runProfileActive();
      if (get().activeMainTab === 'statistics') {
        await get().runUpdateStatistics();
      }
    },

    setSelectedTargetIds: (ids) => set({ selectedTargetIds: ids }),

    openTargetFileInProfiler: async (id) => {
      const found = get().targetFiles.find((f) => f.id === id);
      if (!found) return;
      const wasInline = get().activeTargetFileId === null;
      abortAndResetAiSession();
      set({
        activeTargetFileId: id,
        selectedTargetIds: [id],
        inlineEditorOpen: false,
        activeMainTab: 'profiler',
        editorMode: 'profiled',
        plainFormatView: false,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...(wasInline ? { statsStale: true } : {}),
        ...clearAiResults(),
      });
      await get().runProfileActive();
    },

    openEmptyInlineEditor: () => {
      abortAndResetAiSession();
      profileJobEpoch += 1;
      set({
        activeTargetFileId: null,
        selectedTargetIds: [],
        inlineEditorOpen: true,
        inlineText: '',
        inlinePassageIndex: 0,
        inlineHistory: [''],
        inlineHistoryIndex: 0,
        editorMode: 'edit',
        plainFormatView: false,
        editSelectionText: '',
        activeProfile: null,
        isBusy: false,
        progressPercent: 0,
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
        statusMessage: '인라인 텍스트 입력 모드',
      });
    },

    switchToInlineEditor: async (initialText, options) => {
      const text = initialText !== undefined ? initialText : get().inlineText;
      const desiredMode =
        options?.mode ?? (text.trim() ? 'profiled' : 'edit');
      abortAndResetAiSession();
      if (desiredMode === 'edit') {
        profileJobEpoch += 1;
      }
      set({
        activeTargetFileId: null,
        selectedTargetIds: [],
        inlineEditorOpen: true,
        inlineText: text,
        inlinePassageIndex:
          initialText !== undefined ? 0 : get().inlinePassageIndex,
        inlineHistory: [text],
        inlineHistoryIndex: 0,
        editorMode: desiredMode,
        plainFormatView: false,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
        ...(desiredMode === 'edit'
          ? {
              activeProfile: null,
              isBusy: false,
              progressPercent: 0,
              statusMessage: '인라인 텍스트 편집 모드',
            }
          : {}),
      });
      if (desiredMode === 'profiled' && text.trim()) {
        await get().runProfileActive();
      } else if (desiredMode === 'profiled') {
        set({ activeProfile: null, statusMessage: '인라인 텍스트 입력 모드' });
      }
    },

    loadSamplePassage: async () => {
      abortAndResetAiSession();
      set({
        activeTargetFileId: null,
        selectedTargetIds: [],
        inlineEditorOpen: true,
        inlineText: SAMPLE_ENGLISH_PASSAGE,
        inlinePassageIndex: 0,
        inlineHistory: [SAMPLE_ENGLISH_PASSAGE],
        inlineHistoryIndex: 0,
        activeMainTab: 'profiler',
        editorMode: 'profiled',
        plainFormatView: false,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
      });
      await get().runProfileActive();
    },

    closeTargetFileById: async (id) => {
      const {
        targetFiles,
        activeTargetFileId,
        fileHistories,
        filePassageIndices,
        selectedTargetIds,
      } = get();
      const target = targetFiles.find((f) => f.id === id);
      if (!target) return;

      const remaining = targetFiles.filter((f) => f.id !== id);
      const nextHistories = { ...fileHistories };
      delete nextHistories[id];
      const nextPassageIndices = { ...filePassageIndices };
      delete nextPassageIndices[id];
      const nextSelected = selectedTargetIds.filter((x) => x !== id);

      if (activeTargetFileId !== id) {
        set({
          targetFiles: remaining,
          fileHistories: nextHistories,
          filePassageIndices: nextPassageIndices,
          selectedTargetIds: nextSelected,
          statsStale: true,
          statusMessage: `'${target.name}' 파일을 닫았습니다.`,
        });
        return;
      }

      abortAndResetAiSession();
      const nextActiveId = remaining[0]?.id ?? null;
      set({
        targetFiles: remaining,
        fileHistories: nextHistories,
        filePassageIndices: nextPassageIndices,
        selectedTargetIds: nextActiveId ? [nextActiveId] : [],
        activeTargetFileId: nextActiveId,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
        statusMessage: `'${target.name}' 파일을 닫았습니다.`,
      });
      await get().runProfileActive();
    },

    removeSelectedTargetFiles: async () => {
      const {
        targetFiles,
        selectedTargetIds,
        activeTargetFileId,
        fileHistories,
        filePassageIndices,
      } = get();
      if (selectedTargetIds.length === 0) return;
      abortAndResetAiSession();
      const removeSet = new Set(selectedTargetIds);
      const remaining = targetFiles.filter((f) => !removeSet.has(f.id));
      const nextHistories = { ...fileHistories };
      const nextPassageIndices = { ...filePassageIndices };
      for (const remId of selectedTargetIds) {
        delete nextHistories[remId];
        delete nextPassageIndices[remId];
      }
      const activeRemoved =
        activeTargetFileId !== null && removeSet.has(activeTargetFileId);
      const nextActiveId = activeRemoved
        ? remaining[0]?.id ?? null
        : activeTargetFileId;

      set({
        targetFiles: remaining,
        fileHistories: nextHistories,
        filePassageIndices: nextPassageIndices,
        selectedTargetIds: nextActiveId ? [nextActiveId] : [],
        activeTargetFileId: nextActiveId,
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsStale: true,
        statusMessage: `${selectedTargetIds.length}개 타겟 파일 닫음`,
      });
      await get().runProfileActive();
    },

    clearAllTargetFiles: async () => {
      abortAndResetAiSession();
      set({
        targetFiles: [],
        fileHistories: {},
        filePassageIndices: {},
        selectedTargetIds: [],
        activeTargetFileId: null,
        editSelectionText: '',
        activeProfile: get().inlineText.trim() ? get().activeProfile : null,
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        ...clearAiResults(),
        statsBundle: null,
        statsStale: true,
        progressPercent: 0,
        statusMessage: '모든 타겟 파일을 닫았습니다.',
      });
      if (get().inlineText.trim()) {
        await get().runProfileActive();
      }
    },

    updateInlineText: (nextText) => {
      const { inlineHistory, inlineHistoryIndex, inlinePassageIndex } = get();
      const current = inlineHistory[inlineHistoryIndex] ?? '';
      if (nextText === current) return;
      const sliced = inlineHistory.slice(0, inlineHistoryIndex + 1);
      const capped = [...sliced.slice(-49), nextText];
      const nextPassages = parsePassageSet(nextText);
      const clampedIdx = Math.max(
        0,
        Math.min(inlinePassageIndex, nextPassages.length - 1),
      );
      set({
        inlineText: nextText,
        inlinePassageIndex: clampedIdx,
        inlineHistory: capped,
        inlineHistoryIndex: capped.length - 1,
        statsStale: true,
      });
    },

    updateActiveEditableText: (nextText) => {
      const st = get();
      if (st.activeTargetFileId === null) {
        st.updateInlineText(nextText);
        return;
      }
      commitActiveDocumentText(nextText);
    },

    setEditSelectionText: (text) => {
      if (get().editSelectionText !== text) {
        set({ editSelectionText: text });
      }
    },

    setActivePassageIndex: async (index) => {
      const st = get();
      const ctx = resolveActivePassageContext(st);
      if (!ctx.isMultiPassage) return;
      const clamped = Math.max(0, Math.min(index, ctx.passages.length - 1));
      if (clamped === ctx.activePassageIndex) return;

      abortAndResetAiSession();
      if (ctx.isInline) {
        set({
          inlinePassageIndex: clamped,
          plainFormatView: false,
          editSelectionText: '',
          selectedWordKey: null,
          selectedRawToken: null,
          selectedTokenSpan: null,
          ...clearAiResults(),
        });
      } else if (ctx.activeFile) {
        set({
          filePassageIndices: {
            ...st.filePassageIndices,
            [ctx.activeFile.id]: clamped,
          },
          plainFormatView: false,
          editSelectionText: '',
          selectedWordKey: null,
          selectedRawToken: null,
          selectedTokenSpan: null,
          ...clearAiResults(),
        });
      }

      if (get().editorMode === 'profiled') {
        await get().runProfileActive();
      }
    },

    stepActivePassage: async (direction) => {
      const ctx = resolveActivePassageContext(get());
      if (!ctx.isMultiPassage) return;
      const target =
        direction === 'prev'
          ? ctx.activePassageIndex - 1
          : ctx.activePassageIndex + 1;
      if (target < 0 || target >= ctx.passages.length) return;
      await get().setActivePassageIndex(target);
    },

    canUndoActiveDocument: () => {
      const st = get();
      if (st.activeTargetFileId === null) {
        return st.inlineHistoryIndex > 0;
      }
      const h = st.fileHistories[st.activeTargetFileId];
      return Boolean(h && h.index > 0);
    },

    canRedoActiveDocument: () => {
      const st = get();
      if (st.activeTargetFileId === null) {
        return st.inlineHistoryIndex < st.inlineHistory.length - 1;
      }
      const h = st.fileHistories[st.activeTargetFileId];
      return Boolean(h && h.index < h.stack.length - 1);
    },

    undoInlineText: () => {
      const st = get();
      if (st.activeTargetFileId === null) {
        if (st.inlineHistoryIndex <= 0) return;
        abortAndResetAiSession();
        const nextIdx = st.inlineHistoryIndex - 1;
        const restored = st.inlineHistory[nextIdx];
        const parsed = parsePassageSet(restored);
        const clampedPassageIdx = Math.max(
          0,
          Math.min(st.inlinePassageIndex, parsed.length - 1),
        );
        set({
          inlineHistoryIndex: nextIdx,
          inlineText: restored,
          inlinePassageIndex: clampedPassageIdx,
          editSelectionText: '',
          selectedWordKey: null,
          selectedRawToken: null,
          selectedTokenSpan: null,
          statsStale: true,
        });
        if (st.editorMode === 'profiled') {
          void get().runProfileActive();
        }
        return;
      }

      const fileId = st.activeTargetFileId;
      const h = st.fileHistories[fileId];
      if (!h || h.index <= 0) return;
      abortAndResetAiSession();
      const nextIdx = h.index - 1;
      const restored = h.stack[nextIdx];
      const parsed = parsePassageSet(restored);
      const clampedPassageIdx = Math.max(
        0,
        Math.min(st.filePassageIndices[fileId] ?? 0, parsed.length - 1),
      );
      set({
        targetFiles: st.targetFiles.map((f) =>
          f.id === fileId
            ? { ...f, content: restored, sizeBytes: new Blob([restored]).size }
            : f,
        ),
        filePassageIndices: {
          ...st.filePassageIndices,
          [fileId]: clampedPassageIdx,
        },
        fileHistories: {
          ...st.fileHistories,
          [fileId]: { ...h, index: nextIdx },
        },
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        statsStale: true,
      });
      if (st.editorMode === 'profiled') {
        void get().runProfileActive();
      }
    },

    redoInlineText: () => {
      const st = get();
      if (st.activeTargetFileId === null) {
        if (st.inlineHistoryIndex >= st.inlineHistory.length - 1) return;
        abortAndResetAiSession();
        const nextIdx = st.inlineHistoryIndex + 1;
        const restored = st.inlineHistory[nextIdx];
        const parsed = parsePassageSet(restored);
        const clampedPassageIdx = Math.max(
          0,
          Math.min(st.inlinePassageIndex, parsed.length - 1),
        );
        set({
          inlineHistoryIndex: nextIdx,
          inlineText: restored,
          inlinePassageIndex: clampedPassageIdx,
          editSelectionText: '',
          selectedWordKey: null,
          selectedRawToken: null,
          selectedTokenSpan: null,
          statsStale: true,
        });
        if (st.editorMode === 'profiled') {
          void get().runProfileActive();
        }
        return;
      }

      const fileId = st.activeTargetFileId;
      const h = st.fileHistories[fileId];
      if (!h || h.index >= h.stack.length - 1) return;
      abortAndResetAiSession();
      const nextIdx = h.index + 1;
      const restored = h.stack[nextIdx];
      const parsed = parsePassageSet(restored);
      const clampedPassageIdx = Math.max(
        0,
        Math.min(st.filePassageIndices[fileId] ?? 0, parsed.length - 1),
      );
      set({
        targetFiles: st.targetFiles.map((f) =>
          f.id === fileId
            ? { ...f, content: restored, sizeBytes: new Blob([restored]).size }
            : f,
        ),
        filePassageIndices: {
          ...st.filePassageIndices,
          [fileId]: clampedPassageIdx,
        },
        fileHistories: {
          ...st.fileHistories,
          [fileId]: { ...h, index: nextIdx },
        },
        editSelectionText: '',
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        statsStale: true,
      });
      if (st.editorMode === 'profiled') {
        void get().runProfileActive();
      }
    },

    applyTokenSpanReplacement: async (startIdx, endIdx, replacementText) => {
      const profile = get().activeProfile;
      if (!profile) return;

      const suggestion = get().combinedSuggestionResult;
      const expectedText = suggestion?.sourceOriginalText ?? profile.originalText;
      const expectedSourceId = suggestion?.sourceId ?? profile.sourceId;
      if (!assertProfileStillCurrent(expectedText, expectedSourceId)) {
        abortAiAndClearLoading();
        set({
          aiError:
            '문서가 변경되어 교체를 적용할 수 없습니다. 다시 프로파일링(F5)하거나 추천을 받아 주세요.',
          aiSuggestionModalOpen: false,
          combinedSuggestionResult: null,
        });
        return;
      }

      const nextDocText = buildReplacedDocumentText(
        profile,
        startIdx,
        endIdx,
        replacementText,
      );
      const changed = commitActiveDocumentText(nextDocText);
      if (!changed) return;

      abortAiAndClearLoading();
      set({
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        aiSuggestionModalOpen: false,
        ...clearAiResults(),
      });
      await get().runProfileActive();
      set({
        statusMessage:
          '본문 교체가 반영되어 어휘 커버리지를 재계산했습니다 (Undo로 되돌리기 가능).',
      });
    },

    replaceAllMatchingWordTokens: async (lookupKey, replacementText) => {
      const profile = get().activeProfile;
      if (!profile || !lookupKey) return 0;

      const suggestion = get().combinedSuggestionResult;
      const expectedText = suggestion?.sourceOriginalText ?? profile.originalText;
      const expectedSourceId = suggestion?.sourceId ?? profile.sourceId;
      if (!assertProfileStillCurrent(expectedText, expectedSourceId)) {
        abortAiAndClearLoading();
        set({
          aiError:
            '문서가 변경되어 교체를 적용할 수 없습니다. 다시 프로파일링(F5)하거나 추천을 받아 주세요.',
          aiSuggestionModalOpen: false,
          combinedSuggestionResult: null,
        });
        return 0;
      }

      let count = 0;
      let nextDocText = profile.leadingWs;
      for (const tok of profile.tokens) {
        if (tok.lookupKey === lookupKey) {
          count += 1;
          nextDocText +=
            sanitizeSingleTokenReplacement(tok.token, replacementText) +
            tok.trailingWs;
        } else {
          nextDocText += tok.token + tok.trailingWs;
        }
      }

      if (count === 0) return 0;
      const changed = commitActiveDocumentText(nextDocText);
      if (!changed) return 0;

      abortAiAndClearLoading();
      set({
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        aiSuggestionModalOpen: false,
        ...clearAiResults(),
      });
      await get().runProfileActive();
      set({
        statusMessage: `동일 어형 ${count}곳을 '${replacementText}'(으)로 일괄 교체했습니다 (Undo 가능).`,
      });
      return count;
    },

    setEditorMode: (mode) => {
      if (mode === 'edit') {
        profileJobEpoch += 1;
        set({ editorMode: 'edit', editSelectionText: '', isBusy: false });
        return;
      }
      set({ editorMode: 'profiled', editSelectionText: '' });
      void get().runProfileActive();
    },

    clearProfileFormat: () => {
      set({
        plainFormatView: true,
        statusMessage: '서식 강조를 초기화했습니다 (Start 또는 F5로 재적용).',
      });
    },

    runProfileActive: async () => {
      const st = get();
      const ctx = resolveActivePassageContext(st);
      const { sourceId, sourceName } = ctx;
      const text = ctx.activePassage.content;

      if (!text.trim()) {
        set({
          activeProfile: null,
          searchMatchTokenIndices: [],
          activeSearchCursor: 0,
          progressPercent: 0,
        });
        return;
      }

      const myEpoch = ++profileJobEpoch;
      set({ isBusy: true, plainFormatView: false });

      try {
        const result = await profilerWorkerClient.profileDocument(
          {
            sourceId,
            sourceName,
            text,
            referenceLists: st.referenceLists,
            ignoreList: st.ignoreList,
            extraIgnoreWords: st.extraIgnoreWords,
            masterList: st.masterList,
            ignoreEnabled: st.ignoreEnabled,
            settings: st.settings,
          },
          (percent) => {
            if (myEpoch === profileJobEpoch) {
              set({ progressPercent: percent });
            }
          },
        );

        if (myEpoch !== profileJobEpoch) return;

        const matches = computeSearchMatches(
          result,
          get().searchQuery,
          get().settings.ignoreCase,
        );

        set({
          activeProfile: result,
          editorMode: 'profiled',
          searchMatchTokenIndices: matches,
          activeSearchCursor: 0,
          isBusy: false,
          progressPercent: 100,
          statusMessage: `프로파일 완료: ${result.sourceName} (${result.totalTypes.toLocaleString()} types, ${result.totalTokens.toLocaleString()} tokens · ${result.elapsedMs} ms)`,
        });
      } catch (err) {
        if (myEpoch !== profileJobEpoch) return;
        set({
          isBusy: false,
          errorBanner:
            err instanceof Error
              ? err.message
              : '프로파일링 중 오류가 발생했습니다.',
        });
      }
    },

    runUpdateStatistics: async () => {
      const st = get();
      if (st.targetFiles.length === 0 && !st.inlineText.trim()) {
        set({
          errorBanner:
            '통계를 계산할 대상 지문이 없습니다. 타겟 파일을 열거나 인라인 텍스트를 입력해 주세요.',
        });
        return;
      }

      const myEpoch = ++statsJobEpoch;
      set({
        isBusy: true,
        progressPercent: 5,
        statusMessage: '6종 코퍼스 통계 테이블 계산 중...',
      });

      try {
        const isViewingInline =
          st.activeTargetFileId === null && st.inlineText.trim().length > 0;
        const inlinePassages = isViewingInline
          ? parsePassageSet(st.inlineText)
          : [];
        const inlineExpandedFiles: TargetFileItem[] =
          isViewingInline && inlinePassages.length > 1
            ? inlinePassages.map((p) => ({
                id: `__inline__#p${p.index}`,
                name: `Inline_Text.txt [${p.index + 1}/${inlinePassages.length} · ${p.label}]`,
                path: `Inline_Text.txt#${p.index + 1}`,
                sourceType: 'inline' as const,
                content: p.content,
                sizeBytes: new Blob([p.content]).size,
                addedAt: Date.now(),
              }))
            : [];

        const bundle = await profilerWorkerClient.computeAllStats(
          {
            targetFiles: isViewingInline
              ? inlineExpandedFiles
              : expandFilesForStatistics(st.targetFiles),
            inlineDraft:
              isViewingInline && inlinePassages.length <= 1
                ? { name: 'Inline_Text.txt', content: st.inlineText }
                : null,
            referenceLists: st.referenceLists,
            ignoreList: st.ignoreList,
            extraIgnoreWords: st.extraIgnoreWords,
            masterList: st.masterList,
            ignoreEnabled: st.ignoreEnabled,
            settings: st.settings,
          },
          (percent, stage) => {
            if (myEpoch === statsJobEpoch) {
              set({ progressPercent: percent, statusMessage: stage });
            }
          },
        );

        if (myEpoch !== statsJobEpoch) return;

        set({
          statsBundle: bundle,
          statsStale: false,
          isBusy: false,
          progressPercent: 100,
          statusMessage: `통계 업데이트 완료 (${bundle.fileHeaders.length}개 문서 · ${bundle.elapsedMs} ms)`,
        });
      } catch (err) {
        if (myEpoch !== statsJobEpoch) return;
        set({
          isBusy: false,
          errorBanner:
            err instanceof Error
              ? err.message
              : '통계 계산 중 오류가 발생했습니다.',
        });
      }
    },

    runValidateLists: async () => {
      const st = get();
      const activeCount = st.referenceLists.filter((r) => r.enabled).length;
      if (activeCount === 0) {
        set({
          errorBanner: '검증할 활성 레퍼런스 리스트가 없습니다.',
        });
        return;
      }

      set({ isBusy: true, statusMessage: '레벨 리스트 중복 어형 검증 중...' });
      try {
        const res = await profilerWorkerClient.validateLists({
          referenceLists: st.referenceLists,
          masterList: st.masterList,
          settings: st.settings,
        });
        set({
          isBusy: false,
          validationModal: {
            duplicates: res.duplicates,
            checkedListCount: activeCount,
            elapsedMs: res.elapsedMs,
          },
          statusMessage:
            res.duplicates.length === 0
              ? '검증 완료: 중복 어형이 없습니다.'
              : `검증 완료: ${res.duplicates.length.toLocaleString()}건의 리스트 간 중복 어형 발견`,
        });
      } catch (err) {
        set({
          isBusy: false,
          errorBanner: err instanceof Error ? err.message : String(err),
        });
      }
    },

    clearTokenSelection: () => {
      cancelActiveAiCall();
      set({
        selectedRawToken: null,
        selectedWordKey: null,
        selectedTokenSpan: null,
        aiLoading: false,
        aiError: null,
        aiSuggestionModalOpen: false,
        ...clearAiResults(),
      });
    },

    selectTokenInstance: (tokenIdx, options) => {
      const st = get();
      const profile = st.activeProfile;
      if (!profile || tokenIdx < 0 || tokenIdx >= profile.tokens.length) {
        return;
      }

      const tok = profile.tokens[tokenIdx];
      const prevSpan = st.selectedTokenSpan;
      const isMultiSpan = Boolean(
        prevSpan && prevSpan.endTokenIdx > prevSpan.startTokenIdx,
      );
      const isSameSingleToken = Boolean(
        !isMultiSpan &&
          ((prevSpan !== null && prevSpan.startTokenIdx === tokenIdx) ||
            (prevSpan === null && st.selectedWordKey === tok.lookupKey)),
      );

      if (options?.toggleIfSelected && isSameSingleToken) {
        get().clearTokenSelection();
        return;
      }

      if (!isSameSingleToken) {
        cancelActiveAiCall();
      }

      set({
        selectedRawToken: tok.token,
        selectedWordKey: tok.lookupKey,
        selectedTokenSpan: {
          startTokenIdx: tokenIdx,
          endTokenIdx: tokenIdx,
          rawText: tok.token,
        },
        ...(isSameSingleToken
          ? {}
          : {
              aiLoading: false,
              aiError: null,
              aiSuggestionModalOpen: false,
              ...clearAiResults(),
            }),
      });
    },

    selectTokenRange: (startIdx, endIdx) => {
      const st = get();
      const profile = st.activeProfile;
      if (!profile || profile.tokens.length === 0) return;

      const lo = Math.max(0, Math.min(startIdx, endIdx, profile.tokens.length - 1));
      const hi = Math.max(
        lo,
        Math.min(Math.max(startIdx, endIdx), profile.tokens.length - 1),
      );

      if (lo === hi) {
        get().selectTokenInstance(lo);
        return;
      }

      cancelActiveAiCall();
      const rawText = sliceProfileSpanText(profile, lo, hi, false);
      const anchorTok =
        profile.tokens.slice(lo, hi + 1).find((t) => t.kind === 'out') ??
        profile.tokens[lo];

      set({
        selectedRawToken: rawText,
        selectedWordKey: anchorTok.lookupKey,
        selectedTokenSpan: {
          startTokenIdx: lo,
          endTokenIdx: hi,
          rawText,
        },
        inspectorTab: 'ai',
        aiLoading: false,
        aiError: null,
        aiSuggestionModalOpen: false,
        ...clearAiResults(),
      });
    },

    selectWordForInspector: (rawToken) => {
      if (!rawToken || !rawToken.trim()) {
        cancelActiveAiCall();
        set({
          selectedWordKey: null,
          selectedRawToken: null,
          selectedTokenSpan: null,
          aiLoading: false,
          aiSuggestionModalOpen: false,
          ...clearAiResults(),
        });
        return;
      }
      const cleaned = rawToken.trim();
      const key = get().settings.ignoreCase ? cleaned.toLowerCase() : cleaned;
      const profile = get().activeProfile;
      const hitIdx = profile
        ? profile.tokens.findIndex((t) => t.lookupKey === key)
        : -1;

      if (hitIdx >= 0) {
        get().selectTokenInstance(hitIdx);
        return;
      }

      set({
        selectedRawToken: cleaned,
        selectedWordKey: key,
        selectedTokenSpan: null,
      });
    },

    setSearchQuery: (q) => {
      const matches = computeSearchMatches(
        get().activeProfile,
        q,
        get().settings.ignoreCase,
      );
      set({
        searchQuery: q,
        searchMatchTokenIndices: matches,
        activeSearchCursor: 0,
      });
    },

    stepSearchMatch: (direction) => {
      const { searchMatchTokenIndices, activeSearchCursor } = get();
      if (searchMatchTokenIndices.length === 0) return;
      const len = searchMatchTokenIndices.length;
      const next =
        direction === 'next'
          ? (activeSearchCursor + 1) % len
          : (activeSearchCursor - 1 + len) % len;
      set({ activeSearchCursor: next });
    },

    updateSettings: async (patch) => {
      const prev = get().settings;
      const next = { ...prev, ...patch };
      const affectsLexiconOrTokens =
        patch.tokenDefinition !== undefined ||
        patch.ignoreCase !== undefined ||
        patch.nationFormat !== undefined ||
        patch.stripCurriculumAnnotations !== undefined;
      const affectsTokens =
        patch.tokenDefinition !== undefined || patch.ignoreCase !== undefined;

      if (affectsLexiconOrTokens) {
        abortAndResetAiSession();
      }

      set({
        settings: next,
        statsStale: true,
        ...(affectsTokens
          ? {
              selectedWordKey: null,
              selectedRawToken: null,
              selectedTokenSpan: null,
            }
          : {}),
      });
      persistSnapshot();

      if (affectsLexiconOrTokens) {
        await get().runProfileActive();
      }
      if (
        get().activeMainTab === 'statistics' &&
        (affectsLexiconOrTokens || patch.showFullPathsInStats !== undefined) &&
        (get().targetFiles.length > 0 || get().inlineText.trim().length > 0)
      ) {
        await get().runUpdateStatistics();
      }
    },

    resetDefaultSettings: async () => {
      abortAndResetAiSession();
      set({
        settings: { ...DEFAULT_SETTINGS },
        selectedWordKey: null,
        selectedRawToken: null,
        selectedTokenSpan: null,
        statsStale: true,
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    adjustFontSize: (delta) => {
      const cur = get().settings.fontSizePx;
      const next = Math.min(32, Math.max(14, cur + delta));
      set((st) => ({ settings: { ...st.settings, fontSizePx: next } }));
      persistSnapshot();
    },

    setSettingsModalOpen: (open, section) =>
      set((st) => ({
        settingsModalOpen: open,
        settingsInitialSection: section ?? st.settingsInitialSection,
      })),

    setHelpModalTab: (tab) => set({ helpModalTab: tab }),

    openCoverageModalForKey: (key) => {
      const profile = get().activeProfile;
      if (!profile) {
        set({
          coverageModal: {
            title: 'Coverage Results',
            subtitle: '현재 프로파일링된 텍스트가 없습니다.',
            words: [],
          },
        });
        return;
      }

      if (key === '__ignored__') {
        const s = profile.ignoredSummary;
        set({
          coverageModal: {
            title: 'Coverage Results: ignored',
            subtitle: `${s.typeCount.toLocaleString()} types · ${s.tokenCount.toLocaleString()} tokens (${s.percentage.toFixed(2)}%)`,
            words: s.words,
          },
        });
        return;
      }

      if (key === '__out__') {
        const s = profile.outSummary;
        set({
          coverageModal: {
            title: 'Coverage Results: not in lists',
            subtitle: `${s.typeCount.toLocaleString()} types · ${s.tokenCount.toLocaleString()} tokens (${s.percentage.toFixed(2)}%)`,
            words: s.words,
          },
        });
        return;
      }

      const s = profile.levelSummaries[key];
      if (!s) return;
      set({
        coverageModal: {
          title: `Coverage Results: ${s.listName}`,
          subtitle: `${s.typeCount.toLocaleString()} types · ${s.headwordCount.toLocaleString()} headwords · ${s.tokenCount.toLocaleString()} tokens (${s.percentage.toFixed(2)}%)`,
          words: s.words,
        },
      });
    },

    closeCoverageModal: () => set({ coverageModal: null }),
    closeValidationModal: () => set({ validationModal: null }),

    // AI Assistant Actions
    updateOpenRouterConfig: (next) => {
      aiSuggestionCache.clear();
      const saved = saveOpenRouterConfig(next);
      set({ openRouterConfig: saved, aiError: null });
    },

    clearOpenRouterKey: () => {
      const cleared = clearOpenRouterApiKey(get().openRouterConfig);
      set({ openRouterConfig: cleared });
    },

    clearGeminiKey: () => {
      const cleared = clearGeminiApiKey(get().openRouterConfig);
      set({ openRouterConfig: cleared });
    },

    cancelAiRequest: () => {
      abortAiAndClearLoading();
    },

    openAiSuggestionModal: async (options) => {
      const st = get();
      if (!st.activeProfile || !st.selectedTokenSpan) {
        set({
          aiError: '먼저 본문에서 단어를 클릭하거나 표현을 드래그해 주세요.',
        });
        return;
      }
      if (!hasActiveAiApiKey(st.openRouterConfig)) {
        set({
          aiError:
            'AI API 키가 설정되지 않았습니다. Settings > AI Assistant에서 무료 Gemini API 키 또는 OpenRouter API 키를 입력해 주세요.',
          settingsModalOpen: true,
          settingsInitialSection: 'ai',
        });
        return;
      }
      if (st.referenceLists.filter((r) => r.enabled).length === 0) {
        set({
          aiError:
            '활성 Reference List가 없습니다. 왼쪽에서 단어장을 추가하거나 활성화한 뒤 다시 시도해 주세요.',
        });
        return;
      }

      cancelActiveAiCall();

      const profile = st.activeProfile;
      const span = st.selectedTokenSpan;
      const sourceOriginalText = profile.originalText;
      const sourceId = profile.sourceId;

      const verifierCtx = getVerifierContext({
        referenceLists: st.referenceLists,
        ignoreList: st.ignoreList,
        extraIgnoreWords: st.extraIgnoreWords,
        masterList: st.masterList,
        ignoreEnabled: st.ignoreEnabled,
        settings: st.settings,
        includeExtendedMetadata: false,
      });

      const activeProvider = getActiveAiProvider(st.openRouterConfig);
      const activeModelId = getActiveAiModelId(st.openRouterConfig);
      const textSig = `${sourceOriginalText.length}:${sourceOriginalText.slice(0, 64)}:${sourceOriginalText.slice(-64)}`;
      const cacheKey = `v2|${sourceId}|${textSig}|${span.startTokenIdx}:${span.endTokenIdx}|${activeProvider}:${activeModelId}|${verifierCtx.cacheKey}`;

      if (options?.forceRefresh !== true) {
        const cached = aiSuggestionCache.get(cacheKey);
        if (cached) {
          set({
            aiSuggestionModalOpen: true,
            inspectorTab: 'ai',
            aiLoading: false,
            aiError: null,
            combinedSuggestionResult: cached,
          });
          return;
        }
      }

      const controller = new AbortController();
      activeAiAbortController = controller;

      set({
        aiSuggestionModalOpen: true,
        inspectorTab: 'ai',
        aiLoading: true,
        aiError: null,
        combinedSuggestionResult: null,
      });

      try {
        const res = await suggestReplacementsAndParaphrases({
          profile,
          spanStartIdx: span.startTokenIdx,
          spanEndIdx: span.endTokenIdx,
          targetMaxLevel: activeReferenceLevelCap(st.referenceLists),
          verifierCtx,
          config: st.openRouterConfig,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        if (
          !assertProfileStillCurrent(res.sourceOriginalText, res.sourceId)
        ) {
          set({
            aiLoading: false,
            aiError:
              '문서가 변경되어 추천 결과를 표시하지 않습니다. 다시 추천해 주세요.',
            combinedSuggestionResult: null,
          });
          return;
        }

        if (aiSuggestionCache.has(cacheKey)) {
          aiSuggestionCache.delete(cacheKey);
        } else if (aiSuggestionCache.size >= MAX_AI_SUGGESTION_CACHE) {
          const oldestKey = aiSuggestionCache.keys().next().value;
          if (oldestKey !== undefined) {
            aiSuggestionCache.delete(oldestKey);
          }
        }
        aiSuggestionCache.set(cacheKey, res);

        set({ combinedSuggestionResult: res, aiLoading: false });
      } catch (err) {
        if (controller.signal.aborted) return;
        set({
          aiLoading: false,
          aiError:
            err instanceof Error
              ? err.message
              : 'AI 추천을 가져오는 중 오류가 발생했습니다.',
        });
      } finally {
        if (activeAiAbortController === controller) {
          activeAiAbortController = null;
        }
      }
    },

    closeAiSuggestionModal: () => {
      abortAiAndClearLoading();
      set({ aiSuggestionModalOpen: false });
    },

    runAiMorphologyCheck: async () => {
      const st = get();
      if (!st.activeProfile || !st.selectedTokenSpan) {
        set({ aiError: '먼저 본문에서 분석할 단어를 클릭해 주세요.' });
        return;
      }
      if (!hasActiveAiApiKey(st.openRouterConfig)) {
        set({
          aiError:
            'AI API 키가 설정되지 않았습니다. Settings > AI Assistant에서 무료 Gemini API 키 또는 OpenRouter API 키를 입력해 주세요.',
          settingsModalOpen: true,
          settingsInitialSection: 'ai',
        });
        return;
      }
      if (st.referenceLists.filter((r) => r.enabled).length === 0) {
        set({
          aiError:
            '활성 Reference List가 없습니다. 왼쪽에서 단어장을 추가하거나 활성화한 뒤 다시 시도해 주세요.',
        });
        return;
      }

      cancelActiveAiCall();
      const controller = new AbortController();
      activeAiAbortController = controller;

      const sourceOriginalText = st.activeProfile.originalText;
      const sourceId = st.activeProfile.sourceId;
      const tokenIdx = st.selectedTokenSpan.startTokenIdx;

      set({
        inspectorTab: 'ai',
        aiLoading: true,
        aiError: null,
      });

      try {
        const builtinMaster = await ensureBuiltinMasterRaw();
        if (controller.signal.aborted) return;

        const latest = get();
        const profile = latest.activeProfile;
        if (
          !profile ||
          profile.sourceId !== sourceId ||
          profile.originalText !== sourceOriginalText
        ) {
          set({
            aiLoading: false,
            aiError:
              '문서가 변경되어 분석을 시작할 수 없습니다. 단어를 다시 선택한 뒤 시도해 주세요.',
          });
          return;
        }
        if (
          tokenIdx < 0 ||
          tokenIdx >= profile.tokens.length ||
          latest.referenceLists.filter((r) => r.enabled).length === 0
        ) {
          set({
            aiLoading: false,
            aiError:
              '선택 상태나 활성 단어장이 바뀌어 분석을 진행할 수 없습니다.',
          });
          return;
        }

        const verifierCtx = getVerifierContext({
          referenceLists: latest.referenceLists,
          ignoreList: latest.ignoreList,
          extraIgnoreWords: latest.extraIgnoreWords,
          masterList: latest.masterList,
          builtinMasterRawContent: builtinMaster,
          ignoreEnabled: latest.ignoreEnabled,
          settings: latest.settings,
        });

        const res = await analyzeMorphologyAndRoots({
          profile,
          tokenIdx,
          targetMaxLevel: activeReferenceLevelCap(latest.referenceLists),
          verifierCtx,
          config: latest.openRouterConfig,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        set({ morphologyResult: res, aiLoading: false });
      } catch (err) {
        if (controller.signal.aborted) return;
        set({
          aiLoading: false,
          aiError:
            err instanceof Error
              ? err.message
              : '어근·기본형 분석 중 오류가 발생했습니다.',
        });
      } finally {
        if (activeAiAbortController === controller) {
          activeAiAbortController = null;
        }
      }
    },
  };
});

// Start fetching manifest + active preset immediately on module evaluation in browser
if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof fetch === 'function'
) {
  void useProfilerStore.getState().initializeApp();
}

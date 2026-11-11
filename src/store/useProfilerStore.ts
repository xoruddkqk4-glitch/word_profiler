import { create } from 'zustand';
import {
  DEFAULT_IGNORE_COLOR,
  DEFAULT_OUT_HIGHLIGHT_COLOR,
  getDefaultLevelColorPair,
  type LevelColorPair,
} from '../core/colorPalette';
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
    if ((parsed.prefsVersion ?? 1) < PREFS_SCHEMA_VERSION && mergedSettings.fontSizePx <= 16) {
      mergedSettings.fontSizePx = DEFAULT_SETTINGS.fontSizePx;
    }
    return {
      prefsVersion: PREFS_SCHEMA_VERSION,
      theme: parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : fallback.theme,
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

const fetchedTextCache = new Map<string, string>();

async function fetchStaticText(url: string): Promise<string> {
  const hit = fetchedTextCache.get(url);
  if (hit !== undefined) return hit;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`단어장 파일을 불러오지 못했습니다 (${res.status}): ${url}`);
  }
  const text = (await res.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  fetchedTextCache.set(url, text);
  return text;
}

let profileJobEpoch = 0;
let statsJobEpoch = 0;

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

  // Navigation
  activeMainTab: MainTabId;
  activeStatsSubTab: StatsSubTabId;

  // Target Corpus & Inline Editor
  targetFiles: TargetFileItem[];
  selectedTargetIds: string[];
  activeTargetFileId: string | null; // null = inline text mode
  inlineText: string;
  inlineHistory: string[];
  inlineHistoryIndex: number;
  editorMode: 'profiled' | 'edit';
  plainFormatView: boolean; // Clear Format state

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

  // Profile & Stats Outputs
  activeProfile: DocumentProfileResult | null;
  selectedWordKey: string | null;
  selectedRawToken: string | null;
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
  helpModalTab: 'guide' | 'shortcuts' | 'about' | null;
  coverageModal: CoverageModalPayload | null;
  validationModal: ValidationModalPayload | null;

  // Actions
  initializeApp: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveMainTab: (tab: MainTabId) => void;
  setActiveStatsSubTab: (subTab: StatsSubTabId) => void;
  dismissErrorBanner: () => void;
  setErrorBanner: (msg: string) => void;

  // Presets & Lists
  applyPreset: (presetId: string) => Promise<void>;
  addBundledReferenceList: (manifestListId: string) => Promise<void>;
  addCustomReferenceLists: (
    lists: { name: string; path: string; content: string }[],
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
  loadCustomIgnoreList: (name: string, path: string, content: string) => Promise<void>;
  closeIgnoreListFile: () => Promise<void>;
  toggleBuiltinMasterList: (enable: boolean) => Promise<void>;
  loadCustomMasterList: (name: string, path: string, content: string) => Promise<void>;
  closeMasterList: () => Promise<void>;

  // Extra Ignore Words
  addExtraIgnoreWord: (word: string) => Promise<void>;
  removeExtraIgnoreWords: (words: string[]) => Promise<void>;
  clearAllExtraIgnoreWords: () => Promise<void>;
  pasteIntoExtraIgnoreWords: (rawText: string) => Promise<{ added: number; skippedInLists: number }>;

  // Target Files & Inline Text
  addTargetFiles: (items: TargetFileItem[]) => Promise<void>;
  setSelectedTargetIds: (ids: string[]) => void;
  openTargetFileInProfiler: (id: string) => Promise<void>;
  switchToInlineEditor: (initialText?: string) => Promise<void>;
  loadSamplePassage: () => Promise<void>;
  removeSelectedTargetFiles: () => Promise<void>;
  clearAllTargetFiles: () => Promise<void>;

  updateInlineText: (nextText: string) => void;
  undoInlineText: () => void;
  redoInlineText: () => void;
  setEditorMode: (mode: 'profiled' | 'edit') => void;
  clearProfileFormat: () => void;

  // Execution & Search & Selection
  runProfileActive: () => Promise<void>;
  runUpdateStatistics: () => Promise<void>;
  runValidateLists: () => Promise<void>;
  selectWordForInspector: (rawToken: string | null) => void;
  setSearchQuery: (q: string) => void;
  stepSearchMatch: (direction: 'next' | 'prev') => void;

  // Settings & Modals
  updateSettings: (patch: Partial<ProfilerSettings>) => Promise<void>;
  resetDefaultSettings: () => Promise<void>;
  AdjustFontSize: (delta: number) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setHelpModalTab: (tab: 'guide' | 'shortcuts' | 'about' | null) => void;
  openCoverageModalForKey: (key: string) => void;
  closeCoverageModal: () => void;
  closeValidationModal: () => void;
}

function computeSearchMatches(
  profile: DocumentProfileResult | null,
  query: string,
  ignoreCase: boolean,
): number[] {
  if (!profile || !query.trim()) return [];
  const q = query.trim();
  let regex: RegExp;
  try {
    regex = new RegExp(`^${q}$`, ignoreCase ? 'iu' : 'u');
  } catch {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, ignoreCase ? 'iu' : 'u');
  }

  const hits: number[] = [];
  for (let i = 0; i < profile.tokens.length; i++) {
    if (regex.test(profile.tokens[i].token)) {
      hits.push(i);
    }
  }
  return hits;
}

const initialPrefs = loadPersistedPrefs();

export const useProfilerStore = create<ProfilerStoreState>((set, get) => {
  const persistSnapshot = () => {
    const st = get();
    savePersistedPrefs({
      theme: st.theme,
      settings: st.settings,
      activePresetId: st.activePresetId ?? 'custom',
      extraIgnoreWords: st.extraIgnoreWords,
    });
  };

  return {
    initialized: false,
    theme: initialPrefs.theme,
    manifest: null,
    activePresetId: initialPrefs.activePresetId,

    activeMainTab: initialPrefs.settings.defaultTab,
    activeStatsSubTab: 'coverage',

    targetFiles: [],
    selectedTargetIds: [],
    activeTargetFileId: null,
    inlineText: '',
    inlineHistory: [''],
    inlineHistoryIndex: 0,
    editorMode: 'edit',
    plainFormatView: false,

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
    helpModalTab: null,
    coverageModal: null,
    validationModal: null,

    initializeApp: async () => {
      if (get().initialized) return;
      const curTheme = get().theme;
      document.documentElement.dataset.theme = curTheme;
      document.documentElement.classList.toggle('dark', curTheme === 'dark');
      set({ isBusy: true, statusMessage: '내장 단어장 매니페스트 로드 중...' });

      try {
        const res = await fetch('/wordlists/manifest.json');
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

    dismissErrorBanner: () => set({ errorBanner: null }),
    setErrorBanner: (msg) => set({ errorBanner: msg }),

    applyPreset: async (presetId) => {
      const { manifest } = get();
      if (!manifest) return;
      const preset = manifest.presets.find((p) => p.id === presetId);
      if (!preset) return;

      set({
        isBusy: true,
        progressPercent: 15,
        statusMessage: `'${preset.shortLabel}' 단어장 로드 중...`,
      });

      try {
        const listEntries = preset.listIds
          .map((id) => manifest.lists.find((l) => l.id === id))
          .filter((x): x is NonNullable<typeof x> => Boolean(x));

        const contents = await Promise.all(
          listEntries.map((entry) => fetchStaticText(entry.url)),
        );

        const nextRefs: ReferenceListSource[] = listEntries.map((entry, idx) => {
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
        });

        let nextMaster = get().masterList;
        if (preset.enableBuiltinMaster) {
          const masterText = await fetchStaticText(
            manifest.auxiliary.builtinMasterFamilies.url,
          );
          nextMaster = {
            enabled: true,
            name: manifest.auxiliary.builtinMasterFamilies.name,
            path: manifest.auxiliary.builtinMasterFamilies.url,
            content: masterText,
            isBuiltin: true,
          };
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
        if (st.activeMainTab === 'statistics' && (st.targetFiles.length > 0 || st.inlineText.trim().length > 0)) {
          await st.runUpdateStatistics();
        }
      } catch (err) {
        set({
          isBusy: false,
          errorBanner:
            err instanceof Error ? err.message : '프리셋 로드 중 오류가 발생했습니다.',
        });
      }
    },

    addBundledReferenceList: async (manifestListId) => {
      const { manifest, referenceLists } = get();
      if (!manifest) return;
      const entry = manifest.lists.find((l) => l.id === manifestListId);
      if (!entry) return;

      set({ isBusy: true, statusMessage: `${entry.name} 추가 중...` });
      try {
        const content = await fetchStaticText(entry.url);
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
        set({
          activePresetId: null,
          referenceLists: [...referenceLists, added],
          statsStale: true,
          isBusy: false,
          statusMessage: `레퍼런스 리스트 추가됨: ${entry.name}`,
        });
        persistSnapshot();
        await get().runProfileActive();
      } catch (err) {
        set({
          isBusy: false,
          errorBanner: err instanceof Error ? err.message : String(err),
        });
      }
    },

    addCustomReferenceLists: async (lists) => {
      if (lists.length === 0) return;
      const current = get().referenceLists;
      const additions: ReferenceListSource[] = lists.map((l, i) => {
        const pair = getDefaultLevelColorPair(current.length + i);
        return {
          id: `custom-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: l.name,
          displayName: l.name,
          path: l.path,
          content: l.content,
          enabled: true,
          colorLight: pair.light,
          colorDark: pair.dark,
          isBuiltin: false,
        };
      });

      set({
        activePresetId: null,
        referenceLists: [...current, ...additions],
        statsStale: true,
        statusMessage: `${additions.length}개 사용자 레퍼런스 리스트 추가됨`,
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    toggleReferenceList: async (id) => {
      set((st) => ({
        referenceLists: st.referenceLists.map((r) =>
          r.id === id ? { ...r, enabled: !r.enabled } : r,
        ),
        statsStale: true,
      }));
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
      set({ activePresetId: null, referenceLists: list, statsStale: true });
      await get().runProfileActive();
    },

    setReferenceListColor: (id, hexColor) => {
      const theme = get().theme;
      set((st) => ({
        referenceLists: st.referenceLists.map((r) =>
          r.id === id
            ? theme === 'dark'
              ? { ...r, colorDark: hexColor }
              : { ...r, colorLight: hexColor }
            : r,
        ),
      }));
    },

    closeDeactivatedReferenceLists: async () => {
      const kept = get().referenceLists.filter((r) => r.enabled);
      set({
        activePresetId: null,
        referenceLists: kept,
        statsStale: true,
        statusMessage: '비활성 레퍼런스 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    closeAllReferenceLists: async () => {
      set({
        activePresetId: null,
        referenceLists: [],
        statsStale: true,
        statusMessage: '모든 레퍼런스 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    removeReferenceList: async (id) => {
      set((st) => ({
        activePresetId: null,
        referenceLists: st.referenceLists.filter((r) => r.id !== id),
        statsStale: true,
      }));
      await get().runProfileActive();
    },

    setIgnoreEnabled: async (enabled) => {
      set({ ignoreEnabled: enabled, statsStale: true });
      await get().runProfileActive();
    },

    setIgnoreColor: (hexColor) => {
      const theme = get().theme;
      set((st) => ({
        ignoreColor:
          theme === 'dark'
            ? { ...st.ignoreColor, dark: hexColor }
            : { ...st.ignoreColor, light: hexColor },
      }));
    },

    setOutColor: (hexColor) => {
      const theme = get().theme;
      set((st) => ({
        outColor:
          theme === 'dark'
            ? { ...st.outColor, dark: hexColor }
            : { ...st.outColor, light: hexColor },
      }));
    },

    loadCustomIgnoreList: async (name, path, content) => {
      set({
        ignoreList: { enabled: true, name, path, content, isBuiltin: false },
        ignoreEnabled: true,
        statsStale: true,
        statusMessage: `Ignore 리스트 적용됨: ${name}`,
      });
      await get().runProfileActive();
    },

    closeIgnoreListFile: async () => {
      set({
        ignoreList: { enabled: false, name: 'ignore_list', path: '', content: '' },
        statsStale: true,
        statusMessage: 'Ignore 리스트 파일을 닫았습니다.',
      });
      await get().runProfileActive();
    },

    toggleBuiltinMasterList: async (enable) => {
      const { manifest } = get();
      if (!enable) {
        set({
          masterList: { enabled: false, name: 'master_list', path: '', content: '' },
          statsStale: true,
          statusMessage: 'Master 패밀리 확장이 해제되었습니다.',
        });
        await get().runProfileActive();
        return;
      }
      if (!manifest) return;
      set({ isBusy: true, statusMessage: '내장 Master 패밀리 사전 로드 중...' });
      try {
        const content = await fetchStaticText(
          manifest.auxiliary.builtinMasterFamilies.url,
        );
        set({
          masterList: {
            enabled: true,
            name: manifest.auxiliary.builtinMasterFamilies.name,
            path: manifest.auxiliary.builtinMasterFamilies.url,
            content,
            isBuiltin: true,
          },
          isBusy: false,
          statsStale: true,
          statusMessage: '내장 Master 패밀리 사전(3,461 패밀리) 활성화됨',
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
      set({
        masterList: { enabled: true, name, path, content, isBuiltin: false },
        statsStale: true,
        statusMessage: `사용자 Master 리스트 적용됨: ${name}`,
      });
      await get().runProfileActive();
    },

    closeMasterList: async () => {
      set({
        masterList: { enabled: false, name: 'master_list', path: '', content: '' },
        statsStale: true,
        statusMessage: 'Master 리스트를 닫았습니다.',
      });
      await get().runProfileActive();
    },

    addExtraIgnoreWord: async (word) => {
      const norm = get().settings.ignoreCase ? word.trim().toLowerCase() : word.trim();
      if (!norm) return;
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
      set({
        extraIgnoreWords: [],
        statsStale: true,
        statusMessage: 'Extra Ignore Words를 모두 비웠습니다.',
      });
      persistSnapshot();
      await get().runProfileActive();
    },

    pasteIntoExtraIgnoreWords: async (rawText) => {
      const st = get();
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
      const firstId = items[0].id;
      set({
        targetFiles: next,
        selectedTargetIds: [firstId],
        activeTargetFileId: firstId,
        editorMode: 'profiled',
        plainFormatView: false,
        statsStale: true,
        statusMessage: `${items.length}개 타겟 파일 로드됨`,
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
      set({
        activeTargetFileId: id,
        selectedTargetIds: [id],
        activeMainTab: 'profiler',
        editorMode: 'profiled',
        plainFormatView: false,
        selectedWordKey: null,
        selectedRawToken: null,
      });
      await get().runProfileActive();
    },

    switchToInlineEditor: async (initialText) => {
      const text = initialText !== undefined ? initialText : get().inlineText;
      set({
        activeTargetFileId: null,
        selectedTargetIds: [],
        inlineText: text,
        inlineHistory: [text],
        inlineHistoryIndex: 0,
        editorMode: text.trim() ? 'profiled' : 'edit',
        plainFormatView: false,
        selectedWordKey: null,
        selectedRawToken: null,
        statsStale: true,
      });
      if (text.trim()) {
        await get().runProfileActive();
      } else {
        set({ activeProfile: null, statusMessage: '인라인 텍스트 입력 모드' });
      }
    },

    loadSamplePassage: async () => {
      set({
        activeTargetFileId: null,
        selectedTargetIds: [],
        inlineText: SAMPLE_ENGLISH_PASSAGE,
        inlineHistory: [SAMPLE_ENGLISH_PASSAGE],
        inlineHistoryIndex: 0,
        activeMainTab: 'profiler',
        editorMode: 'profiled',
        plainFormatView: false,
        statsStale: true,
      });
      await get().runProfileActive();
    },

    removeSelectedTargetFiles: async () => {
      const { targetFiles, selectedTargetIds, activeTargetFileId } = get();
      if (selectedTargetIds.length === 0) return;
      const removeSet = new Set(selectedTargetIds);
      const remaining = targetFiles.filter((f) => !removeSet.has(f.id));
      const activeRemoved =
        activeTargetFileId !== null && removeSet.has(activeTargetFileId);
      const nextActiveId = activeRemoved
        ? remaining[0]?.id ?? null
        : activeTargetFileId;

      set({
        targetFiles: remaining,
        selectedTargetIds: nextActiveId ? [nextActiveId] : [],
        activeTargetFileId: nextActiveId,
        statsStale: true,
        statusMessage: `${selectedTargetIds.length}개 타겟 파일 닫음`,
      });
      await get().runProfileActive();
    },

    clearAllTargetFiles: async () => {
      set({
        targetFiles: [],
        selectedTargetIds: [],
        activeTargetFileId: null,
        activeProfile: get().inlineText.trim() ? get().activeProfile : null,
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
      const { inlineHistory, inlineHistoryIndex } = get();
      const current = inlineHistory[inlineHistoryIndex] ?? '';
      if (nextText === current) return;
      const sliced = inlineHistory.slice(0, inlineHistoryIndex + 1);
      const capped = [...sliced.slice(-49), nextText];
      set({
        inlineText: nextText,
        inlineHistory: capped,
        inlineHistoryIndex: capped.length - 1,
        statsStale: true,
      });
    },

    undoInlineText: () => {
      const { inlineHistory, inlineHistoryIndex, activeTargetFileId } = get();
      if (activeTargetFileId !== null || inlineHistoryIndex <= 0) return;
      const nextIdx = inlineHistoryIndex - 1;
      set({
        inlineHistoryIndex: nextIdx,
        inlineText: inlineHistory[nextIdx],
        statsStale: true,
      });
    },

    redoInlineText: () => {
      const { inlineHistory, inlineHistoryIndex, activeTargetFileId } = get();
      if (
        activeTargetFileId !== null ||
        inlineHistoryIndex >= inlineHistory.length - 1
      ) {
        return;
      }
      const nextIdx = inlineHistoryIndex + 1;
      set({
        inlineHistoryIndex: nextIdx,
        inlineText: inlineHistory[nextIdx],
        statsStale: true,
      });
    },

    setEditorMode: (mode) => {
      set({ editorMode: mode });
      if (mode === 'profiled') {
        void get().runProfileActive();
      }
    },

    clearProfileFormat: () => {
      set({
        plainFormatView: true,
        statusMessage: '서식 강조를 초기화했습니다 (Start 또는 F5로 재적용).',
      });
    },

    runProfileActive: async () => {
      const st = get();
      const activeFile = st.activeTargetFileId
        ? st.targetFiles.find((f) => f.id === st.activeTargetFileId) ?? null
        : null;

      const sourceId = activeFile ? activeFile.id : '__inline__';
      const sourceName = activeFile ? activeFile.name : 'Inline Text';
      const text = activeFile ? activeFile.content : st.inlineText;

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
            err instanceof Error ? err.message : '프로파일링 중 오류가 발생했습니다.',
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
        const bundle = await profilerWorkerClient.computeAllStats(
          {
            targetFiles: st.targetFiles,
            inlineDraft:
              st.targetFiles.length === 0
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
            err instanceof Error ? err.message : '통계 계산 중 오류가 발생했습니다.',
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

    selectWordForInspector: (rawToken) => {
      if (!rawToken || !rawToken.trim()) {
        set({ selectedWordKey: null, selectedRawToken: null });
        return;
      }
      const cleaned = rawToken.trim();
      const key = get().settings.ignoreCase ? cleaned.toLowerCase() : cleaned;
      set({ selectedRawToken: cleaned, selectedWordKey: key });
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
      set({ settings: next, statsStale: true });
      persistSnapshot();

      const affectsLexiconOrTokens =
        patch.tokenDefinition !== undefined ||
        patch.ignoreCase !== undefined ||
        patch.nationFormat !== undefined ||
        patch.stripCurriculumAnnotations !== undefined;

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
      set({ settings: { ...DEFAULT_SETTINGS }, statsStale: true });
      persistSnapshot();
      await get().runProfileActive();
    },

    AdjustFontSize: (delta) => {
      const cur = get().settings.fontSizePx;
      const next = Math.min(32, Math.max(14, cur + delta));
      set((st) => ({ settings: { ...st.settings, fontSizePx: next } }));
      persistSnapshot();
    },

    setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
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
  };
});


export type MainTabId = 'profiler' | 'statistics';

export type StatsSubTabId =
  | 'input_files'
  | 'level_lists'
  | 'coverage'
  | 'range'
  | 'types'
  | 'headwords';

export type ListFormatMode = 'auto' | 'rows' | 'trees';

export interface ProfilerSettings {
  tokenDefinition: string;
  ignoreCase: boolean;
  showLevels: boolean; // true = Highlight List Words, false = Highlight Non-List Words
  defaultTab: MainTabId;
  nationFormat: ListFormatMode;
  stripCurriculumAnnotations: boolean; // Strip trailing * / ** from curriculum lists
  fontSizePx: number;
  showFullPathsInStats: boolean;
}

export interface TargetFileItem {
  id: string;
  name: string;
  path: string;
  sourceType: 'txt' | 'docx' | 'pdf' | 'inline';
  content: string;
  sizeBytes: number;
  addedAt: number;
}

export interface ReferenceListSource {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  content: string;
  enabled: boolean;
  colorLight: string;
  colorDark: string;
  isBuiltin: boolean;
}

export interface AuxiliaryListState {
  enabled: boolean;
  name: string;
  path: string;
  content: string;
  isBuiltin?: boolean;
}

export type TokenLevelKind = 'level' | 'ignored' | 'out';

export interface ProfileToken {
  index: number; // 1-based token position in document
  token: string;
  lookupKey: string;
  trailingWs: string;
  kind: TokenLevelKind;
  /**
   * 0-based active reference list index when kind === 'level'.
   * -1 otherwise.
   */
  activeLevelIndex: number;
  /**
   * 1-based unified level number matching AntWordProfiler SQL semantics:
   * 1..K for active reference lists, K+1 for ignore_list (if active/has entries), last for out_of_list.
   */
  statLevelNumber: number;
  headword: string;
  pos: string;
  listId: string | null;
  listName: string;
}

export interface CoverageWordItem {
  item: string;
  headword: string;
  frequency: number;
}

export interface LevelCoverageSummary {
  key: string; // ReferenceListSource.id | '__ignored__' | '__out__'
  kind: TokenLevelKind;
  listName: string;
  activeLevelIndex: number; // 0..K-1 for reference lists, -1 for ignored/out
  tokenCount: number;
  typeCount: number;
  headwordCount: number;
  percentage: number; // 0..100
  words: CoverageWordItem[];
}

export interface DocumentProfileResult {
  sourceId: string; // TargetFileItem.id or '__inline__'
  sourceName: string;
  originalText: string;
  leadingWs: string;
  tokens: ProfileToken[];
  totalTokens: number;
  totalTypes: number;
  totalCoveredPercentage: number;
  levelSummaries: Record<string, LevelCoverageSummary>;
  ignoredSummary: LevelCoverageSummary;
  outSummary: LevelCoverageSummary;
  tokenFreqByKey: Record<string, { count: number; kind: TokenLevelKind; activeLevelIndex: number; listName: string; headword: string }>;
  elapsedMs: number;
}

export interface DuplicateEntryRecord {
  id: number;
  entry: string;
  headwords: string[];
  listNames: string[];
}

export interface WordlistManifestEntry {
  id: string;
  name: string;
  displayName: string;
  category: 'builtin' | 'kr2015_family' | 'kr2015_school';
  url: string;
  description: string;
}

export interface WordlistPresetDefinition {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  listIds: string[];
  enableBuiltinMaster: boolean;
}

export interface WordlistManifest {
  version: string;
  lists: WordlistManifestEntry[];
  auxiliary: {
    builtinMasterFamilies: {
      name: string;
      url: string;
      description: string;
    };
  };
  presets: WordlistPresetDefinition[];
}


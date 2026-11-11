export interface InputFileStatRow {
  rowId: number | 'TOTAL';
  fileName: string;
  filePath: string;
  types: number;
  tokens: number;
  posTypes: number;
  headwordTypes: number;
  typeTokenRatio: number | null; // null on TOTAL summary row (matches AntWordProfiler)
}

export interface LevelListStatRow {
  rowId: number | 'TOTAL';
  listName: string;
  listPath: string;
  level: number | '';
  types: number;
  posTags: number;
  headwords: number;
}

export interface CoverageStatRow {
  rowId: number | 'TOTAL';
  listName: string;
  listPath: string;
  level: number | '';
  tokens: number;
  tokensPer: number | null;
  tokensAggPer: number | null;
  types: number;
  typesPer: number | null;
  typesAggPer: number | null;
  headwords: number;
  headwordsPer: number | null;
  headwordsAggPer: number | null;
}

export interface RangeStatRow {
  rowId: number | 'TOTAL';
  userFiles: number | 'TOTAL';
  types: number;
  headwords: number;
}

export interface CorpusWordStatRow {
  rowId: number;
  term: string; // 'type' in stats_types, 'headword' in stats_headwords
  headword?: string; // present in stats_types
  level: number;
  listName: string;
  freq: number;
  range: number;
  perFileFreq: number[]; // aligned with fileHeaders[]
}

export interface CorpusStatisticsBundle {
  fileHeaders: { id: string; name: string; path: string }[];
  inputFiles: { rows: InputFileStatRow[]; total: InputFileStatRow };
  levelLists: { rows: LevelListStatRow[]; total: LevelListStatRow };
  coverage: { rows: CoverageStatRow[]; total: CoverageStatRow };
  range: { rows: RangeStatRow[]; total: RangeStatRow };
  types: CorpusWordStatRow[];
  headwords: CorpusWordStatRow[];
  computedAt: number;
  elapsedMs: number;
}


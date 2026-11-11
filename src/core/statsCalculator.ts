import type { ProfilerSettings } from '../types/domain';
import type {
  CorpusStatisticsBundle,
  CorpusWordStatRow,
  CoverageStatRow,
  InputFileStatRow,
  RangeStatRow,
} from '../types/stats';
import { tokenizeLossless } from './tokenizer.ts';
import type { CompiledLexicon } from './wordlistParser.ts';

export interface StatInputDocument {
  id: string;
  name: string;
  path: string;
  content: string;
}

function round2(val: number): number {
  return Number(val.toFixed(2));
}

export function computeCorpusStatistics(params: {
  documents: StatInputDocument[];
  lexicon: CompiledLexicon;
  ignoreEnabled: boolean;
  settings: ProfilerSettings;
  onProgress?: (percent: number, stage: string) => void;
}): CorpusStatisticsBundle {
  const t0 = performance.now();
  const { documents, lexicon, ignoreEnabled, settings, onProgress } = params;

  const fileCount = documents.length;
  const fileHeaders = documents.map((d) => ({
    id: d.id,
    name: d.name,
    path: d.path,
  }));

  // 1. Input File Stats accumulators
  const inputFileRows: InputFileStatRow[] = [];

  // 2. Coverage buckets ordered by statLevelNumber:
  //    active reference lists (1..K), optional ignore_list (K+1), out_of_list (last)
  interface CovBucket {
    listName: string;
    listPath: string;
    level: number;
    tokens: number;
    types: Set<string>;
    headwords: Set<string>;
  }

  const covBuckets = new Map<number, CovBucket>();
  for (const pl of lexicon.parsedLists) {
    covBuckets.set(pl.statLevelNumber, {
      listName: settings.showFullPathsInStats ? pl.path : pl.name,
      listPath: pl.path,
      level: pl.statLevelNumber,
      tokens: 0,
      types: new Set(),
      headwords: new Set(),
    });
  }
  if (lexicon.hasIgnoreLayer && ignoreEnabled) {
    covBuckets.set(lexicon.ignoreStatLevelNumber, {
      listName: 'ignore_list',
      listPath: 'ignore_list',
      level: lexicon.ignoreStatLevelNumber,
      tokens: 0,
      types: new Set(),
      headwords: new Set(),
    });
  }
  covBuckets.set(lexicon.outStatLevelNumber, {
    listName: 'out_of_list',
    listPath: 'out_of_list',
    level: lexicon.outStatLevelNumber,
    tokens: 0,
    types: new Set(),
    headwords: new Set(),
  });

  // 3. Corpus-wide Type & Headword accumulators
  interface TypeAcc {
    type: string;
    headword: string;
    level: number;
    listName: string;
    totalFreq: number;
    perFileFreq: Int32Array;
    fileSet: Set<number>;
  }

  interface HeadwordAcc {
    headword: string;
    level: number;
    listName: string;
    totalFreq: number;
    perFileFreq: Int32Array;
    fileSet: Set<number>;
  }

  const typeMap = new Map<string, TypeAcc>();
  // Key headwords by `${level}:${headword}` so out-of-list vs level collisions stay clean,
  // though within AntWordProfiler headword is grouped by headword string
  const headwordMap = new Map<string, HeadwordAcc>();

  for (let docIdx = 0; docIdx < fileCount; docIdx++) {
    const doc = documents[docIdx];
    if (onProgress) {
      const pct = Math.round(10 + ((docIdx + 1) / Math.max(1, fileCount)) * 50);
      onProgress(pct, `Tokenizing ${doc.name}`);
    }

    const { pieces } = tokenizeLossless(
      doc.content,
      settings.tokenDefinition,
      settings.ignoreCase,
    );

    const fileTypes = new Set<string>();
    const filePos = new Set<string>();
    const fileHeadwords = new Set<string>();

    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const match = lexicon.lookup.get(p.lookupKey);

      let levelNum: number;
      let listName: string;
      let headword: string;
      let pos: string;

      if (match && match.kind === 'level') {
        levelNum = match.statLevelNumber;
        listName = match.listName;
        headword = match.headword;
        pos = match.pos;
        fileHeadwords.add(headword);
      } else if (match && match.kind === 'ignored' && lexicon.hasIgnoreLayer && ignoreEnabled) {
        levelNum = lexicon.ignoreStatLevelNumber;
        listName = 'ignore_list';
        headword = match.headword;
        pos = '';
        fileHeadwords.add(headword);
      } else {
        levelNum = lexicon.outStatLevelNumber;
        listName = 'out_of_list';
        headword = p.lookupKey;
        pos = '';
        fileHeadwords.add(headword);
      }

      fileTypes.add(p.lookupKey);
      if (pos) filePos.add(pos);

      // Coverage bucket update
      const cb = covBuckets.get(levelNum);
      if (cb) {
        cb.tokens += 1;
        cb.types.add(p.lookupKey);
        cb.headwords.add(headword);
      }

      // Type stats update
      let tAcc = typeMap.get(p.lookupKey);
      if (!tAcc) {
        tAcc = {
          type: p.lookupKey,
          headword,
          level: levelNum,
          listName,
          totalFreq: 0,
          perFileFreq: new Int32Array(fileCount),
          fileSet: new Set<number>(),
        };
        typeMap.set(p.lookupKey, tAcc);
      }
      tAcc.totalFreq += 1;
      tAcc.perFileFreq[docIdx] += 1;
      tAcc.fileSet.add(docIdx);

      // Headword stats update
      let hwAcc = headwordMap.get(headword);
      if (!hwAcc) {
        hwAcc = {
          headword,
          level: levelNum,
          listName,
          totalFreq: 0,
          perFileFreq: new Int32Array(fileCount),
          fileSet: new Set<number>(),
        };
        headwordMap.set(headword, hwAcc);
      }
      hwAcc.totalFreq += 1;
      hwAcc.perFileFreq[docIdx] += 1;
      hwAcc.fileSet.add(docIdx);
    }

    const tokCount = pieces.length;
    const typCount = fileTypes.size;
    inputFileRows.push({
      rowId: docIdx + 1,
      fileName: settings.showFullPathsInStats ? doc.path : doc.name,
      filePath: doc.path,
      types: typCount,
      tokens: tokCount,
      posTypes: filePos.size,
      headwordTypes: fileHeadwords.size,
      typeTokenRatio: tokCount > 0 ? round2(typCount / tokCount) : 0,
    });
  }

  onProgress?.(70, 'Computing coverage & range tables');

  const inputFilesTotal: InputFileStatRow = {
    rowId: 'TOTAL',
    fileName: 'TOTAL',
    filePath: 'TOTAL',
    types: inputFileRows.reduce((s, r) => s + r.types, 0),
    tokens: inputFileRows.reduce((s, r) => s + r.tokens, 0),
    posTypes: inputFileRows.reduce((s, r) => s + r.posTypes, 0),
    headwordTypes: inputFileRows.reduce((s, r) => s + r.headwordTypes, 0),
    typeTokenRatio: null,
  };

  // Finalize Coverage Stats (Tab 3)
  const orderedCovBuckets = Array.from(covBuckets.values()).sort(
    (a, b) => a.level - b.level,
  );
  const totalCovTokens = orderedCovBuckets.reduce((s, b) => s + b.tokens, 0);
  const totalCovTypes = orderedCovBuckets.reduce((s, b) => s + b.types.size, 0);
  const totalCovHeadwords = orderedCovBuckets.reduce(
    (s, b) => s + b.headwords.size,
    0,
  );

  let aggTokensPct = 0;
  let aggTypesPct = 0;
  let aggHeadwordsPct = 0;

  const coverageRows: CoverageStatRow[] = orderedCovBuckets.map((b, idx) => {
    const tokPct = totalCovTokens > 0 ? (b.tokens * 100) / totalCovTokens : 0;
    const typPct = totalCovTypes > 0 ? (b.types.size * 100) / totalCovTypes : 0;
    const hwPct =
      totalCovHeadwords > 0 ? (b.headwords.size * 100) / totalCovHeadwords : 0;

    aggTokensPct += tokPct;
    aggTypesPct += typPct;
    aggHeadwordsPct += hwPct;

    return {
      rowId: idx + 1,
      listName: b.listName,
      listPath: b.listPath,
      level: b.level,
      tokens: b.tokens,
      tokensPer: round2(tokPct),
      tokensAggPer: round2(Math.min(100, aggTokensPct)),
      types: b.types.size,
      typesPer: round2(typPct),
      typesAggPer: round2(Math.min(100, aggTypesPct)),
      headwords: b.headwords.size,
      headwordsPer: round2(hwPct),
      headwordsAggPer: round2(Math.min(100, aggHeadwordsPct)),
    };
  });

  const coverageTotal: CoverageStatRow = {
    rowId: 'TOTAL',
    listName: 'TOTAL',
    listPath: 'TOTAL',
    level: '',
    tokens: totalCovTokens,
    tokensPer: totalCovTokens > 0 ? 100 : 0,
    tokensAggPer: null,
    types: totalCovTypes,
    typesPer: totalCovTypes > 0 ? 100 : 0,
    typesAggPer: null,
    headwords: totalCovHeadwords,
    headwordsPer: totalCovHeadwords > 0 ? 100 : 0,
    headwordsAggPer: null,
  };

  // Finalize Range Stats (Tab 4): grouped by number of distinct files a word type appears in
  const rangeBuckets = new Map<
    number,
    { types: number; headwords: Set<string> }
  >();
  for (const tAcc of typeMap.values()) {
    const r = tAcc.fileSet.size;
    let bucket = rangeBuckets.get(r);
    if (!bucket) {
      bucket = { types: 0, headwords: new Set() };
      rangeBuckets.set(r, bucket);
    }
    bucket.types += 1;
    bucket.headwords.add(tAcc.headword);
  }

  const rangeRows: RangeStatRow[] = Array.from(rangeBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([userFiles, b], idx) => ({
      rowId: idx + 1,
      userFiles,
      types: b.types,
      headwords: b.headwords.size,
    }));

  const rangeTotal: RangeStatRow = {
    rowId: 'TOTAL',
    userFiles: 'TOTAL',
    types: rangeRows.reduce((s, r) => s + r.types, 0),
    headwords: rangeRows.reduce((s, r) => s + r.headwords, 0),
  };

  onProgress?.(85, 'Sorting type & headword frequency tables');

  // Finalize Input File Type Stats (Tab 5)
  const typesSorted = Array.from(typeMap.values()).sort(
    (a, b) => b.totalFreq - a.totalFreq || a.type.localeCompare(b.type),
  );
  const typeStatRows: CorpusWordStatRow[] = typesSorted.map((t, idx) => ({
    rowId: idx + 1,
    term: t.type,
    headword: t.headword,
    level: t.level,
    listName: t.listName,
    freq: t.totalFreq,
    range: t.fileSet.size,
    perFileFreq: Array.from(t.perFileFreq),
  }));

  // Finalize Input File Headword Stats (Tab 6)
  const headwordsSorted = Array.from(headwordMap.values()).sort(
    (a, b) =>
      b.totalFreq - a.totalFreq || a.headword.localeCompare(b.headword),
  );
  const headwordStatRows: CorpusWordStatRow[] = headwordsSorted.map(
    (h, idx) => ({
      rowId: idx + 1,
      term: h.headword,
      level: h.level,
      listName: h.listName,
      freq: h.totalFreq,
      range: h.fileSet.size,
      perFileFreq: Array.from(h.perFileFreq),
    }),
  );

  onProgress?.(100, 'Statistics ready');

  return {
    fileHeaders,
    inputFiles: { rows: inputFileRows, total: inputFilesTotal },
    levelLists: lexicon.levelListStats,
    coverage: { rows: coverageRows, total: coverageTotal },
    range: { rows: rangeRows, total: rangeTotal },
    types: typeStatRows,
    headwords: headwordStatRows,
    computedAt: Date.now(),
    elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
  };
}

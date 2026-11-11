import type {
  CoverageWordItem,
  DocumentProfileResult,
  LevelCoverageSummary,
  ProfileToken,
  ProfilerSettings,
  ReferenceListSource,
  TokenLevelKind,
} from '../types/domain';
import { tokenizeLossless } from './tokenizer.ts';
import type { CompiledLexicon } from './wordlistParser.ts';

interface BucketAccumulator {
  key: string;
  kind: TokenLevelKind;
  listName: string;
  activeLevelIndex: number;
  tokenCount: number;
  typesFreq: Map<string, { headword: string; freq: number }>;
  headwords: Set<string>;
}

function createBucket(
  key: string,
  kind: TokenLevelKind,
  listName: string,
  activeLevelIndex: number,
): BucketAccumulator {
  return {
    key,
    kind,
    listName,
    activeLevelIndex,
    tokenCount: 0,
    typesFreq: new Map(),
    headwords: new Set(),
  };
}

function finalizeBucket(
  bucket: BucketAccumulator,
  totalTokens: number,
): LevelCoverageSummary {
  const words: CoverageWordItem[] = [];
  for (const [item, info] of bucket.typesFreq.entries()) {
    words.push({
      item,
      headword: info.headword,
      frequency: info.freq,
    });
  }
  words.sort((a, b) => b.frequency - a.frequency || a.item.localeCompare(b.item));

  const percentage =
    totalTokens > 0
      ? Number(((bucket.tokenCount * 100) / totalTokens).toFixed(2))
      : 0;

  return {
    key: bucket.key,
    kind: bucket.kind,
    listName: bucket.listName,
    activeLevelIndex: bucket.activeLevelIndex,
    tokenCount: bucket.tokenCount,
    typeCount: bucket.typesFreq.size,
    headwordCount: bucket.headwords.size,
    percentage,
    words,
  };
}

export function profileDocument(params: {
  sourceId: string;
  sourceName: string;
  text: string;
  lexicon: CompiledLexicon;
  allReferenceLists: ReferenceListSource[];
  ignoreEnabled: boolean;
  settings: ProfilerSettings;
}): DocumentProfileResult {
  const t0 = performance.now();
  const {
    sourceId,
    sourceName,
    text,
    lexicon,
    allReferenceLists,
    ignoreEnabled,
    settings,
  } = params;

  const { leadingWs, pieces } = tokenizeLossless(
    text,
    settings.tokenDefinition,
    settings.ignoreCase,
  );

  // Initialize buckets for all loaded reference lists (including unchecked ones so UI rows stay complete)
  const levelBuckets = new Map<string, BucketAccumulator>();
  let activeIdxCounter = 0;
  for (const ref of allReferenceLists) {
    const activeIdx = ref.enabled ? activeIdxCounter++ : -1;
    levelBuckets.set(
      ref.id,
      createBucket(ref.id, 'level', ref.name, activeIdx),
    );
  }
  const ignoredBucket = createBucket('__ignored__', 'ignored', 'ignored', -1);
  const outBucket = createBucket('__out__', 'out', 'not in lists', -1);

  const tokens: ProfileToken[] = new Array(pieces.length);
  const allTypes = new Set<string>();
  const tokenFreqMap = new Map<
    string,
    {
      count: number;
      kind: TokenLevelKind;
      activeLevelIndex: number;
      listName: string;
      headword: string;
    }
  >();

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    allTypes.add(p.lookupKey);

    const match = lexicon.lookup.get(p.lookupKey);
    let tok: ProfileToken;
    let targetBucket: BucketAccumulator;

    if (match && match.kind === 'level' && match.listId) {
      tok = {
        index: i + 1,
        token: p.token,
        lookupKey: p.lookupKey,
        trailingWs: p.trailingWs,
        kind: 'level',
        activeLevelIndex: match.activeLevelIndex,
        statLevelNumber: match.statLevelNumber,
        headword: match.headword,
        pos: match.pos,
        listId: match.listId,
        listName: match.listName,
      };
      targetBucket = levelBuckets.get(match.listId) ?? outBucket;
    } else if (match && match.kind === 'ignored' && ignoreEnabled) {
      tok = {
        index: i + 1,
        token: p.token,
        lookupKey: p.lookupKey,
        trailingWs: p.trailingWs,
        kind: 'ignored',
        activeLevelIndex: -1,
        statLevelNumber: match.statLevelNumber,
        headword: match.headword,
        pos: '',
        listId: '__ignored__',
        listName: 'ignore_list',
      };
      targetBucket = ignoredBucket;
    } else {
      tok = {
        index: i + 1,
        token: p.token,
        lookupKey: p.lookupKey,
        trailingWs: p.trailingWs,
        kind: 'out',
        activeLevelIndex: -1,
        statLevelNumber: lexicon.outStatLevelNumber,
        headword: p.lookupKey,
        pos: '',
        listId: null,
        listName: 'out_of_list',
      };
      targetBucket = outBucket;
    }

    tokens[i] = tok;

    // Update coverage bucket
    targetBucket.tokenCount += 1;
    targetBucket.headwords.add(tok.headword);
    const prevType = targetBucket.typesFreq.get(tok.lookupKey);
    if (prevType) {
      prevType.freq += 1;
    } else {
      targetBucket.typesFreq.set(tok.lookupKey, {
        headword: tok.headword,
        freq: 1,
      });
    }

    // Update document-level selection inspector frequency map
    const prevInspector = tokenFreqMap.get(tok.lookupKey);
    if (prevInspector) {
      prevInspector.count += 1;
    } else {
      tokenFreqMap.set(tok.lookupKey, {
        count: 1,
        kind: tok.kind,
        activeLevelIndex: tok.activeLevelIndex,
        listName: tok.listName,
        headword: tok.headword,
      });
    }
  }

  const totalTokens = tokens.length;
  const totalTypes = allTypes.size;

  const levelSummaries: Record<string, LevelCoverageSummary> = {};
  let coveredTokensCount = 0;

  for (const ref of allReferenceLists) {
    const b = levelBuckets.get(ref.id)!;
    const summary = finalizeBucket(b, totalTokens);
    levelSummaries[ref.id] = summary;
    if (ref.enabled) {
      coveredTokensCount += summary.tokenCount;
    }
  }

  const ignoredSummary = finalizeBucket(ignoredBucket, totalTokens);
  const outSummary = finalizeBucket(outBucket, totalTokens);

  if (ignoreEnabled) {
    coveredTokensCount += ignoredSummary.tokenCount;
  }

  const totalCoveredPercentage =
    totalTokens > 0
      ? Number(((coveredTokensCount * 100) / totalTokens).toFixed(2))
      : 0;

  const tokenFreqByKey: DocumentProfileResult['tokenFreqByKey'] = {};
  for (const [k, v] of tokenFreqMap.entries()) {
    tokenFreqByKey[k] = v;
  }

  const elapsedMs = Math.max(1, Math.round(performance.now() - t0));

  return {
    sourceId,
    sourceName,
    originalText: text,
    leadingWs,
    tokens,
    totalTokens,
    totalTypes,
    totalCoveredPercentage,
    levelSummaries,
    ignoredSummary,
    outSummary,
    tokenFreqByKey,
    elapsedMs,
  };
}

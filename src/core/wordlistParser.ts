import type {
  AuxiliaryListState,
  ListFormatMode,
  ProfilerSettings,
  ReferenceListSource,
} from '../types/domain';
import type { LevelListStatRow } from '../types/stats';
import type { ExportedLevelGroup } from '../types/workerMessages';

export interface ParsedWordEntry {
  type: string; // normalized according to ignoreCase
  rawType: string;
  pos: string;
  headword: string; // normalized according to ignoreCase
}

export interface ParsedLevelList {
  id: string;
  name: string;
  path: string;
  activeLevelIndex: number; // 0..K-1
  statLevelNumber: number; // 1..K
  entries: ParsedWordEntry[];
  uniqueTypeCount: number;
  posTagCount: number;
  uniqueHeadwordCount: number;
  families: Map<string, Set<string>>; // headword -> ordered set of member types
}

export interface LexiconMatch {
  kind: 'level' | 'ignored';
  activeLevelIndex: number; // 0..K-1 for level, -1 for ignored
  statLevelNumber: number; // 1..K for level, K+1 for ignored
  headword: string;
  pos: string;
  listId: string | null;
  listName: string;
}

export interface CompiledLexicon {
  cacheKey: string;
  parsedLists: ParsedLevelList[];
  lookup: Map<string, LexiconMatch>;
  referenceTypesSet: Set<string>; // strictly active reference list types (excludes ignore)
  hasIgnoreLayer: boolean;
  ignoreStatLevelNumber: number;
  outStatLevelNumber: number;
  levelListStats: { rows: LevelListStatRow[]; total: LevelListStatRow };
}

interface MasterMappings {
  headwordToMembers: Map<string, string[]>;
  memberToHeadword: Map<string, string>;
}

function normalizeTerm(
  raw: string,
  ignoreCase: boolean,
  stripAnnotations: boolean,
): { term: string; pos: string } | null {
  let cleaned = raw.trim();
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) {
    return null;
  }
  if (stripAnnotations) {
    // Handles Korean 2015 curriculum markers like `a *` or `abort **`
    cleaned = cleaned.replace(/\s*\*+\s*$/, '').trim();
  }
  if (!cleaned) {
    return null;
  }

  let base = cleaned;
  let pos = '';
  const underscoreIdx = cleaned.lastIndexOf('_');
  if (underscoreIdx > 0 && underscoreIdx < cleaned.length - 1) {
    const candidatePos = cleaned.slice(underscoreIdx + 1);
    if (/^[A-Za-z0-9$]{1,6}$/.test(candidatePos)) {
      base = cleaned.slice(0, underscoreIdx);
      pos = ignoreCase ? candidatePos.toLowerCase() : candidatePos;
    }
  }

  const term = ignoreCase ? base.toLowerCase() : base;
  return term ? { term, pos } : null;
}

function detectNationTreeFormat(lines: string[]): boolean {
  let nonEmpty = 0;
  let indentedAfterHead = 0;
  let sawHeadword = false;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    nonEmpty += 1;
    const isIndented = /^(?:\t+|\s{2,}|->\s*)\S/.test(rawLine);
    if (isIndented) {
      if (sawHeadword) indentedAfterHead += 1;
    } else {
      sawHeadword = true;
    }
  }

  if (nonEmpty === 0 || indentedAfterHead === 0) return false;
  return indentedAfterHead / nonEmpty >= 0.1;
}

/**
 * Parses a raw wordlist string supporting:
 * 1. Row format: `HEADWORD\tMEMBER1\tMEMBER2...` or single word per line
 * 2. Paul Nation Tree format: `HEADWORD` at col 0 followed by `\tMEMBER` (or `  MEMBER` / `->MEMBER`) lines
 */
export function parseRawFamilyGroups(
  content: string,
  options: {
    ignoreCase: boolean;
    formatMode: ListFormatMode;
    stripAnnotations: boolean;
  },
): { headword: string; members: { term: string; pos: string }[] }[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const { ignoreCase, formatMode, stripAnnotations } = options;

  // Auto-detect Nation tree format only when indented member lines appear
  // after a non-indented headword line (ratio ≥ 10% of non-empty lines).
  // A single stray indented line must not force the whole file into tree mode.
  const isTreeMode =
    formatMode === 'trees' ||
    (formatMode === 'auto' && detectNationTreeFormat(lines));

  const familyOrder: string[] = [];
  const familyMap = new Map<string, Map<string, string>>(); // headword -> Map<term, pos>

  const ensureFamily = (hw: string, hwPos: string) => {
    let members = familyMap.get(hw);
    if (!members) {
      members = new Map<string, string>();
      familyMap.set(hw, members);
      familyOrder.push(hw);
    }
    if (!members.has(hw)) {
      members.set(hw, hwPos);
    }
    return members;
  };

  if (isTreeMode) {
    let currentHeadword: string | null = null;
    let currentMembers: Map<string, string> | null = null;

    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      const isIndented = /^(?:\t+|\s{2,}|->\s*)/.test(rawLine);
      const strippedLine = rawLine.replace(/^(?:\t+|\s+|->\s*)/, '');
      const tokens = strippedLine.split(/\t+/);

      if (!isIndented || !currentHeadword || !currentMembers) {
        const first = normalizeTerm(tokens[0] ?? '', ignoreCase, stripAnnotations);
        if (!first) continue;
        currentHeadword = first.term;
        currentMembers = ensureFamily(first.term, first.pos);
        for (let i = 1; i < tokens.length; i++) {
          const m = normalizeTerm(tokens[i], ignoreCase, stripAnnotations);
          if (m && !currentMembers.has(m.term)) {
            currentMembers.set(m.term, m.pos);
          }
        }
      } else {
        for (const tok of tokens) {
          const m = normalizeTerm(tok, ignoreCase, stripAnnotations);
          if (m && !currentMembers.has(m.term)) {
            currentMembers.set(m.term, m.pos);
          }
        }
      }
    }
  } else {
    // Row format
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\t+/);
      const head = normalizeTerm(parts[0] ?? '', ignoreCase, stripAnnotations);
      if (!head) continue;
      const members = ensureFamily(head.term, head.pos);
      for (let i = 1; i < parts.length; i++) {
        const m = normalizeTerm(parts[i], ignoreCase, stripAnnotations);
        if (m && !members.has(m.term)) {
          members.set(m.term, m.pos);
        }
      }
    }
  }

  return familyOrder.map((hw) => {
    const membersMap = familyMap.get(hw)!;
    const members: { term: string; pos: string }[] = [];
    for (const [term, pos] of membersMap.entries()) {
      members.push({ term, pos });
    }
    return { headword: hw, members };
  });
}

function buildMasterMappings(
  masterList: AuxiliaryListState,
  ignoreCase: boolean,
  formatMode: ListFormatMode,
  stripAnnotations: boolean,
): MasterMappings | null {
  if (!masterList.enabled || !masterList.content.trim()) {
    return null;
  }
  const groups = parseRawFamilyGroups(masterList.content, {
    ignoreCase,
    formatMode,
    stripAnnotations,
  });
  const headwordToMembers = new Map<string, string[]>();
  const memberToHeadword = new Map<string, string>();

  for (const g of groups) {
    const list = g.members.map((m) => m.term);
    headwordToMembers.set(g.headword, list);
    for (const m of list) {
      if (!memberToHeadword.has(m)) {
        memberToHeadword.set(m, g.headword);
      }
    }
  }
  return { headwordToMembers, memberToHeadword };
}

function fnv1aHash(str: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function computeLexiconCacheKey(params: {
  referenceLists: ReferenceListSource[];
  ignoreList: AuxiliaryListState;
  extraIgnoreWords: string[];
  masterList: AuxiliaryListState;
  ignoreEnabled: boolean;
  settings: Pick<
    ProfilerSettings,
    | 'ignoreCase'
    | 'nationFormat'
    | 'stripCurriculumAnnotations'
    | 'showFullPathsInStats'
    | 'tokenDefinition'
  >;
}): string {
  let h = 2166136261;
  const feed = (s: string) => {
    h = fnv1aHash(s, h);
    h = fnv1aHash('|', h);
  };

  feed(String(params.settings.ignoreCase));
  feed(params.settings.nationFormat);
  feed(String(params.settings.stripCurriculumAnnotations));
  feed(String(params.settings.showFullPathsInStats));
  feed(params.settings.tokenDefinition ?? '');
  feed(String(params.ignoreEnabled));

  const feedContentFingerprint = (content: string) => {
    feed(String(content.length));
    feed(String(fnv1aHash(content)));
    // Head/mid/tail samples reduce 32-bit FNV collision risk without hashing twice.
    if (content.length > 0) {
      feed(content.slice(0, 96));
      const mid = Math.max(0, Math.floor(content.length / 2) - 48);
      feed(content.slice(mid, mid + 96));
      feed(content.slice(-96));
    }
  };

  for (const r of params.referenceLists) {
    feed(r.id);
    feed(r.name);
    feed(r.path);
    feed(String(r.enabled));
    if (r.enabled) {
      feedContentFingerprint(r.content);
    }
  }

  feed(String(params.ignoreList.enabled));
  if (params.ignoreList.enabled && params.ignoreEnabled) {
    feedContentFingerprint(params.ignoreList.content);
  }

  for (const w of params.extraIgnoreWords) {
    feed(w);
  }

  feed(String(params.masterList.enabled));
  if (params.masterList.enabled) {
    feedContentFingerprint(params.masterList.content);
  }

  return h.toString(16);
}

/**
 * Compiles active reference lists, optional Master List family expansion,
 * and Ignore List + Extra Ignore Words into a fast O(1) lookup lexicon.
 */
export function compileLexicon(params: {
  referenceLists: ReferenceListSource[];
  ignoreList: AuxiliaryListState;
  extraIgnoreWords: string[];
  masterList: AuxiliaryListState;
  ignoreEnabled: boolean;
  settings: ProfilerSettings;
}): CompiledLexicon {
  const {
    referenceLists,
    ignoreList,
    extraIgnoreWords,
    masterList,
    ignoreEnabled,
    settings,
  } = params;

  const cacheKey = computeLexiconCacheKey(params);
  const master = buildMasterMappings(
    masterList,
    settings.ignoreCase,
    settings.nationFormat,
    settings.stripCurriculumAnnotations,
  );

  const activeRefs = referenceLists.filter((r) => r.enabled);
  const parsedLists: ParsedLevelList[] = [];
  const lookup = new Map<string, LexiconMatch>();
  const referenceTypesSet = new Set<string>();

  for (let idx = 0; idx < activeRefs.length; idx++) {
    const ref = activeRefs[idx];
    const statLevelNumber = idx + 1;
    const rawGroups = parseRawFamilyGroups(ref.content, {
      ignoreCase: settings.ignoreCase,
      formatMode: settings.nationFormat,
      stripAnnotations: settings.stripCurriculumAnnotations,
    });

    const families = new Map<string, Set<string>>();
    const entries: ParsedWordEntry[] = [];
    const seenTypesInThisList = new Set<string>();
    let posTagCount = 0;

    for (const group of rawGroups) {
      let effectiveHeadword = group.headword;
      const expandedTerms = new Map<string, string>(); // term -> pos

      for (const m of group.members) {
        expandedTerms.set(m.term, m.pos);
      }

      if (master) {
        const directMembers = master.headwordToMembers.get(group.headword);
        if (directMembers) {
          for (const dm of directMembers) {
            if (!expandedTerms.has(dm)) expandedTerms.set(dm, '');
          }
        } else {
          const mappedHw = master.memberToHeadword.get(group.headword);
          if (mappedHw) {
            effectiveHeadword = mappedHw;
            const mappedMembers = master.headwordToMembers.get(mappedHw) ?? [];
            for (const dm of mappedMembers) {
              if (!expandedTerms.has(dm)) expandedTerms.set(dm, '');
            }
          }
        }
      }

      let famSet = families.get(effectiveHeadword);
      if (!famSet) {
        famSet = new Set<string>();
        families.set(effectiveHeadword, famSet);
      }

      for (const [term, pos] of expandedTerms.entries()) {
        famSet.add(term);
        if (!seenTypesInThisList.has(term)) {
          seenTypesInThisList.add(term);
          if (pos) posTagCount += 1;
          entries.push({
            type: term,
            rawType: term,
            pos,
            headword: effectiveHeadword,
          });
        }
        referenceTypesSet.add(term);

        // First-occurring active reference list wins (AntWordProfiler precedence rule)
        if (!lookup.has(term)) {
          lookup.set(term, {
            kind: 'level',
            activeLevelIndex: idx,
            statLevelNumber,
            headword: effectiveHeadword,
            pos,
            listId: ref.id,
            listName: ref.name,
          });
        }
      }
    }

    parsedLists.push({
      id: ref.id,
      name: ref.name,
      path: ref.path,
      activeLevelIndex: idx,
      statLevelNumber,
      entries,
      uniqueTypeCount: seenTypesInThisList.size,
      posTagCount,
      uniqueHeadwordCount: families.size,
      families,
    });
  }

  // Build Ignore Layer (Ignore List file + Extra Ignore Words)
  const ignoreTerms = new Set<string>();
  if (ignoreEnabled) {
    if (ignoreList.enabled && ignoreList.content.trim()) {
      const groups = parseRawFamilyGroups(ignoreList.content, {
        ignoreCase: settings.ignoreCase,
        formatMode: 'rows',
        stripAnnotations: settings.stripCurriculumAnnotations,
      });
      for (const g of groups) {
        for (const m of g.members) {
          ignoreTerms.add(m.term);
        }
      }
    }
    for (const rawExtra of extraIgnoreWords) {
      const norm = normalizeTerm(
        rawExtra,
        settings.ignoreCase,
        settings.stripCurriculumAnnotations,
      );
      if (norm) {
        ignoreTerms.add(norm.term);
      }
    }
  }

  const hasIgnoreLayer = ignoreEnabled && ignoreTerms.size > 0;
  const ignoreStatLevelNumber = activeRefs.length + 1;
  const outStatLevelNumber = hasIgnoreLayer
    ? activeRefs.length + 2
    : activeRefs.length + 1;

  if (ignoreEnabled) {
    for (const term of ignoreTerms) {
      if (!lookup.has(term)) {
        lookup.set(term, {
          kind: 'ignored',
          activeLevelIndex: -1,
          statLevelNumber: ignoreStatLevelNumber,
          headword: term,
          pos: '',
          listId: '__ignored__',
          listName: 'ignore_list',
        });
      }
    }
  }

  // Precompute Level List Stats table (Tab 2 of Statistics Viewer)
  const levelStatRows: LevelListStatRow[] = parsedLists.map((pl, idx) => ({
    rowId: idx + 1,
    listName: settings.showFullPathsInStats ? pl.path : pl.name,
    listPath: pl.path,
    level: pl.statLevelNumber,
    types: pl.uniqueTypeCount,
    posTags: pl.posTagCount,
    headwords: pl.uniqueHeadwordCount,
  }));

  if (hasIgnoreLayer) {
    let effectiveIgnoredCount = 0;
    for (const term of ignoreTerms) {
      if (!referenceTypesSet.has(term)) effectiveIgnoredCount += 1;
    }
    levelStatRows.push({
      rowId: levelStatRows.length + 1,
      listName: 'ignore_list',
      listPath: ignoreList.path || 'ignore_list',
      level: ignoreStatLevelNumber,
      types: effectiveIgnoredCount,
      posTags: 0,
      headwords: effectiveIgnoredCount,
    });
  }

  const levelListTotal: LevelListStatRow = {
    rowId: 'TOTAL',
    listName: 'TOTAL',
    listPath: 'TOTAL',
    level: '',
    types: levelStatRows.reduce((s, r) => s + r.types, 0),
    posTags: levelStatRows.reduce((s, r) => s + r.posTags, 0),
    headwords: levelStatRows.reduce((s, r) => s + r.headwords, 0),
  };

  return {
    cacheKey,
    parsedLists,
    lookup,
    referenceTypesSet,
    hasIgnoreLayer,
    ignoreStatLevelNumber,
    outStatLevelNumber,
    levelListStats: { rows: levelStatRows, total: levelListTotal },
  };
}

export function exportCompiledLevelGroups(
  lexicon: CompiledLexicon,
): ExportedLevelGroup[] {
  return lexicon.parsedLists.map((pl) => {
    const families: { headword: string; members: string[] }[] = [];
    for (const [headword, memberSet] of pl.families.entries()) {
      const others = Array.from(memberSet).filter((m) => m !== headword);
      families.push({
        headword,
        members: [headword, ...others],
      });
    }
    return {
      listId: pl.id,
      listName: pl.name,
      families,
    };
  });
}

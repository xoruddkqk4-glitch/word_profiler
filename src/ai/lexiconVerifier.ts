import { tokenizeLossless } from '../core/tokenizer';
import {
  compileLexicon,
  computeLexiconCacheKey,
  parseRawFamilyGroups,
  type CompiledLexicon,
} from '../core/wordlistParser';
import type {
  AuditedMiniToken,
  TokenSpanSelection,
  VerifiedLexiconStatus,
} from '../types/ai';
import type {
  AuxiliaryListState,
  DocumentProfileResult,
  ProfilerSettings,
  ReferenceListSource,
} from '../types/domain';

const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'fig',
  'no',
  'vol',
  'pp',
  'ch',
  'inc',
  'ltd',
  'co',
]);

export interface VerifierContextParams {
  referenceLists: ReferenceListSource[];
  ignoreList: AuxiliaryListState;
  extraIgnoreWords: string[];
  masterList: AuxiliaryListState;
  builtinMasterRawContent?: string;
  ignoreEnabled: boolean;
  settings: ProfilerSettings;
}

export interface CompiledVerifierContext {
  cacheKey: string;
  compiled: CompiledLexicon;
  activeListCount: number;
  inactiveLookup: Map<string, string>; // term -> inactive listName
  masterMemberToHeadword: Map<string, string>;
  settings: ProfilerSettings;
}

let cachedVerifierCtx: CompiledVerifierContext | null = null;

export function getVerifierContext(
  params: VerifierContextParams,
): CompiledVerifierContext {
  const baseKey = computeLexiconCacheKey(params);
  const inactiveSig = params.referenceLists
    .filter((r) => !r.enabled)
    .map((r) => `${r.id}:${r.content.length}`)
    .join(',');
  const masterExtraSig = params.builtinMasterRawContent
    ? String(params.builtinMasterRawContent.length)
    : '0';
  const fullKey = `${baseKey}|inact:${inactiveSig}|bm:${masterExtraSig}`;

  if (cachedVerifierCtx && cachedVerifierCtx.cacheKey === fullKey) {
    return cachedVerifierCtx;
  }

  const compiled = compileLexicon({
    referenceLists: params.referenceLists,
    ignoreList: params.ignoreList,
    extraIgnoreWords: params.extraIgnoreWords,
    masterList: params.masterList,
    ignoreEnabled: params.ignoreEnabled,
    settings: params.settings,
  });

  const inactiveLookup = new Map<string, string>();
  for (const ref of params.referenceLists) {
    if (ref.enabled || !ref.content.trim()) continue;
    const groups = parseRawFamilyGroups(ref.content, {
      ignoreCase: params.settings.ignoreCase,
      formatMode: params.settings.nationFormat,
      stripAnnotations: params.settings.stripCurriculumAnnotations,
    });
    for (const g of groups) {
      for (const m of g.members) {
        if (!inactiveLookup.has(m.term)) {
          inactiveLookup.set(m.term, ref.name);
        }
      }
    }
  }

  const masterMemberToHeadword = new Map<string, string>();
  const masterSource =
    params.masterList.content.trim() || params.builtinMasterRawContent || '';
  if (masterSource.trim()) {
    const groups = parseRawFamilyGroups(masterSource, {
      ignoreCase: params.settings.ignoreCase,
      formatMode: params.settings.nationFormat,
      stripAnnotations: params.settings.stripCurriculumAnnotations,
    });
    for (const g of groups) {
      for (const m of g.members) {
        if (!masterMemberToHeadword.has(m.term)) {
          masterMemberToHeadword.set(m.term, g.headword);
        }
      }
    }
  }

  const activeListCount = params.referenceLists.filter((r) => r.enabled).length;

  cachedVerifierCtx = {
    cacheKey: fullKey,
    compiled,
    activeListCount,
    inactiveLookup,
    masterMemberToHeadword,
    settings: params.settings,
  };
  return cachedVerifierCtx;
}

export function normalizeLookupWord(
  raw: string,
  ignoreCase: boolean,
): string {
  const cleaned = raw
    .trim()
    .replace(/^["'“”‘’([{\s]+|["'“”‘’)\]}.,!?;:\s]+$/g, '');
  return ignoreCase ? cleaned.toLowerCase() : cleaned;
}

export function verifySingleWord(
  rawForm: string,
  ctx: CompiledVerifierContext,
  targetMaxLevel?: number,
): VerifiedLexiconStatus {
  const maxLvl =
    targetMaxLevel !== undefined && targetMaxLevel > 0
      ? targetMaxLevel
      : Math.max(1, ctx.activeListCount);

  const key = normalizeLookupWord(rawForm, ctx.settings.ignoreCase);
  const hit = key ? ctx.compiled.lookup.get(key) : undefined;
  const masterHw = key ? ctx.masterMemberToHeadword.get(key) ?? null : null;
  const inactiveName = key ? ctx.inactiveLookup.get(key) ?? null : null;

  if (hit && hit.kind === 'level') {
    return {
      inActiveList: true,
      withinTargetCap: hit.statLevelNumber <= maxLvl,
      kind: 'level',
      statLevelNumber: hit.statLevelNumber,
      activeLevelIndex: hit.activeLevelIndex,
      listId: hit.listId,
      listName: hit.listName,
      headword: hit.headword,
      inBuiltinMasterFamily: masterHw !== null,
      masterHeadword: masterHw,
      inactiveListMatchName: inactiveName,
    };
  }

  if (hit && hit.kind === 'ignored') {
    return {
      inActiveList: false,
      withinTargetCap: true,
      kind: 'ignored',
      statLevelNumber: null,
      activeLevelIndex: -1,
      listId: '__ignored__',
      listName: 'ignore_list',
      headword: hit.headword,
      inBuiltinMasterFamily: masterHw !== null,
      masterHeadword: masterHw,
      inactiveListMatchName: inactiveName,
    };
  }

  return {
    inActiveList: false,
    withinTargetCap: false,
    kind: 'out',
    statLevelNumber: null,
    activeLevelIndex: -1,
    listId: null,
    listName: 'out_of_list',
    headword: key || rawForm.trim(),
    inBuiltinMasterFamily: masterHw !== null,
    masterHeadword: masterHw,
    inactiveListMatchName: inactiveName,
  };
}

function isSentenceBreakAfterToken(
  tokenText: string,
  trailingWs: string,
): boolean {
  if (!trailingWs) return false;
  if (/\n\s*\n/.test(trailingWs)) return true;

  // Match sentence-ending punctuation (. ? !) optionally followed by closing quotes/parens
  const punctMatch = trailingWs.match(/^\s*([.?!]+)["'”’)\]}]*(\s|$)/);
  if (!punctMatch) return false;

  // If it's a single period, skip common abbreviations and single-letter initials
  if (punctMatch[1] === '.') {
    const lower = tokenText.toLowerCase();
    if (COMMON_ABBREVIATIONS.has(lower)) return false;
    if (/^[a-z]$/i.test(tokenText)) return false;
  }

  return true;
}

export function sliceProfileSpanText(
  profile: DocumentProfileResult,
  startIdx: number,
  endIdx: number,
  includeSentencePunct = false,
): string {
  const tokens = profile.tokens;
  if (tokens.length === 0) return '';
  const lo = Math.max(0, Math.min(startIdx, tokens.length - 1));
  const hi = Math.max(lo, Math.min(endIdx, tokens.length - 1));

  let out = '';
  for (let i = lo; i <= hi; i++) {
    out += tokens[i].token;
    if (i < hi) {
      out += tokens[i].trailingWs;
    } else if (includeSentencePunct) {
      const m = tokens[i].trailingWs.match(/^([.?!]+["'”’)\]}]*)/);
      if (m) out += m[1];
    }
  }
  return out;
}

export function extractEnclosingSentenceSpan(
  profile: DocumentProfileResult,
  anchorStartIdx: number,
  anchorEndIdx: number,
): TokenSpanSelection & { sentenceWithPunct: string } {
  const tokens = profile.tokens;
  if (tokens.length === 0) {
    return {
      startTokenIdx: 0,
      endTokenIdx: 0,
      rawText: '',
      sentenceWithPunct: '',
    };
  }

  const clampedStart = Math.max(0, Math.min(anchorStartIdx, tokens.length - 1));
  const clampedEnd = Math.max(
    clampedStart,
    Math.min(anchorEndIdx, tokens.length - 1),
  );

  let sentStart = clampedStart;
  while (sentStart > 0) {
    const prevTok = tokens[sentStart - 1];
    if (isSentenceBreakAfterToken(prevTok.token, prevTok.trailingWs)) {
      break;
    }
    sentStart -= 1;
  }

  let sentEnd = clampedEnd;
  while (sentEnd < tokens.length - 1) {
    const curTok = tokens[sentEnd];
    if (isSentenceBreakAfterToken(curTok.token, curTok.trailingWs)) {
      break;
    }
    sentEnd += 1;
  }

  const rawText = sliceProfileSpanText(profile, sentStart, sentEnd, false);
  const sentenceWithPunct = sliceProfileSpanText(
    profile,
    sentStart,
    sentEnd,
    true,
  );

  return {
    startTokenIdx: sentStart,
    endTokenIdx: sentEnd,
    rawText,
    sentenceWithPunct,
  };
}

export function matchSurfaceCapitalization(
  originalToken: string,
  replacement: string,
): string {
  const trimmed = replacement.trim();
  if (!trimmed || !originalToken) return trimmed;

  // ALL CAPS check (length >= 2)
  if (
    originalToken.length >= 2 &&
    originalToken === originalToken.toUpperCase() &&
    originalToken !== originalToken.toLowerCase()
  ) {
    return trimmed.toUpperCase();
  }

  // Title/Sentence-initial capitalization check
  const firstOrig = originalToken[0];
  if (
    firstOrig === firstOrig.toUpperCase() &&
    firstOrig !== firstOrig.toLowerCase()
  ) {
    return trimmed[0].toUpperCase() + trimmed.slice(1);
  }

  return trimmed;
}

/**
 * Replaces tokens[startIdx..endIdx] in `profile` with `replacementText`
 * while preserving leading/trailing whitespace and avoiding duplicate terminal punctuation.
 */
export function buildReplacedDocumentText(
  profile: DocumentProfileResult,
  startIdx: number,
  endIdx: number,
  replacementText: string,
): string {
  const tokens = profile.tokens;
  if (tokens.length === 0) return replacementText;

  const lo = Math.max(0, Math.min(startIdx, tokens.length - 1));
  const hi = Math.max(lo, Math.min(endIdx, tokens.length - 1));

  let cleanReplacement = replacementText.trim();
  const isSingleToken = lo === hi;

  if (isSingleToken) {
    cleanReplacement = cleanReplacement.replace(/^[“"']|[”"']$/g, '').trim();
    if (!/[.?!]$/.test(tokens[lo].token)) {
      cleanReplacement = cleanReplacement.replace(/[.?!]+$/, '').trim();
    }
    cleanReplacement = matchSurfaceCapitalization(
      tokens[lo].token,
      cleanReplacement,
    );
  }

  let prefix = profile.leadingWs;
  for (let i = 0; i < lo; i++) {
    prefix += tokens[i].token + tokens[i].trailingWs;
  }

  let endTrailingWs = tokens[hi].trailingWs;
  // Prevent double terminal punctuation (e.g. `well.` + `.\n\n` -> `well..\n\n`)
  if (/([.?!]+["'”’)\]}]*)$/.test(cleanReplacement)) {
    endTrailingWs = endTrailingWs.replace(/^[.?!]+["'”’)\]}]*/, '');
  }

  let suffix = endTrailingWs;
  for (let i = hi + 1; i < tokens.length; i++) {
    suffix += tokens[i].token + tokens[i].trailingWs;
  }

  return prefix + cleanReplacement + suffix;
}

/**
 * Builds a sentence preview with `tokens[spanStartIdx..spanEndIdx]` replaced
 * (shown in brackets) inside the enclosing sentence span.
 */
export function buildSentencePreviewForSpan(
  profile: DocumentProfileResult,
  spanStartIdx: number,
  spanEndIdx: number,
  enclosingStartIdx: number,
  enclosingEndIdx: number,
  replacement: string,
): string {
  const tokens = profile.tokens;
  if (
    spanStartIdx < 0 ||
    spanEndIdx >= tokens.length ||
    spanStartIdx > spanEndIdx ||
    enclosingStartIdx > enclosingEndIdx
  ) {
    return replacement;
  }

  const cased = matchSurfaceCapitalization(
    tokens[spanStartIdx].token,
    replacement,
  );
  let out = '';
  for (let i = enclosingStartIdx; i <= enclosingEndIdx; i++) {
    if (i > spanStartIdx && i <= spanEndIdx) continue;
    out += i === spanStartIdx ? `[${cased}]` : tokens[i].token;
    const trailingIdx = i === spanStartIdx ? spanEndIdx : i;
    if (trailingIdx < enclosingEndIdx) {
      out += tokens[trailingIdx].trailingWs;
    } else {
      const m = tokens[trailingIdx].trailingWs.match(/^([.?!]+["'”’)\]}]*)/);
      if (m) out += m[1];
    }
  }
  return out;
}

export function collectSpanLexicalGuidance(
  profile: DocumentProfileResult,
  startIdx: number,
  endIdx: number,
  targetMaxLevel: number,
): {
  allowedWordsInSpan: string[];
  wordsToReplace: string[];
  properNounsCarryover: Set<string>;
} {
  const allowedSet = new Set<string>();
  const replaceSet = new Set<string>();
  const properNounsCarryover = new Set<string>();

  const lo = Math.max(0, startIdx);
  const hi = Math.min(profile.tokens.length - 1, endIdx);

  for (let i = lo; i <= hi; i++) {
    const t = profile.tokens[i];
    const withinCap =
      t.kind === 'ignored' ||
      (t.kind === 'level' && t.statLevelNumber <= targetMaxLevel);

    if (withinCap) {
      allowedSet.add(t.lookupKey);
    } else {
      // Mid-sentence capitalized words are often proper nouns (names/places)
      const isMidSentenceCapitalized =
        i > lo &&
        /^[A-Z]/.test(t.token) &&
        !/\n/.test(profile.tokens[i - 1].trailingWs) &&
        !/[.?!]/.test(profile.tokens[i - 1].trailingWs);

      if (isMidSentenceCapitalized) {
        properNounsCarryover.add(t.lookupKey);
      } else {
        replaceSet.add(t.token);
      }
    }
  }

  return {
    allowedWordsInSpan: Array.from(allowedSet),
    wordsToReplace: Array.from(replaceSet),
    properNounsCarryover,
  };
}

export function auditParaphraseCandidateText(
  rawCandidateText: string,
  ctx: CompiledVerifierContext,
  targetMaxLevel: number,
  properNounsCarryover?: Set<string>,
): {
  leadingWs: string;
  tokens: AuditedMiniToken[];
  remainingOutWords: string[];
  outWordCount: number;
  totalTokens: number;
  inTargetPercentage: number;
} {
  const { leadingWs, pieces } = tokenizeLossless(
    rawCandidateText,
    ctx.settings.tokenDefinition,
    ctx.settings.ignoreCase,
  );

  const auditedTokens: AuditedMiniToken[] = [];
  const outSet = new Set<string>();
  let inTargetCount = 0;

  for (const p of pieces) {
    const status = verifySingleWord(p.token, ctx, targetMaxLevel);
    const isCarryoverProper = properNounsCarryover?.has(p.lookupKey) ?? false;
    const withinCap = status.withinTargetCap || isCarryoverProper;

    if (withinCap) {
      inTargetCount += 1;
    } else {
      outSet.add(p.token);
    }

    auditedTokens.push({
      token: p.token,
      trailingWs: p.trailingWs,
      withinCap,
      kind: status.kind,
      activeLevelIndex: status.activeLevelIndex,
      listId: status.listId,
      listName: status.listName,
      statLevelNumber: status.statLevelNumber ?? ctx.compiled.outStatLevelNumber,
    });
  }

  const totalTokens = pieces.length;
  const inTargetPercentage =
    totalTokens > 0 ? (inTargetCount * 100) / totalTokens : 100;

  return {
    leadingWs,
    tokens: auditedTokens,
    remainingOutWords: Array.from(outSet),
    outWordCount: totalTokens - inTargetCount,
    totalTokens,
    inTargetPercentage,
  };
}


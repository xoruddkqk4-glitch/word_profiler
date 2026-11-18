import { tokenizeLossless } from '../core/tokenizer';
import type {
  CombinedSuggestionResult,
  MorphologyAnalysisResult,
  MorphRelationKind,
  OpenRouterConfig,
  VerifiedMorphCandidate,
  VerifiedParaphraseCandidate,
  VerifiedSynonymCandidate,
} from '../types/ai';
import type { DocumentProfileResult } from '../types/domain';
import {
  auditParaphraseCandidateText,
  buildSentencePreviewForSpan,
  collectSpanLexicalGuidance,
  extractEnclosingSentenceSpan,
  matchSurfaceCapitalization,
  sliceProfileSpanText,
  verifySingleWord,
  type CompiledVerifierContext,
} from './lexiconVerifier';
import { callOpenRouterJson } from './openRouterClient';

const RELATION_LABELS_KO: Record<MorphRelationKind, string> = {
  lemma: '기본형 (Lemma)',
  derivational_base: '파생 기반어',
  root: '핵심 어근 (Root)',
  family_member: '같은 어족 (Family)',
  compound_part: '복합어 구성어',
};

function normalizeRelation(raw: unknown): MorphRelationKind {
  if (
    raw === 'lemma' ||
    raw === 'derivational_base' ||
    raw === 'root' ||
    raw === 'family_member' ||
    raw === 'compound_part'
  ) {
    return raw;
  }
  return 'family_member';
}

interface RawMorphologyCandidate {
  form?: string;
  f?: string;
  relation?: string;
  r?: string;
  noteKo?: string;
  n?: string;
}

interface RawMorphologyLlmResponse {
  contextPos?: string;
  explanationKo?: string;
  candidates?: RawMorphologyCandidate[];
}

export async function analyzeMorphologyAndRoots(params: {
  profile: DocumentProfileResult;
  tokenIdx: number;
  targetMaxLevel: number;
  verifierCtx: CompiledVerifierContext | Promise<CompiledVerifierContext>;
  config: OpenRouterConfig;
  signal?: AbortSignal;
}): Promise<MorphologyAnalysisResult> {
  const { profile, tokenIdx, targetMaxLevel, config, signal } = params;
  const tok = profile.tokens[tokenIdx];
  if (!tok) {
    throw new Error('선택된 단어 정보를 찾을 수 없습니다.');
  }

  const enclosing = extractEnclosingSentenceSpan(profile, tokenIdx, tokenIdx);

  const [raw, verifierCtx] = await Promise.all([
    callOpenRouterJson<RawMorphologyLlmResponse>({
      config,
      temperature: 0.1,
      maxTokens: 650,
      signal,
      messages: [
        {
          role: 'system',
          content:
            'English morphologist & EFL lexicographer. Output one raw RFC 8259 JSON object only without markdown fences.',
        },
        {
          role: 'user',
          content: [
            `Word: "${tok.token}"`,
            `Sentence: "${enclosing.sentenceWithPunct}"`,
            'List up to 5 standalone English dictionary words serving as its lemma, derivational base(s), free root(s), compound parts, or family headword (NO bound Latin/Greek stems like "-ced-").',
            'Keep explanationKo (1 sentence) and n (<=8 Korean words) concise.',
            'JSON schema:',
            '{ "contextPos": "한글 (English)", "explanationKo": "1문장 형성 설명", "candidates": [{ "f": "lowercase word", "r": "lemma|derivational_base|root|compound_part|family_member", "n": "짧은 뜻과 역할" }] }',
          ].join('\n'),
        },
      ],
    }),
    Promise.resolve(params.verifierCtx),
  ]);

  const seenForms = new Set<string>();
  const verifiedCandidates: VerifiedMorphCandidate[] = [];

  const pushCandidate = (
    formRaw: string,
    relation: MorphRelationKind,
    noteKo: string,
  ) => {
    const cleaned = formRaw.trim();
    if (!cleaned || /[^A-Za-z'-]/.test(cleaned)) return;
    const dedupKey = verifierCtx.settings.ignoreCase
      ? cleaned.toLowerCase()
      : cleaned;
    if (seenForms.has(dedupKey)) return;
    seenForms.add(dedupKey);

    const status = verifySingleWord(cleaned, verifierCtx, targetMaxLevel);
    verifiedCandidates.push({
      form: cleaned,
      relation,
      relationLabelKo: RELATION_LABELS_KO[relation],
      noteKo: noteKo.trim(),
      status,
    });
  };

  for (const c of raw.candidates ?? []) {
    const formStr =
      typeof c?.form === 'string'
        ? c.form
        : typeof c?.f === 'string'
          ? c.f
          : '';
    if (formStr) {
      pushCandidate(
        formStr,
        normalizeRelation(c?.relation ?? c?.r),
        typeof c?.noteKo === 'string'
          ? c.noteKo
          : typeof c?.n === 'string'
            ? c.n
            : '',
      );
    }
  }

  // Deterministic fallback: if Master Family knows a headword that LLM omitted, include it
  const directStatus = verifySingleWord(tok.token, verifierCtx, targetMaxLevel);
  if (directStatus.masterHeadword) {
    pushCandidate(
      directStatus.masterHeadword,
      'family_member',
      '내장 Master Family 사전의 대표 표제어(Headword)',
    );
  }

  return {
    targetToken: tok.token,
    enclosingSentence: enclosing.sentenceWithPunct,
    contextPos:
      typeof raw.contextPos === 'string' && raw.contextPos.trim()
        ? raw.contextPos.trim()
        : '문맥 품사',
    explanationKo:
      typeof raw.explanationKo === 'string' && raw.explanationKo.trim()
        ? raw.explanationKo.trim()
        : `'${tok.token}'의 기본형 및 파생 어근에 대한 Word Lists 등재 여부를 대조했습니다.`,
    candidates: verifiedCandidates,
  };
}

type RawSynonymItem =
  | string
  | {
      replacementText?: string;
      replacement?: string;
      word?: string;
      w?: string;
      baseForm?: string;
      b?: string;
      meaningKo?: string;
      m?: string;
      nuanceKo?: string;
      n?: string;
    };

type RawParaphraseItem =
  | string
  | {
      styleLabelKo?: string;
      s?: string;
      rewrittenText?: string;
      sentence?: string;
      paraphrase?: string;
      text?: string;
      rewrite?: string;
      r?: string;
      noteKo?: string;
      k?: string;
    };

interface RawCombinedLlmResponse {
  inListSynonyms: RawSynonymItem[];
  freeSynonyms: RawSynonymItem[];
  inListParaphrases: RawParaphraseItem[];
  freeParaphrases: RawParaphraseItem[];
}

const MAX_REPLACEMENT_TOKENS = 6;

function normalizeSentenceCompareKey(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+["'”’)\]}]*$/, '')
    .toLowerCase();
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function buildSentenceWithSpanReplacement(
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
    return replacement.trim();
  }

  const cased = matchSurfaceCapitalization(
    tokens[spanStartIdx].token,
    replacement,
  );
  let out = '';
  for (let i = enclosingStartIdx; i <= enclosingEndIdx; i++) {
    if (i > spanStartIdx && i <= spanEndIdx) continue;
    out += i === spanStartIdx ? cased : tokens[i].token;
    const trailingIdx = i === spanStartIdx ? spanEndIdx : i;
    if (trailingIdx < enclosingEndIdx) {
      out += tokens[trailingIdx].trailingWs;
    } else {
      const m = tokens[trailingIdx].trailingWs.match(/^([.?!]+["'”’)\]}]*)/);
      if (m) out += m[1];
    }
  }
  return out.trim();
}

function extractSynonymText(item: RawSynonymItem): {
  replacementText: string;
  baseForm?: string;
  meaningKo?: string;
  nuanceKo?: string;
} {
  if (typeof item === 'string') {
    return { replacementText: item.trim() };
  }
  if (!item || typeof item !== 'object') {
    return { replacementText: '' };
  }
  const raw =
    typeof item.replacementText === 'string'
      ? item.replacementText
      : typeof item.replacement === 'string'
        ? item.replacement
        : typeof item.word === 'string'
          ? item.word
          : typeof item.w === 'string'
            ? item.w
            : '';
  const baseForm =
    typeof item.baseForm === 'string'
      ? item.baseForm
      : typeof item.b === 'string'
        ? item.b
        : undefined;
  const meaningKo =
    typeof item.meaningKo === 'string'
      ? item.meaningKo
      : typeof item.m === 'string'
        ? item.m
        : undefined;
  const nuanceKo =
    typeof item.nuanceKo === 'string'
      ? item.nuanceKo
      : typeof item.n === 'string'
        ? item.n
        : undefined;
  return {
    replacementText: raw.trim(),
    baseForm,
    meaningKo,
    nuanceKo,
  };
}

function extractParaphraseEntry(item: RawParaphraseItem): {
  rewrittenText: string;
  styleLabelKo: string;
  noteKo: string;
} {
  if (typeof item === 'string') {
    return {
      rewrittenText: item.trim(),
      styleLabelKo: '패러프레이즈 대안',
      noteKo: '',
    };
  }
  if (!item || typeof item !== 'object') {
    return { rewrittenText: '', styleLabelKo: '패러프레이즈 대안', noteKo: '' };
  }
  const raw =
    typeof item.rewrittenText === 'string'
      ? item.rewrittenText
      : typeof item.sentence === 'string'
        ? item.sentence
        : typeof item.paraphrase === 'string'
          ? item.paraphrase
          : typeof item.text === 'string'
            ? item.text
            : typeof item.rewrite === 'string'
              ? item.rewrite
              : typeof item.r === 'string'
                ? item.r
                : '';
  const styleLabel =
    typeof item.styleLabelKo === 'string' && item.styleLabelKo.trim()
      ? item.styleLabelKo.trim()
      : typeof item.s === 'string' && item.s.trim()
        ? item.s.trim()
        : '패러프레이즈 대안';
  const note =
    typeof item.noteKo === 'string'
      ? item.noteKo.trim()
      : typeof item.k === 'string'
        ? item.k.trim()
        : '';
  return {
    rewrittenText: raw.trim(),
    styleLabelKo: styleLabel,
    noteKo: note,
  };
}

function evaluateSynonymCandidates(params: {
  rawList: RawSynonymItem[];
  originalText: string;
  capitalizationAnchor: string;
  profile: DocumentProfileResult;
  spanStartIdx: number;
  spanEndIdx: number;
  enclosingStartIdx: number;
  enclosingEndIdx: number;
  targetMaxLevel: number;
  verifierCtx: CompiledVerifierContext;
}): {
  verified: VerifiedSynonymCandidate[];
  rejectedForms: string[];
} {
  const {
    rawList,
    originalText,
    capitalizationAnchor,
    profile,
    spanStartIdx,
    spanEndIdx,
    enclosingStartIdx,
    enclosingEndIdx,
    targetMaxLevel,
    verifierCtx,
  } = params;

  const origKey = originalText.trim().toLowerCase();
  const seen = new Set<string>();
  const verified: VerifiedSynonymCandidate[] = [];
  const rejectedForms: string[] = [];

  for (const item of rawList) {
    const parsedItem = extractSynonymText(item);
    const rawRep = parsedItem.replacementText;
    if (!rawRep) continue;

    const casedRep = matchSurfaceCapitalization(capitalizationAnchor, rawRep);
    const dedupKey = casedRep.toLowerCase();
    if (dedupKey === origKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const { pieces } = tokenizeLossless(
      casedRep,
      verifierCtx.settings.tokenDefinition,
      verifierCtx.settings.ignoreCase,
    );
    if (pieces.length === 0 || pieces.length > MAX_REPLACEMENT_TOKENS) continue;

    let allWithinCap = true;
    let allInActive = true;
    const outTokens: string[] = [];
    let highestLevel: number | null = null;
    let primaryListId: string | null = null;
    let primaryListName = '';
    let primaryLevelIndex = -1;

    for (const p of pieces) {
      const st = verifySingleWord(p.token, verifierCtx, targetMaxLevel);
      if (!st.withinTargetCap) {
        allWithinCap = false;
        outTokens.push(p.token);
      }
      if (!st.inActiveList && st.kind !== 'ignored') allInActive = false;
      if (st.kind === 'level' && st.statLevelNumber !== null) {
        if (highestLevel === null || st.statLevelNumber > highestLevel) {
          highestLevel = st.statLevelNumber;
          primaryListId = st.listId;
          primaryListName = st.listName;
          primaryLevelIndex = st.activeLevelIndex;
        }
      }
    }

    if (!allWithinCap) {
      rejectedForms.push(rawRep);
    }

    verified.push({
      replacementText: casedRep,
      baseForm:
        parsedItem.baseForm && parsedItem.baseForm.trim()
          ? parsedItem.baseForm.trim()
          : casedRep.toLowerCase(),
      meaningKo: parsedItem.meaningKo ? parsedItem.meaningKo.trim() : '',
      nuanceKo: parsedItem.nuanceKo ? parsedItem.nuanceKo.trim() : '',
      isMultiWord: pieces.length > 1,
      allTokensWithinCap: allWithinCap,
      allTokensInActiveLists: allInActive,
      outTokens,
      highestLevelNumber: highestLevel,
      primaryListId,
      primaryListName:
        primaryListName || (allInActive ? 'ignore_list' : 'out_of_list'),
      primaryLevelIndex,
      previewSentence: buildSentencePreviewForSpan(
        profile,
        spanStartIdx,
        spanEndIdx,
        enclosingStartIdx,
        enclosingEndIdx,
        casedRep,
      ),
    });
  }

  return { verified, rejectedForms };
}

const CORE_ANCHOR_CANDIDATES = [
  'simple',
  'clear',
  'basic',
  'common',
  'main',
  'key',
  'direct',
  'steady',
  'exact',
  'easy',
  'plain',
  'change',
  'show',
  'help',
  'make',
  'use',
  'keep',
  'grow',
  'form',
  'link',
  'part',
  'view',
  'rule',
  'state',
  'group',
  'level',
  'way',
  'idea',
] as const;

function sampleCoreAllowedAnchors(
  ctx: CompiledVerifierContext,
  targetMaxLevel: number,
): string[] {
  const hits: string[] = [];
  for (const w of CORE_ANCHOR_CANDIDATES) {
    const key = ctx.settings.ignoreCase ? w.toLowerCase() : w;
    const hit = ctx.compiled.lookup.get(key);
    if (hit && hit.kind === 'level' && hit.statLevelNumber <= targetMaxLevel) {
      hits.push(w);
    }
  }
  return hits.slice(0, 14);
}

function describeAllowedLists(ctx: CompiledVerifierContext): string {
  if (ctx.compiled.parsedLists.length === 0) {
    return 'Basic high-frequency core English';
  }
  return ctx.compiled.parsedLists
    .map(
      (pl) =>
        `Level ${pl.statLevelNumber}: ${pl.name} (${pl.uniqueHeadwordCount} headwords)`,
    )
    .join(', ');
}

function parseCombinedResponse(raw: unknown): RawCombinedLlmResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  }
  let obj = raw as Record<string, unknown>;
  const hasTopLevelKeys =
    obj.a !== undefined ||
    obj.b !== undefined ||
    obj.c !== undefined ||
    obj.d !== undefined ||
    obj.inListSynonyms !== undefined ||
    obj.freeSynonyms !== undefined ||
    obj.outOfListSynonyms !== undefined ||
    obj.unconstrainedSynonyms !== undefined ||
    obj.inListParaphrases !== undefined ||
    obj.freeParaphrases !== undefined ||
    obj.outOfListParaphrases !== undefined ||
    obj.unconstrainedParaphrases !== undefined ||
    obj.synonyms !== undefined ||
    obj.replacements !== undefined ||
    obj.synonymCandidates !== undefined ||
    obj.paraphrases !== undefined ||
    obj.paraphraseCandidates !== undefined ||
    obj.rewrites !== undefined ||
    obj.sentences !== undefined;
  if (!hasTopLevelKeys) {
    const nested = obj.result ?? obj.data;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
    }
  }

  const inListSynonyms =
    obj.a ??
    obj.inListSynonyms ??
    obj.synonyms ??
    obj.replacements ??
    obj.synonymCandidates;
  const freeSynonyms =
    obj.b ??
    obj.freeSynonyms ??
    obj.outOfListSynonyms ??
    obj.unconstrainedSynonyms;
  const inListParaphrases =
    obj.c ??
    obj.inListParaphrases ??
    obj.paraphrases ??
    obj.paraphraseCandidates ??
    obj.rewrites ??
    obj.sentences;
  const freeParaphrases =
    obj.d ??
    obj.freeParaphrases ??
    obj.outOfListParaphrases ??
    obj.unconstrainedParaphrases;

  if (
    (inListSynonyms != null && !Array.isArray(inListSynonyms)) ||
    (freeSynonyms != null && !Array.isArray(freeSynonyms))
  ) {
    throw new Error('AI 추천 단어 응답 형식이 올바르지 않습니다.');
  }
  if (
    (inListParaphrases != null && !Array.isArray(inListParaphrases)) ||
    (freeParaphrases != null && !Array.isArray(freeParaphrases))
  ) {
    throw new Error('AI 패러프레이즈 응답 형식이 올바르지 않습니다.');
  }

  return {
    inListSynonyms: (inListSynonyms as RawSynonymItem[] | undefined | null) ?? [],
    freeSynonyms: (freeSynonyms as RawSynonymItem[] | undefined | null) ?? [],
    inListParaphrases:
      (inListParaphrases as RawParaphraseItem[] | undefined | null) ?? [],
    freeParaphrases:
      (freeParaphrases as RawParaphraseItem[] | undefined | null) ?? [],
  };
}

function extractParaphraseArrayFromResponse(raw: unknown): RawParaphraseItem[] {
  if (Array.isArray(raw)) {
    return raw as RawParaphraseItem[];
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const parsed = parseCombinedResponse(raw);
  return [...parsed.inListParaphrases, ...parsed.freeParaphrases];
}

/**
 * One request (plus repair / rescue fallback as needed) that returns up to three
 * in-list replacement words and at least one verified sentence paraphrase
 * for the selected word or expression.
 */
export async function suggestReplacementsAndParaphrases(params: {
  profile: DocumentProfileResult;
  spanStartIdx: number;
  spanEndIdx: number;
  targetMaxLevel: number;
  verifierCtx: CompiledVerifierContext;
  config: OpenRouterConfig;
  signal?: AbortSignal;
}): Promise<CombinedSuggestionResult> {
  const { profile, targetMaxLevel, verifierCtx, config, signal } = params;
  const tokens = profile.tokens;
  if (tokens.length === 0) {
    throw new Error('선택된 단어 정보를 찾을 수 없습니다.');
  }
  const spanStartIdx = Math.max(
    0,
    Math.min(params.spanStartIdx, tokens.length - 1),
  );
  const spanEndIdx = Math.max(
    spanStartIdx,
    Math.min(params.spanEndIdx, tokens.length - 1),
  );
  const isMultiWord = spanEndIdx > spanStartIdx;
  const targetText = sliceProfileSpanText(
    profile,
    spanStartIdx,
    spanEndIdx,
    false,
  );
  const capitalizationAnchor = tokens[spanStartIdx].token;

  const enclosing = extractEnclosingSentenceSpan(
    profile,
    spanStartIdx,
    spanEndIdx,
  );
  const enclosingCompareKey = normalizeSentenceCompareKey(
    enclosing.sentenceWithPunct,
  );
  const levelDesc = describeAllowedLists(verifierCtx);
  const guidance = collectSpanLexicalGuidance(
    profile,
    enclosing.startTokenIdx,
    enclosing.endTokenIdx,
    targetMaxLevel,
  );

  const auditParaphrases = (
    rawItems: RawParaphraseItem[],
  ): VerifiedParaphraseCandidate[] => {
    const out: VerifiedParaphraseCandidate[] = [];
    const seen = new Set<string>();
    for (const item of rawItems) {
      const entry = extractParaphraseEntry(item);
      const text = entry.rewrittenText;
      if (!text) continue;
      const compareKey = normalizeSentenceCompareKey(text);
      if (!compareKey || compareKey === enclosingCompareKey) continue;
      const key = text.toLowerCase();
      if (seen.has(key) || seen.has(compareKey)) continue;
      seen.add(key);
      seen.add(compareKey);
      const audit = auditParaphraseCandidateText(
        text,
        verifierCtx,
        targetMaxLevel,
        guidance.properNounsCarryover,
      );
      out.push({
        styleLabelKo: entry.styleLabelKo,
        rewrittenText: text,
        noteKo: entry.noteKo,
        leadingWs: audit.leadingWs,
        tokens: audit.tokens,
        remainingOutWords: audit.remainingOutWords,
        outWordCount: audit.outWordCount,
        totalTokens: audit.totalTokens,
        inTargetPercentage: audit.inTargetPercentage,
      });
    }
    return out;
  };

  const evaluateSynonyms = (rawList: RawSynonymItem[]) =>
    evaluateSynonymCandidates({
      rawList,
      originalText: targetText,
      capitalizationAnchor,
      profile,
      spanStartIdx,
      spanEndIdx,
      enclosingStartIdx: enclosing.startTokenIdx,
      enclosingEndIdx: enclosing.endTokenIdx,
      targetMaxLevel,
      verifierCtx,
    });

  const targetLine = isMultiWord
    ? `Target expression: "${targetText}"`
    : `Target word: "${targetText}"`;
  const wordsToReplaceSample = guidance.wordsToReplace.slice(0, 10);
  const allowedWordsSample = Array.from(
    new Set([
      ...guidance.allowedWordsInSpan,
      ...sampleCoreAllowedAnchors(verifierCtx, targetMaxLevel),
    ]),
  ).slice(0, 24);

  const buildAuditedSlotParaphrase = (
    syn: VerifiedSynonymCandidate,
    styleLabelKo: string,
    noteKo: string,
  ): VerifiedParaphraseCandidate | null => {
    const rewritten = buildSentenceWithSpanReplacement(
      profile,
      spanStartIdx,
      spanEndIdx,
      enclosing.startTokenIdx,
      enclosing.endTokenIdx,
      syn.replacementText,
    );
    const compareKey = normalizeSentenceCompareKey(rewritten);
    if (!compareKey || compareKey === enclosingCompareKey) return null;
    const audit = auditParaphraseCandidateText(
      rewritten,
      verifierCtx,
      targetMaxLevel,
      guidance.properNounsCarryover,
    );
    return {
      styleLabelKo,
      rewrittenText: rewritten,
      noteKo,
      leadingWs: audit.leadingWs,
      tokens: audit.tokens,
      remainingOutWords: audit.remainingOutWords,
      outWordCount: audit.outWordCount,
      totalTokens: audit.totalTokens,
      inTargetPercentage: audit.inTargetPercentage,
    };
  };

  const firstRaw = parseCombinedResponse(
    await callOpenRouterJson<unknown>({
      config,
      temperature: 0.2,
      maxTokens: 1400,
      signal,
      messages: [
        {
          role: 'system',
          content:
            'EFL lexical & paraphrase assistant. Output one compact raw RFC 8259 JSON object only without markdown fences.',
        },
        {
          role: 'user',
          content: [
            targetLine,
            `Sentence: "${enclosing.sentenceWithPunct}"`,
            `Allowed lists: ${levelDesc}`,
            !verifierCtx.masterEnabled
              ? 'Word-family OFF for a/c: prefer base/singular forms.'
              : '',
            wordsToReplaceSample.length > 0
              ? `Avoid in c: [${wordsToReplaceSample.join(', ')}]`
              : '',
            allowedWordsSample.length > 0
              ? `Safe core words: [${allowedWordsSample.join(', ')}]`
              : '',
            'JSON schema:',
            '{',
            '  "a": [{ "w": "in-list replacement", "b": "lemma", "m": "핵심 뜻", "n": "짧은 뉘앙스" }],',
            '  "b": [{ "w": "unconstrained natural replacement", "b": "lemma", "m": "핵심 뜻", "n": "짧은 뉘앙스" }],',
            '  "c": [{ "s": "쉬운 기초 풀이", "r": "sentence using ONLY Allowed lists", "k": "짧은 설명" }],',
            '  "d": [{ "s": "자연스러운 확장", "r": "natural sentence including unlisted words", "k": "짧은 설명" }]',
            '}',
            'Rules:',
            `- a: 4 ${isMultiWord ? 'short (1-4 word)' : 'single-word'} replacements strictly inside Allowed lists.`,
            `- b: 3 distinct ${isMultiWord ? 'short (1-4 word)' : 'single-word'} contextually accurate replacements NOT restricted to Allowed lists.`,
            '- c: 3 distinct sentences different from Sentence using ONLY Allowed lists.',
            '- d: 3 distinct natural sentences different from Sentence and c, freely using expressive words outside Allowed lists.',
            '- Keep m/n/k <= 6 Korean words.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    }),
  );

  const inSynPass = evaluateSynonyms(firstRaw.inListSynonyms);
  const freeSynPass = evaluateSynonyms(firstRaw.freeSynonyms);
  let inParaAudited = auditParaphrases(firstRaw.inListParaphrases);
  const freeParaAudited = auditParaphrases(firstRaw.freeParaphrases);
  let repaired = false;
  let attemptedParaphraseRepair = false;

  const initialWithinCapCount = [
    ...inSynPass.verified,
    ...freeSynPass.verified,
  ].filter((c) => c.allTokensWithinCap).length;

  const needSynonymRepair =
    verifierCtx.activeListCount > 0 && initialWithinCapCount === 0;
  const needParaphraseRepair =
    inParaAudited.length === 0 && freeParaAudited.length === 0;

  if (needSynonymRepair || needParaphraseRepair) {
    repaired = true;
    attemptedParaphraseRepair = needParaphraseRepair;
    const rejectedSyn = Array.from(
      new Set([...inSynPass.rejectedForms, ...freeSynPass.rejectedForms]),
    )
      .slice(0, 12)
      .join(', ');
    const rejectedPara = Array.from(
      new Set(inParaAudited.flatMap((c) => c.remainingOutWords)),
    )
      .slice(0, 16)
      .join(', ');

    const repairRaw = parseCombinedResponse(
      await callOpenRouterJson<unknown>({
        config,
        temperature: 0.15,
        maxTokens: 650,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'Strict lexical-control editor. Use ONLY ultra-basic core English (top 1,000 words). Output one raw RFC 8259 JSON object only without markdown fences.',
          },
          {
            role: 'user',
            content: [
              targetLine,
              `Sentence: "${enclosing.sentenceWithPunct}"`,
              `Allowed: ${levelDesc}`,
              !verifierCtx.masterEnabled
                ? 'Word-family OFF: prefer base/singular forms.'
                : '',
              needSynonymRepair && rejectedSyn
                ? `Do not reuse: ${rejectedSyn}`
                : '',
              needParaphraseRepair && rejectedPara
                ? `Forbidden out-words: ${rejectedPara}`
                : '',
              'JSON:',
              '{',
              needSynonymRepair
                ? '  "a": [{ "w": "word", "b": "lemma", "m": "뜻", "n": "어감" }],'
                : '  "a": [],',
              needParaphraseRepair
                ? '  "c": [{ "s": "쉬운 기초 풀이", "r": "Full sentence.", "k": "설명" }]'
                : '  "c": []',
              '}',
              needSynonymRepair ? 'Provide 3 simpler in-list words in a.' : '',
              needParaphraseRepair
                ? 'Provide 2 ultra-basic paraphrases in c different from Sentence.'
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }),
    );

    if (needSynonymRepair) {
      const pass2 = evaluateSynonyms([
        ...repairRaw.inListSynonyms,
        ...repairRaw.freeSynonyms,
      ]);
      const existing = new Set(
        inSynPass.verified.map((m) => m.replacementText.toLowerCase()),
      );
      for (const c of pass2.verified) {
        const k = c.replacementText.toLowerCase();
        if (!existing.has(k)) {
          inSynPass.verified.push(c);
          existing.add(k);
        }
      }
    }

    if (needParaphraseRepair) {
      inParaAudited = [
        ...auditParaphrases([
          ...repairRaw.inListParaphrases,
          ...repairRaw.freeParaphrases,
        ]),
        ...inParaAudited,
      ];
    }
  }

  // Assemble Group A: up to 3 replacement candidates strictly within active Word Lists
  const uniqueInSynPool = new Map<string, VerifiedSynonymCandidate>();
  for (const c of [...inSynPass.verified, ...freeSynPass.verified]) {
    if (!c.allTokensWithinCap) continue;
    const key = c.replacementText.toLowerCase();
    if (!uniqueInSynPool.has(key)) {
      uniqueInSynPool.set(key, c);
    }
  }
  const inListSynonymCandidates = Array.from(uniqueInSynPool.values())
    .sort((a, b) => {
      const lvlA = a.highestLevelNumber ?? 999;
      const lvlB = b.highestLevelNumber ?? 999;
      if (lvlA !== lvlB) return lvlA - lvlB;
      if (a.isMultiWord !== b.isMultiWord) return a.isMultiWord ? 1 : -1;
      return 0;
    })
    .slice(0, 3);

  // Assemble Group B: up to 3 free/unconstrained replacement candidates (out-of-list first, no duplicates with Group A)
  const usedSynKeys = new Set(
    inListSynonymCandidates.map((c) => c.replacementText.toLowerCase()),
  );
  const freeSynonymCandidates: VerifiedSynonymCandidate[] = [];
  const pushFreeSynonym = (c: VerifiedSynonymCandidate) => {
    if (freeSynonymCandidates.length >= 3) return;
    const key = c.replacementText.toLowerCase();
    if (usedSynKeys.has(key)) return;
    usedSynKeys.add(key);
    freeSynonymCandidates.push(c);
  };
  // Group B stays out-of-list only — never pad with in-list fillers (those belong in Group A).
  for (const c of freeSynPass.verified) {
    if (!c.allTokensWithinCap) pushFreeSynonym(c);
  }
  for (const c of inSynPass.verified) {
    if (!c.allTokensWithinCap) pushFreeSynonym(c);
  }

  // Assemble Group C: up to 3 Word-List-only paraphrases (outWordCount === 0 only)
  const inParaMap = new Map<string, VerifiedParaphraseCandidate>();
  const addInPara = (c: VerifiedParaphraseCandidate) => {
    if (c.outWordCount !== 0) return;
    if (inParaMap.size >= 3) return;
    const key = normalizeSentenceCompareKey(c.rewrittenText);
    if (!key || inParaMap.has(key)) return;
    inParaMap.set(key, c);
  };

  // Tier C1: Strictly in-list paraphrases across both pools
  for (const c of [...inParaAudited, ...freeParaAudited]) {
    addInPara(c);
  }

  // Tier C2: Dedicated lightweight paraphrase rescue request only if Pass 2 did not already attempt it
  if (
    inParaMap.size === 0 &&
    !attemptedParaphraseRepair &&
    freeParaAudited.length === 0
  ) {
    try {
      const rescueRaw = await callOpenRouterJson<unknown>({
        config,
        temperature: 0.25,
        maxTokens: 650,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'EFL writing assistant. Rewrite Sentence into simple English paraphrases. Output one raw RFC 8259 JSON object only without markdown fences.',
          },
          {
            role: 'user',
            content: [
              `Sentence: "${enclosing.sentenceWithPunct}"`,
              `Focus: "${targetText}"`,
              `Allowed: ${levelDesc}`,
              'Provide 3 simple English sentences different from Sentence:',
              '{ "c": [{ "s": "쉬운 문장 재구성", "r": "Simple sentence.", "k": "짧은 설명" }] }',
            ].join('\n'),
          },
        ],
      });
      const rescueAudited = auditParaphrases(
        extractParaphraseArrayFromResponse(rescueRaw),
      );
      if (rescueAudited.length > 0) {
        const sortedRescue = [...rescueAudited].sort(
          (a, b) =>
            a.outWordCount - b.outWordCount ||
            b.inTargetPercentage - a.inTargetPercentage,
        );
        for (const c of sortedRescue) {
          addInPara(c);
        }
      }
    } catch (err) {
      if (isAbortError(err, signal)) {
        throw err;
      }
      // Fall through cleanly to local deterministic synthesis (Tier C3 / Tier C4)
    }
  }

  // Tier C3: Deterministic local synthesis from in-list synonym replacements only
  if (inParaMap.size === 0) {
    const synPool = [...inListSynonymCandidates, ...inSynPass.verified].filter(
      (syn) => syn.allTokensWithinCap,
    );
    for (const syn of synPool) {
      if (inParaMap.size >= 3) break;
      const synth = buildAuditedSlotParaphrase(
        syn,
        '추천 어휘 적용 문장',
        `'${targetText}' 위치에 '${syn.replacementText}'을(를) 적용해 재구성한 문장입니다.`,
      );
      if (synth) addInPara(synth);
    }
  }

  // Tier C4: Absolute guarantee floor (>= 1 paraphrase entry always present).
  // May include out-of-list tokens from the original sentence when no in-list rewrite exists;
  // UI badges still report outWordCount honestly.
  if (inParaMap.size === 0 && enclosing.sentenceWithPunct.trim()) {
    const baselineText = enclosing.sentenceWithPunct.trim();
    const audit = auditParaphraseCandidateText(
      baselineText,
      verifierCtx,
      targetMaxLevel,
      guidance.properNounsCarryover,
    );
    inParaMap.set(
      normalizeSentenceCompareKey(baselineText) || baselineText.toLowerCase(),
      {
        styleLabelKo: '원문 기반 기준 문장',
        rewrittenText: baselineText,
        noteKo:
          '활성 Word List만으로 대체 문장을 찾지 못해 원문 어휘 구성을 표시합니다. 다시 추천을 눌러 재시도해 보세요.',
        leadingWs: audit.leadingWs,
        tokens: audit.tokens,
        remainingOutWords: audit.remainingOutWords,
        outWordCount: audit.outWordCount,
        totalTokens: audit.totalTokens,
        inTargetPercentage: audit.inTargetPercentage,
      },
    );
  }

  const inListParaphraseCandidates = Array.from(inParaMap.values()).slice(0, 3);

  // Assemble Group D: up to 3 natural paraphrases including out-of-list words (no duplicates with Group C)
  const usedParaKeys = new Set(Array.from(inParaMap.keys()));
  const freeParaMap = new Map<string, VerifiedParaphraseCandidate>();
  const addFreePara = (c: VerifiedParaphraseCandidate) => {
    if (freeParaMap.size >= 3) return;
    const key = normalizeSentenceCompareKey(c.rewrittenText);
    if (!key || key === enclosingCompareKey) return;
    if (usedParaKeys.has(key) || freeParaMap.has(key)) return;
    freeParaMap.set(key, c);
  };

  for (const c of freeParaAudited) {
    if (c.outWordCount >= 1) addFreePara(c);
  }
  for (const c of inParaAudited) {
    if (c.outWordCount >= 1) addFreePara(c);
  }
  for (const c of freeParaAudited) {
    if (c.outWordCount === 0) addFreePara(c);
  }
  for (const c of inParaAudited) {
    if (c.outWordCount === 0) addFreePara(c);
  }

  // Deterministic synthesis fallback for Group D from Group B (freeSynonymCandidates)
  if (freeParaMap.size < 3 && freeSynonymCandidates.length > 0) {
    for (const syn of freeSynonymCandidates) {
      if (freeParaMap.size >= 3) break;
      const synth = buildAuditedSlotParaphrase(
        syn,
        '확장 대체 어휘 적용 문장',
        `'${targetText}' 위치에 '${syn.replacementText}'을(를) 적용해 표현한 문장입니다.`,
      );
      if (synth) addFreePara(synth);
    }
  }

  const freeParaphraseCandidates = Array.from(freeParaMap.values()).slice(0, 3);

  return {
    targetText,
    spanStartIdx,
    spanEndIdx,
    enclosingSentence: enclosing.sentenceWithPunct,
    targetMaxLevel,
    sourceOriginalText: profile.originalText,
    sourceId: profile.sourceId,
    inListSynonymCandidates,
    freeSynonymCandidates,
    inListParaphraseCandidates,
    freeParaphraseCandidates,
    synonymCandidates: inListSynonymCandidates,
    paraphraseCandidates: inListParaphraseCandidates,
    paraphraseSpanStartIdx: enclosing.startTokenIdx,
    paraphraseSpanEndIdx: enclosing.endTokenIdx,
    repaired,
  };
}

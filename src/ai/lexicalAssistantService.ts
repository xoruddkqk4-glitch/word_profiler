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

interface RawMorphologyLlmResponse {
  contextPos?: string;
  explanationKo?: string;
  candidates?: {
    form?: string;
    relation?: string;
    noteKo?: string;
  }[];
}

export async function analyzeMorphologyAndRoots(params: {
  profile: DocumentProfileResult;
  tokenIdx: number;
  targetMaxLevel: number;
  verifierCtx: CompiledVerifierContext;
  config: OpenRouterConfig;
  signal?: AbortSignal;
}): Promise<MorphologyAnalysisResult> {
  const { profile, tokenIdx, targetMaxLevel, verifierCtx, config, signal } =
    params;
  const tok = profile.tokens[tokenIdx];
  if (!tok) {
    throw new Error('선택된 단어 정보를 찾을 수 없습니다.');
  }

  const enclosing = extractEnclosingSentenceSpan(profile, tokenIdx, tokenIdx);

  const raw = await callOpenRouterJson<RawMorphologyLlmResponse>({
    config,
    temperature: 0.1,
    maxTokens: 1200,
    signal,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert English morphologist and EFL lexicographer. Return ONLY valid raw JSON without markdown fences.',
      },
      {
        role: 'user',
        content: [
          `Target word: "${tok.token}"`,
          `Sentence context: "${enclosing.sentenceWithPunct}"`,
          '',
          'Analyze the morphological structure of the target word in this sentence and list standalone English dictionary words that serve as its inflectional base (lemma), derivational base(s), free root word(s), compound parts (if compound), and core word-family headword.',
          'Do NOT output bound Latin/Greek stems that are not real standalone English words (e.g., output "precede" and "precedent", NOT "-ced-").',
          'Keep explanationKo and noteKo concise (1 short sentence). Output raw JSON only without markdown fences.',
          '',
          'Return JSON with exact keys:',
          '{',
          '  "contextPos": "Korean + English POS label in this sentence, e.g. 부사 (Adverb)",',
          '  "explanationKo": "Concise 1-2 sentence Korean explanation of how this word is formed from its base/root",',
          '  "candidates": [',
          '    {',
          '      "form": "standalone English word in lowercase (unless proper noun)",',
          '      "relation": "lemma | derivational_base | root | compound_part | family_member",',
          '      "noteKo": "Brief Korean meaning & morphological role"',
          '    }',
          '  ]',
          '}',
        ].join('\n'),
      },
    ],
  });

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
    if (typeof c?.form === 'string') {
      pushCandidate(
        c.form,
        normalizeRelation(c.relation),
        typeof c.noteKo === 'string' ? c.noteKo : '',
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
      baseForm?: string;
      meaningKo?: string;
      nuanceKo?: string;
    };

type RawParaphraseItem =
  | string
  | {
      styleLabelKo?: string;
      rewrittenText?: string;
      sentence?: string;
      paraphrase?: string;
      text?: string;
      rewrite?: string;
      noteKo?: string;
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
          : '';
  return {
    replacementText: raw.trim(),
    baseForm: typeof item.baseForm === 'string' ? item.baseForm : undefined,
    meaningKo: typeof item.meaningKo === 'string' ? item.meaningKo : undefined,
    nuanceKo: typeof item.nuanceKo === 'string' ? item.nuanceKo : undefined,
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
              : '';
  return {
    rewrittenText: raw.trim(),
    styleLabelKo:
      typeof item.styleLabelKo === 'string' && item.styleLabelKo.trim()
        ? item.styleLabelKo.trim()
        : '패러프레이즈 대안',
    noteKo: typeof item.noteKo === 'string' ? item.noteKo.trim() : '',
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
    obj.inListSynonyms ??
    obj.synonyms ??
    obj.replacements ??
    obj.synonymCandidates;
  const freeSynonyms =
    obj.freeSynonyms ?? obj.outOfListSynonyms ?? obj.unconstrainedSynonyms;
  const inListParaphrases =
    obj.inListParaphrases ??
    obj.paraphrases ??
    obj.paraphraseCandidates ??
    obj.rewrites ??
    obj.sentences;
  const freeParaphrases =
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
  const wordsToReplaceSample = guidance.wordsToReplace.slice(0, 12);
  const allowedWordsSample = guidance.allowedWordsInSpan.slice(0, 24);

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
      maxTokens: 3200,
      signal,
      messages: [
        {
          role: 'system',
          content:
            'EFL lexical & paraphrase assistant. Generate BOTH strict word-list-controlled candidates AND natural unconstrained candidates. Output one raw RFC 8259 JSON object only.',
        },
        {
          role: 'user',
          content: [
            targetLine,
            `Sentence: "${enclosing.sentenceWithPunct}"`,
            `Allowed lists: ${levelDesc}`,
            !verifierCtx.masterEnabled
              ? 'Word-family expansion OFF for inList*: prefer base/singular forms (student, word, help).'
              : '',
            wordsToReplaceSample.length > 0
              ? `For inListParaphrases, avoid/replace out-of-list words: [${wordsToReplaceSample.join(', ')}]`
              : '',
            allowedWordsSample.length > 0
              ? `Safe in-list words: [${allowedWordsSample.join(', ')}]`
              : '',
            'JSON schema:',
            '{',
            '  "inListSynonyms": [{ "replacementText": "in-list replacement", "baseForm": "lemma", "meaningKo": "핵심 뜻", "nuanceKo": "뉘앙스" }],',
            '  "freeSynonyms": [{ "replacementText": "unconstrained natural replacement", "baseForm": "lemma", "meaningKo": "핵심 뜻", "nuanceKo": "뉘앙스" }],',
            '  "inListParaphrases": [{ "styleLabelKo": "쉬운 기초어휘 풀이 | 자연스러운 표준 표현 | 원문 구조 유지 최소 수정", "rewrittenText": "sentence using ONLY allowed lists", "noteKo": "짧은 설명" }],',
            '  "freeParaphrases": [{ "styleLabelKo": "자연스러운 확장 표현 | 정교한 의미 전달 | 학술·심화 재구성", "rewrittenText": "natural sentence including unlisted words", "noteKo": "짧은 설명" }]',
            '}',
            'Rules:',
            `- inListSynonyms: 5 ${isMultiWord ? 'short (1-4 word)' : 'single-word'} replacements strictly inside Allowed lists.`,
            `- freeSynonyms: 5 distinct ${isMultiWord ? 'short (1-4 word)' : 'single-word'} contextually accurate replacements NOT restricted to Allowed lists (prefer natural words outside Allowed lists).`,
            '- inListParaphrases: 4 distinct sentences different from Sentence using ONLY Allowed lists.',
            '- freeParaphrases: 4 distinct natural sentences different from Sentence and inListParaphrases, freely including expressive/academic words outside Allowed lists.',
            '- Keep meaningKo/nuanceKo/noteKo <= 10 words.',
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
        maxTokens: 1400,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict lexical-control editor. Use ONLY ultra-basic core English (top 1,000 words). Output ONLY one raw RFC 8259 JSON object without markdown fences.',
          },
          {
            role: 'user',
            content: [
              targetLine,
              `Sentence: "${enclosing.sentenceWithPunct}"`,
              `Allowed vocabulary: ${levelDesc}`,
              !verifierCtx.masterEnabled
                ? 'Word-family expansion is OFF: prefer base/singular forms.'
                : '',
              needSynonymRepair && rejectedSyn
                ? `Rejected replacements (NOT in the lists — do not reuse): ${rejectedSyn}`
                : '',
              needParaphraseRepair && rejectedPara
                ? `Out-of-list words that MUST NOT appear: ${rejectedPara}`
                : '',
              '',
              'Return ONLY valid RFC 8259 JSON with exact keys:',
              '{',
              needSynonymRepair
                ? '  "inListSynonyms": [{ "replacementText": "word", "baseForm": "lemma", "meaningKo": "뜻", "nuanceKo": "어감" }],'
                : '  "inListSynonyms": [],',
              needParaphraseRepair
                ? '  "inListParaphrases": [{ "styleLabelKo": "쉬운 기초어휘 풀이", "rewrittenText": "Full sentence.", "noteKo": "설명" }]'
                : '  "inListParaphrases": []',
              '}',
              needSynonymRepair
                ? 'Provide 5 much simpler in-list replacements.'
                : '',
              needParaphraseRepair
                ? 'Provide 3 full-sentence paraphrases using ultra-basic core English and allowed vocabulary. Each rewrittenText MUST differ from Sentence.'
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
  for (const c of freeSynPass.verified) {
    if (!c.allTokensWithinCap) pushFreeSynonym(c);
  }
  for (const c of inSynPass.verified) {
    if (!c.allTokensWithinCap) pushFreeSynonym(c);
  }
  for (const c of freeSynPass.verified) {
    if (c.allTokensWithinCap) pushFreeSynonym(c);
  }
  for (const c of inSynPass.verified) {
    if (c.allTokensWithinCap) pushFreeSynonym(c);
  }

  // Assemble Group C: up to 3 Word-List-only paraphrases (strictly 0 out-words first + existing 5-tier rescue)
  const inParaMap = new Map<string, VerifiedParaphraseCandidate>();
  const addInPara = (c: VerifiedParaphraseCandidate) => {
    if (inParaMap.size >= 3) return;
    const key = normalizeSentenceCompareKey(c.rewrittenText);
    if (!key || inParaMap.has(key)) return;
    inParaMap.set(key, c);
  };

  // Tier C1: Strictly in-list (outWordCount === 0) paraphrases across both pools
  for (const c of [...inParaAudited, ...freeParaAudited]) {
    if (c.outWordCount === 0) {
      addInPara(c);
    }
  }

  // Tier C2: Fill remaining slots up to 3 from inParaAudited sorted by fewest out-of-list words
  if (inParaMap.size < 3 && inParaAudited.length > 0) {
    const sortedBest = [...inParaAudited].sort(
      (a, b) =>
        a.outWordCount - b.outWordCount ||
        b.inTargetPercentage - a.inTargetPercentage,
    );
    for (const c of sortedBest) {
      addInPara(c);
    }
  }

  // Tier C3: Dedicated lightweight paraphrase rescue request only if Pass 2 did not already attempt it
  if (
    inParaMap.size === 0 &&
    !attemptedParaphraseRepair &&
    freeParaAudited.length === 0
  ) {
    try {
      const rescueRaw = await callOpenRouterJson<unknown>({
        config,
        temperature: 0.25,
        maxTokens: 1200,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful EFL writing assistant. Rewrite the given sentence into clear, simple English paraphrases. Output ONLY one raw RFC 8259 JSON object without markdown fences.',
          },
          {
            role: 'user',
            content: [
              `Original sentence: "${enclosing.sentenceWithPunct}"`,
              `Focus word/expression to clarify: "${targetText}"`,
              `Target learner vocabulary: ${levelDesc}`,
              '',
              'Rewrite the original sentence into 3 clear English sentences that preserve its meaning using simpler everyday wording.',
              'Each rewrittenText MUST be different from Original sentence.',
              'Return ONLY valid JSON:',
              '{ "inListParaphrases": [{ "styleLabelKo": "쉬운 문장 재구성", "rewrittenText": "Simple rewritten sentence.", "noteKo": "간단한 한국어 설명" }] }',
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
      // Fall through cleanly to local deterministic synthesis (Tier C4 / Tier C5)
    }
  }

  // Tier C4: Deterministic local synthesis substituting verified synonym replacements into the sentence
  if (inParaMap.size === 0) {
    const synPool = [
      ...inListSynonymCandidates,
      ...inSynPass.verified,
      ...freeSynonymCandidates,
    ];
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

  // Tier C5: Absolute guarantee floor (>= 1 paraphrase entry always present)
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
          '대체 어휘 후보가 비어 있어 원문 어휘 구성을 표시합니다. 다시 추천을 눌러 재시도해 보세요.',
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

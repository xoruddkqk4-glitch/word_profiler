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
    maxTokens: 850,
    signal,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert English morphologist and EFL lexicographer. Return ONLY valid JSON matching the requested schema.',
      },
      {
        role: 'user',
        content: [
          `Target word: "${tok.token}"`,
          `Sentence context: "${enclosing.sentenceWithPunct}"`,
          '',
          'Analyze the morphological structure of the target word in this sentence and list standalone English dictionary words that serve as its inflectional base (lemma), derivational base(s), free root word(s), compound parts (if compound), and core word-family headword.',
          'Do NOT output bound Latin/Greek stems that are not real standalone English words (e.g., output "precede" and "precedent", NOT "-ced-").',
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

interface RawSynonymItem {
  replacementText?: string;
  baseForm?: string;
  meaningKo?: string;
  nuanceKo?: string;
}

interface RawParaphraseItem {
  styleLabelKo?: string;
  rewrittenText?: string;
  noteKo?: string;
}

interface RawCombinedLlmResponse {
  synonyms?: RawSynonymItem[];
  paraphrases?: RawParaphraseItem[];
}

const MAX_REPLACEMENT_TOKENS = 6;

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
    const rawRep =
      typeof item?.replacementText === 'string'
        ? item.replacementText.trim()
        : '';
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
    let highestLevel: number | null = null;
    let primaryListId: string | null = null;
    let primaryListName = '';
    let primaryLevelIndex = -1;

    for (const p of pieces) {
      const st = verifySingleWord(p.token, verifierCtx, targetMaxLevel);
      if (!st.withinTargetCap) allWithinCap = false;
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
        typeof item.baseForm === 'string' && item.baseForm.trim()
          ? item.baseForm.trim()
          : casedRep.toLowerCase(),
      meaningKo:
        typeof item.meaningKo === 'string' ? item.meaningKo.trim() : '',
      nuanceKo: typeof item.nuanceKo === 'string' ? item.nuanceKo.trim() : '',
      isMultiWord: pieces.length > 1,
      allTokensWithinCap: allWithinCap,
      allTokensInActiveLists: allInActive,
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
  const obj = raw as Record<string, unknown>;
  const synonyms = obj.synonyms;
  const paraphrases = obj.paraphrases;
  if (synonyms !== undefined && !Array.isArray(synonyms)) {
    throw new Error('AI 추천 단어 응답 형식이 올바르지 않습니다.');
  }
  if (paraphrases !== undefined && !Array.isArray(paraphrases)) {
    throw new Error('AI 패러프레이즈 응답 형식이 올바르지 않습니다.');
  }
  return {
    synonyms: (synonyms as RawSynonymItem[] | undefined) ?? [],
    paraphrases: (paraphrases as RawParaphraseItem[] | undefined) ?? [],
  };
}

/**
 * One request (plus at most one repair request) that returns up to three
 * in-list replacement words and three fully in-list sentence paraphrases
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
      const text =
        typeof item?.rewrittenText === 'string'
          ? item.rewrittenText.trim()
          : '';
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const audit = auditParaphraseCandidateText(
        text,
        verifierCtx,
        targetMaxLevel,
        guidance.properNounsCarryover,
      );
      out.push({
        styleLabelKo:
          typeof item.styleLabelKo === 'string' && item.styleLabelKo.trim()
            ? item.styleLabelKo.trim()
            : '패러프레이즈 대안',
        rewrittenText: text,
        noteKo: typeof item.noteKo === 'string' ? item.noteKo.trim() : '',
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
    ? `Target expression to replace: "${targetText}"`
    : `Target word to replace: "${targetText}"`;

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
            'You are an EFL controlled-vocabulary editor. Suggest ONLY high-frequency basic English that fits the learner wordlists. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: [
            targetLine,
            `Sentence context: "${enclosing.sentenceWithPunct}"`,
            `Allowed vocabulary (every word must come from these lists): ${levelDesc}`,
            guidance.wordsToReplace.length > 0
              ? `Out-of-list words in the sentence that must be replaced: [${guidance.wordsToReplace.join(', ')}]`
              : '',
            guidance.allowedWordsInSpan.length > 0
              ? `In-list words already in the sentence (safe to reuse): [${guidance.allowedWordsInSpan.join(', ')}]`
              : '',
            '',
            'Return JSON with exact keys:',
            '{',
            '  "synonyms": [',
            '    { "replacementText": "drop-in replacement inflected for this exact slot", "baseForm": "lemma", "meaningKo": "...", "nuanceKo": "..." }',
            '  ],',
            '  "paraphrases": [',
            '    { "styleLabelKo": "자연스러운 표준 표현", "rewrittenText": "full rewritten sentence", "noteKo": "..." },',
            '    { "styleLabelKo": "쉬운 기초어휘 풀이", "rewrittenText": "...", "noteKo": "..." },',
            '    { "styleLabelKo": "원문 구조 유지 최소 수정", "rewrittenText": "...", "noteKo": "..." }',
            '  ]',
            '}',
            '',
            `Provide 8 replacement candidates for the target ${isMultiWord ? 'expression (1-4 words each)' : 'word (single words preferred, short phrases allowed)'} and 5 full-sentence paraphrases of the sentence context.`,
            'Every word in both replacements and paraphrases MUST stay inside the allowed vocabulary.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    }),
  );

  const synonymPass = evaluateSynonyms(firstRaw.synonyms ?? []);
  let paraphraseAll = auditParaphrases(firstRaw.paraphrases ?? []);
  let repaired = false;

  const inListSynonymCount = synonymPass.verified.filter(
    (c) => c.allTokensWithinCap,
  ).length;
  const inListParaphraseCount = paraphraseAll.filter(
    (c) => c.outWordCount === 0,
  ).length;

  const needSynonymRepair = inListSynonymCount < 3;
  const needParaphraseRepair =
    verifierCtx.activeListCount > 0 && inListParaphraseCount < 3;

  if (needSynonymRepair || needParaphraseRepair) {
    repaired = true;
    const rejectedSyn = synonymPass.rejectedForms.slice(0, 12).join(', ');
    const rejectedPara = Array.from(
      new Set(paraphraseAll.flatMap((c) => c.remainingOutWords)),
    )
      .slice(0, 16)
      .join(', ');

    const repairRaw = parseCombinedResponse(
      await callOpenRouterJson<unknown>({
        config,
        temperature: 0.15,
        maxTokens: 1200,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict lexical-control editor. Use ONLY ultra-basic core English (top 1,000 words). Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: [
              targetLine,
              `Sentence: "${enclosing.sentenceWithPunct}"`,
              `Allowed vocabulary: ${levelDesc}`,
              needSynonymRepair && rejectedSyn
                ? `Rejected replacements (NOT in the lists — do not reuse): ${rejectedSyn}`
                : '',
              needParaphraseRepair && rejectedPara
                ? `Out-of-list words that MUST NOT appear: ${rejectedPara}`
                : '',
              '',
              'Return JSON:',
              '{',
              needSynonymRepair
                ? '  "synonyms": [{ "replacementText", "baseForm", "meaningKo", "nuanceKo" }],'
                : '  "synonyms": [],',
              needParaphraseRepair
                ? '  "paraphrases": [{ "styleLabelKo", "rewrittenText", "noteKo" }]'
                : '  "paraphrases": []',
              '}',
              needSynonymRepair
                ? 'Provide 8 much simpler in-list replacements.'
                : '',
              needParaphraseRepair
                ? 'Provide 5 full-sentence paraphrases using only allowed vocabulary.'
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }),
    );

    if (needSynonymRepair) {
      const pass2 = evaluateSynonyms(repairRaw.synonyms ?? []);
      const existing = new Set(
        synonymPass.verified.map((m) => m.replacementText.toLowerCase()),
      );
      for (const c of pass2.verified) {
        const k = c.replacementText.toLowerCase();
        if (!existing.has(k)) {
          synonymPass.verified.push(c);
          existing.add(k);
        }
      }
    }

    if (needParaphraseRepair) {
      paraphraseAll = [
        ...auditParaphrases(repairRaw.paraphrases ?? []),
        ...paraphraseAll,
      ];
    }
  }

  const synonymCandidates = synonymPass.verified
    .filter((c) => c.allTokensWithinCap)
    .sort((a, b) => {
      const lvlA = a.highestLevelNumber ?? 999;
      const lvlB = b.highestLevelNumber ?? 999;
      if (lvlA !== lvlB) return lvlA - lvlB;
      if (a.isMultiWord !== b.isMultiWord) return a.isMultiWord ? 1 : -1;
      return 0;
    })
    .slice(0, 3);

  const uniquePara = new Map<string, VerifiedParaphraseCandidate>();
  for (const c of paraphraseAll) {
    if (c.outWordCount !== 0) continue;
    const k = c.rewrittenText.toLowerCase();
    if (!uniquePara.has(k)) uniquePara.set(k, c);
  }
  const paraphraseCandidates = Array.from(uniquePara.values()).slice(0, 3);

  return {
    targetText,
    spanStartIdx,
    spanEndIdx,
    enclosingSentence: enclosing.sentenceWithPunct,
    targetMaxLevel,
    sourceOriginalText: profile.originalText,
    sourceId: profile.sourceId,
    synonymCandidates,
    paraphraseCandidates,
    paraphraseSpanStartIdx: enclosing.startTokenIdx,
    paraphraseSpanEndIdx: enclosing.endTokenIdx,
    repaired,
  };
}

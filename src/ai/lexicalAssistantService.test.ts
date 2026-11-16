import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENROUTER_MODEL, type OpenRouterConfig } from '../types/ai';
import type { DocumentProfileResult, ProfileToken } from '../types/domain';
import { suggestReplacementsAndParaphrases } from './lexicalAssistantService';
import { getVerifierContext } from './lexiconVerifier';
import * as openRouterClient from './openRouterClient';

vi.mock('./openRouterClient', () => ({
  callOpenRouterJson: vi.fn(),
}));

const mockedCallOpenRouterJson = vi.mocked(openRouterClient.callOpenRouterJson);

function buildToken(
  token: string,
  trailingWs: string,
  index: number,
  kind: 'level' | 'out' = 'level',
): ProfileToken {
  const lookupKey = token.toLowerCase();
  return {
    index: index + 1,
    token,
    trailingWs,
    lookupKey,
    kind,
    activeLevelIndex: kind === 'level' ? 0 : -1,
    statLevelNumber: kind === 'level' ? 1 : 2,
    headword: lookupKey,
    pos: '',
    listId: kind === 'level' ? 'r1' : null,
    listName: kind === 'level' ? 'Basic' : 'out_of_list',
  };
}

function buildTestProfile(tokens: ProfileToken[]): DocumentProfileResult {
  const originalText = tokens
    .map((t, idx) => t.token + (idx < tokens.length - 1 ? t.trailingWs : ''))
    .join('');
  return {
    sourceId: 'doc-1',
    sourceName: 'test.txt',
    originalText,
    leadingWs: '',
    tokens,
    totalTokens: tokens.length,
    totalTypes: tokens.length,
    totalCoveredPercentage: 75,
    levelSummaries: {},
    ignoredSummary: {
      key: '__ignored__',
      kind: 'ignored',
      listName: 'ignored',
      activeLevelIndex: -1,
      tokenCount: 0,
      typeCount: 0,
      headwordCount: 0,
      percentage: 0,
      words: [],
    },
    outSummary: {
      key: '__out__',
      kind: 'out',
      listName: 'out',
      activeLevelIndex: -1,
      tokenCount: 1,
      typeCount: 1,
      headwordCount: 1,
      percentage: 25,
      words: [],
    },
    tokenFreqByKey: {},
    elapsedMs: 1,
  };
}

function buildTestVerifierCtx(words: string[]) {
  return getVerifierContext({
    referenceLists: [
      {
        id: 'r1',
        name: 'Basic',
        path: 'basic.txt',
        content: words.join('\n'),
        enabled: true,
        colorLight: '#000',
        colorDark: '#fff',
        isBuiltin: false,
      },
    ],
    ignoreList: { enabled: false, name: 'ignore', content: '', path: '' },
    extraIgnoreWords: [],
    masterList: { enabled: false, name: 'master', content: '', path: '' },
    ignoreEnabled: false,
    settings: {
      tokenDefinition: "[\\p{L}\\p{N}']+",
      ignoreCase: true,
      showLevels: true,
      defaultTab: 'profiler',
      nationFormat: 'auto',
      stripCurriculumAnnotations: true,
      fontSizePx: 16,
      showFullPathsInStats: false,
    },
  });
}

const TEST_CONFIG: OpenRouterConfig = {
  apiKey: 'sk-or-v1-test',
  storageMode: 'session',
  modelId: DEFAULT_OPENROUTER_MODEL,
};

beforeEach(() => {
  mockedCallOpenRouterJson.mockReset();
});

describe('suggestReplacementsAndParaphrases paraphrase guarantee', () => {
  it('returns best-audited paraphrases sorted by fewest out-of-list words without falsifying in-list counts', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'clear',
      'test',
      'plan',
      'worked',
      'good',
      'well',
      'is',
      'it',
    ]);

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      synonyms: [
        {
          replacementText: 'simple',
          baseForm: 'simple',
          meaningKo: '쉬운',
          nuanceKo: '간단한',
        },
        {
          replacementText: 'clear',
          baseForm: 'clear',
          meaningKo: '분명한',
          nuanceKo: '명확한',
        },
        {
          replacementText: 'good',
          baseForm: 'good',
          meaningKo: '좋은',
          nuanceKo: '무난한',
        },
      ],
      paraphrases: [
        {
          styleLabelKo: '어휘 2개 초과',
          rewrittenText: 'The arcane methodology worked well.',
          noteKo: '참고1',
        },
        {
          styleLabelKo: '최소 리스트 외 단어',
          rewrittenText: 'The clear quiz worked well.',
          noteKo: '참고2',
        },
      ],
    });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);
    expect(res.paraphraseCandidates.length).toBeGreaterThanOrEqual(1);
    expect(res.paraphraseCandidates[0].rewrittenText).toBe(
      'The clear quiz worked well.',
    );
    expect(res.paraphraseCandidates[0].outWordCount).toBe(1);
    expect(res.paraphraseCandidates[0].remainingOutWords).toEqual(['quiz']);
    expect(res.paraphraseCandidates[0].inTargetPercentage).toBeLessThan(100);
    if (res.paraphraseCandidates.length > 1) {
      expect(res.paraphraseCandidates[1].outWordCount).toBeGreaterThanOrEqual(
        res.paraphraseCandidates[0].outWordCount,
      );
    }
  });

  it('synthesizes a paraphrase from verified synonyms in 2 calls without extra rescue latency', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'test',
      'worked',
    ]);

    mockedCallOpenRouterJson
      // Pass 1: synonym found, paraphrases empty
      .mockResolvedValueOnce({
        synonyms: [
          {
            replacementText: 'simple',
            baseForm: 'simple',
            meaningKo: '쉬운',
            nuanceKo: '기초',
          },
        ],
        paraphrases: [],
      })
      // Pass 2 (repair): still no paraphrases
      .mockResolvedValueOnce({
        synonyms: [],
        paraphrases: [],
      });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(2);
    expect(res.paraphraseCandidates.length).toBeGreaterThanOrEqual(1);
    expect(res.paraphraseCandidates[0].styleLabelKo).toBe('추천 어휘 적용 문장');
    expect(res.paraphraseCandidates[0].rewrittenText).toBe(
      'The simple test worked.',
    );
    expect(res.paraphraseCandidates[0].outWordCount).toBe(0);
  });

  it('accepts alternative paraphrase item keys such as sentence and text and filters identical source echoes', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'clear',
      'test',
      'worked',
    ]);

    mockedCallOpenRouterJson.mockResolvedValue({
      synonyms: [
        { replacement: 'simple', baseForm: 'simple' },
        { word: 'clear', baseForm: 'clear' },
        { replacementText: 'simple', baseForm: 'simple' },
      ],
      sentences: [
        // Exact echo of original sentence should be skipped
        { text: 'The esoteric test worked.' },
        { sentence: 'The simple test worked.', styleLabelKo: '쉬운 문장' },
        { text: 'The clear test worked.' },
      ],
    });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(res.paraphraseCandidates.length).toBe(2);
    expect(res.paraphraseCandidates.map((c) => c.rewrittenText)).toEqual([
      'The simple test worked.',
      'The clear test worked.',
    ]);
    expect(res.paraphraseCandidates.every((c) => c.outWordCount === 0)).toBe(
      true,
    );
  });

  it('guarantees at least one baseline entry even when all LLM responses are empty', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx(['the', 'test', 'worked']);

    mockedCallOpenRouterJson.mockResolvedValue({});

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(res.paraphraseCandidates).toHaveLength(1);
    expect(res.paraphraseCandidates[0].styleLabelKo).toBe('원문 기반 기준 문장');
    expect(res.paraphraseCandidates[0].rewrittenText).toBe(
      'The esoteric test worked.',
    );
    expect(res.paraphraseCandidates[0].outWordCount).toBe(1);
    expect(res.paraphraseCandidates[0].remainingOutWords).toEqual([
      'esoteric',
    ]);
  });
});

describe('suggestReplacementsAndParaphrases 4-group (3+3+3+3) dual-track classification', () => {
  it('returns 3 in-list words, 3 free words, 3 in-list paraphrases, and 3 free paraphrases in a single call without cross-group duplicates', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('plan', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'clear',
      'easy',
      'plain',
      'plan',
      'idea',
      'worked',
      'well',
      'good',
      'way',
      'helpful',
    ]);

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      inListSynonyms: [
        { replacementText: 'simple', baseForm: 'simple', meaningKo: '단순한' },
        { replacementText: 'clear', baseForm: 'clear', meaningKo: '분명한' },
        { replacementText: 'easy', baseForm: 'easy', meaningKo: '쉬운' },
        { replacementText: 'plain', baseForm: 'plain', meaningKo: '평이한' },
      ],
      freeSynonyms: [
        { replacementText: 'arcane', baseForm: 'arcane', meaningKo: '난해한' },
        { replacementText: 'obscure', baseForm: 'obscure', meaningKo: '모호한' },
        { replacementText: 'cryptic', baseForm: 'cryptic', meaningKo: '수수께끼같은' },
        // Duplicate with Group A should not appear in Group B
        { replacementText: 'simple', baseForm: 'simple', meaningKo: '단순한' },
      ],
      inListParaphrases: [
        {
          styleLabelKo: '쉬운 어휘',
          rewrittenText: 'The simple plan worked well.',
          noteKo: '설명1',
        },
        {
          styleLabelKo: '명확한 표현',
          rewrittenText: 'The clear plan worked well.',
          noteKo: '설명2',
        },
        {
          styleLabelKo: '기초 재구성',
          rewrittenText: 'The easy idea worked well.',
          noteKo: '설명3',
        },
      ],
      freeParaphrases: [
        {
          styleLabelKo: '자연스러운 확장',
          rewrittenText: 'The intricate strategy succeeded effortlessly.',
          noteKo: '확장1',
        },
        {
          styleLabelKo: '학술적 표현',
          rewrittenText: 'The specialized approach proved effective.',
          noteKo: '확장2',
        },
        {
          styleLabelKo: '정교한 문맥',
          rewrittenText: 'The complex method functioned smoothly.',
          noteKo: '확장3',
        },
      ],
    });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);

    expect(res.inListSynonymCandidates.map((c) => c.replacementText)).toEqual([
      'simple',
      'clear',
      'easy',
    ]);
    expect(
      res.inListSynonymCandidates.every((c) => c.allTokensWithinCap),
    ).toBe(true);

    expect(res.freeSynonymCandidates.map((c) => c.replacementText)).toEqual([
      'arcane',
      'obscure',
      'cryptic',
    ]);
    expect(
      res.freeSynonymCandidates.every((c) => !c.allTokensWithinCap),
    ).toBe(true);

    expect(res.inListParaphraseCandidates).toHaveLength(3);
    expect(
      res.inListParaphraseCandidates.every((c) => c.outWordCount === 0),
    ).toBe(true);

    expect(res.freeParaphraseCandidates).toHaveLength(3);
    expect(
      res.freeParaphraseCandidates.every((c) => c.outWordCount >= 1),
    ).toBe(true);

    const inKeys = new Set(
      res.inListParaphraseCandidates.map((c) => c.rewrittenText.toLowerCase()),
    );
    for (const fc of res.freeParaphraseCandidates) {
      expect(inKeys.has(fc.rewrittenText.toLowerCase())).toBe(false);
    }

    // Backward-compatible aliases mirror in-list candidates
    expect(res.synonymCandidates).toEqual(res.inListSynonymCandidates);
    expect(res.paraphraseCandidates).toEqual(res.inListParaphraseCandidates);
  });

  it('re-routes out-of-list words leaked into inListSynonyms out of Group A and into Group B via lexiconVerifier', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'clear',
      'easy',
      'test',
      'worked',
    ]);

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      inListSynonyms: [
        // LLM mistakenly includes an out-of-list candidate here
        { replacementText: 'cryptic', baseForm: 'cryptic', meaningKo: '모호한' },
        { replacementText: 'simple', baseForm: 'simple', meaningKo: '단순한' },
        { replacementText: 'clear', baseForm: 'clear', meaningKo: '명확한' },
        { replacementText: 'easy', baseForm: 'easy', meaningKo: '쉬운' },
      ],
      freeSynonyms: [
        { replacementText: 'arcane', baseForm: 'arcane', meaningKo: '난해한' },
        { replacementText: 'abstruse', baseForm: 'abstruse', meaningKo: '심오한' },
      ],
      inListParaphrases: [
        { rewrittenText: 'The simple test worked.' },
      ],
      freeParaphrases: [
        { rewrittenText: 'The cryptic experiment succeeded.' },
      ],
    });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);
    expect(res.inListSynonymCandidates.map((c) => c.replacementText)).toEqual([
      'simple',
      'clear',
      'easy',
    ]);
    expect(
      res.freeSynonymCandidates.map((c) => c.replacementText),
    ).toContain('cryptic');
    const crypticItem = res.freeSynonymCandidates.find(
      (c) => c.replacementText === 'cryptic',
    );
    expect(crypticItem?.allTokensWithinCap).toBe(false);
    expect(crypticItem?.outTokens).toEqual(['cryptic']);
  });

  it('synthesizes freeParaphraseCandidates from freeSynonymCandidates when freeParaphrases is omitted', async () => {
    const profile = buildTestProfile([
      buildToken('The', ' ', 0),
      buildToken('esoteric', ' ', 1, 'out'),
      buildToken('test', ' ', 2),
      buildToken('worked', '.', 3),
    ]);
    const verifierCtx = buildTestVerifierCtx([
      'the',
      'simple',
      'test',
      'worked',
    ]);

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      inListSynonyms: [{ replacementText: 'simple', baseForm: 'simple' }],
      freeSynonyms: [
        { replacementText: 'arcane', baseForm: 'arcane' },
        { replacementText: 'cryptic', baseForm: 'cryptic' },
        { replacementText: 'obscure', baseForm: 'obscure' },
      ],
      inListParaphrases: [{ rewrittenText: 'The simple test worked.' }],
      freeParaphrases: [],
    });

    const res = await suggestReplacementsAndParaphrases({
      profile,
      spanStartIdx: 1,
      spanEndIdx: 1,
      targetMaxLevel: 1,
      verifierCtx,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);
    expect(res.freeParaphraseCandidates).toHaveLength(3);
    expect(res.freeParaphraseCandidates.map((c) => c.rewrittenText)).toEqual([
      'The arcane test worked.',
      'The cryptic test worked.',
      'The obscure test worked.',
    ]);
  });
});

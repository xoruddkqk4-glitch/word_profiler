import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_MODEL, type OpenRouterConfig } from '../types/ai';
import * as openRouterClient from './openRouterClient';
import {
  DEFAULT_TRANSLATION_PROMPT,
  hydrateSavedPassageTranslation,
  loadSavedTranslationPrompt,
  resetTranslationPromptToDefault,
  saveTranslationPrompt,
  translateEnglishPassage,
} from './passageTranslationService';

vi.mock('./openRouterClient', () => ({
  callOpenRouterJson: vi.fn(),
}));

const mockedCallOpenRouterJson = vi.mocked(openRouterClient.callOpenRouterJson);

const TEST_CONFIG: OpenRouterConfig = {
  provider: 'gemini',
  apiKey: '',
  storageMode: 'session',
  modelId: 'google/gemini-3.8-flash',
  geminiApiKey: 'AIzaTestKey',
  geminiModelId: DEFAULT_GEMINI_MODEL,
};

function installMockWindowStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
  vi.stubGlobal('window', { localStorage: storage });
  return store;
}

describe('passageTranslationService', () => {
  beforeEach(() => {
    mockedCallOpenRouterJson.mockReset();
    installMockWindowStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the user custom translation prompt, builds 1:1 pairs (including 2-sentence Korean splits), and persists alignment cache', async () => {
    const english =
      'Language learning depends heavily on vocabulary knowledge.\n\nThe philosopher Nelson Godman argued that we should replace the question “What is art?” with the question “When is art?”';
    const customPrompt = `${DEFAULT_TRANSLATION_PROMPT}\n- 추가 사용자 지침: 직역의 어순을 최대한 살린다.`;

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      translations: [
        {
          id: 1,
          ko: '언어 학습은 어휘 지식에 크게 의존한다. 이는 핵심 원칙이다.',
        },
        {
          id: 2,
          ko: '철학자 Nelson Goodman은 ‘‘무엇’이 예술인가?’라는 질문을 ‘‘언제’가 예술인가?’라는 질문으로 대체해야 한다고 주장했다.',
        },
      ],
    });

    const result = await translateEnglishPassage({
      englishText: english,
      customPrompt,
      config: TEST_CONFIG,
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);
    const callArgs = mockedCallOpenRouterJson.mock.calls[0][0];
    expect(callArgs.attemptTimeoutMs).toBe(20_000);
    expect(callArgs.messages[1].content).toContain(
      '추가 사용자 지침: 직역의 어순을 최대한 살린다.',
    );

    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0]).toEqual({
      index: 0,
      paragraphIndex: 0,
      en: 'Language learning depends heavily on vocabulary knowledge.',
      ko: '언어 학습은 어휘 지식에 크게 의존한다. 이는 핵심 원칙이다.',
    });
    expect(result.pairs[1]).toEqual({
      index: 1,
      paragraphIndex: 1,
      en: 'The philosopher Nelson Godman argued that we should replace the question “What is art?” with the question “When is art?”',
      ko: '철학자 Nelson Goodman은 ‘‘무엇’이 예술인가?’라는 질문을 ‘‘언제’가 예술인가?’라는 질문으로 대체해야 한다고 주장했다.',
    });
    expect(result.koreanFullText).toBe(
      '언어 학습은 어휘 지식에 크게 의존한다. 이는 핵심 원칙이다.\n\n철학자 Nelson Goodman은 ‘‘무엇’이 예술인가?’라는 질문을 ‘‘언제’가 예술인가?’라는 질문으로 대체해야 한다고 주장했다.',
    );

    // Re-hydrating the exported English + Korean text restores the exact 1:1 pair mapping via alignment cache
    // even though sentence 1 contains 2 Korean sentences
    const hydrated = hydrateSavedPassageTranslation(
      english,
      result.koreanFullText,
      '파일에서 불러옴',
    );
    expect(hydrated.pairs).toEqual(result.pairs);
    expect(hydrated.modelLabel).toBe('파일에서 불러옴');
  });

  it('persists custom prompt edits and resets cleanly to DEFAULT_TRANSLATION_PROMPT', () => {
    expect(loadSavedTranslationPrompt()).toBe(DEFAULT_TRANSLATION_PROMPT);

    saveTranslationPrompt('사용자 정의 해석 프롬프트');
    expect(loadSavedTranslationPrompt()).toBe('사용자 정의 해석 프롬프트');

    expect(resetTranslationPromptToDefault()).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(loadSavedTranslationPrompt()).toBe(DEFAULT_TRANSLATION_PROMPT);
  });

  it('splits 7-sentence passages into 3 parallel batches, streams onPartialUpdate, parses compact { t }, and caches across calls unless bypassCache is true', async () => {
    const sevenSentences = [
      'Sentence one opens the topic.',
      'Sentence two gives background.',
      'Sentence three introduces evidence.',
      'Sentence four analyzes causes.',
      'Sentence five contrasts views.',
      'Sentence six presents an example.',
      'Sentence seven concludes the argument.',
    ].join(' ');

    mockedCallOpenRouterJson
      .mockResolvedValueOnce({
        t: ['첫째 문장.', '둘째 문장.', '셋째 문장.'],
      })
      .mockResolvedValueOnce({
        t: ['넷째 문장.', '다섯째 문장.', '여섯째 문장.'],
      })
      .mockResolvedValueOnce({
        t: ['일곱째 문장.'],
      });

    const partials: { done: number; total: number; nonEmpty: number }[] = [];
    const first = await translateEnglishPassage({
      englishText: sevenSentences,
      customPrompt: DEFAULT_TRANSLATION_PROMPT,
      config: TEST_CONFIG,
      onPartialUpdate: (partial, done, total) => {
        partials.push({
          done,
          total,
          nonEmpty: partial.pairs.filter((p) => p.ko.trim().length > 0).length,
        });
      },
    });

    // 7 sentences -> 3 parallel batches (3 + 3 + 1), emitting 2 partial snapshots before completion
    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(3);
    expect(partials.length).toBeGreaterThanOrEqual(2);
    expect(partials[0].total).toBe(7);
    expect(partials[0].nonEmpty).toBeLessThan(7);
    expect(first.pairs.map((p) => p.ko)).toEqual([
      '첫째 문장.',
      '둘째 문장.',
      '셋째 문장.',
      '넷째 문장.',
      '다섯째 문장.',
      '여섯째 문장.',
      '일곱째 문장.',
    ]);

    // Second call with identical English & prompt resolves from cache with 0 API calls
    const cached = await translateEnglishPassage({
      englishText: sevenSentences,
      customPrompt: DEFAULT_TRANSLATION_PROMPT,
      config: TEST_CONFIG,
    });
    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(3);
    expect(cached.pairs.map((p) => p.ko)).toEqual(
      first.pairs.map((p) => p.ko),
    );

    // bypassCache: true forces fresh API calls
    mockedCallOpenRouterJson
      .mockResolvedValueOnce({ t: ['1번.', '2번.', '3번.'] })
      .mockResolvedValueOnce({ t: ['4번.', '5번.', '6번.'] })
      .mockResolvedValueOnce({ t: ['7번.'] });

    const refreshed = await translateEnglishPassage({
      englishText: sevenSentences,
      customPrompt: DEFAULT_TRANSLATION_PROMPT,
      config: TEST_CONFIG,
      bypassCache: true,
    });
    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(6);
    expect(refreshed.pairs[0].ko).toBe('1번.');
  });

  it('misses translation result cache when provider or model changes', async () => {
    const english = 'Caching depends on the active model identity.';

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      t: ['캐시는 활성 모델 식별자에 의존한다.'],
    });

    await translateEnglishPassage({
      englishText: english,
      customPrompt: DEFAULT_TRANSLATION_PROMPT,
      config: TEST_CONFIG,
    });
    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(1);

    mockedCallOpenRouterJson.mockResolvedValueOnce({
      t: ['다른 모델로 다시 해석한 결과이다.'],
    });

    const otherModel = await translateEnglishPassage({
      englishText: english,
      customPrompt: DEFAULT_TRANSLATION_PROMPT,
      config: {
        ...TEST_CONFIG,
        geminiModelId: 'gemini-2.5-flash',
      },
    });

    expect(mockedCallOpenRouterJson).toHaveBeenCalledTimes(2);
    expect(otherModel.pairs[0].ko).toBe('다른 모델로 다시 해석한 결과이다.');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  type OpenRouterConfig,
} from '../types/ai';
import {
  callOpenRouterJson,
  clearGeminiApiKey,
  extractJsonObjectFromText,
  loadOpenRouterConfig,
  resetOpenRouterCompatibilityCache,
  resolveStoredOpenRouterModelId,
  saveOpenRouterConfig,
  testOpenRouterConnection,
} from './openRouterClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOpenRouterCompatibilityCache();
});

describe('resolveStoredOpenRouterModelId', () => {
  it('keeps still-valid older presets', () => {
    expect(resolveStoredOpenRouterModelId('google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
    expect(resolveStoredOpenRouterModelId('openai/gpt-4o-mini')).toBe(
      'openai/gpt-4o-mini',
    );
  });

  it('migrates retired slugs to the current default', () => {
    expect(resolveStoredOpenRouterModelId('anthropic/claude-3.5-haiku')).toBe(
      DEFAULT_OPENROUTER_MODEL,
    );
  });

  it('falls back for empty values', () => {
    expect(resolveStoredOpenRouterModelId('')).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveStoredOpenRouterModelId(null)).toBe(DEFAULT_OPENROUTER_MODEL);
  });
});

describe('extractJsonObjectFromText', () => {
  it('strips <think> reasoning blocks (even with braces) and fenced json', () => {
    const raw = [
      '<think>I should return {not valid: json} carefully.</think>',
      'Here is your JSON:',
      '```json',
      '{"synonyms":[{"replacementText":"easy"}],"paraphrases":[]}',
      '```',
    ].join('\n');

    expect(extractJsonObjectFromText(raw)).toEqual({
      synonyms: [{ replacementText: 'easy' }],
      paraphrases: [],
    });
  });

  it('repairs trailing commas and literal newlines inside string literals', () => {
    const raw = `{
      "synonyms": [
        { "replacementText": "clear", "nuanceKo": "첫 줄
둘째 줄", },
      ],
    }`;

    expect(extractJsonObjectFromText(raw)).toEqual({
      synonyms: [{ replacementText: 'clear', nuanceKo: '첫 줄\n둘째 줄' }],
    });
  });

  it('salvages truncated JSON responses with unclosed fences and partial trailing items', () => {
    const truncated = [
      '```json',
      '{',
      '  "synonyms": [',
      '    { "replacementText": "simple", "baseForm": "simple" },',
      '    { "replacementText": "plain", "baseForm": "plain" }',
      '  ],',
      '  "paraphrases": [',
      '    { "styleLabelKo": "쉬운 표현", "rewrittenText": "It is hard to know." },',
      '    { "styleLabelKo": "잘린 항목", "rewrittenText": "Incomplete',
    ].join('\n');

    expect(extractJsonObjectFromText(truncated)).toEqual({
      synonyms: [
        { replacementText: 'simple', baseForm: 'simple' },
        { replacementText: 'plain', baseForm: 'plain' },
      ],
      paraphrases: [
        { styleLabelKo: '쉬운 표현', rewrittenText: 'It is hard to know.' },
      ],
    });
  });
});

describe('callOpenRouterJson', () => {
  const testConfig: OpenRouterConfig = {
    apiKey: 'sk-or-v1-test',
    storageMode: 'session',
    modelId: DEFAULT_OPENROUTER_MODEL,
  };

  it('retries once when first response is malformed/non-JSON and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: { content: '<think>reasoning truncated before json' },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: '{"synonyms":[{"replacementText":"easy"}],"paraphrases":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await callOpenRouterJson<{ synonyms: unknown[]; paraphrases: unknown[] }>({
      config: testConfig,
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.synonyms).toHaveLength(1);
  });

  it('falls back when provider rejects response_format or reasoning with HTTP 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: 'response_format json_object is not supported' },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '{"ok":true}' },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await callOpenRouterJson<{ ok: boolean }>({
      config: testConfig,
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.reasoning).toBeUndefined();
    expect(secondBody.provider).toBeUndefined();
    expect(res).toEqual({ ok: true });
  });

  it('remembers unsupported fast params per model to avoid repeating HTTP 400 round-trips', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: 'reasoning effort minimal not supported' },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{"b":2}' } }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const first = await callOpenRouterJson<{ a: number }>({
      config: testConfig,
      messages: [{ role: 'user', content: 'first' }],
    });
    const second = await callOpenRouterJson<{ b: number }>({
      config: testConfig,
      messages: [{ role: 'user', content: 'second' }],
    });

    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ b: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(thirdBody.response_format).toBeUndefined();
    expect(thirdBody.reasoning).toBeUndefined();
    expect(thirdBody.provider).toBeUndefined();
  });
});

describe('Google Gemini direct API integration', () => {
  const geminiConfig: OpenRouterConfig = {
    provider: 'gemini',
    apiKey: '',
    geminiApiKey: 'AIzaSyTestKey12345',
    storageMode: 'session',
    modelId: DEFAULT_OPENROUTER_MODEL,
    geminiModelId: DEFAULT_GEMINI_MODEL,
  };

  it('calls Google Gemini generateContent endpoint with x-goog-api-key, systemInstruction, and ignores thought parts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: 'internal reasoning...', thought: true },
                  { text: '{"synonyms":[{"replacementText":"clear"}],"paraphrases":[]}' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await callOpenRouterJson<{
      synonyms: { replacementText: string }[];
      paraphrases: unknown[];
    }>({
      config: geminiConfig,
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: 'Simplify word.' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0];
    expect(String(reqUrl)).toContain(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    expect((reqInit?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'AIzaSyTestKey12345',
    );
    const body = JSON.parse(String(reqInit?.body));
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'Return JSON only.' }],
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Simplify word.' }] },
    ]);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'LOW',
    });
    expect(res.synonyms[0].replacementText).toBe('clear');
  });

  it('uses thinkingBudget: 0 for Gemini 2.5 models', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: '{"ok":true}' }] },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await callOpenRouterJson<{ ok: boolean }>({
      config: { ...geminiConfig, geminiModelId: 'gemini-2.5-flash' },
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(res).toEqual({ ok: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('falls back when Gemini model rejects thinkingConfig with HTTP 400 and caches compatibility', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                'thinking_budget is not supported for this model.',
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"step":1}' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"step":2}' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const cfg: OpenRouterConfig = {
      ...geminiConfig,
      geminiModelId: 'gemini-custom-test',
    };

    expect(
      await callOpenRouterJson<{ step: number }>({
        config: cfg,
        messages: [{ role: 'user', content: 'first' }],
      }),
    ).toEqual({ step: 1 });
    expect(
      await callOpenRouterJson<{ step: number }>({
        config: cfg,
        messages: [{ role: 'user', content: 'second' }],
      }),
    ).toEqual({ step: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(secondBody.generationConfig.thinkingConfig).toBeUndefined();
    expect(secondBody.generationConfig.responseMimeType).toBe('application/json');
    expect(thirdBody.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('surfaces friendly Korean error on invalid Gemini API key without retrying compatibility fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenRouterJson({
        config: geminiConfig,
        messages: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow(/Google Gemini API 키가 유효하지 않습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists and loads both Gemini and OpenRouter keys independently via saveOpenRouterConfig / loadOpenRouterConfig', () => {
    const createMemoryStorage = (): Storage => {
      const store = new Map<string, string>();
      return {
        get length() {
          return store.size;
        },
        clear() {
          store.clear();
        },
        getItem(k: string) {
          return store.get(k) ?? null;
        },
        key(idx: number) {
          return Array.from(store.keys())[idx] ?? null;
        },
        removeItem(k: string) {
          store.delete(k);
        },
        setItem(k: string, v: string) {
          store.set(k, v);
        },
      };
    };

    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });

    const saved = saveOpenRouterConfig({
      provider: 'gemini',
      apiKey: 'sk-or-v1-secret',
      geminiApiKey: 'AIzaSy-gemini-secret',
      storageMode: 'session',
      modelId: 'openai/gpt-4o-mini',
      geminiModelId: 'google/gemini-3.5-flash-lite',
    });

    expect(saved.provider).toBe('gemini');
    expect(saved.geminiModelId).toBe('gemini-3.5-flash-lite');

    const loaded = loadOpenRouterConfig();
    expect(loaded).toEqual({
      provider: 'gemini',
      apiKey: 'sk-or-v1-secret',
      geminiApiKey: 'AIzaSy-gemini-secret',
      storageMode: 'session',
      modelId: 'openai/gpt-4o-mini',
      geminiModelId: 'gemini-3.5-flash-lite',
    });

    const clearedGemini = clearGeminiApiKey(loaded);
    expect(clearedGemini.geminiApiKey).toBe('');
    expect(clearedGemini.apiKey).toBe('sk-or-v1-secret');
    expect(loadOpenRouterConfig().apiKey).toBe('sk-or-v1-secret');
    expect(loadOpenRouterConfig().geminiApiKey).toBe('');
  });

  it('immediately fails over to gemini-3.5-flash-lite on Gemini HTTP 503 high demand without repeating congested primary model, and skips primary during cooldown', async () => {
    const highDemandResponse = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 503,
            message:
              'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
            status: 'UNAVAILABLE',
          },
        }),
        { status: 503 },
      );

    const fetchMock = vi
      .fn()
      // Primary call #1: HTTP 503 -> immediately failover with 0ms wait
      .mockResolvedValueOnce(highDemandResponse())
      // Failover to gemini-3.5-flash-lite: HTTP 200
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"firstCall":true}' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      // Subsequent call skips cooled-down gemini-3.8-flash and calls gemini-3.5-flash-lite directly
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"secondCall":true}' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const first = await callOpenRouterJson<{ firstCall: boolean }>({
      config: geminiConfig,
      messages: [{ role: 'user', content: 'first' }],
    });
    const second = await callOpenRouterJson<{ secondCall: boolean }>({
      config: geminiConfig,
      messages: [{ role: 'user', content: 'second' }],
    });

    expect(first).toEqual({ firstCall: true });
    expect(second).toEqual({ secondCall: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/gemini-3.5-flash-lite:generateContent',
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/gemini-3.5-flash-lite:generateContent',
    );
  });

  it('testOpenRouterConnection verifies Gemini API key and model instantaneously via GET /models/{model}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: `models/${DEFAULT_GEMINI_MODEL}` }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await testOpenRouterConnection(geminiConfig);
    expect(res.provider).toBe('gemini');
    expect(res.modelId).toBe(DEFAULT_GEMINI_MODEL);
    expect(res.fallbackFromModelId).toBeUndefined();
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0];
    expect(String(reqUrl)).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}`,
    );
    expect(reqInit?.method).toBe('GET');
    expect((reqInit?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'AIzaSyTestKey12345',
    );
  });

  it('testOpenRouterConnection fails over to backup Gemini model on HTTP 503 and reports fallbackFromModelId', async () => {
    const highDemandResponse = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand.',
          },
        }),
        { status: 503 },
      );

    const fetchMock = vi
      .fn()
      // GET metadata check hits 503 -> falls back to generateContent failover
      .mockResolvedValueOnce(highDemandResponse())
      // Primary generateContent hits 503 -> immediately fails over to gemini-3.5-flash-lite
      .mockResolvedValueOnce(highDemandResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: 'ok' }] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await testOpenRouterConnection(geminiConfig);
    expect(res.provider).toBe('gemini');
    expect(res.modelId).toBe('gemini-3.5-flash-lite');
    expect(res.fallbackFromModelId).toBe(DEFAULT_GEMINI_MODEL);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

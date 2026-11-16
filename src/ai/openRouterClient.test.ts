import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENROUTER_MODEL, type OpenRouterConfig } from '../types/ai';
import {
  callOpenRouterJson,
  extractJsonObjectFromText,
  resetOpenRouterCompatibilityCache,
  resolveStoredOpenRouterModelId,
} from './openRouterClient';

afterEach(() => {
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

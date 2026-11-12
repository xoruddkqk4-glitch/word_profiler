import {
  DEFAULT_OPENROUTER_MODEL,
  RETIRED_OPENROUTER_MODELS,
  type ApiKeyStorageMode,
  type OpenRouterConfig,
} from '../types/ai';

const META_STORAGE_KEY = 'antwordprofiler_openrouter_meta_v1';
const KEY_STORAGE_KEY = 'antwordprofiler_openrouter_key_v1';
const OPENROUTER_CHAT_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions';

interface StoredMeta {
  storageMode: ApiKeyStorageMode;
  modelId: string;
}

/** Keep still-valid stored models; only retire deleted OpenRouter slugs. */
export function resolveStoredOpenRouterModelId(
  stored: string | null | undefined,
): string {
  const trimmed = typeof stored === 'string' ? stored.trim() : '';
  if (!trimmed) return DEFAULT_OPENROUTER_MODEL;
  if (RETIRED_OPENROUTER_MODELS.includes(trimmed)) {
    return DEFAULT_OPENROUTER_MODEL;
  }
  return trimmed;
}

export function loadOpenRouterConfig(): OpenRouterConfig {
  if (typeof window === 'undefined') {
    return {
      apiKey: '',
      storageMode: 'session',
      modelId: DEFAULT_OPENROUTER_MODEL,
    };
  }

  let storageMode: ApiKeyStorageMode = 'session';
  let modelId = DEFAULT_OPENROUTER_MODEL;
  let persistedModelId: string | null = null;

  try {
    const rawMeta = window.localStorage.getItem(META_STORAGE_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta) as Partial<StoredMeta>;
      if (parsed.storageMode === 'local' || parsed.storageMode === 'session') {
        storageMode = parsed.storageMode;
      }
      if (typeof parsed.modelId === 'string' && parsed.modelId.trim()) {
        persistedModelId = parsed.modelId.trim();
        modelId = resolveStoredOpenRouterModelId(persistedModelId);
      }
    }
  } catch {
    // ignore storage read failure
  }

  // Persist retirement migration so UI and disk stay aligned.
  if (persistedModelId && persistedModelId !== modelId) {
    try {
      const meta: StoredMeta = { storageMode, modelId };
      window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
    } catch {
      // ignore quota errors
    }
  }

  let apiKey = '';
  try {
    apiKey =
      storageMode === 'local'
        ? window.localStorage.getItem(KEY_STORAGE_KEY) ?? ''
        : window.sessionStorage.getItem(KEY_STORAGE_KEY) ?? '';
  } catch {
    apiKey = '';
  }

  return {
    apiKey: apiKey.trim(),
    storageMode,
    modelId,
  };
}

export function saveOpenRouterConfig(config: OpenRouterConfig): OpenRouterConfig {
  const normalized: OpenRouterConfig = {
    apiKey: config.apiKey.trim(),
    storageMode: config.storageMode,
    modelId: config.modelId.trim() || DEFAULT_OPENROUTER_MODEL,
  };

  if (typeof window === 'undefined') return normalized;

  try {
    const meta: StoredMeta = {
      storageMode: normalized.storageMode,
      modelId: normalized.modelId,
    };
    window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // ignore quota errors
  }

  try {
    if (!normalized.apiKey) {
      window.sessionStorage.removeItem(KEY_STORAGE_KEY);
      window.localStorage.removeItem(KEY_STORAGE_KEY);
    } else if (normalized.storageMode === 'local') {
      window.localStorage.setItem(KEY_STORAGE_KEY, normalized.apiKey);
      window.sessionStorage.removeItem(KEY_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(KEY_STORAGE_KEY, normalized.apiKey);
      window.localStorage.removeItem(KEY_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction errors
  }

  return normalized;
}

export function clearOpenRouterApiKey(
  current: OpenRouterConfig,
): OpenRouterConfig {
  return saveOpenRouterConfig({ ...current, apiKey: '' });
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRawResponse {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
    code?: number | string;
  };
}

export function extractJsonObjectFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('AI 응답이 비어 있습니다.');
  }

  // Strip optional markdown ```json ... ``` wrapper
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: locate outermost `{ ... }`
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const slice = candidate.slice(firstBrace, lastBrace + 1);
      return JSON.parse(slice);
    }
    throw new Error('AI 응답을 JSON 형식으로 해석하지 못했습니다.');
  }
}

function formatOpenRouterError(status: number, detail: string): string {
  if (status === 401) {
    return 'OpenRouter API 키가 유효하지 않습니다. Settings > AI Assistant에서 키를 다시 확인해 주세요.';
  }
  if (status === 402) {
    return 'OpenRouter 계정 크레딧이 부족합니다. OpenRouter 대시보드에서 잔액을 확인하거나 무료 모델을 선택해 주세요.';
  }
  if (status === 404) {
    return `선택한 모델 ID를 OpenRouter에서 찾을 수 없습니다 (${detail || '404'}). 모델 이름을 확인해 주세요.`;
  }
  if (status === 429) {
    return 'OpenRouter 요청 한도(Rate Limit)에 도달했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.';
  }
  return detail
    ? `OpenRouter API 오류 (${status}): ${detail}`
    : `OpenRouter API 호출에 실패했습니다 (HTTP ${status}).`;
}

async function sendChatCompletionRequest(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  useJsonFormat: boolean;
  signal?: AbortSignal;
}): Promise<{ ok: true; content: string } | { ok: false; status: number; detail: string }> {
  const { config, messages, temperature = 0.2, maxTokens = 1100, useJsonFormat, signal } =
    params;

  const referer =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://antwordprofiler.local';

  const body: Record<string, unknown> = {
    model: config.modelId.trim() || DEFAULT_OPENROUTER_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (useJsonFormat) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(OPENROUTER_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'HTTP-Referer': referer,
      'X-Title': 'AntWordProfiler Web',
    },
    body: JSON.stringify(body),
    signal,
  });

  let payload: OpenRouterRawResponse | null = null;
  try {
    payload = (await res.json()) as OpenRouterRawResponse;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.error?.message ?? res.statusText ?? '';
    return { ok: false, status: res.status, detail };
  }

  if (payload?.error?.message) {
    return {
      ok: false,
      status: Number(payload.error.code) || 500,
      detail: payload.error.message,
    };
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  return { ok: true, content: text };
}

export async function callOpenRouterJson<T>(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<T> {
  if (!params.config.apiKey.trim()) {
    throw new Error('OpenRouter API 키가 설정되지 않았습니다.');
  }

  let attempt = await sendChatCompletionRequest({
    ...params,
    useJsonFormat: true,
  });

  // Fallback only when the provider rejects json_object response_format
  if (
    !attempt.ok &&
    attempt.status === 400 &&
    /response_format|json_object|json mode/i.test(attempt.detail)
  ) {
    attempt = await sendChatCompletionRequest({
      ...params,
      useJsonFormat: false,
    });
  }

  if (!attempt.ok) {
    throw new Error(formatOpenRouterError(attempt.status, attempt.detail));
  }

  return extractJsonObjectFromText(attempt.content) as T;
}

export async function testOpenRouterConnection(
  config: OpenRouterConfig,
  signal?: AbortSignal,
): Promise<{ modelId: string; latencyMs: number }> {
  if (!config.apiKey.trim()) {
    throw new Error('먼저 OpenRouter API 키를 입력해 주세요.');
  }
  const t0 = performance.now();
  const attempt = await sendChatCompletionRequest({
    config,
    messages: [
      {
        role: 'user',
        content: 'Reply with exact JSON: {"ok":true}',
      },
    ],
    temperature: 0,
    maxTokens: 24,
    useJsonFormat: false,
    signal,
  });

  if (!attempt.ok) {
    throw new Error(formatOpenRouterError(attempt.status, attempt.detail));
  }

  return {
    modelId: config.modelId.trim() || DEFAULT_OPENROUTER_MODEL,
    latencyMs: Math.round(performance.now() - t0),
  };
}


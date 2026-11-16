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

const fastParamsUnsupportedModels = new Set<string>();

export function resetOpenRouterCompatibilityCache(): void {
  fastParamsUnsupportedModels.clear();
}

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
    finish_reason?: string | null;
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
    code?: number | string;
  };
}

function sanitizeJsonCandidate(src: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        out.push(ch);
        escaped = false;
      } else if (ch === '\\') {
        out.push(ch);
        escaped = true;
      } else if (ch === '"') {
        out.push(ch);
        inString = false;
      } else if (ch === '\n') {
        out.push('\\n');
      } else if (ch === '\r') {
        out.push('\\r');
      } else if (ch === '\t') {
        out.push('\\t');
      } else {
        out.push(ch);
      }
      continue;
    }

    if (ch === '"') {
      out.push(ch);
      inString = true;
    } else if (ch === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) {
        j += 1;
      }
      if (j < src.length && (src[j] === '}' || src[j] === ']')) {
        continue;
      }
      out.push(ch);
    } else {
      out.push(ch);
    }
  }

  return out.join('');
}

function tryParseJsonObject(rawCandidate: string): unknown | undefined {
  const attempts = [rawCandidate, sanitizeJsonCandidate(rawCandidate)];
  for (const candidate of attempts) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // try next repair pass
    }
  }
  return undefined;
}

function extractBalancedTopLevelObjects(src: string): string[] {
  const slices: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        slices.push(src.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return slices;
}

function salvageTruncatedJsonObject(src: string): unknown | undefined {
  const firstBrace = src.indexOf('{');
  if (firstBrace === -1) return undefined;

  let inString = false;
  let escaped = false;
  const stack: ('{' | '[')[] = [];
  let checkpoint: { cutIndex: number; openStack: ('{' | '[')[] } | null = null;

  for (let i = firstBrace; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' && stack[stack.length - 1] === '{') {
      stack.pop();
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        checkpoint = { cutIndex: i + 1, openStack: [...stack] };
      }
    } else if (ch === ']' && stack[stack.length - 1] === '[') {
      stack.pop();
      if (stack.length > 0) {
        checkpoint = { cutIndex: i + 1, openStack: [...stack] };
      }
    }
  }

  if (stack.length === 0 || !checkpoint) return undefined;

  const prefix = sanitizeJsonCandidate(
    src.slice(firstBrace, checkpoint.cutIndex),
  ).replace(/,\s*$/, '');
  const closing = [...checkpoint.openStack]
    .reverse()
    .map((d) => (d === '[' ? ']' : '}'))
    .join('');

  return tryParseJsonObject(prefix + closing);
}

export function extractJsonObjectFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('AI 응답이 비어 있습니다.');
  }

  // Stage A: remove closed <think>...</think> reasoning blocks, and strip stray tags
  const withoutThink = trimmed
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();

  if (!withoutThink) {
    throw new Error('AI 응답이 비어 있습니다.');
  }

  const candidates: string[] = [];
  const fencedRegex = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(withoutThink)) !== null) {
    const inner = match[1].trim();
    if (inner) candidates.push(inner);
  }

  const strippedUnclosed = withoutThink
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (strippedUnclosed && !candidates.includes(strippedUnclosed)) {
    candidates.push(strippedUnclosed);
  }

  for (const candidate of candidates) {
    const direct = tryParseJsonObject(candidate);
    if (direct !== undefined) return direct;

    for (const balanced of extractBalancedTopLevelObjects(candidate)) {
      const parsed = tryParseJsonObject(balanced);
      if (parsed !== undefined) return parsed;
    }

    const salvaged = salvageTruncatedJsonObject(candidate);
    if (salvaged !== undefined) return salvaged;
  }

  throw new Error('AI 응답을 JSON 형식으로 해석하지 못했습니다.');
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
  useFastParams: boolean;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; status: number; detail: string }
> {
  const {
    config,
    messages,
    temperature = 0.2,
    maxTokens = 2048,
    useFastParams,
    signal,
  } = params;

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

  if (useFastParams) {
    body.response_format = { type: 'json_object' };
    body.reasoning = { effort: 'minimal', exclude: true };
    body.provider = { sort: 'throughput', allow_fallbacks: true };
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

  const choice = payload?.choices?.[0];
  const rawContent = choice?.message?.content;
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  return {
    ok: true,
    content: text,
    finishReason:
      typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

async function requestWithCompatibilityFallback(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<{ content: string; finishReason: string | null }> {
  const modelKey = params.config.modelId.trim() || DEFAULT_OPENROUTER_MODEL;
  const shouldUseFast = !fastParamsUnsupportedModels.has(modelKey);

  let attempt = await sendChatCompletionRequest({
    ...params,
    useFastParams: shouldUseFast,
  });

  if (
    shouldUseFast &&
    !attempt.ok &&
    attempt.status === 400 &&
    /response_format|json_object|json mode|reasoning|effort|minimal|exclude|provider|sort|not supported|invalid|unknown|unrecognized/i.test(
      attempt.detail,
    )
  ) {
    fastParamsUnsupportedModels.add(modelKey);
    attempt = await sendChatCompletionRequest({
      ...params,
      useFastParams: false,
    });
  }

  if (!attempt.ok) {
    throw new Error(formatOpenRouterError(attempt.status, attempt.detail));
  }

  return { content: attempt.content, finishReason: attempt.finishReason };
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

  const baseMaxTokens = params.maxTokens ?? 2048;
  const first = await requestWithCompatibilityFallback({
    config: params.config,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: baseMaxTokens,
    signal: params.signal,
  });

  try {
    return extractJsonObjectFromText(first.content) as T;
  } catch (firstErr) {
    if (params.signal?.aborted) {
      throw firstErr;
    }

    const retryMessages: ChatMessage[] = [
      ...params.messages,
      {
        role: 'user',
        content:
          'IMPORTANT: Your previous response could not be parsed as valid JSON. Return ONLY one valid, complete RFC 8259 JSON object. Do not wrap in markdown code fences and do not include any text outside { ... }.',
      },
    ];

    const retry = await requestWithCompatibilityFallback({
      config: params.config,
      messages: retryMessages,
      temperature: 0.1,
      maxTokens: Math.max(baseMaxTokens, 3200),
      signal: params.signal,
    });

    try {
      return extractJsonObjectFromText(retry.content) as T;
    } catch (retryErr) {
      if (retry.finishReason === 'length') {
        throw new Error(
          'AI 응답이 토큰 한도에서 잘려 JSON을 완성하지 못했습니다. 더 짧은 문장을 선택하거나 다른 모델을 선택해 보세요.',
        );
      }
      throw retryErr;
    }
  }
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
    maxTokens: 32,
    useFastParams: false,
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


import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  GEMINI_OVERLOAD_FALLBACK_MODELS,
  RETIRED_OPENROUTER_MODELS,
  getActiveAiApiKey,
  getActiveAiModelId,
  getActiveAiProvider,
  normalizeGeminiModelId,
  type AiProviderId,
  type ApiKeyStorageMode,
  type OpenRouterConfig,
} from '../types/ai';

const META_STORAGE_KEY = 'antwordprofiler_openrouter_meta_v1';
const KEY_STORAGE_KEY = 'antwordprofiler_openrouter_key_v1';
const GEMINI_KEY_STORAGE_KEY = 'antwordprofiler_gemini_key_v1';
const OPENROUTER_CHAT_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_OVERLOAD_COOLDOWN_MS = 60_000;
const GEMINI_ATTEMPT_TIMEOUT_MS = 5_500;

const fastParamsUnsupportedModels = new Set<string>();
const geminiNoFastThinkingModels = new Set<string>();
const geminiOverloadedUntil = new Map<string, number>();

export function resetOpenRouterCompatibilityCache(): void {
  fastParamsUnsupportedModels.clear();
  geminiNoFastThinkingModels.clear();
  geminiOverloadedUntil.clear();
}

function isTransientOverloadStatus(status: number): boolean {
  return (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    status === 500 ||
    status === 429
  );
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface StoredMeta {
  provider?: AiProviderId;
  storageMode: ApiKeyStorageMode;
  modelId: string;
  geminiModelId?: string;
}

function readStorageKey(mode: ApiKeyStorageMode, storageKey: string): string {
  try {
    return (
      (mode === 'local'
        ? window.localStorage.getItem(storageKey)
        : window.sessionStorage.getItem(storageKey)) ?? ''
    );
  } catch {
    return '';
  }
}

function writeStorageKey(
  mode: ApiKeyStorageMode,
  storageKey: string,
  value: string,
): void {
  try {
    if (!value) {
      window.sessionStorage.removeItem(storageKey);
      window.localStorage.removeItem(storageKey);
    } else if (mode === 'local') {
      window.localStorage.setItem(storageKey, value);
      window.sessionStorage.removeItem(storageKey);
    } else {
      window.sessionStorage.setItem(storageKey, value);
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // ignore storage restriction errors
  }
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
      provider: 'gemini',
      apiKey: '',
      storageMode: 'session',
      modelId: DEFAULT_OPENROUTER_MODEL,
      geminiApiKey: '',
      geminiModelId: DEFAULT_GEMINI_MODEL,
    };
  }

  let storedProvider: AiProviderId | undefined;
  let storageMode: ApiKeyStorageMode = 'session';
  let modelId = DEFAULT_OPENROUTER_MODEL;
  let geminiModelId = DEFAULT_GEMINI_MODEL;
  let persistedModelId: string | null = null;

  try {
    const rawMeta = window.localStorage.getItem(META_STORAGE_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta) as Partial<StoredMeta>;
      if (parsed.provider === 'gemini' || parsed.provider === 'openrouter') {
        storedProvider = parsed.provider;
      }
      if (parsed.storageMode === 'local' || parsed.storageMode === 'session') {
        storageMode = parsed.storageMode;
      }
      if (typeof parsed.modelId === 'string' && parsed.modelId.trim()) {
        persistedModelId = parsed.modelId.trim();
        modelId = resolveStoredOpenRouterModelId(persistedModelId);
      }
      if (
        typeof parsed.geminiModelId === 'string' &&
        parsed.geminiModelId.trim()
      ) {
        geminiModelId = normalizeGeminiModelId(parsed.geminiModelId);
      }
    }
  } catch {
    // ignore storage read failure
  }

  const apiKey = readStorageKey(storageMode, KEY_STORAGE_KEY).trim();
  const geminiApiKey = readStorageKey(storageMode, GEMINI_KEY_STORAGE_KEY).trim();

  const provider: AiProviderId =
    storedProvider ?? (apiKey && !geminiApiKey ? 'openrouter' : 'gemini');

  // Persist retirement migration so UI and disk stay aligned.
  if (persistedModelId && persistedModelId !== modelId) {
    try {
      const meta: StoredMeta = {
        provider,
        storageMode,
        modelId,
        geminiModelId,
      };
      window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
    } catch {
      // ignore quota errors
    }
  }

  return {
    provider,
    apiKey,
    storageMode,
    modelId,
    geminiApiKey,
    geminiModelId,
  };
}

export function saveOpenRouterConfig(config: OpenRouterConfig): OpenRouterConfig {
  const provider: AiProviderId = getActiveAiProvider(config);
  const normalized: OpenRouterConfig = {
    provider,
    apiKey: config.apiKey.trim(),
    storageMode: config.storageMode,
    modelId: config.modelId.trim() || DEFAULT_OPENROUTER_MODEL,
    geminiApiKey: (config.geminiApiKey ?? '').trim(),
    geminiModelId: normalizeGeminiModelId(config.geminiModelId),
  };

  if (typeof window === 'undefined') return normalized;

  try {
    const meta: StoredMeta = {
      provider: normalized.provider,
      storageMode: normalized.storageMode,
      modelId: normalized.modelId,
      geminiModelId: normalized.geminiModelId,
    };
    window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // ignore quota errors
  }

  writeStorageKey(normalized.storageMode, KEY_STORAGE_KEY, normalized.apiKey);
  writeStorageKey(
    normalized.storageMode,
    GEMINI_KEY_STORAGE_KEY,
    normalized.geminiApiKey ?? '',
  );

  return normalized;
}

export function clearOpenRouterApiKey(
  current: OpenRouterConfig,
): OpenRouterConfig {
  return saveOpenRouterConfig({ ...current, apiKey: '' });
}

export function clearGeminiApiKey(current: OpenRouterConfig): OpenRouterConfig {
  return saveOpenRouterConfig({ ...current, geminiApiKey: '' });
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
  if (status === 503 || status === 502 || status === 504) {
    return `OpenRouter 또는 연결된 모델 서버가 일시적으로 혼잡합니다 (HTTP ${status}). 잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.`;
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
    typeof window !== 'undefined' &&
    typeof window.location?.origin === 'string' &&
    /^https?:\/\//i.test(window.location.origin)
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
    body.provider = { sort: 'latency', allow_fallbacks: true };
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

interface GeminiRawResponse {
  candidates?: {
    finishReason?: string;
    content?: {
      parts?: { text?: string; thought?: boolean }[];
    };
  }[];
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function formatGeminiError(status: number, detail: string): string {
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /api[_ ]?key|API_KEY_INVALID|key not valid/i.test(detail))
  ) {
    return 'Google Gemini API 키가 유효하지 않습니다. Google AI Studio(aistudio.google.com)에서 발급한 키인지 확인해 주세요.';
  }
  if (status === 404) {
    return `선택한 Gemini 모델 ID를 찾을 수 없습니다 (${detail || '404'}). 모델 이름을 확인해 주세요.`;
  }
  if (status === 429) {
    return 'Gemini API 요청 한도(무료 티어 분당/일일 할당량)에 도달했습니다. 잠시 후 다시 시도하거나 gemini-3.5-flash-lite 모델을 선택해 보세요.';
  }
  if (status === 503 || status === 502 || status === 504) {
    return 'Google Gemini 서버에 일시적인 요청 폭주(HTTP 503)가 발생했습니다. 자동 재시도 및 백업 경량 모델 우회도 모두 혼잡 상태이니 10~30초 후 다시 시도해 주세요.';
  }
  return detail
    ? `Gemini API 오류 (${status}): ${detail}`
    : `Gemini API 호출에 실패했습니다 (HTTP ${status}).`;
}

function buildGeminiFastThinkingConfig(
  modelId: string,
): Record<string, unknown> {
  if (/^gemini-2\.5/i.test(modelId)) {
    return { thinkingBudget: 0 };
  }
  return { thinkingLevel: 'LOW' };
}

function withAttemptTimeout(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

async function sendGeminiGenerateContentRequest(params: {
  apiKey: string;
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  configMode: 'fast' | 'jsonOnly' | 'plain';
  signal?: AbortSignal;
}): Promise<
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; status: number; detail: string }
> {
  const {
    apiKey,
    modelId,
    messages,
    temperature = 0.2,
    maxTokens = 2048,
    configMode,
    signal,
  } = params;

  const systemParts: string[] = [];
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) systemParts.push(m.content);
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }
  const systemText = systemParts.join('\n\n').trim();
  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: systemText || 'Hello' }],
    });
  }

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens: maxTokens,
  };
  if (configMode === 'fast') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.thinkingConfig = buildGeminiFastThinkingConfig(modelId);
  } else if (configMode === 'jsonOnly') {
    generationConfig.responseMimeType = 'application/json';
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };
  if (systemText && !(messages.every((m) => m.role === 'system'))) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(modelId)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  let payload: GeminiRawResponse | null = null;
  try {
    payload = (await res.json()) as GeminiRawResponse;
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

  const candidate = payload?.candidates?.[0];
  if (!candidate && payload?.promptFeedback?.blockReason) {
    return {
      ok: false,
      status: 400,
      detail: `응답이 안전 필터에 의해 차단되었습니다 (${payload.promptFeedback.blockReason}).`,
    };
  }

  const parts = candidate?.content?.parts ?? [];
  const visibleText = parts
    .filter((p) => !p?.thought && typeof p?.text === 'string')
    .map((p) => p.text as string)
    .join('');
  const text =
    visibleText ||
    parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('');

  const rawFinish = candidate?.finishReason;
  const finishReason =
    rawFinish === 'MAX_TOKENS'
      ? 'length'
      : typeof rawFinish === 'string'
        ? rawFinish.toLowerCase()
        : null;

  return { ok: true, content: text, finishReason };
}

function isGeminiFatalClientError(status: number, detail: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    (status === 400 &&
      /api[_ ]?key|API_KEY_INVALID|key not valid|안전 필터/i.test(detail))
  );
}

type GeminiRawAttemptResult =
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; status: number; detail: string };

async function verifyGeminiModelMetadata(
  apiKey: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(modelId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
    signal,
  });

  let payload: GeminiRawResponse | null = null;
  try {
    payload = (await res.json()) as GeminiRawResponse;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      detail: payload?.error?.message ?? res.statusText ?? '',
    };
  }

  if (payload?.error?.message) {
    return {
      ok: false,
      status: Number(payload.error.code) || 500,
      detail: payload.error.message,
    };
  }

  return { ok: true };
}

async function executeSingleGeminiModelAttempt(params: {
  apiKey: string;
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<GeminiRawAttemptResult> {
  let mode: 'fast' | 'jsonOnly' | 'plain' = geminiNoFastThinkingModels.has(
    params.modelId,
  )
    ? 'jsonOnly'
    : 'fast';

  let attempt = await sendGeminiGenerateContentRequest({
    apiKey: params.apiKey,
    modelId: params.modelId,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    configMode: mode,
    signal: params.signal,
  });

  if (
    mode === 'fast' &&
    !attempt.ok &&
    attempt.status === 400 &&
    !isGeminiFatalClientError(attempt.status, attempt.detail) &&
    /thinking|budget|thinkingLevel|thinking_level|thinkingConfig|not supported|unknown name|invalid|cannot/i.test(
      attempt.detail,
    )
  ) {
    geminiNoFastThinkingModels.add(params.modelId);
    mode = 'jsonOnly';
    attempt = await sendGeminiGenerateContentRequest({
      apiKey: params.apiKey,
      modelId: params.modelId,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      configMode: mode,
      signal: params.signal,
    });
  }

  if (
    mode === 'jsonOnly' &&
    !attempt.ok &&
    attempt.status === 400 &&
    !isGeminiFatalClientError(attempt.status, attempt.detail) &&
    /responseMimeType|json|mime/i.test(attempt.detail)
  ) {
    attempt = await sendGeminiGenerateContentRequest({
      apiKey: params.apiKey,
      modelId: params.modelId,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      configMode: 'plain',
      signal: params.signal,
    });
  }

  return attempt;
}

function buildOrderedGeminiCandidates(primaryModel: string): string[] {
  const all = [
    primaryModel,
    ...GEMINI_OVERLOAD_FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];
  const now = Date.now();
  const healthy: string[] = [];
  const cooled: string[] = [];
  for (const model of all) {
    const until = geminiOverloadedUntil.get(model) ?? 0;
    if (until > now) {
      cooled.push(model);
    } else {
      healthy.push(model);
    }
  }
  return [...healthy, ...cooled];
}

async function runGeminiWithOverloadFailover(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  finishReason: string | null;
  usedModelId: string;
  fallbackFromModelId?: string;
}> {
  const apiKey = getActiveAiApiKey(params.config);
  const primaryModel = getActiveAiModelId(params.config);
  const candidates = buildOrderedGeminiCandidates(primaryModel);
  let lastError: { status: number; detail: string } = {
    status: 503,
    detail: 'Service unavailable',
  };

  for (let idx = 0; idx < candidates.length; idx++) {
    const candidateModel = candidates[idx];
    const hasBackupRemaining = idx < candidates.length - 1;

    const runAttemptOnce = async (): Promise<GeminiRawAttemptResult> => {
      if (!hasBackupRemaining) {
        return executeSingleGeminiModelAttempt({
          apiKey,
          modelId: candidateModel,
          messages: params.messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          signal: params.signal,
        });
      }

      const timeoutGuard = withAttemptTimeout(
        params.signal,
        params.attemptTimeoutMs ?? GEMINI_ATTEMPT_TIMEOUT_MS,
      );
      try {
        return await executeSingleGeminiModelAttempt({
          apiKey,
          modelId: candidateModel,
          messages: params.messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          signal: timeoutGuard.signal,
        });
      } catch (err) {
        if (!params.signal?.aborted && timeoutGuard.didTimeout()) {
          return {
            ok: false,
            status: 504,
            detail: 'Model response timeout',
          };
        }
        throw err;
      } finally {
        timeoutGuard.cleanup();
      }
    };

    let attempt = await runAttemptOnce();

    if (
      !attempt.ok &&
      candidates.length === 1 &&
      isTransientOverloadStatus(attempt.status)
    ) {
      await sleepWithSignal(250, params.signal);
      attempt = await runAttemptOnce();
    }

    if (attempt.ok) {
      geminiOverloadedUntil.delete(candidateModel);
      return {
        content: attempt.content,
        finishReason: attempt.finishReason,
        usedModelId: candidateModel,
        fallbackFromModelId:
          candidateModel !== primaryModel ? primaryModel : undefined,
      };
    }

    if (isGeminiFatalClientError(attempt.status, attempt.detail)) {
      throw new Error(formatGeminiError(attempt.status, attempt.detail));
    }

    if (candidateModel === primaryModel && attempt.status === 404) {
      throw new Error(formatGeminiError(attempt.status, attempt.detail));
    }

    lastError = { status: attempt.status, detail: attempt.detail };

    if (isTransientOverloadStatus(attempt.status)) {
      geminiOverloadedUntil.set(
        candidateModel,
        Date.now() + GEMINI_OVERLOAD_COOLDOWN_MS,
      );
      continue;
    }

    if (candidateModel === primaryModel) {
      throw new Error(formatGeminiError(attempt.status, attempt.detail));
    }
  }

  throw new Error(formatGeminiError(lastError.status, lastError.detail));
}

async function requestGeminiWithCompatibilityFallback(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ content: string; finishReason: string | null }> {
  const res = await runGeminiWithOverloadFailover(params);
  return { content: res.content, finishReason: res.finishReason };
}

async function requestWithCompatibilityFallback(params: {
  config: OpenRouterConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<{ content: string; finishReason: string | null }> {
  const modelKey = params.config.modelId.trim() || DEFAULT_OPENROUTER_MODEL;
  let shouldUseFast = !fastParamsUnsupportedModels.has(modelKey);

  let attempt = await sendChatCompletionRequest({
    ...params,
    useFastParams: shouldUseFast,
  });

  // Only retry/plain-fallback for known fast-param capability rejections.
  // Generic 400s (auth, quota, schema, max_tokens, …) must not permanently disable fast params.
  if (
    shouldUseFast &&
    !attempt.ok &&
    attempt.status === 400 &&
    /response_format|json_object|json[\s_-]?mode|reasoning|effort|minimal|exclude|provider\.?sort|provider/i.test(
      attempt.detail,
    )
  ) {
    fastParamsUnsupportedModels.add(modelKey);
    shouldUseFast = false;
    attempt = await sendChatCompletionRequest({
      ...params,
      useFastParams: false,
    });
  }

  if (
    !attempt.ok &&
    (attempt.status === 502 || attempt.status === 503 || attempt.status === 504)
  ) {
    await sleepWithSignal(350, params.signal);
    attempt = await sendChatCompletionRequest({
      ...params,
      useFastParams: shouldUseFast,
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
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const provider = getActiveAiProvider(params.config);
  const activeKey = getActiveAiApiKey(params.config);
  if (!activeKey) {
    throw new Error(
      provider === 'gemini'
        ? 'Google Gemini API 키가 설정되지 않았습니다.'
        : 'OpenRouter API 키가 설정되지 않았습니다.',
    );
  }

  const runAttempt =
    provider === 'gemini'
      ? requestGeminiWithCompatibilityFallback
      : requestWithCompatibilityFallback;

  const baseMaxTokens = params.maxTokens ?? 2048;
  const first = await runAttempt({
    config: params.config,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: baseMaxTokens,
    attemptTimeoutMs: params.attemptTimeoutMs,
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

    const retry = await runAttempt({
      config: params.config,
      messages: retryMessages,
      temperature: 0.1,
      maxTokens: Math.max(baseMaxTokens, 3200),
      attemptTimeoutMs: params.attemptTimeoutMs,
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
): Promise<{
  provider: AiProviderId;
  modelId: string;
  fallbackFromModelId?: string;
  latencyMs: number;
}> {
  const provider = getActiveAiProvider(config);
  const activeKey = getActiveAiApiKey(config);
  const modelId = getActiveAiModelId(config);

  if (!activeKey) {
    throw new Error(
      provider === 'gemini'
        ? '먼저 Google Gemini API 키를 입력해 주세요.'
        : '먼저 OpenRouter API 키를 입력해 주세요.',
    );
  }

  const t0 = performance.now();
  if (provider === 'gemini') {
    const metaCheck = await verifyGeminiModelMetadata(
      activeKey,
      modelId,
      signal,
    );
    if (metaCheck.ok) {
      return {
        provider,
        modelId,
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    if (
      isGeminiFatalClientError(metaCheck.status, metaCheck.detail) ||
      metaCheck.status === 404
    ) {
      throw new Error(formatGeminiError(metaCheck.status, metaCheck.detail));
    }

    const res = await runGeminiWithOverloadFailover({
      config,
      messages: [{ role: 'user', content: 'ok' }],
      temperature: 0,
      maxTokens: 8,
      signal,
    });

    return {
      provider,
      modelId: res.usedModelId,
      fallbackFromModelId: res.fallbackFromModelId,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  await requestWithCompatibilityFallback({
    config,
    messages: [{ role: 'user', content: 'ok' }],
    temperature: 0,
    maxTokens: 8,
    signal,
  });

  return {
    provider,
    modelId,
    latencyMs: Math.round(performance.now() - t0),
  };
}


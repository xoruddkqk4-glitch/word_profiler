import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { testOpenRouterConnection } from '../../ai/openRouterClient';
import { validateAndCompileTokenRegex } from '../../core/tokenizer';
import { useProfilerStore } from '../../store/useProfilerStore';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  RECOMMENDED_GEMINI_MODELS,
  RECOMMENDED_OPENROUTER_MODELS,
  getActiveAiProvider,
  normalizeGeminiModelId,
  type AiProviderId,
  type ApiKeyStorageMode,
  type SettingsSectionId,
} from '../../types/ai';
import type { ListFormatMode, MainTabId } from '../../types/domain';

export const SettingsModal: React.FC = () => {
  const store = useProfilerStore();
  const open = store.settingsModalOpen;

  const [section, setSection] = useState<SettingsSectionId>(
    store.settingsInitialSection,
  );
  const [tokenDef, setTokenDef] = useState(store.settings.tokenDefinition);
  const [ignoreCase, setIgnoreCase] = useState(store.settings.ignoreCase);
  const [showLevels, setShowLevels] = useState(store.settings.showLevels);
  const [defaultTab, setDefaultTab] = useState<MainTabId>(
    store.settings.defaultTab,
  );
  const [nationFormat, setNationFormat] = useState<ListFormatMode>(
    store.settings.nationFormat,
  );
  const [stripAnnotations, setStripAnnotations] = useState(
    store.settings.stripCurriculumAnnotations,
  );

  // AI provider & key fields
  const [provider, setProvider] = useState<AiProviderId>(
    getActiveAiProvider(store.openRouterConfig),
  );
  const [geminiApiKey, setGeminiApiKey] = useState(
    store.openRouterConfig.geminiApiKey ?? '',
  );
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiModelId, setGeminiModelId] = useState(
    store.openRouterConfig.geminiModelId ?? DEFAULT_GEMINI_MODEL,
  );
  const [apiKey, setApiKey] = useState(store.openRouterConfig.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [storageMode, setStorageMode] = useState<ApiKeyStorageMode>(
    store.openRouterConfig.storageMode,
  );
  const [modelId, setModelId] = useState(store.openRouterConfig.modelId);
  const [testingConn, setTestingConn] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setSection(store.settingsInitialSection);
      setTokenDef(store.settings.tokenDefinition);
      setIgnoreCase(store.settings.ignoreCase);
      setShowLevels(store.settings.showLevels);
      setDefaultTab(store.settings.defaultTab);
      setNationFormat(store.settings.nationFormat);
      setStripAnnotations(store.settings.stripCurriculumAnnotations);

      setProvider(getActiveAiProvider(store.openRouterConfig));
      setGeminiApiKey(store.openRouterConfig.geminiApiKey ?? '');
      setShowGeminiKey(false);
      setGeminiModelId(
        store.openRouterConfig.geminiModelId ?? DEFAULT_GEMINI_MODEL,
      );
      setApiKey(store.openRouterConfig.apiKey);
      setShowApiKey(false);
      setStorageMode(store.openRouterConfig.storageMode);
      setModelId(store.openRouterConfig.modelId);
      setTestingConn(false);
      setTestFeedback(null);
    }
    // Sync draft fields only when the modal opens (or section changes),
    // not when openRouterConfig mutates mid-edit (e.g. Clear key).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, store.settingsInitialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.setSettingsModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, store]);

  if (!open) return null;

  const regexCheck = validateAndCompileTokenRegex(tokenDef, ignoreCase);

  const normalizedGeminiModel = normalizeGeminiModelId(geminiModelId);
  const matchedGeminiPreset = RECOMMENDED_GEMINI_MODELS.some(
    (m) => m.id === normalizedGeminiModel,
  )
    ? normalizedGeminiModel
    : '__custom__';

  const matchedPresetModel = RECOMMENDED_OPENROUTER_MODELS.some(
    (m) => m.id === modelId.trim(),
  )
    ? modelId.trim()
    : '__custom__';

  const activeDraftKey = provider === 'gemini' ? geminiApiKey : apiKey;

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestFeedback(null);
    try {
      const res = await testOpenRouterConnection({
        provider,
        apiKey,
        geminiApiKey,
        storageMode,
        modelId: modelId.trim() || DEFAULT_OPENROUTER_MODEL,
        geminiModelId: normalizedGeminiModel,
      });
      setTestFeedback({
        ok: true,
        msg: res.fallbackFromModelId
          ? `연결 성공 (${res.provider === 'gemini' ? 'Gemini' : 'OpenRouter'}): ${res.modelId} (${res.latencyMs} ms · 기본 모델 ${res.fallbackFromModelId} 일시 혼잡으로 자동 우회됨)`
          : `연결 성공 (${res.provider === 'gemini' ? 'Gemini' : 'OpenRouter'}): ${res.modelId} (${res.latencyMs} ms)`,
      });
    } catch (err) {
      setTestFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : '연결 테스트 실패',
      });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSave = async () => {
    if (!regexCheck.ok) return;
    store.updateOpenRouterConfig({
      provider,
      apiKey: apiKey.trim(),
      geminiApiKey: geminiApiKey.trim(),
      storageMode,
      modelId: modelId.trim() || DEFAULT_OPENROUTER_MODEL,
      geminiModelId: normalizedGeminiModel,
    });
    store.setSettingsModalOpen(false);
    await store.updateSettings({
      tokenDefinition: tokenDef.trim(),
      ignoreCase,
      showLevels,
      defaultTab,
      nationFormat,
      stripCurriculumAnnotations: stripAnnotations,
    });
  };

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.setSettingsModalOpen(false);
      }}
    >
      <div
        className="modal-card settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="modal-header">
          <h2 id="settings-modal-title" className="modal-title">
            Global Settings
          </h2>
          <button
            type="button"
            className="mini-icon-btn"
            aria-label="닫기"
            onClick={() => store.setSettingsModalOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-grid">
            <nav className="settings-nav" aria-label="Settings Categories">
              <button
                type="button"
                className="menu-item settings-nav-item"
                data-active={section === 'display'}
                onClick={() => setSection('display')}
              >
                Display settings
              </button>
              <button
                type="button"
                className="menu-item settings-nav-item"
                data-active={section === 'word'}
                onClick={() => setSection('word')}
              >
                Word settings
              </button>
              <button
                type="button"
                className="menu-item settings-nav-item"
                data-active={section === 'ai'}
                onClick={() => setSection('ai')}
              >
                AI Assistant (API Keys)
              </button>
            </nav>

            <div className="settings-content-pane">
              {section === 'display' ? (
                <>
                  <div className="settings-field">
                    <span className="settings-field-label">Default Tab</span>
                    <div className="settings-radio-group">
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultTab === 'profiler'}
                          onChange={() => setDefaultTab('profiler')}
                        />
                        File profiler
                      </label>
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultTab === 'statistics'}
                          onChange={() => setDefaultTab('statistics')}
                        />
                        Statistics viewer
                      </label>
                    </div>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">
                      File Profile Highlight Mode
                    </span>
                    <div className="settings-radio-group">
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="showLevels"
                          checked={showLevels}
                          onChange={() => setShowLevels(true)}
                        />
                        Highlight list words
                      </label>
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="showLevels"
                          checked={!showLevels}
                          onChange={() => setShowLevels(false)}
                        />
                        Highlight non-list words
                      </label>
                    </div>
                  </div>
                </>
              ) : section === 'word' ? (
                <>
                  <div className="settings-field">
                    <label
                      htmlFor="token-def-input"
                      className="settings-field-label"
                    >
                      Token definition (Unicode Regular Expression)
                    </label>
                    <input
                      id="token-def-input"
                      type="text"
                      className="text-input mono"
                      value={tokenDef}
                      onChange={(e) => setTokenDef(e.target.value)}
                    />
                    {!regexCheck.ok ? (
                      <div className="settings-field-help settings-error-help">
                        {regexCheck.error}
                      </div>
                    ) : (
                      <div className="settings-field-help">
                        기본값: <code className="mono">[\p&#123;L&#125;]+</code>{' '}
                        · 아포스트로피 축약형 포함 예:{' '}
                        <code className="mono">
                          [\p&#123;L&#125;]+(?:[&apos;’][\p&#123;L&#125;]+)?
                        </code>{' '}
                        (주의: 내장 GSL·교육과정 단어장은 <code>don</code> +{' '}
                        <code>t</code> 분리 기준이므로 축약형 통합 시 사용자
                        단어장에 <code>don&apos;t</code> 형태가 있어야 매칭됩니다)
                      </div>
                    )}
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">Case</span>
                    <div className="settings-radio-group">
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="caseMode"
                          checked={ignoreCase}
                          onChange={() => setIgnoreCase(true)}
                        />
                        Case insensitive (권장)
                      </label>
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="caseMode"
                          checked={!ignoreCase}
                          onChange={() => setIgnoreCase(false)}
                        />
                        Case sensitive
                      </label>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label
                      htmlFor="list-format-select"
                      className="settings-field-label"
                    >
                      Wordlist Format Detection
                    </label>
                    <select
                      id="list-format-select"
                      className="preset-select"
                      value={nationFormat}
                      onChange={(e) =>
                        setNationFormat(e.target.value as ListFormatMode)
                      }
                    >
                      <option value="auto">
                        Auto-detect (Rows &amp; Paul Nation Trees)
                      </option>
                      <option value="rows">Row-based (Tab-separated)</option>
                      <option value="trees">
                        Paul Nation Tree (Indented members)
                      </option>
                    </select>
                  </div>

                  <div className="settings-field">
                    <label className="inline-check-label">
                      <input
                        type="checkbox"
                        checked={stripAnnotations}
                        onChange={(e) => setStripAnnotations(e.target.checked)}
                      />
                      <span>
                        교육과정 단어장 주석 기호(<code>*</code>, <code>**</code>)
                        자동 정규화
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-field">
                    <span className="settings-field-label">AI 제공자 선택</span>
                    <div
                      className="segmented-toggle settings-provider-toggle"
                      role="tablist"
                      aria-label="AI API 제공자 선택"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={provider === 'gemini'}
                        className="segmented-btn"
                        data-active={provider === 'gemini'}
                        onClick={() => {
                          setProvider('gemini');
                          setTestFeedback(null);
                        }}
                      >
                        Google Gemini API (무료 지원)
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={provider === 'openrouter'}
                        className="segmented-btn"
                        data-active={provider === 'openrouter'}
                        onClick={() => {
                          setProvider('openrouter');
                          setTestFeedback(null);
                        }}
                      >
                        OpenRouter API
                      </button>
                    </div>
                  </div>

                  {provider === 'gemini' ? (
                    <>
                      <div className="settings-field">
                        <label
                          htmlFor="gemini-api-key"
                          className="settings-field-label"
                        >
                          Google Gemini API Key (무료 티어 지원)
                        </label>
                        <div className="settings-key-row">
                          <input
                            id="gemini-api-key"
                            type={showGeminiKey ? 'text' : 'password'}
                            className="text-input mono"
                            placeholder="AIzaSy..."
                            autoComplete="off"
                            spellCheck={false}
                            value={geminiApiKey}
                            onChange={(e) => {
                              setGeminiApiKey(e.target.value);
                              setTestFeedback(null);
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-icon"
                            title={
                              showGeminiKey ? 'API 키 숨기기' : 'API 키 보기'
                            }
                            aria-label={
                              showGeminiKey ? 'API 키 숨기기' : 'API 키 보기'
                            }
                            onClick={() => setShowGeminiKey((v) => !v)}
                          >
                            {showGeminiKey ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                          {geminiApiKey.trim() && (
                            <button
                              type="button"
                              className="btn btn-icon"
                              title="저장된 Gemini API 키 지우기"
                              aria-label="저장된 Gemini API 키 지우기"
                              onClick={() => {
                                setGeminiApiKey('');
                                setTestFeedback(null);
                                store.clearGeminiKey();
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        {geminiApiKey.trim().startsWith('sk-or-') && (
                          <div className="settings-field-help settings-error-help">
                            OpenRouter 키(&apos;sk-or-...&apos;)로 보입니다.{' '}
                            <a
                              href="https://aistudio.google.com/apikey"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Google AI Studio
                            </a>
                            에서 발급한 Gemini 키(&apos;AIza...&apos;)를 입력하거나
                            상단에서 OpenRouter API를 선택해 주세요.
                          </div>
                        )}
                        <div className="settings-field-help">
                          <a
                            href="https://aistudio.google.com/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Google AI Studio (aistudio.google.com/apikey)
                          </a>
                          에서 신용카드 없이 무료 Gemini API 키를 발급받을 수
                          있습니다. 키는 별도 서버·DB를 거치지 않고 브라우저에서{' '}
                          <code>generativelanguage.googleapis.com</code>으로만
                          직접 전송되며 설정 내보내기(<code>.ini</code> /{' '}
                          <code>.json</code>)에서 항상 제외됩니다.
                        </div>
                        <div className="settings-field-help">
                          무료 등급(Free Tier)에서는 Google 정책상 입력 내용이
                          모델 개선에 활용될 수 있으므로 민감한 지문에는 사용을
                          피해 주세요.
                        </div>
                      </div>

                      <div className="settings-field">
                        <label
                          htmlFor="gemini-preset-model"
                          className="settings-field-label"
                        >
                          Gemini Model
                        </label>
                        <div className="settings-model-stack">
                          <select
                            id="gemini-preset-model"
                            className="preset-select"
                            value={matchedGeminiPreset}
                            onChange={(e) => {
                              if (e.target.value !== '__custom__') {
                                setGeminiModelId(e.target.value);
                                setTestFeedback(null);
                              }
                            }}
                          >
                            {RECOMMENDED_GEMINI_MODELS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                            <option value="__custom__">
                              직접 Gemini 모델 ID 입력
                            </option>
                          </select>

                          <input
                            type="text"
                            aria-label="Gemini 모델 ID 직접 입력"
                            className="text-input mono"
                            placeholder="예: gemini-3.8-flash, gemini-3.5-flash-lite"
                            value={geminiModelId}
                            onChange={(e) => {
                              setGeminiModelId(e.target.value);
                              setTestFeedback(null);
                            }}
                          />
                        </div>
                        <div className="settings-field-help">
                          권장 무료·고속 모델:{' '}
                          <code className="mono">gemini-3.8-flash</code> 또는{' '}
                          <code className="mono">gemini-3.5-flash-lite</code>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settings-field">
                        <label
                          htmlFor="openrouter-api-key"
                          className="settings-field-label"
                        >
                          OpenRouter API Key
                        </label>
                        <div className="settings-key-row">
                          <input
                            id="openrouter-api-key"
                            type={showApiKey ? 'text' : 'password'}
                            className="text-input mono"
                            placeholder="sk-or-v1-..."
                            autoComplete="off"
                            spellCheck={false}
                            value={apiKey}
                            onChange={(e) => {
                              setApiKey(e.target.value);
                              setTestFeedback(null);
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-icon"
                            title={showApiKey ? 'API 키 숨기기' : 'API 키 보기'}
                            aria-label={
                              showApiKey ? 'API 키 숨기기' : 'API 키 보기'
                            }
                            onClick={() => setShowApiKey((v) => !v)}
                          >
                            {showApiKey ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                          {apiKey.trim() && (
                            <button
                              type="button"
                              className="btn btn-icon"
                              title="저장된 OpenRouter API 키 지우기"
                              aria-label="저장된 OpenRouter API 키 지우기"
                              onClick={() => {
                                setApiKey('');
                                setTestFeedback(null);
                                store.clearOpenRouterKey();
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        {apiKey.trim().startsWith('AIza') && (
                          <div className="settings-field-help settings-error-help">
                            Google Gemini API 키(&apos;AIza...&apos;)로 보입니다.
                            상단에서 <strong>Google Gemini API (무료 지원)</strong>
                            를 선택해 입력해 주세요.
                          </div>
                        )}
                        <div className="settings-field-help">
                          입력한 키는 별도 서버나 DB를 거치지 않고 현재
                          브라우저에서 <code>openrouter.ai</code>로만 직접
                          전송되며, 설정 파일(<code>.ini</code> /{' '}
                          <code>.json</code>) 내보내기에서 항상 제외됩니다.
                        </div>
                        <div className="settings-field-help">
                          AI 추천·어근 분석 시 선택한 단어와 그 문장(필요 시 본문
                          일부)이 OpenRouter 모델로 전송됩니다. 민감한 학습
                          자료에는 사용을 피하거나, 전송에 동의한 뒤에만 사용해
                          주세요.
                        </div>
                      </div>

                      <div className="settings-field">
                        <label
                          htmlFor="openrouter-preset-model"
                          className="settings-field-label"
                        >
                          OpenRouter Model
                        </label>
                        <div className="settings-model-stack">
                          <select
                            id="openrouter-preset-model"
                            className="preset-select"
                            value={matchedPresetModel}
                            onChange={(e) => {
                              if (e.target.value !== '__custom__') {
                                setModelId(e.target.value);
                                setTestFeedback(null);
                              }
                            }}
                          >
                            {RECOMMENDED_OPENROUTER_MODELS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                            <option value="__custom__">
                              직접 모델 ID 입력 (Custom OpenRouter Slug)
                            </option>
                          </select>

                          <input
                            type="text"
                            aria-label="OpenRouter 모델 ID 직접 입력"
                            className="text-input mono"
                            placeholder="예: google/gemini-2.5-flash"
                            value={modelId}
                            onChange={(e) => {
                              setModelId(e.target.value);
                              setTestFeedback(null);
                            }}
                          />
                        </div>
                        <div className="settings-field-help">
                          OpenRouter에서 지원하는 모든 모델 슬러그(예:{' '}
                          <code className="mono">google/gemini-2.5-flash</code>,{' '}
                          <code className="mono">openai/gpt-4o-mini</code>)를
                          입력할 수 있습니다.
                        </div>
                      </div>
                    </>
                  )}

                  <div className="settings-field">
                    <span className="settings-field-label">
                      API 키 브라우저 보관 방식
                    </span>
                    <div className="settings-radio-stack">
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="orStorageMode"
                          checked={storageMode === 'session'}
                          onChange={() => setStorageMode('session')}
                        />
                        <span>
                          현재 탭 세션에만 보관 (<code>sessionStorage</code> ·
                          브라우저 탭을 닫으면 자동 삭제)
                        </span>
                      </label>
                      <label className="inline-check-label">
                        <input
                          type="radio"
                          name="orStorageMode"
                          checked={storageMode === 'local'}
                          onChange={() => setStorageMode('local')}
                        />
                        <span>
                          이 브라우저에 기억하기 (<code>localStorage</code> · 개인
                          PC 전용)
                        </span>
                      </label>
                    </div>
                    {storageMode === 'local' && (
                      <div className="settings-field-help settings-error-help">
                        GitHub Pages처럼 <code>*.github.io</code> 출처를 공유하는
                        배포에서는 같은 계정의 다른 저장소 페이지도 이 키를 읽을 수
                        있습니다. 공유 PC·Pages 배포에서는 세션 보관을 권장합니다.
                      </div>
                    )}
                  </div>

                  <div className="settings-test-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!activeDraftKey.trim() || testingConn}
                      onClick={() => void handleTestConnection()}
                    >
                      {testingConn ? (
                        <Loader2 size={15} className="ai-spin" />
                      ) : (
                        <PlugZap size={15} />
                      )}
                      <span>
                        {testingConn ? '연결 확인 중...' : '연결 테스트'}
                      </span>
                    </button>

                    {testFeedback && (
                      <span
                        className="settings-test-feedback"
                        data-ok={testFeedback.ok}
                      >
                        {testFeedback.ok ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <XCircle size={15} />
                        )}
                        <span>{testFeedback.msg}</span>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={() => store.setSettingsModalOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!regexCheck.ok}
            onClick={() => void handleSave()}
          >
            Apply Settings
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

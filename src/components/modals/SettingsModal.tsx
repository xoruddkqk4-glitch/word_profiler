import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { validateAndCompileTokenRegex } from '../../core/tokenizer';
import { useProfilerStore } from '../../store/useProfilerStore';
import type { ListFormatMode, MainTabId } from '../../types/domain';

export const SettingsModal: React.FC = () => {
  const store = useProfilerStore();
  const open = store.settingsModalOpen;

  const [section, setSection] = useState<'display' | 'word'>('display');
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

  useEffect(() => {
    if (open) {
      setTokenDef(store.settings.tokenDefinition);
      setIgnoreCase(store.settings.ignoreCase);
      setShowLevels(store.settings.showLevels);
      setDefaultTab(store.settings.defaultTab);
      setNationFormat(store.settings.nationFormat);
      setStripAnnotations(store.settings.stripCurriculumAnnotations);
    }
  }, [open, store.settings]);

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

  const handleSave = async () => {
    if (!regexCheck.ok) return;
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
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
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
                className="menu-item"
                style={{
                  fontWeight: section === 'display' ? 600 : 500,
                  background:
                    section === 'display' ? 'var(--bg-selected)' : undefined,
                }}
                onClick={() => setSection('display')}
              >
                Display settings
              </button>
              <button
                type="button"
                className="menu-item"
                style={{
                  fontWeight: section === 'word' ? 600 : 500,
                  background:
                    section === 'word' ? 'var(--bg-selected)' : undefined,
                }}
                onClick={() => setSection('word')}
              >
                Word settings
              </button>
            </nav>

            <div>
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
              ) : (
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
                      <div
                        className="settings-field-help"
                        style={{ color: 'var(--status-danger-fg)' }}
                      >
                        {regexCheck.error}
                      </div>
                    ) : (
                      <div className="settings-field-help">
                        기본값: <code className="mono">[\p&#123;L&#125;]+</code>{' '}
                        · 아포스트로피 축약형 포함 예:{' '}
                        <code className="mono">
                          [\p&#123;L&#125;]+(?:&apos;[\p&#123;L&#125;]+)?
                        </code>
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


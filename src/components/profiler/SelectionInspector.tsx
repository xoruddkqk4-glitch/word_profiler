import React, { useState } from 'react';
import { Copy, Plus, ShieldOff, Sparkles, Trash2 } from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';
import { AiLexicalPanel } from './AiLexicalPanel';

export const SelectionInspector: React.FC = () => {
  const store = useProfilerStore();
  const [newIgnoreInput, setNewIgnoreInput] = useState('');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  const profile = store.activeProfile;
  const wordKey = store.selectedWordKey;
  const span = store.selectedTokenSpan;
  const isPhraseSelection = Boolean(span && span.endTokenIdx > span.startTokenIdx);

  const wordStats =
    profile && wordKey ? profile.tokenFreqByKey[wordKey] ?? null : null;

  const pctText =
    profile && wordStats && profile.totalTokens > 0
      ? ((wordStats.count * 100) / profile.totalTokens).toFixed(2)
      : '0.00';

  const levelDisplay = !wordStats
    ? '—'
    : wordStats.kind === 'level'
      ? `Level ${wordStats.activeLevelIndex + 1} (${wordStats.listName})`
      : wordStats.kind === 'ignored'
        ? 'Ignored'
        : 'Out of lists';

  const canAddSelectedToIgnore = Boolean(
    !isPhraseSelection && wordKey && (!wordStats || wordStats.kind === 'out'),
  );

  const handleAddInput = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = newIgnoreInput.trim();
    if (!raw) return;
    setNewIgnoreInput('');
    if (/\s/.test(raw)) {
      await store.pasteIntoExtraIgnoreWords(raw);
    } else {
      await store.addExtraIgnoreWord(raw);
    }
  };

  const toggleExtraSelection = (w: string) => {
    setSelectedExtras((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w],
    );
  };

  return (
    <aside className="inspector-sidebar">
      {/* Selection Inspector Summary */}
      <div className="inspector-block">
        <div className="section-header inspector-top-header">
          <h3 className="section-title">Selection Inspector</h3>
          {isPhraseSelection && span && (
            <span className="count-badge tabular-nums">
              {span.endTokenIdx - span.startTokenIdx + 1} words
            </span>
          )}
        </div>

        <div className="inspector-kv-list">
          <span className="inspector-k">Selection:</span>
          <span className="inspector-v inspector-selection-preview">
            {store.selectedRawToken || '단어 클릭 또는 구문 드래그'}
          </span>

          {!isPhraseSelection && (
            <>
              <span className="inspector-k">Count:</span>
              <span className="inspector-v tabular-nums">
                {wordStats ? `${wordStats.count} (${pctText}%)` : '—'}
              </span>

              <span className="inspector-k">Level:</span>
              <span className="inspector-v">{levelDisplay}</span>

              <span className="inspector-k">Headword:</span>
              <span className="inspector-v">
                {wordStats ? wordStats.headword : '—'}
              </span>
            </>
          )}
        </div>

        {!isPhraseSelection && (
          <button
            type="button"
            className="btn btn-sm ai-full-btn"
            disabled={!canAddSelectedToIgnore}
            onClick={() => {
              if (wordKey) void store.addExtraIgnoreWord(wordKey);
            }}
          >
            <Plus size={15} /> Add to Ignore List
          </button>
        )}
      </div>

      {/* Inspector Body Switcher: AI Assistant vs Extra Ignore Words */}
      <div className="inspector-tab-bar">
        <div
          className="segmented-toggle ai-task-tabs"
          role="tablist"
          aria-label="우측 패널 도구 전환"
        >
          <button
            type="button"
            role="tab"
            aria-selected={store.inspectorTab === 'ai'}
            className="segmented-btn"
            data-active={store.inspectorTab === 'ai'}
            onClick={() => store.setInspectorTab('ai')}
          >
            <Sparkles size={14} />
            <span>AI 어휘 도우미</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={store.inspectorTab === 'ignore'}
            className="segmented-btn"
            data-active={store.inspectorTab === 'ignore'}
            onClick={() => store.setInspectorTab('ignore')}
          >
            <ShieldOff size={14} />
            <span>Ignore ({store.extraIgnoreWords.length})</span>
          </button>
        </div>
      </div>

      {store.inspectorTab === 'ai' ? (
        <AiLexicalPanel />
      ) : (
        <div
          className="extra-ignore-block"
          onPaste={async (e) => {
            const text = e.clipboardData.getData('text');
            if (text && /\s/.test(text.trim())) {
              e.preventDefault();
              await store.pasteIntoExtraIgnoreWords(text);
            }
          }}
        >
          <div className="section-header inspector-sub-header">
            <div className="section-title-wrap">
              <h3 className="section-title">Extra Ignore Words</h3>
              <span className="count-badge tabular-nums">
                {store.extraIgnoreWords.length}
              </span>
            </div>
            <button
              type="button"
              className="mini-icon-btn"
              disabled={store.extraIgnoreWords.length === 0}
              title="Extra Ignore 전체 목록 복사"
              aria-label="전체 복사"
              onClick={() =>
                void navigator.clipboard.writeText(
                  store.extraIgnoreWords.join('\n'),
                )
              }
            >
              <Copy size={15} />
            </button>
          </div>

          <form className="extra-ignore-add-row" onSubmit={handleAddInput}>
            <input
              type="text"
              className="text-input text-input-sm"
              placeholder="단어 입력 또는 문장 붙여넣기"
              value={newIgnoreInput}
              onChange={(e) => setNewIgnoreInput(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm"
              disabled={!newIgnoreInput.trim()}
            >
              Add
            </button>
          </form>

          <div
            className="extra-ignore-list"
            role="listbox"
            aria-label="Extra Ignore Words"
          >
            {store.extraIgnoreWords.length === 0 ? (
              <div className="empty-hint-box">
                <span>
                  본문 단어를 우클릭하거나 텍스트를 붙여넣으면 기존 레벨에 없는
                  미등재 단어만 자동 추출됩니다.
                </span>
              </div>
            ) : (
              store.extraIgnoreWords.map((w) => {
                const sel = selectedExtras.includes(w);
                return (
                  <div
                    key={w}
                    role="option"
                    aria-selected={sel}
                    className="extra-ignore-item"
                    data-selected={sel}
                    onClick={() => toggleExtraSelection(w)}
                  >
                    <span>{w}</span>
                    <button
                      type="button"
                      className="mini-icon-btn"
                      title={`${w} 삭제`}
                      aria-label={`${w} 삭제`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedExtras((p) => p.filter((x) => x !== w));
                        void store.removeExtraIgnoreWords([w]);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="extra-ignore-footer">
            <button
              type="button"
              className="btn btn-sm ai-flex-btn"
              disabled={selectedExtras.length === 0}
              onClick={() => {
                const toRemove = [...selectedExtras];
                setSelectedExtras([]);
                void store.removeExtraIgnoreWords(toRemove);
              }}
            >
              Clear Selected
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={store.extraIgnoreWords.length === 0}
              onClick={() => {
                setSelectedExtras([]);
                void store.clearAllExtraIgnoreWords();
              }}
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};

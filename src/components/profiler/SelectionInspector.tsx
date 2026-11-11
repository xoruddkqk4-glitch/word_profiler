import React, { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';

export const SelectionInspector: React.FC = () => {
  const store = useProfilerStore();
  const [newIgnoreInput, setNewIgnoreInput] = useState('');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  const profile = store.activeProfile;
  const wordKey = store.selectedWordKey;
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
    wordKey && (!wordStats || wordStats.kind === 'out'),
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
      {/* Selection Inspector */}
      <div className="inspector-block">
        <h3 className="section-title">Selection Inspector</h3>

        <div className="inspector-kv-list">
          <span className="inspector-k">Selection:</span>
          <span className="inspector-v">
            {store.selectedRawToken || '단어를 클릭하세요'}
          </span>

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
        </div>

        <button
          type="button"
          className="btn btn-sm"
          style={{ width: '100%' }}
          disabled={!canAddSelectedToIgnore}
          onClick={() => {
            if (wordKey) void store.addExtraIgnoreWord(wordKey);
          }}
        >
          <Plus size={15} /> Add to Ignore List
        </button>
      </div>

      {/* Extra Ignore Words */}
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
        <div className="section-header" style={{ marginBottom: 0 }}>
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
                본문 단어를 우클릭하거나 텍스트를 붙여넣으면 기존 레벨에 없는 미등재 단어만 자동 추출됩니다.
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
            className="btn btn-sm"
            style={{ flex: 1 }}
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
    </aside>
  );
};


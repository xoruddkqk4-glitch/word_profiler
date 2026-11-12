import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';

export const AiSuggestionModal: React.FC = () => {
  const store = useProfilerStore();
  const open = store.aiSuggestionModalOpen;
  const result = store.combinedSuggestionResult;
  const profile = store.activeProfile;
  const span = store.selectedTokenSpan;

  const activeRefs = useMemo(
    () => store.referenceLists.filter((r) => r.enabled),
    [store.referenceLists],
  );

  const refColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of store.referenceLists) {
      map.set(r.id, store.theme === 'dark' ? r.colorDark : r.colorLight);
    }
    return map;
  }, [store.referenceLists, store.theme]);

  const singleTokenLookupKey =
    result && profile && result.spanStartIdx === result.spanEndIdx
      ? profile.tokens[result.spanStartIdx]?.lookupKey ?? null
      : null;
  const sameWordOccurrenceCount =
    singleTokenLookupKey && profile
      ? profile.tokenFreqByKey[singleTokenLookupKey]?.count ?? 1
      : 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeAiSuggestionModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, store]);

  if (!open) return null;

  const targetLabel = result?.targetText ?? span?.rawText ?? '선택 단어';

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.closeAiSuggestionModal();
      }}
    >
      <div
        className="modal-card ai-suggestion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-suggestion-modal-title"
      >
        <div className="modal-header">
          <h2 id="ai-suggestion-modal-title" className="modal-title">
            <Sparkles size={18} /> AI 어휘 추천 — &ldquo;{targetLabel}&rdquo;
          </h2>
          <div className="ai-modal-header-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={store.aiLoading}
              title="다시 추천"
              onClick={() => void store.openAiSuggestionModal()}
            >
              <RefreshCw size={14} /> 다시 추천
            </button>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="닫기"
              onClick={store.closeAiSuggestionModal}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="ai-modal-body">
          <div className="ai-modal-context">
            <p className="ai-modal-sentence">
              {result?.enclosingSentence ??
                '선택한 단어가 들어 있는 문장을 분석합니다.'}
            </p>
            <div className="ai-level-cap-note">
              검증 기준: 왼쪽 Reference Lists의 활성 단어장 전체 (
              {activeRefs.length > 0
                ? activeRefs.map((r) => r.name).join(', ')
                : '활성 단어장 없음'}
              )
            </div>
          </div>

          {store.aiError && (
            <div className="ai-alert-box" role="alert">
              <XCircle size={15} />
              <div className="ai-alert-text">
                <span>{store.aiError}</span>
                <button
                  type="button"
                  className="ai-inline-link"
                  onClick={() => store.setSettingsModalOpen(true, 'ai')}
                >
                  AI 설정 열기
                </button>
              </div>
            </div>
          )}

          {store.aiLoading ? (
            <div className="ai-modal-loading">
              <Loader2 size={24} className="ai-spin" />
              <span>
                추천 단어와 패러프레이즈 문장을 함께 만들고 Word List와 대조하는
                중…
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={store.cancelAiRequest}
              >
                취소
              </button>
            </div>
          ) : result ? (
            <div className="ai-modal-columns">
              <section className="ai-modal-column">
                <div className="ai-modal-column-head">
                  <h3>
                    <ArrowRightLeft size={16} /> 추천 단어
                  </h3>
                  <span className="count-badge tabular-nums">
                    {result.synonymCandidates.length}/3
                  </span>
                </div>
                {result.synonymCandidates.length === 0 ? (
                  <div className="empty-hint-box">
                    <span>
                      활성 Word List 안에서 이 자리에 바로 넣을 수 있는 단어를
                      찾지 못했습니다. 왼쪽에서 단어장을 추가해 보세요.
                    </span>
                  </div>
                ) : (
                  result.synonymCandidates.map((cand) => {
                    const swatch = cand.primaryListId
                      ? refColorMap.get(cand.primaryListId)
                      : undefined;
                    return (
                      <div
                        key={cand.replacementText}
                        className="ai-result-card"
                      >
                        <div className="ai-card-top">
                          <div className="ai-word-group">
                            <span className="ai-candidate-word">
                              {cand.replacementText}
                            </span>
                            {cand.baseForm.toLowerCase() !==
                              cand.replacementText.toLowerCase() && (
                              <span className="ai-relation-tag">
                                원형: {cand.baseForm}
                              </span>
                            )}
                          </div>
                          <span className="ai-level-badge" data-in-cap="true">
                            {swatch && (
                              <span
                                className="ai-swatch-dot"
                                style={{ backgroundColor: swatch }}
                              />
                            )}
                            {cand.highestLevelNumber !== null
                              ? `L${cand.highestLevelNumber} · ${cand.primaryListName}`
                              : cand.primaryListName}
                          </span>
                        </div>
                        {(cand.meaningKo || cand.nuanceKo) && (
                          <p className="ai-card-note">
                            {cand.meaningKo && <strong>{cand.meaningKo}</strong>}
                            {cand.meaningKo && cand.nuanceKo ? ' — ' : ''}
                            {cand.nuanceKo}
                          </p>
                        )}
                        <div className="ai-preview-box">
                          {cand.previewSentence}
                        </div>
                        <div className="ai-card-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              void store.applyTokenSpanReplacement(
                                result.spanStartIdx,
                                result.spanEndIdx,
                                cand.replacementText,
                              )
                            }
                          >
                            이 위치 교체
                          </button>
                          {singleTokenLookupKey &&
                            sameWordOccurrenceCount > 1 && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  void store.replaceAllMatchingWordTokens(
                                    singleTokenLookupKey,
                                    cand.replacementText,
                                  )
                                }
                              >
                                전체 교체 ({sameWordOccurrenceCount})
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })
                )}
              </section>

              <section className="ai-modal-column">
                <div className="ai-modal-column-head">
                  <h3>
                    <Wand2 size={16} /> 패러프레이즈 문장
                  </h3>
                  <span className="count-badge tabular-nums">
                    {result.paraphraseCandidates.length}/3
                  </span>
                </div>
                {result.paraphraseCandidates.length === 0 ? (
                  <div className="empty-hint-box">
                    <span>
                      활성 Word List 단어만으로 된 문장을 만들지 못했습니다.
                      왼쪽에서 단어장을 추가하거나 다시 추천을 눌러 보세요.
                    </span>
                  </div>
                ) : (
                  result.paraphraseCandidates.map((cand, idx) => (
                    <div
                      key={`${idx}-${cand.styleLabelKo}`}
                      className="ai-result-card"
                    >
                      <div className="ai-card-top">
                        <span className="ai-style-title">
                          {cand.styleLabelKo}
                        </span>
                        <span className="ai-level-badge" data-in-cap="true">
                          <CheckCircle2 size={13} /> 100% 리스트 내
                        </span>
                      </div>
                      <div className="ai-preview-box ai-paraphrase-preview">
                        {cand.leadingWs}
                        {cand.tokens.map((t, tIdx) => {
                          const swatch = t.listId
                            ? refColorMap.get(t.listId)
                            : undefined;
                          return (
                            <React.Fragment key={tIdx}>
                              <span
                                className="ai-mini-tok"
                                style={swatch ? { color: swatch } : undefined}
                              >
                                {t.token}
                              </span>
                              {t.trailingWs}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      {cand.noteKo && (
                        <p className="ai-card-note">{cand.noteKo}</p>
                      )}
                      <div className="ai-card-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            void store.applyTokenSpanReplacement(
                              result.paraphraseSpanStartIdx,
                              result.paraphraseSpanEndIdx,
                              cand.rewrittenText,
                            )
                          }
                        >
                          문장 교체
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon btn-sm"
                          title="복사"
                          aria-label="복사"
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              cand.rewrittenText,
                            )
                          }
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          ) : (
            !store.aiError && (
              <div className="empty-hint-box">
                <span>추천 결과가 없습니다.</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

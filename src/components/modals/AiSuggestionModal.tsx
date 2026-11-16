import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  GripHorizontal,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import { copyTextSafe } from '../../io/docExporters';
import { useProfilerStore } from '../../store/useProfilerStore';

interface ModalDragState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  centeredLeft: number;
  centeredTop: number;
  width: number;
}

function clampDragCoordinate(value: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.min(Math.max(value, lo), hi);
}

export const AiSuggestionModal: React.FC = () => {
  const store = useProfilerStore();
  const open = store.aiSuggestionModalOpen;
  const result = store.combinedSuggestionResult;
  const profile = store.activeProfile;
  const span = store.selectedTokenSpan;

  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ModalDragState | null>(null);

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
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeAiSuggestionModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, store]);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) {
      return;
    }
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
      centeredLeft: rect.left - offset.x,
      centeredTop: rect.top - offset.y,
      width: rect.width,
    };
    setIsDragging(true);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const rawX = state.origX + (e.clientX - state.startX);
    const rawY = state.origY + (e.clientY - state.startY);
    const minX = 180 - state.width - state.centeredLeft;
    const maxX = window.innerWidth - 180 - state.centeredLeft;
    const minY = 8 - state.centeredTop;
    const maxY = window.innerHeight - 64 - state.centeredTop;
    setOffset({
      x: clampDragCoordinate(rawX, minX, maxX),
      y: clampDragCoordinate(rawY, minY, maxY),
    });
  };

  const handleHeaderPointerUpOrCancel = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) {
      return;
    }
    setOffset({ x: 0, y: 0 });
  };

  if (!open) return null;

  const targetLabel = result?.targetText ?? span?.rawText ?? '선택 단어';

  const renderSynonymCard = (
    cand: NonNullable<typeof result>['synonymCandidates'][number],
    idx: number,
  ) => {
    const swatch = cand.primaryListId
      ? refColorMap.get(cand.primaryListId)
      : undefined;
    return (
      <div key={`syn-${idx}-${cand.replacementText}`} className="ai-result-card">
        <div className="ai-card-top">
          <div className="ai-word-group">
            <span className="ai-row-index tabular-nums">{idx + 1}</span>
            <span className="ai-candidate-word">{cand.replacementText}</span>
            {cand.baseForm.toLowerCase() !==
              cand.replacementText.toLowerCase() && (
              <span className="ai-relation-tag">원형: {cand.baseForm}</span>
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
        <p className="ai-card-note">
          {cand.meaningKo || cand.nuanceKo ? (
            <>
              {cand.meaningKo && <strong>{cand.meaningKo}</strong>}
              {cand.meaningKo && cand.nuanceKo ? ' — ' : ''}
              {cand.nuanceKo}
            </>
          ) : (
            '문맥 대체 어휘'
          )}
        </p>
        <div className="ai-preview-box">{cand.previewSentence}</div>
        <div className="ai-card-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              void store.applyTokenSpanReplacement(
                result!.spanStartIdx,
                result!.spanEndIdx,
                cand.replacementText,
              )
            }
          >
            이 위치 교체
          </button>
          {singleTokenLookupKey && sameWordOccurrenceCount > 1 && (
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
  };

  const renderParaphraseCard = (
    cand: NonNullable<typeof result>['paraphraseCandidates'][number],
    idx: number,
  ) => (
    <div key={`para-${idx}-${cand.styleLabelKo}`} className="ai-result-card">
      <div className="ai-card-top">
        <div className="ai-word-group">
          <span className="ai-row-index tabular-nums">{idx + 1}</span>
          <span className="ai-style-title">{cand.styleLabelKo}</span>
        </div>
        {cand.outWordCount === 0 ? (
          <span className="ai-level-badge" data-in-cap="true">
            <CheckCircle2 size={13} /> 100% 리스트 내
          </span>
        ) : (
          <span
            className="ai-level-badge"
            data-partial-cap="true"
            title={
              cand.remainingOutWords.length > 0
                ? `리스트 외 단어: ${cand.remainingOutWords.join(', ')}`
                : undefined
            }
          >
            <AlertCircle size={13} /> {Math.round(cand.inTargetPercentage)}%
            리스트 내 · 리스트 외 {cand.outWordCount}단어
          </span>
        )}
      </div>
      <p className="ai-card-note">
        {cand.noteKo || '문맥의 핵심 의미를 유지하며 재구성한 문장입니다.'}
      </p>
      <div className="ai-preview-box ai-paraphrase-preview">
        {cand.leadingWs}
        {cand.tokens.map((t, tIdx) => {
          const swatch = t.listId ? refColorMap.get(t.listId) : undefined;
          return (
            <React.Fragment key={tIdx}>
              <span
                className={
                  t.withinCap ? 'ai-mini-tok' : 'ai-mini-tok ai-mini-tok-out'
                }
                style={swatch ? { color: swatch } : undefined}
                title={!t.withinCap ? '활성 Word List 외 단어' : undefined}
              >
                {t.token}
              </span>
              {t.trailingWs}
            </React.Fragment>
          );
        })}
      </div>
      <div className="ai-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            void store.applyTokenSpanReplacement(
              result!.paraphraseSpanStartIdx,
              result!.paraphraseSpanEndIdx,
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
          onClick={() => void copyTextSafe(cand.rewrittenText)}
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.closeAiSuggestionModal();
      }}
    >
      <div
        ref={cardRef}
        className="modal-card ai-suggestion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-suggestion-modal-title"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        }}
      >
        <div
          className="modal-header ai-modal-drag-header"
          data-dragging={isDragging ? 'true' : 'false'}
          title="드래그하여 창 위치 이동 (더블클릭 시 중앙 복귀)"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUpOrCancel}
          onPointerCancel={handleHeaderPointerUpOrCancel}
          onDoubleClick={handleHeaderDoubleClick}
        >
          <h2 id="ai-suggestion-modal-title" className="modal-title">
            <GripHorizontal
              size={16}
              className="ai-modal-drag-grip"
              aria-hidden="true"
            />
            <Sparkles size={18} /> AI 어휘 추천 — &ldquo;{targetLabel}&rdquo;
          </h2>
          <div className="ai-modal-header-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={store.aiLoading}
              title="다시 추천"
              onClick={() =>
                void store.openAiSuggestionModal({ forceRefresh: true })
              }
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
            <div className="ai-modal-matrix">
              <div className="ai-matrix-head-row">
                <div className="ai-modal-column-head">
                  <h3>
                    <ArrowRightLeft size={16} /> 추천 단어
                  </h3>
                  <span className="count-badge tabular-nums">
                    {result.synonymCandidates.length}/3
                  </span>
                </div>
                <div className="ai-modal-column-head">
                  <h3>
                    <Wand2 size={16} /> 패러프레이즈 문장
                  </h3>
                  <span className="count-badge tabular-nums">
                    {result.paraphraseCandidates.length}/3
                  </span>
                </div>
              </div>

              {result.synonymCandidates.length === 0 ? (
                <div className="ai-matrix-fallback-cols">
                  <div className="empty-hint-box">
                    <span>
                      활성 Word List 안에서 이 자리에 바로 넣을 수 있는 단어를
                      찾지 못했습니다. 왼쪽에서 단어장을 추가해 보세요.
                    </span>
                  </div>
                  <div className="ai-modal-column">
                    {result.paraphraseCandidates.map((cand, idx) =>
                      renderParaphraseCard(cand, idx),
                    )}
                  </div>
                </div>
              ) : (
                Array.from({
                  length: Math.max(
                    result.synonymCandidates.length,
                    result.paraphraseCandidates.length,
                  ),
                }).map((_, idx) => {
                  const syn = result.synonymCandidates[idx];
                  const para = result.paraphraseCandidates[idx];
                  return (
                    <div key={idx} className="ai-matrix-pair-row">
                      {syn ? (
                        renderSynonymCard(syn, idx)
                      ) : (
                        <div className="ai-empty-slot" aria-hidden="true">
                          추가 추천 단어 없음
                        </div>
                      )}
                      {para ? (
                        renderParaphraseCard(para, idx)
                      ) : (
                        <div className="ai-empty-slot" aria-hidden="true">
                          추가 패러프레이즈 없음
                        </div>
                      )}
                    </div>
                  );
                })
              )}
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

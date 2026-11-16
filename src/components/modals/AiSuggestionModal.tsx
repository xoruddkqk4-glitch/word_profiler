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
import {
  extractEnclosingSentenceSpan,
  splitSentenceAroundSpan,
} from '../../ai/lexiconVerifier';
import { copyTextSafe } from '../../io/docExporters';
import { useProfilerStore } from '../../store/useProfilerStore';
import {
  getActiveAiModelId,
  getActiveAiProvider,
  type AiSuggestionTrackFilter,
  type VerifiedParaphraseCandidate,
  type VerifiedSynonymCandidate,
} from '../../types/ai';

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
  const [elapsedTenths, setElapsedTenths] = useState(0);
  const [trackFilter, setTrackFilter] =
    useState<AiSuggestionTrackFilter>('all');
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ModalDragState | null>(null);

  const previewEnclosingSentence = useMemo(() => {
    if (result?.enclosingSentence) return result.enclosingSentence;
    if (profile && span) {
      return (
        extractEnclosingSentenceSpan(
          profile,
          span.startTokenIdx,
          span.endTokenIdx,
        ).sentenceWithPunct || '선택한 단어가 들어 있는 문장을 분석합니다.'
      );
    }
    return '선택한 단어가 들어 있는 문장을 분석합니다.';
  }, [profile, result?.enclosingSentence, span]);

  const canMapResultToProfile = Boolean(
    result &&
      profile &&
      profile.sourceId === result.sourceId &&
      profile.originalText === result.sourceOriginalText,
  );

  const highlightedContextParts = useMemo(() => {
    if (canMapResultToProfile && profile && result) {
      return splitSentenceAroundSpan(
        profile,
        result.spanStartIdx,
        result.spanEndIdx,
      );
    }
    if (!result && profile && span) {
      return splitSentenceAroundSpan(
        profile,
        span.startTokenIdx,
        span.endTokenIdx,
      );
    }
    return null;
  }, [canMapResultToProfile, profile, result, span]);

  const activeProviderLabel =
    getActiveAiProvider(store.openRouterConfig) === 'gemini'
      ? 'Gemini'
      : 'OpenRouter';
  const activeModelLabel = getActiveAiModelId(store.openRouterConfig);

  useEffect(() => {
    if (!open || !store.aiLoading) {
      setElapsedTenths(0);
      return;
    }
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setElapsedTenths(Math.floor((performance.now() - startedAt) / 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [open, store.aiLoading]);

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
    setTrackFilter('all');
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
    cand: VerifiedSynonymCandidate,
    idx: number,
    keyPrefix: string,
  ) => {
    const swatch = cand.primaryListId
      ? refColorMap.get(cand.primaryListId)
      : undefined;
    return (
      <div
        key={`${keyPrefix}-syn-${idx}-${cand.replacementText}`}
        className="ai-result-card"
      >
        <div className="ai-card-top">
          <div className="ai-word-group">
            <span className="ai-row-index tabular-nums">{idx + 1}</span>
            <span className="ai-candidate-word">{cand.replacementText}</span>
            {cand.baseForm.toLowerCase() !==
              cand.replacementText.toLowerCase() && (
              <span className="ai-relation-tag">원형: {cand.baseForm}</span>
            )}
          </div>
          {cand.allTokensWithinCap ? (
            <span className="ai-level-badge" data-in-cap="true">
              {swatch && (
                <span
                  className="ai-swatch-dot"
                  style={{ backgroundColor: swatch }}
                />
              )}
              {cand.highestLevelNumber !== null
                ? `L${cand.highestLevelNumber} · ${cand.primaryListName}`
                : cand.primaryListName === 'ignore_list'
                  ? 'Ignored (예외 허용)'
                  : cand.primaryListName}
            </span>
          ) : (
            <span
              className="ai-level-badge"
              data-out="true"
              title={
                cand.outTokens.length > 0
                  ? `활성 Word List 미등재: ${cand.outTokens.join(', ')}`
                  : undefined
              }
            >
              {cand.isMultiWord && cand.highestLevelNumber !== null
                ? `부분 미등재 (${cand.outTokens.length}단어 Out)`
                : '리스트 외 (Out)'}
            </span>
          )}
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
        <div className="ai-preview-box">
          {(() => {
            const parts =
              canMapResultToProfile && profile && result
                ? splitSentenceAroundSpan(
                    profile,
                    result.spanStartIdx,
                    result.spanEndIdx,
                    cand.replacementText,
                  )
                : (() => {
                    const m = cand.previewSentence.match(
                      /^([\s\S]*?)\[([^\]]+)\]([\s\S]*)$/,
                    );
                    return m
                      ? { before: m[1], focus: m[2], after: m[3] }
                      : null;
                  })();
            return parts && parts.focus ? (
              <>
                {parts.before}
                <mark className="ai-highlight-mark">{parts.focus}</mark>
                {parts.after}
              </>
            ) : (
              cand.previewSentence
            );
          })()}
        </div>
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
    cand: VerifiedParaphraseCandidate,
    idx: number,
    keyPrefix: string,
  ) => (
    <div
      key={`${keyPrefix}-para-${idx}-${cand.styleLabelKo}`}
      className="ai-result-card"
    >
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

  const renderTrackSection = (options: {
    trackKey: 'in_list' | 'free';
    badgeText: string;
    title: string;
    subtitle: string;
    wordHeading: string;
    paraHeading: string;
    synonyms: VerifiedSynonymCandidate[];
    paraphrases: VerifiedParaphraseCandidate[];
    emptyWordHint: string;
    emptyParaHint: string;
  }) => {
    const rowCount = Math.max(
      1,
      options.synonyms.length,
      options.paraphrases.length,
    );
    return (
      <section className="ai-track-section" data-track={options.trackKey}>
        <div className="ai-track-banner">
          <div className="ai-track-banner-left">
            <span className="ai-track-pill" data-track={options.trackKey}>
              {options.badgeText}
            </span>
            <h3 className="ai-track-title">{options.title}</h3>
          </div>
          <span className="ai-track-sub">{options.subtitle}</span>
        </div>

        <div className="ai-modal-matrix">
          <div className="ai-matrix-head-row">
            <div className="ai-modal-column-head">
              <h4>
                <ArrowRightLeft size={16} /> {options.wordHeading}
              </h4>
              <span className="count-badge tabular-nums">
                {options.synonyms.length}/3
              </span>
            </div>
            <div className="ai-modal-column-head">
              <h4>
                <Wand2 size={16} /> {options.paraHeading}
              </h4>
              <span className="count-badge tabular-nums">
                {options.paraphrases.length}/3
              </span>
            </div>
          </div>

          {Array.from({ length: rowCount }).map((_, idx) => {
            const syn = options.synonyms[idx];
            const para = options.paraphrases[idx];
            return (
              <div key={`${options.trackKey}-${idx}`} className="ai-matrix-pair-row">
                {syn ? (
                  renderSynonymCard(syn, idx, options.trackKey)
                ) : (
                  <div className="ai-empty-slot">
                    {idx === 0 && options.synonyms.length === 0
                      ? options.emptyWordHint
                      : '추가 추천 단어 없음'}
                  </div>
                )}
                {para ? (
                  renderParaphraseCard(para, idx, options.trackKey)
                ) : (
                  <div className="ai-empty-slot">
                    {idx === 0 && options.paraphrases.length === 0
                      ? options.emptyParaHint
                      : '추가 패러프레이즈 없음'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

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
              {highlightedContextParts && highlightedContextParts.focus ? (
                <>
                  {highlightedContextParts.before}
                  <mark className="ai-highlight-mark">
                    {highlightedContextParts.focus}
                  </mark>
                  {highlightedContextParts.after}
                </>
              ) : (
                previewEnclosingSentence
              )}
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
            <div className="ai-loading-stage" role="status" aria-live="polite">
              <div className="ai-loading-hero">
                <div className="ai-loading-head">
                  <div className="ai-loading-status-left">
                    <Loader2 size={28} className="ai-spin" />
                    <div className="ai-loading-titles">
                      <div className="ai-loading-badges">
                        <span className="ai-live-badge">
                          <span className="ai-live-dot" aria-hidden="true" />
                          실시간 생성 중
                        </span>
                        <span className="ai-loading-model-tag">
                          {activeProviderLabel} ·{' '}
                          <span className="mono">{activeModelLabel}</span>
                        </span>
                        <span className="ai-elapsed-pill tabular-nums">
                          {(elapsedTenths / 10).toFixed(1)}초
                        </span>
                      </div>
                      <span className="ai-loading-desc">
                        Word List 내·외 추천 단어(3+3)와 패러프레이즈 문장(3+3)을
                        생성하고 활성 Word List와 대조하고 있습니다…
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={store.cancelAiRequest}
                  >
                    취소
                  </button>
                </div>

                <div className="ai-loading-bar-track" aria-hidden="true">
                  <div className="ai-loading-bar-fill" />
                </div>

                <div className="ai-loading-steps">
                  <span className="ai-loading-step" data-state="done">
                    1. 문맥 문장 추출 완료
                  </span>
                  <span className="ai-loading-step" data-state="active">
                    2. AI 추천 어휘·패러프레이즈 생성 중
                  </span>
                  <span className="ai-loading-step" data-state="pending">
                    3. 활성 Word List 로컬 대조 검증
                  </span>
                </div>
              </div>

              <div className="ai-loading-skeleton-grid" aria-hidden="true">
                <div className="ai-matrix-head-row">
                  <div className="ai-modal-column-head">
                    <h3>
                      <ArrowRightLeft size={16} /> 추천 단어
                    </h3>
                    <span className="count-badge">준비 중</span>
                  </div>
                  <div className="ai-modal-column-head">
                    <h3>
                      <Wand2 size={16} /> 패러프레이즈 문장
                    </h3>
                    <span className="count-badge">준비 중</span>
                  </div>
                </div>

                {[0, 1].map((row) => (
                  <div key={row} className="ai-matrix-pair-row">
                    <div className="ai-skeleton-card">
                      <div className="ai-skeleton-box ai-skeleton-line ai-skeleton-title" />
                      <div className="ai-skeleton-box ai-skeleton-line ai-skeleton-sub" />
                      <div className="ai-skeleton-box ai-skeleton-preview" />
                    </div>
                    <div className="ai-skeleton-card">
                      <div className="ai-skeleton-box ai-skeleton-line ai-skeleton-title" />
                      <div className="ai-skeleton-box ai-skeleton-line ai-skeleton-sub" />
                      <div className="ai-skeleton-box ai-skeleton-preview" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : result ? (
            <>
              <div className="ai-track-filter-bar">
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="추천 트랙 보기 필터"
                >
                  <button
                    type="button"
                    className="segmented-btn"
                    data-active={trackFilter === 'all'}
                    onClick={() => setTrackFilter('all')}
                  >
                    전체 보기 (단어{' '}
                    {result.inListSynonymCandidates.length +
                      result.freeSynonymCandidates.length}{' '}
                    · 문장{' '}
                    {result.inListParaphraseCandidates.length +
                      result.freeParaphraseCandidates.length}
                    )
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    data-active={trackFilter === 'in_list'}
                    onClick={() => setTrackFilter('in_list')}
                  >
                    Word List 내 ({result.inListSynonymCandidates.length} +{' '}
                    {result.inListParaphraseCandidates.length})
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    data-active={trackFilter === 'free'}
                    onClick={() => setTrackFilter('free')}
                  >
                    Word List 외 확장 ({result.freeSynonymCandidates.length} +{' '}
                    {result.freeParaphraseCandidates.length})
                  </button>
                </div>
              </div>

              <div className="ai-modal-tracks">
                {(trackFilter === 'all' || trackFilter === 'in_list') &&
                  renderTrackSection({
                    trackKey: 'in_list',
                    badgeText: 'Word List 내',
                    title: '활성 단어장 범위 추천',
                    subtitle:
                      '왼쪽 활성 Word List 어휘만으로 검증된 대체 단어와 패러프레이즈입니다.',
                    wordHeading: 'Word List 내 추천 단어',
                    paraHeading: 'Word List 내 패러프레이즈',
                    synonyms: result.inListSynonymCandidates,
                    paraphrases: result.inListParaphraseCandidates,
                    emptyWordHint:
                      '활성 Word List 안에서 이 자리에 바로 넣을 수 있는 단어를 찾지 못했습니다.',
                    emptyParaHint:
                      '활성 Word List 내 패러프레이즈를 생성하지 못했습니다.',
                  })}

                {(trackFilter === 'all' || trackFilter === 'free') &&
                  renderTrackSection({
                    trackKey: 'free',
                    badgeText: 'Word List 외 허용',
                    title: '자유·확장 대체 추천',
                    subtitle:
                      'Word List 밖의 어휘도 허용하여 문맥상 자연스럽고 풍부하게 표현한 대안입니다.',
                    wordHeading: '리스트 외 대체 가능 단어',
                    paraHeading: '리스트 외 포함 패러프레이즈',
                    synonyms: result.freeSynonymCandidates,
                    paraphrases: result.freeParaphraseCandidates,
                    emptyWordHint:
                      '중복 없이 추가 제안할 자유 대체 단어가 없습니다.',
                    emptyParaHint:
                      '중복 없이 추가 제안할 확장 패러프레이즈 문장이 없습니다.',
                  })}
              </div>
            </>
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

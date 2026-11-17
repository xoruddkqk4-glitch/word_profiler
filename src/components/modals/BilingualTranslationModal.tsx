import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  GripHorizontal,
  Languages,
  Loader2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  assembleKoreanFullTextFromPairs,
  extractSavedTranslationFromPassage,
  formatPassageWithSavedTranslation,
  segmentEnglishSentences,
} from '../../core/sentenceSegmenter';
import { copyTextSafe } from '../../io/docExporters';
import {
  getPassageTranslationSlotKey,
  resolveActivePassageContext,
  useProfilerStore,
} from '../../store/useProfilerStore';
import {
  getActiveAiModelId,
  getActiveAiProvider,
  type BilingualSentencePair,
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

function summarizeSnippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine;
}

export const BilingualTranslationModal: React.FC = () => {
  const store = useProfilerStore();
  const open = store.bilingualModalOpen;

  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'continuous' | 'aligned'>(
    'continuous',
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(store.translationPrompt);
  const [isEditingKo, setIsEditingKo] = useState(false);
  const [draftPairs, setDraftPairs] = useState<BilingualSentencePair[]>([]);
  const [elapsedTenths, setElapsedTenths] = useState(0);
  const [copiedTag, setCopiedTag] = useState<
    'en' | 'ko' | 'pair' | 'both' | null
  >(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ModalDragState | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const enSentRefs = useRef<Record<number, HTMLElement | null>>({});
  const koSentRefs = useRef<Record<number, HTMLElement | null>>({});

  const passageCtx = useMemo(
    () =>
      resolveActivePassageContext({
        activeTargetFileId: store.activeTargetFileId,
        targetFiles: store.targetFiles,
        filePassageIndices: store.filePassageIndices,
        inlineText: store.inlineText,
        inlinePassageIndex: store.inlinePassageIndex,
      }),
    [
      store.activeTargetFileId,
      store.targetFiles,
      store.filePassageIndices,
      store.inlineText,
      store.inlinePassageIndex,
    ],
  );

  const currentEnglish = useMemo(
    () =>
      extractSavedTranslationFromPassage(passageCtx.activePassage.content)
        .englishContent,
    [passageCtx.activePassage.content],
  );

  const slotKey = getPassageTranslationSlotKey(
    passageCtx.activeFile?.id ?? null,
    passageCtx.activePassageIndex,
  );
  const savedTranslation = store.savedTranslations[slotKey] ?? null;

  const fallbackSegments = useMemo(
    () => segmentEnglishSentences(currentEnglish),
    [currentEnglish],
  );

  const displayPairs: BilingualSentencePair[] = useMemo(() => {
    if (savedTranslation && savedTranslation.pairs.length > 0) {
      return savedTranslation.pairs;
    }
    return fallbackSegments.map((s) => ({
      index: s.index,
      en: s.en,
      ko: '',
      paragraphIndex: s.paragraphIndex,
    }));
  }, [fallbackSegments, savedTranslation]);

  const paragraphGroups = useMemo(() => {
    const groups: { paragraphIndex: number; pairs: BilingualSentencePair[] }[] =
      [];
    for (const pair of displayPairs) {
      const last = groups[groups.length - 1];
      if (!last || last.paragraphIndex !== pair.paragraphIndex) {
        groups.push({
          paragraphIndex: pair.paragraphIndex,
          pairs: [pair],
        });
      } else {
        last.pairs.push(pair);
      }
    }
    return groups;
  }, [displayPairs]);

  const englishChangedSinceSave = Boolean(
    savedTranslation &&
      savedTranslation.sourceEnglishText.trim() !== currentEnglish.trim(),
  );

  const activeProviderLabel =
    getActiveAiProvider(store.openRouterConfig) === 'gemini'
      ? 'Gemini'
      : 'OpenRouter';
  const activeModelLabel = getActiveAiModelId(store.openRouterConfig);

  useEffect(() => {
    setDraftPrompt(store.translationPrompt);
  }, [store.translationPrompt]);

  useEffect(() => {
    setSelectedIdx(null);
    setIsEditingKo(false);
    setDraftPairs([]);
  }, [slotKey]);

  useEffect(() => {
    if (!open || !store.bilingualLoading) {
      setElapsedTenths(0);
      return;
    }
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setElapsedTenths(Math.floor((performance.now() - startedAt) / 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [open, store.bilingualLoading]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        store.closeBilingualModal();
        return;
      }

      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.tagName === 'TEXTAREA' ||
            target.tagName === 'INPUT' ||
            target.tagName === 'SELECT'),
      );
      if (inEditable || displayPairs.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => {
          const next =
            prev === null ? 0 : Math.min(displayPairs.length - 1, prev + 1);
          enSentRefs.current[next]?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
          koSentRefs.current[next]?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => {
          const next =
            prev === null
              ? displayPairs.length - 1
              : Math.max(0, prev - 1);
          enSentRefs.current[next]?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
          koSentRefs.current[next]?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [displayPairs.length, open, store]);

  if (!open) return null;

  const triggerCopyFeedback = (tag: 'en' | 'ko' | 'pair' | 'both') => {
    setCopiedTag(tag);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedTag(null);
      copyTimerRef.current = null;
    }, 1400);
  };

  const handleSelectFromSide = (idx: number, originSide: 'en' | 'ko') => {
    const nextIdx = selectedIdx === idx ? null : idx;
    setSelectedIdx(nextIdx);
    if (nextIdx !== null) {
      const targetEl =
        originSide === 'en'
          ? koSentRefs.current[nextIdx]
          : enSentRefs.current[nextIdx];
      targetEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const handleStepSentence = (delta: -1 | 1) => {
    if (displayPairs.length === 0) return;
    const nextIdx =
      selectedIdx === null
        ? delta > 0
          ? 0
          : displayPairs.length - 1
        : Math.max(0, Math.min(displayPairs.length - 1, selectedIdx + delta));
    setSelectedIdx(nextIdx);
    enSentRefs.current[nextIdx]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
    koSentRefs.current[nextIdx]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  };

  const handleRetranslate = async (overridePrompt?: string) => {
    const promptToPersist = overridePrompt ?? draftPrompt;
    if (promptToPersist.trim() && promptToPersist !== store.translationPrompt) {
      store.updateTranslationPrompt(promptToPersist);
    }
    setIsEditingKo(false);
    setSelectedIdx(null);
    await store.openBilingualModal({ forceRetranslate: true });
  };

  const handleSwitchPassage = async (targetIndex: number) => {
    if (store.bilingualLoading) return;
    await store.setActivePassageIndex(targetIndex);
    await store.openBilingualModal();
  };

  const handleStartEditKo = () => {
    setDraftPairs(displayPairs.map((p) => ({ ...p })));
    setIsEditingKo(true);
  };

  const handleSaveEditedKo = () => {
    store.saveEditedBilingualPairs(draftPairs);
    setIsEditingKo(false);
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest('button, a, input, select, textarea')
    ) {
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
    if (
      (e.target as HTMLElement).closest('button, a, input, select, textarea')
    ) {
      return;
    }
    setOffset({ x: 0, y: 0 });
  };

  const koreanTextForCopy = savedTranslation
    ? savedTranslation.koreanFullText ||
      assembleKoreanFullTextFromPairs(displayPairs)
    : '';

  const selectedPair =
    selectedIdx !== null ? displayPairs[selectedIdx] ?? null : null;

  const isPromptModifiedFromStore = draftPrompt !== store.translationPrompt;
  const activePairsForRender = isEditingKo ? draftPairs : displayPairs;
  const hasPartialKo = Boolean(
    savedTranslation &&
      savedTranslation.pairs.some((p) => p.ko.trim().length > 0),
  );
  const showFullLoadingRight = store.bilingualLoading && !hasPartialKo;
  const showProgressiveBanner = store.bilingualLoading && hasPartialKo;

  const progressiveBannerNode = showProgressiveBanner ? (
    <div className="bilingual-live-strip" role="status" aria-live="polite">
      <span className="ai-live-badge">
        <span className="ai-live-dot" aria-hidden="true" />
        실시간 병렬 해석 중 ·{' '}
        <span className="tabular-nums">
          {store.bilingualProgress?.done ?? 0}/
          {store.bilingualProgress?.total ?? displayPairs.length}문장 완료
        </span>{' '}
        ·{' '}
        <span className="tabular-nums">
          {(elapsedTenths / 10).toFixed(1)}초
        </span>
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={store.cancelBilingualRequest}
      >
        취소
      </button>
    </div>
  ) : null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.closeBilingualModal();
      }}
    >
      <div
        ref={cardRef}
        className="modal-card bilingual-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bilingual-modal-title"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        }}
      >
        {/* Draggable Modal Header */}
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
          <div className="bilingual-header-title-group">
            <h2 id="bilingual-modal-title" className="modal-title">
              <GripHorizontal
                size={16}
                className="ai-modal-drag-grip"
                aria-hidden="true"
              />
              <Languages size={19} />
              <span>영어 / 우리말 대조 해석</span>
            </h2>
            <span className="bilingual-source-pill">
              {passageCtx.sourceName}
            </span>
            {savedTranslation && !englishChangedSinceSave && (
              <span className="bilingual-status-pill" data-state="saved">
                해석 저장됨
              </span>
            )}
            {englishChangedSinceSave && (
              <span
                className="bilingual-status-pill"
                data-state="stale"
                title="저장된 해석 이후 영어 본문이 수정되었습니다. 'AI 다시 해석'으로 최신화할 수 있습니다."
              >
                본문 변경됨
              </span>
            )}
          </div>

          <div className="bilingual-header-actions">
            <div
              className="segmented-toggle"
              role="group"
              aria-label="대조 보기 형식"
            >
              <button
                type="button"
                className="segmented-btn"
                data-active={viewMode === 'continuous' && !isEditingKo}
                disabled={isEditingKo}
                onClick={() => setViewMode('continuous')}
              >
                연속 지문
              </button>
              <button
                type="button"
                className="segmented-btn"
                data-active={viewMode === 'aligned' || isEditingKo}
                onClick={() => setViewMode('aligned')}
              >
                문장별 정렬
              </button>
            </div>

            <button
              type="button"
              className="btn btn-sm bilingual-prompt-toggle"
              data-active={promptOpen ? 'true' : 'false'}
              aria-expanded={promptOpen}
              onClick={() => setPromptOpen((v) => !v)}
            >
              <SlidersHorizontal size={14} />
              <span>해석 프롬프트 수정</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={store.bilingualLoading}
              onClick={() => void handleRetranslate()}
            >
              {store.bilingualLoading ? (
                <Loader2 size={14} className="ai-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              <span>{savedTranslation ? 'AI 다시 해석' : 'AI 해석하기'}</span>
            </button>

            <button
              type="button"
              className="btn btn-icon"
              aria-label="닫기"
              onClick={store.closeBilingualModal}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Collapsible Prompt Editor Drawer */}
        {promptOpen && (
          <section
            className="bilingual-prompt-drawer"
            aria-label="우리말 해석 프롬프트 편집기"
          >
            <div className="bilingual-prompt-header">
              <div className="bilingual-prompt-title-row">
                <h3>우리말 해석 프롬프트 (자유롭게 수정 가능)</h3>
                {isPromptModifiedFromStore && (
                  <span className="bilingual-unsaved-tag">저장 전 변경</span>
                )}
              </div>
              <div className="bilingual-prompt-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    store.resetTranslationPrompt();
                  }}
                >
                  <RotateCcw size={14} />
                  <span>기본 원칙 복원</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!draftPrompt.trim()}
                  onClick={() => store.updateTranslationPrompt(draftPrompt)}
                >
                  <Check size={14} />
                  <span>프롬프트 저장</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!draftPrompt.trim() || store.bilingualLoading}
                  onClick={() => {
                    setPromptOpen(false);
                    void handleRetranslate(draftPrompt);
                  }}
                >
                  <Sparkles size={14} />
                  <span>프롬프트 적용 후 다시 해석</span>
                </button>
              </div>
            </div>
            <textarea
              className="bilingual-prompt-textarea"
              aria-label="우리말 해석 프롬프트 내용"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
            />
          </section>
        )}

        {/* Error / API Key Banner */}
        {store.bilingualError && (
          <div className="bilingual-error-strip">
            <div className="ai-alert-box" role="alert">
              <XCircle size={16} />
              <div className="ai-alert-text">
                <span>{store.bilingualError}</span>
                <button
                  type="button"
                  className="ai-inline-link"
                  onClick={() => store.setSettingsModalOpen(true, 'ai')}
                >
                  AI 설정 열기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main 2-Pane Split Stage */}
        <div className="bilingual-stage">
          {/* Column Headers */}
          <div className="bilingual-column-headers">
            <div className="bilingual-col-head">
              <div className="bilingual-col-head-left">
                <h3>영어 원문 (English)</h3>
                <span className="count-badge tabular-nums">
                  {displayPairs.length}문장
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!currentEnglish.trim()}
                onClick={async () => {
                  const ok = await copyTextSafe(currentEnglish);
                  if (ok) triggerCopyFeedback('en');
                }}
              >
                {copiedTag === 'en' ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedTag === 'en' ? '복사됨' : '영어 복사'}</span>
              </button>
            </div>

            <div className="bilingual-col-head">
              <div className="bilingual-col-head-left">
                <h3>우리말 해석 (Korean)</h3>
                {savedTranslation?.modelLabel && (
                  <span className="bilingual-model-chip">
                    {savedTranslation.modelLabel}
                  </span>
                )}
              </div>
              <div className="bilingual-col-head-actions">
                {isEditingKo ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setIsEditingKo(false);
                        setDraftPairs([]);
                      }}
                    >
                      <span>취소</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleSaveEditedKo}
                    >
                      <Check size={14} />
                      <span>수정한 해석 저장</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={
                        store.bilingualLoading || displayPairs.length === 0
                      }
                      onClick={handleStartEditKo}
                    >
                      <Edit3 size={14} />
                      <span>해석 직접 다듬기</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!koreanTextForCopy.trim()}
                      onClick={async () => {
                        const ok = await copyTextSafe(koreanTextForCopy);
                        if (ok) triggerCopyFeedback('ko');
                      }}
                    >
                      {copiedTag === 'ko' ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                      <span>
                        {copiedTag === 'ko' ? '복사됨' : '우리말 복사'}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Body Content */}
          {showFullLoadingRight ? (
            <div className="bilingual-continuous-grid">
              <div
                className="bilingual-pane-scroll"
                aria-label="영어 원문 문장 목록"
              >
                {paragraphGroups.map((group) => (
                  <p key={group.paragraphIndex} className="bilingual-paragraph">
                    {group.pairs.map((pair) => (
                      <React.Fragment key={pair.index}>
                        <span className="bilingual-inline-sent">
                          {pair.en}
                        </span>{' '}
                      </React.Fragment>
                    ))}
                  </p>
                ))}
              </div>

              <div
                className="bilingual-pane-scroll bilingual-loading-pane"
                role="status"
                aria-live="polite"
              >
                <div className="ai-loading-hero">
                  <div className="ai-loading-head">
                    <div className="ai-loading-status-left">
                      <Loader2 size={26} className="ai-spin" />
                      <div className="ai-loading-titles">
                        <div className="ai-loading-badges">
                          <span className="ai-live-badge">
                            <span
                              className="ai-live-dot"
                              aria-hidden="true"
                            />
                            우리말 병렬 해석 생성 중
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
                          {displayPairs.length}개 영어 문장을 병렬 분할해 빠르게
                          해석하고 있습니다…
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={store.cancelBilingualRequest}
                    >
                      취소
                    </button>
                  </div>
                  <div className="ai-loading-bar-track" aria-hidden="true">
                    <div className="ai-loading-bar-fill" />
                  </div>
                </div>

                <div className="bilingual-loading-skeletons" aria-hidden="true">
                  <div className="ai-skeleton-box bilingual-skel-line" />
                  <div className="ai-skeleton-box bilingual-skel-line" />
                  <div className="ai-skeleton-box bilingual-skel-line bilingual-skel-short" />
                </div>
              </div>
            </div>
          ) : viewMode === 'continuous' && !isEditingKo ? (
            <div className="bilingual-continuous-grid">
              {/* Left Continuous English Pane */}
              <div
                className="bilingual-pane-scroll"
                aria-label="영어 원문 문장 선택 영역"
              >
                {paragraphGroups.map((group) => (
                  <p key={group.paragraphIndex} className="bilingual-paragraph">
                    {group.pairs.map((pair) => {
                      const isSel = selectedIdx === pair.index;
                      return (
                        <React.Fragment key={pair.index}>
                          <span
                            ref={(el) => {
                              enSentRefs.current[pair.index] = el;
                            }}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSel}
                            className="bilingual-inline-sent"
                            data-selected={isSel ? 'true' : 'false'}
                            onClick={() =>
                              handleSelectFromSide(pair.index, 'en')
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSelectFromSide(pair.index, 'en');
                              }
                            }}
                          >
                            <span className="bilingual-sent-num tabular-nums">
                              {pair.index + 1}
                            </span>
                            {pair.en}
                          </span>{' '}
                        </React.Fragment>
                      );
                    })}
                  </p>
                ))}
              </div>

              {/* Right Continuous Korean Pane */}
              <div
                className="bilingual-pane-scroll"
                aria-label="우리말 해석 문장 선택 영역"
              >
                {progressiveBannerNode}
                {savedTranslation ? (
                  paragraphGroups.map((group) => (
                    <p
                      key={group.paragraphIndex}
                      className="bilingual-paragraph"
                    >
                      {group.pairs.map((pair) => {
                        const isSel = selectedIdx === pair.index;
                        const hasKo = pair.ko.trim().length > 0;
                        return (
                          <React.Fragment key={pair.index}>
                            <span
                              ref={(el) => {
                                koSentRefs.current[pair.index] = el;
                              }}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isSel}
                              className="bilingual-inline-sent"
                              data-selected={isSel ? 'true' : 'false'}
                              onClick={() =>
                                handleSelectFromSide(pair.index, 'ko')
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleSelectFromSide(pair.index, 'ko');
                                }
                              }}
                            >
                              <span className="bilingual-sent-num tabular-nums">
                                {pair.index + 1}
                              </span>
                              {hasKo ? (
                                pair.ko
                              ) : store.bilingualLoading ? (
                                <span className="bilingual-sent-pending">
                                  해석 생성 중…
                                </span>
                              ) : (
                                '(이 문장의 우리말 해석이 비어 있습니다)'
                              )}
                            </span>{' '}
                          </React.Fragment>
                        );
                      })}
                    </p>
                  ))
                ) : (
                  <div className="bilingual-empty-right">
                    <p>
                      상단의 <strong>AI 해석하기</strong> 버튼을 눌러 영어
                      지문의 우리말 해석을 생성하거나,{' '}
                      <strong>해석 직접 다듬기</strong>로 직접 입력할 수
                      있습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="bilingual-aligned-scroll"
              aria-label="문장별 영·한 대조 목록"
            >
              {progressiveBannerNode}
              {activePairsForRender.map((pair, idx) => {
                const isSel = selectedIdx === pair.index;
                return (
                  <div
                    key={pair.index}
                    className="bilingual-pair-row"
                    data-selected={isSel ? 'true' : 'false'}
                  >
                    <div
                      ref={(el) => {
                        enSentRefs.current[pair.index] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSel}
                      className="bilingual-pair-cell bilingual-pair-cell-en"
                      onClick={() => handleSelectFromSide(pair.index, 'en')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectFromSide(pair.index, 'en');
                        }
                      }}
                    >
                      <span className="bilingual-pair-index tabular-nums">
                        {pair.index + 1}
                      </span>
                      <span className="bilingual-pair-text">{pair.en}</span>
                    </div>

                    {isEditingKo ? (
                      <div
                        ref={(el) => {
                          koSentRefs.current[pair.index] = el;
                        }}
                        className="bilingual-pair-cell bilingual-pair-cell-ko"
                      >
                        <span className="bilingual-pair-index tabular-nums">
                          {pair.index + 1}
                        </span>
                        <textarea
                          className="bilingual-ko-edit-textarea"
                          aria-label={`문장 ${pair.index + 1} 우리말 해석 편집`}
                          rows={Math.max(2, Math.ceil(pair.en.length / 68))}
                          value={pair.ko}
                          onFocus={() => setSelectedIdx(pair.index)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraftPairs((prev) =>
                              prev.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, ko: val } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        ref={(el) => {
                          koSentRefs.current[pair.index] = el;
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSel}
                        className="bilingual-pair-cell bilingual-pair-cell-ko"
                        onClick={() => handleSelectFromSide(pair.index, 'ko')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectFromSide(pair.index, 'ko');
                          }
                        }}
                      >
                        <span className="bilingual-pair-index tabular-nums">
                          {pair.index + 1}
                        </span>
                        <span className="bilingual-pair-text">
                          {pair.ko.trim() ? (
                            pair.ko
                          ) : store.bilingualLoading ? (
                            <span className="bilingual-sent-pending">
                              해석 생성 중…
                            </span>
                          ) : (
                            '(해석 없음 — 해석 직접 다듬기 또는 AI 해석하기 실행)'
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Sentence Sync Bar */}
          <div className="bilingual-sync-bar">
            {selectedPair ? (
              <>
                <div className="bilingual-sync-info">
                  <span className="bilingual-sync-badge tabular-nums">
                    문장 {selectedPair.index + 1} / {displayPairs.length}
                  </span>
                  <span className="bilingual-sync-preview">
                    {selectedPair.en}
                    {selectedPair.ko ? `  —  ${selectedPair.ko}` : ''}
                  </span>
                </div>
                <div className="bilingual-sync-actions">
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    disabled={selectedPair.index <= 0}
                    title="이전 문장 (↑)"
                    aria-label="이전 문장"
                    onClick={() => handleStepSentence(-1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    disabled={selectedPair.index >= displayPairs.length - 1}
                    title="다음 문장 (↓)"
                    aria-label="다음 문장"
                    onClick={() => handleStepSentence(1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const text = selectedPair.ko
                        ? `${selectedPair.en}\n${selectedPair.ko}`
                        : selectedPair.en;
                      const ok = await copyTextSafe(text);
                      if (ok) triggerCopyFeedback('pair');
                    }}
                  >
                    {copiedTag === 'pair' ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    <span>
                      {copiedTag === 'pair' ? '복사됨' : '선택 문장 쌍 복사'}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <span className="bilingual-sync-hint">
                왼쪽 영어 문장 또는 오른쪽 우리말 문장을 클릭하면 짝이 되는
                문장이 서로 강조 표시됩니다. (방향키 ↑ / ↓ 이동 가능)
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer bilingual-modal-footer">
          <div className="bilingual-footer-left">
            {passageCtx.isMultiPassage && (
              <div
                className="passage-nav-group"
                role="group"
                aria-label="세트 문항 간 이동"
              >
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    passageCtx.activePassageIndex <= 0 || store.bilingualLoading
                  }
                  onClick={() =>
                    void handleSwitchPassage(passageCtx.activePassageIndex - 1)
                  }
                >
                  <ChevronLeft size={14} />
                  <span>이전 문항</span>
                </button>
                <select
                  className="passage-nav-select tabular-nums"
                  aria-label="문항 선택"
                  value={passageCtx.activePassageIndex}
                  disabled={store.bilingualLoading}
                  onChange={(e) =>
                    void handleSwitchPassage(Number(e.target.value))
                  }
                >
                  {passageCtx.passages.map((p) => {
                    const snippet = summarizeSnippet(p.content);
                    const pHasKo = Boolean(
                      store.savedTranslations[
                        getPassageTranslationSlotKey(
                          passageCtx.activeFile?.id ?? null,
                          p.index,
                        )
                      ]?.koreanFullText.trim(),
                    );
                    return (
                      <option key={p.index} value={p.index}>
                        {p.index + 1}/{passageCtx.passages.length} · {p.label}
                        {pHasKo ? ' [해석됨]' : ''}
                        {snippet ? ` — ${snippet}` : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    passageCtx.activePassageIndex >=
                      passageCtx.passages.length - 1 || store.bilingualLoading
                  }
                  onClick={() =>
                    void handleSwitchPassage(passageCtx.activePassageIndex + 1)
                  }
                >
                  <span>다음 문항</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            {savedTranslation && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={store.bilingualLoading}
                onClick={store.removeSavedTranslationForActivePassage}
              >
                <Trash2 size={14} />
                <span>저장된 해석 삭제</span>
              </button>
            )}
          </div>

          <div className="bilingual-footer-right">
            <button
              type="button"
              className="btn btn-sm"
              disabled={!currentEnglish.trim()}
              onClick={async () => {
                const full = formatPassageWithSavedTranslation(
                  currentEnglish,
                  koreanTextForCopy,
                );
                const ok = await copyTextSafe(full);
                if (ok) triggerCopyFeedback('both');
              }}
            >
              {copiedTag === 'both' ? <Check size={14} /> : <Copy size={14} />}
              <span>
                {copiedTag === 'both' ? '복사됨' : '영어+우리말 전체 복사'}
              </span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              disabled={!currentEnglish.trim()}
              onClick={store.exportActivePassageTxt}
            >
              <Download size={14} />
              <span>
                {savedTranslation
                  ? '.txt 저장 (영어+우리말)'
                  : '.txt 저장'}
              </span>
            </button>

            {passageCtx.isMultiPassage && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={store.exportFullPassageSetTxt}
              >
                <Download size={14} />
                <span>세트 전체 .txt 저장</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={store.closeBilingualModal}
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

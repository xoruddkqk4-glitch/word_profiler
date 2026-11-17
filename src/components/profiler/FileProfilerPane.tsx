import React, { useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileUp,
  Play,
  Sparkles,
  Type,
} from 'lucide-react';
import { countWordsMsWordStyle } from '../../core/tokenizer';
import {
  formatFileReadErrors,
  readTargetFilesFromBrowser,
} from '../../io/fileReaders';
import {
  resolveActivePassageContext,
  useProfilerStore,
} from '../../store/useProfilerStore';
import { EditorToolbar } from './EditorToolbar';
import { HighlightedTextView } from './HighlightedTextView';
import { SelectionInspector } from './SelectionInspector';

export interface FileProfilerPaneProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

function summarizePassageSnippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 28 ? `${oneLine.slice(0, 28)}…` : oneLine;
}

export const FileProfilerPane: React.FC<FileProfilerPaneProps> = ({
  searchInputRef,
}) => {
  const store = useProfilerStore();
  const emptyUploadRef = useRef<HTMLInputElement>(null);

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

  const { activeFile, isInline, isMultiPassage, passages, activePassageIndex, activePassage } =
    passageCtx;

  const profile = store.activeProfile;
  const isEditing = store.editorMode === 'edit' || !profile;

  const editableValue = isInline ? store.inlineText : activePassage.content;

  const currentPassageTextForCount = !isEditing && profile
    ? profile.originalText
    : activePassage.content;

  const hasTextToCount =
    Boolean(profile) || currentPassageTextForCount.trim().length > 0;
  const wordCount = useMemo(
    () => countWordsMsWordStyle(currentPassageTextForCount),
    [currentPassageTextForCount],
  );

  const hasTextToStart = activePassage.content.trim().length > 0;

  return (
    <div className="profiler-pane">
      <EditorToolbar searchInputRef={searchInputRef} />

      {/* File Info & Set Passage Navigation Strip */}
      <div className="file-summary-strip">
        <div className="file-summary-title">
          <strong>File:</strong>
          <span>
            {activeFile
              ? activeFile.name
              : store.inlineText.trim()
                ? 'Inline Text'
                : '선택된 지문 없음'}
          </span>
          {isMultiPassage && (
            <span className="passage-item-tag tabular-nums">
              {activePassage.label} ({activePassageIndex + 1}/{passages.length})
            </span>
          )}
          {profile && !isEditing && (
            <span className="file-summary-meta tabular-nums">
              ({profile.totalTypes.toLocaleString()}{' '}
              {profile.totalTypes === 1 ? 'type' : 'types'},{' '}
              {profile.totalTokens.toLocaleString()}{' '}
              {profile.totalTokens === 1 ? 'token' : 'tokens'})
            </span>
          )}
          {hasTextToCount && (
            <span
              className="word-count-badge tabular-nums"
              title="현재 지문의 전체 단어 수 (MS Word 공백 기준 — 축약어·하이픈어 1단어 처리)"
            >
              Word Count: <strong>{wordCount.toLocaleString()}</strong>{' '}
              {wordCount === 1 ? 'word' : 'words'}
            </span>
          )}
        </div>

        <div className="file-summary-right">
          {isMultiPassage && (
            <div
              className="passage-nav-group"
              role="group"
              aria-label="세트 문항 간 이동"
            >
              <button
                type="button"
                className="btn btn-sm passage-nav-btn"
                disabled={activePassageIndex <= 0 || store.isBusy}
                title="이전 문항으로 이동 (Alt+←)"
                onClick={() => void store.stepActivePassage('prev')}
              >
                <ChevronLeft size={15} />
                <span>이전 문항</span>
              </button>

              <select
                className="passage-nav-select tabular-nums"
                aria-label="문항 선택"
                value={activePassageIndex}
                disabled={store.isBusy}
                onChange={(e) =>
                  void store.setActivePassageIndex(Number(e.target.value))
                }
              >
                {passages.map((p) => {
                  const snippet = summarizePassageSnippet(p.content);
                  return (
                    <option key={p.index} value={p.index}>
                      {p.index + 1}/{passages.length} · {p.label}
                      {snippet ? ` — ${snippet}` : ''}
                    </option>
                  );
                })}
              </select>

              <button
                type="button"
                className="btn btn-sm passage-nav-btn"
                disabled={
                  activePassageIndex >= passages.length - 1 || store.isBusy
                }
                title="다음 문항으로 이동 (Alt+→)"
                onClick={() => void store.stepActivePassage('next')}
              >
                <span>다음 문항</span>
                <ChevronRight size={15} />
              </button>
            </div>
          )}

          <div className="file-summary-meta">
            Mode:{' '}
            <strong>
              {store.settings.showLevels
                ? 'Highlight List Words'
                : 'Highlight Non-List Words'}
            </strong>
          </div>
        </div>
      </div>

      {/* Center Document Stage + Right Selection Inspector */}
      <div className="profiler-split-content">
        <div className="profiler-document-stage">
          {isEditing ? (
            isInline &&
            !store.inlineEditorOpen &&
            store.inlineText.length === 0 &&
            store.targetFiles.length === 0 ? (
              <div className="stage-empty-state">
                <h3 className="stage-empty-title">
                  영어 지문 어휘 레벨 프로파일러
                </h3>
                <p className="stage-empty-desc">
                  분석할 영어 지문 파일(<code>.txt</code>, <code>.docx</code>,{' '}
                  <code>.pdf</code>)이나 복수 문항이 담긴 세트 <code>.txt</code>를
                  화면에 끌어다 놓거나, 직접 지문을 붙여넣어{' '}
                  <strong>GSL/AWL</strong> 또는{' '}
                  <strong>2015·2022 개정 영어과 교육과정</strong> 기준 어휘 커버리지를
                  즉시 확인하세요.
                </p>
                <div className="stage-empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void store.loadSamplePassage()}
                  >
                    <Sparkles size={16} /> 샘플 영문 지문으로 바로 체험하기
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => emptyUploadRef.current?.click()}
                  >
                    <FileUp size={16} /> 파일 업로드 (.txt / .docx / .pdf)
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={store.openEmptyInlineEditor}
                  >
                    <Type size={16} /> 빈 에디터에 직접 입력
                  </button>
                </div>
                <input
                  ref={emptyUploadRef}
                  type="file"
                  accept=".txt,.docx,.pdf"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = e.target.files;
                    e.target.value = '';
                    if (!files?.length) return;
                    const { items, errors } =
                      await readTargetFilesFromBrowser(files);
                    const readErr = formatFileReadErrors(errors);
                    if (readErr) {
                      store.setErrorBanner(readErr);
                    }
                    if (items.length > 0) {
                      await store.addTargetFiles(items);
                    }
                  }}
                />
              </div>
            ) : (
              <textarea
                className="inline-textarea"
                style={{ fontSize: `${store.settings.fontSizePx}px` }}
                placeholder="여기에 분석할 영어 지문을 입력하거나 붙여넣은 뒤 하단 Start (또는 F5) 버튼을 누르세요. (복수 문항 세트는 --- 구분선, [18] 번호 헤더, 또는 빈 줄 2줄로 구분)"
                value={editableValue}
                autoFocus
                onChange={(e) => store.updateActiveEditableText(e.target.value)}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  const sel = el.value.slice(el.selectionStart, el.selectionEnd);
                  store.setEditSelectionText(sel);
                }}
              />
            )
          ) : (
            <HighlightedTextView />
          )}

          {/* Bottom Start & Clear Format Action Bar */}
          <div className="profiler-bottom-bar">
            <div className="toolbar-group">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!hasTextToStart || store.isBusy}
                onClick={() => void store.runProfileActive()}
              >
                <Play size={15} /> Start (F5)
              </button>
              <button
                type="button"
                className="btn"
                disabled={!profile || store.plainFormatView}
                onClick={store.clearProfileFormat}
              >
                <Eraser size={15} /> Clear Format
              </button>
            </div>

            {profile && (
              <span className="profiler-bottom-summary tabular-nums">
                Covered: {profile.totalCoveredPercentage.toFixed(2)}% · Out of
                lists: {profile.outSummary.percentage.toFixed(2)}% (
                {profile.outSummary.typeCount} types)
              </span>
            )}
          </div>
        </div>

        <SelectionInspector />
      </div>
    </div>
  );
};

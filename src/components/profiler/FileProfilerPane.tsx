import React, { useRef } from 'react';
import {
  Eraser,
  FileUp,
  Play,
  Sparkles,
  Type,
} from 'lucide-react';
import { readTargetFilesFromBrowser } from '../../io/fileReaders';
import { useProfilerStore } from '../../store/useProfilerStore';
import { EditorToolbar } from './EditorToolbar';
import { HighlightedTextView } from './HighlightedTextView';
import { SelectionInspector } from './SelectionInspector';

export interface FileProfilerPaneProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const FileProfilerPane: React.FC<FileProfilerPaneProps> = ({
  searchInputRef,
}) => {
  const store = useProfilerStore();
  const emptyUploadRef = useRef<HTMLInputElement>(null);

  const activeFile = store.activeTargetFileId
    ? store.targetFiles.find((f) => f.id === store.activeTargetFileId) ?? null
    : null;

  const profile = store.activeProfile;
  const isEditingInline =
    activeFile === null &&
    (store.editorMode === 'edit' || !profile);

  const hasTextToStart = activeFile
    ? activeFile.content.trim().length > 0
    : store.inlineText.trim().length > 0;

  return (
    <div className="profiler-pane">
      <EditorToolbar searchInputRef={searchInputRef} />

      {/* File Info Strip */}
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
          {profile && (
            <span className="file-summary-meta tabular-nums">
              ({profile.totalTypes.toLocaleString()}{' '}
              {profile.totalTypes === 1 ? 'type' : 'types'},{' '}
              {profile.totalTokens.toLocaleString()}{' '}
              {profile.totalTokens === 1 ? 'token' : 'tokens'})
            </span>
          )}
        </div>

        <div className="file-summary-meta">
          Mode:{' '}
          <strong>
            {store.settings.showLevels
              ? 'Highlight List Words'
              : 'Highlight Non-List Words'}
          </strong>
        </div>
      </div>

      {/* Center Document Stage + Right Selection Inspector */}
      <div className="profiler-split-content">
        <div className="profiler-document-stage">
          {isEditingInline ? (
            store.inlineText.length === 0 && store.targetFiles.length === 0 ? (
              <div className="stage-empty-state">
                <h3 className="stage-empty-title">
                  영어 지문 어휘 레벨 프로파일러
                </h3>
                <p className="stage-empty-desc">
                  분석할 영어 지문 파일(<code>.txt</code>, <code>.docx</code>,{' '}
                  <code>.pdf</code>)을 화면에 끌어다 놓거나, 직접 지문을 붙여넣어{' '}
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
                    onClick={() => store.updateInlineText(' ')}
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
                    if (errors.length > 0) {
                      store.setErrorBanner(
                        `${errors[0].fileName}: ${errors[0].reason}`,
                      );
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
                placeholder="여기에 분석할 영어 지문을 입력하거나 붙여넣은 뒤 하단 Start (또는 F5) 버튼을 누르세요..."
                value={store.inlineText === ' ' ? '' : store.inlineText}
                autoFocus
                onChange={(e) => store.updateInlineText(e.target.value)}
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


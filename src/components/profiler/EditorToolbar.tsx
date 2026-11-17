import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyCheck,
  Edit3,
  Eye,
  FolderOpen,
  Minus,
  Plus,
  Redo2,
  Search,
  Type,
  Undo2,
} from 'lucide-react';
import {
  buildRichProfileClipboardPayload,
  copyRichTextSafe,
  copyTextSafe,
} from '../../io/docExporters';
import {
  formatFileReadErrors,
  readTargetFilesFromBrowser,
} from '../../io/fileReaders';
import {
  resolveActivePassageContext,
  useProfilerStore,
} from '../../store/useProfilerStore';

export interface EditorToolbarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  searchInputRef,
}) => {
  const store = useProfilerStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const [copiedKind, setCopiedKind] = useState<'all' | 'selection' | null>(
    null,
  );

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

  const { isInline, activePassage } = passageCtx;
  const canUndo = store.canUndoActiveDocument();
  const canRedo = store.canRedoActiveDocument();

  const profile = store.activeProfile;
  const isEditingView = store.editorMode === 'edit' || !profile;
  const editableText = isInline ? store.inlineText : activePassage.content;

  const canCopyAll = isEditingView
    ? editableText.length > 0
    : Boolean(profile && profile.originalText.length > 0);

  const canCopySelection = isEditingView
    ? store.editSelectionText.length > 0
    : Boolean(store.selectedTokenSpan || store.selectedRawToken);

  const hitCount = store.searchMatchTokenIndices.length;
  const cursorDisplay =
    hitCount > 0 ? `${store.activeSearchCursor + 1}/${hitCount}` : '0/0';

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const triggerCopiedFeedback = (kind: 'all' | 'selection') => {
    setCopiedKind(kind);
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedKind(null);
      copyFeedbackTimerRef.current = null;
    }, 1400);
  };

  const handleCopyAll = async () => {
    if (profile && (!isEditingView || profile.originalText === editableText)) {
      const payload = buildRichProfileClipboardPayload(
        profile,
        store.referenceLists,
        {
          showLevels: store.settings.showLevels,
          ignoreEnabled: store.ignoreEnabled,
          ignoreColor: store.ignoreColor,
          outColor: store.outColor,
          plainFormatView: store.plainFormatView,
        },
      );
      const ok = await copyRichTextSafe(payload.plainText, payload.htmlText);
      if (ok) {
        triggerCopiedFeedback('all');
        useProfilerStore.setState({
          statusMessage:
            '전체 지문을 서식(글자색·굵기)과 함께 클립보드에 복사했습니다.',
        });
      }
      return;
    }

    if (editableText) {
      const ok = await copyTextSafe(editableText);
      if (ok) {
        triggerCopiedFeedback('all');
        useProfilerStore.setState({
          statusMessage: '편집 중인 전체 텍스트를 클립보드에 복사했습니다.',
        });
      }
    }
  };

  const handleCopySelection = async () => {
    if (!isEditingView && profile) {
      if (store.selectedTokenSpan) {
        const payload = buildRichProfileClipboardPayload(
          profile,
          store.referenceLists,
          {
            showLevels: store.settings.showLevels,
            ignoreEnabled: store.ignoreEnabled,
            ignoreColor: store.ignoreColor,
            outColor: store.outColor,
            plainFormatView: store.plainFormatView,
          },
          {
            startTokenIdx: store.selectedTokenSpan.startTokenIdx,
            endTokenIdx: store.selectedTokenSpan.endTokenIdx,
          },
        );
        const ok = await copyRichTextSafe(payload.plainText, payload.htmlText);
        if (ok) {
          triggerCopiedFeedback('selection');
          useProfilerStore.setState({
            statusMessage:
              '선택 영역을 서식(글자색·굵기)과 함께 클립보드에 복사했습니다.',
          });
        }
        return;
      }

      if (store.selectedRawToken) {
        const hitIdx = store.selectedWordKey
          ? profile.tokens.findIndex(
            (t) => t.lookupKey === store.selectedWordKey,
          )
          : -1;
        const ok =
          hitIdx >= 0
            ? await (async () => {
              const payload = buildRichProfileClipboardPayload(
                profile,
                store.referenceLists,
                {
                  showLevels: store.settings.showLevels,
                  ignoreEnabled: store.ignoreEnabled,
                  ignoreColor: store.ignoreColor,
                  outColor: store.outColor,
                  plainFormatView: store.plainFormatView,
                },
                { startTokenIdx: hitIdx, endTokenIdx: hitIdx },
              );
              return copyRichTextSafe(payload.plainText, payload.htmlText);
            })()
            : await copyTextSafe(store.selectedRawToken);

        if (ok) {
          triggerCopiedFeedback('selection');
          useProfilerStore.setState({
            statusMessage:
              '선택 단어를 서식(글자색·굵기)과 함께 클립보드에 복사했습니다.',
          });
        }
      }
      return;
    }

    if (store.editSelectionText) {
      const ok = await copyTextSafe(store.editSelectionText);
      if (ok) {
        triggerCopiedFeedback('selection');
        useProfilerStore.setState({
          statusMessage: '선택한 텍스트를 클립보드에 복사했습니다.',
        });
      }
    }
  };

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-sm inline-mode-btn"
          data-active={isInline}
          title="직접 입력(Inline Text) 에디터로 전환"
          onClick={() => {
            if (!isInline) {
              void store.switchToInlineEditor();
            } else if (!store.inlineEditorOpen && !store.inlineText) {
              store.openEmptyInlineEditor();
            }
          }}
        >
          <Type size={14} />
          <span>Inline Text</span>
        </button>

        <button
          type="button"
          className="btn btn-sm"
          title="타겟 파일 열기 (.txt, .docx, .pdf — 복수 문항 세트 .txt 지원)"
          onClick={() => fileInputRef.current?.click()}
        >
          <FolderOpen size={15} /> Open
        </button>

        <span className="toolbar-sep" />

        <div
          className="segmented-toggle"
          role="group"
          aria-label="보기 및 편집 모드"
        >
          <button
            type="button"
            className="segmented-btn"
            data-active={store.editorMode === 'profiled'}
            onClick={() => store.setEditorMode('profiled')}
          >
            <Eye size={15} />
            <span>Profiled</span>
          </button>
          <button
            type="button"
            className="segmented-btn"
            data-active={store.editorMode === 'edit'}
            onClick={() => store.setEditorMode('edit')}
          >
            <Edit3 size={15} />
            <span>Edit Text</span>
          </button>
        </div>

        <span className="toolbar-sep" />

        <button
          type="button"
          className="btn btn-icon btn-sm"
          disabled={!canUndo}
          title="실행 취소 (Ctrl+Z)"
          aria-label="실행 취소"
          onClick={store.undoInlineText}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-sm"
          disabled={!canRedo}
          title="다시 실행 (Ctrl+Y)"
          aria-label="다시 실행"
          onClick={store.redoInlineText}
        >
          <Redo2 size={15} />
        </button>

        <button
          type="button"
          className="btn btn-sm copy-feedback-btn"
          data-copied={copiedKind === 'all'}
          disabled={!canCopyAll}
          title="현재 지문 전체를 글자 서식(글자색·굵기)과 함께 클립보드에 복사합니다"
          onClick={() => void handleCopyAll()}
        >
          {copiedKind === 'all' ? <Check size={14} /> : <Copy size={14} />}
          <span>{copiedKind === 'all' ? '복사됨' : '전체 복사'}</span>
        </button>

        <button
          type="button"
          className="btn btn-sm copy-feedback-btn"
          data-copied={copiedKind === 'selection'}
          disabled={!canCopySelection}
          title={
            canCopySelection
              ? '선택한 단어·구문을 글자 서식(글자색·굵기)과 함께 클립보드에 복사합니다'
              : '본문에서 단어를 클릭하거나 범위를 드래그해 선택한 뒤 복사하세요'
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleCopySelection()}
        >
          {copiedKind === 'selection' ? (
            <Check size={14} />
          ) : (
            <CopyCheck size={14} />
          )}
          <span>{copiedKind === 'selection' ? '복사됨' : '선택 복사'}</span>
        </button>

        <span className="toolbar-sep" />

        <button
          type="button"
          className="btn btn-icon btn-sm"
          title="글꼴 크기 축소"
          aria-label="글꼴 크기 축소"
          onClick={() => store.adjustFontSize(-1)}
        >
          <Minus size={15} />
        </button>
        <span className="font-size-readout tabular-nums">
          {store.settings.fontSizePx}px
        </span>
        <button
          type="button"
          className="btn btn-icon btn-sm"
          title="글꼴 크기 확대"
          aria-label="글꼴 크기 확대"
          onClick={() => store.adjustFontSize(1)}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Right Search Box */}
      <div className="toolbar-group editor-search-group">
        <div className="search-box-wrap">
          <Search size={15} />
          <input
            ref={searchInputRef}
            type="text"
            className="search-box-input"
            placeholder="단어/정규식 검색 (Ctrl+F)"
            value={store.searchQuery}
            onChange={(e) => store.setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                store.stepSearchMatch(e.shiftKey ? 'prev' : 'next');
              }
            }}
          />
          {store.searchQuery && (
            <span className="search-count-badge tabular-nums">
              {cursorDisplay}
            </span>
          )}
          <button
            type="button"
            className="mini-icon-btn"
            disabled={hitCount === 0}
            title="이전 일치 단어 (Shift+Enter)"
            aria-label="이전 찾기"
            onClick={() => store.stepSearchMatch('prev')}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="mini-icon-btn"
            disabled={hitCount === 0}
            title="다음 일치 단어 (Enter)"
            aria-label="다음 찾기"
            onClick={() => store.stepSearchMatch('next')}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.docx,.pdf"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          e.target.value = '';
          if (!files?.length) return;
          const { items, errors } = await readTargetFilesFromBrowser(files);
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
  );
};

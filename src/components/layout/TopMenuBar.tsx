import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HelpCircle,
  Layers,
  Moon,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
} from 'lucide-react';
import {
  exportProfileAsDocx,
  exportProfileAsHtml,
  exportProfileAsTxt,
} from '../../io/docExporters';
import {
  decodeTextBufferSmart,
  readTargetFilesFromBrowser,
  readWordlistFilesFromBrowser,
} from '../../io/fileReaders';
import { exportLevelGroupsArchive } from '../../io/listExporters';
import {
  exportSettingsFile,
  parseSettingsFileContent,
} from '../../io/settingsIniAdapter';
import {
  buildSheetForSubTab,
  copySheetToClipboard,
  exportAllStatsAsXlsx,
  exportSingleStatTabAsTsv,
} from '../../io/statsExporters';
import { useProfilerStore } from '../../store/useProfilerStore';
import { profilerWorkerClient } from '../../workers/workerClient';

type MenuKey = 'file' | 'edit' | 'lists' | 'settings' | 'help' | null;

export const TopMenuBar: React.FC = () => {
  const store = useProfilerStore();
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
    top: 50,
    left: 14,
  });

  const menuBarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const targetFilesInputRef = useRef<HTMLInputElement>(null);
  const targetDirInputRef = useRef<HTMLInputElement>(null);
  const refListsInputRef = useRef<HTMLInputElement>(null);
  const ignoreFileInputRef = useRef<HTMLInputElement>(null);
  const masterFileInputRef = useRef<HTMLInputElement>(null);
  const settingsImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dirEl = targetDirInputRef.current;
    if (dirEl) {
      dirEl.setAttribute('webkitdirectory', '');
      dirEl.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        menuBarRef.current?.contains(t) ||
        dropdownRef.current?.contains(t)
      ) {
        return;
      }
      setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const toggleMenu = (key: Exclude<MenuKey, null>, btnEl: HTMLButtonElement) => {
    if (openMenu === key) {
      setOpenMenu(null);
      return;
    }
    const rect = btnEl.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    setOpenMenu(key);
  };

  const handleOpenTargetFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { items, errors } = await readTargetFilesFromBrowser(files);
    if (errors.length > 0) {
      store.setErrorBanner(
        `${errors[0].fileName}: ${errors[0].reason}`,
      );
    }
    if (items.length > 0) {
      await store.addTargetFiles(items);
    }
  };

  const handleOpenRefLists = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { lists, errors } = await readWordlistFilesFromBrowser(files);
    if (errors.length > 0) {
      store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
    }
    if (lists.length > 0) {
      await store.addCustomReferenceLists(lists);
    }
  };

  const handleExportLists = async (mode: 'rows' | 'trees') => {
    setOpenMenu(null);
    if (store.referenceLists.filter((r) => r.enabled).length === 0) {
      store.setErrorBanner('내보낼 활성 레퍼런스 리스트가 없습니다.');
      return;
    }
    const groups = await profilerWorkerClient.exportLevelGroups({
      referenceLists: store.referenceLists,
      masterList: store.masterList,
      settings: store.settings,
    });
    await exportLevelGroupsArchive(groups, mode);
  };

  const handleCopyActiveContent = async () => {
    setOpenMenu(null);
    if (store.activeMainTab === 'profiler') {
      const txt =
        store.activeProfile?.originalText ?? store.inlineText;
      if (txt) {
        await navigator.clipboard.writeText(txt);
      }
    } else if (store.statsBundle) {
      const sheet = buildSheetForSubTab(
        store.statsBundle,
        store.activeStatsSubTab,
        { showFullPaths: store.settings.showFullPathsInStats },
      );
      await copySheetToClipboard(sheet);
    }
  };

  return (
    <header className="top-menubar" ref={menuBarRef}>
      <div className="menubar-left">
        <div className="app-brand">
          <BookOpen size={18} strokeWidth={2} />
          <span>AntWordProfiler</span>
          <span className="brand-version">Web 2.2.1</span>
        </div>

        <button
          type="button"
          className="menu-trigger"
          data-open={openMenu === 'file'}
          onClick={(e) => toggleMenu('file', e.currentTarget)}
        >
          File <ChevronDown size={15} />
        </button>

        <button
          type="button"
          className="menu-trigger"
          data-open={openMenu === 'edit'}
          onClick={(e) => toggleMenu('edit', e.currentTarget)}
        >
          Edit <ChevronDown size={15} />
        </button>

        <button
          type="button"
          className="menu-trigger"
          data-open={openMenu === 'lists'}
          onClick={(e) => toggleMenu('lists', e.currentTarget)}
        >
          Wordlists <ChevronDown size={15} />
        </button>

        <button
          type="button"
          className="menu-trigger"
          data-open={openMenu === 'settings'}
          onClick={(e) => toggleMenu('settings', e.currentTarget)}
        >
          Settings <ChevronDown size={15} />
        </button>

        <button
          type="button"
          className="menu-trigger"
          data-open={openMenu === 'help'}
          onClick={(e) => toggleMenu('help', e.currentTarget)}
        >
          Help <ChevronDown size={15} />
        </button>
      </div>

      <div className="menubar-right">
        {store.manifest && (
          <div className="preset-select-group">
            <label htmlFor="preset-quick-select" className="preset-label">
              Preset:
            </label>
            <select
              id="preset-quick-select"
              className="preset-select"
              value={store.activePresetId ?? 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  void store.applyPreset(e.target.value);
                }
              }}
            >
              {store.manifest.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {!store.activePresetId && (
                <option value="custom">Custom Level Configuration</option>
              )}
            </select>
          </div>
        )}

        <button
          type="button"
          className="btn btn-icon btn-ghost"
          title={
            store.theme === 'light'
              ? '다크 테마로 전환'
              : '라이트 테마로 전환'
          }
          aria-label="테마 전환"
          onClick={store.toggleTheme}
        >
          {store.theme === 'light' ? (
            <Moon size={18} strokeWidth={1.85} />
          ) : (
            <Sun size={18} strokeWidth={1.85} />
          )}
        </button>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={targetFilesInputRef}
        type="file"
        accept=".txt,.docx,.pdf"
        multiple
        hidden
        onChange={(e) => {
          void handleOpenTargetFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={targetDirInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void handleOpenTargetFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={refListsInputRef}
        type="file"
        accept=".txt,.tsv,.lst"
        multiple
        hidden
        onChange={(e) => {
          void handleOpenRefLists(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={ignoreFileInputRef}
        type="file"
        accept=".txt,.tsv,.lst"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const content = decodeTextBufferSmart(await f.arrayBuffer());
          await store.loadCustomIgnoreList(f.name, f.name, content);
        }}
      />
      <input
        ref={masterFileInputRef}
        type="file"
        accept=".txt,.tsv,.lst"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const content = decodeTextBufferSmart(await f.arrayBuffer());
          await store.loadCustomMasterList(f.name, f.name, content);
        }}
      />
      <input
        ref={settingsImportInputRef}
        type="file"
        accept=".ini,.json,.txt"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const raw = decodeTextBufferSmart(await f.arrayBuffer());
            const parsed = parseSettingsFileContent(raw, store.settings);
            await store.updateSettings(parsed.settings);
            if (parsed.extraIgnoreWords) {
              await store.clearAllExtraIgnoreWords();
              for (const w of parsed.extraIgnoreWords) {
                await store.addExtraIgnoreWord(w);
              }
            }
          } catch (err) {
            store.setErrorBanner(
              err instanceof Error
                ? `설정 파일을 읽지 못했습니다: ${err.message}`
                : '설정 파일 형식 오류',
            );
          }
        }}
      />

      {/* Portal Dropdown Menus */}
      {openMenu &&
        createPortal(
          <div
            ref={dropdownRef}
            className="menu-dropdown-portal"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {openMenu === 'file' && (
              <>
                <div className="menu-section-caption">Target Corpus</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    targetFilesInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    <Upload size={14} /> Open Target File(s)... (.txt, .docx, .pdf)
                  </span>
                  <span className="menu-shortcut">Ctrl+O</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    targetDirInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    <FolderOpen size={14} /> Open Target Folder...
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    void store.loadSamplePassage();
                  }}
                >
                  <span className="menu-item-left">
                    <FileText size={14} /> Load Sample Passage
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.selectedTargetIds.length === 0}
                  onClick={() => {
                    setOpenMenu(null);
                    void store.removeSelectedTargetFiles();
                  }}
                >
                  <span className="menu-item-left">
                    Close Selected Target File(s)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.targetFiles.length === 0}
                  onClick={() => {
                    setOpenMenu(null);
                    void store.clearAllTargetFiles();
                  }}
                >
                  <span className="menu-item-left">Close All Target Files</span>
                </button>

                <div className="menu-divider" />
                <div className="menu-section-caption">Save Active Profile</div>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!store.activeProfile}
                  onClick={() => {
                    setOpenMenu(null);
                    if (!store.activeProfile) return;
                    void exportProfileAsDocx(
                      store.activeProfile,
                      store.referenceLists,
                      {
                        showLevels: store.settings.showLevels,
                        ignoreEnabled: store.ignoreEnabled,
                        ignoreColor: store.ignoreColor,
                        outColor: store.outColor,
                        fontSizePx: store.settings.fontSizePx,
                      },
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Save Colored Profile as Word (.docx)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!store.activeProfile}
                  onClick={() => {
                    setOpenMenu(null);
                    if (!store.activeProfile) return;
                    exportProfileAsHtml(
                      store.activeProfile,
                      store.referenceLists,
                      {
                        showLevels: store.settings.showLevels,
                        ignoreEnabled: store.ignoreEnabled,
                        ignoreColor: store.ignoreColor,
                        outColor: store.outColor,
                      },
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Save Colored Profile as HTML (.html)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!store.activeProfile}
                  onClick={() => {
                    setOpenMenu(null);
                    if (!store.activeProfile) return;
                    exportProfileAsTxt(store.activeProfile);
                  }}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Save Plain Text (.txt)
                  </span>
                </button>

                <div className="menu-divider" />
                <div className="menu-section-caption">Export Statistics</div>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!store.statsBundle}
                  onClick={() => {
                    setOpenMenu(null);
                    if (!store.statsBundle) return;
                    exportSingleStatTabAsTsv(
                      store.statsBundle,
                      store.activeStatsSubTab,
                      store.settings.showFullPathsInStats,
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <FileText size={14} /> Save Active Stats Table (.tsv)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!store.statsBundle}
                  onClick={() => {
                    setOpenMenu(null);
                    if (!store.statsBundle) return;
                    exportAllStatsAsXlsx(
                      store.statsBundle,
                      store.settings.showFullPathsInStats,
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <FileSpreadsheet size={14} /> Save All 6 Stats Tables (.xlsx)
                  </span>
                </button>
              </>
            )}

            {openMenu === 'edit' && (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => void handleCopyActiveContent()}
                >
                  <span className="menu-item-left">
                    <Copy size={14} /> Copy Active Text / Table
                  </span>
                  <span className="menu-shortcut">Ctrl+C</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    void store.runProfileActive();
                  }}
                >
                  <span className="menu-item-left">Refresh Active Profile</span>
                  <span className="menu-shortcut">F5</span>
                </button>
              </>
            )}

            {openMenu === 'lists' && (
              <>
                <div className="menu-section-caption">Reference Level Lists</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    refListsInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    <Upload size={14} /> Open User Reference List(s)... (.txt)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.referenceLists.length === 0}
                  onClick={() => {
                    setOpenMenu(null);
                    void store.runValidateLists();
                  }}
                >
                  <span className="menu-item-left">
                    <ShieldCheck size={14} /> Validate Level Lists (Find Duplicates)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.referenceLists.length === 0}
                  onClick={() => void handleExportLists('rows')}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Export Level Lists as Rows (.txt/.zip)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.referenceLists.length === 0}
                  onClick={() => void handleExportLists('trees')}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Export Level Lists as Nation Trees
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.referenceLists.every((r) => r.enabled)}
                  onClick={() => {
                    setOpenMenu(null);
                    void store.closeDeactivatedReferenceLists();
                  }}
                >
                  <span className="menu-item-left">
                    Close Deactivated Reference Lists
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={store.referenceLists.length === 0}
                  onClick={() => {
                    setOpenMenu(null);
                    void store.closeAllReferenceLists();
                  }}
                >
                  <span className="menu-item-left">Close All Reference Lists</span>
                </button>

                {store.manifest && (
                  <>
                    <div className="menu-divider" />
                    <div className="menu-section-caption">
                      Add Bundled List (GSL / AWL / 2015 교육과정)
                    </div>
                    {store.manifest.lists.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          setOpenMenu(null);
                          void store.addBundledReferenceList(l.id);
                        }}
                      >
                        <span className="menu-item-left">
                          <Layers size={13} /> {l.displayName}
                        </span>
                      </button>
                    ))}
                  </>
                )}

                <div className="menu-divider" />
                <div className="menu-section-caption">
                  Master &amp; Ignore Lists
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    void store.toggleBuiltinMasterList(
                      !(store.masterList.enabled && store.masterList.isBuiltin),
                    );
                  }}
                >
                  <span className="menu-item-left">
                    {store.masterList.enabled && store.masterList.isBuiltin ? (
                      <Check size={14} />
                    ) : (
                      <span style={{ width: 14, display: 'inline-block' }} />
                    )}
                    Use Built-in Word-Family Master List (3,461 Families)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    masterFileInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    Open Custom Master List (.txt)...
                  </span>
                </button>
                {store.masterList.enabled && (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      void store.closeMasterList();
                    }}
                  >
                    <span className="menu-item-left">Close Master List</span>
                  </button>
                )}

                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    ignoreFileInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    Open Ignore List File (.txt)...
                  </span>
                </button>
                {store.ignoreList.enabled && (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      void store.closeIgnoreListFile();
                    }}
                  >
                    <span className="menu-item-left">
                      Close Ignore List File ({store.ignoreList.name})
                    </span>
                  </button>
                )}
              </>
            )}

            {openMenu === 'settings' && (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    store.setSettingsModalOpen(true);
                  }}
                >
                  <span className="menu-item-left">
                    <Settings size={14} /> Global Settings...
                  </span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    settingsImportInputRef.current?.click();
                  }}
                >
                  <span className="menu-item-left">
                    <Upload size={14} /> Import Settings (.ini / .json)...
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    exportSettingsFile(
                      {
                        settings: store.settings,
                        extraIgnoreWords: store.extraIgnoreWords,
                        activePresetId: store.activePresetId,
                      },
                      'ini',
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Export AntWordProfiler Settings (.ini)
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    exportSettingsFile(
                      {
                        settings: store.settings,
                        extraIgnoreWords: store.extraIgnoreWords,
                        activePresetId: store.activePresetId,
                      },
                      'json',
                    );
                  }}
                >
                  <span className="menu-item-left">
                    <Download size={14} /> Export Web Settings (.json)
                  </span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    void store.resetDefaultSettings();
                  }}
                >
                  <span className="menu-item-left">
                    <RotateCcw size={14} /> Reset to Default Settings
                  </span>
                </button>
              </>
            )}

            {openMenu === 'help' && (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    store.setHelpModalTab('guide');
                  }}
                >
                  <span className="menu-item-left">
                    <HelpCircle size={14} /> User Guide &amp; Curriculum Presets
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    store.setHelpModalTab('shortcuts');
                  }}
                >
                  <span className="menu-item-left">Keyboard Shortcuts</span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    store.setHelpModalTab('about');
                  }}
                >
                  <span className="menu-item-left">
                    About AntWordProfiler Web
                  </span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </header>
  );
};


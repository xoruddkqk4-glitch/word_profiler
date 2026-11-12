import React, { useMemo } from 'react';
import {
  GitBranch,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';

export const AiLexicalPanel: React.FC = () => {
  const store = useProfilerStore();
  const profile = store.activeProfile;
  const span = store.selectedTokenSpan;
  const hasApiKey = Boolean(store.openRouterConfig.apiKey.trim());

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

  const isMultiWordSpan = Boolean(
    span && span.endTokenIdx > span.startTokenIdx,
  );

  if (!hasApiKey) {
    return (
      <div className="ai-panel-wrap">
        <div className="ai-onboarding-card">
          <div className="ai-onboarding-icon">
            <KeyRound size={20} />
          </div>
          <h4 className="ai-onboarding-title">OpenRouter API 연결 필요</h4>
          <p className="ai-onboarding-desc">
            서버·데이터베이스 없이 브라우저에서 직접 OpenRouter 모델을 호출하여
            Word List 안의 추천 단어와 패러프레이즈 문장을 만듭니다.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm ai-full-btn"
            onClick={() => store.setSettingsModalOpen(true, 'ai')}
          >
            <Settings2 size={15} /> OpenRouter API 키 설정하기
          </button>
        </div>
      </div>
    );
  }

  const morph = store.morphologyResult;
  const modalBusy = store.aiLoading && store.aiSuggestionModalOpen;
  const morphBusy = store.aiLoading && !store.aiSuggestionModalOpen;

  return (
    <div className="ai-panel-wrap">
      <div className="ai-controls-box">
        <div className="ai-level-cap-note">
          검증 기준: 왼쪽 Reference Lists의 활성 단어장{' '}
          <strong>{activeRefs.length}개</strong>
          {activeRefs.length > 0 && (
            <> ({activeRefs.map((r) => r.name).join(', ')})</>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary ai-full-btn ai-launch-btn"
          disabled={
            !span || !profile || modalBusy || activeRefs.length === 0
          }
          onClick={() => void store.openAiSuggestionModal()}
        >
          <Sparkles size={16} />
          <span>
            {isMultiWordSpan
              ? '선택 표현 AI 추천 (단어 3 + 문장 3)'
              : 'AI 추천 (단어 3 + 문장 3)'}
          </span>
        </button>

        {morphBusy ? (
          <button
            type="button"
            className="btn btn-sm ai-full-btn"
            onClick={store.cancelAiRequest}
          >
            <Loader2 size={15} className="ai-spin" />
            <span>어근·기본형 분석 중… (취소)</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm ai-full-btn"
            disabled={
              !span ||
              !profile ||
              isMultiWordSpan ||
              store.aiLoading ||
              activeRefs.length === 0
            }
            onClick={() => void store.runAiMorphologyCheck()}
          >
            <GitBranch size={14} />
            <span>어근·기본형 및 리스트 등재 확인</span>
          </button>
        )}
      </div>

      {store.aiError && !store.aiSuggestionModalOpen && (
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

      <div className="ai-results-scroll">
        {!span || !profile ? (
          <div className="empty-hint-box">
            <span>
              본문에서 단어를 클릭하거나 표현을 드래그한 뒤 AI 추천을 누르면,
              추천 단어와 패러프레이즈 문장을 한 창에서 함께 보여 줍니다.
            </span>
          </div>
        ) : morph ? (
          <div className="ai-card-stack">
            <div className="ai-summary-card">
              <div className="ai-summary-head">
                <span className="ai-pos-pill">{morph.contextPos}</span>
                <button
                  type="button"
                  className="mini-icon-btn"
                  title="다시 분석"
                  aria-label="다시 분석"
                  onClick={() => void store.runAiMorphologyCheck()}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="ai-summary-prose">{morph.explanationKo}</p>
            </div>

            {morph.candidates.length === 0 ? (
              <div className="empty-hint-box">
                <span>추출된 파생·어근 후보가 없습니다.</span>
              </div>
            ) : (
              morph.candidates.map((cand) => {
                const swatch = cand.status.listId
                  ? refColorMap.get(cand.status.listId)
                  : undefined;
                return (
                  <div
                    key={`${cand.relation}-${cand.form}`}
                    className="ai-result-card"
                  >
                    <div className="ai-card-top">
                      <div className="ai-word-group">
                        <span className="ai-candidate-word">{cand.form}</span>
                        <span className="ai-relation-tag">
                          {cand.relationLabelKo}
                        </span>
                      </div>
                      {cand.status.inActiveList ? (
                        <span className="ai-level-badge" data-in-cap="true">
                          {swatch && (
                            <span
                              className="ai-swatch-dot"
                              style={{ backgroundColor: swatch }}
                            />
                          )}
                          L{cand.status.statLevelNumber} · {cand.status.listName}
                        </span>
                      ) : cand.status.kind === 'ignored' ? (
                        <span className="ai-level-badge">Ignored</span>
                      ) : (
                        <span className="ai-level-badge" data-out="true">
                          미등재 (Out)
                        </span>
                      )}
                    </div>
                    {cand.noteKo && <p className="ai-card-note">{cand.noteKo}</p>}
                    {(cand.status.masterHeadword ||
                      cand.status.inactiveListMatchName) && (
                      <div className="ai-meta-hints">
                        {cand.status.masterHeadword && (
                          <span>
                            Master 패밀리 표제어:{' '}
                            <strong>{cand.status.masterHeadword}</strong>
                          </span>
                        )}
                        {cand.status.inactiveListMatchName && (
                          <span>
                            비활성 리스트 등재:{' '}
                            <strong>{cand.status.inactiveListMatchName}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="empty-hint-box">
            <span>
              선택: <strong>&ldquo;{span.rawText}&rdquo;</strong>
              <br />
              AI 추천 버튼을 누르면 Word List 단어만으로 된 추천 단어 3개와
              패러프레이즈 문장 3개를 모달에서 함께 확인할 수 있습니다.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

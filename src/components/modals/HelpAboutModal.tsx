import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';

export const HelpAboutModal: React.FC = () => {
  const tab = useProfilerStore((s) => s.helpModalTab);
  const setTab = useProfilerStore((s) => s.setHelpModalTab);

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTab(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, setTab]);

  if (!tab) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setTab(null);
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <div className="modal-header">
          <div className="modal-toolbar-row">
            <h2 id="help-modal-title" className="modal-title">
              Help &amp; Reference
            </h2>
            <div className="stats-subtabs-list">
              <button
                type="button"
                className="subtab-pill"
                data-active={tab === 'guide'}
                onClick={() => setTab('guide')}
              >
                User Guide
              </button>
              <button
                type="button"
                className="subtab-pill"
                data-active={tab === 'shortcuts'}
                onClick={() => setTab('shortcuts')}
              >
                Shortcuts
              </button>
              <button
                type="button"
                className="subtab-pill"
                data-active={tab === 'about'}
                onClick={() => setTab('about')}
              >
                About
              </button>
            </div>
          </div>

          <button
            type="button"
            className="mini-icon-btn"
            aria-label="닫기"
            onClick={() => setTab(null)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {tab === 'guide' && (
            <div className="help-section-list">
              <div>
                <h3 className="help-section-heading">1. 기본 워크플로우</h3>
                <p className="help-prose">
                  상단 우측 <strong>Preset</strong>에서 기준 단어장을 선택하거나 좌측{' '}
                  <strong>Reference Lists &gt; Add</strong>에서 내장·사용자 단어장을
                  추가한 뒤, 에디터 툴바의 <strong>Open</strong>(또는 드래그 앤 드롭)으로{' '}
                  <code>.txt</code> · <code>.docx</code> · <code>.pdf</code> 문서를
                  불러오거나 <strong>Inline Text</strong>에 지문을 입력해{' '}
                  <strong>Start (F5)</strong>를 실행합니다. 좌측의{' '}
                  <strong>List Words / Non-List Words</strong> 토글로 등재 어휘 레벨별 색상
                  보기와 미등재 어휘 집중 보기를 즉시 전환할 수 있습니다. 하나의 세트{' '}
                  <code>.txt</code> 파일 안에 구분선(<code>---</code>, <code>===</code>),
                  문항 헤더(<code>[18]</code>, <code>#1</code>, <code>문항 1</code>), 또는
                  빈 줄 2줄 이상으로 여러 문항을 넣어 불러오면 <strong>이전 문항 / 다음 문항</strong>{' '}
                  버튼으로 지문 간 빠른 이동과 개별 수정·Word Count 확인이 가능합니다.
                </p>
              </div>

              <div>
                <h3 className="help-section-heading">
                  2. 내장 프리셋 안내 (GSL/AWL · 2015 · 2022 개정 영어과 교육과정)
                </h3>
                <ul className="help-list">
                  <li>
                    <strong>Standard GSL + AWL</strong>: West의 일반빈출어휘(GSL 1st/2nd
                    1,000)와 Coxhead의 학술어휘(AWL 570) 표준 3단계 패밀리.
                  </li>
                  <li>
                    <strong>2022 개정 교육과정 (초등·중학·고등)</strong>:{' '}
                    <code>1_2022_초등</code>(819) · <code>2_2022_중학</code>(1,215) ·{' '}
                    <code>3_2022_고등</code>(1,249) 및 AWL 결합 프리셋.{' '}
                    <strong>Master Family</strong> 확장을 켜면 굴절·파생형까지 함께
                    매칭됩니다.
                  </li>
                  <li>
                    <strong>2015 개정 교육과정 (어휘 패밀리 1~3단계 &amp; 학교급별)</strong>:{' '}
                    <code>4_basewrd1~3</code> 3,000 어휘 패밀리 및{' '}
                    <code>8_baseword5_초등</code>(801) · <code>9_baseword6_중등</code>(1,850) ·{' '}
                    <code>10_baseword7_전문</code>(400).
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="help-section-heading">
                  3. AI 어휘 추천 (Google Gemini 무료 API · OpenRouter) &amp; 예외 어휘 처리
                </h3>
                <p className="help-prose">
                  본문 단어를 클릭하거나 구문을 드래그한 뒤 우측{' '}
                  <strong>AI 어휘 도우미</strong>(또는 우클릭 메뉴)에서{' '}
                  <strong>AI 추천</strong>을 실행하면 활성 Word List 단어만으로 구성된
                  대체 단어와 패러프레이즈 문장을 모달에서 비교·교체할 수 있습니다. 미등재
                  고유명사·예외 어휘는 <strong>Add to Ignore List</strong> 또는{' '}
                  <strong>Ignore</strong> 탭 붙여넣기로 즉시 제외 처리할 수 있습니다.
                </p>
              </div>
            </div>
          )}

          {tab === 'shortcuts' && (
            <table className="stats-grid-table">
              <thead>
                <tr>
                  <th>단축키 / 조작</th>
                  <th>동작 설명</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">F5</td>
                  <td>현재 지문 프로파일 새로고침 (Start)</td>
                </tr>
                <tr>
                  <td className="mono">Ctrl + O / Cmd + O</td>
                  <td>타겟 지문 파일(.txt, .docx, .pdf) 열기</td>
                </tr>
                <tr>
                  <td className="mono">Ctrl + F / Cmd + F</td>
                  <td>File Profiler 내 단어/정규식 검색창 포커스</td>
                </tr>
                <tr>
                  <td className="mono">Enter / Shift + Enter</td>
                  <td>검색창에서 다음 / 이전 일치 단어로 이동</td>
                </tr>
                <tr>
                  <td className="mono">Alt + ← / Alt + →</td>
                  <td>복수 문항 세트 .txt에서 이전 문항 / 다음 문항으로 이동</td>
                </tr>
                <tr>
                  <td className="mono">Ctrl + Z / Ctrl + Y</td>
                  <td>현재 문서 편집 및 AI 교체 실행 취소 / 다시 실행</td>
                </tr>
                <tr>
                  <td className="mono">Click / Re-Click (본문 단어)</td>
                  <td>단어 선택 및 선택된 단어 재클릭 시 선택 해제</td>
                </tr>
                <tr>
                  <td className="mono">전체 복사 / 선택 복사 (Ctrl + C)</td>
                  <td>글자 서식(글자색 + 굵기 Bold)을 보존하여 Word·한글에 붙여넣기 가능하도록 복사</td>
                </tr>
                <tr>
                  <td className="mono">Drag / Right Click (본문)</td>
                  <td>구문 선택, AI 추천 모달 실행, 어근 분석 및 Ignore 추가/제거</td>
                </tr>
                <tr>
                  <td className="mono">Drag &amp; Drop (파일)</td>
                  <td>분석 지문(.txt/.docx/.pdf) 또는 단어장(.txt/.tsv/.lst) 영역별 추가</td>
                </tr>
              </tbody>
            </table>
          )}

          {tab === 'about' && (
            <div className="help-section-list">
              <div className="help-section-heading">
                AntWordProfiler Web Implementation (v2.2.1-web.1)
              </div>
              <p className="help-prose">
                본 웹 애플리케이션은 Laurence Anthony 교수(AntLab Solutions, Waseda
                University)의 데스크톱 어휘 프로파일링 도구{' '}
                <strong>AntWordProfiler 2.2.1</strong>(Released June 2, 2024)의 코어 분석
                규칙·통계 구조·입출력 포맷을 참고하여 100% 브라우저 로컬 환경용으로 구현한
                웹 워크벤치입니다.
              </p>
              <p className="help-prose">
                모든 문서 파싱(<code>.txt</code>, <code>.docx</code>, <code>.pdf</code>),
                Web Worker 어휘 인덱싱, 6종 코퍼스 통계 집계 및 컬러 Word/Excel 내보내기는
                외부 서버 전송 없이 사용자의 브라우저 내부에서만 실행됩니다.
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setTab(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

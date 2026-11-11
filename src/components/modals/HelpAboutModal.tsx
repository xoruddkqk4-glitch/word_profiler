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
                  상단 우측 <strong>Preset</strong>에서 기준 단어장을 선택한 뒤, 좌측{' '}
                  <strong>Target Files</strong>에 <code>.txt</code> · <code>.docx</code> ·{' '}
                  <code>.pdf</code> 문서를 추가하거나 중앙 에디터에 영문 지문을 붙여넣고{' '}
                  <strong>Start (F5)</strong>를 실행합니다. 좌측의{' '}
                  <strong>List Words / Non-List Words</strong> 토글로 등재 어휘 레벨별 색상
                  보기와 미등재(범위 외) 어휘 집중 보기를 즉시 전환할 수 있습니다.
                </p>
              </div>

              <div>
                <h3 className="help-section-heading">
                  2. 내장 프리셋 안내 (GSL/AWL &amp; 2015 개정 영어과 교육과정)
                </h3>
                <ul className="help-list">
                  <li>
                    <strong>Standard GSL + AWL</strong>: West의 일반빈출어휘(GSL 1st/2nd
                    1,000)와 Coxhead의 학술어휘(AWL 570) 표준 3단계 패밀리.
                  </li>
                  <li>
                    <strong>2015 개정 교육과정 (어휘 패밀리 1~3단계)</strong>:{' '}
                    <code>4_basewrd1</code>(기초 800) · <code>5_basewrd2</code>(기본 1,200) ·{' '}
                    <code>6_basewrd3</code>(심화 1,000)로 구성된 총 3,000 어휘 패밀리(굴절·파생형 포함).
                  </li>
                  <li>
                    <strong>2015 개정 교육과정 (초등·중등·전문)</strong>:{' '}
                    <code>8_baseword5_초등</code>(801) · <code>9_baseword6_중등</code>(1,850) ·{' '}
                    <code>10_baseword7_전문</code>(400). <strong>Master Family</strong> 확장을 켜면
                    복수형·과거형 등 굴절형까지 자동 매칭됩니다.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="help-section-heading">
                  3. 고유명사·예외 어휘 처리 (Extra Ignore Words)
                </h3>
                <p className="help-prose">
                  본문 내 미등재 단어를 클릭하거나 우클릭하여{' '}
                  <strong>Add to Ignore List</strong>를 실행하면 즉시 예외 어휘로 분류되어
                  커버리지 계산에 반영됩니다. 우측 <strong>Extra Ignore Words</strong> 영역에
                  임의 문장을 붙여넣으면 기존 레벨 리스트에 없는 미등재 단어만 자동 선별하여
                  등록합니다.
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
                  <td className="mono">Double Click (Target File)</td>
                  <td>선택한 타겟 파일을 File Profiler에 로드 및 분석</td>
                </tr>
                <tr>
                  <td className="mono">Right Click (본문 단어)</td>
                  <td>단어 레벨 확인 및 Extra Ignore Words 즉시 추가/제거</td>
                </tr>
                <tr>
                  <td className="mono">Drag &amp; Drop</td>
                  <td>창 어디서든 .txt / .docx / .pdf 지문 일괄 추가</td>
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

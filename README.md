# AntWordProfiler Web (v2.2.1-web.1)

`AntWordProfiler 2.2.1` 데스크톱 프로그램의 어휘 분석·통계 규칙과 **2015·2022 개정 영어과 교육과정 어휘 목록**을 기반으로 구현된 100% 브라우저 로컬(Local-First) 영어 코퍼스·어휘 레벨 프로파일링 웹 애플리케이션입니다.

모든 파일 파싱(`.txt`, `.docx`, `.pdf`), Web Worker 어휘 인덱싱, 6종 코퍼스 통계 집계 및 컬러 Word/Excel 내보내기는 외부 서버 전송 없이 사용자의 브라우저 내부에서만 실행됩니다. (선택 기능인 OpenRouter AI 어휘 도우미 또한 백엔드 서버 없이 사용자가 입력한 API 키로 브라우저에서 직접 호출하며, 단어장 검증은 로컬 `lexiconVerifier`로 결정론적 대조를 수행합니다.)

---

## 주요 기능

### 1. 즉시 사용 가능한 8종 내장 프리셋 (`public/wordlists/`)
1. **Standard GSL + AWL**: `1_gsl_1st_1000`, `2_gsl_2nd_1000`, `3_awl_570` 표준 3단계 패밀리
2. **2022 개정 교육과정 — 학교급별 (초등·중학·고등 + 패밀리 확장)**: `1_2022_초등`(819) · `2_2022_중학`(1,215) · `3_2022_고등`(1,249) + 내장 `Master Family`(3,463 패밀리 / 27,410 어형) 연동
3. **2022 개정 교육과정 — 학교급별 (원형 일치)**: 초등·중학·고등 기본형 정확 일치 모드
4. **2022 교육과정 (초·중·고 패밀리) + AWL 학술어휘**: 2022 학교급 패밀리 + AWL 570 결합 프리셋
5. **2015 개정 교육과정 — 어휘 패밀리 1~3단계**: `4_basewrd1`(기초 800) · `5_basewrd2`(기본 1,200) · `6_basewrd3`(심화 1,000) 총 3,000 어휘 패밀리
6. **2015 개정 교육과정 — 학교급별 (초등·중등·전문 + 패밀리 확장)**: `8_baseword5_초등`(801) · `9_baseword6_중등`(1,850) · `10_baseword7_전문`(400) + 내장 `Master Family` 연동 (`2015word_list_all` 3,051어 주석본 포함)
7. **2015 개정 교육과정 — 학교급별 (원형 일치)**: 초등·중등·전문 기본형 정확 일치 모드
8. **2015 교육과정 패밀리 + AWL 학술어휘**: 2015 교육과정 3,000 패밀리 + AWL 570 결합 프리셋

### 2. File Profiler (지문 프로파일링 & 인라인 편집)
- `.txt`(UTF-8 / EUC-KR 스마트 디코딩), `.docx`(`mammoth`), `.pdf`(`pdfjs-dist`) 드래그 앤 드롭 및 폴더 일괄 로드 지원
- 유니코드 정규식 기반 무손실 토큰화(`leadingWs` / `trailingWs` 원문 공백·개행 100% 보존)
- 실시간 색상 하이라이트 (`List Words` 레벨별 색상 보기 ↔ `Non-List Words` 미등재 어휘 집중 보기 전환)
- `Profiled` / `Edit Text` 세그먼트 전환, 인라인 Undo/Redo 히스토리, 정규식·단어 검색(`Ctrl+F`, `Enter` / `Shift+Enter`), 본문 글꼴 크기 조절(`14px ~ 32px`, 기본 `18px`)
- **Selection Inspector & Extra Ignore Words**: 단어 클릭 시 출현 빈도·비율·레벨·대표어(`Headword`) 즉시 조회, 본문 우클릭 예외 어휘 등록, 문장 붙여넣기 시 기존 레벨 리스트에 없는 미등재 단어만 자동 추출
- 레벨 색상이 보존된 Word(`.docx`), 단독 실행 `.html`, 순수 텍스트(`.txt`) 내보내기

### 3. Statistics Viewer (6종 코퍼스 통계 & 가상 테이블)
- 원본 `AntWordProfiler 2.2.1` 스키마와 호환되는 6개 통계 시트 생성:
  - `Input File Stats`, `Level List Stats`, `Coverage Stats`(레벨 오름차순 정렬 시 누적 `_agg_%` 자동 표시), `Range Stats`, `Input File Type Stats`, `Input File Headword Stats`
- 대용량 어휘 목록을 위한 가상 스크롤 테이블(`VirtualStatsTable`, `ROW_HEIGHT = 38px`), 다중 조건 필터링(`keyword`, `level`, `range`), 클립보드 TSV 복사, 단일 탭 `.tsv` 및 6개 시트 통합 Excel(`.xlsx`) 내보내기

### 4. 단어장 검증 및 설정 호환성
- 활성 레벨 리스트 간 중복 어형 검사(`Validate Level Lists`)
- 단어장 그룹 `Rows`(`.txt`/`.zip`) 및 `Paul Nation Trees` 포맷 내보내기
- 데스크톱 `AntWordProfiler` `.ini` 및 웹 `.json` 설정 파일 가져오기/내보내기 (OpenRouter API 키는 내보내기 파일에 포함하지 않음)
- **Tailwind CSS v4 + OKLCH 라이트/다크 테마 시스템**: `Poppins` + `Noto Sans KR` + `Roboto Mono` 타이포그래피, WCAG 2.1 AA 명도 대비, 키보드 접근성(`F5`, `Ctrl+O`, `Ctrl+F`, 모달 `Escape`, 스플리터 방향키 조절) 지원

### 5. OpenRouter 기반 AI 어휘 도우미 (`src/ai/`)
- **브라우저 직접 호출 및 로컬 사전 검증**: 백엔드 서버·DB 없이 브라우저에서 OpenRouter API를 직접 호출하며, 모든 추천 후보와 패러프레이즈 토큰은 로컬 `lexiconVerifier`로 활성 단어장 등재 여부를 결정론적으로 대조 검증합니다.
- **통합 AI 어휘 추천 모달 (`AiSuggestionModal`)**: 선택한 단어/표현의 문맥을 분석해 활성 Word List 내 추천 단어(최대 3개)와 패러프레이즈 문장(최소 1~최대 3문장 보장)을 생성하며, 대형 창(`min(1620px, 94vw)`), 상단 헤더 포인터 드래그 이동(더블클릭 시 중앙 복귀), CSS Grid `subgrid` 기반 좌·우 카드 행렬(오와 열) 정렬을 제공합니다.
- **응답 안정성 & 고속화**: `<think>` 블록·코드 펜스·제어문자·잘린 배열 다단계 JSON 복구 파서(`extractJsonObjectFromText`), OpenRouter `provider.sort: "throughput"` 라우팅 및 `reasoning: { effort: "minimal", exclude: true }` 경량화, 모델별 HTTP 400 호환성 캐시, 동일 조건 재조회 시 0ms 즉시 표시하는 세션 캐시(최대 32건)를 지원합니다.
- **어근·기본형 형태소 대조 (`analyzeMorphologyAndRoots`)**: 선택 단어의 문맥 품사 및 기본형·파생 기반어·어근의 활성 단어장 등재 여부를 즉시 대조합니다.

---

## 기술 스택 및 디렉터리 구조

- **프레임워크 / 언어 / 테스트**: Vite 6, React 19, TypeScript 5.8, Zustand 5, Vitest 3
- **스타일링**: Tailwind CSS v4 (`@tailwindcss/vite`), OKLCH CSS Custom Properties (`src/styles/tokens.css`, `src/styles/workspace.css`)
- **문서 입출력**: `mammoth` (`.docx` 읽기), `pdfjs-dist` (`.pdf` 읽기), `docx` (컬러 `.docx` 생성), `xlsx` (다중 시트 `.xlsx` 생성), `jszip` (단어장 아카이브)
- **구조**:
  - `src/core/`: 무손실 토크나이저, 단어장/패밀리 파서, 프로파일러, 6종 통계 계산기, 중복 검증기, WCAG 색상 팔레트
  - `src/ai/`: OpenRouter 클라이언트, 결정론적 로컬 어휘 검증기(`lexiconVerifier`), AI 어휘/패러프레이즈/형태소 서비스
  - `src/workers/`: 메인 스레드 블로킹 방지를 위한 Web Worker 파이프라인
  - `src/io/`: 브라우저 로컬 파일 리더 및 `.docx`/`.html`/`.txt`/`.tsv`/`.xlsx`/`.ini` 익스포터
  - `src/components/`: `layout/`, `profiler/`, `stats/`, `modals/` 3패널 워크벤치 UI
  - `start.bat`: Windows 환경 원클릭 로컬 서버 기동 및 브라우저 자동 실행 스크립트

---

## 실행 및 검증 방법

Windows에서 `start.bat`을 더블클릭하면 의존성 확인 후 로컬 Vite 서버를 기동하고 기본 브라우저로 앱을 엽니다. (ES 모듈·Web Worker·`fetch` 보안 정책상 `index.html`의 `file://` 직접 열기는 지원되지 않습니다.)

```powershell
npm install
npm run dev
```

정적 타입 검증 및 단위·회귀 테스트:
```powershell
npm run type-check
npm test
```

프로덕션 빌드:
```powershell
npm run build
```

---

## 변경 이력 (Changelog)

## [2026-11-11 14:12] 업데이트 이력 (Commit ID: `45a3ecd`)
- **수정 내용**:
  - **로컬 퍼스트 웹 애플리케이션 전체 구현**: `AntWordProfiler 2.2.1` 코어 분석·통계 엔진(유니코드 무손실 토큰화, `Row`/`Paul Nation Tree` 자동 감지, 교육과정 주석 기호 `*`/`**` 정규화, 3,461 패밀리 `Master Family` 형태소 확장, 6종 코퍼스 통계 집계, 레벨 간 중복 어형 검증) 및 Web Worker 비동기 파이프라인, `.txt`/`.docx`/`.pdf` 로컬 파서, 컬러 `.docx`/`.html`/`.xlsx`/`.ini` 입출력 어댑터, 5종 내장 프리셋(`GSL/AWL` 및 `2015 개정 영어과 교육과정`) 구축.
  - **Tailwind CSS v4 OKLCH 테마 및 Impeccable 25대 기준 UI/UX 고도화**:
    - 사용자 지정 OKLCH 라이트/다크 디자인 토큰(`src/styles/tokens.css`) 및 시맨틱 브리지(`src/styles/workspace.css`) 적용, 영문 `Poppins`와 한글 `Noto Sans KR` 병행 로드로 한·영 가독성 통일.
    - **발생 문제 및 해결 1 (세그먼트 버튼 깨짐)**: Tailwind v4 Preflight의 `svg { display: block }` 규칙과 고정 폭(`172px`)·비-flex 버튼 스타일이 충돌해 `Profiled` / `Edit Text` 아이콘과 텍스트가 2줄로 넘치던 현상을 `.segmented-btn` `inline-flex` 정렬 및 고정 폭/인라인 `verticalAlign` 제거로 원천 해결.
    - **발생 문제 및 해결 2 (사이드바 줄바꿈 및 가로 스크롤 잘림)**: 좌측 사이드바 기본 폭을 `396px`(`344~580px`)로 확대하고 `Count: N`을 `.count-badge`로 축약했으며, `CoverageRow`를 2단 행 구조(상단 이름·조작 버튼 / 하단 풀폭 진행 바·퍼센트)로 재설계하여 우측 버튼 잘림과 가로 스크롤바 제거.
    - **발생 문제 및 해결 3 (번들러 모듈 해석 및 전반적 저가독성)**: Vite 환경의 `mammoth` 정규식 정확 일치 alias 및 `pdfjs-dist` `?url` 워커 번들링을 구성하고, 앱 전반의 `11~12px` 미세 텍스트와 인라인 치수 하드코딩을 제거하여 최소 `13px`·기본 UI/테이블 `14~15px`·섹션 제목 `16px`·본문 기본 `18px`(`VirtualStatsTable` `ROW_HEIGHT = 38` 동기화 포함)로 전면 확대.
- **검증 결과**:
  - 코어 엔진 정합성 검증 통과: 원문 공백 무손실 복원 일치, 교육과정 학교급 어휘 `Master Family` 확장(`3,052` 기본형 → `24,761` 어형), 6종 통계 시트 토큰·타입 합산 일치 확인.
  - TypeScript 정적 타입 검사 통과: `npx tsc --noEmit` (`Exit Code 0`, 오류 0건).
  - Impeccable 정적 디자인 안티패턴 스캔 통과: `impeccable.cmd detect .` (37개 파일 스캔, 안티패턴 0건).

## [2026-11-16 15:23] 업데이트 이력 (Commit ID: `f67a886`)
- **수정 내용**:
  - **코드베이스 전수 정합성 개선 및 에이전트 워크플로우 구성**:
    - `2015word_list_all.txt` 누락 어휘 복원(`3,036 → 3,051`행) 및 불필요한 0바이트 내장 파일 제거, `wordlistParser`·`statsCalculator`·`listValidator`·`colorPalette`·`profiler.worker`·`fileReaders`(PDF 리소스 정리·오류 포맷)·`docExporters`(`copyTextSafe`)·`settingsIniAdapter`(글꼴 크기 `[14, 32]` 클램핑)·`useProfilerStore`·모달 접근성 및 GitHub Pages 워크플로우 전반 정비.
    - Windows 환경에서 `file://` 직접 실행 제약 없이 로컬 개발 서버와 브라우저를 원클릭으로 기동하는 `start.bat` 추가 및 `AGENTS.md` 아키텍처·검증 규칙 문서화.
  - **발생 문제 및 해결 1 (OpenRouter AI 응답 JSON 파싱 실패)**:
    - 추론(thinking) 모델의 `<think>` 블록, 닫히지 않은 마크다운 펜스, 문자열 리터럴 내부 줄바꿈, 토큰 한도 잘림으로 `'AI 응답을 JSON 형식으로 해석하지 못했습니다.'` 오류가 발생하던 문제를 `extractJsonObjectFromText` 다단계 정제·구제 파서와 자동 JSON 재시도·HTTP 400 호환 폴백으로 해결.
  - **발생 문제 및 해결 2 (AI 추천 창 크기 제한·위치 고정 및 패러프레이즈 0건 반환)**:
    - `.modal-card`(`max-width: 720px`)가 `.ai-suggestion-modal`을 덮어쓰던 CSS 우선순위를 수정해 창 크기를 약 2.5배(`min(1620px, 94vw) × min(820px, 86vh)`)로 확대하고, 상단 헤더 포인터 드래그 이동(경계 클램핑·더블클릭 중앙 복귀)을 구현.
    - 모든 패러프레이즈에 리스트 외 단어가 1개라도 있으면 전부 폐기되어 `0/3`이 되던 문제를 5단계 폴백 파이프라인(100% 리스트 내 우선 → 최소 리스트 외 단어 정렬 및 정직한 비율·물결 밑줄 표시 → 경량 구조 요청 → 검증된 추천 어휘 치환 합성 → 원문 기준 문장 보장)으로 개선해 항상 최소 1문장 이상 제안을 보장.
  - **발생 문제 및 해결 3 (좌·우 추천 카드 높이 불일치 및 응답 지연)**:
    - 좌측 추천 단어와 우측 패러프레이즈의 내부 요소 순서를 4단(`제목/배지 → 한글 설명 → 영어 문장 박스 → 실행 버튼`)으로 통일하고 `.ai-matrix-pair-row` + CSS `subgrid`를 적용해 1~3번 행의 오와 열을 정렬.
    - OpenRouter `provider.sort: 'throughput'` 및 `reasoning: { effort: 'minimal', exclude: true }` 적용, 모델별 HTTP 400 호환성 기억, 불필요한 1.5MB `builtin_master_families` 선로딩 제거(`includeExtendedMetadata: false`), 후보 수 최적화(`5단어 + 3문장`) 및 중복 보정 왕복 제거, 32건 세션 캐시(0ms 재오픈)로 추천 체감 속도를 대폭 단축.
- **검증 결과**:
  - TypeScript 정적 타입 검사 통과: `npm run type-check` (`npx tsc --noEmit`, Exit Code 0, 오류 0건).
  - 단위 및 회귀 테스트 통과: `npm test` (`npx vitest run`, 7개 테스트 파일 / 31개 테스트 전원 통과: `wordlistParser`, `statsCalculator`, `lexiconVerifier`, `openRouterClient`, `lexicalAssistantService`, `settingsIniAdapter`, `useProfilerStore`).
  - UI 정적 디자인 스캔 통과: `impeccable.cmd detect .` (50개 파일 스캔 통과).

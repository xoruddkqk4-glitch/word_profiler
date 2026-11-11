# AntWordProfiler Web (v2.2.1-web.1)

`AntWordProfiler 2.2.1` 데스크톱 프로그램의 어휘 분석·통계 규칙과 **2015 개정 영어과 교육과정 어휘 목록**을 기반으로 구현된 100% 브라우저 로컬(Local-First) 영어 코퍼스·어휘 레벨 프로파일링 웹 애플리케이션입니다.

모든 파일 파싱(`.txt`, `.docx`, `.pdf`), Web Worker 어휘 인덱싱, 6종 코퍼스 통계 집계 및 컬러 Word/Excel 내보내기는 외부 서버 전송 없이 사용자의 브라우저 내부에서만 실행됩니다.

---

## 주요 기능

### 1. 즉시 사용 가능한 5종 내장 프리셋 (`public/wordlists/`)
1. **Standard GSL + AWL**: `1_gsl_1st_1000`, `2_gsl_2nd_1000`, `3_awl_570` 표준 3단계 패밀리
2. **2015 개정 교육과정 — 어휘 패밀리 1~3단계**: `4_basewrd1`(기초 800) · `5_basewrd2`(기본 1,200) · `6_basewrd3`(심화 1,000) 총 3,000 어휘 패밀리
3. **2015 개정 교육과정 — 학교급별 (초등·중등·전문 + 패밀리 확장)**: `8_baseword5_초등`(801) · `9_baseword6_중등`(1,850) · `10_baseword7_전문`(400) + 내장 `Master Family`(3,461 패밀리 사전 연동, 단일 기본형 `3,052`개를 `24,761`개 굴절·파생 어형으로 자동 확장)
4. **2015 개정 교육과정 — 학교급별 (원형 일치)**: 초등·중등·전문 기본형 정확 일치 모드
5. **2015 교육과정 패밀리 + AWL 학술어휘**: 교육과정 3,000 패밀리 + AWL 570 결합 프리셋

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
- 데스크톱 `AntWordProfiler` `.ini` 및 웹 `.json` 설정 파일 가져오기/내보내기
- **Tailwind CSS v4 + OKLCH 라이트/다크 테마 시스템**: `Poppins` + `Noto Sans KR` + `Roboto Mono` 타이포그래피, WCAG 2.1 AA 명도 대비, 키보드 접근성(`F5`, `Ctrl+O`, `Ctrl+F`, 모달 `Escape`, 스플리터 방향키 조절) 지원

---

## 기술 스택 및 디렉터리 구조

- **프레임워크 / 언어**: Vite 6, React 19, TypeScript 5.8, Zustand 5
- **스타일링**: Tailwind CSS v4 (`@tailwindcss/vite`), OKLCH CSS Custom Properties (`src/styles/tokens.css`, `src/styles/workspace.css`)
- **문서 입출력**: `mammoth` (`.docx` 읽기), `pdfjs-dist` (`.pdf` 읽기), `docx` (컬러 `.docx` 생성), `xlsx` (다중 시트 `.xlsx` 생성), `jszip` (단어장 아카이브)
- **구조**:
  - `src/core/`: 무손실 토크나이저, 단어장/패밀리 파서, 프로파일러, 6종 통계 계산기, 중복 검증기, WCAG 색상 팔레트
  - `src/workers/`: 메인 스레드 블로킹 방지를 위한 Web Worker 파이프라인
  - `src/io/`: 브라우저 로컬 파일 리더 및 `.docx`/`.html`/`.txt`/`.tsv`/`.xlsx`/`.ini` 익스포터
  - `src/components/`: `layout/`, `profiler/`, `stats/`, `modals/` 3패널 워크벤치 UI

---

## 실행 및 검증 방법

```powershell
npm install
npm run dev
```

정적 타입 검증:
```powershell
npx tsc --noEmit
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

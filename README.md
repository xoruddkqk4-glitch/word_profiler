# AntWordProfiler Web (v2.2.1-web.1)

`AntWordProfiler 2.2.1` 데스크톱 프로그램 및 **2015 개정 영어과 교육과정 어휘 목록**을 기반으로 구현된 100% 브라우저 로컬(Local-First) 영어 코퍼스·어휘 레벨 프로파일링 웹 애플리케이션입니다.

## 주요 기능
- **즉시 사용 가능한 5종 내장 프리셋**:
  1. `Standard GSL + AWL` (`1_gsl_1st_1000`, `2_gsl_2nd_1000`, `3_awl_570`)
  2. `2015 개정 교육과정 — 어휘 패밀리 1~3단계` (`4_basewrd1` [800], `5_basewrd2` [1,200], `6_basewrd3` [1,000])
  3. `2015 개정 교육과정 — 학교급별 (초등·중등·전문 + 패밀리 확장)` (`8_baseword5_초등`, `9_baseword6_중등`, `10_baseword7_전문` + `Master Family` 3,461 패밀리 사전 연동)
  4. `2015 개정 교육과정 — 학교급별 (원형 일치)`
  5. `2015 교육과정 패밀리 + AWL 학술어휘`
- **File Profiler**:
  - `.txt`(UTF-8 / EUC-KR 자동 감지), `.docx`, `.pdf` 드래그앤드롭 및 폴더 일괄 로드, 인라인 텍스트 편집 지원
  - 원문 공백·개행(`token_ws`) 무손실 보존 실시간 색상 하이라이트 (`List Words` / `Non-List Words` 전환)
  - 단어 클릭 인스펙터(`Count`, `%`, `Level`, `Headword`), 우클릭 `Ignore` 즉시 추가, `Extra Ignore Words` 스마트 붙여넣기(레퍼런스 기등재 어휘 자동 제외)
  - 레벨 색상이 보존된 `.docx`, 단독 `.html`, `.txt` 내보내기
- **Statistics Viewer (6종 코퍼스 통계)**:
  - `Input File Stats`, `Level List Stats`, `Coverage Stats`(정렬 시 누적 `%` 자동 토글), `Range Stats`, `Input File Type Stats`, `Input File Headword Stats`
  - 대용량 가상 스크롤 테이블, 실시간 필터링, 클립보드 복사, 단일 탭 `.tsv` 및 6개 시트 통합 `.xlsx` 내보내기
- **단어장 검증 및 호환성**:
  - 활성 레벨 리스트 간 중복 어형 검출(`Validate Level Lists`), `Rows` / `Paul Nation Trees` 내보내기, 원본 `.ini` 및 `.json` 설정 파일 가져오기/내보내기

## 실행 및 검증 방법

```powershell
cd c:\Users\user\Desktop\REA\.project\antwordprofiler
npm install
npm run dev
```

정적 타입 검증:
```powershell
npx tsc --noEmit
```


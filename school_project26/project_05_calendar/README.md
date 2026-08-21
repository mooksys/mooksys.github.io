# 📅 성일정보고등학교 스마트 통합 일정표 (Learning Operations Intelligence)

> **일학습병행 도제학교(3-12) 맞춤형 학사 운영 및 교육·훈련 일정 캘린더 시스템**  
> Google Apps Script와 스프레드시트를 백엔드 데이터베이스로 연동하여 실시간 동기화되는 고성능 반응형 인터랙티브 웹 캘린더입니다.

---

## 📌 목차
1. [프로젝트 개요](#-프로젝트-개요)
2. [시스템 아키텍처](#-시스템-아키텍처)
3. [주요 기능](#-주요-기능)
4. [데이터베이스(스프레드시트) 구조](#-데이터베이스스프레드시트-구조)
5. [API 명세서](#-api-명세서)
6. [파일 구조](#-파일-구조)
7. [설치 및 배포 가이드](#-설치-및-배포-가이드)
8. [코드 심층 분석](#-코드-심층-분석)
9. [보안 및 신뢰성 설계](#-보안-및-신뢰성-설계)
10. [관련 문서 및 라이선스](#-관련-문서-및-라이선스)

---

## 🌟 프로젝트 개요

### 1. 배경 및 필요성
직업계 고등학교 도제교육(일학습병행제)은 교내 교육(**off-JT**), 기업 현장 훈련(**OJT**), 특별수업(방과후/특강), 일반 학사일정 및 자격·역량평가 마일스톤이 복합적으로 교차되어 진행됩니다. 학생과 교직원이 일정을 직관적으로 파악하고 교육 이수시간을 체계적으로 관리할 수 있는 맞춤형 솔루션이 필요합니다.

### 2. 핵심 목표
- **중앙 데이터 관리**: Google Spreadsheet를 활용하여 별도 DB 서버 구축 없이 안전하고 직관적인 데이터 관리.
- **다차원 캘린더 뷰**: 월간(Month), 1주간(1 Week), 2주간(2 Weeks) 뷰 제공 및 스마트 카테고리 다중 필터링 지원.
- **자동 통계 및 D-Day**: 화면에 렌더링된 훈련 일정을 기반으로 off-JT/OJT 일수 및 이수시간 자동 집계, 최신 평가 D-Day 실시간 산출.
- **고해상도 이미지 내보내기**: 학급 공지 및 학부모 알림을 위한 2배율 고해상도 캘린더 캡처(PNG) 원클릭 다운로드.
- **안전한 관리자 운영**: 비밀번호 기반 세션 토큰 인증, 동시성 락(LockService)을 통한 실시간 일정·공지·디데이 편집.

---

## 🛠 시스템 아키텍처

```mermaid
flowchart TD
    subgraph Client [Web Frontend Client]
        UI[웹 캘린더 UI / HTML5 · CSS3 · ES6+]
        Capture[html2canvas 캡처 엔진]
        Config[school_project_05_gas.json]
    end

    subgraph GAS [Google Apps Script Web App (code.gs)]
        Router{HTTP Method}
        DoGet[doGet: 통합 데이터 조회]
        DoPost[doPost: 관리자 트랜잭션]
        Auth[세션 토큰 인증]
        Lock[LockService 동시성 락]
        Cache[(CacheService 세션 캐시)]
        Props[(Script Properties 비밀번호)]
    end

    subgraph DB [Google Spreadsheet Database]
        SheetMonth[(월별 일정 시트: YYYY.M)]
        SheetNotice[(설정 시트: 공지사항)]
        SheetDDay[(디데이 시트: 마일스톤)]
    end

    UI -->|1. GAS Web App URL 읽기| Config
    UI -->|2. GET 요청: 일정·공지·디데이| Router
    UI -->|3. POST 요청: 인증·일정·공지 수정| Router
    UI -->|4. 순수 달력 영역 캡처| Capture

    Router -->|GET| DoGet
    Router -->|POST| DoPost

    DoPost -->|verify / logout| Auth
    Auth <-->|대조| Props
    Auth <-->|세션 발급/검증 (30분 TTL)| Cache

    DoPost -->|데이터 변경 시 10초 Lock| Lock
    Lock -->|Write/Delete| DB
    DoGet -->|Read| DB

    DB --- SheetMonth
    DB --- SheetNotice
    DB --- SheetDDay
```

---

## ✨ 주요 기능

### 1. 📆 월간 / 1주간 / 2주간 인터랙티브 캘린더
- **월간 뷰 (Month View)**: 한 달 전체의 일정 흐름 및 전후 달 잔여 일자를 포함한 7열 그리드 렌더링.
- **1주간 뷰 (1 Week View)**: 선택한 기준일로부터 7일간의 집중 상세 일정 확인 (높은 카드 높이 제공).
- **2주간 뷰 (2 Weeks View)**: 14일간(2주)의 연속된 교육·현장 훈련 일정을 한눈에 파악.
- **기간 네비게이션**: 이전(`‹`) / 다음(`›`) 버튼을 통해 선택된 뷰 단위(1개월 / 1주일 / 2주일)로 직관적인 날짜 이동.

### 2. 🎨 카테고리 색상 코딩 및 다중 선택 필터링 (Multi-Select)
- 직관적인 6단계 컬러 코딩 적용:
  - 🔵 **교내 교육 (off-JT)**: 파란색 (`--blue-offjt: #3979f6`)
  - 🔴 **현장 훈련 (OJT)**: 빨간색 (`--red-ojt: #f05f75`)
  - 🟢 **특별수업 (방과후)**: 녹색 (`--green-special: #20a877`)
  - 🟣 **특별수업 (특강/캠프)**: 보라색 (`--purple-special: #8b5cf6`)
  - 🌸 **휴업일 / 공휴일**: 연분홍/적색 (`#fff3f5`, `#c13750`)
  - ⚪ **학사일정 / 일반**: 회색 (`--gray-general: #667085`)
- **다중 선택 필터링 칩**: `학사일정`, `off-JT`, `OJT`, `특별수업` 등 원하는 카테고리를 2개 이상 복수로 겹쳐서 선택 가능 (전체 일정 보기 클릭 시 초기화).

### 3. 📊 스마트 대시보드 & 통계 자동 집계
- **off-JT 이수시간 집계**: 현재 화면에 표시된 훈련 일정을 기준으로 고유 일수(Set) 및 총 이수시간 집계 (기본 7시간, `(N)` 시간 표기 자동 파싱).
- **OJT 이수시간 집계**: 현재 화면 기준 고유 일수(Set) 및 총 이수시간 집계 (기본 8시간, `(N)` 시간 표기 자동 파싱).
- **차기 마일스톤 D-Day**: 등록된 디데이 중 오늘 이후 가장 가까운 시험/평가 일정의 남은 일수(`D-Day`, `D-N`)와 명칭을 실시간 표시.

### 4. 📢 실시간 공지사항 배너
- 스프레드시트 `설정` 시트의 최신 공지 문구를 상단 배너에 즉시 반영하여 학사 공지 전달력 극대화.

### 5. 📸 2배율 고해상도 달력 이미지 캡처 (Export)
- **캡처 버튼**: 뷰 탭 우측 및 상단 히어로 영역에 `📸 일정표 저장` 버튼 배치.
- **깔끔한 달력 내보내기**: `html2canvas`를 동적 로드하여 현재 선택된 뷰의 **순수 달력 영역(`#calendar-workspace`)**만을 2배율 고해상도 PNG 파일로 렌더링.
- **UI 자동 정제**: 캡처 시 저장 버튼, 관리자 패널 등 불필요한 조작 요소를 자동으로 제외하고 투명도/그림자를 최적화하여 출력 (`성일정보고_달력_{월간/1주간/2주간}_{해당기간}.png`).

### 6. 📅 날짜 클릭 일정 상세 / 수정 / 삭제 팝업 모달 (Date Schedule Modal)
- **날짜별 일정 원클릭 조회**: 달력의 임의의 날짜 셀을 클릭하면 해당 일자의 모든 일정(off-JT, OJT, 특별수업, 학사일정 등)을 카드 형태로 상세 조회.
- **인라인 일정 수정 (Edit)**: 관리자 로그인 상태에서 일정 카드 옆 `✏️ 수정` 버튼을 클릭하여 분류, 명칭, 이수시간을 즉각 수정 및 동기화.
- **안전한 일정 삭제 (Delete)**: `🗑️ 삭제` 버튼을 통해 커스텀 확인 창 확인 후 해당 일정을 안전하게 제거.
- **해당 날짜에 새 일정 간편 추가**: 선택한 날짜가 자동으로 지정된 상태에서 간편하게 새 일정을 추가 등록.

### 7. 🔐 탭(Tab) 기반 관리자 전용 실시간 보안 편집 도구 팝업 (Admin Operations Modal)
- **전용 팝업 모달 (Popup Window)**: 관리자 편집 도구가 별도의 독립된 글래스모피즘 팝업 모달(`#admin-tools-modal`)로 열려 화면 어디서나 집중도 높은 관리 작업 가능.
- **세션 지속성 (Session Persistence)**: 브라우저 새로고침을 하더라도 명시적인 '관리자 로그아웃'을 수행하기 전까지 관리자 인증 세션 자동 유지.
- **🛠️ 관리자 편집도구 버튼**: 상단 헤더의 '관리자 로그인' 버튼 옆 '관리자 편집도구' 버튼 클릭 시 팝업 창 즉각 호출 (미인증 시 로그인 모달 완료 후 자동 오픈).
- **📢 공지사항 관리 탭**: 상단 배너 공지 문구 즉시 수정 및 실시간 시트 반영.
- **🎯 D-Day 마일스톤 탭**: 목표 날짜와 명칭을 입력하여 마일스톤 추가 및 등록된 D-Day 목록 실시간 조회/삭제.
- **📅 신규 일정 등록 탭**: 원하는 날짜, 교육 분류, 이수시간(기본값 또는 1~24 커스텀), 일정명을 지정하여 등록.

---

## 📊 데이터베이스(스프레드시트) 구조

Google Spreadsheet는 3가지 유형의 시트로 구성됩니다.

### 1. 월별 시트 (시트명: `YYYY.M` 또는 `YYYY.MM`, 예: `2026.3`)
| A열 (일) | B열 (요일) | C열 (학사일정) | D열 (off-JT) | E열 (OJT) | F열 (특별수업) | ... |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- |
| `1` | `일` | 삼일절 | | | | |
| `2` | `월` | 개학식 및 입학식 | | | | |
| `3` | `화` | | 네트워크 기초 (7) | | 방과후 특강 | |
| `4` | `수` | | | 현장 실무 훈련 (8) | | |

> **💡 셀 저장 및 메타데이터(Note) 메커니즘**:
> - **셀 값 (Cell Value)**: 같은 날짜/분류에 여러 일정이 있을 경우 줄바꿈(`\n`)으로 구분 저장됩니다.
> - **셀 메모 (Cell Note)**: 일정의 안전한 식별 및 삭제를 위해 JSON 형식의 고유 ID(UUID) 메타데이터를 저장합니다.
>   ```json
>   {
>     "version": 1,
>     "items": [
>       { "id": "4f9b8c2e-6d1a-4a2b-9e1c-123456789abc", "title": "네트워크 기초 (7)" },
>       { "id": "7a8b9c0d-1e2f-3a4b-5c6d-987654321def", "title": "도제 오리엔테이션" }
>     ]
>   }
>   ```

### 2. `설정` 시트 (공지사항)
| A열 | B열 |
| :--- | :--- |
| `Notice` | `2026학년도 1학기 성일정보고 일학습병행 도제과정 안내` |

### 3. `디데이` 시트 (학사 마일스톤)
| A열 (목표 날짜) | B열 (디데이 명칭) | C열 (__id, 식별자 숨김열) |
| :--- | :--- | :--- |
| `2026-04-15` | `1차 도제역량평가` | `4f9b8c2e-6d1a-4a2b-9e1c-123456789abc` |
| `2026-06-20` | `과정평가형 자격 외부평가` | `7a8b9c0d-1e2f-3a4b-5c6d-987654321def` |

---

## 📡 API 명세서

### 1. GET Request (데이터 전체 조회)
- **URL**: Google Apps Script Web App URL (`https://script.google.com/macros/s/.../exec`)
- **Method**: `GET`
- **Response Format**: `JSON`

```json
{
  "notice": "2026학년도 1학기 성일정보고 일학습병행 도제과정 안내",
  "types": ["학사일정", "off-JT", "OJT", "특별수업", "국가공휴일", "휴업일"],
  "milestones": [
    {
      "id": "4f9b8c2e-6d1a-4a2b-9e1c-123456789abc",
      "date": "2026-04-15",
      "title": "1차 도제역량평가"
    }
  ],
  "data": {
    "2026.3": [
      {
        "id": "4f9b8c2e-...",
        "day": 2,
        "type": "학사일정",
        "title": "개학식 및 입학식"
      },
      {
        "id": "7a8b9c0d-...",
        "day": 3,
        "type": "off-JT",
        "title": "네트워크 기초 (7)"
      }
    ]
  }
}
```

### 2. POST Request (관리자 트랜잭션)
- **URL**: Google Apps Script Web App URL
- **Method**: `POST`
- **Content-Type**: `text/plain;charset=utf-8` (CORS 프리플라이트 최적화)
- **Common Response**: `{ "success": true/false, "message"?: string, ... }`

| Action | 주요 파라미터 (Payload) | 설명 |
| :--- | :--- | :--- |
| `verify` | `password` | 관리자 비밀번호 검증 후 30분 유효 세션 토큰 반환 |
| `logout` | `token` | 관리자 세션 캐시 즉시 만료 처리 |
| `update_notice` | `token`, `newNotice` | 상단 공지사항 수정 (`설정!B1`) |
| `add_event` | `token`, `date`, `type`, `title`, `hours` | 신규 일정 등록 (이수시간 포함 시 명칭에 `(N)` 자동 반영) |
| `update_event` | `token`, `eventId`, `oldDate`, `oldType`, `oldTitle`, `newDate`, `newType`, `newTitle`, `hours` | 등록된 일정 수정 및 셀/Note 메타데이터 갱신 |
| `delete_event` | `token`, `date`, `type`, `title`, `eventId` | 특정 날짜/분류 셀 내 고유 일정 삭제 및 Note 메타데이터 갱신 |
| `add_dday` | `token`, `date`, `title` | 신규 D-Day 마일스톤 추가 |
| `delete_dday` | `token`, `id`, `date`, `title` | 등록된 D-Day 마일스톤 삭제 |

---

## 📁 파일 구조

```
project07_calendar/
├── PRD.md                             # 제품 요구사항 정의서 (Product Requirements Document)
├── README.md                          # 프로젝트 종합 기술 문서 및 사용 가이드
├── code.gs                            # Google Apps Script 백엔드 소스코드 (DB 제어, 인증, API)
├── index.html                         # 웹 캘린더 프론트엔드 메인 엔트리 (UI, 반응형 CSS, 클라이언트 JS)
├── school_project_05_calendar.v1.0.html # 프론트엔드 릴리즈 버전 백업 파일
└── school_project_05_gas.json         # Google Apps Script Web App 배포 URL 설정 파일
```

---

## 🚀 설치 및 배포 가이드

### Step 1. 구글 스프레드시트 준비
1. [Google Drive](https://drive.google.com)에서 새로운 **Google Spreadsheet**를 생성합니다.
2. 상단 메뉴에서 **확장 프로그램** > **Apps Script**를 클릭합니다.

### Step 2. Apps Script 소스코드 및 보안 설정
1. 생성된 Apps Script 편집기(`Code.gs`)에 프로젝트의 [code.gs](file:///c:/Users/user/Downloads/Project%20mooksys.iwinv.net/project07_calendar/code.gs) 내용을 전체 복사하여 붙여넣고 저장합니다.
2. 좌측 메뉴의 **프로젝트 설정 (톱니바퀴 아이콘)** > **스크립트 속성**으로 이동합니다.
3. **스크립트 속성 추가**를 클릭하여 아래 항목을 등록합니다:
   - **속성**: `ADMIN_PASSWORD`
   - **값**: `원하는 관리자 비밀번호 입력` (예: `sungil2026!`)

### Step 3. 웹 앱(Web App) 배포
1. 편집기 우측 상단의 **배포** > **새 배포**를 클릭합니다.
2. 유형 선택: **웹 앱 (Web App)**
   - **설명**: `v1.5 릴리즈 배포`
   - **다음 사용자로 실행**: `나(내 계정)`
   - **액세스 권한이 있는 사용자**: `모든 사용자 (Anyone)` *(비로그인 학생/학부모 조회를 위해 필수)*
3. **배포** 버튼을 클릭하고 구글 계정 권한을 승인합니다.
4. 발급된 **웹 앱 URL (`https://script.google.com/macros/s/AKfycb.../exec`)**을 복사합니다.

### Step 4. 프론트엔드 URL 연동 및 호스팅
1. [school_project_05_gas.json](file:///c:/Users/user/Downloads/Project%20mooksys.iwinv.net/project07_calendar/school_project_05_gas.json) 파일을 열어 복사한 Web App URL을 설정합니다:
   ```json
   {
     "gas_url": "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
   }
   ```
2. 웹 서버(GitHub Pages, AWS S3, Cloudflare Pages, 호스팅 서버 등)에 [index.html](file:///c:/Users/user/Downloads/Project%20mooksys.iwinv.net/project07_calendar/index.html) 및 `school_project_05_gas.json`을 업로드하여 서비스를 개시합니다.

---

## 🔍 코드 심층 분석

### 1. 백엔드 (`code.gs`)
- **동시성 제어 (`LockService`)**:
  - 관리자의 일정/공지/디데이 등록 및 삭제 시 `LockService.getScriptLock()`을 사용해 최대 10초 대기 락을 설정하여 여러 사용자가 동시에 데이터를 수정할 때 발생할 수 있는 셀 덮어쓰기 및 데이터 유실을 방지합니다.
- **안전한 세션 관리 (`CacheService` & `Script Properties`)**:
  - 관리자 비밀번호를 코드에 하드코딩하지 않고 `PropertiesService.getScriptProperties()`로 관리합니다.
  - 로그인 성공 시 64자리 고유 토큰을 생성하고 `CacheService.getScriptCache()`에 30분(1800초) 유효기간으로 보관합니다.
- **메타데이터 기반의 정밀 삭제 (`readCellEvents_`, `writeCellEvents_`)**:
  - 셀의 텍스트 줄바꿈 구조와 함께 셀 메모(Note)에 JSON 형태(`{ version: 1, items: [{ id, title }] }`)로 UUID를 저장하여, 동명이일정이나 수정된 일정 삭제 시 정확한 대상을 매칭합니다.

### 2. 프론트엔드 (`index.html`)
- **Map 기반의 O(1) 일정 인덱싱 (`buildEventIndex`)**:
  - 서버에서 수신한 월별 배열 데이터를 `Map<day, events[]>`로 변환하여 달력 렌더링 시 매일의 일정을 즉시 매핑합니다.
- **시간 파싱 및 고유 일수 계산 (`calculateDisplayStats`)**:
  - 정규표현식 `/\((\d+)\)/`을 활용하여 일정 텍스트에서 시간 정보를 추출합니다.
  - 하루에 여러 건의 훈련이 있어도 `Set<day>`를 활용해 실제 출석 일수를 정확하게 중복 제거하여 합산합니다.
- **반응형 렌더러 (`renderCalendarMonth`, `renderCalendarWeek`)**:
  - `currentView` 상태값(`month`, `week1`, `week2`)에 따라 날짜 오프셋과 주간 범위를 계산하여 CSS 그리드 기반으로 부드럽게 재렌더링합니다.
- **고해상도 캡처 최적화 (`saveAsImage`)**:
  - `html2canvas`의 `onclone` 콜백을 활용하여 캡처 대상 문서의 `backdrop-filter` 및 그림자 효과를 클린업하고 2배 스케일로 선명한 이미지 파일을 생성합니다.

---

## 🔒 보안 및 신뢰성 설계

1. **비밀번호 클라이언트 무노출**:
   - 프론트엔드 코드나 브라우저 로컬 스토리지에 관리자 비밀번호가 저장되지 않으며, 서버의 스크립트 속성을 통해서만 검증됩니다.
2. **엄격한 데이터 유효성 검증**:
   - 날짜 포맷(`YYYY-MM-DD`), 이수 시간(1~24 정수), 텍스트 최대 길이(공지 500자, 일정명 200자), 허용된 일정 분류 검증을 서버단에서 강제 수행합니다.
3. **웹 접근성 및 크로스 브라우징**:
   - `aria-live`, `aria-label`, 건너뛰기 링크(`skip-link`) 및 `prefers-reduced-motion` 미디어 쿼리를 준수하여 모든 사용자를 배려한 UI를 제공합니다.

---

## 📑 관련 문서 및 라이선스

- [PRD.md](file:///c:/Users/user/Downloads/Project%20mooksys.iwinv.net/project07_calendar/PRD.md): 제품 요구사항 정의서 (Product Requirements Document)
- Copyright © 2026 **성일정보고등학교** · 도제학교 교육과정 통합 운영 시스템. All rights reserved.

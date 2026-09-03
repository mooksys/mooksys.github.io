# 📅 성일정보고등학교 일학습병행(도제학교) 스마트 통합 일정표
> **Learning Operations Intelligence Calendar & Management System**  
> 직업계 고등학교 도제교육(일학습병행제)의 복합 학사 일정을 Google Spreadsheet 및 Apps Script 기반으로 실시간 동기화하고 관리하는 통합 웹 애플리케이션입니다.

---

## 📌 목차 (Table of Contents)
1. [프로젝트 개요 (Overview)](#1-프로젝트-개요-overview)
2. [타깃 사용자 및 페르소나 (User Personas)](#2-타깃-사용자-및-페르소나-user-personas)
3. [핵심 제품 요구사항 (Functional Requirements)](#3-핵심-제품-요구사항-functional-requirements)
4. [비기능적 요구사항 (Non-Functional Requirements)](#4-비기능적-요구사항-non-functional-requirements)
5. [시스템 아키텍처 및 데이터 흐름 (System Architecture)](#5-시스템-아키텍처-및-데이터-흐름-system-architecture)
6. [데이터베이스(스프레드시트) 스키마 (Database Schema)](#6-데이터베이스스프레드시트-스키마-database-schema)
7. [API 명세서 (API Specifications)](#7-api-명세서-api-specifications)
8. [소스코드 심층 기술 분석 (Source Code Analysis)](#8-소스코드-심층-기술-분석-source-code-analysis)
   - [8.1 프론트엔드 (index.html)](#81-프론트엔드-indexhtml)
   - [8.2 백엔드 (code.gs)](#82-백엔드-codegs)
9. [배포 및 설치 가이드 (Deployment Guide)](#9-배포-및-설치-가이드-deployment-guide)
10. [프로젝트 파일 구조 (Directory Structure)](#10-프로젝트-파일-구조-directory-structure)

---

## 1. 프로젝트 개요 (Overview)

### 1.1 배경 및 목적
직업계 고등학교 도제교육(일학습병행제)은 교내 이론 및 실습 교육(**off-JT**), 기업 현장 실무 훈련(**OJT**), 일반 학사일정, 방과후/특별수업, 국가공휴일 및 국가공인 역량평가/자격시험 마일스톤이 복합적으로 교차되어 운영됩니다.  
이로 인해 학생, 학부모, 기업 현장교사, 학교 도제부 교직원 모두가 일정을 명확하게 파악하고 이수 시간을 관리하는 데 큰 어려움을 겪고 있었습니다.

본 시스템은 **Google Spreadsheet**를 간편한 클라우드 DB로 채택하고, **Google Apps Script(GAS)**를 고신뢰성 서버리스 API 백엔드로 활용하며, 브라우저에서 즉시 구동되는 **Single-File 반응형 웹 캘린더**를 구축하여 다음 목적을 달성합니다:
1. **일정 시각화 극대화**: 월간/1주간/2주간 뷰와 카테고리별 컬러 코딩 및 다중 필터링 지원
2. **이수 시간 자동 집계**: 화면에 표시된 일정 기준 off-JT / OJT 일수 및 시간 실시간 계산
3. **보안 인증 기반 실시간 운영**: 비밀번호 기반 세션 인증을 통한 공지사항, 디데이, 일정 추가/수정/삭제
4. **프리미엄 사용자 경험(UX)**: 브라우저 기본 팝업을 탈피한 글래스모피즘 모달/토스트 시스템 탑재 및 일정표 고해상도 캡처 다운로드 제공

---

## 2. 타깃 사용자 및 페르소나 (User Personas)

| 사용자 그룹 | 주요 상황 및 요구사항 | 시스템 제공 기능 |
| :--- | :--- | :--- |
| **도제 참여 학생** | • 이번 주/이번 달 교내 교육(off-JT) 및 기업 출근(OJT) 확인<br>• 다가오는 1차/2차 평가 및 자격시험 D-Day 확인<br>• 모바일 환경에서 빠르고 직관적인 달력 조회 | • 월간/1주간/2주간 반응형 캘린더<br>• 카테고리별 다중 필터 칩<br>• 차기 마일스톤 D-Day 카운터<br>• 상단 실시간 공지사항 배너 |
| **학부모** | • 자녀의 도제 일정(등교일 vs 기업 출근일) 확인<br>• 가정통신문이나 단톡방 공유를 위한 일정표 이미지 필요 | • 일정표 이미지 저장 기능 (2배율 고해상도 PNG 즉시 다운로드)<br>• 훈련 유형별 색상 범례 표시 |
| **도제부 담당 교사 / 관리자** | • 학사 일정, 공휴일, 특별수업 즉각 등록/수정/삭제<br>• 훈련 이수 시간(7h, 8h 등)의 정확한 산출 및 관리<br>• 구글 스프레드시트의 원본 손상 없는 안전한 동기화 | • 비밀번호 기반 관리자 인증 세션<br>• 공지사항 즉시 변경 기능<br>• 디데이 및 일정 등록/삭제 인터페이스<br>• 삭제 시 확인 다이얼로그로 오작동 방지 |

---

## 3. 핵심 제품 요구사항 (Functional Requirements)

### 3.1 캘린더 시각화 및 내비게이션
- **FR-101 (월간 뷰 / Month View)**: 해당 연·월을 7열(일~토) 그리드로 출력하며 이전/다음 달 연결 날짜를 투명도와 함께 배치.
- **FR-102 (주간 뷰 / Week View)**: 선택 기준일 기준 1주간(7일) 또는 2주간(14일) 집중 뷰를 제공하여 연속적인 훈련 흐름 파악.
- **FR-103 (기간 이동 및 오늘 복귀)**: 이전(`‹`), 다음(`›`) 버튼을 통한 월/주 단위 날짜 전환.
- **FR-104 (스마트 카테고리 컬러 코딩)**:
  - 🔵 `교내 교육 (off-JT)`: 파란색 (`--blue-offjt: #3979f6`)
  - 🔴 `현장 훈련 (OJT)`: 빨간색 (`--red-ojt: #f05f75`)
  - 🟢 `특별수업 (방과후)`: 녹색 (`--green-special: #20a877`)
  - 🟣 `특별수업 (기타 특강/캠프)`: 보라색 (`--purple-special: #8b5cf6`)
  - 🌸 `휴업일 / 공휴일`: 연분홍/적색 테두리 배지
  - ⚪ `학사일정 / 일반`: 슬레이트 그레이 (`--gray-general: #667085`)
- **FR-105 (다중 선택 필터링 / Multi-Select Filter)**: `전체 일정 보기` 복귀 칩 및 `학사일정`, `off-JT`, `OJT`, `특별수업` 등 여러 카테고리를 동시에 2개 이상 선택하여 중복 필터링 조회 지원.
- **FR-106 (캘린더 내부 11px 정밀 타이포그래피)**: 날짜 셀(`.calendar-cell`), 날짜 숫자(`.cell-number`), 일정 배지(`.event-badge`), 요일 헤더(`.day-header`)의 글자 크기를 정밀한 **11px**로 표준화하여, 일정 텍스트가 좁은 칸 안에서도 잘림 없이 가독성 높게 표시되도록 최적화.

### 3.2 통계 대시보드 및 지표 산출
- **FR-201 (off-JT 집계)**: 현재 달력 화면에 렌더링된 일정을 기준으로 고유 훈련 일수(Set 집계) 및 총 이수시간 합산 (기본 7시간 또는 일정명의 `(N)` 시간 파싱).
- **FR-202 (OJT 집계)**: 현재 달력 화면에 렌더링된 일정을 기준으로 고유 훈련 일수(Set 집계) 및 총 이수시간 합산 (기본 8시간 또는 일정명의 `(N)` 시간 파싱).
- **FR-203 (방과후 수업 집계)**: 현재 달력 화면에 렌더링된 방과후 수업 일정을 기준으로 고유 일수(Set 집계) 및 총 이수시간 합산 (기본 2시간 또는 일정명의 `(N)` 시간 파싱, 에메랄드 그린 테마).
- **FR-204 (차기 마일스톤 D-Day)**: 등록된 마일스톤 중 오늘 이후 가장 가까운 일정의 남은 일수(`D-Day`, `D-N`) 및 명칭 실시간 산출.
- **FR-205 (1024px 쉘 기반 4분할 골든 밸런스 레이아웃)**: 기본 화면 너비를 표준 1024px로 컴팩트하게 수렴하고, 4개 카드(off-JT, OJT, 방과후 수업, D-Day)를 1024px 폭에 최적화된 카드 높이 약 88px(가로 240px 대비 ~2.73:1 황금비율)로 배치하여 한눈에 들어오는 가독성과 캘린더 첫 화면 가시성을 극대화.

### 3.3 일정표 이미지 캡처 & 다운로드
- **FR-301 (무손실 2배율 PNG 내보내기)**: `📸 일정표 저장` 버튼 클릭 시 `html2canvas` 라이브러리를 동적 로드하여 순수 캘린더 영역(`div#calendar-workspace`)을 2배율 선명한 PNG 파일(`성일정보고_달력_{뷰타입}_{기간}.png`)로 생성하여 자동 다운로드. 캡처 시 관리자 패널 및 캡처 버튼은 자동 은닉.

### 3.4 관리자 모드 및 일정 관리
- **FR-401 (보안 인증)**: 서버 환경변수(`Script Properties`)의 비밀번호 대조 후 30분 유효 세션 토큰 발행.
- **FR-402 (D-Day 입력형식 기반 공지 건별 CRUD & 구글시트 행 연동)**: 기존 긴 단일 텍스트 입력 방식에서 탈피하여, D-Day 마일스톤 입력 폼과 완벽히 동일한 **[공지 날짜] (`date`), [공지 내용] (`text`) 2열 분리 입력 폼**을 제공. 구글 스프레드시트의 `공지사항` 시트(`[공지 날짜, 공지 내용, __id]`) 및 `설정` 시트(`Notice`)와 양방향 실시간 동기화되며, 공지 항목 카드는 좁은 폭에서도 글자가 세로로 떨어지지 않도록 **상단 행(공지 내용 100% 가로 확장 + 수정/삭제 버튼)과 하단 행(날짜 뱃지 옆 상태 필 밀착 + 오른쪽 정렬)의 2단 구조**로 단정하게 표시. 현재 날짜 기준 **지난 일정은 맨 뒤 페이지로 자동 이동 정렬(`sortItemsUpcomingFirst`)**되어 다가오는 중요 일정이 1페이지에 우선 노출되며, 4개 단위 페이지네이션, 건별 수정·삭제, 당월 유효 일정 배너 자동 필터링을 지원.
- **FR-403 (D-Day 마일스톤 등록·수정·삭제 풀 CRUD & 지난 일정 맨 뒤 이동)**: 목표 날짜와 명칭을 지정하여 D-Day를 등록하며, 등록된 마일스톤 카드에 **`[수정]` 버튼을 탑재**하여 날짜/명칭 인라인 수정 및 수정 취소 지원. 현재 날짜보다 지난 마일스톤은 **맨 뒤 페이지로 자동 이동 정렬**되어 최신 목표가 1페이지에 바로 보이도록 최적화. 삭제 시 안전 확인 다이얼로그 연동 및 D-Day 실시간 재계산.
- **FR-404 (일정 등록)**: 날짜, 교육 분류, 이수시간(기본값 또는 1~24h), 일정명 입력 후 해당 월 시트에 셀 개행(`\n`) 추가 및 고유 UUID Note 메타데이터 보존.
- **FR-405 (일정 삭제)**: 일정 배지의 삭제(`×`) 버튼 클릭 시 안전 확인 모달을 거쳐 시트 셀 값 및 메타데이터에서 동시 제거.

### 3.5 모던 다이얼로그 & 토스트 시스템
- **FR-501 (커스텀 알림/확인/입력/토스트)**: 브라우저 기본 `alert`, `confirm`, `prompt`를 완전 대체하는 자체 UI 엔진 탑재.
- **FR-502 (글래스모피즘 모달)**: 부드러운 배경 블러(`backdrop-filter: blur(14px)`), 상태별 SVG 아이콘(체크, 경고, 자물쇠 등) 및 펄스 애니메이션 적용.
- **FR-503 (보안 비밀번호 모달)**: 관리자 인증 시 비밀번호 마스킹(`••••••••`) 및 눈동자 아이콘 표시/숨김 토글 지원.
- **FR-504 (플로팅 토스트)**: 공지사항 반영, 일정/디데이 추가/삭제 완료 등 가벼운 피드백은 우측 상단 자동 소멸 토스트로 처리하여 사용자 피로도 해소.

---

## 4. 비기능적 요구사항 (Non-Functional Requirements)

1. **보안성 (Security)**:
   - 관리자 비밀번호는 프론트엔드 소스코드나 네트워크 전송 클라이언트단에 하드코딩되지 않으며, GAS의 안전한 `Script Properties`에 보관.
   - 모든 수정/삭제 API는 세션 토큰 유효성 검증(`assertAdminSession_`)을 필수로 수행.
2. **동시성 및 데이터 무결성 (Concurrency & Data Integrity)**:
   - 다수의 관리자가 동시 편집 요청을 보낼 경우를 대비하여 `LockService.getScriptLock()`을 통한 10초 대기 상호배제(Mutex) 락 적용.
   - 각 일정마다 UUID를 생성하고 셀 메모(Note)에 `{ version: 1, items: [{ id, title }] }` JSON 메타데이터를 저장하여 삭제 시 동명이칭 일정과의 오작동 방지.
3. **반응형 웹 및 크로스 브라우징 (Responsive & Universal)**:
   - 모바일(320px~), 태블릿(640px~), 데스크톱(960px~) 전 기기 최적화.
   - `prefers-reduced-motion` 미디어 쿼리 지원으로 애니메이션 민감 사용자 배려.
   - 웹 표준 접근성 속성(`aria-live`, `aria-selected`, `aria-modal`, `role="status"`, `skip-link`) 준수.
4. **고성능 렌더링 (Performance)**:
   - 서버에서 수신된 원본 배열을 `Map<day, events[]>`로 인덱싱하여 월간/주간 뷰 렌더링 시 $O(1)$에 근접한 속도로 셀 배치 수행.

---

## 5. 시스템 아키텍처 및 데이터 흐름 (System Architecture)

```mermaid
flowchart TD
    subgraph Client ["Client Browser (index.html)"]
        UI["인터랙티브 웹 캘린더 UI"]
        Dialog["AppDialog (모달/토스트 엔진)"]
        Store["상태 관리 (날짜, 필터, 관리자 세션)"]
        Capture["html2canvas 캡처 모듈"]
    end

    subgraph Backend ["Serverless Backend (code.gs Web App)"]
        Router{"doGet / doPost 라우터"}
        Auth["인증/세션 핸들러 (CacheService)"]
        Lock["동시성 제어 (LockService 10s Lock)"]
        SheetService["스프레드시트 셀 & Note 동기화 엔진"]
    end

    subgraph Database ["Google Spreadsheet DB"]
        MonthSheets["[YYYY.M] 월별 일정 시트"]
        ConfigSheet["[설정] 공지사항 시트"]
        DDaySheet["[디데이] 마일스톤 시트"]
    end

    UI -->|1. 초기화 & gas_url 로드| Store
    Store -->|2. GET: 전체 데이터 조회| Router
    Router --> SheetService
    SheetService --> MonthSheets & ConfigSheet & DDaySheet

    Dialog -->|3. 관리자 로그인 (비밀번호)| Auth
    Auth --> Router
    Dialog -->|4. 일정/디데이/공지 변경 POST| Lock
    Lock --> SheetService
    SheetService --> MonthSheets & ConfigSheet & DDaySheet

    Capture -->|순수 캘린더 캡처| UI
```

---

## 6. 데이터베이스(스프레드시트) 스키마 (Database Schema)

스프레드시트는 총 3종류의 시트 테이블로 구성됩니다.

### 6.1 월별 시트 (시트명: `YYYY.M` 또는 `YYYY.MM`, 예: `2026.3`)
| A열 (일) | B열 (요일) | C열 (학사일정) | D열 (off-JT) | E열 (OJT) | F열 (특별수업) | ... |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- |
| `1` | `일` | 삼일절 | | | | |
| `2` | `월` | 개학식 및 입학식 | | | | |
| `3` | `화` | | 네트워크 기초 (7) | | | |
| `4` | `수` | | | 스마트공장 현장실습 (8) | | |

- **셀 값 (Value)**: 한 날짜/분류에 여러 일정이 존재할 경우 개행(`\n`)으로 구분 저장.
- **셀 메모 (Note)**: 각 일정의 고유 UUID를 JSON 객체로 보관하여 일정 삭제/수정 시 완벽한 추적성 보장:
  ```json
  {
    "version": 1,
    "items": [
      { "id": "4f9b8c2e-98b4-4b5a-93f8-d4c3821a71c8", "title": "네트워크 기초 (7)" }
    ]
  }
  ```

### 6.2 `공지사항` 시트 (D-Day와 동일한 행 단위 구조)
| A열 (공지 날짜) | B열 (공지 내용) | C열 (__id, 숨김열) |
| :--- | :--- | :--- |
| `2026-09-16` | `제4과목 내부평가` | `a1b2c3d4-...` (UUID) |
| `2026-10-12` | `SQLD 원서접수` | `e5f6g7h8-...` (UUID) |

### 6.3 `설정` 시트 (종합 텍스트 호환 유지)
- **A1**: `Notice` (필드 라벨)
- **B1**: 공지사항 종합 텍스트 (예: `▶하계 방학(8/13) ▶개학(8/14)...`)

### 6.4 `디데이` 시트
| A열 (목표 날짜) | B열 (디데이 명칭) | C열 (__id, 숨김열) |
| :--- | :--- | :--- |
| `2026-04-15` | `1차 도제역량평가` | `4f9b8c2e-...` (UUID) |
| `2026-06-20` | `과정평가형 자격 외부평가` | `7a8b9c0d-...` (UUID) |

---

## 7. API 명세서 (API Specifications)

### 7.1 GET Request (데이터 조회)
- **Endpoint**: Google Apps Script 웹 앱 배포 URL
- **Method**: `GET`
- **Output JSON**:
  ```json
  {
    "notice": "2026학년도 1학기 도제과정 학사 운영 안내",
    "notices": [
      { "id": "uuid-n1", "date": "2026-09-16", "title": "제4과목 내부평가" }
    ],
    "types": ["학사일정", "off-JT", "OJT", "특별수업", "국가공휴일", "휴업일"],
    "milestones": [
      { "id": "uuid-1", "date": "2026-04-15", "title": "1차 도제역량평가" }
    ],
    "data": {
      "2026.3": [
        { "id": "uuid-a", "day": 2, "type": "학사일정", "title": "개학식 및 입학식" },
        { "id": "uuid-b", "day": 3, "type": "off-JT", "title": "네트워크 기초 (7)" }
      ]
    }
  }
  ```

### 7.2 POST Request (관리자 액션)
- **Endpoint**: Google Apps Script 웹 앱 배포 URL
- **Method**: `POST`
- **Headers**: `Content-Type: text/plain` (CORS 프리플라이트 회피용)
- **공통 반환 포맷**: `{ "success": true/false, "message"?: string, ... }`

| Action | 요청 페이로드 파라미터 | 반환 데이터 | 설명 |
| :--- | :--- | :--- | :--- |
| `verify` | `password` | `{ token, expiresIn }` | 관리자 패스워드 검증 및 30분 유효 세션 토큰 발행 |
| `logout` | `token` | `{ success: true }` | 세션 토큰 즉시 무효화 (CacheService 제거) |
| `add_notice` | `token`, `date`, `title` | `{ item, notice, notices }` | 신규 공지사항 등록 (`공지사항` 시트 행 추가 및 B1 자동 동기화) |
| `update_notice_item` | `token`, `id`, `date`, `title` | `{ item, notice, notices }` | 지정된 공지사항 날짜 및 내용 인라인 수정 |
| `delete_notice` | `token`, `id` | `{ deleted: true, notice, notices }` | 지정된 공지사항 삭제 (`공지사항` 시트 행 제거) |
| `update_notice` | `token`, `newNotice` | `{ notice, notices }` | 상단 공지사항 전문 일괄 수정 및 시트 전체 동기화 (Fallback 지원) |
| `add_dday` | `token`, `date`, `title` | `{ milestone }` | 신규 D-Day 마일스톤 등록 |
| `update_dday` | `token`, `id`, `date`, `title`, `oldDate`, `oldTitle` | `{ milestone }` | 기존 D-Day 마일스톤 날짜 및 명칭 수정 (Fallback 지원) |
| `delete_dday` | `token`, `id`, `date`, `title` | `{ success: true }` | 지정된 D-Day 마일스톤 삭제 |
| `add_event` | `token`, `date`, `type`, `title`, `hours` | `{ event }` | 특정 날짜/분류에 신규 일정 추가 (Note UUID 생성) |
| `delete_event`| `token`, `date`, `type`, `title`, `eventId` | `{ success: true }` | 해당 일정 셀 텍스트 및 Note UUID 메타데이터 삭제 |
| `update_event`| `token`, `eventId`, `oldDate`, `oldType`, `oldTitle`, `newDate`, `newType`, `newTitle`, `hours` | `{ event }` | 등록된 일정의 명칭/분류/시간 인라인 수정 |

---

## 8. 소스코드 심층 기술 분석 (Source Code Analysis)

### 8.1 프론트엔드 (`index.html`)

#### 1) 프리미엄 커스텀 다이얼로그 시스템 (`AppDialog`)
브라우저 기본 다이얼로그(`alert()`, `confirm()`, `prompt()`)의 투박함과 주소 노출 문제를 해결하기 위해 구축된 독립형 UI 모듈입니다:
- **Promise 기반 비동기 설계**: `await AppDialog.confirm(...)`, `await AppDialog.prompt(...)` 형태로 비동기 흐름을 자연스럽게 제어.
- **스마트 문자열 자동 파싱 (`parseStringPayload`)**: 인자로 전달된 문자열 내의 이모지(`✅`, `🚨`, `⚠️`, `🔓` 등)와 줄바꿈을 감지하여 타이틀/본문 분리 및 테마(`success`, `error`, `warning`, `info`)를 자동 부여.
- **보안 비밀번호 마스킹 및 토글**: 관리자 비밀번호 입력 시 `type="password"` 적용 및 우측 눈동자 SVG 클릭을 통한 평문 전환 지원.
- **플로팅 토스트 (`AppDialog.toast`)**: 비차단형(Non-blocking) 알림으로, 2.6초 후 슬라이드 아웃 애니메이션과 함께 자동 소멸.
- **키보드 접근성 완벽 대응**: `Enter` 키로 확인/제출, `Escape` 키로 취소/닫기, 모달 오픈 시 인풋/확인 버튼 자동 포커스 처리.

#### 2) $O(1)$ 데이터 인덱싱 (`buildEventIndex`)
```javascript
function buildEventIndex(data) {
  return Object.entries(data).reduce((index, [sheetKey, events]) => {
    const byDay = new Map();
    (events || []).forEach((event) => {
      const day = Number(event.day);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(event);
    });
    index[sheetKey] = byDay;
    return index;
  }, {});
}
```
수백 건의 일정이 등록되어 있어도 각 날짜 셀을 렌더링할 때 배열 전체를 매번 순회하지 않고, `sheetKey`와 `day`를 키로 하여 $O(1)$ 속도로 일정을 추출합니다.

#### 3) 이수시간 파싱 및 정밀 D-Day 산출 (`processEventsToCell`, `calculateDDay`)
- **이수 시간**: 일정 제목 끝에 `(7)`, `(8)` 등의 패턴이 있으면 정규식 `/\((\d+)\)\s*$/`으로 파싱하여 가산하고, 없으면 기본값(off-JT: 7시간, OJT: 8시간, 방과후 수업: 2시간)을 적용합니다.
- **고유 훈련일 수 산출**: `Set` 자료구조를 사용하여 같은 날 여러 개의 off-JT, OJT, 방과후 수업 일정이 있더라도 실제 교육/훈련 일수가 중복 카운트되지 않도록 정합성을 보장합니다.
- **D-Day 계산**: 오늘 자정을 기준으로 등록된 마일스톤과의 밀리초 차이를 `Math.ceil`하여 `D-Day` 또는 `D-N`을 실시간 계산합니다.

#### 4) 무손실 2배율 캡처 다운로드 (`saveAsImage`)
- `html2canvas` 라이브러리를 동적 주입(`loadCaptureLibrary`)하여 초기 페이지 로딩 속도를 보존합니다.
- 캡처 시 `clonedDoc`을 가공하여 글래스모피즘의 `backdrop-filter` 잔상과 섀도우를 일시 제거하고 화이트 배경으로 렌더링함으로써 인쇄 및 모바일 저장 시 최고의 가독성을 보장합니다.

#### 5) 슬림 컴팩트 푸터 디자인 (`.site-footer`)
- 상·하 패딩(24px ➔ 16px) 및 아이템 간격(16px ➔ 12px), 로고 크기(38px ➔ 32px)를 20% 축소 최적화하여 캘린더 콘텐츠 영역의 시각적 몰입도를 높이고 여백 낭비를 줄였습니다.
- 모바일(800px 미만) 환경에서도 14px 패딩의 반응형 레이아웃을 통해 화면을 과도하게 차지하지 않도록 슬림하게 유지됩니다.

---

### 8.2 백엔드 (`code.gs`)

#### 1) 요청 라우팅 및 락 제어 (`doGet`, `doPost`)
- 모든 쓰기 작업(`update_notice`, `add_event`, `delete_event`, `add_dday`, `delete_dday`)은 `LockService.getScriptLock()`을 취득한 후 실행됩니다. 동시 쓰기 요청 발생 시 최대 10초간 대기 큐를 형성하여 스프레드시트의 Race Condition을 원천 방지합니다.

#### 2) 보안 세션 토큰 관리 (`createAdminSession_`, `assertAdminSession_`)
- `ADMIN_PASSWORD` 일치 시 `Utilities.getUuid()`로 36자리 고유 토큰을 발급하고 `CacheService.getScriptCache()`에 30분(`SESSION_TTL_SECONDS = 1800`) 동안 보관합니다.
- 인가되지 않은 토큰으로 데이터 변경 API 호출 시 예외를 던져 작업을 즉각 차단합니다.

#### 3) 셀 값과 Note 메타데이터의 양방향 원자적 동기화 (`appendCellEvent_`, `removeCellEvent_`)
```javascript
// 셀 텍스트는 개행(\n)으로 합치고, 셀 메모(Note)에는 JSON 메타데이터 저장
const nextText = lines.length ? lines.join('\n') + '\n' + title : title;
cell.setValue(nextText);

meta.items.push({ id: eventId, title });
cell.setNote(JSON.stringify(meta));
```
단순히 셀의 문자열만 지우는 것이 아니라, Note에 저장된 JSON 배열에서 해당 `eventId`를 찾아 정확하게 한 쌍으로 일치하는 텍스트 라인만 제거하므로 이름이 같은 복수의 일정도 안전하게 단건 삭제가 가능합니다.

---

## 9. 배포 및 설치 가이드 (Deployment Guide)

### Step 1. 구글 스프레드시트 준비
1. 새 Google Spreadsheet를 생성합니다.
2. 아래 3개 시트를 생성합니다:
   - `설정`: A1에 `Notice`, B1에 초기 공지 입력
   - `디데이`: A1에 `목표 날짜`, B1에 `디데이 명칭`, C1에 `__id` (C열은 숨김 처리)
   - `2026.3` (현재 월 시트): A1에 `일`, B1에 `요일`, C1~H1에 카테고리 헤더(`학사일정`, `off-JT`, `OJT`, `특별수업`, `국가공휴일`, `휴업일`) 작성
3. 상단 메뉴에서 `확장 프로그램` > `Apps Script`를 클릭합니다.

### Step 2. Apps Script 소스코드 적용 및 비밀번호 등록
1. 열린 스크립트 편집기에 본 프로젝트의 `code.gs` 내용 전체를 붙여넣고 저장합니다.
2. 좌측 메뉴의 **프로젝트 설정(톱니바퀴 아이콘)**을 클릭합니다.
3. **스크립트 속성** 섹션에서 **스크립트 속성 추가**를 클릭합니다:
   - **속성**: `ADMIN_PASSWORD`
   - **값**: `원하는 관리자 비밀번호 입력 (예: 1234)`
4. 속성을 저장합니다.

### Step 3. 웹 앱 배포 (Web App)
1. 편집기 우측 상단의 **배포** > **새 배포**를 클릭합니다.
2. 유형 선택: **웹 앱(Web App)**
   - **설명**: `v1.5`
   - **다음 사용자로 실행**: `나(내 계정)`
   - **액세스 권한이 있는 사용자**: `모든 사용자(Anyone)`
3. **배포**를 누르고 접근 권한을 승인합니다.
4. 생성된 **웹 앱 URL (`https://script.google.com/macros/s/.../exec`)**을 복사합니다.

### Step 4. 프론트엔드 연동 및 실행
1. 프로젝트 루트의 `school_project_05_gas.json` 파일을 열고 복사한 URL을 입력합니다:
   ```json
   {
     "gas_url": "https://script.google.com/macros/s/AKfycb.../exec"
   }
   ```
2. 웹 서버(VS Code Live Server, GitHub Pages 등)로 `index.html`을 실행합니다.

---

## 10. 프로젝트 파일 구조 (Directory Structure)

```
project07_calendar/
├── PRD.md                             # 제품 요구사항 정의서 (Product Requirements Document)
├── README.md                          # 프로젝트 종합 마스터 문서 및 기술 명세서
├── code.gs                            # Google Apps Script 백엔드 소스코드 (Lock, Cache, Sheet API)
├── index.html                         # 웹 캘린더 프론트엔드 (글래스모피즘 UI, AppDialog 모달, 통계)
├── school_project_05_gas.json         # Google Apps Script Web App 배포 URL 설정 파일
└── 0821/                              # 이전 버전 아카이브 디렉토리
```

---

## 📄 라이선스 및 저작권
Copyright © 2026 **성일정보고등학교 도제학교 운영위원회**. All rights reserved.

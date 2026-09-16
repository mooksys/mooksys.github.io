# 2026 Doje Beacon System

성일정보고등학교 도제반(3-12) 현장실습 출결 관리 시스템.

학생은 모바일/PC에서 입실·퇴실을 기록하고, 교사는 실시간 대시보드로 지각·미퇴실·미입력자를 확인하며 월간 출석부를 A4 1장으로 인쇄합니다.

- **Frontend**: 단일 HTML SPA (Vanilla JS, 빌드 도구 없음)
- **Backend**: Google Apps Script 웹앱 (`code.gs`)
- **Database**: Google Spreadsheet 4개 시트 + Script Properties

상세 요구사항은 [prd.md](prd.md)를 참조하세요.

---

## 파일 구조

```
project06_beacon/
├─ index.html                  프론트엔드 전체 (HTML+CSS+JS 단일 파일, 6,300여 줄)
├─ code.gs                     GAS 백엔드 전체 (2,000여 줄)
├─ tests.gs                    순수 함수 테스트 (Apps Script 편집기에서 실행)
├─ project26_05_gas_url.json   GAS 웹앱 배포 URL
├─ prd.md                      요구사항 명세서
└─ old/                        이전 버전 백업 (배포 대상 아님)
```

외부 의존성인 Pretendard 폰트와 Flatpickr(v4.6.13)는 `cdn.jsdelivr.net`에서 로드합니다
(`index.html` `<head>` 참조). 빌드·설치 단계가 없으며 `index.html`을 그대로 서빙하면 됩니다.

---

## 배포 방법

### 1. 스프레드시트 준비

시트 4개 중 `Users`와 `Attendance`는 **반드시 직접 만들어야 합니다.**
`BlockedDates`와 `Sessions`는 첫 요청에서 자동 생성됩니다.

`Users` 시트 1행에 헤더를 넣고, 2행부터 교사 계정을 최소 1개 등록합니다.
(학생 계정은 배포 후 교사 화면에서 등록하면 됩니다.)

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| `ID` | `NAME` | `ROLE` | `PW` | `IN_TIME` | `OUT_TIME` |
| `teacher1` | 홍길동 | `교사` | `1234` | | |

`ROLE`은 `학생` 또는 `교사` 두 값만 유효합니다. `PW`에 평문 `1234`를 넣어두면
첫 로그인 시 자동으로 해시 체계로 승급되고 비밀번호 변경이 강제됩니다.
G~J열(`FAIL`·`LOCK`·`SALT`·`MUST_SETUP`)은 첫 요청에서 자동 추가되므로 비워두세요.

`Attendance` 시트 1행 헤더:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| `TIME` | `DATE` | `DAY` | `ID` | `NAME` | `TYPE` | `STD_TIME` | `STATUS` |

### 2. Apps Script 배포

1. 스프레드시트에서 **확장 프로그램 → Apps Script**
2. `code.gs` 내용을 붙여넣고 저장
3. **배포 → 새 배포 → 유형: 웹 앱**
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자** ← 학생 브라우저가 직접 호출하므로 필수
4. 발급된 `/exec` URL을 복사

### 3. 프론트엔드 연결

`project26_05_gas_url.json`에 URL을 기록합니다.

```json
{
  "api_url": "https://script.google.com/macros/s/AKfycb.../exec"
}
```

`index.html`과 이 JSON 파일을 같은 경로에 두고 **HTTP로 서빙**합니다.
(`file://`로 직접 열면 JSON fetch가 차단되어 로그인 화면에서 멈춥니다.)

### 4. 트리거 등록 (권장)

스프레드시트를 새로고침하면 상단에 **`출결 관리`** 메뉴가 나타납니다.
**`세션 자동 정리 트리거 등록 (1회)`**를 한 번 실행해두면 만료 세션이 매일 자동 정리됩니다.

---

## 시트 스키마

### `Users` — 계정

| 열 | 필드 | 설명 |
|:---:|---|---|
| A | `ID` | 학번 또는 교사 ID (기본키) |
| B | `NAME` | 이름 |
| C | `ROLE` | `학생` \| `교사` |
| D | `PW` | 솔트+페퍼 HMAC-SHA256 2000회 해시 (64자리 Hex) |
| E | `IN_TIME` | 입실 기준시간 `HH:MM` |
| F | `OUT_TIME` | 퇴실 기준시간 `HH:MM` |
| G | `FAIL` | 로그인 연속 실패 횟수 |
| H | `LOCK` | 잠금 해제 시각 (ms epoch) |
| I | `SALT` | 계정별 무작위 솔트 (비어있으면 레거시 계정) |
| J | `MUST_SETUP` | 초기 설정 강제 여부 `TRUE`/`FALSE` |

### `Attendance` — 출결 로그 (append-only)

| 열 | 필드 | 예시 |
|:---:|---|---|
| A | `TIME` | `08:55:12` |
| B | `DATE` | `2026-08-19` |
| C | `DAY` | `수` |
| D | `ID` | `31201` |
| E | `NAME` | `홍길동` |
| F | `TYPE` | `입실` \| `퇴실` |
| G | `STD_TIME` | `09:00` (기록 시점의 기준시간 스냅샷) |
| H | `STATUS` | `정상` \| `지각` \| `조퇴` \| `공결` |

### `BlockedDates` — 차단일 (자동 생성)

| 열 | 필드 | 예시 |
|:---:|---|---|
| A | `DATE` | `2026-05-01` |
| B | `REASON` | `근로자의 날` |
| C | `BLOCKED` | `TRUE` / `FALSE` |

### `Sessions` — 세션 토큰 (자동 생성)

| 열 | 필드 | 설명 |
|:---:|---|---|
| A | `TOKEN` | 발급된 UUID |
| B | `ID` | 사용자 ID |
| C | `ROLE` | **서버가 발급 시점에 기록한 역할** (권한 검증의 기준) |
| D | `EXPIRES` | 만료 시각 (ms epoch) |

### Script Properties

| 키 | 용도 |
|---|---|
| `PW_PEPPER` | 비밀번호 페퍼. 최초 요청 시 자동 생성되며 **시트에 저장되지 않습니다.** |
| `usersSchemaReady_v2` | Users 시트 G~J열 준비 완료 플래그 |

> **주의**: `PW_PEPPER`를 분실하거나 변경하면 **모든 계정의 비밀번호 검증이 실패합니다.**
> 스크립트를 다른 프로젝트로 이전할 때는 이 값도 함께 옮겨야 합니다.

---

## API

모든 요청은 `/exec`에 대한 단일 `POST`이며, 본문은 `{ action, ... }` 형태의 JSON입니다
(`code.gs` 의 `doPost`).

> **`Content-Type: application/json` 헤더를 추가하지 마세요.** GAS 웹앱은 CORS preflight(`OPTIONS`)에
> 응답하지 않습니다. 현재 `index.html` 의 `callAPI`는 헤더를 생략해
> `text/plain`으로 전송되며, 이 덕분에 preflight 없이 동작합니다.

응답은 항상 `{ success: boolean, msg?: string, ... }` 형태입니다.

**요청 빈도 제한**이 세션 검증보다 앞에서 걸립니다(`exceedsRateLimit`).
60초 고정 창 기준이며 한도는 정상 사용의 몇 배로 잡혀 있습니다 —
`login` 10회, `recordAttendance` 10회, 그 외 60회(모두 id 기준).
초과 시 `요청이 너무 잦습니다...` 메시지가 반환됩니다. 한도를 조이면
`tests.gs`의 `rateLimit (정상 사용 허용)` 테스트가 먼저 깨지도록 해두었습니다.

### 인증 불필요

| action | 파라미터 | 설명 |
|---|---|---|
| `getConfig` | — | 실습요일·공휴일·지각기준 등 업무 규칙 수신 |
| `login` | `id`, `pw` | 로그인. 성공 시 `token` 발급 |
| `checkTodayBlocked` | — | 오늘이 차단일인지 확인 |
| `logout` | `token` | 세션 토큰 폐기 |

### 본인 확인 필요 (`token` + `id` 일치)

| action | 파라미터 |
|---|---|
| `initialSetup` | `pw`, `inTime`, `outTime` |
| `changePw` | `currentPw`, `newPw` |
| `recordAttendance` | `type` (`입실`\|`퇴실`) |
| `getStudentStatus` | — |

### 교사 권한 필요 (세션의 `ROLE`이 `교사`)

| action | 파라미터 |
|---|---|
| `getAdminData` | `date` |
| `addStudent` | `studentId`, `name`, `inTime`, `outTime` |
| `updateStudent` | `studentId`, `name`, `inTime`, `outTime` |
| `deleteStudent` | `studentId` |
| `resetStudentPassword` | `studentId` |
| `setBlockedDate` | `date`, `reason`, `blocked` |
| `getBlockedDates` | — |
| `generateMonthlyReport` | `year`, `month` |
| `setOfficialAbsence` | `studentId`, `date`, `reason`, `cancel` |

`token`은 `callAPI`가 모든 요청에 자동으로 실어 보냅니다.

---

## 업무 규칙

모든 규칙의 단일 출처는 `code.gs` 상단 상수이며, 프론트는 `getConfig`로 내려받아 사용합니다.
프론트의 `CONFIG_FALLBACK`(`index.html`)은 서버 응답 실패 시의 표시용
기본값일 뿐이고, **최종 판정은 항상 서버가 합니다.**

| 상수 | 값 | 의미 |
|---|---|---|
| `FIELD_DAYS` | `[2,3,4]` | 현장실습일 = 화·수·목 |
| `OJT_START_MONTH` / `OJT_END_MONTH` | `3` / `12` | 1~2월은 OJT 비운영 |
| `LATE_GRACE_MINUTES` | `20` | 입실 기준시간 +20분 초과 시 `지각` |
| `DASHBOARD_LATE_ALERT_MINUTES` | `25` | 대시보드에서 따로 짚어주는 '지각 심화' 기준 |
| `OUT_UNLOCK_AFTER_MINUTES` | `120` | 입실 기준시간 +2시간 이후에만 퇴실 가능 |
| `REPORT_DAY_CLOSE_MINUTES` | `18*60` | 18시 이전에는 오늘을 레포트/미퇴실 판정에서 제외 |
| `SESSION_TTL_MS` | `30일` | 세션 유효기간 (슬라이딩 갱신) |
| `PW_HASH_ITERATIONS` | `2000` | 비밀번호 해시 반복 횟수 |

`FIXED_HOLIDAYS`에는 매년 날짜가 같은 공휴일 8일이 정의되어 있습니다.
**설날·추석·부처님오신날·대체공휴일·임시공휴일은 해마다 날짜가 달라서 여기에 없습니다.**
`VARIABLE_HOLIDAYS_BY_YEAR` 상수와 시트 메뉴로 등록합니다 —
아래 [매년 초에 할 일](#매년-초에-할-일)을 참조하세요.

---

## 구글 시트 전용 메뉴

스프레드시트 상단 **`출결 관리`** 메뉴 (`code.gs` 의 `onOpen`):

| 메뉴 | 동작 |
|---|---|
| 🔑 선생님 비밀번호 초기화 | 교사 계정 비밀번호 재설정 (비워두면 8자리 무작위 발급) |
| 지난 날짜 행 숨기기 (수동 실행) | 과거 출결 행을 숨겨 시트 탐색 부하 경감 |
| 숨긴 행 모두 보이기 | 위 작업 되돌리기 |
| 만료 세션 지금 정리 | `Sessions` 시트의 만료 행 일괄 삭제 |
| 세션 자동 정리 트리거 등록 (1회) | 일일 자동 정리 트리거 설치 |
| 📅 변동 공휴일 일괄 등록 | 해당 연도 변동 공휴일을 `BlockedDates` 시트에 등록 |
| 🔐 비밀번호 페퍼 백업값 보기 | `PW_PEPPER` 원본을 확인 (오프라인 보관용) |

교사가 비밀번호를 분실했을 때의 **유일한 복구 경로**가 첫 번째 메뉴입니다.

### 매년 초에 할 일

설날·추석·부처님오신날·대체공휴일·임시공휴일은 `FIXED_HOLIDAYS`에 없습니다.
**등록을 잊으면 그날 전원이 결석 처리됩니다.**

1. `code.gs`의 `VARIABLE_HOLIDAYS_BY_YEAR`에 새 연도를 추가합니다.
   실습요일(화·수·목)에 걸리는 날만 적으면 됩니다.
2. 시트 메뉴에서 **`📅 변동 공휴일 일괄 등록`**을 실행합니다.
3. `날짜 차단` 화면에서 등록 결과를 확인합니다.

2026년에 실습일과 겹치는 공휴일은 `06-03`(임시공휴일)과 `09-24`(추석 연휴) 둘뿐이며
이미 등록되어 있습니다.

---

## 보안 설계

- **비밀번호**: 계정별 무작위 솔트(시트 I열) + 스크립트 속성의 페퍼로 HMAC-SHA256을 2000회
  반복합니다(`hashPassword`). 페퍼가 시트 밖에 있으므로 시트 열람 권한만으로는
  해시를 역산할 수 없습니다.
- **레거시 자동 승급**: 평문 또는 단일 SHA-256으로 저장된 계정도 로그인은 되며, 성공 즉시
  신규 체계로 재저장됩니다(`matchStoredPassword`).
- **브루트포스 방어**: 5회 실패 시 5분 잠금. 실패 응답은 원인을 구분하지 않는 단일 메시지이며,
  200~500ms 랜덤 지연으로 타이밍 공격을 막습니다(`checkLogin`).
- **권한 위조 방지**: 교사 전용 API는 클라이언트가 보낸 role이 아니라 `Sessions` 시트에
  **서버가 기록한** role로 검증합니다(`verifySessionToken`).
- **로그인 유지**: 세션은 `localStorage`에 저장되어 브라우저를 닫아도 이어지며,
  **[로그아웃]을 누를 때까지 유지됩니다.** 무활동 자동 로그아웃은 없습니다.
  > ⚠️ **공용 PC에서는 반드시 [로그아웃]을 눌러야 합니다.** 누르지 않고 자리를 뜨면
  > 다음 사용자가 그 계정으로 출결을 기록할 수 있습니다(대리 출석).
  > 짧은 만료로 되돌리려면 `SESSION_TTL_MS`를 줄이세요 — 다만 프론트에는 만료를
  > 미리 알려주는 장치가 없어서, 사용 도중에 튕기게 됩니다.
- **ID 열거 방지**: 학번 존재 여부만 확인하는 엔드포인트는 의도적으로 제거되어 있습니다.
- **동시성**: 모든 읽기→수정 작업이 `LockService.getScriptLock()`을 경유합니다.
  로그인은 솔트 해싱을 락 **밖에서** 선계산해 락 점유 시간을 줄입니다(`checkLogin`).
- **XSS**: 프론트 `esc()` / 백엔드 `escapeHtml()` 이중 이스케이프.

---

## 개발 시 참고

- **빌드 과정이 없습니다.** `index.html`을 직접 편집하고 저장하면 끝입니다.
- **단일 파일 구조는 의도된 선택입니다.** HTML·CSS·JS를 별도 파일로 쪼개지 마세요.
  배포가 "`index.html` 하나를 올린다"로 끝나는 것이 이 프로젝트의 장점입니다.
  구획은 기존 `// ═══` / `// ───` 배너 주석 규칙을 따르고, 코드를 가리킬 때는
  줄번호 대신 함수명을 쓰세요.
- **프론트와 백엔드에 같은 규칙을 중복 정의하지 마세요.** 새 업무 규칙은 `code.gs` 상수에
  추가하고 `buildClientConfig()`로 내려보냅니다.
- **`alert()`/`confirm()` 대신 `showAlert()`/`showConfirm()`을 쓰세요.** 둘 다 Promise를
  반환합니다 — `await showConfirm("삭제할까요?")`.
  세션이 끊기는 경로에서는 `logout()`을 **먼저** 부르고 안내를 띄우세요. 모달은 사용자가
  확인을 누를 때까지 열려 있어서, 순서를 반대로 하면 그동안 로그인 상태가 유지됩니다.
- **날짜·시각 문자열은 `formatKST()`로 만드세요.** `nowKST()`는 요일·시각 '필드' 접근
  전용입니다. `Utilities.formatDate(nowKST(), 'GMT+9', ...)`처럼 쓰면 이중 변환이 되어
  스크립트 시간대가 `Asia/Seoul`이 아닐 때 날짜가 어긋납니다.
- **테스트**: Apps Script 편집기에서 `runAllTests`를 실행하면 `tests.gs`의 순수 함수
  테스트 20건이 돌고 [실행 로그]에 결과가 나옵니다. 시트에 접근하지 않으므로
  운영 데이터에 영향이 없습니다. 새 테스트는 `TEST_CASES` 배열에 한 줄 추가하면 됩니다.
  `benchmarkPasswordHash()`로는 해시 소요시간을 측정할 수 있습니다.

> ⚠️ **이 폴더는 아직 git 저장소가 아닙니다.** 편집 전에 `git init`으로 이력을 남기세요.
> (자세한 내용은 [IMPROVEMENTS.md](IMPROVEMENTS.md) 참조)

### 파일 편집 시 인코딩 주의

모든 파일은 **BOM 없는 UTF-8**입니다. Windows PowerShell의 `Get-Content` / `Set-Content`로
일괄 치환하면 UTF-8을 CP949로 읽어 **한글이 전부 깨집니다.** 편집기나
`[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`를 쓰세요.

알려진 개선 과제는 [IMPROVEMENTS.md](IMPROVEMENTS.md)를 참조하세요.

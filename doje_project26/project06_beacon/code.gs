/**
 * [GAS API 백엔드 - v3]
 * 추가 기능:
 *  7. 날짜 차단 — 교사 수동 ON/OFF + 공휴일 자동 차단 (BlockedDates 시트)
 *  8. 월간 PDF 레포트 — Google Drive 자동 저장 + 다운로드 URL 반환
 */

// ── 열 인덱스 상수 (Users 시트) ──────────────────────────────────────
const COL = {
  ID:         0,  // A: 학번/교사ID
  NAME:       1,  // B: 이름
  ROLE:       2,  // C: 역할 (학생|교사)
  PW:         3,  // D: 비밀번호 해시 (솔트+페퍼 반복 HMAC-SHA256)
  IN_TIME:    4,  // E: 입실 기준시간
  OUT_TIME:   5,  // F: 퇴실 기준시간
  FAIL:       6,  // G: 로그인 실패횟수
  LOCK:       7,  // H: 잠금해제시간 (timestamp ms)
  SALT:       8,  // I: 계정별 무작위 솔트 (비어있으면 레거시 계정)
  MUST_SETUP: 9,  // J: 초기 설정 필요 여부 (TRUE/FALSE)
};

// ── 열 인덱스 상수 (Attendance 시트) ─────────────────────────────────
const ACOL = {
  TIME:     0,  // A: 기록 시각 (HH:mm:ss)
  DATE:     1,  // B: 날짜 (yyyy-MM-dd)
  DAY:      2,  // C: 요일
  ID:       3,  // D: 학번
  NAME:     4,  // E: 이름
  TYPE:     5,  // F: 입실|퇴실
  STD_TIME: 6,  // G: 기준시간
  STATUS:   7,  // H: 정상|지각|조퇴
};

// ── 열 인덱스 상수 (BlockedDates 시트) ───────────────────────────────
// A: 날짜(yyyy-MM-dd)  B: 사유  C: 차단여부(TRUE/FALSE)
const BCOL = {
  DATE:    0,  // A: yyyy-MM-dd
  REASON:  1,  // B: 사유 (공휴일, 방학 등)
  BLOCKED: 2,  // C: TRUE=차단 / FALSE=허용
};

// ── OJT(현장실습) 운영 기간 (매년 3월 1일 ~ 12월 31일, 1~2월은 OJT 없음) ──
const OJT_START_MONTH = 3;  // 3월
const OJT_END_MONTH   = 12; // 12월

function isOjtMonth(month) {
  const m = parseInt(month, 10);
  return m >= OJT_START_MONTH && m <= OJT_END_MONTH;
}

// ── 현장실습일 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토) ───────────
const FIELD_DAYS = [2, 3, 4]; // 화, 수, 목

// 하루 업무 마감 시각. 이 시각 전에는 오늘을 레포트에 집계하지 않고,
// 교사 대시보드의 "미퇴실자" 판정도 시작하지 않습니다.
const REPORT_DAY_CLOSE_MINUTES = 18 * 60;

// 입실 기준시간을 이만큼 넘기면 '지각'으로 기록합니다.
const LATE_GRACE_MINUTES = 20;

// 대시보드에서 교사에게 별도로 짚어주는 '지각 심화' 기준.
// 기록상 지각(20분)보다 크게 늦은 학생만 추리기 위한 별개 값입니다.
const DASHBOARD_LATE_ALERT_MINUTES = 25;

// 서버 공통 고정 공휴일. 변동 공휴일은 BlockedDates 시트에서 관리합니다.
const FIXED_HOLIDAYS = {
  '01-01': '새해', '03-01': '삼일절', '05-05': '어린이날',
  '06-06': '현충일', '08-15': '광복절', '10-03': '개천절',
  '10-09': '한글날', '12-25': '크리스마스',
};

// ── 레거시 초기 비밀번호 ──────────────────────────────────────────────
// 신규 계정은 계정마다 무작위 초기 비밀번호를 발급합니다(generateInitialPassword).
// 아래 상수는 예전 방식으로 만들어진 계정을 계속 로그인시키고, 새 비밀번호로
// 재사용하지 못하게 막기 위해서만 남겨둡니다.
const INITIAL_PW = { STUDENT: '0000', TEACHER: '1234' };

// ── 비밀번호 해싱 ─────────────────────────────────────────────────────
// 계정별 솔트(시트 I열) + 스크립트 속성에 보관하는 페퍼를 함께 사용합니다.
// 페퍼는 스프레드시트에 저장되지 않으므로, 시트 열람 권한만 가진 사람은
// 해시를 역산할 수 없습니다.
const PW_PEPPER_PROP = 'PW_PEPPER';

// 반복 횟수. GAS는 반복 해싱이 느린 편이라 과도하게 올리면 로그인이 지연됩니다.
// benchmarkPasswordHash()를 편집기에서 실행해 실제 소요시간을 보고 조정하세요.
const PW_HASH_ITERATIONS = 2000;

// 무작위 초기 비밀번호에 사용할 문자 (0/O/1/l/I 등 혼동 문자 제외)
const INITIAL_PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INITIAL_PW_LENGTH   = 8;

// Users 시트 스키마(솔트·초기설정 열) 준비 완료 플래그
const USERS_SCHEMA_PROP = 'usersSchemaReady_v2';

// 퇴실 버튼과 동일한 서버 측 최소 대기시간 (입실 기준시간 + 2시간)
const OUT_UNLOCK_AFTER_MINUTES = 2 * 60;

// ── 시트 lazy 초기화 ──────────────────────────────────────────────────
function getSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    users:        ss.getSheetByName('Users'),
    attend:       ss.getSheetByName('Attendance'),
    blockedDates: ss.getSheetByName('BlockedDates'),
    sessions:     ss.getSheetByName('Sessions'),
  };
}

// ─────────────────────────────────────────────────────────────────────
// doPost 진입점
// ─────────────────────────────────────────────────────────────────────
function doPost(e) {
  const sheets = getSheets();
  if (!sheets.users || !sheets.attend) {
    return jsonResponse({ success: false, msg: 'Users 또는 Attendance 시트가 존재하지 않습니다.' });
  }

  // BlockedDates 시트 없으면 자동 생성
  if (!ensureBlockedDatesSheet(sheets)) {
    return jsonResponse(lockBusyResponse());
  }

  // Sessions 시트 없으면 자동 생성 (세션 토큰 저장용)
  if (!ensureSessionsSheet(sheets)) {
    return jsonResponse(lockBusyResponse());
  }

  // FAIL/LOCK/솔트/초기설정 열이 없을 경우 1회 자동 추가
  if (!ensureUserSheetColumns(sheets.users)) {
    return jsonResponse(lockBusyResponse());
  }

  // ✅ 지난 날짜 출결 기록 자동 숨김 — 날짜가 바뀐 뒤 첫 요청에서만 실제 작업 수행
  //    (그 외에는 스크립트 속성 값 하나만 읽으므로 비용이 거의 없습니다)
  maybeHidePastAttendanceRows(sheets.attend);

  // ✅ 만료 세션 자동 정리 — 위와 같이 날짜가 바뀐 뒤 첫 요청에서만 수행
  maybeCleanupExpiredSessions(sheets.sessions);

  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (_) {
    return jsonResponse({ success: false, msg: '요청 형식이 올바르지 않습니다.' });
  }

  const action = req.action;
  let response = {};

  try {
    switch (action) {
      // ── 인증 불필요 (로그인 전) ──────────────────────────────────────
      // 'checkId'(학번 존재 여부 조회)는 학번 열거에 악용될 수 있어 제거했습니다.
      // 로그인 실패 시의 일반화된 오류 메시지로 충분합니다.
      case 'getConfig':
        response = { success: true, config: buildClientConfig() };
        break;
      case 'login':
        response = checkLogin(sheets.users, sheets.sessions, req.id, req.pw);
        break;
      case 'checkTodayBlocked':
        response = checkTodayBlockedAction(sheets.blockedDates);
        break;
      case 'logout':
        response = invalidateSessionToken(sheets.sessions, req.token);
        break;

      // ── 본인 확인 필요 (세션 토큰 == 본인 id) ────────────────────────
      case 'initialSetup': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id);
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = initialSetup(sheets.users, req.id, req.pw, req.inTime, req.outTime);
        break;
      }
      case 'changePw': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id);
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = changePw(sheets.users, req.id, req.currentPw, req.newPw);
        break;
      }
      case 'recordAttendance': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id);
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = recordAttendance(sheets.users, sheets.attend, sheets.blockedDates, req.id, req.type);
        break;
      }
      case 'getStudentStatus': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id);
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = getStudentStatus(sheets.attend, req.id);
        break;
      }

      // ── 교사 권한 필요 (세션의 role이 서버 발급 당시 값 — 위조 불가) ──
      case 'getAdminData': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = { success: true, data: getAdminData(sheets.users, sheets.attend, sheets.blockedDates, req.date) };
        break;
      }
      case 'addStudent': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = addStudent(sheets.users, req.studentId, req.name, req.inTime, req.outTime);
        break;
      }
      case 'updateStudent': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = updateStudent(sheets.users, sheets.sessions, req.studentId, req.name, req.inTime, req.outTime);
        break;
      }
      case 'deleteStudent': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = deleteStudent(sheets.users, sheets.sessions, req.studentId);
        break;
      }
      case 'resetStudentPassword': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = resetStudentPassword(sheets.users, sheets.sessions, req.studentId);
        break;
      }
      case 'setBlockedDate': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = setBlockedDate(sheets.blockedDates, req.date, req.reason, req.blocked);
        break;
      }
      case 'getBlockedDates': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = getBlockedDates(sheets.blockedDates);
        break;
      }
      case 'generateMonthlyReport': {
        const sv = verifySessionToken(sheets.sessions, req.token, req.id, '교사');
        if (!sv.valid) { response = { success: false, msg: sv.msg }; break; }
        response = generateMonthlyReport(sheets.users, sheets.attend, sheets.blockedDates, req.year, req.month);
        break;
      }
      default:
        response = { success: false, msg: '알 수 없는 요청입니다.' };
    }
  } catch (error) {
    response = { success: false, msg: '서버 오류: ' + error.message };
  }

  return jsonResponse(response);
}

// ─────────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────
// 클라이언트 설정
//
// 실습요일·공휴일·지각 기준 같은 규칙은 이 파일이 유일한 출처입니다.
// 프론트가 같은 값을 따로 들고 있으면 한쪽만 고쳤을 때 조용히 어긋나므로,
// 로그인 전에 이 액션으로 내려받아 쓰게 합니다.
// ─────────────────────────────────────────────────────────────────────
function buildClientConfig() {
  return {
    fieldDays:                 FIELD_DAYS,
    ojtStartMonth:             OJT_START_MONTH,
    ojtEndMonth:               OJT_END_MONTH,
    holidays:                  FIXED_HOLIDAYS,
    outUnlockAfterMinutes:     OUT_UNLOCK_AFTER_MINUTES,
    lateGraceMinutes:          LATE_GRACE_MINUTES,
    dashboardLateAlertMinutes: DASHBOARD_LATE_ALERT_MINUTES,
    dayCloseMinutes:           REPORT_DAY_CLOSE_MINUTES,
    sessionTimeoutMs:          SESSION_TTL_MS,
    minPasswordLength:         PW_MIN_LENGTH,
    maxPasswordLength:         PW_MAX_LENGTH,
    // 새 비밀번호로 재사용을 막을 레거시 고정 초기 비밀번호
    blockedPasswords:          [INITIAL_PW.STUDENT, INITIAL_PW.TEACHER],
  };
}

const LOCK_WAIT_MS = 5000;
const LOCK_BUSY_MSG = '다른 요청을 처리 중입니다. 잠시 후 다시 시도해주세요.';

// 모든 읽기→수정 작업에서 동일한 ScriptLock을 사용합니다.
// 콜백이 예외를 던지거나 중간 return을 하더라도 잠금은 반드시 해제됩니다.
function runWithScriptLock(callback, waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) {
    return { acquired: false, value: null };
  }
  try {
    return { acquired: true, value: callback() };
  } finally {
    lock.releaseLock();
  }
}

function lockBusyResponse() {
  return { success: false, msg: LOCK_BUSY_MSG };
}

// FAIL/LOCK/SALT/MUST_SETUP 열과 헤더를 1회 보장합니다.
// 매 요청마다 시트를 읽지 않도록 완료 여부를 스크립트 속성에 캐시합니다.
function ensureUserSheetColumns(userSheet) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(USERS_SCHEMA_PROP) === 'true') return true;

  const REQUIRED_HEADERS = [
    [COL.FAIL,       '실패횟수'],
    [COL.LOCK,       '잠금해제시간'],
    [COL.SALT,       '솔트'],
    [COL.MUST_SETUP, '초기설정필요'],
  ];
  const neededColumns = COL.MUST_SETUP + 1;

  const locked = runWithScriptLock(() => {
    const maxColumns = userSheet.getMaxColumns();
    if (maxColumns < neededColumns) {
      userSheet.insertColumnsAfter(maxColumns, neededColumns - maxColumns);
    }
    // 빈 헤더만 채웁니다 (이미 다른 이름을 쓰고 있으면 건드리지 않음)
    const header = userSheet.getRange(1, 1, 1, neededColumns).getDisplayValues()[0];
    REQUIRED_HEADERS.forEach(([index, label]) => {
      if (header[index].toString().trim() === '') {
        userSheet.getRange(1, index + 1).setValue(label);
      }
    });
    props.setProperty(USERS_SCHEMA_PROP, 'true');
  });
  return locked.acquired;
}

// 시트 값이 비어있거나 열 자체가 없을 때도 안전하게 문자열을 얻습니다.
function cellAt(row, index) {
  const value = row[index];
  return value === null || value === undefined ? '' : value.toString().trim();
}

// BlockedDates 시트 자동 생성
function ensureBlockedDatesSheet(sheets) {
  if (sheets.blockedDates) return true;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const locked = runWithScriptLock(() => {
    const existingSheet = ss.getSheetByName('BlockedDates');
    if (existingSheet) return existingSheet;

    const newSheet = ss.insertSheet('BlockedDates');
    newSheet.getRange(1, 1, 1, 3).setValues([['날짜(yyyy-MM-dd)', '사유', '차단여부']]);
    newSheet.setFrozenRows(1);
    return newSheet;
  });
  if (!locked.acquired) return false;
  sheets.blockedDates = locked.value;
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// 세션 토큰 (Sessions 시트) — 로그인 성공 시 발급, 이후 모든 민감 요청은
// req.id 뿐 아니라 이 토큰을 서버가 직접 검증해야 통과됩니다.
// role 은 로그인 시점에 서버가 Users 시트에서 읽어 저장하므로,
// 클라이언트가 id 값만으로 교사 권한을 위조할 수 없습니다.
// ─────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 60 * 1000; // 30분 (프론트 세션타임아웃과 동일)

// 만료시각은 매 요청마다 갱신하지 않고, 남은 시간이 이 값보다 짧을 때만
// 다시 씁니다. 30초마다 폴링하는 교사 대시보드의 시트 쓰기를 크게 줄입니다.
const SESSION_REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // 10분

const SCOL = {
  TOKEN:   0,  // A: 토큰(UUID)
  ID:      1,  // B: 학번/교사ID
  ROLE:    2,  // C: 역할
  EXPIRES: 3,  // D: 만료시각(ms epoch)
};

function ensureSessionsSheet(sheets) {
  if (sheets.sessions) return true;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const locked = runWithScriptLock(() => {
    const existingSheet = ss.getSheetByName('Sessions');
    if (existingSheet) return existingSheet;

    const newSheet = ss.insertSheet('Sessions');
    newSheet.getRange(1, 1, 1, 4).setValues([['토큰', '학번/ID', '역할', '만료시각(ms)']]);
    newSheet.setFrozenRows(1);
    return newSheet;
  });
  if (!locked.acquired) return false;
  sheets.sessions = locked.value;
  return true;
}

// 로그인 성공 시 세션 토큰 발급
function createSessionToken(sessionSheet, id, role) {
  const token     = Utilities.getUuid();
  const expiresAt = new Date().getTime() + SESSION_TTL_MS;
  sessionSheet.appendRow([token, id, role, expiresAt]);
  return token;
}

// 세션 토큰 검증 (+ 필요시 role 확인) — 통과 시 만료시각을 슬라이딩 갱신
function verifySessionToken(sessionSheet, token, id, requiredRole) {
  const invalidMsg = '세션이 유효하지 않습니다. 다시 로그인해주세요.';
  if (!sessionSheet || !token || !id) return { valid: false, msg: invalidMsg };

  const locked = runWithScriptLock(() => {
    const data  = sessionSheet.getDataRange().getValues();
    const nowMs = new Date().getTime();

    for (let i = 1; i < data.length; i++) {
      if (data[i][SCOL.TOKEN] !== token) continue;

      const rowId     = data[i][SCOL.ID].toString().trim();
      const rowRole   = data[i][SCOL.ROLE];
      const expiresAt = Number(data[i][SCOL.EXPIRES]);

      if (rowId !== id.toString().trim()) return { valid: false, msg: invalidMsg };

      if (nowMs > expiresAt) {
        sessionSheet.deleteRow(i + 1);
        return { valid: false, msg: '세션이 만료되었습니다. 다시 로그인해주세요.' };
      }
      if (requiredRole && rowRole !== requiredRole) {
        return { valid: false, msg: '권한이 없습니다. (교사 전용)' };
      }

      // 남은 시간이 충분하면 쓰기를 생략합니다 (슬라이딩 만료는 그대로 유지).
      if (expiresAt - nowMs < SESSION_REFRESH_THRESHOLD_MS) {
        sessionSheet.getRange(i + 1, SCOL.EXPIRES + 1).setValue(nowMs + SESSION_TTL_MS);
      }
      return { valid: true, role: rowRole };
    }
    return { valid: false, msg: invalidMsg };
  });

  return locked.acquired
    ? locked.value
    : { valid: false, msg: LOCK_BUSY_MSG };
}

// ─────────────────────────────────────────────────────────────────────
// 만료 세션 일괄 정리
//
// 토큰 행은 ①로그아웃 ②만료된 토큰이 다시 제시될 때만 삭제되므로,
// 학생이 탭만 닫으면 행이 영구히 남습니다. Sessions 시트가 커지면
// verifySessionToken()이 매 요청마다 전역 잠금 위에서 전체를 훑게 되어
// 시스템 전체가 느려지므로 주기적으로 정리해야 합니다.
//
// 삭제는 행 단위 deleteRow 반복 대신, 살아있는 행을 위로 모아 쓰고
// 남은 꼬리를 한 번에 지우는 방식으로 API 호출을 최소화합니다.
// 호출자가 ScriptLock을 보유한 상태에서 사용합니다.
// ─────────────────────────────────────────────────────────────────────
function cleanupExpiredSessionsUnsafe(sessionSheet) {
  if (!sessionSheet) return 0;
  const lastRow = sessionSheet.getLastRow();
  if (lastRow < 2) return 0;

  const rowCount = lastRow - 1;
  const data     = sessionSheet.getRange(2, 1, rowCount, 4).getValues();
  const nowMs    = new Date().getTime();

  const alive = data.filter(row =>
    row[SCOL.TOKEN].toString().trim() !== '' && Number(row[SCOL.EXPIRES]) > nowMs
  );

  const removed = rowCount - alive.length;
  if (removed === 0) return 0;

  if (alive.length > 0) {
    sessionSheet.getRange(2, 1, alive.length, 4).setValues(alive);
  }
  sessionSheet.deleteRows(2 + alive.length, removed);
  return removed;
}

// 날짜가 바뀐 뒤 첫 요청에서만 실제 정리를 수행합니다.
// (그 외에는 스크립트 속성 값 하나만 읽으므로 비용이 거의 없습니다)
function maybeCleanupExpiredSessions(sessionSheet) {
  if (!sessionSheet) return;
  const todayStr = Utilities.formatDate(nowKST(), 'GMT+9', 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastSessionCleanupDate') === todayStr) return;

  runWithScriptLock(() => {
    // 잠금을 기다리는 동안 다른 요청이 처리했을 수 있으므로 다시 확인합니다.
    if (props.getProperty('lastSessionCleanupDate') === todayStr) return;
    cleanupExpiredSessionsUnsafe(sessionSheet);
    props.setProperty('lastSessionCleanupDate', todayStr);
  });
}

// 시간 기반 트리거용 진입점 (installSessionCleanupTrigger로 등록)
function dailySessionCleanup() {
  const sheets = getSheets();
  if (!sheets.sessions) return;
  const locked = runWithScriptLock(() => cleanupExpiredSessionsUnsafe(sheets.sessions));
  if (locked.acquired) {
    PropertiesService.getScriptProperties()
      .setProperty('lastSessionCleanupDate',
                   Utilities.formatDate(nowKST(), 'GMT+9', 'yyyy-MM-dd'));
    Logger.log(`만료 세션 ${locked.value}건 삭제`);
  }
}

// GAS 편집기에서 1회 실행하면 매일 새벽 3시에 정리 트리거가 돌아갑니다.
function installSessionCleanupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailySessionCleanup')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('dailySessionCleanup')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  Logger.log('세션 정리 트리거를 등록했습니다. (매일 03시)');
}

// 로그아웃 시 토큰 즉시 폐기
function invalidateSessionToken(sessionSheet, token) {
  if (!sessionSheet || !token) return { success: true };

  const locked = runWithScriptLock(() => {
    const data = sessionSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][SCOL.TOKEN] === token) {
        sessionSheet.deleteRow(i + 1);
        break;
      }
    }
    return { success: true };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

// ─────────────────────────────────────────────────────────────────────
// 지난 날짜 출결 기록 행 자동 숨김
// Attendance 시트의 DATE 열이 오늘보다 이전인 행은 숨기고,
// 오늘 이후(오늘 포함) 행은 보이게 유지합니다. (데이터 삭제 아님 — 숨김만)
// 스크립트 속성에 마지막 처리 날짜를 저장해, 날짜가 바뀐 뒤
// 첫 요청에서만 실제 hide/show 작업을 수행하도록 해서 매 요청마다
// 불필요하게 시트를 다시 스캔하지 않도록 합니다.
// ─────────────────────────────────────────────────────────────────────
function maybeHidePastAttendanceRows(attendSheet) {
  if (!attendSheet) return;
  const todayStr = Utilities.formatDate(nowKST(), 'GMT+9', 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastHiddenDate') === todayStr) return; // 오늘 이미 처리됨

  runWithScriptLock(() => {
    // 잠금을 기다리는 동안 다른 요청이 처리했을 수 있으므로 다시 확인합니다.
    if (props.getProperty('lastHiddenDate') === todayStr) return;
    hidePastAttendanceRows(attendSheet, todayStr);
    props.setProperty('lastHiddenDate', todayStr);
  });
}

// 실제 hide/show 처리 — 연속된 구간을 묶어서 처리해 API 호출 횟수를 최소화
function hidePastAttendanceRows(attendSheet, todayStr) {
  const lastRow = attendSheet.getLastRow();
  if (lastRow < 2) return;

  const dateValues = attendSheet.getRange(2, ACOL.DATE + 1, lastRow - 1, 1).getDisplayValues();

  let i = 0;
  while (i < dateValues.length) {
    const isPastRow = (d) => {
      const trimmed = d.toString().trim();
      return trimmed !== '' && trimmed < todayStr;
    };
    const isPast = isPastRow(dateValues[i][0]);
    let j = i + 1;
    while (j < dateValues.length && isPastRow(dateValues[j][0]) === isPast) {
      j++;
    }
    const startRow = i + 2; // 헤더(1행) 다음부터 시작
    const numRows  = j - i;
    if (isPast) {
      attendSheet.hideRows(startRow, numRows);
    } else {
      attendSheet.showRows(startRow, numRows);
    }
    i = j;
  }
}

// 시트 메뉴에서 수동으로 즉시 실행 (필요 시 언제든 재적용 가능)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('출결 관리')
    .addItem('🔑 선생님 비밀번호 초기화', 'manualResetTeacherPassword')
    .addSeparator()
    .addItem('지난 날짜 행 숨기기 (수동 실행)', 'manualHidePastAttendanceRows')
    .addItem('숨긴 행 모두 보이기', 'unhideAllAttendanceRows')
    .addSeparator()
    .addItem('만료 세션 지금 정리', 'manualCleanupSessions')
    .addItem('세션 자동 정리 트리거 등록 (1회)', 'installSessionCleanupTrigger')
    .addToUi();
}

/**
 * [교사 비밀번호 초기화] 구글 시트 메뉴에서 직접 실행
 * - Users 시트의 교사 계정을 조회하여 비밀번호를 안전하게 재설정합니다.
 * - 직접 입력하거나, 비워두면 8자리 무작위 비밀번호를 자동 발급합니다.
 */
function manualResetTeacherPassword() {
  const ui = SpreadsheetApp.getUi();
  const sheets = getSheets();
  if (!sheets.users) {
    ui.alert('오류', 'Users 시트를 찾을 수 없습니다.', ui.ButtonSet.OK);
    return;
  }

  const displayData = sheets.users.getDataRange().getDisplayValues();
  const teachers = [];
  for (let i = 1; i < displayData.length; i++) {
    const role = cellAt(displayData[i], COL.ROLE);
    if (role === '교사') {
      teachers.push({
        rowIdx: i,
        id: cellAt(displayData[i], COL.ID),
        name: cellAt(displayData[i], COL.NAME),
      });
    }
  }

  if (teachers.length === 0) {
    ui.alert('알림', '등록된 교사(선생님) 계정이 없습니다.\nUsers 시트에 역할(ROLE)이 "교사"인 계정이 있는지 확인해주세요.', ui.ButtonSet.OK);
    return;
  }

  let targetTeacher = null;
  if (teachers.length === 1) {
    targetTeacher = teachers[0];
    const confirmRes = ui.alert(
      '선생님 비밀번호 초기화',
      `[선생님 계정 정보]\n- 교사 ID: ${targetTeacher.id}\n- 이름: ${targetTeacher.name}\n\n해당 계정의 비밀번호를 초기화하시겠습니까?`,
      ui.ButtonSet.YES_NO
    );
    if (confirmRes !== ui.Button.YES) return;
  } else {
    const teacherListText = teachers.map(t => `• ID: ${t.id} (${t.name})`).join('\n');
    const promptRes = ui.prompt(
      '선생님 비밀번호 초기화',
      `비밀번호를 초기화할 교사 ID를 입력해주세요:\n\n[등록된 교사 목록]\n${teacherListText}`,
      ui.ButtonSet.OK_CANCEL
    );
    if (promptRes.getSelectedButton() !== ui.Button.OK) return;
    const inputId = promptRes.getResponseText().trim();
    if (!inputId) {
      ui.alert('알림', '교사 ID를 입력하지 않았습니다.', ui.ButtonSet.OK);
      return;
    }
    targetTeacher = teachers.find(t => t.id === inputId);
    if (!targetTeacher) {
      ui.alert('오류', `입력하신 ID(${inputId})에 해당하는 교사 계정을 찾을 수 없습니다.`, ui.ButtonSet.OK);
      return;
    }
  }

  const pwPrompt = ui.prompt(
    '새 임시 비밀번호 설정',
    `교사(${targetTeacher.name} / ${targetTeacher.id}) 계정의 임시 비밀번호를 입력하세요.\n\n(비워두고 [확인]을 누르면 안전한 8자리 무작위 비밀번호가 자동 생성됩니다.)`,
    ui.ButtonSet.OK_CANCEL
  );
  if (pwPrompt.getSelectedButton() !== ui.Button.OK) return;

  let newPw = pwPrompt.getResponseText().trim();
  if (newPw === '') {
    newPw = generateInitialPassword();
  } else {
    if (newPw.length < PW_MIN_LENGTH || newPw.length > PW_MAX_LENGTH) {
      ui.alert('오류', `비밀번호는 ${PW_MIN_LENGTH}~${PW_MAX_LENGTH}자여야 합니다.`, ui.ButtonSet.OK);
      return;
    }
  }

  if (!ensurePasswordPepper()) {
    ui.alert('오류', LOCK_BUSY_MSG, ui.ButtonSet.OK);
    return;
  }

  const locked = runWithScriptLock(() => {
    const latestData = sheets.users.getDataRange().getDisplayValues();
    const rowIdx = findUserRowIndex(latestData, targetTeacher.id);
    if (rowIdx < 0) {
      return { success: false, msg: '사용자를 찾을 수 없습니다.' };
    }

    writePasswordUnsafe(sheets.users, rowIdx, newPw);
    sheets.users.getRange(rowIdx + 1, COL.FAIL + 1).setValue(0);
    sheets.users.getRange(rowIdx + 1, COL.LOCK + 1).setValue(0);
    sheets.users.getRange(rowIdx + 1, COL.MUST_SETUP + 1).setValue('TRUE');

    if (sheets.sessions) {
      deleteSessionsForUserUnsafe(sheets.sessions, targetTeacher.id);
    }

    return { success: true };
  });

  if (!locked.acquired || !locked.value.success) {
    ui.alert('오류', locked.acquired ? locked.value.msg : LOCK_BUSY_MSG, ui.ButtonSet.OK);
    return;
  }

  ui.alert(
    '비밀번호 초기화 완료',
    `✅ ${targetTeacher.name} 선생님의 비밀번호가 초기화되었습니다.\n\n` +
    `• 교사 ID: ${targetTeacher.id}\n` +
    `• 새 임시 비밀번호: ${newPw}\n\n` +
    `※ 웹 화면에서 로그인 후 최초 1회 새 비밀번호로 변경해야 합니다.\n` +
    `※ 기존에 로그인되어 있던 모든 세션은 즉시 로그아웃되었습니다.`,
    ui.ButtonSet.OK
  );
}

function manualCleanupSessions() {
  const sheets = getSheets();
  if (!sheets.sessions) {
    SpreadsheetApp.getUi().alert('Sessions 시트를 찾을 수 없습니다.');
    return;
  }
  const locked = runWithScriptLock(() => cleanupExpiredSessionsUnsafe(sheets.sessions));
  if (!locked.acquired) {
    SpreadsheetApp.getUi().alert(LOCK_BUSY_MSG);
    return;
  }
  SpreadsheetApp.getUi().alert(`만료된 세션 ${locked.value}건을 삭제했습니다.`);
}

function manualHidePastAttendanceRows() {
  const sheets = getSheets();
  if (!sheets.attend) {
    SpreadsheetApp.getUi().alert('Attendance 시트를 찾을 수 없습니다.');
    return;
  }
  const todayStr = Utilities.formatDate(nowKST(), 'GMT+9', 'yyyy-MM-dd');
  const locked = runWithScriptLock(() => {
    hidePastAttendanceRows(sheets.attend, todayStr);
    PropertiesService.getScriptProperties().setProperty('lastHiddenDate', todayStr);
  });
  if (!locked.acquired) {
    SpreadsheetApp.getUi().alert(LOCK_BUSY_MSG);
    return;
  }
  SpreadsheetApp.getUi().alert('지난 날짜 행 숨기기를 완료했습니다.');
}

// 숨긴 행을 다시 모두 표시 (예: 지난 기록을 살펴봐야 할 때)
function unhideAllAttendanceRows() {
  const sheets = getSheets();
  if (!sheets.attend) {
    SpreadsheetApp.getUi().alert('Attendance 시트를 찾을 수 없습니다.');
    return;
  }
  const locked = runWithScriptLock(() => {
    const lastRow = sheets.attend.getLastRow();
    if (lastRow >= 2) {
      sheets.attend.showRows(2, lastRow - 1);
    }
    // 다음 요청에서 다시 자동으로 지난 날짜가 숨겨지도록 초기화
    PropertiesService.getScriptProperties().deleteProperty('lastHiddenDate');
  });
  if (!locked.acquired) {
    SpreadsheetApp.getUi().alert(LOCK_BUSY_MSG);
    return;
  }
  SpreadsheetApp.getUi().alert('모든 행을 다시 표시했습니다.');
}

// ─────────────────────────────────────────────────────────────────────
// 비밀번호 해싱
// ─────────────────────────────────────────────────────────────────────
function bytesToHex(bytes) {
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

// 페퍼를 1회 생성해 스크립트 속성에 보관합니다.
// ⚠️ 잠금을 잡기 전에 호출해야 합니다 (ScriptLock 중첩 방지).
function ensurePasswordPepper() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PW_PEPPER_PROP)) return true;

  const locked = runWithScriptLock(() => {
    if (!props.getProperty(PW_PEPPER_PROP)) {
      props.setProperty(PW_PEPPER_PROP, generateSalt() + generateSalt());
    }
  });
  return locked.acquired;
}

function getPasswordPepper() {
  const pepper = PropertiesService.getScriptProperties().getProperty(PW_PEPPER_PROP);
  if (!pepper) throw new Error('비밀번호 페퍼가 초기화되지 않았습니다.');
  return pepper;
}

function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

// 솔트 + 페퍼를 키로 쓰는 반복 HMAC-SHA256.
// 솔트가 계정마다 다르므로 레인보우 테이블도, "누가 아직 초기 비밀번호인지"를
// 해시 비교로 알아내는 것도 불가능합니다.
function hashPassword(pw, salt) {
  if (!salt) throw new Error('솔트 없이 비밀번호를 해싱할 수 없습니다.');
  const keyBytes = Utilities.newBlob(salt + getPasswordPepper()).getBytes();

  let digest = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(String(pw)).getBytes(), keyBytes);
  for (let i = 1; i < PW_HASH_ITERATIONS; i++) {
    digest = Utilities.computeHmacSha256Signature(digest, keyBytes);
  }
  return bytesToHex(digest);
}

// 레거시(솔트 없는 단일 SHA-256) — 기존 계정의 로그인 검증 및 자동 승급에만 사용
function legacyHashPassword(pw) {
  return bytesToHex(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw, Utilities.Charset.UTF_8));
}

// 저장된 비밀번호와 입력값을 비교합니다.
// 솔트가 있으면 신규 방식, 없으면 레거시(해시 또는 평문)로 판정하고
// 레거시인 경우 승급이 필요함을 함께 알려줍니다.
// hashWithSalt: 같은 솔트에 대한 중복 계산을 피하기 위한 주입형 해시 함수
function matchStoredPassword(storedPw, storedSalt, inputPw, hashWithSalt) {
  if (storedSalt) {
    return { matched: storedPw === hashWithSalt(storedSalt), needsUpgrade: false };
  }
  if (storedPw.length === 64) {
    const matched = storedPw === legacyHashPassword(inputPw);
    return { matched, needsUpgrade: matched };
  }
  const matched = storedPw !== '' && storedPw === inputPw; // 평문이 남아있는 경우
  return { matched, needsUpgrade: matched };
}

// 계정 행의 비밀번호를 신규 방식으로 다시 저장합니다.
// 호출자가 ScriptLock을 보유한 상태에서 사용합니다.
function writePasswordUnsafe(userSheet, rowIdx, plainPw) {
  const salt = generateSalt();
  userSheet.getRange(rowIdx + 1, COL.PW + 1).setValue(hashPassword(plainPw, salt));
  userSheet.getRange(rowIdx + 1, COL.SALT + 1).setValue(salt);
}

// 계정별 무작위 초기 비밀번호 (혼동 문자 제외 8자)
// UUID v4의 무작위 바이트를 사용합니다. 알파벳이 32자라 256 % 32 === 0 이므로
// 모듈러 편향이 발생하지 않습니다.
function generateInitialPassword() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < INITIAL_PW_LENGTH; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    out += INITIAL_PW_ALPHABET[byte % INITIAL_PW_ALPHABET.length];
  }
  return out;
}

// PW_HASH_ITERATIONS 튜닝용 — GAS 편집기에서 직접 실행하세요.
function benchmarkPasswordHash() {
  ensurePasswordPepper();
  const salt = generateSalt();
  const started = new Date().getTime();
  hashPassword('benchmark-sample-password', salt);
  const elapsed = new Date().getTime() - started;
  Logger.log(`반복 ${PW_HASH_ITERATIONS}회 → ${elapsed}ms`);
  Logger.log('로그인 1건당 이 시간이 추가됩니다. 200ms 이하를 권장합니다.');
}

// 현장실습일 여부
function isFieldDay(dayIndex) {
  return FIELD_DAYS.includes(dayIndex);
}

// 초기 비밀번호 여부
function isInitialPw(role, pw) {
  return (role === '학생' && pw === INITIAL_PW.STUDENT) ||
         (role === '교사' && pw === INITIAL_PW.TEACHER);
}

// 한국 시간 기준 현재 Date
function nowKST() {
  const nowStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
  return new Date(nowStr.replace(/-/g, '/'));
}

// ✅ 시간값 정규화 — Date 객체 / "9:00" / "09:00" / "9:38:12" 모두 → "HH:MM" 문자열로 변환
function timeObjectToHHMM(val) {
  if (!val || val === '') return '';
  // Date 객체인 경우
  if (val instanceof Date || (typeof val === 'object' && val !== null)) {
    const d = new Date(val);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  // 문자열인 경우 — 콜론 분리 후 2자리 패딩
  const str   = val.toString().trim();
  const parts = str.split(':');
  if (parts.length >= 2) {
    return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
  }
  return str.replace(/:+$/, '');
}

// HH:MM을 0~1439 사이의 분으로 변환. 잘못된 시간은 null을 반환합니다.
function hhmmToMinutes(val) {
  const hhmm = timeObjectToHHMM(val);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToHHMM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────
// 입력값 유효성 검사 유틸
// ─────────────────────────────────────────────────────────────────────

// 비밀번호 길이 — 아래 PATTERN.PW와 클라이언트 설정이 모두 이 값에서 파생됩니다.
const PW_MIN_LENGTH = 4;
const PW_MAX_LENGTH = 50;

// 허용 패턴 상수
const PATTERN = {
  ID:       /^[a-zA-Z0-9가-힣_\-]{1,30}$/,        // 학번/ID: 영문·숫자·한글·_- 1~30자
  NAME:     /^[가-힣a-zA-Z\s]{1,20}$/,             // 이름: 한글·영문·공백 1~20자
  PW:       new RegExp(`^.{${PW_MIN_LENGTH},${PW_MAX_LENGTH}}$`), // 비밀번호 길이만 제한
  TIME:     /^([01]\d|2[0-3]):[0-5]\d$/,           // 시간: 00:00~23:59
  DATE:     /^\d{4}-\d{2}-\d{2}$/,                 // 날짜: yyyy-MM-dd
  TYPE:     /^(입실|퇴실)$/,                        // 출퇴근 구분
  REASON:   /^[^<>"']{0,50}$/,                      // 사유: HTML 태그 금지 0~50자
  YEAR:     /^\d{4}$/,                              // 연도: 4자리 숫자
  MONTH:    /^(1[0-2]|[1-9])$/,                    // 월: 1~12
};

// HTML/스크립트 인젝션 패턴
const INJECT_PATTERN = /<[^>]*>|javascript:|onerror|onload|<script|on\w+\s*=/i;

// 비밀번호처럼 어디에도 출력되지 않고 해시로만 저장되는 값에 사용합니다.
// 인젝션 패턴 검사를 적용하면 'Secure<2026>!' 같은 정상 비밀번호가
// 거부되므로(그리고 로그인 단계에서는 원인조차 알 수 없으므로) 제외합니다.
const SECRET_FIELD = { skipInjectionCheck: true };

/**
 * 단일 필드 유효성 검사
 * @param {string} value   검사할 값
 * @param {RegExp} pattern 허용 패턴
 * @param {string} label   오류 메시지용 필드명
 * @param {{skipInjectionCheck?: boolean}} [opts] 비밀번호 등 비출력 필드용 옵션
 * @returns {{ ok: boolean, msg: string }}
 */
function validate(value, pattern, label, opts) {
  if (value === null || value === undefined || value.toString().trim() === '') {
    return { ok: false, msg: `${label} 값이 비어있습니다.` };
  }
  const str = value.toString().trim();
  if (!(opts && opts.skipInjectionCheck) && INJECT_PATTERN.test(str)) {
    return { ok: false, msg: `${label}에 허용되지 않는 문자가 포함되어 있습니다.` };
  }
  if (!pattern.test(str)) {
    return { ok: false, msg: `${label} 형식이 올바르지 않습니다.` };
  }
  return { ok: true, msg: '' };
}

/**
 * 여러 필드 한꺼번에 검사 — 첫 번째 실패 항목 반환
 * @param {Array<[value, pattern, label, opts?]>} checks
 * @returns {{ ok: boolean, msg: string }}
 */
function validateAll(checks) {
  for (const [value, pattern, label, opts] of checks) {
    const result = validate(value, pattern, label, opts);
    if (!result.ok) return result;
  }
  return { ok: true, msg: '' };
}

// 사용자 행 찾기 (역할 무관)
function findUserRowIndex(userDisplayData, id) {
  for (let i = 1; i < userDisplayData.length; i++) {
    if (cellAt(userDisplayData[i], COL.ID) === id) return i;
  }
  return -1;
}

// 초기 설정을 강제해야 하는 계정인지 판정합니다.
// - MUST_SETUP 플래그: 신규 등록·비밀번호 초기화 직후 (무작위 초기 비밀번호 상태)
// - 레거시 고정 초기 비밀번호(0000/1234)를 아직 쓰고 있는 계정
// - 학생인데 기준시간이 비어있는 계정
function needsInitialSetup(rowDisp, role, inTime, outTime, usingLegacyInitialPw) {
  if (cellAt(rowDisp, COL.MUST_SETUP).toUpperCase() === 'TRUE') return true;
  if (usingLegacyInitialPw) return true;
  return role === '학생' && (!inTime || !outTime);
}

// ─────────────────────────────────────────────────────────────────────
// 로그인 검증
//
// 브루트포스 방어(5회 실패 → 5분 잠금)와, 레거시 비밀번호(평문 또는 솔트 없는
// SHA-256)의 솔트 방식 자동 승급을 함께 처리합니다.
//
// 비용이 큰 반복 해싱은 잠금을 잡기 전에 미리 계산합니다. 아침 등교 시간처럼
// 여러 학생이 동시에 로그인할 때 전역 잠금 보유 시간을 짧게 유지하기 위함입니다.
// 잠금 안에서 솔트가 바뀐 것이 확인되면(비밀번호 변경/초기화와 경합) 그때만
// 다시 계산합니다.
// ─────────────────────────────────────────────────────────────────────
function checkLogin(userSheet, sessionSheet, id, pw) {
  const genericError = '아이디/비밀번호 오류, 또는 계정 잠금 상태입니다. (5회 오류 시 5분 잠금)';
  const stall = () => Utilities.sleep(Math.floor(Math.random() * 300) + 200);

  // ── 입력 유효성 검사 ──
  const v = validateAll([
    [id, PATTERN.ID, '학번/ID'],
    [pw, PATTERN.PW, '비밀번호', SECRET_FIELD],
  ]);
  if (!v.ok) {
    stall(); // 타이밍 공격 방지
    return { success: false, msg: genericError };
  }

  if (!ensurePasswordPepper()) return lockBusyResponse();

  const inputPw   = pw.toString().trim();
  const trimmedId = id.toString().trim();

  // 솔트별 해시 결과 캐시 — 같은 솔트를 두 번 계산하지 않습니다.
  // 프로토타입 없는 객체를 써야 솔트 값이 'constructor' 같은 문자열일 때
  // 상속된 속성을 캐시 적중으로 오인하지 않습니다.
  const hashCache = Object.create(null);
  const hashWithSalt = (salt) => {
    if (!(salt in hashCache)) hashCache[salt] = hashPassword(inputPw, salt);
    return hashCache[salt];
  };

  // ── 1단계: 잠금 없이 솔트를 읽어 해시를 미리 계산 ──
  const preDisplay = userSheet.getDataRange().getDisplayValues();
  const preRowIdx  = findUserRowIndex(preDisplay, trimmedId);
  if (preRowIdx < 0) {
    stall();
    return { success: false, msg: genericError };
  }
  const preSalt = cellAt(preDisplay[preRowIdx], COL.SALT);
  if (preSalt) hashWithSalt(preSalt);

  // ── 2단계: 잠금 안에서 재확인 후 판정 ──
  const locked = runWithScriptLock(() => {
    const userRange   = userSheet.getDataRange();
    const data        = userRange.getValues();
    const displayData = userRange.getDisplayValues();

    const rowIdx = findUserRowIndex(displayData, trimmedId);
    if (rowIdx < 0) return { success: false, msg: genericError };

    const rowDisp     = displayData[rowIdx];
    const rawRow      = data[rowIdx];
    let failCount     = parseInt(rawRow[COL.FAIL]) || 0;
    let lockTimestamp = parseInt(rawRow[COL.LOCK]) || 0;
    const nowMs       = new Date().getTime();

    if (nowMs < lockTimestamp) return { success: false, msg: genericError };

    const storedPw   = cellAt(rowDisp, COL.PW);
    const storedSalt = cellAt(rowDisp, COL.SALT);
    const { matched, needsUpgrade } =
      matchStoredPassword(storedPw, storedSalt, inputPw, hashWithSalt);

    if (!matched) {
      failCount++;
      if (failCount >= 5) lockTimestamp = nowMs + 300000;
      userSheet.getRange(rowIdx + 1, COL.FAIL + 1).setValue(failCount);
      userSheet.getRange(rowIdx + 1, COL.LOCK + 1).setValue(lockTimestamp);
      return { success: false, msg: genericError };
    }

    // 레거시 비밀번호로 로그인에 성공하면 즉시 솔트 방식으로 다시 저장합니다.
    if (needsUpgrade) writePasswordUnsafe(userSheet, rowIdx, inputPw);

    if (failCount > 0 || lockTimestamp > 0) {
      userSheet.getRange(rowIdx + 1, COL.FAIL + 1).setValue(0);
      userSheet.getRange(rowIdx + 1, COL.LOCK + 1).setValue(0);
    }

    const role = rowDisp[COL.ROLE];
    // getDisplayValues()는 시간 표시 형식이 로케일에 따라 달라질 수 있으므로
    // 기준시간은 getValues()의 원본 값에서 정규화합니다.
    const inTime  = timeObjectToHHMM(rawRow[COL.IN_TIME]);
    const outTime = timeObjectToHHMM(rawRow[COL.OUT_TIME]);

    const needsSetup = needsInitialSetup(
      rowDisp, role, inTime, outTime, isInitialPw(role, inputPw));

    // 초기 설정이 필요하다는 사실을 시트에 남깁니다.
    // 남기지 않으면, 바로 위에서 레거시 비밀번호를 솔트 해시로 승급한 순간
    // "아직 초기 비밀번호를 쓰는 중"이라는 단서가 사라져 initialSetup 이
    // 그 계정을 이미 설정 완료로 오판하고 거부합니다(설정 화면에서 영구 정체).
    if (needsSetup && cellAt(rowDisp, COL.MUST_SETUP).toUpperCase() !== 'TRUE') {
      userSheet.getRange(rowIdx + 1, COL.MUST_SETUP + 1).setValue('TRUE');
    }

    const token = createSessionToken(sessionSheet, trimmedId, role);

    return {
      success: true,
      id:      trimmedId,
      name:    rowDisp[COL.NAME],
      role, needsSetup, inTime, outTime,
      token,
    };
  });

  if (!locked.acquired) return lockBusyResponse();

  // 의도적인 지연은 잠금을 해제한 뒤 적용해 다른 요청을 막지 않습니다.
  if (!locked.value.success) stall();
  return locked.value;
}

// ─────────────────────────────────────────────────────────────────────
// 최초 1회 초기 설정
// ─────────────────────────────────────────────────────────────────────
function initialSetup(userSheet, id, newPw, inTime, outTime) {
  // ── 입력 유효성 검사 ──
  const v = validateAll([
    [id,    PATTERN.ID, '학번/ID'],
    [newPw, PATTERN.PW, '새 비밀번호', SECRET_FIELD],
  ]);
  if (!v.ok) return { success: false, msg: v.msg };

  // 학생일 때 기준시간 검사 (역할 확인 전이므로 값이 있을 때만)
  if (inTime && !PATTERN.TIME.test(inTime.toString().trim())) {
    return { success: false, msg: '입실 기준시간 형식이 올바르지 않습니다. (HH:MM)' };
  }
  if (outTime && !PATTERN.TIME.test(outTime.toString().trim())) {
    return { success: false, msg: '퇴실 기준시간 형식이 올바르지 않습니다. (HH:MM)' };
  }

  const newPwStr = newPw.toString().trim();
  if (newPwStr === INITIAL_PW.STUDENT || newPwStr === INITIAL_PW.TEACHER) {
    return { success: false, msg: '초기 비밀번호는 새 비밀번호로 사용할 수 없습니다.' };
  }

  if (!ensurePasswordPepper()) return lockBusyResponse();

  const locked = runWithScriptLock(() => {
    const data   = userSheet.getDataRange().getDisplayValues();
    const rowIdx = findUserRowIndex(data, id.toString().trim());
    if (rowIdx < 0) return { success: false, msg: '요청을 처리할 수 없습니다.' };

    const rowDisp   = data[rowIdx];
    const role      = rowDisp[COL.ROLE];
    const storedPw  = cellAt(rowDisp, COL.PW);
    const storedIn  = cellAt(rowDisp, COL.IN_TIME);
    const storedOut = cellAt(rowDisp, COL.OUT_TIME);

    // 레거시 고정 초기 비밀번호(평문 또는 솔트 없는 해시)를 아직 쓰고 있는지.
    // 신규 방식 계정은 MUST_SETUP 플래그로 판정하므로 여기서 볼 필요가 없습니다.
    const usingLegacyInitialPw =
      isInitialPw(role, storedPw) ||
      (storedPw.length === 64 &&
       (storedPw === legacyHashPassword(INITIAL_PW.STUDENT) ||
        storedPw === legacyHashPassword(INITIAL_PW.TEACHER)));

    if (!needsInitialSetup(rowDisp, role, storedIn, storedOut, usingLegacyInitialPw)) {
      return { success: false, msg: '비정상적인 접근입니다. 이미 초기 설정이 완료된 계정입니다.' };
    }

    writePasswordUnsafe(userSheet, rowIdx, newPwStr);
    userSheet.getRange(rowIdx + 1, COL.MUST_SETUP + 1).setValue('FALSE');
    if (role === '학생') {
      userSheet.getRange(rowIdx + 1, COL.IN_TIME  + 1).setValue(timeObjectToHHMM(inTime));
      userSheet.getRange(rowIdx + 1, COL.OUT_TIME + 1).setValue(timeObjectToHHMM(outTime));
    }
    return { success: true, msg: '초기 설정이 완료되었습니다.' };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

// ─────────────────────────────────────────────────────────────────────
// 비밀번호 변경
// ─────────────────────────────────────────────────────────────────────
function changePw(userSheet, id, currentPw, newPw) {
  // ── 입력 유효성 검사 ──
  const v = validateAll([
    [id,        PATTERN.ID, '학번/ID'],
    [currentPw, PATTERN.PW, '현재 비밀번호', SECRET_FIELD],
    [newPw,     PATTERN.PW, '새 비밀번호',   SECRET_FIELD],
  ]);
  if (!v.ok) return { success: false, msg: v.msg };

  const currentPwStr = currentPw.toString().trim();
  const newPwStr     = newPw.toString().trim();
  if (newPwStr === INITIAL_PW.STUDENT || newPwStr === INITIAL_PW.TEACHER) {
    return { success: false, msg: '초기 비밀번호는 새 비밀번호로 사용할 수 없습니다.' };
  }
  if (currentPwStr === newPwStr) {
    return { success: false, msg: '새 비밀번호가 현재 비밀번호와 동일합니다.' };
  }

  if (!ensurePasswordPepper()) return lockBusyResponse();

  const locked = runWithScriptLock(() => {
    const data   = userSheet.getDataRange().getDisplayValues();
    const rowIdx = findUserRowIndex(data, id.toString().trim());
    if (rowIdx < 0) return { success: false, msg: '사용자를 찾을 수 없습니다.' };

    const storedPw   = cellAt(data[rowIdx], COL.PW);
    const storedSalt = cellAt(data[rowIdx], COL.SALT);
    // 레거시(평문·무염 해시) 계정에서도 현재 비밀번호를 검증할 수 있어야 합니다.
    const { matched } = matchStoredPassword(
      storedPw, storedSalt, currentPwStr, (salt) => hashPassword(currentPwStr, salt));
    if (!matched) {
      return { success: false, msg: '현재 비밀번호가 일치하지 않습니다.' };
    }

    writePasswordUnsafe(userSheet, rowIdx, newPwStr);
    userSheet.getRange(rowIdx + 1, COL.MUST_SETUP + 1).setValue('FALSE');
    return { success: true, msg: '비밀번호가 변경되었습니다.' };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

// 오늘 날짜 차단 여부 확인 (학생용)
function checkTodayBlockedAction(blockedSheet) {
  const now     = nowKST();
  const dateStr = Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd');
  const result  = isDateBlocked(blockedSheet, dateStr);
  return { success: true, blocked: result.blocked, reason: result.reason || '', date: dateStr };
}

// ─────────────────────────────────────────────────────────────────────
// 출퇴근 상태 조회
// ─────────────────────────────────────────────────────────────────────
function getStudentStatus(attendSheet, id) {
  const v = validate(id, PATTERN.ID, '학번/ID');
  if (!v.ok) return { success: false, msg: v.msg };

  const now     = nowKST();
  const dateStr = Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd');

  let inDone  = false;
  let outDone = false;

  const data = attendSheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][ACOL.ID].trim()   === id.toString().trim() &&
        data[i][ACOL.DATE].trim() === dateStr) {
      if (data[i][ACOL.TYPE] === '입실') inDone  = true;
      if (data[i][ACOL.TYPE] === '퇴실') outDone = true;
    }
  }
  return { success: true, inDone, outDone };
}

// ─────────────────────────────────────────────────────────────────────
// 출퇴근 기록
// ✅ 이름·역할·기준시간은 클라이언트 입력을 신뢰하지 않습니다.
//    세션 토큰으로 검증된 id를 기준으로 서버가 Users 시트에서 직접
//    조회하고, 입퇴실 순서와 퇴실 가능 시간도 서버에서 검증합니다.
// ─────────────────────────────────────────────────────────────────────
function recordAttendance(userSheet, attendSheet, blockedSheet, id, type) {
  // ── 입력 유효성 검사 ──
  const v = validateAll([
    [id,   PATTERN.ID,   '학번/ID'],
    [type, PATTERN.TYPE, '구분(입실/퇴실)'],
  ]);
  if (!v.ok) return { success: false, msg: v.msg };

  // 중복 요청이 동시에 들어와도 "조회 → 검증 → 추가"가 한 번만 실행되도록 잠급니다.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return lockBusyResponse();

  try {
    const now         = nowKST();
    const todayStr    = Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd');
    const dayIndex    = now.getDay();
    const dayNames    = ['일', '월', '화', '수', '목', '금', '토'];
    const currentMins = now.getHours() * 60 + now.getMinutes();

    // ── OJT 운영 기간 및 날짜·요일 규칙 확인 ──
    const currentMonth = now.getMonth() + 1;
    if (!isOjtMonth(currentMonth)) {
      return { success: false, msg: `1월과 2월은 OJT(현장실습) 운영 기간이 아닙니다. (OJT 운영 기간: 3월 1일 ~ 12월 31일)` };
    }
    const blockResult = isDateBlocked(blockedSheet, todayStr);
    if (blockResult.blocked) {
      return { success: false, msg: `오늘(${todayStr})은 출석 기록이 차단된 날입니다. 사유: ${blockResult.reason}` };
    }
    if (!isFieldDay(dayIndex)) {
      return { success: false, msg: `오늘은 현장실습일(${FIELD_DAYS.map(d => dayNames[d]).join(',')})이 아닙니다.` };
    }

    // ── 서버 사이드 사용자 조회 ──
    const userRange       = userSheet.getDataRange();
    const userValues      = userRange.getValues();
    const userDisplayData = userRange.getDisplayValues();
    let student = null;

    for (let i = 1; i < userDisplayData.length; i++) {
      if (userDisplayData[i][COL.ID].toString().trim() !== id.toString().trim()) continue;
      if (userDisplayData[i][COL.ROLE].toString().trim() === '학생') {
        student = {
          name:    userDisplayData[i][COL.NAME].toString().trim(),
          inTime:  timeObjectToHHMM(userValues[i][COL.IN_TIME]),
          outTime: timeObjectToHHMM(userValues[i][COL.OUT_TIME]),
        };
      }
      break;
    }
    if (!student || !student.name) {
      return { success: false, msg: '유효하지 않은 사용자 정보이거나 등록되지 않은 학생입니다.' };
    }

    const inStdMins  = hhmmToMinutes(student.inTime);
    const outStdMins = hhmmToMinutes(student.outTime);
    if (inStdMins === null || outStdMins === null) {
      return { success: false, msg: '등록된 입퇴실 기준시간이 올바르지 않습니다. 관리자에게 문의해주세요.' };
    }
    if (outStdMins <= inStdMins) {
      return { success: false, msg: '퇴실 기준시간은 입실 기준시간보다 늦어야 합니다. 관리자에게 문의해주세요.' };
    }

    // ── 오늘 기록 조회 및 순서/중복 확인 ──
    const attendData = attendSheet.getDataRange().getDisplayValues();
    let inDone  = false;
    let outDone = false;
    for (let i = 1; i < attendData.length; i++) {
      if (attendData[i][ACOL.ID].trim() !== id.toString().trim() ||
          attendData[i][ACOL.DATE].trim() !== todayStr) continue;
      if (attendData[i][ACOL.TYPE] === '입실') inDone = true;
      if (attendData[i][ACOL.TYPE] === '퇴실') outDone = true;
    }

    if ((type === '입실' && inDone) || (type === '퇴실' && outDone)) {
      return { success: false, msg: `이미 오늘 ${type} 기록이 완료되었습니다.` };
    }
    if (type === '퇴실' && !inDone) {
      return { success: false, msg: '오늘 입실 기록을 먼저 완료해야 퇴실할 수 있습니다.' };
    }

    if (type === '퇴실') {
      const unlockMins = inStdMins + OUT_UNLOCK_AFTER_MINUTES;
      if (currentMins < unlockMins) {
        return {
          success: false,
          msg: `퇴실은 입실 기준시간(${student.inTime})으로부터 2시간 후인 ${minutesToHHMM(unlockMins)}부터 가능합니다.`,
        };
      }
    }

    // ── 서버 기준시간으로 지각/조퇴 판정 및 기록 ──
    const stdTime = type === '입실' ? student.inTime : student.outTime;
    const stdMins = type === '입실' ? inStdMins : outStdMins;

    let status = '정상';
    if (type === '입실' && currentMins > (stdMins + LATE_GRACE_MINUTES)) status = '지각';
    if (type === '퇴실' && currentMins < stdMins)        status = '조퇴';

    const timeStamp = Utilities.formatDate(now, 'GMT+9', 'HH:mm:ss');
    attendSheet.appendRow([timeStamp, todayStr, dayNames[dayIndex], id, student.name, type, stdTime, status]);

    return { success: true, msg: `${type} 기록 완료 [${status}]` };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────
// 월간 레포트 집계 대상 실습일 생성
// ─────────────────────────────────────────────────────────────────────
function getScheduledReportDates(year, month, blockedSheet, nowDate) {
  // 1월, 2월은 OJT 비운영 기간이므로 집계 대상 실습일 없음 (0일)
  if (!isOjtMonth(month)) {
    return [];
  }

  const blockedDates = getBlockedDates(blockedSheet).dates || [];
  const manualBlockedSet = new Set(
    blockedDates.filter(item => item.blocked).map(item => item.date)
  );

  const now         = nowDate || new Date();
  const todayStr    = Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd');
  const currentMins = hhmmToMinutes(Utilities.formatDate(now, 'GMT+9', 'HH:mm'));
  const lastDay     = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates       = [];

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    if (!FIELD_DAYS.includes(dayIndex)) continue;
    if (dateStr > todayStr) continue; // 미래 날짜는 결석으로 계산하지 않음
    if (dateStr === todayStr && currentMins < REPORT_DAY_CLOSE_MINUTES) continue;
    if (FIXED_HOLIDAYS[dateStr.substring(5)]) continue;
    if (manualBlockedSet.has(dateStr)) continue;

    dates.push(dateStr);
  }

  return dates;
}

// 월간 레포트 입력 검증 및 집계
// ─────────────────────────────────────────────────────────────────────
function generateMonthlyReport(userSheet, attendSheet, blockedSheet, year, month, nowDate) {
  // ── 입력 유효성 검사 ──
  const v = validateAll([
    [year,  PATTERN.YEAR,  '연도'],
    [month, PATTERN.MONTH, '월'],
  ]);
  if (!v.ok) return { success: false, msg: v.msg };

  const y = parseInt(year,  10);
  const m = parseInt(month, 10);

  // 연도 논리 범위 검사 (2020~2099)
  if (y < 2020 || y > 2099) {
    return { success: false, msg: '연도는 2020~2099 사이여야 합니다.' };
  }

  // 1월, 2월 OJT 비운영월 검사
  if (!isOjtMonth(m)) {
    return { success: false, msg: '1월과 2월은 OJT(현장실습) 운영 기간이 아닙니다. (OJT 운영 기간: 3월~12월)' };
  }

  const prefix = `${y}-${String(m).padStart(2, '0')}`;

  const userData    = userSheet.getDataRange().getDisplayValues();
  const studentList = [];
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][COL.ROLE] === '학생') {
      studentList.push({ id: userData[i][COL.ID].trim(), name: userData[i][COL.NAME].trim() });
    }
  }

  const attendData = attendSheet.getDataRange().getDisplayValues();
  const monthData  = attendData.filter((r, idx) =>
    idx > 0 && r[ACOL.DATE] && r[ACOL.DATE].toString().startsWith(prefix)
  );

  // 기록 유무와 관계없이 월의 실제 실습일을 생성합니다.
  const dates            = getScheduledReportDates(y, m, blockedSheet, nowDate);
  const scheduledDateSet = new Set(dates);

  const summary = {};
  studentList.forEach(s => {
    summary[s.id] = { name: s.name, normal: 0, late: 0, early: 0, absent: 0, records: {} };
  });

  monthData.forEach(r => {
    const sid    = r[ACOL.ID].toString().trim();
    const date   = r[ACOL.DATE].toString().trim();
    const type   = r[ACOL.TYPE];
    const status = r[ACOL.STATUS];
    const time   = timeObjectToHHMM(r[ACOL.TIME]);
    if (!summary[sid]) return;
    if (!scheduledDateSet.has(date)) return; // 비실습일·차단일·미래 기록 제외

    if (!summary[sid].records[date]) summary[sid].records[date] = {};
    summary[sid].records[date][type] = { time, status };

    if (type === '입실') {
      if (status === '지각')      summary[sid].late++;
      else if (status === '정상') summary[sid].normal++;
    }
    if (type === '퇴실' && status === '조퇴') summary[sid].early++;
  });

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  dates.forEach(d => {
    studentList.forEach(s => {
      if (!summary[s.id].records[d] || !summary[s.id].records[d]['입실']) {
        summary[s.id].absent++;
      }
    });
  });

  const html     = buildReportHtml(y, m, dates, studentList, summary, dayNames);
  const fileName = `도제반_출석레포트_${prefix}.pdf`;

  return { success: true, html, fileName, scheduledDays: dates.length };
}

// ─────────────────────────────────────────────────────────────────────
// 관리자(교사) 권한 검증
// ─────────────────────────────────────────────────────────────────────
function verifyAdminRole(userSheet, id) {
  if (!id) return false;
  const data = userSheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID].trim() === id.toString().trim() &&
        data[i][COL.ROLE].trim() === '교사') {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// 특정 날짜의 출결 기록만 읽어옵니다.
//
// 먼저 날짜 열(1개)만 스캔해 대상 행 범위를 찾고, 그 구간만 전체 열로 읽습니다.
// 기록은 append 순서라 같은 날짜가 연속으로 모여 있으므로, 시트가 몇 년치로
// 커져도 실제로 읽는 양은 하루치에 머뭅니다.
// ─────────────────────────────────────────────────────────────────────
function readAttendanceByDate(attendSheet, dateStr) {
  const lastRow = attendSheet.getLastRow();
  if (lastRow < 2) return [];

  const dateColumn = attendSheet
    .getRange(2, ACOL.DATE + 1, lastRow - 1, 1)
    .getDisplayValues();

  let first = -1;
  let last  = -1;
  for (let i = 0; i < dateColumn.length; i++) {
    if (dateColumn[i][0].toString().trim() !== dateStr) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return [];

  // 중간에 다른 날짜가 섞여 있어도 안전하도록 읽은 뒤 한 번 더 거릅니다.
  return attendSheet
    .getRange(first + 2, 1, last - first + 1, 8)
    .getDisplayValues()
    .filter(row => row[ACOL.DATE].toString().trim() === dateStr);
}

// ─────────────────────────────────────────────────────────────────────
// 교사 대시보드 데이터
//
// 출결 기록은 요청한 날짜 하루치만 반환합니다. 대시보드가 30초마다 폴링하므로
// 전체 이력을 실어 보내면 시트가 커질수록 응답이 무거워지고 GAS 할당량을
// 빠르게 소진합니다.
// ─────────────────────────────────────────────────────────────────────
function getAdminData(userSheet, attendSheet, blockedSheet, dateStr) {
  const requested = dateStr === null || dateStr === undefined ? '' : dateStr.toString().trim();
  const targetDate = PATTERN.DATE.test(requested)
    ? requested
    : Utilities.formatDate(nowKST(), 'GMT+9', 'yyyy-MM-dd');

  const attendanceRecords = readAttendanceByDate(attendSheet, targetDate);

  const userRange   = userSheet.getDataRange();
  const userValues  = userRange.getValues();
  const userData    = userRange.getDisplayValues();
  const studentList = [];
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][COL.ROLE] === '학생') {
      studentList.push({
        id:      userData[i][COL.ID].trim(),
        name:    userData[i][COL.NAME].trim(),
        inTime:  timeObjectToHHMM(userValues[i][COL.IN_TIME]),
        outTime: timeObjectToHHMM(userValues[i][COL.OUT_TIME]),
      });
    }
  }
  studentList.sort((a, b) => a.id.localeCompare(b.id, 'ko', { numeric: true }));

  // 차단 날짜 목록도 함께 반환
  const blockedList = getBlockedDates(blockedSheet).dates || [];

  return {
    date:         targetDate,
    attendance:   attendanceRecords,
    students:     studentList,
    blockedDates: blockedList,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 학생 계정 관리 (교사 전용 API에서만 호출)
// ─────────────────────────────────────────────────────────────────────
function validateStudentProfile(id, name, inTime, outTime) {
  const student = {
    id:      id === null || id === undefined ? '' : id.toString().trim(),
    name:    name === null || name === undefined ? '' : name.toString().trim(),
    inTime:  timeObjectToHHMM(inTime),
    outTime: timeObjectToHHMM(outTime),
  };

  const v = validateAll([
    [student.id,      PATTERN.ID,   '학번'],
    [student.name,    PATTERN.NAME, '이름'],
    [student.inTime,  PATTERN.TIME, '입실 기준시간'],
    [student.outTime, PATTERN.TIME, '퇴실 기준시간'],
  ]);
  if (!v.ok) return { ok: false, msg: v.msg };

  const inMins  = hhmmToMinutes(student.inTime);
  const outMins = hhmmToMinutes(student.outTime);
  if (inMins === null || outMins === null || outMins <= inMins) {
    return { ok: false, msg: '퇴실 기준시간은 입실 기준시간보다 늦어야 합니다.' };
  }

  return { ok: true, student };
}

function findStudentRowIndex(userData, studentId) {
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][COL.ID].toString().trim() === studentId &&
        userData[i][COL.ROLE].toString().trim() === '학생') {
      return i;
    }
  }
  return -1;
}

// 호출자가 ScriptLock을 보유한 상태에서 사용합니다.
function deleteSessionsForUserUnsafe(sessionSheet, userId) {
  if (!sessionSheet) return;
  const data = sessionSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][SCOL.ID].toString().trim() === userId) {
      sessionSheet.deleteRow(i + 1);
    }
  }
}

function addStudent(userSheet, id, name, inTime, outTime) {
  const validation = validateStudentProfile(id, name, inTime, outTime);
  if (!validation.ok) return { success: false, msg: validation.msg };
  const student = validation.student;

  if (!ensurePasswordPepper()) return lockBusyResponse();

  const locked = runWithScriptLock(() => {
    const data = userSheet.getDataRange().getDisplayValues();
    if (findUserRowIndex(data, student.id) >= 0) {
      return { success: false, msg: '이미 사용 중인 학번/ID입니다.' };
    }

    // 계정마다 다른 무작위 초기 비밀번호를 발급합니다.
    // 고정 초기 비밀번호(0000)는 학번만 알면 대리 출석이 가능해집니다.
    const initialPw = generateInitialPassword();
    const salt      = generateSalt();

    userSheet.appendRow([
      student.id,
      student.name,
      '학생',
      hashPassword(initialPw, salt),
      student.inTime,
      student.outTime,
      0,
      0,
      salt,
      'TRUE', // 최초 로그인 시 초기 설정 강제
    ]);
    return {
      success: true,
      initialPw,
      msg: `${student.name} 학생을 등록했습니다. 초기 비밀번호는 이 화면에서만 확인할 수 있습니다.`,
    };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

function updateStudent(userSheet, sessionSheet, id, name, inTime, outTime) {
  const validation = validateStudentProfile(id, name, inTime, outTime);
  if (!validation.ok) return { success: false, msg: validation.msg };
  const student = validation.student;

  const locked = runWithScriptLock(() => {
    const data = userSheet.getDataRange().getDisplayValues();
    const rowIdx = findStudentRowIndex(data, student.id);
    if (rowIdx < 0) return { success: false, msg: '학생을 찾을 수 없습니다.' };

    userSheet.getRange(rowIdx + 1, COL.NAME + 1).setValue(student.name);
    userSheet.getRange(rowIdx + 1, COL.IN_TIME + 1).setValue(student.inTime);
    userSheet.getRange(rowIdx + 1, COL.OUT_TIME + 1).setValue(student.outTime);
    deleteSessionsForUserUnsafe(sessionSheet, student.id);
    return { success: true, msg: `${student.name} 학생 정보를 수정했습니다.` };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

function deleteStudent(userSheet, sessionSheet, id) {
  const v = validate(id, PATTERN.ID, '학번');
  if (!v.ok) return { success: false, msg: v.msg };
  const studentId = id.toString().trim();

  const locked = runWithScriptLock(() => {
    const data = userSheet.getDataRange().getDisplayValues();
    const rowIdx = findStudentRowIndex(data, studentId);
    if (rowIdx < 0) return { success: false, msg: '학생을 찾을 수 없습니다.' };

    const studentName = data[rowIdx][COL.NAME].toString().trim();
    userSheet.deleteRow(rowIdx + 1);
    deleteSessionsForUserUnsafe(sessionSheet, studentId);
    return {
      success: true,
      msg: `${studentName} 학생 계정을 삭제했습니다. 기존 출결 기록은 보존됩니다.`,
    };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

function resetStudentPassword(userSheet, sessionSheet, id) {
  const v = validate(id, PATTERN.ID, '학번');
  if (!v.ok) return { success: false, msg: v.msg };
  const studentId = id.toString().trim();

  if (!ensurePasswordPepper()) return lockBusyResponse();

  const locked = runWithScriptLock(() => {
    const data = userSheet.getDataRange().getDisplayValues();
    const rowIdx = findStudentRowIndex(data, studentId);
    if (rowIdx < 0) return { success: false, msg: '학생을 찾을 수 없습니다.' };

    const initialPw = generateInitialPassword();
    writePasswordUnsafe(userSheet, rowIdx, initialPw);
    userSheet.getRange(rowIdx + 1, COL.FAIL + 1).setValue(0);
    userSheet.getRange(rowIdx + 1, COL.LOCK + 1).setValue(0);
    userSheet.getRange(rowIdx + 1, COL.MUST_SETUP + 1).setValue('TRUE');
    deleteSessionsForUserUnsafe(sessionSheet, studentId);

    return {
      success: true,
      initialPw,
      msg: `${data[rowIdx][COL.NAME]} 학생의 비밀번호를 초기화했습니다. 새 비밀번호는 이 화면에서만 확인할 수 있습니다.`,
    };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

// ─────────────────────────────────────────────────────────────────────
// [일괄 마이그레이션 유틸] 평문 비밀번호 → 솔트 해시 일괄 변환
//
// ※ GAS 편집기에서 이 함수를 직접 선택 후 수동 실행 (▶ 버튼)
// ※ 솔트 없는 기존 SHA-256 해시는 원문을 알 수 없어 변환할 수 없습니다.
//    해당 계정은 다음 로그인 성공 시 자동으로 솔트 방식으로 승급됩니다.
// ─────────────────────────────────────────────────────────────────────
function migratePasswordsToHash() {
  const sheets = getSheets();
  ensurePasswordPepper();

  const locked = runWithScriptLock(() => {
    const data    = sheets.users.getDataRange().getDisplayValues();
    let converted = 0;
    let pending   = 0;
    let skipped   = 0;

    for (let i = 1; i < data.length; i++) {
      const stored = cellAt(data[i], COL.PW);
      if (!stored) { skipped++; continue; }

      if (cellAt(data[i], COL.SALT)) {
        Logger.log(`[SKIP] 행 ${i + 1} (${data[i][COL.ID]}): 이미 솔트 적용됨`);
        skipped++;
        continue;
      }

      // 솔트 없는 해시 → 원문을 모르므로 지금은 변환 불가 (로그인 시 자동 승급)
      if (stored.length === 64 && /^[0-9a-f]+$/.test(stored)) {
        Logger.log(`[대기] 행 ${i + 1} (${data[i][COL.ID]}): 다음 로그인 시 자동 승급`);
        pending++;
        continue;
      }

      writePasswordUnsafe(sheets.users, i, stored);
      // 평문 비밀번호는 로그에 남기지 않습니다.
      Logger.log(`[OK]   행 ${i + 1} (${data[i][COL.ID]}): 솔트 해시 변환 완료`);
      converted++;
    }

    return { converted, pending, skipped };
  });

  if (!locked.acquired) {
    SpreadsheetApp.getUi().alert(LOCK_BUSY_MSG);
    return;
  }

  const { converted, pending, skipped } = locked.value;
  const summary = `변환: ${converted}건\n로그인 시 자동 승급 대기: ${pending}건\n스킵: ${skipped}건`;
  Logger.log(`\n✅ 마이그레이션 완료\n${summary}`);
  SpreadsheetApp.getUi().alert(`마이그레이션 완료\n${summary}`);
}

// ═════════════════════════════════════════════════════════════════════
// 날짜 차단 기능
// ═════════════════════════════════════════════════════════════════════

// 특정 날짜가 차단됐는지 확인 (OJT 기간 및 공휴일 포함)
function isDateBlocked(blockedSheet, dateStr) {
  if (!dateStr) return { blocked: false };

  // 1. OJT 운영 기간 체크 (1월, 2월은 OJT 없음)
  const month = parseInt(dateStr.substring(5, 7), 10);
  if (!isOjtMonth(month)) {
    return { blocked: true, reason: 'OJT 비운영 기간 (1~2월은 OJT 없음)' };
  }

  // 2. 공휴일 체크
  const mmdd = dateStr.substring(5); // yyyy-MM-dd → MM-DD
  if (FIXED_HOLIDAYS[mmdd]) {
    return { blocked: true, reason: FIXED_HOLIDAYS[mmdd] + ' (공휴일)' };
  }

  if (!blockedSheet) return { blocked: false };

  // 3. BlockedDates 시트에서 수동 차단 확인
  const data = blockedSheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate    = data[i][BCOL.DATE].toString().trim();
    const rowBlocked = data[i][BCOL.BLOCKED].toString().trim();
    const rowReason  = data[i][BCOL.REASON].toString().trim();
    if (rowDate === dateStr && rowBlocked === 'TRUE') {
      return { blocked: true, reason: rowReason || '교사 설정' };
    }
  }
  return { blocked: false };
}

// 날짜 차단 설정/해제 (교사 전용)
function setBlockedDate(blockedSheet, dateStr, reason, blocked) {
  // ── 입력 유효성 검사 ──
  const v = validate(dateStr, PATTERN.DATE, '날짜');
  if (!v.ok) return { success: false, msg: v.msg };

  const [y, m, d] = dateStr.split('-').map(Number);
  const testDate  = new Date(y, m - 1, d);
  if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
    return { success: false, msg: '존재하지 않는 날짜입니다.' };
  }
  if (reason && reason.toString().trim().length > 0 && !PATTERN.REASON.test(reason.toString().trim())) {
    return { success: false, msg: '사유에 허용되지 않는 문자가 포함되어 있습니다.' };
  }

  const locked = runWithScriptLock(() => {
    const data = blockedSheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][BCOL.DATE].toString().trim() === dateStr) {
        blockedSheet.getRange(i + 1, BCOL.REASON  + 1).setValue(reason  || '');
        blockedSheet.getRange(i + 1, BCOL.BLOCKED + 1).setValue(blocked ? 'TRUE' : 'FALSE');
        return { success: true, msg: blocked ? `${dateStr} 차단 완료` : `${dateStr} 차단 해제` };
      }
    }
    blockedSheet.appendRow([dateStr, reason || '', blocked ? 'TRUE' : 'FALSE']);
    return { success: true, msg: blocked ? `${dateStr} 차단 완료` : `${dateStr} 차단 해제` };
  });

  return locked.acquired ? locked.value : lockBusyResponse();
}

// 차단 날짜 목록 조회
function getBlockedDates(blockedSheet) {
  if (!blockedSheet) return { success: true, dates: [] };
  const data  = blockedSheet.getDataRange().getDisplayValues();
  const dates = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][BCOL.DATE]) continue;
    dates.push({
      date:    data[i][BCOL.DATE].toString().trim(),
      reason:  data[i][BCOL.REASON].toString().trim(),
      blocked: data[i][BCOL.BLOCKED].toString().trim() === 'TRUE',
    });
  }
  return { success: true, dates };
}

// HTML 이스케이프.
// 학번·이름은 등록 API에서 패턴 검증을 거치지만, 시트에 직접 입력한 행은
// 그 검증을 통과하지 않습니다. 레포트는 브라우저에서 렌더되므로 출력 시점에
// 한 번 더 막습니다.
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// 레포트 HTML 빌더
function buildReportHtml(year, month, dates, students, summary, dayNames) {
  const title = `${year}년 ${month}월 도제반 출석 현황 레포트`;

  // dates는 이미 비실습일·공휴일·차단일·미완료 날짜가 제외된 목록입니다.
  const fieldDates = dates.slice();

  let dateCols = fieldDates.map(d => {
    const dayIdx = new Date(d.replace(/-/g, '/')).getDay();
    const label  = d.substring(5).replace('-', '/') + `(${dayNames[dayIdx]})`;
    return `<th style="min-width:70px;font-size:11px">${label}</th>`;
  }).join('');

  let rows = students.map(s => {
    const rec  = summary[s.id];
    let cells  = fieldDates.map(d => {
      const dayRec = rec.records[d] || {};
      const inRec  = dayRec['입실'];
      const outRec = dayRec['퇴실'];
      let cell = '';
      if (inRec) {
        const inColor  = inRec.status  === '지각' ? '#e53e3e' : '#2f855a';
        cell += `<div style="color:${inColor};font-weight:700;font-size:11px">▲ ${escapeHtml(inRec.time)}</div>`;
      } else {
        cell += `<div style="color:#999;font-size:11px">▲ 미기록</div>`;
      }
      if (outRec) {
        const outColor = outRec.status === '조퇴' ? '#dd6b20' : '#2b6cb0';
        cell += `<div style="color:${outColor};font-weight:700;font-size:11px">▼ ${escapeHtml(outRec.time)}</div>`;
      } else {
        cell += `<div style="color:#999;font-size:11px">▼ 미기록</div>`;
      }
      return `<td style="text-align:center;padding:6px 4px;border:1px solid #e2e8f0">${cell}</td>`;
    }).join('');

    return `<tr>
      <td style="padding:8px;border:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(s.id)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;white-space:nowrap;font-weight:700">${escapeHtml(s.name)}</td>
      <td style="padding:8px;text-align:center;border:1px solid #e2e8f0;color:#2f855a;font-weight:700">${rec.normal}</td>
      <td style="padding:8px;text-align:center;border:1px solid #e2e8f0;color:#e53e3e;font-weight:700">${rec.late}</td>
      <td style="padding:8px;text-align:center;border:1px solid #e2e8f0;color:#dd6b20;font-weight:700">${rec.early}</td>
      <td style="padding:8px;text-align:center;border:1px solid #e2e8f0;color:#718096;font-weight:700">${rec.absent}</td>
      ${cells}
    </tr>`;
  }).join('');

  // 브라우저 인쇄("PDF로 저장")의 기본 파일명이 <title>에서 나옵니다.
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>도제반_출석레포트_${year}-${String(month).padStart(2, '0')}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; font-size: 12px; color: #1a202c; padding: 20px; }
  h1   { font-size: 18px; text-align: center; margin-bottom: 6px; }
  .sub { text-align: center; color: #718096; font-size: 12px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #2d3748; color: white; padding: 8px 6px; font-size: 12px; }
  tr:nth-child(even) { background: #f7fafc; }
  .legend { margin-top: 16px; font-size: 11px; color: #718096; }
</style>
</head><body>
<h1>🎓 ${title}</h1>
<div class="sub">성일정보고등학교 도제반 3-12 &nbsp;|&nbsp; 현장실습일: 화·수·목 &nbsp;|&nbsp; 집계 대상: ${fieldDates.length}일</div>
<table>
  <thead>
    <tr>
      <th>학번</th><th>이름</th>
      <th style="color:#68d391">정상</th>
      <th style="color:#fc8181">지각</th>
      <th style="color:#f6ad55">조퇴</th>
      <th style="color:#a0aec0">결석</th>
      ${dateCols}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="legend">
  ▲ 입실 &nbsp;|&nbsp; ▼ 퇴실 &nbsp;|&nbsp;
  <span style="color:#e53e3e">빨강=지각</span> &nbsp;
  <span style="color:#dd6b20">주황=조퇴</span> &nbsp;
  <span style="color:#2f855a">초록=정상</span>
  &nbsp;|&nbsp; 생성일시: ${Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm')}
</div>
</body></html>`;
}

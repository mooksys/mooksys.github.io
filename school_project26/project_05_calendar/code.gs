/**
 * 성일정보고등학교 월별 탭 및 디데이 통합 인식 백엔드 (Code.gs)
 *
 * 배포 전 Apps Script 프로젝트 설정 > 스크립트 속성에 ADMIN_PASSWORD를 등록하세요.
 * 비밀번호는 소스 코드나 브라우저에 저장하지 않습니다.
 */

const SESSION_TTL_SECONDS = 30 * 60;
const MAX_NOTICE_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const ALLOWED_EVENT_TYPES = ['학사일정', 'off-JT', 'OJT', '특별수업', '국가공휴일', '휴업일'];
const MONTHLY_SHEET_PATTERN = /^(\d{4})\.(0?[1-9]|1[0-2])$/;
const HIDE_TRIGGER_HANDLER = 'hideOldMonthlySheets';
const ROW_HIDE_TRIGGER_HANDLER = 'hidePastDatedRows';
const DATED_ROW_SHEETS = ['디데이', '공지사항'];

/**
 * 스프레드시트 열릴 때 상단 커스텀 메뉴 추가
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('📅 캘린더 관리')
      .addItem('📢 공지사항 시트 자동 생성 및 동기화', 'createNoticeSheetNow')
      .addSeparator()
      .addSubMenu(ui.createMenu('🗂️ 지난 월 시트 정리')
        .addItem('지금 숨기기', 'hideOldMonthlySheetsWithReport')
        .addItem('모두 다시 표시', 'showAllMonthlySheets')
        .addSeparator()
        .addItem('⏰ 매월 1일 자동 숨김 켜기', 'installMonthlySheetHideTrigger')
        .addItem('⏹️ 자동 숨김 끄기', 'removeMonthlySheetHideTrigger'))
      .addSubMenu(ui.createMenu('📋 지난 디데이·공지 행 정리')
        .addItem('지금 숨기기', 'hidePastDatedRowsWithReport')
        .addItem('모두 다시 표시', 'showAllDatedRows')
        .addSeparator()
        .addItem('⏰ 매일 자동 숨김 켜기', 'installDatedRowHideTrigger')
        .addItem('⏹️ 자동 숨김 끄기', 'removeDatedRowHideTrigger'))
      .addToUi();
  } catch (e) {
    // UI 컨텍스트가 아닐 경우 무시
  }
}

/**
 * 시트명이 월별 시트(`YYYY.M` / `YYYY.MM`)인지 판별하고 연·월을 반환한다.
 * @return {{year: number, month: number, index: number}|null} index는 비교용 통산 월수(연*12+월).
 */
function parseMonthlySheetName_(name) {
  const match = MONTHLY_SHEET_PATTERN.exec(String(name || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  // '2026.9'와 '2026.10'은 문자열로 비교하면 순서가 뒤집히므로 반드시 숫자로 환산해 비교한다.
  return { year: year, month: month, index: year * 12 + month };
}

/** 스프레드시트 표준시 기준 이번 달의 통산 월수 */
function currentMonthIndex_(ss) {
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM').split('-');
  return Number(stamp[0]) * 12 + Number(stamp[1]);
}

/**
 * 이번 달보다 이전인 월별 시트를 모두 숨긴다. (매월 1일 트리거 및 메뉴에서 호출)
 *
 * 숨김은 스프레드시트 편집 화면의 탭 정리 용도이며, 웹 캘린더 동작에는 영향이 없다.
 * ss.getSheets()는 숨긴 시트도 반환하므로 지난달 일정 조회·수정은 그대로 동작한다.
 * '설정' / '디데이' / '공지사항' 등 월별 시트가 아닌 시트는 건드리지 않는다.
 *
 * @return {{hidden: string[], skipped: string[], alreadyHidden: number}}
 */
function hideOldMonthlySheets() {
  const ss = getSpreadsheet_();
  const limit = currentMonthIndex_(ss);
  const sheets = ss.getSheets();
  const result = { hidden: [], skipped: [], alreadyHidden: 0 };

  // 스프레드시트는 보이는 시트가 0개가 될 수 없다. 남은 개수를 세어 가며 처리한다.
  let visibleCount = sheets.filter(function(sheet) { return !sheet.isSheetHidden(); }).length;

  sheets.forEach(function(sheet) {
    const parsed = parseMonthlySheetName_(sheet.getName());
    if (!parsed || parsed.index >= limit) return;

    if (sheet.isSheetHidden()) {
      result.alreadyHidden++;
      return;
    }
    if (visibleCount <= 1) {
      result.skipped.push(sheet.getName());
      return;
    }

    try {
      // 활성 시트는 숨길 수 없으므로 다른 보이는 시트로 먼저 옮긴다.
      if (ss.getActiveSheet().getSheetId() === sheet.getSheetId()) {
        const alternative = ss.getSheets().filter(function(other) {
          return other.getSheetId() !== sheet.getSheetId() && !other.isSheetHidden();
        })[0];
        if (alternative) alternative.activate();
      }
      sheet.hideSheet();
      visibleCount--;
      result.hidden.push(sheet.getName());
    } catch (e) {
      result.skipped.push(sheet.getName());
    }
  });

  return result;
}

/** [메뉴용] 지난 월 시트를 숨기고 결과를 알림으로 보여준다. */
function hideOldMonthlySheetsWithReport() {
  const result = hideOldMonthlySheets();
  const lines = [];
  lines.push('숨긴 시트: ' + (result.hidden.length ? result.hidden.join(', ') : '없음'));
  if (result.alreadyHidden > 0) lines.push('이미 숨겨져 있던 시트: ' + result.alreadyHidden + '개');
  if (result.skipped.length) lines.push('처리하지 못한 시트: ' + result.skipped.join(', '));
  lines.push('');
  lines.push('※ 숨김은 시트 탭 정리용입니다. 웹 캘린더에서는 지난달 일정이 그대로 보입니다.');
  showMessage_('지난 월 시트 숨기기 완료', lines.join('\n'));
}

/** [메뉴용] 숨겨둔 월별 시트를 모두 다시 표시한다. */
function showAllMonthlySheets() {
  const ss = getSpreadsheet_();
  const restored = [];

  ss.getSheets().forEach(function(sheet) {
    if (!parseMonthlySheetName_(sheet.getName())) return;
    if (!sheet.isSheetHidden()) return;
    sheet.showSheet();
    restored.push(sheet.getName());
  });

  showMessage_('월 시트 표시 완료', restored.length
    ? '다시 표시한 시트: ' + restored.join(', ')
    : '숨겨진 월별 시트가 없습니다.');
  return restored;
}

/** [메뉴용] 매월 1일 자동 숨김 트리거를 설치한다. (중복 설치 방지) */
function installMonthlySheetHideTrigger() {
  removeTriggersByHandler_(HIDE_TRIGGER_HANDLER);
  ScriptApp.newTrigger(HIDE_TRIGGER_HANDLER)
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();
  showMessage_('자동 숨김 켜짐', '매월 1일 새벽 1시경, 지난 월 시트가 자동으로 숨겨집니다.\n\n※ 웹 캘린더 표시에는 영향이 없습니다.');
}

/** [메뉴용] 매월 1일 자동 숨김 트리거를 해제한다. */
function removeMonthlySheetHideTrigger() {
  const removed = removeTriggersByHandler_(HIDE_TRIGGER_HANDLER);
  showMessage_('자동 숨김 꺼짐', removed > 0
    ? '자동 숨김 트리거를 해제했습니다.'
    : '설치된 자동 숨김 트리거가 없습니다.');
}

function removeTriggersByHandler_(handlerName) {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/**
 * '디데이' / '공지사항' 시트에서 날짜가 오늘보다 이전인 행을 숨긴다. (매일 트리거 및 메뉴에서 호출)
 *
 * 행 숨김도 시트 탭 숨김과 마찬가지로 편집 화면 정리 용도이며, 웹 캘린더 동작에는 영향이 없다.
 * getRange().getValues()는 숨긴 행도 그대로 읽고, 행 번호도 밀리지 않으므로
 * 기존의 행 단위 수정/삭제(findNoticeRow_, findMilestoneRow_)는 영향을 받지 않는다.
 *
 * @return {Object} 시트명별 처리 결과
 */
function hidePastDatedRows() {
  const ss = getSpreadsheet_();
  const todayIso = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const summary = {};
  DATED_ROW_SHEETS.forEach(function(name) {
    summary[name] = hidePastRowsInSheet_(ss, name, todayIso);
  });
  return summary;
}

function hidePastRowsInSheet_(ss, sheetName, todayIso) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { missing: true, hidden: 0, kept: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { missing: false, hidden: 0, kept: 0 };

  const timezone = ss.getSpreadsheetTimeZone();
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const targetRows = [];
  let kept = 0;

  values.forEach(function(row, index) {
    const title = String(row[1] || '').trim();
    const iso = storedDateToIso_(row[0], timezone);
    // 날짜가 없는 항목(상시 공지)과 해석할 수 없는 값은 숨기지 않는다. 내용이 빈 행도 그대로 둔다.
    if (!title || !iso) { kept++; return; }
    // ISO(yyyy-MM-dd) 형식은 문자열 비교만으로 날짜 순서가 보장된다.
    if (iso < todayIso) targetRows.push(index + 2);
    else kept++;
  });

  // 연속된 행을 한 구간으로 묶어 hideRows 호출 횟수를 최소화한다.
  let hidden = 0;
  let i = 0;
  while (i < targetRows.length) {
    let j = i;
    while (j + 1 < targetRows.length && targetRows[j + 1] === targetRows[j] + 1) j++;
    const count = targetRows[j] - targetRows[i] + 1;
    sheet.hideRows(targetRows[i], count);
    hidden += count;
    i = j + 1;
  }

  return { missing: false, hidden: hidden, kept: kept };
}

/** [메뉴용] 지난 날짜 행을 숨기고 결과를 알림으로 보여준다. */
function hidePastDatedRowsWithReport() {
  const summary = hidePastDatedRows();
  const lines = [];
  DATED_ROW_SHEETS.forEach(function(name) {
    const info = summary[name];
    if (!info || info.missing) {
      lines.push('· ' + name + ' 시트: 없음');
      return;
    }
    lines.push('· ' + name + ' 시트: ' + info.hidden + '개 행 숨김 / ' + info.kept + '개 행 유지');
  });
  lines.push('');
  lines.push('※ 날짜가 없는 상시 공지는 숨기지 않습니다.');
  lines.push('※ 행 숨김은 시트 정리용이며, 웹 캘린더 표시·수정에는 영향이 없습니다.');
  showMessage_('지난 디데이·공지 행 숨기기 완료', lines.join('\n'));
}

/** [메뉴용] 숨겨둔 디데이·공지 행을 모두 다시 표시한다. */
function showAllDatedRows() {
  const ss = getSpreadsheet_();
  const restored = [];

  DATED_ROW_SHEETS.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) return;
    sheet.showRows(2, sheet.getLastRow() - 1);
    restored.push(name);
  });

  showMessage_('행 표시 완료', restored.length
    ? restored.join(', ') + ' 시트의 모든 행을 다시 표시했습니다.'
    : '대상 시트가 없습니다.');
  return restored;
}

/** [메뉴용] 매일 자동 행 숨김 트리거를 설치한다. (중복 설치 방지) */
function installDatedRowHideTrigger() {
  removeTriggersByHandler_(ROW_HIDE_TRIGGER_HANDLER);
  ScriptApp.newTrigger(ROW_HIDE_TRIGGER_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
  showMessage_('자동 숨김 켜짐', '매일 새벽 1시경, 날짜가 지난 디데이·공지 행이 자동으로 숨겨집니다.\n\n※ 웹 캘린더 표시에는 영향이 없습니다.');
}

/** [메뉴용] 매일 자동 행 숨김 트리거를 해제한다. */
function removeDatedRowHideTrigger() {
  const removed = removeTriggersByHandler_(ROW_HIDE_TRIGGER_HANDLER);
  showMessage_('자동 숨김 꺼짐', removed > 0
    ? '자동 행 숨김 트리거를 해제했습니다.'
    : '설치된 자동 행 숨김 트리거가 없습니다.');
}

function showMessage_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // 트리거 등 UI가 없는 실행 환경에서는 로그로 남긴다.
    console.log(title + ' :: ' + message);
  }
}

/**
 * [수동 실행용] 공지사항 시트 즉시 생성 및 데이터 마이그레이션 함수
 * Apps Script 편집기에서 이 함수를 선택하고 [실행]을 누르거나,
 * 스프레드시트 상단 메뉴 [📅 캘린더 관리 > 📢 공지사항 시트 자동 생성 및 동기화]를 누르면
 * 스프레드시트에 '공지사항' 시트가 즉시 생성되고 기존 12건의 공지사항이 A열(날짜), B열(내용)로 자동 채워집니다.
 */
function createNoticeSheetNow() {
  const ss = getSpreadsheet_();
  const noticeSheet = getOrCreateNoticeSheet_(ss);
  const configSheet = ss.getSheetByName('설정');
  const rawNotice = configSheet ? String(configSheet.getRange('B1').getValue() || '').trim() : '';
  const parsedItems = parseNoticeItemsFromRaw_(rawNotice);
  
  if (parsedItems.length > 0) {
    if (noticeSheet.getLastRow() > 1) {
      noticeSheet.deleteRows(2, noticeSheet.getLastRow() - 1);
    }
    const rows = parsedItems.map(function(p) {
      return [p.date, p.title, Utilities.getUuid()];
    });
    noticeSheet.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  }
  return '공지사항 시트 생성 및 ' + parsedItems.length + '건 동기화 완료!';
}

function doGet() {
  try {
    const ss = getSpreadsheet_();
    const result = { data: {}, types: [], notice: '', milestones: [] };
    const typeSet = {};

    const noticeData = readNotices_(ss, false);
    result.notices = noticeData.items;
    result.notice = noticeData.rawText;

    result.milestones = readMilestones_(ss);
    result.goals = readGoalHours_(ss);
    result.terms = readTermDates_(ss);

    // 숨김 처리된 월별 시트도 getSheets()에 포함되므로, 지난달 일정도 그대로 조회된다.
    ss.getSheets().forEach((sheet) => {
      const parsed = parseMonthlySheetName_(sheet.getName());
      if (!parsed) return;

      const sheetKey = parsed.year + '.' + parsed.month;
      const events = readMonthlyEvents_(sheet, typeSet, result.types);
      result.data[sheetKey] = (result.data[sheetKey] || []).concat(events);
    });

    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_({ error: safeErrorMessage_(error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('요청 본문이 없습니다.');
    }

    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || '');

    if (action === 'verify') {
      return jsonOutput_(Object.assign({ success: true }, createAdminSession_(payload.password)));
    }

    if (action === 'logout') {
      assertAdminSession_(payload.token);
      CacheService.getScriptCache().remove(sessionCacheKey_(payload.token));
      return jsonOutput_({ success: true });
    }

    assertAdminSession_(payload.token);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = getSpreadsheet_();
      let result;

      switch (action) {
        case 'update_notice':
          result = updateNotice_(ss, payload);
          break;
        case 'add_notice':
          result = addNoticeItem_(ss, payload);
          break;
        case 'update_notice_item':
          result = updateNoticeItem_(ss, payload);
          break;
        case 'delete_notice':
          result = deleteNoticeItem_(ss, payload);
          break;
        case 'add_event':
          result = addEvent_(ss, payload);
          break;
        case 'update_event':
          result = updateEvent_(ss, payload);
          break;
        case 'delete_event':
          result = deleteEvent_(ss, payload);
          break;
        case 'add_dday':
          result = addMilestone_(ss, payload);
          break;
        case 'update_dday':
          result = updateMilestone_(ss, payload);
          break;
        case 'delete_dday':
          result = deleteMilestone_(ss, payload);
          break;
        default:
          throw new Error('지원하지 않는 요청입니다.');
      }

      return jsonOutput_(Object.assign({ success: true }, result || {}));
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonOutput_({ success: false, message: safeErrorMessage_(error) });
  }
}

function getSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('연결된 스프레드시트를 찾을 수 없습니다.');
  return ss;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeErrorMessage_(error) {
  return error && error.message ? error.message : '처리 중 오류가 발생했습니다.';
}

function createAdminSession_(password) {
  const configuredPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!configuredPassword) {
    throw new Error('서버에 관리자 비밀번호가 설정되어 있지 않습니다.');
  }
  if (typeof password !== 'string' || password !== configuredPassword) {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(sessionCacheKey_(token), '1', SESSION_TTL_SECONDS);
  return { token: token, expiresIn: SESSION_TTL_SECONDS };
}

function assertAdminSession_(token) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('관리자 세션이 없습니다. 다시 로그인하세요.');
  }
  if (CacheService.getScriptCache().get(sessionCacheKey_(token)) !== '1') {
    throw new Error('관리자 세션이 만료되었습니다. 다시 로그인하세요.');
  }
}

function sessionCacheKey_(token) {
  return 'calendar-admin-session:' + token;
}

function readMonthlyEvents_(sheet, typeSet, types) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= 1 || lastColumn < 3) return [];

  const range = sheet.getRange(1, 1, lastRow, lastColumn);
  const values = range.getDisplayValues();
  const notes = range.getNotes();
  const headers = values[0];
  const events = [];
  const sheetId = sheet.getSheetId();

  for (let col = 2; col < headers.length; col++) {
    const headerName = String(headers[col] || '').trim();
    if (headerName && !typeSet[headerName]) {
      typeSet[headerName] = true;
      types.push(headerName);
    }
  }

  for (let row = 1; row < values.length; row++) {
    const day = Number.parseInt(String(values[row][0] || '').trim(), 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    for (let col = 2; col < headers.length; col++) {
      const type = String(headers[col] || '').trim();
      const cellValue = String(values[row][col] || '').trim();
      if (!type || !cellValue) continue;

      const cellEvents = readCellEvents_(cellValue, notes[row][col], sheetId, row + 1, col + 1);
      cellEvents.forEach((event) => {
        events.push({ id: event.id, day: day, type: type, title: event.title });
      });
    }
  }

  return events;
}

function readCellEvents_(cellValue, note, sheetId, row, column) {
  const titles = String(cellValue || '')
    .split(/\r?\n/)
    .map((title) => title.trim())
    .filter((title) => title !== '');
  const metadata = parseEventMetadata_(note);

  return titles.map((title, index) => {
    const saved = metadata[index];
    const id = saved && saved.title === title && isEventId_(saved.id)
      ? saved.id
      : legacyEventId_(sheetId, row, column, index);
    return { id: id, title: title };
  });
}

function parseEventMetadata_(note) {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    return parsed && Array.isArray(parsed.items) ? parsed.items : [];
  } catch (error) {
    return [];
  }
}

function isEventId_(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 100;
}

function legacyEventId_(sheetId, row, column, index) {
  return ['legacy', sheetId, row, column, index].join(':');
}

function writeCellEvents_(cell, events) {
  if (events.length === 0) {
    cell.clearContent();
    cell.clearNote();
    return;
  }

  cell.setValue(events.map((event) => event.title).join('\n'));
  cell.setNote(JSON.stringify({
    version: 1,
    items: events.map((event) => ({ id: event.id, title: event.title }))
  }));
}

function readMilestones_(ss) {
  const sheet = ss.getSheetByName('디데이');
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const width = Math.max(3, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const timezone = ss.getSpreadsheetTimeZone();

  return values.reduce((milestones, row, index) => {
    const date = storedDateToIso_(row[0], timezone);
    const title = String(row[1] || '').trim();
    if (!date || !title) return milestones;

    const id = isEventId_(row[2])
      ? row[2]
      : legacyMilestoneId_(sheet.getSheetId(), index + 2);
    milestones.push({ id: id, date: date, title: title });
    return milestones;
  }, []);
}

function legacyMilestoneId_(sheetId, row) {
  return ['legacy-dday', sheetId, row].join(':');
}

function storedDateToIso_(value, timezone) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }

  const text = String(value || '').trim();
  if (isIsoDate_(text)) return text;

  const koreanDate = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(text);
  if (!koreanDate) return '';
  const year = Number(koreanDate[1]);
  const month = Number(koreanDate[2]);
  const day = Number(koreanDate[3]);
  return isValidDateParts_(year, month, day)
    ? [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
    : '';
}

/**
 * 공지사항을 읽어 { items, rawText }를 반환한다.
 * @param {boolean} lockHeld 호출자가 이미 스크립트 락을 보유 중인지 여부.
 *   doPost 경로는 true(락 안에서 바로 기록), doGet 경로는 false(tryLock으로 경합 회피).
 */
/**
 * '설정' 시트에서 학년도(연간) 목표 이수시간을 읽는다.
 *
 * A열에 항목명, B열에 시간을 적어 두면 인식한다. (행 위치는 자유)
 *   A2: off-JT 목표시간   B2: 200
 *   A3: OJT 목표시간      B3: 500
 *   A4: 방과후 목표시간    B4: 60
 *
 * 등록하지 않으면 빈 객체를 반환하며, 대시보드는 진행률 막대 없이 누적 수치만 표시한다.
 * @return {{offjt?: number, ojt?: number, afterschool?: number}}
 */
function readGoalHours_(ss) {
  const sheet = ss.getSheetByName('설정');
  if (!sheet) return {};

  const lastRow = Math.min(sheet.getLastRow(), 20);
  if (lastRow < 1) return {};

  const values = sheet.getRange(1, 1, lastRow, 2).getValues();
  const goals = {};

  values.forEach(function(row) {
    const label = String(row[0] || '').replace(/[-\s]/g, '').toUpperCase();
    if (!label || label.indexOf('목표') === -1) return;

    const hours = Number(row[1]);
    if (!isFinite(hours) || hours <= 0) return;

    // 'OFFJT'가 'OJT'보다 먼저 판정되어야 한다. (OFFJT 안에는 OJT가 들어 있지 않지만 순서를 명시해 둔다)
    if (label.indexOf('OFFJT') !== -1) goals.offjt = hours;
    else if (label.indexOf('OJT') !== -1) goals.ojt = hours;
    else if (label.indexOf('방과후') !== -1) goals.afterschool = hours;
  });

  return goals;
}

/**
 * '설정' 시트에서 학기 시작·종료일을 읽는다.
 *
 * 학기 경계는 학교마다 다르고 월 단위로 떨어지지도 않는다(예: 8/13 방학, 8/14 개학).
 * 그래서 코드에 규칙을 박지 않고 학사일정을 직접 적도록 한다. (행 위치는 자유)
 *   A: 1학기 시작   B: 2026-03-02
 *   A: 1학기 종료   B: 2026-08-13
 *   A: 2학기 시작   B: 2026-08-14
 *   A: 2학기 종료   B: 2027-02-13
 *
 * 시작/종료가 모두 있고 순서가 올바른 학기만 반환한다.
 * 비어 있으면 프론트엔드가 월 단위 기본 구분(3~8월 / 9~2월)으로 대체한다.
 * @return {{term1?: {start: string, end: string}, term2?: {start: string, end: string}}}
 */
function readTermDates_(ss) {
  const sheet = ss.getSheetByName('설정');
  if (!sheet) return {};

  const lastRow = Math.min(sheet.getLastRow(), 20);
  if (lastRow < 1) return {};

  const timezone = ss.getSpreadsheetTimeZone();
  const values = sheet.getRange(1, 1, lastRow, 2).getValues();
  const terms = {};

  values.forEach(function(row) {
    const label = String(row[0] || '').replace(/\s/g, '');
    if (!label) return;

    const termKey = label.indexOf('1학기') !== -1 ? 'term1'
      : (label.indexOf('2학기') !== -1 ? 'term2' : '');
    if (!termKey) return;

    const boundary = label.indexOf('시작') !== -1 ? 'start'
      : ((label.indexOf('종료') !== -1 || label.indexOf('끝') !== -1) ? 'end' : '');
    if (!boundary) return;

    const iso = storedDateToIso_(row[1], timezone);
    if (!iso) return;

    if (!terms[termKey]) terms[termKey] = {};
    terms[termKey][boundary] = iso;
  });

  // 한쪽만 적혀 있거나 시작이 종료보다 늦은 경우는 신뢰할 수 없으므로 버린다.
  Object.keys(terms).forEach(function(key) {
    const term = terms[key];
    if (!term.start || !term.end || term.start > term.end) delete terms[key];
  });

  return terms;
}

function readNotices_(ss, lockHeld) {
  let sheet = ss.getSheetByName('공지사항');
  const timezone = ss.getSpreadsheetTimeZone();

  // 1. 공지사항 시트가 이미 존재하고 데이터가 있는 경우
  if (sheet && sheet.getLastRow() > 1) {
    const width = Math.max(3, sheet.getLastColumn());
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    const backfill = [];
    const items = values.reduce((acc, row, idx) => {
      const date = row[0] ? storedDateToIso_(row[0], timezone) : '';
      const title = String(row[1] || '').trim();
      if (!title) return acc;
      let id = row[2];
      if (!isEventId_(id)) {
        // 식별자가 없는 기존 행에 UUID를 1회 발급하고 시트에 기록한다.
        // 기록하지 않으면 조회할 때마다 ID가 바뀌어 행 단위 수정/삭제가 실패한다.
        id = Utilities.getUuid();
        backfill.push({ row: idx + 2, id: id });
      }
      acc.push({ id: id, date: date, title: title });
      return acc;
    }, []);

    if (backfill.length > 0) {
      backfillNoticeIds_(sheet, backfill, lockHeld);
    }

    const rawText = items.map(function(it) {
      if (it.date) {
        const parts = it.date.split('-');
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (!it.title.includes(m + '/' + d) && !it.title.includes(it.date)) {
          return '▶' + it.title + '(' + m + '/' + d + ')';
        }
      }
      return '▶' + it.title;
    }).join(' ');

    return { items: items, rawText: rawText };
  }

  // 2. 공지사항 시트가 없거나 빈 경우: 기존 '설정' 시트 B1에서 읽어와 자동으로 '공지사항' 시트 생성 및 채우기
  const configSheet = ss.getSheetByName('설정');
  const rawNotice = configSheet ? String(configSheet.getRange('B1').getValue() || '').trim() : '';
  const parsedItems = parseNoticeItemsFromRaw_(rawNotice);

  try {
    const noticeSheet = getOrCreateNoticeSheet_(ss);
    if (parsedItems.length > 0 && noticeSheet.getLastRow() <= 1) {
      const rows = parsedItems.map(function(p) {
        return [p.date, p.title, Utilities.getUuid()];
      });
      noticeSheet.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
    }
  } catch (e) {
    // 예외 발생 시 안전 무시 (조회 보장)
  }

  return { items: parsedItems, rawText: rawNotice };
}

/**
 * __id가 비어 있던 행에 UUID를 기록한다.
 * 락을 보유하지 않은 조회(doGet) 경로에서는 tryLock(0)으로 즉시 시도하고,
 * 획득하지 못하면 기록을 건너뛴다(다른 요청이 곧 기록하므로 다음 조회에서 안정화된다).
 * 대기하지 않으므로 교착이나 조회 지연이 발생하지 않는다.
 */
function backfillNoticeIds_(sheet, backfill, lockHeld) {
  const write = function() {
    backfill.forEach(function(entry) {
      sheet.getRange(entry.row, 3).setNumberFormat('@').setValue(entry.id);
    });
    SpreadsheetApp.flush();
  };

  try {
    if (lockHeld) {
      write();
      return;
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) return;
    try {
      write();
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    // 읽기 전용 권한 등으로 기록에 실패해도 조회 자체는 계속 보장한다.
  }
}

function parseNoticeItemsFromRaw_(rawText) {
  if (!rawText) return [];
  let parts = [];
  if (/[▶▷►•]/.test(rawText)) {
    parts = rawText.split(/[▶▷►•]/).map(function(s) { return s.trim(); }).filter(Boolean);
  } else {
    parts = rawText.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
  }

  var today = new Date();
  var currentMonth = today.getMonth();

  return parts.map(function(p, idx) {
    var clean = p.replace(/^[▶▷►•\s]+/, '').trim();
    var regex = /(?:(\d{4})[-/.년]\s*)?(\d{1,2})[-/.월]\s*(\d{1,2})일?/g;
    var dates = [];
    var m;
    while ((m = regex.exec(clean)) !== null) {
      var y = m[1] ? parseInt(m[1], 10) : today.getFullYear();
      var month = parseInt(m[2], 10) - 1;
      var day = parseInt(m[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        if (!m[1] && currentMonth >= 8 && month <= 1) {
          y = today.getFullYear() + 1;
        }
        dates.push([y, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-'));
      }
    }
    var date = dates.length > 0 ? dates[dates.length - 1] : '';

    var title = clean;
    var parenDateMatch = clean.match(/^(.+?)\s*\(\d{1,2}\/\d{1,2}\)$/);
    if (parenDateMatch) {
      title = parenDateMatch[1].trim();
    }

    return {
      id: Utilities ? Utilities.getUuid() : 'notice-item-' + (idx + 1),
      date: date,
      title: title
    };
  });
}

function syncNoticeSheetToConfig_(ss, items) {
  let sheet = ss.getSheetByName('설정');
  if (!sheet) {
    sheet = ss.insertSheet('설정');
    sheet.getRange('A1').setValue('Notice');
  }
  const rawText = items.map(function(it) {
    if (it.date) {
      const parts = it.date.split('-');
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!it.title.includes(m + '/' + d) && !it.title.includes(it.date)) {
        return '▶' + it.title + '(' + m + '/' + d + ')';
      }
    }
    return '▶' + it.title;
  }).join(' ');

  sheet.getRange('B1').setValue(rawText);
  return rawText;
}

function getOrCreateNoticeSheet_(ss) {
  let sheet = ss.getSheetByName('공지사항');
  if (!sheet) {
    sheet = ss.insertSheet('공지사항');
    sheet.getRange(1, 1, 1, 3).setValues([['공지 날짜', '공지 내용', '__id']]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 450);
  } else {
    const idHeader = String(sheet.getRange(1, 3).getValue() || '').trim();
    if (!idHeader) sheet.getRange(1, 3).setValue('__id');
  }
  sheet.hideColumns(3);
  return sheet;
}

// '공지사항' 시트에서 __id(C열)가 일치하는 행 번호를 찾는다. 없으면 0.
function findNoticeRow_(sheet, id) {
  const width = Math.max(3, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][2] || '') === id) return i + 2;
  }
  return 0;
}

function addNoticeItem_(ss, payload) {
  const date = payload.date ? parseIsoDate_(payload.date).iso : '';
  const title = requireText_(payload.title, '공지 내용', MAX_TITLE_LENGTH, false);
  const sheet = getOrCreateNoticeSheet_(ss);
  const id = Utilities.getUuid();
  const row = Math.max(1, sheet.getLastRow()) + 1;
  sheet.getRange(row, 1, 1, 3).setNumberFormat('@').setValues([[date, title, id]]);

  const noticeData = readNotices_(ss, true);
  syncNoticeSheetToConfig_(ss, noticeData.items);

  return { item: { id: id, date: date, title: title }, notice: noticeData.rawText, notices: noticeData.items };
}

function updateNoticeItem_(ss, payload) {
  const id = requireText_(payload.id, '공지 식별자', 100, false);
  const date = payload.date ? parseIsoDate_(payload.date).iso : '';
  const title = requireText_(payload.title, '공지 내용', MAX_TITLE_LENGTH, false);
  const sheet = ss.getSheetByName('공지사항');
  if (!sheet || sheet.getLastRow() <= 1) throw new Error('수정할 공지사항 시트가 없습니다.');

  const targetRow = findNoticeRow_(sheet, id);
  if (!targetRow) throw new Error('해당 공지사항을 찾을 수 없습니다.');
  sheet.getRange(targetRow, 1, 1, 3).setNumberFormat('@').setValues([[date, title, id]]);

  const noticeData = readNotices_(ss, true);
  syncNoticeSheetToConfig_(ss, noticeData.items);

  return { item: { id: id, date: date, title: title }, notice: noticeData.rawText, notices: noticeData.items };
}

function deleteNoticeItem_(ss, payload) {
  const id = requireText_(payload.id, '공지 식별자', 100, false);
  const sheet = ss.getSheetByName('공지사항');
  if (!sheet || sheet.getLastRow() <= 1) throw new Error('삭제할 공지사항이 없습니다.');

  const targetRow = findNoticeRow_(sheet, id);
  if (!targetRow) throw new Error('삭제할 공지사항을 찾을 수 없습니다.');
  sheet.deleteRow(targetRow);

  const noticeData = readNotices_(ss, true);
  syncNoticeSheetToConfig_(ss, noticeData.items);

  return { deleted: true, notice: noticeData.rawText, notices: noticeData.items };
}

function updateNotice_(ss, payload) {
  if (typeof payload.newNotice !== 'string') throw new Error('공지 내용을(를) 입력하세요.');
  // 마지막 1건을 삭제하면 빈 문자열이 전달된다. 이 경우는 '전체 비우기'로 허용한다.
  const isClearRequest = payload.newNotice.replace(/\r\n?/g, '\n').trim() === '';
  const notice = isClearRequest
    ? ''
    : requireText_(payload.newNotice, '공지 내용', MAX_NOTICE_LENGTH, true);
  let sheet = ss.getSheetByName('설정');
  if (!sheet) {
    sheet = ss.insertSheet('설정');
    sheet.getRange('A1').setValue('Notice');
  }
  sheet.getRange('B1').setValue(notice);

  // Re-sync 공지사항 sheet
  const parsed = parseNoticeItemsFromRaw_(notice);
  const noticeSheet = getOrCreateNoticeSheet_(ss);
  if (noticeSheet.getLastRow() > 1) {
    noticeSheet.deleteRows(2, noticeSheet.getLastRow() - 1);
  }
  if (parsed.length > 0) {
    const rows = parsed.map(function(p) {
      return [p.date, p.title, Utilities.getUuid()];
    });
    noticeSheet.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  }

  return { notice: notice, notices: parsed };
}

function addEvent_(ss, payload) {
  const date = parseIsoDate_(payload.date);
  const type = requireEventType_(payload.type, ss);
  const title = requireText_(payload.title, '일정 명칭', MAX_TITLE_LENGTH, false);
  const hours = (type === 'off-JT' || type === 'OJT')
    ? requireInteger_(payload.hours, '이수 시간', 1, 24)
    : null;
  const finalTitle = hours === null ? title : title + ' (' + hours + ')';
  const sheet = getOrCreateMonthlySheet_(ss, date.year, date.month);
  const targetColumn = findOrCreateEventColumn_(sheet, type);
  const targetRow = findOrCreateDayRow_(sheet, date.day);
  const cell = sheet.getRange(targetRow, targetColumn);
  const events = readCellEvents_(cell.getDisplayValue(), cell.getNote(), sheet.getSheetId(), targetRow, targetColumn);
  const event = { id: Utilities.getUuid(), title: finalTitle };
  events.push(event);
  writeCellEvents_(cell, events);

  return { event: { id: event.id, date: payload.date, type: type, title: event.title } };
}

function deleteEvent_(ss, payload) {
  const date = parseIsoDate_(payload.date);
  const type = requireText_(payload.type, '일정 분류', 60, false);
  const eventId = requireText_(payload.eventId, '일정 식별자', 100, false);
  const title = requireText_(payload.title, '일정 명칭', MAX_TITLE_LENGTH + 10, false);
  const sheet = ss.getSheetByName(date.year + '.' + date.month);
  if (!sheet) throw new Error('해당 월의 시트를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');

  const targetColumn = findEventColumn_(sheet, type);
  const targetRow = findDayRow_(sheet, date.day);
  if (!targetColumn || !targetRow) throw new Error('일정이 이미 변경되었거나 삭제되었습니다.');

  const cell = sheet.getRange(targetRow, targetColumn);
  const events = readCellEvents_(cell.getDisplayValue(), cell.getNote(), sheet.getSheetId(), targetRow, targetColumn);
  const targetIndex = events.findIndex((event) => event.id === eventId && event.title === title);
  if (targetIndex === -1) throw new Error('일정 정보가 변경되었습니다. 새로고침 후 다시 시도하세요.');

  events.splice(targetIndex, 1);
  writeCellEvents_(cell, events);
  return { deleted: true };
}

function updateEvent_(ss, payload) {
  const oldDate = parseIsoDate_(payload.oldDate || payload.date);
  const oldType = requireText_(payload.oldType || payload.type, '기존 일정 분류', 60, false);
  const oldTitle = requireText_(payload.oldTitle || payload.title, '기존 일정 명칭', MAX_TITLE_LENGTH + 10, false);
  const eventId = requireText_(payload.eventId, '일정 식별자', 100, false);

  const newDate = parseIsoDate_(payload.newDate || payload.date);
  const newType = requireEventType_(payload.newType || payload.type, ss);
  const newTitle = requireText_(payload.newTitle || payload.title, '새 일정 명칭', MAX_TITLE_LENGTH, false);
  const hours = (newType === 'off-JT' || newType === 'OJT')
    ? requireInteger_(payload.hours, '이수 시간', 1, 24)
    : null;
  const finalNewTitle = hours === null ? newTitle : newTitle + ' (' + hours + ')';

  // 1. 기존 셀에서 일정 삭제
  const oldSheet = ss.getSheetByName(oldDate.year + '.' + oldDate.month);
  if (!oldSheet) throw new Error('기존 일정 시트를 찾을 수 없습니다.');
  const oldColumn = findEventColumn_(oldSheet, oldType);
  const oldRow = findDayRow_(oldSheet, oldDate.day);
  if (!oldColumn || !oldRow) throw new Error('기존 일정이 이미 변경되었거나 삭제되었습니다.');

  const oldCell = oldSheet.getRange(oldRow, oldColumn);
  const oldEvents = readCellEvents_(oldCell.getDisplayValue(), oldCell.getNote(), oldSheet.getSheetId(), oldRow, oldColumn);
  // 동명 일정이 여러 건인 셀에서 엉뚱한 항목이 수정되지 않도록 좁은 조건부터 단계적으로 탐색한다.
  // 1) ID와 제목 동시 일치(삭제와 동일 기준) 2) ID 일치 3) 제목 단독 일치(ID 미보유 레거시 행)
  let targetIndex = oldEvents.findIndex((event) => event.id === eventId && event.title === oldTitle);
  if (targetIndex === -1) {
    targetIndex = oldEvents.findIndex((event) => event.id === eventId);
  }
  if (targetIndex === -1) {
    targetIndex = oldEvents.findIndex((event) => event.title === oldTitle);
  }
  if (targetIndex === -1) throw new Error('일정 정보가 변경되었습니다. 새로고침 후 다시 시도하세요.');

  oldEvents.splice(targetIndex, 1);
  writeCellEvents_(oldCell, oldEvents);

  // 2. 새 셀에 일정 등록
  const newSheet = getOrCreateMonthlySheet_(ss, newDate.year, newDate.month);
  const newColumn = findOrCreateEventColumn_(newSheet, newType);
  const newRow = findOrCreateDayRow_(newSheet, newDate.day);
  const newCell = newSheet.getRange(newRow, newColumn);
  const newEvents = readCellEvents_(newCell.getDisplayValue(), newCell.getNote(), newSheet.getSheetId(), newRow, newColumn);
  const updatedEvent = { id: eventId, title: finalNewTitle };
  newEvents.push(updatedEvent);
  writeCellEvents_(newCell, newEvents);

  return { event: { id: eventId, date: newDate.iso, type: newType, title: finalNewTitle } };
}

function getOrCreateMonthlySheet_(ss, year, month) {
  const name = year + '.' + month;
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 5).setValues([['일', '요일', '학사일정', 'off-JT', 'OJT']]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 5).setValues([['일', '요일', '학사일정', 'off-JT', 'OJT']]);
  }
  return sheet;
}

function findOrCreateEventColumn_(sheet, type) {
  const existing = findEventColumn_(sheet, type);
  if (existing) return existing;

  const nextColumn = Math.max(2, sheet.getLastColumn()) + 1;
  sheet.getRange(1, nextColumn).setValue(type);
  return nextColumn;
}

function findEventColumn_(sheet, type) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 3) return 0;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  for (let column = 2; column < headers.length; column++) {
    if (String(headers[column] || '').trim() === type) return column + 1;
  }
  return 0;
}

function findOrCreateDayRow_(sheet, day) {
  const existing = findDayRow_(sheet, day);
  if (existing) return existing;

  const row = Math.max(1, sheet.getLastRow()) + 1;
  sheet.getRange(row, 1, 1, 2).setValues([[day, '']]);
  return row;
}

function findDayRow_(sheet, day) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const days = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < days.length; index++) {
    if (Number.parseInt(String(days[index][0] || '').trim(), 10) === day) return index + 2;
  }
  return 0;
}

function addMilestone_(ss, payload) {
  const date = parseIsoDate_(payload.date).iso;
  const title = requireText_(payload.title, '디데이 명칭', MAX_TITLE_LENGTH, false);
  const sheet = getOrCreateMilestoneSheet_(ss);
  const id = Utilities.getUuid();
  const row = Math.max(1, sheet.getLastRow()) + 1;
  sheet.getRange(row, 1, 1, 3).setNumberFormat('@').setValues([[date, title, id]]);
  return { milestone: { id: id, date: date, title: title } };
}

function deleteMilestone_(ss, payload) {
  const id = requireText_(payload.id, '디데이 식별자', 100, false);
  const date = parseIsoDate_(payload.date).iso;
  const title = requireText_(payload.title, '디데이 명칭', MAX_TITLE_LENGTH, false);
  const sheet = ss.getSheetByName('디데이');
  if (!sheet || sheet.getLastRow() <= 1) throw new Error('삭제할 디데이가 없습니다.');

  const targetRow = findMilestoneRow_(sheet, id, date, title, ss.getSpreadsheetTimeZone());
  if (!targetRow) throw new Error('디데이 정보가 변경되었습니다. 새로고침 후 다시 시도하세요.');
  sheet.deleteRow(targetRow);
  return { deleted: true };
}

function updateMilestone_(ss, payload) {
  const id = requireText_(payload.id, '디데이 식별자', 100, false);
  const newDate = parseIsoDate_(payload.date).iso;
  const newTitle = requireText_(payload.title, '디데이 명칭', MAX_TITLE_LENGTH, false);
  const sheet = ss.getSheetByName('디데이');
  if (!sheet || sheet.getLastRow() <= 1) throw new Error('수정할 디데이가 없습니다.');

  const targetRow = findMilestoneRow_(sheet, id, payload.oldDate || newDate, payload.oldTitle || newTitle, ss.getSpreadsheetTimeZone());
  if (!targetRow) throw new Error('디데이 정보가 변경되었습니다. 새로고침 후 다시 시도하세요.');

  sheet.getRange(targetRow, 1, 1, 3).setNumberFormat('@').setValues([[newDate, newTitle, id]]);
  return { milestone: { id: id, date: newDate, title: newTitle } };
}

function getOrCreateMilestoneSheet_(ss) {
  let sheet = ss.getSheetByName('디데이');
  if (!sheet) {
    sheet = ss.insertSheet('디데이');
    sheet.getRange(1, 1, 1, 3).setValues([['목표 날짜', '디데이 명칭', '__id']]);
  } else {
    const idHeader = String(sheet.getRange(1, 3).getValue() || '').trim();
    if (idHeader && idHeader !== '__id') {
      throw new Error('디데이 시트의 C열은 일정 식별자 전용입니다.');
    }
    if (!idHeader) sheet.getRange(1, 3).setValue('__id');
  }
  sheet.hideColumns(3);
  return sheet;
}

function findMilestoneRow_(sheet, id, date, title, timezone) {
  const width = Math.max(3, sheet.getLastColumn());
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const legacyMatch = /^legacy-dday:(\d+):(\d+)$/.exec(id);

  if (legacyMatch) {
    const row = Number(legacyMatch[2]);
    if (Number(legacyMatch[1]) !== sheet.getSheetId() || row < 2 || row > sheet.getLastRow()) return 0;
    const value = sheet.getRange(row, 1, 1, 2).getValues()[0];
    return storedDateToIso_(value[0], timezone) === date && String(value[1] || '').trim() === title ? row : 0;
  }

  for (let index = 0; index < rows.length; index++) {
    if (String(rows[index][2] || '') === id &&
        storedDateToIso_(rows[index][0], timezone) === date &&
        String(rows[index][1] || '').trim() === title) {
      return index + 2;
    }
  }
  return 0;
}

function requireEventType_(value, ss) {
  const type = requireText_(value, '일정 분류', 60, false);
  if (ALLOWED_EVENT_TYPES.indexOf(type) !== -1) return type;
  // 기본 분류 외에, 이미 월별 시트의 열로 존재하는 분류는 허용한다.
  // (시트에 직접 추가한 사용자 정의 분류의 일정을 수정할 수 없던 문제 해소)
  // 임의의 신규 열이 API로 만들어지는 것은 여전히 차단된다.
  if (ss && isExistingSheetType_(ss, type)) return type;
  throw new Error('허용되지 않은 일정 분류입니다.');
}

function isExistingSheetType_(ss, type) {
  return ss.getSheets().some(function(sheet) {
    if (!parseMonthlySheetName_(sheet.getName())) return false;
    const lastColumn = sheet.getLastColumn();
    if (lastColumn < 3) return false;
    const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    for (let column = 2; column < headers.length; column++) {
      if (String(headers[column] || '').trim() === type) return true;
    }
    return false;
  });
}

function requireText_(value, fieldName, maxLength, allowNewlines) {
  if (typeof value !== 'string') throw new Error(fieldName + '을(를) 입력하세요.');
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error(fieldName + '을(를) 입력하세요.');
  if (!allowNewlines && normalized.indexOf('\n') !== -1) {
    throw new Error(fieldName + '에는 줄바꿈을 사용할 수 없습니다.');
  }
  if (normalized.length > maxLength) {
    throw new Error(fieldName + '은(는) ' + maxLength + '자 이하여야 합니다.');
  }
  return normalized;
}

function requireInteger_(value, fieldName, min, max) {
  if (!/^\d+$/.test(String(value || ''))) {
    throw new Error(fieldName + '은(는) 숫자로 입력하세요.');
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(fieldName + '은(는) ' + min + '부터 ' + max + ' 사이여야 합니다.');
  }
  return number;
}

function parseIsoDate_(value) {
  if (!isIsoDate_(value)) throw new Error('날짜 형식이 올바르지 않습니다.');
  const parts = value.split('-').map(Number);
  return { year: parts[0], month: parts[1], day: parts[2], iso: value };
}

function isIsoDate_(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!match && isValidDateParts_(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isValidDateParts_(year, month, day) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= new Date(year, month, 0).getDate();
}

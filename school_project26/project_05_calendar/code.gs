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

function doGet() {
  try {
    const ss = getSpreadsheet_();
    const result = { data: {}, types: [], notice: '', milestones: [] };
    const typeSet = {};

    const configSheet = ss.getSheetByName('설정');
    if (configSheet) {
      result.notice = String(configSheet.getRange('B1').getValue() || '').trim();
    }

    result.milestones = readMilestones_(ss);

    ss.getSheets().forEach((sheet) => {
      const match = /^(\d{4})\.(0?[1-9]|1[0-2])$/.exec(sheet.getName().trim());
      if (!match) return;

      const sheetKey = Number(match[1]) + '.' + Number(match[2]);
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
        case 'add_event':
          result = addEvent_(ss, payload);
          break;
        case 'delete_event':
          result = deleteEvent_(ss, payload);
          break;
        case 'add_dday':
          result = addMilestone_(ss, payload);
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

function updateNotice_(ss, payload) {
  const notice = requireText_(payload.newNotice, '공지 내용', MAX_NOTICE_LENGTH, true);
  let sheet = ss.getSheetByName('설정');
  if (!sheet) {
    sheet = ss.insertSheet('설정');
    sheet.getRange('A1').setValue('Notice');
  }
  sheet.getRange('B1').setValue(notice);
  return { notice: notice };
}

function addEvent_(ss, payload) {
  const date = parseIsoDate_(payload.date);
  const type = requireEventType_(payload.type);
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

function requireEventType_(value) {
  const type = requireText_(value, '일정 분류', 60, false);
  if (ALLOWED_EVENT_TYPES.indexOf(type) === -1) {
    throw new Error('허용되지 않은 일정 분류입니다.');
  }
  return type;
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

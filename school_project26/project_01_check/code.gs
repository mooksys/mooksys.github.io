// Google Apps Script backend for the assignment checklist.
// Set ADMIN_PASSWORD_HASH in Script Properties before deployment.

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_GLOBAL_MAX_FAILURES = 30;
const ALLOWED_STATUSES = ['', '완료', '해당없음'];
const MAX_ID_LENGTH = 40;
const MAX_NAME_LENGTH = 80;
const MAX_TOPIC_LENGTH = 100;
const MAX_SHEET_NAME_LENGTH = 50;

function getInitialHashHelper() {
  const initialPassword = 'CHANGE_ME';
  Logger.log('ADMIN_PASSWORD_HASH: ' + computeSHA256(initialPassword));
}

function computeSHA256(input) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(input),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function success(data) {
  return jsonResp(Object.assign({ status: '성공' }, data || {}));
}

function failure(message, status) {
  return jsonResp({ status: status || '실패', message: message });
}

function cleanText(value, fieldName, maxLength) {
  if (typeof value !== 'string') throw new Error(fieldName + '을(를) 문자열로 입력해주세요.');
  const text = value.trim();
  if (!text) throw new Error(fieldName + '을(를) 입력해주세요.');
  if (text.length > maxLength) throw new Error(fieldName + '은(는) ' + maxLength + '자 이하로 입력해주세요.');
  if (/[\u0000-\u001F\u007F]/.test(text)) throw new Error(fieldName + '에 제어 문자를 사용할 수 없습니다.');
  return text;
}

// Prevent values entered by users from being interpreted as spreadsheet formulas.
function spreadsheetSafeText(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function normalizeStoredText(value) {
  const text = String(value == null ? '' : value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function columnToLetter(columnNumber) {
  let result = '';
  let column = columnNumber;
  while (column > 0) {
    column -= 1;
    result = String.fromCharCode(65 + (column % 26)) + result;
    column = Math.floor(column / 26);
  }
  return result;
}

function sessionPropertyKey(token) {
  return 'SESSION_' + computeSHA256(token);
}

function loginFailureKey(clientId) {
  return 'LOGIN_FAIL_' + computeSHA256(clientId).slice(0, 24);
}

function validateClientId(value) {
  const clientId = String(value || '');
  return /^[A-Za-z0-9_-]{16,128}$/.test(clientId) ? clientId : 'unknown-client';
}

function readLoginFailures(props, clientId) {
  const key = loginFailureKey(clientId);
  let record = { count: 0, firstAt: Date.now() };
  try { record = JSON.parse(props.getProperty(key) || JSON.stringify(record)); } catch (e) {}
  if (!record.firstAt || Date.now() - Number(record.firstAt) > LOGIN_WINDOW_MS) {
    record = { count: 0, firstAt: Date.now() };
  }
  return { key: key, record: record };
}

function verifyPassword(params, props) {
  const configuredHash = props.getProperty('ADMIN_PASSWORD_HASH');
  if (!configuredHash) return failure('관리자 비밀번호가 설정되지 않았습니다. 스크립트 속성을 확인해주세요.');

  const password = typeof params.password === 'string' ? params.password : '';
  const clientId = validateClientId(params.clientId);
  const attempt = readLoginFailures(props, clientId);
  const globalAttempt = readLoginFailures(props, 'all-login-clients');
  if (attempt.record.count >= LOGIN_MAX_FAILURES) {
    const waitSeconds = Math.ceil((LOGIN_WINDOW_MS - (Date.now() - attempt.record.firstAt)) / 1000);
    return failure('로그인 시도가 너무 많습니다. 약 ' + Math.max(waitSeconds, 1) + '초 후 다시 시도해주세요.');
  }
  if (globalAttempt.record.count >= LOGIN_GLOBAL_MAX_FAILURES) {
    return failure('전체 로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');
  }

  if (!password || password.length > 256 || configuredHash !== computeSHA256(password)) {
    attempt.record.count += 1;
    props.setProperty(attempt.key, JSON.stringify(attempt.record));
    globalAttempt.record.count += 1;
    props.setProperty(globalAttempt.key, JSON.stringify(globalAttempt.record));
    return failure('비밀번호가 일치하지 않습니다.');
  }

  props.deleteProperty(attempt.key);
  const now = Date.now();
  const allProperties = props.getProperties();
  Object.keys(allProperties).forEach(key => {
    if (key.indexOf('SESSION_') === 0 && now > Number(allProperties[key] || 0)) props.deleteProperty(key);
  });
  const rawToken = [Utilities.getUuid(), Utilities.getUuid(), Date.now()].join('_');
  const sessionToken = computeSHA256(rawToken);
  const expireAt = Date.now() + SESSION_TTL_MS;
  props.setProperty(sessionPropertyKey(sessionToken), String(expireAt));
  return success({ sessionToken: sessionToken, expireAt: expireAt });
}

function requireSession(params, props) {
  const token = typeof params.sessionToken === 'string' ? params.sessionToken : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const key = sessionPropertyKey(token);
  const expireAt = Number(props.getProperty(key) || 0);
  if (!expireAt || Date.now() > expireAt) {
    if (expireAt) props.deleteProperty(key);
    return false;
  }
  return true;
}

function getDataResponse(ss, validSheetNames, requestedSheetName) {
  let requestedName = typeof requestedSheetName === 'string' ? requestedSheetName : '';
  if (validSheetNames.indexOf(requestedName) === -1) requestedName = validSheetNames[0];
  const requestedSheet = ss.getSheetByName(requestedName);
  const values = requestedSheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(normalizeStoredText) : [];
  const students = values.slice(1).map(row => {
    const student = Object.create(null);
    headers.forEach((header, index) => { student[header] = normalizeStoredText(row[index]); });
    return student;
  });
  return success({ sheetNames: validSheetNames, currentSheetName: requestedName, headers: headers, students: students });
}

function doGet() {
  return ContentService.createTextOutput('스마트 명렬표 API 서버입니다.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let params;
  try {
    params = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (error) {
    return failure('잘못된 요청 형식입니다.');
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) return failure('잘못된 요청입니다.');

  const action = typeof params.action === 'string' ? params.action : '';
  const props = PropertiesService.getScriptProperties();
  if (action === 'verify_password') {
    const authLock = LockService.getScriptLock();
    try {
      authLock.waitLock(5000);
      return verifyPassword(params, props);
    } catch (error) {
      return failure('로그인 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (authLock.hasLock()) authLock.releaseLock();
    }
  }
  if (!requireSession(params, props)) return failure('세션이 만료되었거나 유효하지 않습니다.', '거부');
  if (action === 'logout') {
    props.deleteProperty(sessionPropertyKey(params.sessionToken));
    return success();
  }

  const allowedActions = ['get_data', 'batch_update', 'add_student', 'delete_student', 'edit_student', 'add_topic', 'delete_topic', 'add_sheet', 'delete_sheet'];
  if (allowedActions.indexOf(action) === -1) return failure('지원하지 않는 요청입니다.');

  // Normal reads do not take the global write lock. Only first-run sheet creation
  // falls through to the locked section below.
  if (action === 'get_data') {
    try {
      const readOnlySpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      const readOnlySheetNames = readOnlySpreadsheet.getSheets().map(s => s.getName()).filter(name => name !== '설정');
      if (readOnlySheetNames.length > 0) return getDataResponse(readOnlySpreadsheet, readOnlySheetNames, params.sheetName);
    } catch (error) {
      return failure('데이터를 읽는 중 오류가 발생했습니다.', '에러');
    }
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (error) {
    return failure('다른 작업이 처리 중입니다. 잠시 후 다시 시도해주세요.');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let validSheetNames = ss.getSheets().map(s => s.getName()).filter(name => name !== '설정');
    if (validSheetNames.length === 0) {
      const defaultSheet = ss.insertSheet('1반');
      defaultSheet.appendRow(['학번', '이름']);
      validSheetNames = ['1반'];
    }

    if (action === 'get_data') {
      return getDataResponse(ss, validSheetNames, params.sheetName);
    }

    const sheetName = typeof params.sheetName === 'string' ? params.sheetName : '';
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet && action !== 'add_sheet' && action !== 'delete_sheet') return failure('해당 반을 찾을 수 없습니다.');

    const data = sheet ? sheet.getDataRange().getValues() : [];
    const headers = data.length ? data[0].map(normalizeStoredText) : [];
    if (sheet && headers.length < 2) return failure('시트의 기본 열(학번, 이름)이 정상적이지 않습니다.');

    if (action === 'batch_update') {
      const taskTitle = cleanText(params.taskTitle, '과제명', MAX_TOPIC_LENGTH);
      const taskIndex = headers.indexOf(taskTitle);
      if (taskIndex < 2) return failure('올바른 과제가 아닙니다.');
      const updates = params.updates;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return failure('변경 데이터가 올바르지 않습니다.');
      const updateIds = Object.keys(updates);
      if (updateIds.length > Math.max(data.length - 1, 0)) return failure('변경 대상이 너무 많습니다.');
      updateIds.forEach(id => {
        if (ALLOWED_STATUSES.indexOf(updates[id]) === -1) throw new Error('허용되지 않는 상태값입니다.');
      });
      const rowByStudentId = new Map();
      for (let row = 1; row < data.length; row++) {
        const studentId = normalizeStoredText(data[row][0]);
        if (rowByStudentId.has(studentId)) return failure('중복된 학번이 있어 저장할 수 없습니다.');
        rowByStudentId.set(studentId, row + 1);
      }
      if (updateIds.some(id => !rowByStudentId.has(id))) {
        return failure('일부 학생을 찾을 수 없어 저장하지 못했습니다. 데이터를 새로고침해주세요.');
      }
      const rangesByStatus = new Map(ALLOWED_STATUSES.map(status => [status, []]));
      const taskColumn = columnToLetter(taskIndex + 1);
      updateIds.forEach(id => rangesByStatus.get(updates[id]).push(taskColumn + rowByStudentId.get(id)));
      rangesByStatus.forEach((ranges, status) => {
        if (ranges.length > 0) sheet.getRangeList(ranges).setValue(status);
      });
      return success({ updated: updateIds.length });
    }

    if (action === 'add_student') {
      const id = cleanText(params.id, '학번', MAX_ID_LENGTH);
      const name = cleanText(params.name, '이름', MAX_NAME_LENGTH);
      if (data.slice(1).some(row => normalizeStoredText(row[0]) === id)) return failure('이미 존재하는 학번입니다.');
      const newRow = new Array(headers.length).fill('');
      newRow[0] = spreadsheetSafeText(id);
      newRow[1] = spreadsheetSafeText(name);
      sheet.appendRow(newRow);
      return success();
    }

    if (action === 'delete_student') {
      const id = cleanText(params.id, '학번', MAX_ID_LENGTH);
      for (let row = 1; row < data.length; row++) {
        if (normalizeStoredText(data[row][0]) === id) {
          sheet.deleteRow(row + 1);
          return success();
        }
      }
      return failure('해당 학생을 찾을 수 없습니다.');
    }

    if (action === 'edit_student') {
      const oldId = cleanText(params.oldId, '기존 학번', MAX_ID_LENGTH);
      const newId = cleanText(params.newId, '새 학번', MAX_ID_LENGTH);
      const newName = cleanText(params.newName, '이름', MAX_NAME_LENGTH);
      if (data.slice(1).some(row => normalizeStoredText(row[0]) === newId && normalizeStoredText(row[0]) !== oldId)) {
        return failure('이미 존재하는 학번입니다.');
      }
      for (let row = 1; row < data.length; row++) {
        if (normalizeStoredText(data[row][0]) === oldId) {
          sheet.getRange(row + 1, 1, 1, 2).setValues([[spreadsheetSafeText(newId), spreadsheetSafeText(newName)]]);
          return success();
        }
      }
      return failure('해당 학생을 찾을 수 없습니다.');
    }

    if (action === 'add_topic') {
      const topicName = cleanText(params.topicName, '과제명', MAX_TOPIC_LENGTH);
      if (headers.indexOf(topicName) !== -1) return failure('이미 존재하는 과제명입니다.');
      sheet.getRange(1, headers.length + 1).setValue(spreadsheetSafeText(topicName));
      return success();
    }

    if (action === 'delete_topic') {
      const topicName = cleanText(params.topicName, '과제명', MAX_TOPIC_LENGTH);
      const column = headers.indexOf(topicName) + 1;
      if (column <= 2) return failure('해당 과제를 찾을 수 없거나 기본 항목입니다.');
      sheet.deleteColumn(column);
      return success();
    }

    if (action === 'add_sheet') {
      const newSheetName = cleanText(params.newSheetName, '반 이름', MAX_SHEET_NAME_LENGTH);
      if (/[\\/?*\[\]:]/.test(newSheetName)) return failure('반 이름에 \\ / ? * [ ] : 문자를 사용할 수 없습니다.');
      if (newSheetName === '설정' || ss.getSheetByName(newSheetName)) return failure('사용할 수 없거나 이미 존재하는 반 이름입니다.');
      const newSheet = ss.insertSheet(newSheetName);
      newSheet.appendRow(['학번', '이름']);
      return success();
    }

    if (action === 'delete_sheet') {
      const nameToDelete = cleanText(params.sheetToDelete, '반 이름', MAX_SHEET_NAME_LENGTH);
      const sheetToDelete = ss.getSheetByName(nameToDelete);
      if (validSheetNames.length <= 1) return failure('마지막 반은 삭제할 수 없습니다.');
      if (!sheetToDelete || nameToDelete === '설정') return failure('해당 반을 찾을 수 없습니다.');
      ss.deleteSheet(sheetToDelete);
      return success();
    }

    return failure('지원하지 않는 요청입니다.');
  } catch (error) {
    return failure(error && error.message ? error.message : '요청 처리 중 오류가 발생했습니다.', '에러');
  } finally {
    lock.releaseLock();
  }
}

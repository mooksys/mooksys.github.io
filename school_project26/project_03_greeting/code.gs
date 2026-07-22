/**
 * School Announcement System
 *
 * 보안 원칙:
 * - 비밀번호는 로그인할 때만 전송하고, 이후 요청은 만료되는 세션 토큰을 사용한다.
 * - 인증 설정이 없거나 비어 있으면 실패하도록 한다(fail closed).
 * - 서버에서 모든 입력을 검증한 뒤 시트에 저장한다.
 *
 * 최초/변경 설정 방법:
 * - 연결된 스프레드시트를 새로고침한 뒤
 *   알림장 관리 > 접속 비밀번호 설정/변경 메뉴를 실행한다.
 * - 메뉴를 사용할 수 없는 경우 README의 스크립트 속성 방식을 사용한다.
 */

const SHEET_NAME = 'announcements';
const AUTH_SHEET_NAME = 'auth';
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const MAX_CONTENT_LENGTH = 5000;
const SESSION_TTL_SECONDS = 30 * 60;
const AUTH_FAILURE_LIMIT = 5;
const AUTH_LOCK_SECONDS = 5 * 60;
const AUTH_PASSWORD_HASH_KEY = 'AUTH_PASSWORD_HASH';
const AUTH_PASSWORD_SALT_KEY = 'AUTH_PASSWORD_SALT';
const AUTH_PASSWORD_VERSION_KEY = 'AUTH_PASSWORD_VERSION';
const NEW_AUTH_PASSWORD_KEY = 'NEW_AUTH_PASSWORD';

const ALLOWED_THEMES = Object.freeze([
  '☀️ 활기찬 하루',
  '😌 차분한 하루',
  '🌱 성장하는 하루',
  '💡 집중하는 하루',
  '🌈 평화로운 하루',
  '🎉 신나는 하루',
  '💌 따뜻한 하루',
  '🔥 열정적인 하루',
  '🤝 협동하는 하루',
  '🔮 지혜로운 하루'
]);

function doGet() {
  // 프런트엔드는 별도 정적 호스팅되며 GET은 API 상태 확인용으로만 사용한다.
  return jsonResponse_({ success: true, service: 'school-announcement-api' });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('알림장 관리')
    .addItem('접속 비밀번호 설정/변경', 'setupPassword')
    .addToUi();
}

function setupPassword() {
  const ui = SpreadsheetApp.getUi();
  const first = ui.prompt(
    '알림장 접속 비밀번호 설정',
    `${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자의 새 비밀번호를 입력하세요.`,
    ui.ButtonSet.OK_CANCEL
  );
  if (first.getSelectedButton() !== ui.Button.OK) return;

  const password = first.getResponseText();
  if (!isAcceptablePassword_(password)) {
    ui.alert(`비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 설정해야 하며 1234는 사용할 수 없습니다.`);
    return;
  }

  const second = ui.prompt(
    '비밀번호 확인',
    '같은 비밀번호를 한 번 더 입력하세요.',
    ui.ButtonSet.OK_CANCEL
  );
  if (second.getSelectedButton() !== ui.Button.OK) return;
  if (!safeEqual_(password, second.getResponseText())) {
    ui.alert('두 비밀번호가 일치하지 않습니다. 다시 시도해 주세요.');
    return;
  }

  writePassword_(password);
  clearLoginFailures_();
  ui.alert('알림장 접속 비밀번호가 설정되었습니다.');
}

function hashPassword(str) {
  const value = String(str);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );

  let result = '';
  for (let i = 0; i < digest.length; i++) {
    const normalized = digest[i] < 0 ? digest[i] + 256 : digest[i];
    result += normalized.toString(16).padStart(2, '0');
  }
  return result;
}

function safeEqual_(left, right) {
  const a = String(left);
  const b = String(right);
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAcceptablePassword_(password) {
  return typeof password === 'string'
    && password.length >= MIN_PASSWORD_LENGTH
    && password.length <= MAX_PASSWORD_LENGTH
    && password !== '1234';
}

function makeSalt_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function saltedPasswordHash_(password, salt) {
  return hashPassword(salt + ':' + password);
}

function writePassword_(password) {
  if (!isAcceptablePassword_(password)) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 설정해야 합니다.`);
  }

  const salt = makeSalt_();
  PropertiesService.getScriptProperties().setProperties({
    [AUTH_PASSWORD_HASH_KEY]: saltedPasswordHash_(password, salt),
    [AUTH_PASSWORD_SALT_KEY]: salt,
    [AUTH_PASSWORD_VERSION_KEY]: 'v2',
    AUTH_PASSWORD_UPDATED_AT: new Date().toISOString()
  });
}

// Apps Script 편집기에서만 실행하는 관리자용 함수이다. 웹 클라이언트에서는 호출할 수 없다.
function configurePasswordFromScriptProperty_() {
  const properties = PropertiesService.getScriptProperties();
  const password = properties.getProperty(NEW_AUTH_PASSWORD_KEY);
  if (!password) {
    throw new Error(`스크립트 속성 ${NEW_AUTH_PASSWORD_KEY}에 새 비밀번호를 먼저 설정하세요.`);
  }

  writePassword_(password);
  properties.deleteProperty(NEW_AUTH_PASSWORD_KEY);
}

function verifyPassword(inputPassword) {
  if (!isAcceptablePassword_(inputPassword)) return false;

  const properties = PropertiesService.getScriptProperties();
  const configuredHash = String(properties.getProperty(AUTH_PASSWORD_HASH_KEY) || '').trim();
  const configuredSalt = String(properties.getProperty(AUTH_PASSWORD_SALT_KEY) || '').trim();
  const configuredVersion = String(properties.getProperty(AUTH_PASSWORD_VERSION_KEY) || '').trim();

  if (configuredHash || configuredSalt || configuredVersion) {
    if (!configuredHash || !configuredSalt || configuredVersion !== 'v2') return false;
    return safeEqual_(configuredHash, saltedPasswordHash_(inputPassword, configuredSalt));
  }

  // 스크립트 속성이 아직 없을 때만 기존 auth 시트 값을 한 차례 마이그레이션한다.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const authSheet = ss.getSheetByName(AUTH_SHEET_NAME);
  if (!authSheet || authSheet.getLastRow() < 2) return false;

  const storedHash = String(authSheet.getRange(2, 1).getValue() || '').trim();
  if (!storedHash) return false;

  // 기존 평문/단순 SHA-256 저장값은 강한 비밀번호로 확인된 경우에만 마이그레이션한다.
  const isLegacyHash = /^[a-f0-9]{64}$/i.test(storedHash);
  const matches = isLegacyHash
    ? safeEqual_(storedHash.toLowerCase(), hashPassword(inputPassword))
    : safeEqual_(storedHash, inputPassword);

  if (matches) {
    writePassword_(inputPassword);
    authSheet.getRange(2, 1, 1, 4).clearContent();
    authSheet.getRange(2, 1).setValue('MIGRATED_TO_SCRIPT_PROPERTIES');
  }
  return matches;
}

function hasPasswordConfiguration_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredHash = properties.getProperty(AUTH_PASSWORD_HASH_KEY);
  const configuredSalt = properties.getProperty(AUTH_PASSWORD_SALT_KEY);
  if (configuredHash && configuredSalt) return true;

  const authSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEET_NAME);
  if (!authSheet || authSheet.getLastRow() < 2) return false;
  const legacyValue = String(authSheet.getRange(2, 1).getValue() || '').trim();
  return Boolean(legacyValue && legacyValue !== 'MIGRATED_TO_SCRIPT_PROPERTIES');
}

function sessionCacheKey_(token) {
  return 'session:' + hashPassword(token);
}

function createSessionToken_() {
  const token = makeSalt_() + makeSalt_();
  CacheService.getScriptCache().put(sessionCacheKey_(token), '1', SESSION_TTL_SECONDS);
  return token;
}

function verifySessionToken_(token) {
  if (typeof token !== 'string' || token.length < 64) return false;

  const cache = CacheService.getScriptCache();
  const key = sessionCacheKey_(token);
  if (cache.get(key) !== '1') return false;

  // 사용 중인 세션은 최대 30분까지 연장한다.
  cache.put(key, '1', SESSION_TTL_SECONDS);
  return true;
}

function revokeSessionToken_(token) {
  if (typeof token === 'string' && token) {
    CacheService.getScriptCache().remove(sessionCacheKey_(token));
  }
}

function isLoginLocked_() {
  return CacheService.getScriptCache().get('auth:locked') === '1';
}

function recordLoginFailure_() {
  const cache = CacheService.getScriptCache();
  const current = Number(cache.get('auth:failures') || 0) + 1;
  cache.put('auth:failures', String(current), AUTH_LOCK_SECONDS);
  if (current >= AUTH_FAILURE_LIMIT) {
    cache.put('auth:locked', '1', AUTH_LOCK_SECONDS);
  }
}

function clearLoginFailures_() {
  CacheService.getScriptCache().removeAll(['auth:failures', 'auth:locked']);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateDate_(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000
    && year <= 2100
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateId_(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validatePostData_(data) {
  const date = typeof data.date === 'string' ? data.date.trim() : '';
  const theme = typeof data.theme === 'string' ? data.theme.trim() : '';
  const content = typeof data.content === 'string' ? data.content : '';

  if (!validateDate_(date)) {
    return { success: false, error: '날짜 형식이 올바르지 않습니다.', code: 'INVALID_DATE' };
  }
  if (!ALLOWED_THEMES.includes(theme)) {
    return { success: false, error: '허용되지 않은 테마입니다.', code: 'INVALID_THEME' };
  }
  if (!content.trim() || content.length > MAX_CONTENT_LENGTH) {
    return {
      success: false,
      error: `본문은 1~${MAX_CONTENT_LENGTH}자로 입력해 주세요.`,
      code: 'INVALID_CONTENT'
    };
  }

  return { success: true, value: { date, theme, content } };
}

function asSheetText_(value) {
  const text = String(value);
  return text.startsWith('=') ? "'" + text : text;
}

function getAnnouncementSheet_(createIfMissing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['ID', '날짜', '테마', '내용', '등록시간']);
  }
  return sheet;
}

function findRowById_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const match = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

function handleLogin_(data) {
  if (!hasPasswordConfiguration_()) {
    return jsonResponse_({
      success: false,
      error: '비밀번호가 아직 설정되지 않았습니다. 스프레드시트의 알림장 관리 메뉴에서 먼저 설정해 주세요.',
      code: 'AUTH_NOT_CONFIGURED'
    });
  }

  if (!isAcceptablePassword_(data.password)) {
    return jsonResponse_({
      success: false,
      error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
      code: 'INVALID_PASSWORD_FORMAT'
    });
  }

  if (isLoginLocked_()) {
    return jsonResponse_({
      success: false,
      error: '로그인 시도가 잠시 제한되었습니다. 5분 후 다시 시도해 주세요.',
      code: 'LOGIN_LOCKED'
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (isLoginLocked_()) {
      return jsonResponse_({
        success: false,
        error: '로그인 시도가 잠시 제한되었습니다. 5분 후 다시 시도해 주세요.',
        code: 'LOGIN_LOCKED'
      });
    }

    if (!verifyPassword(data.password)) {
      recordLoginFailure_();
      return jsonResponse_({ success: false, error: '인증 정보가 올바르지 않습니다.', code: 'UNAUTHORIZED' });
    }

    clearLoginFailures_();
    return jsonResponse_({
      success: true,
      token: createSessionToken_(),
      expiresIn: SESSION_TTL_SECONDS
    });
  } finally {
    lock.releaseLock();
  }
}

function handleMutation_(action, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getAnnouncementSheet_(action === 'create');
    if (!sheet) {
      return jsonResponse_({ success: false, error: '저장된 알림장이 없습니다.', code: 'NOT_FOUND' });
    }

    if (action === 'create') {
      const validation = validatePostData_(data);
      if (!validation.success) return jsonResponse_(validation);

      const value = validation.value;
      sheet.appendRow([
        Utilities.getUuid(),
        value.date,
        value.theme,
        asSheetText_(value.content),
        new Date()
      ]);
      return jsonResponse_({ success: true, message: '등록되었습니다.' });
    }

    if (!validateId_(data.id)) {
      return jsonResponse_({ success: false, error: '유효하지 않은 알림장 ID입니다.', code: 'INVALID_ID' });
    }

    const rowNumber = findRowById_(sheet, data.id);
    if (!rowNumber) {
      return jsonResponse_({ success: false, error: '대상 알림장을 찾을 수 없습니다.', code: 'NOT_FOUND' });
    }

    if (action === 'update') {
      const validation = validatePostData_(data);
      if (!validation.success) return jsonResponse_(validation);

      const value = validation.value;
      sheet.getRange(rowNumber, 2, 1, 3).setValues([[
        value.date,
        value.theme,
        asSheetText_(value.content)
      ]]);
      return jsonResponse_({ success: true, message: '수정되었습니다.' });
    }

    sheet.deleteRow(rowNumber);
    return jsonResponse_({ success: true, message: '삭제되었습니다.' });
  } finally {
    lock.releaseLock();
  }
}

function processApiRequest_(data) {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonResponse_({ success: false, error: '요청 형식이 올바르지 않습니다.', code: 'INVALID_REQUEST' });
    }

    const action = data.action;
    if (action === 'checkPassword') return handleLogin_(data);

    if (action === 'logout') {
      revokeSessionToken_(data.token);
      return jsonResponse_({ success: true });
    }

    if (!['read', 'create', 'update', 'delete'].includes(action)) {
      return jsonResponse_({ success: false, error: '지원하지 않는 요청입니다.', code: 'INVALID_ACTION' });
    }

    if (!verifySessionToken_(data.token)) {
      return jsonResponse_({ success: false, error: '인증이 만료되었습니다.', code: 'UNAUTHORIZED' });
    }

    if (action === 'read') {
      return jsonResponse_({ success: true, data: getData() });
    }

    return handleMutation_(action, data);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ success: false, error: '서버 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' });
  }
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonResponse_({ success: false, error: '요청 본문이 없습니다.', code: 'EMPTY_REQUEST' });
  }

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (parseError) {
    return jsonResponse_({ success: false, error: 'JSON 요청 형식이 올바르지 않습니다.', code: 'INVALID_JSON' });
  }
  return processApiRequest_(data);
}

function getData() {
  const sheet = getAnnouncementSheet_(false);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return rows
    .filter(row => row[0])
    .map(row => ({
      ID: String(row[0]),
      '날짜': row[1] instanceof Date
        ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(row[1] || ''),
      '테마': String(row[2] || ''),
      '내용': String(row[3] || ''),
      '등록시간': row[4] instanceof Date
        ? Utilities.formatDate(row[4], 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'")
        : String(row[4] || '')
    }));
}

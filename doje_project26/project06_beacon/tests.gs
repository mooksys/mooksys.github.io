/**
 * 2026 Doje Beacon System — 순수 함수 테스트
 *
 * 시트·세션·네트워크에 의존하지 않는 함수만 다룹니다. 그래서 스프레드시트를
 * 건드리지 않고 Apps Script 편집기에서 바로 돌릴 수 있습니다.
 *
 * ▶ 실행 방법
 *   Apps Script 편집기에서 함수 목록의 runAllTests 를 선택하고 실행 →
 *   [실행 로그]에 결과가 나옵니다. 실패가 있으면 예외로 끝납니다.
 *
 * ▶ 배포 영향
 *   이 파일은 doPost 에서 호출되지 않으므로 웹앱 동작에 영향을 주지 않습니다.
 *   운영 스크립트에 두기 싫다면 파일을 지워도 됩니다.
 *
 * ▶ 새 테스트를 추가할 때
 *   TEST_CASES 배열에 [이름, 함수] 한 줄을 더하면 됩니다.
 *   시트가 필요한 함수는 여기 넣지 마세요 — 이 파일의 전제가 깨집니다.
 */

// ─────────────────────────────────────────────────────────────────────
// 아주 작은 단언 유틸
// ─────────────────────────────────────────────────────────────────────

function assertEquals_(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\n    기대: ${JSON.stringify(expected)}\n    실제: ${JSON.stringify(actual)}`);
  }
}

function assertArrayEquals_(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    기대: ${e}\n    실제: ${a}`);
  }
}

function assertTrue_(value, label) {
  if (value !== true) throw new Error(`${label} — true 가 아닙니다 (실제: ${JSON.stringify(value)})`);
}

function assertFalse_(value, label) {
  if (value !== false) throw new Error(`${label} — false 가 아닙니다 (실제: ${JSON.stringify(value)})`);
}

// KST 벽시계 시각을 절대 시각(instant)으로 만듭니다.
// 테스트가 스크립트 시간대에 흔들리지 않도록 UTC 로 직접 계산합니다.
function kstInstant_(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm || 0));
}

// ─────────────────────────────────────────────────────────────────────
// 시간 문자열 정규화
// ─────────────────────────────────────────────────────────────────────

function test_timeObjectToHHMM() {
  assertEquals_(timeObjectToHHMM(''),        '', '빈 문자열은 빈 값');
  assertEquals_(timeObjectToHHMM(null),      '', 'null 은 빈 값');
  assertEquals_(timeObjectToHHMM(undefined), '', 'undefined 는 빈 값');

  assertEquals_(timeObjectToHHMM('09:00'),   '09:00', '이미 정규화된 값은 그대로');
  assertEquals_(timeObjectToHHMM('9:00'),    '09:00', '한 자리 시각은 0 패딩');
  assertEquals_(timeObjectToHHMM('9:5'),     '09:05', '분도 0 패딩');
  assertEquals_(timeObjectToHHMM('9:38:12'), '09:38', '초는 잘라냄');
  assertEquals_(timeObjectToHHMM('  9:00 '), '09:00', '앞뒤 공백 제거');

  // 시트에서 시각 셀을 getValues() 로 읽으면 Date 객체가 됩니다.
  // 지역 필드를 쓰므로 지역 기준으로 Date 를 만들어 비교합니다.
  assertEquals_(timeObjectToHHMM(new Date(2026, 0, 1, 9, 5)), '09:05', 'Date 객체는 시/분만 추출');
  assertEquals_(timeObjectToHHMM(new Date(2026, 0, 1, 18, 0)), '18:00', 'Date 객체 오후');
}

function test_hhmmToMinutes() {
  assertEquals_(hhmmToMinutes('00:00'), 0,    '자정은 0분');
  assertEquals_(hhmmToMinutes('09:00'), 540,  '09:00 은 540분');
  assertEquals_(hhmmToMinutes('9:00'),  540,  '정규화를 거치므로 한 자리도 통과');
  assertEquals_(hhmmToMinutes('18:30'), 1110, '18:30 은 1110분');
  assertEquals_(hhmmToMinutes('23:59'), 1439, '하루의 마지막 분');

  assertEquals_(hhmmToMinutes('24:00'), null, '24시는 없음');
  assertEquals_(hhmmToMinutes('09:60'), null, '60분은 없음');
  assertEquals_(hhmmToMinutes('abc'),   null, '문자열은 거부');
  assertEquals_(hhmmToMinutes(''),      null, '빈 값은 거부');
  assertEquals_(hhmmToMinutes(null),    null, 'null 은 거부');
}

function test_minutesToHHMM() {
  assertEquals_(minutesToHHMM(0),    '00:00', '0분은 자정');
  assertEquals_(minutesToHHMM(540),  '09:00', '540분은 09:00');
  assertEquals_(minutesToHHMM(1439), '23:59', '1439분은 23:59');

  // 현재 구현은 24시간을 넘겨도 되감지 않습니다.
  // recordAttendance 의 퇴실 안내(입실 기준시간 + 2시간)에서 기준시간이
  // 22:00 이후면 '24:00' 같은 값이 안내에 노출될 수 있습니다.
  // 지금은 기준시간이 그렇게 늦게 설정될 일이 없어 그대로 둡니다.
  assertEquals_(minutesToHHMM(1440), '24:00', '24시간은 되감지 않음 (현재 동작)');
}

// ─────────────────────────────────────────────────────────────────────
// 실습일 · OJT 운영기간 판정
// ─────────────────────────────────────────────────────────────────────

function test_isFieldDay() {
  assertFalse_(isFieldDay(0), '일요일은 실습일 아님');
  assertFalse_(isFieldDay(1), '월요일은 실습일 아님');
  assertTrue_(isFieldDay(2),  '화요일은 실습일');
  assertTrue_(isFieldDay(3),  '수요일은 실습일');
  assertTrue_(isFieldDay(4),  '목요일은 실습일');
  assertFalse_(isFieldDay(5), '금요일은 실습일 아님');
  assertFalse_(isFieldDay(6), '토요일은 실습일 아님');
}

function test_isOjtMonth() {
  assertFalse_(isOjtMonth(1),  '1월은 OJT 비운영');
  assertFalse_(isOjtMonth(2),  '2월은 OJT 비운영');
  assertTrue_(isOjtMonth(3),   '3월부터 운영');
  assertTrue_(isOjtMonth(12),  '12월까지 운영');
  assertTrue_(isOjtMonth('3'), '문자열도 허용 (parseInt)');
  assertFalse_(isOjtMonth(13), '13월은 없음');
  assertFalse_(isOjtMonth(0),  '0월은 없음');
}

// ─────────────────────────────────────────────────────────────────────
// 시간대 처리
//
// 이 프로젝트에서 가장 조용히 틀리기 쉬운 부분입니다.
// formatKST 는 어떤 스크립트 시간대에서도 같은 답을 내야 합니다.
// ─────────────────────────────────────────────────────────────────────

function test_formatKST() {
  // 2026-09-16 22:30 UTC = 2026-09-17 07:30 KST
  const instant = new Date(Date.UTC(2026, 8, 16, 22, 30));
  assertEquals_(formatKST('yyyy-MM-dd HH:mm', instant), '2026-09-17 07:30', 'UTC→KST 변환');
  assertEquals_(formatKST('yyyy-MM-dd', instant),       '2026-09-17',       '날짜만');
  assertEquals_(formatKST('HH:mm:ss', new Date(Date.UTC(2026, 8, 16, 0, 0, 5))),
    '09:00:05', '자정 직후 UTC 는 KST 오전 9시');

  // KST 자정 경계 — UTC 로는 전날 15:00
  assertEquals_(formatKST('yyyy-MM-dd', new Date(Date.UTC(2026, 8, 15, 15, 0))),
    '2026-09-16', 'KST 자정 직후');
  assertEquals_(formatKST('yyyy-MM-dd', new Date(Date.UTC(2026, 8, 15, 14, 59))),
    '2026-09-15', 'KST 자정 직전');
}

function test_nowKST_fieldAccess() {
  // nowKST 가 돌려준 Date 의 지역 필드는 스크립트 시간대와 무관하게 KST 값이어야 합니다.
  const instant = kstInstant_(2026, 9, 17, 7, 30); // 2026-09-17(목) 07:30 KST
  const kst = nowKST(instant);

  assertEquals_(kst.getFullYear(), 2026, 'KST 연도');
  assertEquals_(kst.getMonth() + 1, 9,   'KST 월');
  assertEquals_(kst.getDate(), 17,       'KST 일');
  assertEquals_(kst.getHours(), 7,       'KST 시');
  assertEquals_(kst.getMinutes(), 30,    'KST 분');
  assertEquals_(kst.getDay(), 4,         '2026-09-17 은 목요일');

  // 필드와 문자열이 같은 순간을 가리키는지 (recordAttendance 가 의존하는 성질)
  assertEquals_(formatKST('yyyy-MM-dd', instant), '2026-09-17', '문자열도 같은 날짜');
}

// ─────────────────────────────────────────────────────────────────────
// 월간 레포트 대상 실습일 산출
//
// blockedSheet 에 null 을 넘기면 getBlockedDates 가 빈 목록을 돌려주므로
// 시트 없이 검증할 수 있습니다. nowDate 는 테스트용 주입 지점입니다.
// ─────────────────────────────────────────────────────────────────────

function test_getScheduledReportDates_ojtMonths() {
  assertArrayEquals_(getScheduledReportDates(2026, 1, null, kstInstant_(2026, 12, 31, 20, 0)),
    [], '1월은 OJT 비운영이라 대상일 없음');
  assertArrayEquals_(getScheduledReportDates(2026, 2, null, kstInstant_(2026, 12, 31, 20, 0)),
    [], '2월은 OJT 비운영이라 대상일 없음');
}

function test_getScheduledReportDates_fullMonth() {
  // 2026년 9월의 화·수·목. 9/1 은 화요일입니다.
  const dates = getScheduledReportDates(2026, 9, null, kstInstant_(2026, 10, 1, 12, 0));
  assertArrayEquals_(dates, [
    '2026-09-01', '2026-09-02', '2026-09-03',
    '2026-09-08', '2026-09-09', '2026-09-10',
    '2026-09-15', '2026-09-16', '2026-09-17',
    '2026-09-22', '2026-09-23', '2026-09-24',
    '2026-09-29', '2026-09-30',
  ], '지난 달은 화·수·목 전부가 대상');
}

function test_getScheduledReportDates_excludesFuture() {
  // 2026-09-10(목) 12:00 기준 — 오늘은 마감(18시) 전이라 제외됩니다.
  const dates = getScheduledReportDates(2026, 9, null, kstInstant_(2026, 9, 10, 12, 0));
  assertArrayEquals_(dates, [
    '2026-09-01', '2026-09-02', '2026-09-03',
    '2026-09-08', '2026-09-09',
  ], '미래 날짜와 마감 전 당일은 제외');
}

function test_getScheduledReportDates_includesTodayAfterClose() {
  // 같은 날 18:00 이후면 당일도 집계 대상이 됩니다.
  const dates = getScheduledReportDates(2026, 9, null, kstInstant_(2026, 9, 10, 18, 30));
  assertEquals_(dates[dates.length - 1], '2026-09-10', '마감 후에는 당일 포함');
  assertEquals_(dates.length, 6, '9/10 이 더해져 6일');
}

function test_getScheduledReportDates_excludesFixedHoliday() {
  // 2026-05-05(화) 어린이날은 FIXED_HOLIDAYS 에 있어 제외되어야 합니다.
  const dates = getScheduledReportDates(2026, 5, null, kstInstant_(2026, 6, 1, 12, 0));
  assertEquals_(dates.indexOf('2026-05-05'), -1, '어린이날은 대상에서 제외');
  assertTrue_(dates.indexOf('2026-05-06') >= 0, '어린이날 다음날(수)은 정상 포함');
}

// ─────────────────────────────────────────────────────────────────────
// 날짜 차단 판정 (시트 없이 규칙 부분만)
// ─────────────────────────────────────────────────────────────────────

function test_isDateBlocked_withoutSheet() {
  assertTrue_(isDateBlocked(null, '2026-01-15').blocked, '1월은 OJT 비운영으로 차단');
  assertTrue_(isDateBlocked(null, '2026-02-15').blocked, '2월도 차단');
  assertTrue_(isDateBlocked(null, '2026-05-05').blocked, '어린이날은 공휴일로 차단');
  assertTrue_(isDateBlocked(null, '2026-12-25').blocked, '크리스마스는 공휴일로 차단');

  assertFalse_(isDateBlocked(null, '2026-09-16').blocked, '평범한 실습일은 차단 아님');
  assertFalse_(isDateBlocked(null, '').blocked,           '빈 날짜는 차단 아님');
}

// ─────────────────────────────────────────────────────────────────────
// 입력값 검증
// ─────────────────────────────────────────────────────────────────────

function test_validate() {
  assertTrue_(validate('31201', PATTERN.ID, '학번').ok,     '숫자 학번 통과');
  assertTrue_(validate('teacher1', PATTERN.ID, 'ID').ok,    '영문 ID 통과');
  assertFalse_(validate('', PATTERN.ID, '학번').ok,          '빈 값 거부');
  assertFalse_(validate('  ', PATTERN.ID, '학번').ok,        '공백만 있으면 거부');

  assertTrue_(validate('09:00', PATTERN.TIME, '시간').ok,   '정상 시각 통과');
  assertFalse_(validate('9:00', PATTERN.TIME, '시간').ok,    '패딩 없는 시각은 거부');
  assertFalse_(validate('24:00', PATTERN.TIME, '시간').ok,   '24시 거부');

  assertTrue_(validate('2026-09-16', PATTERN.DATE, '날짜').ok, '정상 날짜 통과');
  assertFalse_(validate('2026-9-16', PATTERN.DATE, '날짜').ok,  '패딩 없는 날짜 거부');

  // 인젝션 차단
  assertFalse_(validate('<script>x</script>', PATTERN.NAME, '이름').ok, '태그 포함 이름 거부');
  assertFalse_(validate('홍길동<img>', PATTERN.NAME, '이름').ok,         '태그 섞인 이름 거부');
  assertTrue_(validate('홍길동', PATTERN.NAME, '이름').ok,               '정상 이름 통과');

  // 비밀번호는 인젝션 검사를 건너뜁니다 (SECRET_FIELD).
  // 이게 없으면 'Secure<2026>!' 같은 정상 비밀번호가 로그인 단계에서
  // 원인도 모른 채 거부됩니다.
  assertTrue_(validate('Secure<2026>!', PATTERN.PW, '비밀번호', SECRET_FIELD).ok,
    '비밀번호는 꺾쇠가 있어도 통과');
  assertFalse_(validate('abc', PATTERN.PW, '비밀번호', SECRET_FIELD).ok,
    '4자 미만 비밀번호 거부');
}

function test_validateAll() {
  assertTrue_(validateAll([
    ['31201', PATTERN.ID, '학번'],
    ['09:00', PATTERN.TIME, '입실시간'],
  ]).ok, '모두 통과하면 ok');

  const failed = validateAll([
    ['31201', PATTERN.ID, '학번'],
    ['25:00', PATTERN.TIME, '입실시간'],
  ]);
  assertFalse_(failed.ok, '하나라도 실패하면 실패');
  assertTrue_(failed.msg.indexOf('입실시간') >= 0, '실패한 필드명이 메시지에 포함');
}

// ─────────────────────────────────────────────────────────────────────
// 초기 비밀번호 생성
// ─────────────────────────────────────────────────────────────────────

function test_generateInitialPassword() {
  for (let i = 0; i < 20; i++) {
    const pw = generateInitialPassword();
    assertEquals_(pw.length, INITIAL_PW_LENGTH, '길이가 상수와 일치');
    for (const ch of pw) {
      assertTrue_(INITIAL_PW_ALPHABET.indexOf(ch) >= 0,
        `허용 문자만 사용 (문제 문자: ${ch})`);
    }
    // 0/O/1/l/I 는 받아적을 때 헷갈려서 의도적으로 제외되어 있습니다.
    assertEquals_(/[0O1lI]/.test(pw), false, '혼동 문자는 나오지 않음');
  }
}

// ─────────────────────────────────────────────────────────────────────
// 퇴반(중도 포기) 판정
//
// LEFT_DATE 는 '출결 대상에서 빠지는 첫 날'입니다. 경계값을 잘못 잡으면
// 퇴반 당일이 결석으로 잡히거나, 반대로 마지막 출석일이 통계에서 빠집니다.
// ─────────────────────────────────────────────────────────────────────

function test_isEnrolledOn() {
  // 퇴반일이 없으면 언제나 재학 중
  assertTrue_(isEnrolledOn('', '2026-09-16'),        '빈 값은 재학 중');
  assertTrue_(isEnrolledOn(null, '2026-09-16'),      'null 은 재학 중');
  assertTrue_(isEnrolledOn(undefined, '2026-09-16'), 'undefined 는 재학 중');
  assertTrue_(isEnrolledOn('   ', '2026-09-16'),     '공백만 있어도 재학 중');

  // 경계: 퇴반일 당일부터 제외
  assertTrue_(isEnrolledOn('2026-09-16', '2026-09-15'),  '퇴반 전날은 재학 중');
  assertFalse_(isEnrolledOn('2026-09-16', '2026-09-16'), '퇴반 당일부터 제외');
  assertFalse_(isEnrolledOn('2026-09-16', '2026-09-17'), '퇴반 다음날도 제외');

  // 월·연 경계에서도 문자열 비교가 성립해야 합니다 (yyyy-MM-dd 는 사전순 = 시간순)
  assertTrue_(isEnrolledOn('2026-10-01', '2026-09-30'),  '월 경계 직전');
  assertFalse_(isEnrolledOn('2026-10-01', '2026-10-01'), '월 경계 당일');
  assertTrue_(isEnrolledOn('2027-01-01', '2026-12-31'),  '연 경계 직전');
  assertFalse_(isEnrolledOn('2027-01-01', '2027-03-02'), '해가 바뀌어도 제외');

  // 조회 날짜가 없으면 판정할 수 없으므로 재학으로 보지 않습니다
  assertFalse_(isEnrolledOn('2026-09-16', ''), '조회 날짜가 없으면 제외');
}

// ─────────────────────────────────────────────────────────────────────
// 요청 빈도 제한
//
// 여기서 확인하려는 것은 "정상 사용이 막히지 않는가"입니다.
// 한도를 조일 때 이 테스트가 먼저 깨져야 합니다.
// ─────────────────────────────────────────────────────────────────────

function test_rateLimit_allowsNormalUsage() {
  const id = 'rltest_' + new Date().getTime();

  // 학생 1명이 하루에 누르는 입실·퇴실은 2회입니다.
  for (let i = 0; i < 2; i++) {
    assertFalse_(exceedsRateLimit('recordAttendance', id), `출결 기록 ${i + 1}회차는 통과해야 함`);
  }

  // 교사 대시보드는 30초마다 폴링 → 분당 2회. 수동 새로고침을 더해도 여유가 있어야 합니다.
  const teacher = 'teacher_' + new Date().getTime();
  for (let i = 0; i < 20; i++) {
    assertFalse_(exceedsRateLimit('getAdminData', teacher), `대시보드 폴링 ${i + 1}회차는 통과해야 함`);
  }
}

function test_rateLimit_blocksAbuse() {
  const id = 'abuse_' + new Date().getTime();
  const limit = RATE_LIMITS.recordAttendance.perId;

  for (let i = 0; i < limit; i++) {
    assertFalse_(exceedsRateLimit('recordAttendance', id), `한도 이내 ${i + 1}회차는 통과`);
  }
  assertTrue_(exceedsRateLimit('recordAttendance', id), '한도를 넘으면 차단');
}

function test_rateLimit_isolatesPerId() {
  const stamp  = new Date().getTime();
  const noisy  = 'noisy_' + stamp;
  const normal = 'normal_' + stamp;

  // 한 학생이 한도를 다 써도 다른 학생은 영향을 받지 않아야 합니다.
  for (let i = 0; i < RATE_LIMITS.recordAttendance.perId; i++) {
    exceedsRateLimit('recordAttendance', noisy);
  }
  assertTrue_(exceedsRateLimit('recordAttendance', noisy),   '한도를 쓴 쪽은 차단');
  assertFalse_(exceedsRateLimit('recordAttendance', normal), '다른 학생은 정상 통과');
}

function test_rateLimit_unknownActionUsesDefault() {
  const id = 'unknown_' + new Date().getTime();
  // 목록에 없는 액션도 _default 한도로 보호되어야 합니다 (통과는 하되 무한은 아님).
  assertFalse_(exceedsRateLimit('someNewAction', id), '새 액션도 기본 한도로 통과');
  assertTrue_(RATE_LIMITS._default.perId > 0, '_default 한도가 정의되어 있어야 함');
}

// ─────────────────────────────────────────────────────────────────────
// 실행기
// ─────────────────────────────────────────────────────────────────────

const TEST_CASES = [
  ['timeObjectToHHMM',                     test_timeObjectToHHMM],
  ['hhmmToMinutes',                        test_hhmmToMinutes],
  ['minutesToHHMM',                        test_minutesToHHMM],
  ['isFieldDay',                           test_isFieldDay],
  ['isOjtMonth',                           test_isOjtMonth],
  ['formatKST',                            test_formatKST],
  ['nowKST (필드 접근)',                    test_nowKST_fieldAccess],
  ['getScheduledReportDates (OJT 비운영)',  test_getScheduledReportDates_ojtMonths],
  ['getScheduledReportDates (한 달 전체)',  test_getScheduledReportDates_fullMonth],
  ['getScheduledReportDates (미래 제외)',   test_getScheduledReportDates_excludesFuture],
  ['getScheduledReportDates (마감 후 당일)', test_getScheduledReportDates_includesTodayAfterClose],
  ['getScheduledReportDates (공휴일 제외)', test_getScheduledReportDates_excludesFixedHoliday],
  ['isDateBlocked (시트 없이)',             test_isDateBlocked_withoutSheet],
  ['validate',                             test_validate],
  ['validateAll',                          test_validateAll],
  ['generateInitialPassword',              test_generateInitialPassword],
  ['isEnrolledOn (퇴반 판정)',              test_isEnrolledOn],
  ['rateLimit (정상 사용 허용)',            test_rateLimit_allowsNormalUsage],
  ['rateLimit (과다 호출 차단)',            test_rateLimit_blocksAbuse],
  ['rateLimit (id 별 격리)',                test_rateLimit_isolatesPerId],
  ['rateLimit (미등록 액션 기본값)',        test_rateLimit_unknownActionUsesDefault],
];

function runAllTests() {
  const failures = [];
  let passed = 0;

  TEST_CASES.forEach(([name, fn]) => {
    try {
      fn();
      passed++;
      Logger.log(`✅ ${name}`);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      Logger.log(`❌ ${name}\n   ${err.message}`);
    }
  });

  Logger.log('');
  Logger.log(`── 결과: ${passed}/${TEST_CASES.length} 통과 ──`);

  if (failures.length) {
    // 편집기에서 실행했을 때 실패를 놓치지 않도록 예외로 끝냅니다.
    throw new Error(`테스트 ${failures.length}건 실패:\n` + failures.join('\n'));
  }
  return `${passed}/${TEST_CASES.length} 통과`;
}

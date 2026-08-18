var ALLOWED_SHEETS = {
  '기업': '기업ID',
  '학생': '학생ID',
  '과목': '과목ID',
  '문제': '문제ID',
  '배정': '배정ID'
};

var DOMAIN_ACTIONS = {
  deleteSubjectCascade: true,
  deleteCompanyCascade: true,
  createSubjectAndAssign: true,
  reorderAssignments: true
};

var SESSION_TTL_SECONDS = 21600; // 6시간(활동 시 갱신)
var SESSION_KEY_PREFIX = 'problem-bank-session:';

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToJSON(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  return values.slice(1)
    .filter(function(row) {
      return row.some(function(cell) { return cell !== '' && cell !== null; });
    })
    .map(function(row) {
      var item = {};
      headers.forEach(function(header, index) {
        item[header] = row[index];
      });
      return item;
    });
}

function getConfiguredPassword(ss) {
  // 운영 환경에서는 스크립트 속성 APP_PASSWORD 사용을 권장합니다.
  var propertyPassword = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (propertyPassword !== null && propertyPassword !== '') {
    return String(propertyPassword);
  }

  // 기존 설정 시트와의 호환을 위한 대체 경로입니다. 비밀번호는 클라이언트로 반환하지 않습니다.
  var settingsRows = sheetToJSON(ss, '설정');
  if (settingsRows.length > 0 && settingsRows[0].비밀번호 !== undefined) {
    return String(settingsRows[0].비밀번호);
  }
  return '';
}

function constantTimeEquals(leftValue, rightValue) {
  var left = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(leftValue),
    Utilities.Charset.UTF_8
  );
  var right = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(rightValue),
    Utilities.Charset.UTF_8
  );
  var difference = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) {
    difference |= (left[i % left.length] ^ right[i % right.length]);
  }
  return difference === 0;
}

function issueSessionToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(
    SESSION_KEY_PREFIX + token,
    'authenticated',
    SESSION_TTL_SECONDS
  );
  return token;
}

function isValidSession(token) {
  if (typeof token !== 'string' || token.length < 32) return false;

  var cache = CacheService.getScriptCache();
  var cacheKey = SESSION_KEY_PREFIX + token;
  var session = cache.get(cacheKey);
  if (session !== 'authenticated') return false;

  cache.put(cacheKey, session, SESSION_TTL_SECONDS);
  return true;
}

function revokeSession(token) {
  if (typeof token === 'string' && token) {
    CacheService.getScriptCache().remove(SESSION_KEY_PREFIX + token);
  }
}

function buildDataPayload(ss) {
  return {
    students: sheetToJSON(ss, '학생'),
    companies: sheetToJSON(ss, '기업'),
    subjects: sheetToJSON(ss, '과목'),
    questions: sheetToJSON(ss, '문제'),
    assignments: sheetToJSON(ss, '배정')
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + '는 객체여야 합니다.');
  }
  return value;
}

function requireValue(data, fieldName) {
  var value = data[fieldName];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(fieldName + ' 값이 필요합니다.');
  }
  return value;
}

function getTable(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('시트를 찾을 수 없습니다: ' + sheetName);

  var values = sheet.getDataRange().getValues();
  if (values.length === 0) throw new Error('시트의 헤더 행이 없습니다: ' + sheetName);
  return { sheet: sheet, headers: values[0], rows: values.slice(1) };
}

function requireColumn(table, fieldName) {
  var columnIndex = table.headers.indexOf(fieldName);
  if (columnIndex === -1) throw new Error('열을 찾을 수 없습니다: ' + fieldName);
  return columnIndex;
}

function rowToObject(headers, row) {
  var result = {};
  headers.forEach(function(header, index) { result[header] = row[index]; });
  return result;
}

function findRowNumber(table, fieldName, value) {
  var columnIndex = requireColumn(table, fieldName);
  for (var index = 0; index < table.rows.length; index++) {
    if (String(table.rows[index][columnIndex]) === String(value)) return index + 2;
  }
  return -1;
}

function findRecord(records, fieldName, value) {
  return records.find(function(record) {
    return String(record[fieldName]) === String(value);
  }) || null;
}

function appendObjectRow(table, data) {
  var row = table.headers.map(function(header) {
    return data[header] !== undefined ? data[header] : '';
  });
  table.sheet.appendRow(row);
}

function deleteRowsByField(ss, sheetName, fieldName, value) {
  var table = getTable(ss, sheetName);
  var columnIndex = requireColumn(table, fieldName);
  var deletedCount = 0;
  for (var index = table.rows.length - 1; index >= 0; index--) {
    if (String(table.rows[index][columnIndex]) === String(value)) {
      table.sheet.deleteRow(index + 2);
      deletedCount++;
    }
  }
  return deletedCount;
}

function normalizeAssignmentOrder(ss, companyId) {
  var table = getTable(ss, '배정');
  if (table.rows.length === 0) return;

  var companyColumn = requireColumn(table, '기업ID');
  var orderColumn = requireColumn(table, '순서');
  var matchingRows = [];
  table.rows.forEach(function(row, index) {
    if (String(row[companyColumn]) === String(companyId)) {
      matchingRows.push({
        rowIndex: index,
        order: parseInt(row[orderColumn], 10) || 999999
      });
    }
  });
  matchingRows.sort(function(left, right) {
    return left.order === right.order ? left.rowIndex - right.rowIndex : left.order - right.order;
  });
  matchingRows.forEach(function(item, index) {
    table.rows[item.rowIndex][orderColumn] = index + 1;
  });
  table.sheet.getRange(2, 1, table.rows.length, table.headers.length).setValues(table.rows);
}

function validateRecordRelationships(ss, sheetName, action, data, existingRecord) {
  if (sheetName === '학생') {
    if (data.기업ID !== undefined && data.기업ID !== null && String(data.기업ID).trim() !== '') {
      if (!findRecord(sheetToJSON(ss, '기업'), '기업ID', data.기업ID)) {
        throw new Error('존재하지 않는 기업에는 학생을 배정할 수 없습니다.');
      }
    }
    return;
  }

  if (sheetName === '문제') {
    var subjectId = requireValue(data, '과목ID');
    if (!findRecord(sheetToJSON(ss, '과목'), '과목ID', subjectId)) {
      throw new Error('존재하지 않는 과목에는 문제를 등록할 수 없습니다.');
    }
    var questionNumber = parseInt(requireValue(data, '문제번호'), 10);
    if (!questionNumber || questionNumber < 1) throw new Error('문제번호는 1 이상의 숫자여야 합니다.');
    var questionId = requireValue(data, '문제ID');
    var duplicateQuestion = sheetToJSON(ss, '문제').some(function(question) {
      return String(question.문제ID) !== String(questionId) &&
        String(question.과목ID) === String(subjectId) &&
        parseInt(question.문제번호, 10) === questionNumber;
    });
    if (duplicateQuestion) throw new Error('같은 과목에 동일한 문제번호가 이미 존재합니다.');
    return;
  }

  if (sheetName === '배정') {
    var companyId = requireValue(data, '기업ID');
    var assignedSubjectId = requireValue(data, '과목ID');
    var assignmentId = requireValue(data, '배정ID');
    if (String(assignmentId) !== String(companyId) + '_' + String(assignedSubjectId)) {
      throw new Error('배정ID는 기업ID_과목ID 형식과 일치해야 합니다.');
    }
    if (!findRecord(sheetToJSON(ss, '기업'), '기업ID', companyId)) {
      throw new Error('존재하지 않는 기업에는 과목을 배정할 수 없습니다.');
    }
    if (!findRecord(sheetToJSON(ss, '과목'), '과목ID', assignedSubjectId)) {
      throw new Error('존재하지 않는 과목은 배정할 수 없습니다.');
    }
    if (action === 'update' && existingRecord &&
        (String(existingRecord.기업ID) !== String(companyId) || String(existingRecord.과목ID) !== String(assignedSubjectId))) {
      throw new Error('기존 배정의 기업 또는 과목은 변경할 수 없습니다.');
    }
    var assignments = sheetToJSON(ss, '배정');
    var duplicateAssignment = assignments.some(function(assignment) {
      return String(assignment.배정ID) !== String(assignmentId) &&
        String(assignment.기업ID) === String(companyId) &&
        String(assignment.과목ID) === String(assignedSubjectId);
    });
    if (duplicateAssignment) throw new Error('이미 해당 기업에 배정된 과목입니다.');
    if (action === 'create') {
      var companyAssignmentCount = assignments.filter(function(assignment) {
        return String(assignment.기업ID) === String(companyId);
      }).length;
      if (companyAssignmentCount >= 6) throw new Error('한 기업에는 최대 6개 과목만 배정할 수 있습니다.');
      data.순서 = companyAssignmentCount + 1;
    }
  }
}

function validateDeleteRelationships(ss, sheetName, idValue) {
  if (sheetName === '기업') {
    var studentCount = sheetToJSON(ss, '학생').filter(function(student) {
      return String(student.기업ID) === String(idValue);
    }).length;
    var assignmentCount = sheetToJSON(ss, '배정').filter(function(assignment) {
      return String(assignment.기업ID) === String(idValue);
    }).length;
    if (studentCount || assignmentCount) {
      throw new Error('연결된 학생 또는 배정이 있는 기업은 deleteCompanyCascade로 삭제해야 합니다.');
    }
  }

  if (sheetName === '과목') {
    var questionCount = sheetToJSON(ss, '문제').filter(function(question) {
      return String(question.과목ID) === String(idValue);
    }).length;
    var subjectAssignmentCount = sheetToJSON(ss, '배정').filter(function(assignment) {
      return String(assignment.과목ID) === String(idValue);
    }).length;
    if (questionCount || subjectAssignmentCount) {
      throw new Error('연결된 문제 또는 배정이 있는 과목은 deleteSubjectCascade로 삭제해야 합니다.');
    }
  }
}

function deleteSubjectCascade(ss, data) {
  data = requireObject(data, 'data');
  var subjectId = requireValue(data, 'subjectId');
  if (!findRecord(sheetToJSON(ss, '과목'), '과목ID', subjectId)) {
    throw new Error('삭제할 과목을 찾을 수 없습니다.');
  }

  // 자식 데이터를 먼저 삭제하므로 중간 실패가 발생해도 고아 참조는 만들지 않습니다.
  var affectedCompanyIds = {};
  sheetToJSON(ss, '배정').forEach(function(assignment) {
    if (String(assignment.과목ID) === String(subjectId)) {
      affectedCompanyIds[String(assignment.기업ID)] = true;
    }
  });
  var assignmentsDeleted = deleteRowsByField(ss, '배정', '과목ID', subjectId);
  var questionsDeleted = deleteRowsByField(ss, '문제', '과목ID', subjectId);
  var subjectsDeleted = deleteRowsByField(ss, '과목', '과목ID', subjectId);
  if (subjectsDeleted !== 1) throw new Error('과목 삭제 결과가 올바르지 않습니다.');
  Object.keys(affectedCompanyIds).forEach(function(companyId) {
    normalizeAssignmentOrder(ss, companyId);
  });
  return {
    subjectId: subjectId,
    assignmentsDeleted: assignmentsDeleted,
    questionsDeleted: questionsDeleted
  };
}

function deleteCompanyCascade(ss, data) {
  data = requireObject(data, 'data');
  var companyId = requireValue(data, 'companyId');
  if (!findRecord(sheetToJSON(ss, '기업'), '기업ID', companyId)) {
    throw new Error('삭제할 기업을 찾을 수 없습니다.');
  }

  var assignmentsDeleted = deleteRowsByField(ss, '배정', '기업ID', companyId);
  var studentsDeleted = deleteRowsByField(ss, '학생', '기업ID', companyId);
  var companiesDeleted = deleteRowsByField(ss, '기업', '기업ID', companyId);
  if (companiesDeleted !== 1) throw new Error('기업 삭제 결과가 올바르지 않습니다.');
  return {
    companyId: companyId,
    assignmentsDeleted: assignmentsDeleted,
    studentsDeleted: studentsDeleted
  };
}

function createSubjectAndAssign(ss, data) {
  data = requireObject(data, 'data');
  var subject = requireObject(data.subject, 'data.subject');
  var assignment = requireObject(data.assignment, 'data.assignment');
  var subjectId = requireValue(subject, '과목ID');
  requireValue(subject, '과목명');
  var assignmentId = requireValue(assignment, '배정ID');
  var companyId = requireValue(assignment, '기업ID');
  var assignedSubjectId = requireValue(assignment, '과목ID');

  if (String(subjectId) !== String(assignedSubjectId)) {
    throw new Error('생성할 과목과 배정의 과목ID가 일치하지 않습니다.');
  }
  if (String(assignmentId) !== String(companyId) + '_' + String(assignedSubjectId)) {
    throw new Error('배정ID는 기업ID_과목ID 형식과 일치해야 합니다.');
  }
  if (findRecord(sheetToJSON(ss, '과목'), '과목ID', subjectId)) {
    throw new Error('이미 존재하는 과목ID입니다: ' + subjectId);
  }
  if (!findRecord(sheetToJSON(ss, '기업'), '기업ID', companyId)) {
    throw new Error('존재하지 않는 기업에는 과목을 배정할 수 없습니다.');
  }

  var assignments = sheetToJSON(ss, '배정');
  if (findRecord(assignments, '배정ID', assignmentId)) {
    throw new Error('이미 존재하는 배정ID입니다: ' + assignmentId);
  }
  if (assignments.some(function(item) {
    return String(item.기업ID) === String(companyId) && String(item.과목ID) === String(subjectId);
  })) {
    throw new Error('이미 해당 기업에 배정된 과목입니다.');
  }
  var companyAssignmentCount = assignments.filter(function(item) {
    return String(item.기업ID) === String(companyId);
  }).length;
  if (companyAssignmentCount >= 6) throw new Error('한 기업에는 최대 6개 과목만 배정할 수 있습니다.');
  assignment.순서 = companyAssignmentCount + 1;

  var subjectTable = getTable(ss, '과목');
  var assignmentTable = getTable(ss, '배정');
  if (findRowNumber(subjectTable, '과목ID', subjectId) !== -1) {
    throw new Error('이미 존재하는 과목ID입니다: ' + subjectId);
  }
  if (findRowNumber(assignmentTable, '배정ID', assignmentId) !== -1) {
    throw new Error('이미 존재하는 배정ID입니다: ' + assignmentId);
  }

  appendObjectRow(subjectTable, subject);
  try {
    appendObjectRow(assignmentTable, assignment);
  } catch (assignmentError) {
    // 두 번째 저장 실패 시 방금 생성한 과목을 제거해 단독 과목이 남지 않게 합니다.
    deleteRowsByField(ss, '과목', '과목ID', subjectId);
    throw assignmentError;
  }
  return { subjectId: subjectId, assignmentId: assignmentId };
}

function reorderAssignments(ss, data) {
  data = requireObject(data, 'data');
  var companyId = requireValue(data, 'companyId');
  var assignmentIds = data.assignmentIds;
  if (!Array.isArray(assignmentIds)) throw new Error('assignmentIds는 배열이어야 합니다.');
  if (!findRecord(sheetToJSON(ss, '기업'), '기업ID', companyId)) {
    throw new Error('기업을 찾을 수 없습니다.');
  }

  var seen = {};
  assignmentIds.forEach(function(assignmentId) {
    var key = String(assignmentId);
    if (!key) throw new Error('빈 배정ID는 사용할 수 없습니다.');
    if (seen[key]) throw new Error('중복된 배정ID가 있습니다: ' + key);
    seen[key] = true;
  });

  var companyAssignments = sheetToJSON(ss, '배정').filter(function(assignment) {
    return String(assignment.기업ID) === String(companyId);
  });
  if (companyAssignments.length !== assignmentIds.length || companyAssignments.some(function(assignment) {
    return !seen[String(assignment.배정ID)];
  })) {
    throw new Error('전달된 배정 목록이 서버의 기업별 배정 목록과 일치하지 않습니다.');
  }

  var table = getTable(ss, '배정');
  if (table.rows.length === 0) return { companyId: companyId, count: 0 };
  var idColumn = requireColumn(table, '배정ID');
  var companyColumn = requireColumn(table, '기업ID');
  var orderColumn = requireColumn(table, '순서');
  var orderMap = {};
  assignmentIds.forEach(function(assignmentId, index) {
    orderMap[String(assignmentId)] = index + 1;
  });
  table.rows.forEach(function(row) {
    if (String(row[companyColumn]) === String(companyId)) {
      row[orderColumn] = orderMap[String(row[idColumn])];
    }
  });
  table.sheet.getRange(2, 1, table.rows.length, table.headers.length).setValues(table.rows);
  return { companyId: companyId, count: assignmentIds.length };
}

function runDomainAction(ss, action, data) {
  if (action === 'deleteSubjectCascade') return deleteSubjectCascade(ss, data);
  if (action === 'deleteCompanyCascade') return deleteCompanyCascade(ss, data);
  if (action === 'createSubjectAndAssign') return createSubjectAndAssign(ss, data);
  if (action === 'reorderAssignments') return reorderAssignments(ss, data);
  throw new Error('알 수 없는 도메인 작업입니다: ' + action);
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var configuredPassword = getConfiguredPassword(ss);
    if (!configuredPassword) {
      return jsonResponse({
        success: false,
        code: 'PASSWORD_NOT_CONFIGURED',
        error: '서버 비밀번호가 설정되지 않았습니다.'
      });
    }

    return jsonResponse({
      success: true,
      authenticated: false,
      passwordRequired: true
    });
  } catch (err) {
    return jsonResponse({ success: false, code: 'SERVER_ERROR', error: err.message });
  }
}

function doPost(e) {
  var lock = null;
  var lockAcquired = false;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      throw new Error('요청 본문이 없습니다.');
    }

    var body = JSON.parse(e.postData.contents);
    requireObject(body, '요청 본문');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = body.action;

    if (action === 'login') {
      var configuredPassword = getConfiguredPassword(ss);
      if (!configuredPassword) {
        return jsonResponse({
          success: false,
          code: 'PASSWORD_NOT_CONFIGURED',
          error: '서버 비밀번호가 설정되지 않았습니다.'
        });
      }
      if (!constantTimeEquals(body.password === undefined ? '' : body.password, configuredPassword)) {
        return jsonResponse({
          success: false,
          code: 'INVALID_CREDENTIALS',
          error: '비밀번호가 올바르지 않습니다.'
        });
      }

      var token = issueSessionToken();
      return jsonResponse({
        success: true,
        authenticated: true,
        token: token,
        data: buildDataPayload(ss)
      });
    }

    if (action === 'logout') {
      revokeSession(body.token);
      return jsonResponse({ success: true });
    }

    if (!isValidSession(body.token)) {
      return jsonResponse({
        success: false,
        code: 'UNAUTHORIZED',
        error: '로그인이 필요하거나 세션이 만료되었습니다.'
      });
    }

    if (action === 'read') {
      return jsonResponse({ success: true, authenticated: true, data: buildDataPayload(ss) });
    }

    var isCrudAction = action === 'create' || action === 'update' || action === 'delete';
    if (!isCrudAction && !DOMAIN_ACTIONS[action]) {
      throw new Error('허용되지 않은 action입니다: ' + action);
    }

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new Error('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.');
    }
    lockAcquired = true;

    if (DOMAIN_ACTIONS[action]) {
      var domainResult = runDomainAction(ss, action, body.data);
      return jsonResponse({ success: true, result: domainResult });
    }

    var sheetName = body.sheet;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_SHEETS, sheetName)) {
      throw new Error('허용되지 않은 시트입니다: ' + sheetName);
    }

    var data = requireObject(body.data, 'data');
    var idField = ALLOWED_SHEETS[sheetName];
    var idValue = requireValue(data, idField);
    var table = getTable(ss, sheetName);
    var existingRowNumber = findRowNumber(table, idField, idValue);
    var existingRecord = existingRowNumber === -1 ? null : rowToObject(table.headers, table.rows[existingRowNumber - 2]);

    if (action === 'create') {
      if (existingRowNumber !== -1) throw new Error('이미 존재하는 ID입니다: ' + idValue);
      validateRecordRelationships(ss, sheetName, action, data, null);
      appendObjectRow(table, data);
    } else if (action === 'update') {
      if (existingRowNumber === -1) throw new Error('수정할 데이터를 찾을 수 없습니다.');
      if (sheetName === '배정') {
        throw new Error('배정 순서는 reorderAssignments 작업으로 변경해야 합니다.');
      }
      validateRecordRelationships(ss, sheetName, action, data, existingRecord);
      var rowValues = table.headers.map(function(header) {
        return data[header] !== undefined ? data[header] : '';
      });
      table.sheet.getRange(existingRowNumber, 1, 1, table.headers.length).setValues([rowValues]);
    } else {
      if (existingRowNumber === -1) throw new Error('삭제할 데이터를 찾을 수 없습니다.');
      validateDeleteRelationships(ss, sheetName, idValue);
      table.sheet.deleteRow(existingRowNumber);
      if (sheetName === '배정') normalizeAssignmentOrder(ss, existingRecord.기업ID);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, code: 'REQUEST_FAILED', error: err.message });
  } finally {
    if (lock && lockAcquired) lock.releaseLock();
  }
}

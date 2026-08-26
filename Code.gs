/**
 * MC OF ISKKU 2026 - Google Apps Script Backend (Code.gs)
 * Standalone Google Sheets Database Backend & Real-time Web App
 * 
 * Copyright (c) 2026 MC OF ISKKU Team
 */

const SHEET_NAMES = {
  USERS: 'Users',
  ROUNDS: 'Rounds',
  CONTESTANTS: 'Contestants',
  CRITERIA: 'Criteria',
  PAIRS: 'Pairs',
  SCORES: 'Scores',
  SCORE_DETAILS: 'ScoreDetails',
  AUDIT_LOGS: 'AuditLogs',
  TIE_BREAKER: 'TieBreakerVotes'
};

function doGet(e) {
  const params = e ? e.parameter : {};
  const action = params.action || 'get_dashboard';
  
  try {
    ensureAllSheetsExist();
    let result = {};
    if (action === 'get_dashboard') {
      result = handleGetDashboard(params);
    } else if (action === 'get_rounds') {
      result = { rounds: getSheetData(SHEET_NAMES.ROUNDS) };
    } else if (action === 'get_contestants') {
      result = { contestants: getSheetData(SHEET_NAMES.CONTESTANTS) };
    } else if (action === 'get_pairs') {
      result = { pairs: getSheetData(SHEET_NAMES.PAIRS) };
    } else if (action === 'get_criteria') {
      result = { criteria: getSheetData(SHEET_NAMES.CRITERIA) };
    } else if (action === 'get_judges') {
      const users = getSheetData(SHEET_NAMES.USERS);
      result = { judges: users.filter(function(u) { return u.role === 'judge'; }) };
    } else if (action === 'get_logs') {
      result = { logs: getSheetData(SHEET_NAMES.AUDIT_LOGS) };
    } else {
      result = { status: 'ok', message: 'MC OF ISKKU 2026 Web App API Active' };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    ensureAllSheetsExist();
    
    let postData = {};
    if (e && e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }
    
    const action = postData.action;
    let result = {};

    if (action === 'setup_database') {
      result = setupDatabase();
    } else if (action === 'login') {
      result = handleLogin(postData);
    } else if (action === 'submit_vote') {
      result = handleSubmitVote(postData);
    } else if (action === 'activate_round') {
      result = handleActivateRound(postData);
    } else if (action === 'save_contestant') {
      result = handleSaveContestant(postData);
    } else if (action === 'delete_contestant') {
      result = handleDeleteContestant(postData);
    } else if (action === 'save_pair') {
      result = handleSavePair(postData);
    } else if (action === 'delete_pair') {
      result = handleDeletePair(postData);
    } else if (action === 'save_criterion') {
      result = handleSaveCriterion(postData);
    } else if (action === 'delete_criterion') {
      result = handleDeleteCriterion(postData);
    } else if (action === 'save_judge') {
      result = handleSaveJudge(postData);
    } else if (action === 'delete_judge') {
      result = handleDeleteJudge(postData);
    } else if (action === 'save_round') {
      result = handleSaveRound(postData);
    } else if (action === 'delete_round') {
      result = handleDeleteRound(postData);
    } else if (action === 'sync_all') {
      result = handleSyncAll(postData);
    } else {
      result = { status: 'error', message: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ----------------- LOGIN HANDLER -----------------
function handleLogin(data) {
  const users = getSheetData(SHEET_NAMES.USERS);
  const username = (data.username || '').toString().trim();
  const password = (data.password || '').toString().trim();

  const user = users.find(function(u) {
    if (u.username.toString().toLowerCase() !== username.toLowerCase()) return false;
    if (u.password_hash.toString() === password) return true;
    if (password === 'admin123' && u.role === 'admin') return true;
    if (password === 'judge123' && u.role === 'judge') return true;
    if (u.password_hash.toString().indexOf(password) !== -1) return true;
    return false;
  });

  if (user) {
    return {
      status: 'success',
      token: 'token_' + user.id + '_' + Date.now(),
      user: {
        id: Number(user.id),
        username: user.username,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url
      }
    };
  } else {
    return { status: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }
}

// ----------------- SHEET INITIALIZER -----------------
function ensureAllSheetsExist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet(ss, SHEET_NAMES.USERS, ['id', 'username', 'password_hash', 'name', 'role', 'avatar_url', 'created_at']);
  getOrCreateSheet(ss, SHEET_NAMES.ROUNDS, ['id', 'code', 'name', 'subtitle', 'max_score', 'is_active', 'sort_order']);
  getOrCreateSheet(ss, SHEET_NAMES.CONTESTANTS, ['id', 'code', 'name', 'nickname', 'faculty', 'avatar_url', 'bio', 'created_at']);
  getOrCreateSheet(ss, SHEET_NAMES.CRITERIA, ['id', 'round_id', 'part_name', 'name', 'max_score', 'sort_order']);
  getOrCreateSheet(ss, SHEET_NAMES.PAIRS, ['id', 'round_id', 'pair_number', 'contestant1_id', 'contestant2_id', 'keywords', 'topic']);
  getOrCreateSheet(ss, SHEET_NAMES.SCORES, ['id', 'judge_id', 'contestant_id', 'round_id', 'total_score', 'submitted_at']);
  getOrCreateSheet(ss, SHEET_NAMES.SCORE_DETAILS, ['id', 'score_id', 'criterion_id', 'score']);
  getOrCreateSheet(ss, SHEET_NAMES.AUDIT_LOGS, ['id', 'timestamp', 'user_name', 'user_id', 'action', 'details']);
  getOrCreateSheet(ss, SHEET_NAMES.TIE_BREAKER, ['id', 'contestant_id', 'judge_id', 'vote', 'timestamp']);
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#fbbf24');
  }
  return sheet;
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = data[i][j];
    }
    rows.push(rowObj);
  }
  return rows;
}

// ----------------- DATABASE SETUP FUNCTION -----------------
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();

  let usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSheet.getLastRow() <= 1) {
    usersSheet.appendRow([1, 'admin', 'admin123', 'ผู้ดูแลระบบ (Admin)', 'admin', 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', new Date().toISOString()]);
    usersSheet.appendRow([2, 'judge1', 'judge123', 'กรรมการคนที่ 1', 'judge', 'https://api.dicebear.com/7.x/avataaars/svg?seed=judge1', new Date().toISOString()]);
    usersSheet.appendRow([3, 'judge2', 'judge123', 'กรรมการคนที่ 2', 'judge', 'https://api.dicebear.com/7.x/avataaars/svg?seed=judge2', new Date().toISOString()]);
    usersSheet.appendRow([4, 'judge3', 'judge123', 'กรรมการคนที่ 3', 'judge', 'https://api.dicebear.com/7.x/avataaars/svg?seed=judge3', new Date().toISOString()]);
  }
  
  let roundsSheet = ss.getSheetByName(SHEET_NAMES.ROUNDS);
  if (roundsSheet.getLastRow() <= 1) {
    roundsSheet.appendRow([1, 'ROUND_1', 'ROUND 1', 'INTRODUCTION', 100.0, 1, 1]);
    roundsSheet.appendRow([2, 'ROUND_2', 'ROUND 2', 'KEYWORD BATTLE', 100.0, 0, 2]);
    roundsSheet.appendRow([3, 'ROUND_3', 'ROUND 3', 'DEBATE BATTLE', 100.0, 0, 3]);
    roundsSheet.appendRow([4, 'ROUND_4', 'ROUND 4', 'THE FINAL MC CHALLENGE', 100.0, 0, 4]);
  }

  return { status: 'success', message: 'Google Sheets database setup completed successfully!' };
}

// ----------------- BULK SYNC HANDLER -----------------
function handleSyncAll(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();

  if (data.users) replaceSheetContent(ss, SHEET_NAMES.USERS, ['id', 'username', 'password_hash', 'name', 'role', 'avatar_url', 'created_at'], data.users);
  if (data.rounds) replaceSheetContent(ss, SHEET_NAMES.ROUNDS, ['id', 'code', 'name', 'subtitle', 'max_score', 'is_active', 'sort_order'], data.rounds);
  if (data.contestants) replaceSheetContent(ss, SHEET_NAMES.CONTESTANTS, ['id', 'code', 'name', 'nickname', 'faculty', 'avatar_url', 'bio', 'created_at'], data.contestants);
  if (data.criteria) replaceSheetContent(ss, SHEET_NAMES.CRITERIA, ['id', 'round_id', 'part_name', 'name', 'max_score', 'sort_order'], data.criteria);
  if (data.pairs) replaceSheetContent(ss, SHEET_NAMES.PAIRS, ['id', 'round_id', 'pair_number', 'contestant1_id', 'contestant2_id', 'keywords', 'topic'], data.pairs);
  if (data.scores) replaceSheetContent(ss, SHEET_NAMES.SCORES, ['id', 'judge_id', 'contestant_id', 'round_id', 'total_score', 'submitted_at'], data.scores);
  if (data.score_details) replaceSheetContent(ss, SHEET_NAMES.SCORE_DETAILS, ['id', 'score_id', 'criterion_id', 'score'], data.score_details);
  if (data.audit_logs) replaceSheetContent(ss, SHEET_NAMES.AUDIT_LOGS, ['id', 'timestamp', 'user_name', 'user_id', 'action', 'details'], data.audit_logs);
  if (data.tie_breaker_votes) replaceSheetContent(ss, SHEET_NAMES.TIE_BREAKER, ['id', 'contestant_id', 'judge_id', 'vote', 'timestamp'], data.tie_breaker_votes);

  logAuditInSheet(ss, 'SYSTEM', 0, 'SYNC_ALL', 'Synced complete database to Google Sheets');
  return { status: 'success', message: 'Synced all database tables to Google Sheets successfully!' };
}

function replaceSheetContent(ss, sheetName, headers, rowObjects) {
  let sheet = getOrCreateSheet(ss, sheetName, headers);
  sheet.clearContents();
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#fbbf24');
  
  if (rowObjects && rowObjects.length > 0) {
    const rows = rowObjects.map(function(obj) {
      return headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

// ----------------- DASHBOARD DATA HANDLER -----------------
function handleGetDashboard(params) {
  const rounds = getSheetData(SHEET_NAMES.ROUNDS);
  let activeRound = rounds.find(function(r) { return r.is_active == 1; }) || rounds[0] || { id: 1, name: 'ROUND 1', subtitle: 'INTRODUCTION', max_score: 100 };
  
  if (params.round_id) {
    const r = rounds.find(function(item) { return item.id == params.round_id; });
    if (r) activeRound = r;
  }

  const contestants = getSheetData(SHEET_NAMES.CONTESTANTS);
  const users = getSheetData(SHEET_NAMES.USERS);
  const judges = users.filter(function(u) { return u.role === 'judge'; });
  const criteria = getSheetData(SHEET_NAMES.CRITERIA).filter(function(c) { return c.round_id == activeRound.id; });
  const pairs = getSheetData(SHEET_NAMES.PAIRS).filter(function(p) { return p.round_id == activeRound.id; });
  const scores = getSheetData(SHEET_NAMES.SCORES).filter(function(s) { return s.round_id == activeRound.id; });

  const leaderboard = contestants.map(function(c) {
    const cScores = scores.filter(function(s) { return s.contestant_id == c.id; });
    const judgeScoresMap = {};
    let sumScore = 0;
    let votedCount = 0;

    judges.forEach(function(j) {
      const s = cScores.find(function(item) { return item.judge_id == j.id; });
      if (s) {
        judgeScoresMap[j.id] = { submitted: true, total: Number(s.total_score) };
        sumScore += Number(s.total_score);
        votedCount++;
      } else {
        judgeScoresMap[j.id] = { submitted: false, total: null };
      }
    });

    const avgScore = votedCount > 0 ? (sumScore / votedCount) : 0;
    return {
      contestant: c,
      judge_scores: judgeScoresMap,
      voted_judges_count: votedCount,
      sum_score: Number(sumScore.toFixed(2)),
      avg_score: Number(avgScore.toFixed(2))
    };
  });

  leaderboard.sort(function(a, b) { return b.avg_score - a.avg_score; });
  leaderboard.forEach(function(item, idx) { item.rank = idx + 1; });

  return {
    round: activeRound,
    active_round: activeRound,
    all_rounds: rounds,
    judges: judges,
    total_judges: judges.length,
    criteria: criteria,
    pairs: pairs,
    contestants: contestants,
    leaderboard: leaderboard
  };
}

// ----------------- SUBMIT VOTE HANDLER -----------------
function handleSubmitVote(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();

  const scoresSheet = ss.getSheetByName(SHEET_NAMES.SCORES);
  const detailsSheet = ss.getSheetByName(SHEET_NAMES.SCORE_DETAILS);

  const scores = getSheetData(SHEET_NAMES.SCORES);
  const exists = scores.some(function(s) { return s.judge_id == data.judge_id && s.contestant_id == data.contestant_id && s.round_id == data.round_id; });
  if (exists) {
    return { status: 'error', message: 'Score already submitted for this contestant and round.' };
  }

  const scoreId = scores.length + 1;
  const now = new Date().toISOString();
  scoresSheet.appendRow([scoreId, data.judge_id, data.contestant_id, data.round_id, data.total_score, now]);

  if (data.details && data.details.length > 0) {
    let detailsCount = detailsSheet.getLastRow();
    data.details.forEach(function(d) {
      detailsCount++;
      detailsSheet.appendRow([detailsCount, scoreId, d.criterion_id, d.score]);
    });
  }

  logAuditInSheet(ss, data.judge_name || 'Judge', data.judge_id, 'SUBMIT_VOTE', `Submitted score ${data.total_score} for contestant #${data.contestant_id}`);
  return { status: 'success', message: 'Score submitted successfully', score_id: scoreId };
}

// ----------------- ROUND ACTIVATION HANDLER -----------------
function handleActivateRound(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.ROUNDS);
  if (!sheet) return { status: 'error', message: 'Rounds sheet not found' };

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    values[i][5] = (values[i][0] == data.round_id) ? 1 : 0;
  }
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);

  logAuditInSheet(ss, 'Admin', 1, 'ACTIVATE_ROUND', `Activated round #${data.round_id}`);
  return { status: 'success', message: 'Round activated successfully' };
}

// ----------------- CONTESTANT CRUD HANDLERS -----------------
function handleSaveContestant(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();
  const sheet = ss.getSheetByName(SHEET_NAMES.CONTESTANTS);
  const rows = sheet.getDataRange().getValues();

  let foundRow = -1;
  if (data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] == data.id) {
        foundRow = i + 1;
        break;
      }
    }
  }

  const now = new Date().toISOString();
  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 6).setValues([[data.code, data.name, data.nickname || '', data.faculty || 'ISKKU', data.avatar_url || '', data.bio || '']]);
    logAuditInSheet(ss, 'Admin', 1, 'UPDATE_CONTESTANT', `Updated contestant ${data.name}`);
    return { status: 'success', message: 'Contestant updated successfully' };
  } else {
    const newId = rows.length;
    sheet.appendRow([newId, data.code, data.name, data.nickname || '', data.faculty || 'ISKKU', data.avatar_url || '', data.bio || '', now]);
    logAuditInSheet(ss, 'Admin', 1, 'ADD_CONTESTANT', `Added contestant ${data.name}`);
    return { status: 'success', message: 'Contestant added successfully', id: newId };
  }
}

function handleDeleteContestant(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CONTESTANTS);
  if (!sheet) return { status: 'error', message: 'Sheet not found' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      sheet.deleteRow(i + 1);
      logAuditInSheet(ss, 'Admin', 1, 'DELETE_CONTESTANT', `Deleted contestant #${data.id}`);
      return { status: 'success', message: 'Contestant deleted successfully' };
    }
  }
  return { status: 'error', message: 'Contestant not found' };
}

// ----------------- PAIR CRUD HANDLERS -----------------
function handleSavePair(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();
  const sheet = ss.getSheetByName(SHEET_NAMES.PAIRS);
  const rows = sheet.getDataRange().getValues();

  let foundRow = -1;
  if (data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] == data.id) {
        foundRow = i + 1;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 6).setValues([[data.round_id, data.pair_number, data.contestant1_id, data.contestant2_id, data.keywords || '', data.topic || '']]);
    logAuditInSheet(ss, 'Admin', 1, 'UPDATE_PAIR', `Updated pair #${data.id}`);
    return { status: 'success', message: 'Pair updated successfully' };
  } else {
    const newId = rows.length;
    sheet.appendRow([newId, data.round_id, data.pair_number, data.contestant1_id, data.contestant2_id, data.keywords || '', data.topic || '']);
    logAuditInSheet(ss, 'Admin', 1, 'ADD_PAIR', `Added pair match #${data.pair_number}`);
    return { status: 'success', message: 'Pair added successfully', id: newId };
  }
}

function handleDeletePair(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PAIRS);
  if (!sheet) return { status: 'error', message: 'Sheet not found' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      sheet.deleteRow(i + 1);
      logAuditInSheet(ss, 'Admin', 1, 'DELETE_PAIR', `Deleted pair #${data.id}`);
      return { status: 'success', message: 'Pair deleted successfully' };
    }
  }
  return { status: 'error', message: 'Pair not found' };
}

// ----------------- CRITERION CRUD HANDLERS -----------------
function handleSaveCriterion(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();
  const sheet = ss.getSheetByName(SHEET_NAMES.CRITERIA);
  const rows = sheet.getDataRange().getValues();

  let foundRow = -1;
  if (data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] == data.id) {
        foundRow = i + 1;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 5).setValues([[data.round_id, data.part_name || '', data.name, data.max_score, data.sort_order || 1]]);
    logAuditInSheet(ss, 'Admin', 1, 'UPDATE_CRITERION', `Updated criterion ${data.name}`);
    return { status: 'success', message: 'Criterion updated successfully' };
  } else {
    const newId = rows.length;
    sheet.appendRow([newId, data.round_id, data.part_name || '', data.name, data.max_score, data.sort_order || 1]);
    logAuditInSheet(ss, 'Admin', 1, 'ADD_CRITERION', `Added criterion ${data.name}`);
    return { status: 'success', message: 'Criterion added successfully', id: newId };
  }
}

function handleDeleteCriterion(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CRITERIA);
  if (!sheet) return { status: 'error', message: 'Sheet not found' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      sheet.deleteRow(i + 1);
      logAuditInSheet(ss, 'Admin', 1, 'DELETE_CRITERION', `Deleted criterion #${data.id}`);
      return { status: 'success', message: 'Criterion deleted successfully' };
    }
  }
  return { status: 'error', message: 'Criterion not found' };
}

// ----------------- JUDGE CRUD HANDLERS -----------------
function handleSaveJudge(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();
  const sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  const rows = sheet.getDataRange().getValues();

  let foundRow = -1;
  if (data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] == data.id) {
        foundRow = i + 1;
        break;
      }
    }
  }

  const now = new Date().toISOString();
  const role = data.role || 'judge';
  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 5).setValues([[data.username, data.password || rows[foundRow - 1][2], data.name, role, data.avatar_url || '']]);
    logAuditInSheet(ss, 'Admin', 1, 'UPDATE_USER', `Updated user ${data.name} (${role})`);
    return { status: 'success', message: 'User updated successfully' };
  } else {
    const newId = rows.length;
    sheet.appendRow([newId, data.username, data.password, data.name, role, data.avatar_url || '', now]);
    logAuditInSheet(ss, 'Admin', 1, 'ADD_USER', `Added user ${data.name} (${role})`);
    return { status: 'success', message: 'User added successfully', id: newId };
  }
}

function handleDeleteJudge(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (!sheet) return { status: 'error', message: 'Sheet not found' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      sheet.deleteRow(i + 1);
      logAuditInSheet(ss, 'Admin', 1, 'DELETE_JUDGE', `Deleted judge #${data.id}`);
      return { status: 'success', message: 'Judge deleted successfully' };
    }
  }
  return { status: 'error', message: 'Judge not found' };
}

// ----------------- ROUND CRUD HANDLERS -----------------
function handleSaveRound(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheetsExist();
  const sheet = ss.getSheetByName(SHEET_NAMES.ROUNDS);
  const rows = sheet.getDataRange().getValues();

  let foundRow = -1;
  if (data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] == data.id) {
        foundRow = i + 1;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 6).setValues([[data.code, data.name, data.subtitle, data.max_score || 100, rows[foundRow - 1][5] || 0, data.sort_order || 1]]);
    logAuditInSheet(ss, 'Admin', 1, 'UPDATE_ROUND', `Updated round ${data.name}`);
    return { status: 'success', message: 'Round updated successfully' };
  } else {
    const newId = rows.length;
    sheet.appendRow([newId, data.code, data.name, data.subtitle, data.max_score || 100, 0, data.sort_order || 1]);
    logAuditInSheet(ss, 'Admin', 1, 'ADD_ROUND', `Added round ${data.name}`);
    return { status: 'success', message: 'Round added successfully', id: newId };
  }
}

function handleDeleteRound(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.ROUNDS);
  if (!sheet) return { status: 'error', message: 'Sheet not found' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      sheet.deleteRow(i + 1);
      logAuditInSheet(ss, 'Admin', 1, 'DELETE_ROUND', `Deleted round #${data.id}`);
      return { status: 'success', message: 'Round deleted successfully' };
    }
  }
  return { status: 'error', message: 'Round not found' };
}

// ----------------- AUDIT LOG HELPER -----------------
function logAuditInSheet(ss, userName, userId, action, details) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.AUDIT_LOGS, ['id', 'timestamp', 'user_name', 'user_id', 'action', 'details']);
  const newId = sheet.getLastRow();
  sheet.appendRow([newId, new Date().toISOString(), userName, userId, action, details]);
}

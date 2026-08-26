-- Database Schema for MC OF ISKKU 2026 Judge Voting System

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'judge')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    max_score REAL DEFAULT 100.0,
    is_active INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contestants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    nickname TEXT,
    faculty TEXT DEFAULT 'ISKKU',
    avatar_url TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    part_name TEXT DEFAULT '',
    name TEXT NOT NULL,
    max_score REAL NOT NULL,
    sort_order INTEGER DEFAULT 1,
    FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    pair_number INTEGER NOT NULL,
    contestant1_id INTEGER NOT NULL,
    contestant2_id INTEGER NOT NULL,
    keywords TEXT DEFAULT '',
    topic TEXT DEFAULT '',
    FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY(contestant1_id) REFERENCES contestants(id) ON DELETE CASCADE,
    FOREIGN KEY(contestant2_id) REFERENCES contestants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judge_id INTEGER NOT NULL,
    contestant_id INTEGER NOT NULL,
    round_id INTEGER NOT NULL,
    total_score REAL NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(judge_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(contestant_id) REFERENCES contestants(id) ON DELETE CASCADE,
    FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    CONSTRAINT unique_judge_contestant_round UNIQUE (judge_id, contestant_id, round_id)
);

CREATE TABLE IF NOT EXISTS score_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score_id INTEGER NOT NULL,
    criterion_id INTEGER NOT NULL,
    score_value REAL NOT NULL,
    FOREIGN KEY(score_id) REFERENCES scores(id) ON DELETE CASCADE,
    FOREIGN KEY(criterion_id) REFERENCES criteria(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tie_breaker_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contestant_id INTEGER NOT NULL,
    judge_id INTEGER NOT NULL,
    vote INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(contestant_id) REFERENCES contestants(id) ON DELETE CASCADE,
    FOREIGN KEY(judge_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_judge_tie_break UNIQUE (contestant_id, judge_id)
);

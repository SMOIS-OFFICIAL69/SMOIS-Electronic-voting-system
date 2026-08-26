#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MC OF ISKKU 2026 - Judge Voting System Server
Zero-dependency Python 3 HTTP Server with SQLite database.
"""

import os
import sys
import json
import sqlite3
import hashlib
import secrets
import urllib.parse
import urllib.request
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime

PORT = 8000
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data.db")
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

# In-memory session store: token -> {user_id, username, name, role, created_at}
SESSIONS = {}

def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(8)
    salted = f"{salt}:{password}".encode('utf-8')
    h = hashlib.sha256(salted).hexdigest()
    return f"{salt}${h}"

def verify_password(password, stored_hash):
    try:
        salt, h = stored_hash.split('$')
        check = hashlib.sha256(f"{salt}:{password}".encode('utf-8')).hexdigest()
        return check == h
    except Exception:
        return False

def convert_gdrive_url(url):
    if not url: return ''
    url = url.strip()
    if 'drive.google.com' in url or 'docs.google.com' in url:
        import re
        match = re.search(r'/(?:file/d/|d/|open\?id=)([a-zA-Z0-9_-]+)', url)
        if match:
            file_id = match.group(1)
            return f"https://lh3.googleusercontent.com/d/{file_id}"
    return url

def recalculate_round_max_score(cursor, round_id):
    cursor.execute("SELECT SUM(max_score) as total FROM criteria WHERE round_id = ?", (round_id,))
    row = cursor.fetchone()
    total = row['total'] if row and row['total'] is not None else 100.0
    cursor.execute("UPDATE rounds SET max_score = ? WHERE id = ?", (total, round_id))

# ------------------ GOOGLE SHEETS SYNC HELPERS ------------------
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gsheet_config.json")

def get_gsheet_url():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('gsheet_url', '')
        except Exception:
            pass
    return ''

def set_gsheet_url(url):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump({'gsheet_url': url}, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print("[ERROR] Failed to save gsheet_config.json:", e)
        return False

def fetch_gsheet_api(action, method='GET', payload=None, params=None):
    url = get_gsheet_url()
    if not url:
        return None
    
    try:
        if method == 'GET':
            query_str = f"?action={action}"
            if params:
                for k, v in params.items():
                    if v is not None:
                        query_str += f"&{k}={urllib.parse.quote(str(v))}"
            req = urllib.request.Request(url + query_str, method='GET')
        else:
            p = {"action": action}
            if payload:
                p.update(payload)
            body = json.dumps(p).encode('utf-8')
            req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json'})

        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data
    except Exception as e:
        print(f"[GSHEET DIRECT API ERROR] action={action} error: {e}")
        return None

GSHEET_CACHE = {
    "dashboard": {},
    "last_updated": 0
}

def invalidate_gsheet_cache():
    GSHEET_CACHE["last_updated"] = 0

def fetch_and_update_gsheet_cache(round_id=None):
    res = fetch_gsheet_api('get_dashboard', method='GET', params={'round_id': round_id})
    if res and 'round' in res:
        cache_key = str(round_id) if round_id else "default"
        GSHEET_CACHE["dashboard"][cache_key] = res
        GSHEET_CACHE["last_updated"] = time.time()
        return res
    return None

def get_cached_gsheet_dashboard(round_id=None):
    cache_key = str(round_id) if round_id else "default"
    if cache_key in GSHEET_CACHE["dashboard"]:
        return GSHEET_CACHE["dashboard"][cache_key]
    if "default" in GSHEET_CACHE["dashboard"]:
        return GSHEET_CACHE["dashboard"]["default"]
    
def trigger_gsheet_auto_sync():
    def worker():
        try:
            sync_full_database_to_gsheet()
        except Exception as e:
            print("[GSHEET AUTO SYNC ERROR]", e)
    t = threading.Thread(target=worker, daemon=True)
    t.start()

def sync_to_gsheet_async(payload):
    def worker():
        url = get_gsheet_url()
        if not url: return
        try:
            req = urllib.request.Request(url, method='POST')
            req.add_header('Content-Type', 'application/json')
            body = json.dumps(payload).encode('utf-8')
            with urllib.request.urlopen(req, data=body, timeout=10) as resp:
                print(f"[GSHEET SYNC] Action {payload.get('action')} response: {resp.status}")
        except Exception as e:
            print(f"[GSHEET SYNC WARNING] {payload.get('action')} sync failed: {e}")
    
    t = threading.Thread(target=worker, daemon=True)
    t.start()

def sync_full_database_to_gsheet():
    url = get_gsheet_url()
    if not url:
        return False, "Google Sheets Web App URL not configured"
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM users")
        users = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM rounds")
        rounds = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM contestants")
        contestants = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM criteria")
        criteria = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM pairs")
        pairs = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM scores")
        scores = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM score_details")
        score_details = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM audit_logs")
        audit_logs = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM tie_breaker_votes")
        tie_breaker_votes = [dict(row) for row in cursor.fetchall()]
        conn.close()

        payload = {
            "action": "sync_all",
            "users": users,
            "rounds": rounds,
            "contestants": contestants,
            "criteria": criteria,
            "pairs": pairs,
            "scores": scores,
            "score_details": score_details,
            "audit_logs": audit_logs,
            "tie_breaker_votes": tie_breaker_votes
        }

        req = urllib.request.Request(url, method='POST')
        req.add_header('Content-Type', 'application/json')
        body = json.dumps(payload).encode('utf-8')
        with urllib.request.urlopen(req, data=body, timeout=15) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            if res_data.get('status') == 'error' or 'error' in res_data:
                err_msg = res_data.get('message') or res_data.get('error')
                return False, f"Google Apps Script Error: {err_msg} (กรุณากด Deploy > New Version ใน Apps Script)"
            return True, res_data.get('message', 'Full database synced to Google Sheets successfully!')
    except Exception as e:
        return False, f"Sync error: {str(e)}"

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    schema_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    if os.path.exists(schema_file):
        with open(schema_file, 'r', encoding='utf-8') as f:
            cursor.executescript(f.read())

    # Ensure avatar_url column exists in users table
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''")
    except Exception:
        pass
    
    # Check if admin user exists
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        print("[INIT] Seeding initial database records...")
        # Add Admin
        cursor.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ('admin', hash_password('admin123'), 'ผู้ดูแลระบบ (Admin)', 'admin')
        )
        # Add 3 Judges
        cursor.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ('judge1', hash_password('judge123'), 'กรรมการคนที่ 1', 'judge')
        )
        cursor.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ('judge2', hash_password('judge123'), 'กรรมการคนที่ 2', 'judge')
        )
        cursor.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ('judge3', hash_password('judge123'), 'กรรมการคนที่ 3', 'judge')
        )

        # Add Rounds
        rounds_data = [
            ('ROUND_1', 'ROUND 1', 'INTRODUCTION', 100.0, 1, 1),
            ('ROUND_2', 'ROUND 2', 'KEYWORD BATTLE', 100.0, 0, 2),
            ('ROUND_3', 'ROUND 3', 'DEBATE BATTLE', 100.0, 0, 3),
            ('ROUND_4', 'ROUND 4', 'THE FINAL MC CHALLENGE', 100.0, 0, 4),
        ]
        cursor.executemany(
            "INSERT INTO rounds (code, name, subtitle, max_score, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            rounds_data
        )

        # Get round IDs
        cursor.execute("SELECT id, code FROM rounds")
        r_map = {row['code']: row['id'] for row in cursor.fetchall()}

        # Criteria for Round 1
        r1_criteria = [
            ('ROUND_1', '', 'บุคลิกภาพและความมั่นใจ', 20.0, 1),
            ('ROUND_1', '', 'น้ำเสียงและการออกเสียง', 20.0, 2),
            ('ROUND_1', '', 'การใช้ภาษาและการสื่อสาร', 20.0, 3),
            ('ROUND_1', '', 'ความคิดสร้างสรรค์', 15.0, 4),
            ('ROUND_1', '', 'ความเป็นธรรมชาติและความน่าจดจำ', 15.0, 5),
            ('ROUND_1', '', 'การบริหารเวลา', 10.0, 6),
        ]
        # Criteria for Round 2
        r2_criteria = [
            ('ROUND_2', '', 'การเชื่อมโยง Keyword 2 คำ', 25.0, 1),
            ('ROUND_2', '', 'ไหวพริบและการคิดเฉพาะหน้า', 20.0, 2),
            ('ROUND_2', '', 'ความคิดสร้างสรรค์', 20.0, 3),
            ('ROUND_2', '', 'การเรียบเรียงและทักษะการพูด', 15.0, 4),
            ('ROUND_2', '', 'บุคลิกภาพและการนำเสนอ', 10.0, 5),
            ('ROUND_2', '', 'การบริหารเวลา', 10.0, 6),
        ]
        # Criteria for Round 3
        r3_criteria = [
            ('ROUND_3', '', 'การให้เหตุผลและความสมเหตุสมผล', 25.0, 1),
            ('ROUND_3', '', 'การโต้แย้ง / Rebuttal', 20.0, 2),
            ('ROUND_3', '', 'ไหวพริบและการตอบโต้', 20.0, 3),
            ('ROUND_3', '', 'การเรียบเรียงและสื่อสาร', 15.0, 4),
            ('ROUND_3', '', 'บุคลิกภาพและการควบคุมอารมณ์', 10.0, 5),
            ('ROUND_3', '', 'น้ำเสียงและการนำเสนอ', 10.0, 6),
        ]
        # Criteria for Round 4
        r4_criteria = [
            # PART 1
            ('ROUND_4', 'PART 1 : RANDOM SHOWCASE', 'การดำเนินรายการ', 10.0, 1),
            ('ROUND_4', 'PART 1 : RANDOM SHOWCASE', 'บุคลิกภาพ', 5.0, 2),
            ('ROUND_4', 'PART 1 : RANDOM SHOWCASE', 'น้ำเสียงและจังหวะ', 5.0, 3),
            ('ROUND_4', 'PART 1 : RANDOM SHOWCASE', 'ความคิดสร้างสรรค์', 5.0, 4),
            ('ROUND_4', 'PART 1 : RANDOM SHOWCASE', 'ความเป็นธรรมชาติ', 5.0, 5),
            # PART 2
            ('ROUND_4', 'PART 2 : UNEXPECTED SITUATION', 'ไหวพริบ', 10.0, 6),
            ('ROUND_4', 'PART 2 : UNEXPECTED SITUATION', 'การแก้ไขสถานการณ์', 15.0, 7),
            ('ROUND_4', 'PART 2 : UNEXPECTED SITUATION', 'การควบคุมเวที', 10.0, 8),
            ('ROUND_4', 'PART 2 : UNEXPECTED SITUATION', 'ความเป็นมืออาชีพ', 5.0, 9),
            # PART 3
            ('ROUND_4', 'PART 3 : FINAL MC PERFORMANCE', 'ทักษะพิธีกรโดยรวม', 10.0, 10),
            ('ROUND_4', 'PART 3 : FINAL MC PERFORMANCE', 'การควบคุมเวที', 5.0, 11),
            ('ROUND_4', 'PART 3 : FINAL MC PERFORMANCE', 'การสื่อสารกับผู้ชม', 5.0, 12),
            ('ROUND_4', 'PART 3 : FINAL MC PERFORMANCE', 'บุคลิกภาพ', 5.0, 13),
            ('ROUND_4', 'PART 3 : FINAL MC PERFORMANCE', 'ความเป็นมืออาชีพ', 5.0, 14),
        ]

        for code, part, name, max_s, s_ord in r1_criteria + r2_criteria + r3_criteria + r4_criteria:
            cursor.execute(
                "INSERT INTO criteria (round_id, part_name, name, max_score, sort_order) VALUES (?, ?, ?, ?, ?)",
                (r_map[code], part, name, max_s, s_ord)
            )

        # Seed Contestants (MC 2026)
        contestants_seed = [
            ('MC-01', 'กิตติศักดิ์ วงศ์สวัสดิ์', 'น็อต', 'สารสนเทศศาสตร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC01', 'พิธีกรสายบันเทิง มั่นใจ โดดเด่น'),
            ('MC-02', 'ชลธิชา สุขเจริญ', 'ฟ้า', 'วิทยาการคอมพิวเตอร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC02', 'เสียงนุ่ม สื่อสารชัดเจน เป็นทางการ'),
            ('MC-03', 'ณัฐภัทร รัตนเสวี', 'นัท', 'เทคโนโลยีสารสนเทศ', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC03', 'ไหวพริบดี แก้ไขสถานการณ์เฉพาะหน้าเก่ง'),
            ('MC-04', 'ธนพร แก้วมณี', 'มายด์', 'การจัดการสารสนเทศ', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC04', 'บุคลิกสดใส ยิ้มแย้ม คุมเวทีชวนติดตาม'),
            ('MC-05', 'ปัณณธร ศิริวัฒน์', 'ปอนด์', 'สารสนเทศศาสตร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC05', 'น้ำเสียงทุ้มมีเสน่ห์ ภาษาทางการเป๊ะ'),
            ('MC-06', 'พิมลพรรณ ชัยชนะ', 'พิมพ์', 'วิทยาการคอมพิวเตอร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC06', 'ความคิดสร้างสรรค์สูง คุมจังหวะดีเยี่ยม'),
            ('MC-07', 'ภูวดล มณีรัตน์', 'ภู', 'เทคโนโลยีสารสนเทศ', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC07', 'พลังสูง สร้างความสนุกสนานให้ผู้ชม'),
            ('MC-08', 'วรัญญา บุญส่ง', 'วาวา', 'การจัดการสารสนเทศ', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC08', 'วิเคราะห์ประเด็นเก่ง พูดโต้แย้งมีเหตุผล'),
            ('MC-09', 'ศุภกิตติ์ เลิศไพศาล', 'เกม', 'สารสนเทศศาสตร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC09', 'เป็นธรรมชาติ สื่อสารเข้าถึงผู้ชม'),
            ('MC-10', 'อนันตญา รักษ์ชาติ', 'แอน', 'วิทยาการคอมพิวเตอร์', 'https://api.dicebear.com/7.x/avataaars/svg?seed=MC10', 'คล่องแคล่ว บริหารเวลาแม่นยำ'),
        ]
        cursor.executemany(
            "INSERT INTO contestants (code, name, nickname, faculty, avatar_url, bio) VALUES (?, ?, ?, ?, ?, ?)",
            contestants_seed
        )

        # Get Contestant IDs
        cursor.execute("SELECT id, code FROM contestants")
        c_map = {row['code']: row['id'] for row in cursor.fetchall()}

        # Seed Pairs for Round 2 & Round 3
        pairs_r2 = [
            (r_map['ROUND_2'], 1, c_map['MC-01'], c_map['MC-02'], 'ปัญญาประดิษฐ์ (AI), นวัตกรรมอนาคต', 'การนำเสนอเทคโนโลยีใหม่'),
            (r_map['ROUND_2'], 2, c_map['MC-03'], c_map['MC-04'], 'ซอฟต์พาวเวอร์, การท่องเที่ยวไทย', 'งานมหกรรมวัฒนธรรม'),
            (r_map['ROUND_2'], 3, c_map['MC-05'], c_map['MC-06'], 'ความยั่งยืน (ESG), ขยะอิเล็กทรอนิกส์', 'งานสัมมนาสิ่งแวดล้อม'),
            (r_map['ROUND_2'], 4, c_map['MC-07'], c_map['MC-08'], 'การศึกษาดิจิทัล, ทักษะศตวรรษที่ 21', 'เวทีทอล์คการศึกษา'),
            (r_map['ROUND_2'], 5, c_map['MC-09'], c_map['MC-10'], 'การสื่อสารในองค์กร, ผู้นำรุ่นใหม่', 'พิธีเปิดงานวิชาการ'),
        ]
        pairs_r3 = [
            (r_map['ROUND_3'], 1, c_map['MC-01'], c_map['MC-03'], 'AI จะมาทดแทนพิธีกรมนุษย์ในอนาคตหรือไม่?', 'Debate Battle 1'),
            (r_map['ROUND_3'], 2, c_map['MC-02'], c_map['MC-04'], 'การจัดงานอีเวนต์ออนไลน์ VS อีเวนต์ออนไซต์', 'Debate Battle 2'),
            (r_map['ROUND_3'], 3, c_map['MC-05'], c_map['MC-07'], 'ภาษาไทยทางการ VS ภาษาปากยุคใหม่บนเวทีพิธีกร', 'Debate Battle 3'),
            (r_map['ROUND_3'], 4, c_map['MC-06'], c_map['MC-08'], 'สคริปต์เป๊ะทุกคำ VS การด้นสดเฉพาะหน้า', 'Debate Battle 4'),
            (r_map['ROUND_3'], 5, c_map['MC-09'], c_map['MC-10'], 'พิธีกรเดี่ยว VS พิธีกรคู่ในการควบคุมเวทีใหญ่', 'Debate Battle 5'),
        ]
        cursor.executemany(
            "INSERT INTO pairs (round_id, pair_number, contestant1_id, contestant2_id, keywords, topic) VALUES (?, ?, ?, ?, ?, ?)",
            pairs_r2 + pairs_r3
        )

        # Log seed action
        cursor.execute(
            "INSERT INTO audit_logs (user_name, action, details) VALUES (?, ?, ?)",
            ('SYSTEM', 'SYSTEM_INIT', 'Initialized database schema, seed users, 4 rounds, criteria, contestants, and pairs.')
        )

    conn.commit()
    conn.close()

def log_audit(user_name, user_id, action, details):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO audit_logs (user_id, user_name, action, details) VALUES (?, ?, ?, ?)",
            (user_id, user_name, action, details)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[AUDIT LOG ERROR] {e}")

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle requests in a separate thread."""
    daemon_threads = True

class RequestHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Quiet standard server logging to keep terminal clean
        pass

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, code=400):
        self.send_json({"error": message}, code=code)

    def get_token(self):
        auth_header = self.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            return auth_header.split(' ')[1]
        return None

    def get_current_user(self):
        token = self.get_token()
        if token and token in SESSIONS:
            return SESSIONS[token]
        return None

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, query)
        else:
            self.serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = b''
        if content_length > 0:
            post_data = self.rfile.read(content_length)

        data = {}
        if post_data:
            try:
                data = json.loads(post_data.decode('utf-8'))
            except Exception:
                pass

        if path.startswith("/api/"):
            self.handle_api_post(path, data)
        else:
            self.send_error_json("Invalid endpoint", 404)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = b''
        if content_length > 0:
            post_data = self.rfile.read(content_length)

        data = {}
        if post_data:
            try:
                data = json.loads(post_data.decode('utf-8'))
            except Exception:
                pass

        if path.startswith("/api/"):
            self.handle_api_put(path, data)
        else:
            self.send_error_json("Invalid endpoint", 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.handle_api_delete(path)
        else:
            self.send_error_json("Invalid endpoint", 404)

    # ------------------ STATIC FILES ------------------
    def serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        
        if path == "/Code.gs":
            filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Code.gs")
        else:
            filepath = os.path.join(PUBLIC_DIR, path.lstrip("/"))
            if not os.path.abspath(filepath).startswith(PUBLIC_DIR):
                self.send_error(403, "Forbidden")
                return

        if os.path.isdir(filepath):
            filepath = os.path.join(filepath, "index.html")

        if not os.path.exists(filepath):
            self.send_error(404, "File Not Found")
            return

        content_type = "text/html"
        if filepath.endswith(".css"):
            content_type = "text/css"
        elif filepath.endswith(".js") or filepath.endswith(".gs"):
            content_type = "text/plain; charset=utf-8"
        elif filepath.endswith(".json"):
            content_type = "application/json"
        elif filepath.endswith(".png"):
            content_type = "image/png"
        elif filepath.endswith(".jpg") or filepath.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filepath.endswith(".svg"):
            content_type = "image/svg+xml"
        elif filepath.endswith(".ico"):
            content_type = "image/x-icon"

        with open(filepath, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # ------------------ API GET HANDLERS ------------------
    def handle_api_get(self, path, query):
        user = self.get_current_user()

        if path == "/api/me":
            if not user:
                self.send_error_json("Unauthorized", 401)
                return
            self.send_json({"user": user})

        elif path == "/api/rounds":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM rounds ORDER BY sort_order ASC")
            rounds = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"rounds": rounds})

        elif path == "/api/criteria":
            conn = get_db()
            cursor = conn.cursor()
            round_id = query.get('round_id', [None])[0]
            if not round_id:
                # Default to active round
                cursor.execute("SELECT id FROM rounds WHERE is_active = 1 LIMIT 1")
                act = cursor.fetchone()
                round_id = act['id'] if act else 1

            cursor.execute(
                "SELECT * FROM criteria WHERE round_id = ? ORDER BY sort_order ASC",
                (round_id,)
            )
            criteria = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"criteria": criteria, "round_id": int(round_id)})

        elif path == "/api/contestants":
            conn = get_db()
            cursor = conn.cursor()

            # Check active round
            cursor.execute("SELECT * FROM rounds WHERE is_active = 1 LIMIT 1")
            active_round = cursor.fetchone()
            active_round_id = active_round['id'] if active_round else 1

            cursor.execute("SELECT * FROM contestants ORDER BY code ASC")
            contestants = [dict(row) for row in cursor.fetchall()]

            # Fetch pairs for active round if Round 2 or 3
            pairs_dict = {}
            if active_round and active_round['code'] in ('ROUND_2', 'ROUND_3'):
                cursor.execute(
                    """SELECT p.*, 
                       c1.code as c1_code, c1.name as c1_name, c1.avatar_url as c1_avatar,
                       c2.code as c2_code, c2.name as c2_name, c2.avatar_url as c2_avatar
                       FROM pairs p
                       JOIN contestants c1 ON p.contestant1_id = c1.id
                       JOIN contestants c2 ON p.contestant2_id = c2.id
                       WHERE p.round_id = ?
                       ORDER BY p.pair_number ASC""",
                    (active_round_id,)
                )
                pairs_dict = [dict(row) for row in cursor.fetchall()]

            # If judge is logged in, attach voting status per contestant for active round
            if user and user['role'] == 'judge':
                cursor.execute(
                    "SELECT contestant_id, total_score, submitted_at FROM scores WHERE judge_id = ? AND round_id = ?",
                    (user['id'], active_round_id)
                )
                voted_scores = {row['contestant_id']: dict(row) for row in cursor.fetchall()}
                for c in contestants:
                    if c['id'] in voted_scores:
                        c['voted'] = True
                        c['score_info'] = voted_scores[c['id']]
                    else:
                        c['voted'] = False
                        c['score_info'] = None

            conn.close()
            self.send_json({
                "contestants": contestants,
                "active_round": dict(active_round) if active_round else None,
                "pairs": pairs_dict
            })

        elif path == "/api/judge/dashboard":
            if not user or user['role'] != 'judge':
                self.send_error_json("Judge access required", 403)
                return
            
            conn = get_db()
            cursor = conn.cursor()
            
            # Active round
            cursor.execute("SELECT * FROM rounds WHERE is_active = 1 LIMIT 1")
            active_round = cursor.fetchone()
            if not active_round:
                conn.close()
                self.send_error_json("No active round found", 400)
                return
            
            active_round_dict = dict(active_round)
            active_round_id = active_round['id']

            # Contestants count
            cursor.execute("SELECT COUNT(*) FROM contestants")
            total_contestants = cursor.fetchone()[0]

            # Voted count for this judge
            cursor.execute(
                "SELECT COUNT(*) FROM scores WHERE judge_id = ? AND round_id = ?",
                (user['id'], active_round_id)
            )
            voted_count = cursor.fetchone()[0]
            remaining_count = total_contestants - voted_count

            # Get list of contestants with vote status
            cursor.execute("SELECT * FROM contestants ORDER BY code ASC")
            contestants = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute(
                "SELECT contestant_id, total_score, submitted_at FROM scores WHERE judge_id = ? AND round_id = ?",
                (user['id'], active_round_id)
            )
            voted_scores = {row['contestant_id']: dict(row) for row in cursor.fetchall()}
            for c in contestants:
                if c['id'] in voted_scores:
                    c['voted'] = True
                    c['score_info'] = voted_scores[c['id']]
                else:
                    c['voted'] = False
                    c['score_info'] = None

            # Get pairs if Round 2, 3, or 4
            pairs_list = []
            if active_round_dict['code'] in ('ROUND_2', 'ROUND_3', 'ROUND_4'):
                cursor.execute(
                    """SELECT p.*, 
                       c1.code as c1_code, c1.name as c1_name, c1.avatar_url as c1_avatar,
                       c2.code as c2_code, c2.name as c2_name, c2.avatar_url as c2_avatar
                       FROM pairs p
                       JOIN contestants c1 ON p.contestant1_id = c1.id
                       JOIN contestants c2 ON p.contestant2_id = c2.id
                       WHERE p.round_id = ? ORDER BY p.pair_number ASC""",
                    (active_round_id,)
                )
                pairs_list = [dict(row) for row in cursor.fetchall()]

            conn.close()

            self.send_json({
                "judge_name": user['name'],
                "active_round": active_round_dict,
                "total_contestants": total_contestants,
                "voted_count": voted_count,
                "remaining_count": remaining_count,
                "contestants": contestants,
                "pairs": pairs_list
            })

        elif path == "/api/admin/dashboard":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            conn = get_db()
            cursor = conn.cursor()

            # Round filter or active round
            round_id = query.get('round_id', [None])[0]
            if not round_id:
                cursor.execute("SELECT id FROM rounds WHERE is_active = 1 LIMIT 1")
                act = cursor.fetchone()
                round_id = act['id'] if act else 1

            # Fetch active round details
            cursor.execute("SELECT * FROM rounds WHERE id = ?", (round_id,))
            target_round = dict(cursor.fetchone())

            # Fetch all judges
            cursor.execute("SELECT id, name, username FROM users WHERE role = 'judge' ORDER BY id ASC")
            judges = [dict(row) for row in cursor.fetchall()]

            # Fetch all contestants
            cursor.execute("SELECT * FROM contestants ORDER BY code ASC")
            contestants = [dict(row) for row in cursor.fetchall()]

            # Fetch criteria for this round
            cursor.execute("SELECT * FROM criteria WHERE round_id = ? ORDER BY sort_order ASC", (round_id,))
            criteria_list = [dict(row) for row in cursor.fetchall()]
            crit_map = {c['id']: c for c in criteria_list}

            # Fetch scores for this round
            cursor.execute(
                """SELECT s.*, u.name as judge_name 
                   FROM scores s 
                   JOIN users u ON s.judge_id = u.id 
                   WHERE s.round_id = ?""",
                (round_id,)
            )
            raw_scores = [dict(row) for row in cursor.fetchall()]
            score_ids = [s['id'] for s in raw_scores]

            # Fetch score details
            details_map = {}
            if score_ids:
                placeholders = ','.join('?' * len(score_ids))
                cursor.execute(
                    f"SELECT * FROM score_details WHERE score_id IN ({placeholders})",
                    score_ids
                )
                for d in cursor.fetchall():
                    s_id = d['score_id']
                    if s_id not in details_map:
                        details_map[s_id] = {}
                    details_map[s_id][d['criterion_id']] = d['score_value']

            # Build Judge score matrix per contestant
            # Structure: contestant_id -> { judge_1_score, judge_2_score, judge_3_score, total_score, avg_score, submitted_count }
            matrix = []
            for c in contestants:
                c_scores = [s for s in raw_scores if s['contestant_id'] == c['id']]
                
                judge_scores = {}
                for j in judges:
                    j_score = next((s for s in c_scores if s['judge_id'] == j['id']), None)
                    if j_score:
                        s_id = j_score['id']
                        judge_scores[j['id']] = {
                            "submitted": True,
                            "total": j_score['total_score'],
                            "submitted_at": j_score['submitted_at'],
                            "details": details_map.get(s_id, {})
                        }
                    else:
                        judge_scores[j['id']] = {
                            "submitted": False,
                            "total": None,
                            "details": {}
                        }

                submitted_totals = [j_info['total'] for j_info in judge_scores.values() if j_info['submitted']]
                sub_count = len(submitted_totals)
                sum_score = sum(submitted_totals) if sub_count > 0 else 0.0
                avg_score = (sum_score / sub_count) if sub_count > 0 else 0.0

                # Breakdown by Part for Round 4 Tie-breaker calculation
                part_scores = {"PART 1": 0.0, "PART 2": 0.0, "PART 3": 0.0}
                if target_round['code'] == 'ROUND_4' and sub_count > 0:
                    # Calculate average per part
                    for part_key in ["PART 1", "PART 2", "PART 3"]:
                        part_crits = [c_item['id'] for c_item in criteria_list if part_key in c_item['part_name']]
                        part_sum = 0.0
                        part_sub = 0
                        for j in judges:
                            j_info = judge_scores[j['id']]
                            if j_info['submitted']:
                                part_val = sum(j_info['details'].get(cid, 0.0) for cid in part_crits)
                                part_sum += part_val
                                part_sub += 1
                        if part_sub > 0:
                            part_scores[part_key] = part_sum / part_sub

                matrix.append({
                    "contestant": c,
                    "judge_scores": judge_scores,
                    "voted_judges_count": sub_count,
                    "sum_score": round(sum_score, 2),
                    "avg_score": round(avg_score, 2),
                    "part_scores": part_scores
                })

            # Check Tie-breaker votes if any
            cursor.execute("SELECT * FROM tie_breaker_votes")
            tb_votes = [dict(row) for row in cursor.fetchall()]

            # Ranking calculation with tie-breaker criteria
            # Sort order for Round 4:
            # 1. Avg score (desc)
            # 2. Part 2 (UNEXPECTED SITUATION) (desc)
            # 3. Part 1 (RANDOM SHOWCASE) (desc)
            # 4. Part 3 (FINAL MC PERFORMANCE) (desc)
            # 5. Tie-breaker votes count (desc)
            def rank_key(item):
                tb_count = sum(1 for v in tb_votes if v['contestant_id'] == item['contestant']['id'])
                return (
                    item['avg_score'],
                    item['part_scores'].get('PART 2', 0.0),
                    item['part_scores'].get('PART 1', 0.0),
                    item['part_scores'].get('PART 3', 0.0),
                    tb_count
                )

            ranked_matrix = sorted(matrix, key=rank_key, reverse=True)

            # Assign rank numbers
            current_rank = 1
            for idx, item in enumerate(ranked_matrix):
                item['rank'] = idx + 1

            # Summary metrics
            total_judges = len(judges)
            cursor.execute("SELECT * FROM rounds ORDER BY sort_order ASC")
            all_rounds = [dict(row) for row in cursor.fetchall()]

            conn.close()

            self.send_json({
                "round": target_round,
                "judges": judges,
                "criteria": criteria_list,
                "leaderboard": ranked_matrix,
                "all_rounds": all_rounds,
                "total_judges": total_judges,
                "tie_breaker_votes": tb_votes
            })

        elif path == "/api/admin/audit_logs":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200")
            logs = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"logs": logs})

        elif path == "/api/admin/gsheet_config":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            url = get_gsheet_url()
            self.send_json({"gsheet_url": url})

        elif path == "/api/judges":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, name, role, avatar_url, created_at FROM users ORDER BY role ASC, id ASC")
            judges = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"judges": judges})

        elif path == "/api/pairs":
            conn = get_db()
            cursor = conn.cursor()
            round_id = query.get('round_id', [None])[0]
            if round_id:
                cursor.execute(
                    """SELECT p.*, r.name as round_name, r.subtitle as round_subtitle,
                       c1.code as c1_code, c1.name as c1_name, c1.avatar_url as c1_avatar,
                       c2.code as c2_code, c2.name as c2_name, c2.avatar_url as c2_avatar
                       FROM pairs p
                       JOIN rounds r ON p.round_id = r.id
                       JOIN contestants c1 ON p.contestant1_id = c1.id
                       JOIN contestants c2 ON p.contestant2_id = c2.id
                       WHERE p.round_id = ?
                       ORDER BY p.pair_number ASC""",
                    (round_id,)
                )
            else:
                cursor.execute(
                    """SELECT p.*, r.name as round_name, r.subtitle as round_subtitle,
                       c1.code as c1_code, c1.name as c1_name, c1.avatar_url as c1_avatar,
                       c2.code as c2_code, c2.name as c2_name, c2.avatar_url as c2_avatar
                       FROM pairs p
                       JOIN rounds r ON p.round_id = r.id
                       JOIN contestants c1 ON p.contestant1_id = c1.id
                       JOIN contestants c2 ON p.contestant2_id = c2.id
                       ORDER BY p.round_id ASC, p.pair_number ASC"""
                )
            pairs = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"pairs": pairs})

        elif path == "/api/criteria":
            conn = get_db()
            cursor = conn.cursor()
            round_id = query.get('round_id', [None])[0]
            if round_id:
                cursor.execute(
                    """SELECT c.*, r.name as round_name, r.subtitle as round_subtitle
                       FROM criteria c
                       JOIN rounds r ON c.round_id = r.id
                       WHERE c.round_id = ?
                       ORDER BY c.sort_order ASC""",
                    (round_id,)
                )
            else:
                cursor.execute(
                    """SELECT c.*, r.name as round_name, r.subtitle as round_subtitle
                       FROM criteria c
                       JOIN rounds r ON c.round_id = r.id
                       ORDER BY c.round_id ASC, c.sort_order ASC"""
                )
            criteria = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json({"criteria": criteria})

        elif path == "/api/admin/gsheet_config":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            self.send_json({"gsheet_url": get_gsheet_url()})

        else:
            self.send_error_json("Endpoint not found", 404)

    # ------------------ API POST HANDLERS ------------------
    def handle_api_post(self, path, data):
        user = self.get_current_user()

        if path == "/api/login":
            username = data.get('username', '').strip()
            password = data.get('password', '').strip()

            if not username or not password:
                self.send_error_json("Please specify username and password", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
            user_row = cursor.fetchone()
            conn.close()

            if not user_row or not verify_password(password, user_row['password_hash']):
                self.send_error_json("Username or Password is incorrect", 401)
                return

            # Create Session
            token = secrets.token_hex(24)
            user_data = {
                "id": user_row['id'],
                "username": user_row['username'],
                "name": user_row['name'],
                "role": user_row['role']
            }
            SESSIONS[token] = user_data

            # Log audit
            log_audit(user_row['name'], user_row['id'], 'LOGIN', f"User '{username}' logged in successfully.")

            self.send_json({
                "message": "Login successful",
                "token": token,
                "user": user_data
            })

        elif path == "/api/logout":
            token = self.get_token()
            if token and token in SESSIONS:
                u_info = SESSIONS.pop(token)
                log_audit(u_info['name'], u_info['id'], 'LOGOUT', f"User '{u_info['username']}' logged out.")
            self.send_json({"message": "Logged out successfully"})

        elif path == "/api/vote":
            if not user or user['role'] != 'judge':
                self.send_error_json("Judge authorization required", 403)
                return

            contestant_id = data.get('contestant_id')
            round_id = data.get('round_id')
            scores_input = data.get('scores', {}) # criterion_id -> score_value

            if not contestant_id or not round_id or not scores_input:
                self.send_error_json("Missing required voting data", 400)
                return

            conn = get_db()
            cursor = conn.cursor()

            # Verify active round
            cursor.execute("SELECT * FROM rounds WHERE id = ?", (round_id,))
            round_row = cursor.fetchone()
            if not round_row or round_row['is_active'] != 1:
                conn.close()
                self.send_error_json("The competition round is currently locked or not active", 400)
                return

            # Verify contestant exists
            cursor.execute("SELECT * FROM contestants WHERE id = ?", (contestant_id,))
            contestant_row = cursor.fetchone()
            if not contestant_row:
                conn.close()
                self.send_error_json("Contestant not found", 404)
                return

            # Check if judge has already submitted score for this contestant and round
            cursor.execute(
                "SELECT id FROM scores WHERE judge_id = ? AND contestant_id = ? AND round_id = ?",
                (user['id'], contestant_id, round_id)
            )
            if cursor.fetchone():
                conn.close()
                self.send_error_json("Score already submitted! Duplicate submission is strictly locked.", 409)
                return

            # Validate scores against criteria
            cursor.execute("SELECT * FROM criteria WHERE round_id = ?", (round_id,))
            criteria_rows = cursor.fetchall()
            crit_dict = {c['id']: c for c in criteria_rows}

            total_score = 0.0
            validated_details = []

            for c_id_str, val in scores_input.items():
                try:
                    c_id = int(c_id_str)
                    score_val = float(val)
                except ValueError:
                    conn.close()
                    self.send_error_json(f"Invalid score value for criterion {c_id_str}", 400)
                    return

                if c_id not in crit_dict:
                    conn.close()
                    self.send_error_json(f"Criterion ID {c_id} does not belong to active round", 400)
                    return

                max_allowed = crit_dict[c_id]['max_score']
                if score_val < 0 or score_val > max_allowed:
                    conn.close()
                    self.send_error_json(f"Score for '{crit_dict[c_id]['name']}' must be between 0 and {max_allowed}", 400)
                    return

                total_score += score_val
                validated_details.append((c_id, round(score_val, 2)))

            total_score = round(total_score, 2)
            now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

            # Insert into database inside transaction
            try:
                cursor.execute(
                    "INSERT INTO scores (judge_id, contestant_id, round_id, total_score) VALUES (?, ?, ?, ?)",
                    (user['id'], contestant_id, round_id, total_score)
                )
                score_id = cursor.lastrowid

                for c_id, val in validated_details:
                    cursor.execute(
                        "INSERT INTO score_details (score_id, criterion_id, score_value) VALUES (?, ?, ?)",
                        (score_id, c_id, val)
                    )

                conn.commit()

                # Audit Log
                log_audit(
                    user['name'],
                    user['id'],
                    'SUBMIT_SCORE',
                    f"Submitted score for Contestant '{contestant_row['name']}' ({contestant_row['code']}) in {round_row['name']}. Total Score: {total_score}/{round_row['max_score']} at {now_str}"
                )

                # Sync to Google Sheets
                sync_to_gsheet_async({
                    "action": "submit_vote",
                    "judge_id": user['id'],
                    "judge_name": user['name'],
                    "contestant_id": contestant_id,
                    "round_id": round_id,
                    "total_score": total_score,
                    "details": [{"criterion_id": cid, "score": val} for cid, val in validated_details]
                })

                conn.close()
                self.send_json({
                    "message": "Score submitted and locked successfully",
                    "score_id": score_id,
                    "total_score": total_score,
                    "submitted_at": now_str
                })
            except sqlite3.IntegrityError:
                conn.rollback()
                conn.close()
                self.send_error_json("Score already submitted and locked for this contestant.", 409)

        elif path == "/api/rounds/activate":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            round_id = data.get('round_id')
            if not round_id:
                self.send_error_json("Missing round_id", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("UPDATE rounds SET is_active = 0")
            cursor.execute("UPDATE rounds SET is_active = 1 WHERE id = ?", (round_id,))
            cursor.execute("SELECT * FROM rounds WHERE id = ?", (round_id,))
            activated_round = cursor.fetchone()
            conn.commit()
            conn.close()

            if activated_round:
                log_audit(user['name'], user['id'], 'ACTIVATE_ROUND', f"Set active round to '{activated_round['name']} — {activated_round['subtitle']}'")
                trigger_gsheet_auto_sync()
                self.send_json({"message": "Round activated successfully", "active_round": dict(activated_round)})
            else:
                self.send_error_json("Round not found", 404)

        elif path == "/api/rounds":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            code = data.get('code', '').strip().upper()
            name = data.get('name', '').strip()
            subtitle = data.get('subtitle', '').strip()
            try:
                max_score = float(data.get('max_score', 100.0))
            except (ValueError, TypeError):
                max_score = 100.0
            try:
                sort_order = int(data.get('sort_order', 1))
            except (ValueError, TypeError):
                sort_order = 1

            if not code or not name:
                self.send_error_json("Round Code and Name are required", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO rounds (code, name, subtitle, max_score, is_active, sort_order) VALUES (?, ?, ?, ?, 0, ?)",
                    (code, name, subtitle, max_score, sort_order)
                )
                new_id = cursor.lastrowid
                conn.commit()
                conn.close()

                log_audit(user['name'], user['id'], 'ADD_ROUND', f"Added round '{name}' ({code})")
                trigger_gsheet_auto_sync()
                self.send_json({"message": "Round created successfully", "id": new_id})
            except sqlite3.IntegrityError:
                conn.close()
                self.send_error_json(f"Round code '{code}' already exists", 400)

        elif path == "/api/contestants":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            code = data.get('code', '').strip()
            name = data.get('name', '').strip()
            nickname = data.get('nickname', '').strip()
            faculty = data.get('faculty', 'ISKKU').strip()
            avatar_url = data.get('avatar_url', '').strip()
            bio = data.get('bio', '').strip()

            if not code or not name:
                self.send_error_json("Contestant Code and Name are required", 400)
                return

            if not avatar_url:
                avatar_url = f"https://api.dicebear.com/7.x/avataaars/svg?seed={code}"

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO contestants (code, name, nickname, faculty, avatar_url, bio) VALUES (?, ?, ?, ?, ?, ?)",
                    (code, name, nickname, faculty, avatar_url, bio)
                )
                new_id = cursor.lastrowid
                conn.commit()
                conn.close()

                log_audit(user['name'], user['id'], 'ADD_CONTESTANT', f"Added new contestant '{name}' ({code})")
                trigger_gsheet_auto_sync()
                self.send_json({"message": "Contestant created", "id": new_id})
            except sqlite3.IntegrityError:
                conn.close()
                self.send_error_json(f"Contestant code '{code}' already exists", 400)

        elif path == "/api/contestants/batch":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            items = data.get('items', [])
            if not items:
                self.send_error_json("No contestant items provided", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            added_count = 0
            skipped_count = 0

            for item in items:
                code = str(item.get('code', '')).strip()
                name = str(item.get('name', '')).strip()
                nickname = str(item.get('nickname', '')).strip()
                faculty = str(item.get('faculty', 'สารสนเทศศาสตร์ (ISKKU)')).strip()
                avatar_url = convert_gdrive_url(str(item.get('avatar_url', '')).strip())
                bio = str(item.get('bio', '')).strip()

                if not code or not name:
                    continue

                if not avatar_url:
                    avatar_url = f"https://api.dicebear.com/7.x/avataaars/svg?seed={code}"

                try:
                    cursor.execute(
                        "INSERT INTO contestants (code, name, nickname, faculty, avatar_url, bio) VALUES (?, ?, ?, ?, ?, ?)",
                        (code, name, nickname, faculty, avatar_url, bio)
                    )
                    added_count += 1
                except sqlite3.IntegrityError:
                    skipped_count += 1

            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'BATCH_ADD_CONTESTANTS', f"Batch imported {added_count} contestants ({skipped_count} skipped/duplicate)")
            trigger_gsheet_auto_sync()
            self.send_json({"message": f"นำเข้าข้อมูลผู้เข้าแข่งขันสำเร็จ {added_count} คน (ข้าม {skipped_count} รายการซ้ำ)", "added": added_count, "skipped": skipped_count})

        elif path == "/api/pairs":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            round_id = data.get('round_id')
            pair_number = data.get('pair_number')
            contestant1_id = data.get('contestant1_id')
            contestant2_id = data.get('contestant2_id')
            keywords = data.get('keywords', '')
            topic = data.get('topic', '')

            if not round_id or not contestant1_id or not contestant2_id:
                self.send_error_json("Missing required pair info", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO pairs (round_id, pair_number, contestant1_id, contestant2_id, keywords, topic) VALUES (?, ?, ?, ?, ?, ?)",
                (round_id, pair_number or 1, contestant1_id, contestant2_id, keywords, topic)
            )
            pair_id = cursor.lastrowid
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'CREATE_PAIR', f"Created pair match #{pair_number} for round {round_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Pair added", "id": pair_id})

        elif path == "/api/judges":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            username = data.get('username', '').strip()
            password = data.get('password', '').strip()
            name = data.get('name', '').strip()
            role = data.get('role', 'judge').strip().lower()
            if role not in ('admin', 'judge'):
                role = 'judge'
            avatar_url = convert_gdrive_url(data.get('avatar_url', '').strip())

            if not username or not password or not name:
                self.send_error_json("Username, Password, and Name are required", 400)
                return

            if not avatar_url:
                avatar_url = f"https://api.dicebear.com/7.x/avataaars/svg?seed={username}"

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO users (username, password_hash, name, role, avatar_url) VALUES (?, ?, ?, ?, ?)",
                    (username, hash_password(password), name, role, avatar_url)
                )
                new_id = cursor.lastrowid
                conn.commit()
                conn.close()

                log_audit(user['name'], user['id'], 'ADD_USER', f"Added user '{name}' (@{username}) with role '{role}'")
                trigger_gsheet_auto_sync()
                self.send_json({"message": "User created successfully", "id": new_id})
            except sqlite3.IntegrityError:
                conn.close()
                self.send_error_json(f"Username '{username}' already exists", 400)

        elif path == "/api/admin/tie_break_vote":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            contestant_id = data.get('contestant_id')
            judge_id = data.get('judge_id')

            if not contestant_id or not judge_id:
                self.send_error_json("Missing contestant_id or judge_id", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO tie_breaker_votes (contestant_id, judge_id, vote) VALUES (?, ?, 1)",
                    (contestant_id, judge_id)
                )
                conn.commit()
                conn.close()
                log_audit(user['name'], user['id'], 'TIE_BREAK_VOTE', f"Recorded tie-breaker vote for contestant {contestant_id} from judge {judge_id}")
                self.send_json({"message": "Tie break vote recorded"})
            except sqlite3.IntegrityError:
                conn.close()
                self.send_error_json("Judge has already cast tie-breaker vote for this contestant", 409)

        elif path == "/api/admin/gsheet_config":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            url = data.get('gsheet_url', '').strip()
            if set_gsheet_url(url):
                log_audit(user['name'], user['id'], 'CONFIG_GSHEET', "Updated Google Sheets Web App URL")
                self.send_json({"message": "บันทึก Google Sheets URL สำเร็จเรียบร้อยแล้ว", "gsheet_url": url})
            else:
                self.send_error_json("Failed to save Google Sheets URL", 500)

        elif path == "/api/admin/gsheet_sync_now":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            success, msg = sync_full_database_to_gsheet()
            if success:
                log_audit(user['name'], user['id'], 'MANUAL_GSHEET_SYNC', "Triggered manual full database sync to Google Sheets")
                self.send_json({"message": "ซิงค์ข้อมูลทั้งหมดไปยัง Google Sheets สำเร็จเรียบร้อยแล้ว!"})
            else:
                self.send_error_json(f"Sync failed: {msg}", 400)

        elif path == "/api/criteria":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return

            round_id = data.get('round_id')
            part_name = data.get('part_name', '').strip()
            name = data.get('name', '').strip()
            try:
                max_score = float(data.get('max_score', 10.0))
            except (ValueError, TypeError):
                max_score = 10.0
            try:
                sort_order = int(data.get('sort_order', 1))
            except (ValueError, TypeError):
                sort_order = 1

            if not round_id or not name:
                self.send_error_json("Round ID and Criterion Name are required", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO criteria (round_id, part_name, name, max_score, sort_order) VALUES (?, ?, ?, ?, ?)",
                (round_id, part_name, name, max_score, sort_order)
            )
            new_id = cursor.lastrowid
            recalculate_round_max_score(cursor, round_id)
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'ADD_CRITERION', f"Added criterion '{name}' ({max_score} pts) to round #{round_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Criterion created successfully", "id": new_id})

        elif path == "/api/admin/gsheet_config":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            url = data.get('gsheet_url', '').strip()
            set_gsheet_url(url)
            log_audit(user['name'], user['id'], 'UPDATE_GSHEET_CONFIG', "Updated Google Sheets Web App URL")
            self.send_json({"message": "Google Sheets Web App URL updated successfully", "gsheet_url": url})

        elif path == "/api/admin/gsheet_sync_now":
            if not user or user['role'] != 'admin':
                self.send_error_json("Admin access required", 403)
                return
            success, msg = sync_full_database_to_gsheet()
            if success:
                log_audit(user['name'], user['id'], 'FULL_GSHEET_SYNC', "Executed full database sync to Google Sheets")
                self.send_json({"message": msg})
            else:
                self.send_error_json(msg, 400)

        else:
            self.send_error_json("Endpoint not found", 404)

    # ------------------ API PUT HANDLERS ------------------
    def handle_api_put(self, path, data):
        user = self.get_current_user()
        if not user or user['role'] != 'admin':
            self.send_error_json("Admin access required", 403)
            return

        if path.startswith("/api/contestants/"):
            c_id = path.split("/")[-1]
            code = data.get('code', '').strip()
            name = data.get('name', '').strip()
            nickname = data.get('nickname', '').strip()
            faculty = data.get('faculty', 'ISKKU').strip()
            avatar_url = data.get('avatar_url', '').strip()
            bio = data.get('bio', '').strip()

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE contestants SET code=?, name=?, nickname=?, faculty=?, avatar_url=?, bio=? WHERE id=?",
                (code, name, nickname, faculty, avatar_url, bio, c_id)
            )
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'UPDATE_CONTESTANT', f"Updated contestant #{c_id} ({name})")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Contestant updated"})

        elif path.startswith("/api/judges/"):
            j_id = path.split("/")[-1]
            name = data.get('name', '').strip()
            username = data.get('username', '').strip()
            password = data.get('password', '').strip()
            role = data.get('role', 'judge').strip().lower()
            if role not in ('admin', 'judge'):
                role = 'judge'
            avatar_url = convert_gdrive_url(data.get('avatar_url', '').strip())

            if not name or not username:
                self.send_error_json("Name and Username are required", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            if password:
                cursor.execute(
                    "UPDATE users SET name=?, username=?, role=?, password_hash=?, avatar_url=? WHERE id=?",
                    (name, username, role, hash_password(password), avatar_url, j_id)
                )
            else:
                cursor.execute(
                    "UPDATE users SET name=?, username=?, role=?, avatar_url=? WHERE id=?",
                    (name, username, role, avatar_url, j_id)
                )
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'UPDATE_USER', f"Updated user #{j_id} ({name}) role to '{role}'")
            trigger_gsheet_auto_sync()
        elif path.startswith("/api/rounds/"):
            r_id = path.split("/")[-1]
            code = data.get('code', '').strip().upper()
            name = data.get('name', '').strip()
            subtitle = data.get('subtitle', '').strip()
            try:
                max_score = float(data.get('max_score', 100.0))
            except (ValueError, TypeError):
                max_score = 100.0
            try:
                sort_order = int(data.get('sort_order', 1))
            except (ValueError, TypeError):
                sort_order = 1

            if not name:
                self.send_error_json("Round Name is required", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE rounds SET code=?, name=?, subtitle=?, max_score=?, sort_order=? WHERE id=?",
                (code, name, subtitle, max_score, sort_order, r_id)
            )
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'UPDATE_ROUND', f"Updated round #{r_id} ({name})")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Round updated successfully"})

        elif path.startswith("/api/pairs/"):
            pair_id = path.split("/")[-1]
            round_id = data.get('round_id')
            pair_number = data.get('pair_number')
            contestant1_id = data.get('contestant1_id')
            contestant2_id = data.get('contestant2_id')
            keywords = data.get('keywords', '')
            topic = data.get('topic', '')

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE pairs SET round_id=?, pair_number=?, contestant1_id=?, contestant2_id=?, keywords=?, topic=? WHERE id=?",
                (round_id, pair_number, contestant1_id, contestant2_id, keywords, topic, pair_id)
            )
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'UPDATE_PAIR', f"Updated pair match #{pair_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Pair updated successfully"})

        elif path.startswith("/api/criteria/"):
            c_id = path.split("/")[-1]
            round_id = data.get('round_id')
            part_name = data.get('part_name', '').strip()
            name = data.get('name', '').strip()
            try:
                max_score = float(data.get('max_score', 10.0))
            except (ValueError, TypeError):
                max_score = 10.0
            try:
                sort_order = int(data.get('sort_order', 1))
            except (ValueError, TypeError):
                sort_order = 1

            if not name:
                self.send_error_json("Criterion Name is required", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE criteria SET round_id=?, part_name=?, name=?, max_score=?, sort_order=? WHERE id=?",
                (round_id, part_name, name, max_score, sort_order, c_id)
            )
            recalculate_round_max_score(cursor, round_id)
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'UPDATE_CRITERION', f"Updated criterion #{c_id} ({name})")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Criterion updated successfully"})

        else:
            self.send_error_json("Endpoint not found", 404)

    # ------------------ API DELETE HANDLERS ------------------
    def handle_api_delete(self, path):
        user = self.get_current_user()
        if not user or user['role'] != 'admin':
            self.send_error_json("Admin access required", 403)
            return

        if path.startswith("/api/contestants/"):
            c_id = path.split("/")[-1]
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM contestants WHERE id=?", (c_id,))
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'DELETE_CONTESTANT', f"Deleted contestant #{c_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Contestant deleted"})

        elif path.startswith("/api/pairs/"):
            pair_id = path.split("/")[-1]
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM pairs WHERE id=?", (pair_id,))
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'DELETE_PAIR', f"Deleted pair match #{pair_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Pair deleted successfully"})

        elif path.startswith("/api/criteria/"):
            c_id = path.split("/")[-1]
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT round_id, name FROM criteria WHERE id=?", (c_id,))
            c_item = cursor.fetchone()
            if c_item:
                round_id = c_item['round_id']
                c_name = c_item['name']
                cursor.execute("DELETE FROM criteria WHERE id=?", (c_id,))
                recalculate_round_max_score(cursor, round_id)
                conn.commit()
                log_audit(user['name'], user['id'], 'DELETE_CRITERION', f"Deleted criterion #{c_id} ({c_name})")
                trigger_gsheet_auto_sync()
            conn.close()
            self.send_json({"message": "Criterion deleted successfully"})

        elif path.startswith("/api/rounds/"):
            r_id = path.split("/")[-1]
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT is_active, name FROM rounds WHERE id=?", (r_id,))
            r_row = cursor.fetchone()
            if not r_row:
                conn.close()
                self.send_error_json("Round not found", 404)
                return

            if r_row['is_active']:
                conn.close()
                self.send_error_json("Cannot delete the active round. Please activate another round first.", 400)
                return

            cursor.execute("SELECT COUNT(*) FROM scores WHERE round_id=?", (r_id,))
            score_count = cursor.fetchone()[0]
            if score_count > 0:
                conn.close()
                self.send_error_json("Cannot delete round with existing submitted scores.", 400)
                return

            cursor.execute("DELETE FROM criteria WHERE round_id=?", (r_id,))
            cursor.execute("DELETE FROM pairs WHERE round_id=?", (r_id,))
            cursor.execute("DELETE FROM rounds WHERE id=?", (r_id,))
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'DELETE_ROUND', f"Deleted round #{r_id} ({r_row['name']})")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "Round deleted successfully"})

        elif path.startswith("/api/judges/"):
            j_id = path.split("/")[-1]
            if str(j_id) == str(user['id']):
                self.send_error_json("Cannot delete your own active account", 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id=?", (j_id,))
            conn.commit()
            conn.close()

            log_audit(user['name'], user['id'], 'DELETE_USER', f"Deleted user #{j_id}")
            trigger_gsheet_auto_sync()
            self.send_json({"message": "User deleted successfully"})

        else:
            self.send_error_json("Endpoint not found", 404)

def run():
    init_db()
    server_address = ('', PORT)
    httpd = ThreadedHTTPServer(server_address, RequestHandler)
    print(f"==========================================================")
    print(f"  MC OF ISKKU 2026 - Judge Voting System Server Running")
    print(f"  URL: http://localhost:{PORT}")
    print(f"==========================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == '__main__':
    run()

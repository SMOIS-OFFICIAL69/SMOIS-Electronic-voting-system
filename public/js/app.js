/* MC OF ISKKU 2026 - Core Application JavaScript */

const App = {
    state: {
        token: localStorage.getItem('mc_token') || null,
        user: null,
        activeRound: null,
        rounds: [],
        contestants: [],
        criteria: []
    },

    init: async function() {
        console.log("[APP] Initializing MC OF ISKKU 2026 application...");
        this.bindEvents();

        if (this.state.token) {
            const userOk = await this.checkSession();
            if (!userOk) {
                this.showView('view-login');
            }
        } else {
            this.showView('view-login');
        }
    },

    bindEvents: function() {
        // Login form
        const formLogin = document.getElementById('form-login');
        if (formLogin) {
            formLogin.addEventListener('submit', async (e) => {
                e.preventDefault();
                const u = document.getElementById('login-username').value;
                const p = document.getElementById('login-password').value;
                await this.login(u, p);
            });
        }

        // Logout button
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => this.logout());
        }
    },

    GSHEET_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyUyYg_waTStoQ5_cc7fyJJz9nDmhRTW6X7sEgKDmIoFFLZ91WZzR8LXmQ5daN6CXsJow/exec",

    apiFetch: async function(endpoint, method = 'GET', body = null) {
        const isLocalHost8000 = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && (window.location.port === '8000');
        const isFileProtocol = (window.location.protocol === 'file:');

        if (isLocalHost8000 || isFileProtocol) {
            // Local Python Server Mode
            const baseUrl = isFileProtocol ? 'http://localhost:8000' : '';
            const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
            const headers = { 'Content-Type': 'application/json' };
            if (this.state.token) headers['Authorization'] = `Bearer ${this.state.token}`;

            const options = { method, headers };
            if (body && (method === 'POST' || method === 'PUT')) options.body = JSON.stringify(body);

            try {
                const res = await fetch(url, options);
                const text = await res.text();
                let data = {};
                try {
                    data = JSON.parse(text);
                } catch (jsonErr) {
                    if (!res.ok) {
                        if (res.status === 404) throw new Error('ไม่พบข้อมูลที่ต้องการ (HTTP 404)');
                        if (res.status === 401) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
                        if (res.status === 403) throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
                        throw new Error(`[HTTP ${res.status}] ไม่สามารถเชื่อมต่อข้อมูลได้ (${res.statusText})`);
                    }
                    throw new Error(`คำตอบจากเซิร์ฟเวอร์ไม่ได้อยู่ในรูปแบบ JSON: "${text.substring(0, 80)}..."`);
                }

                if (!res.ok) {
                    throw new Error(data.error || `เกิดข้อผิดพลาดในการเชื่อมต่อ (HTTP ${res.status})`);
                }
                return data;
            } catch (err) {
                console.error(`[LOCAL API ERROR ${method} ${url}]`, err);
                throw err;
            }
        } else {
            // Remote Hosting Mode (Vercel / GitHub Pages / Netlify) -> Talk directly to Google Sheets Web App!
            return await this.apiFetchGoogleSheets(endpoint, method, body);
        }
    },

    apiFetchGoogleSheets: async function(endpoint, method, body) {
        const gUrl = this.GSHEET_WEBAPP_URL;

        try {
            if (endpoint === '/api/login') {
                const res = await fetch(gUrl, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'login', username: body.username, password: body.password })
                });
                const data = JSON.parse(await res.text());
                if (data.status === 'error' || data.error) {
                    throw new Error(data.message || data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
                }
                const user = data.user;
                const token = 'token_' + user.id + '_' + Date.now();
                return { token, user };
            }

            if (endpoint === '/api/me') {
                const storedUser = localStorage.getItem('mc_user');
                if (storedUser) {
                    return { user: JSON.parse(storedUser) };
                }
                throw new Error('Unauthorized');
            }

            if (endpoint === '/api/logout') {
                localStorage.removeItem('mc_user');
                return { message: 'Logged out' };
            }

            if (endpoint === '/api/judge/dashboard') {
                const storedUser = this.state.user || (localStorage.getItem('mc_user') ? JSON.parse(localStorage.getItem('mc_user')) : null);
                const uId = storedUser ? storedUser.id : '';
                const res = await fetch(`${gUrl}?action=get_dashboard&user_id=${uId}`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/admin/dashboard')) {
                let rId = '';
                if (endpoint.includes('round_id=')) {
                    rId = endpoint.split('round_id=')[1].split('&')[0];
                }
                const res = await fetch(`${gUrl}?action=get_dashboard&round_id=${rId}`);
                return JSON.parse(await res.text());
            }

            if (endpoint === '/api/admin/gsheet_config') {
                if (method === 'POST' && body && body.gsheet_url) {
                    this.GSHEET_WEBAPP_URL = body.gsheet_url;
                }
                return { gsheet_url: this.GSHEET_WEBAPP_URL };
            }

            if (endpoint === '/api/admin/gsheet_sync_now') {
                return { message: 'เชื่อมต่อฐานข้อมูล Google Sheets เรียลไทม์ 100% เรียบร้อยแล้ว' };
            }

            if (endpoint === '/api/vote') {
                const storedUser = this.state.user || (localStorage.getItem('mc_user') ? JSON.parse(localStorage.getItem('mc_user')) : null);
                const judgeId = storedUser ? storedUser.id : (body.judge_id || 1);
                const judgeName = storedUser ? storedUser.name : (body.judge_name || 'Judge');

                let totalScore = 0;
                const details = [];
                if (body.scores) {
                    for (const [critId, scoreVal] of Object.entries(body.scores)) {
                        const val = parseFloat(scoreVal) || 0;
                        totalScore += val;
                        details.push({ criterion_id: parseInt(critId), score: val });
                    }
                }

                const payload = {
                    action: 'submit_vote',
                    judge_id: judgeId,
                    judge_name: judgeName,
                    contestant_id: body.contestant_id,
                    round_id: body.round_id,
                    total_score: totalScore,
                    scores: body.scores,
                    details: details
                };

                const res = await fetch(gUrl, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const data = JSON.parse(await res.text());
                if (data.status === 'error') throw new Error(data.message || 'เกิดข้อผิดพลาดในการบันทึกคะแนน');
                return data;
            }

            if (endpoint === '/api/rounds/activate') {
                const res = await fetch(gUrl, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'activate_round', ...body })
                });
                const data = JSON.parse(await res.text());
                if (data.status === 'error') throw new Error(data.message);
                return data;
            }

            if (endpoint === '/api/contestants') {
                if (method === 'POST') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_contestant', ...body }) });
                    return JSON.parse(await res.text());
                }
                const res = await fetch(`${gUrl}?action=get_contestants`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/contestants/batch')) {
                if (body && body.items) {
                    for (const item of body.items) {
                        await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_contestant', ...item }) });
                    }
                }
                return { message: 'นำเข้าข้อมูลผู้เข้าแข่งขันสำเร็จ' };
            }

            if (endpoint.startsWith('/api/contestants/')) {
                const cId = endpoint.split('/')[3];
                if (method === 'DELETE') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'delete_contestant', id: cId }) });
                    return JSON.parse(await res.text());
                }
                if (method === 'PUT') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_contestant', id: cId, ...body }) });
                    return JSON.parse(await res.text());
                }
            }

            if (endpoint === '/api/pairs') {
                if (method === 'POST') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_pair', ...body }) });
                    return JSON.parse(await res.text());
                }
                const res = await fetch(`${gUrl}?action=get_pairs`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/pairs/')) {
                const pId = endpoint.split('/')[3];
                if (method === 'DELETE') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'delete_pair', id: pId }) });
                    return JSON.parse(await res.text());
                }
                if (method === 'PUT') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_pair', id: pId, ...body }) });
                    return JSON.parse(await res.text());
                }
            }

            if (endpoint.startsWith('/api/criteria')) {
                if (method === 'POST') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_criterion', ...body }) });
                    return JSON.parse(await res.text());
                }
                const res = await fetch(`${gUrl}?action=get_criteria`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/criteria/')) {
                const crId = endpoint.split('/')[3];
                if (method === 'DELETE') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'delete_criterion', id: crId }) });
                    return JSON.parse(await res.text());
                }
                if (method === 'PUT') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_criterion', id: crId, ...body }) });
                    return JSON.parse(await res.text());
                }
            }

            if (endpoint === '/api/judges') {
                if (method === 'POST') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_judge', ...body }) });
                    return JSON.parse(await res.text());
                }
                const res = await fetch(`${gUrl}?action=get_judges`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/judges/')) {
                const jId = endpoint.split('/')[3];
                if (method === 'DELETE') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'delete_judge', id: jId }) });
                    return JSON.parse(await res.text());
                }
                if (method === 'PUT') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_judge', id: jId, ...body }) });
                    return JSON.parse(await res.text());
                }
            }

            if (endpoint === '/api/rounds') {
                if (method === 'POST') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_round', ...body }) });
                    return JSON.parse(await res.text());
                }
                const res = await fetch(`${gUrl}?action=get_rounds`);
                return JSON.parse(await res.text());
            }

            if (endpoint.startsWith('/api/rounds/')) {
                const rId = endpoint.split('/')[3];
                if (method === 'DELETE') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'delete_round', id: rId }) });
                    return JSON.parse(await res.text());
                }
                if (method === 'PUT') {
                    const res = await fetch(gUrl, { method: 'POST', body: JSON.stringify({ action: 'save_round', id: rId, ...body }) });
                    return JSON.parse(await res.text());
                }
            }

            if (endpoint === '/api/admin/audit_logs') {
                const res = await fetch(`${gUrl}?action=get_logs`);
                return JSON.parse(await res.text());
            }

            return { status: 'ok' };
        } catch (e) {
            console.error(`[GSHEET API ERROR ${method} ${endpoint}]`, e);
            throw e;
        }
    },

    checkSession: async function() {
        try {
            const res = await this.apiFetch('/api/me');
            this.state.user = res.user;
            this.setupHeader();
            if (this.state.user.role === 'admin') {
                Admin.init();
            } else {
                Judge.init();
            }
            return true;
        } catch (err) {
            this.logout(false);
            return false;
        }
    },

    showLoadingModal: function(title = 'กำลังเชื่อมต่อและโหลดข้อมูลสด...', subtitle = 'ระบบกำลังดึงข้อมูลการแข่งขัน คะแนน และรายชื่อผู้เข้าแข่งขันทั้งหมดจาก Google Sheets') {
        const modal = document.getElementById('modal-sheet-loading');
        if (modal) {
            const sub = document.getElementById('loading-sub-text');
            if (sub && subtitle) sub.textContent = subtitle;
            modal.classList.add('active');
        }
    },

    hideLoadingModal: function() {
        const modal = document.getElementById('modal-sheet-loading');
        if (modal) {
            modal.classList.remove('active');
        }
    },

    login: async function(username, password) {
        this.showLoadingModal('กำลังตรวจสอบสิทธิ์...', 'กำลังเข้าสู่ระบบและดึงข้อมูลจาก Google Sheets');
        try {
            const res = await this.apiFetch('/api/login', 'POST', { username, password });
            this.state.token = res.token;
            this.state.user = res.user;
            localStorage.setItem('mc_token', res.token);
            localStorage.setItem('mc_user', JSON.stringify(res.user));
            
            this.setupHeader();
            this.showToast(`ยินดีต้อนรับ ${res.user.name}`, 'success');

            if (res.user.role === 'admin') {
                await Admin.init();
            } else {
                await Judge.init();
            }
        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            this.hideLoadingModal();
        }
    },

    logout: async function(showToast = true) {
        if (this.state.token) {
            try {
                await this.apiFetch('/api/logout', 'POST');
            } catch (e) {
                // Ignore logout error
            }
        }
        this.state.token = null;
        this.state.user = null;
        localStorage.removeItem('mc_token');
        localStorage.removeItem('mc_user');

        if (typeof Admin !== 'undefined' && Admin.state.pollTimer) clearInterval(Admin.state.pollTimer);
        if (typeof Judge !== 'undefined' && Judge.state.pollTimer) clearInterval(Judge.state.pollTimer);

        document.getElementById('app-header').style.display = 'none';
        this.showView('view-login');
        if (showToast) {
            this.showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
        }
    },

    setupHeader: function() {
        const header = document.getElementById('app-header');
        if (!header || !this.state.user) return;

        header.style.display = 'block';
        document.getElementById('nav-user-name').textContent = this.state.user.name;
        document.getElementById('nav-user-role').textContent = this.state.user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'คณะกรรมการ';
        document.getElementById('nav-user-initial').textContent = this.state.user.name.charAt(0);
    },

    showView: function(viewId) {
        const views = ['view-login', 'view-judge', 'view-vote-form', 'view-admin'];
        views.forEach(v => {
            const el = document.getElementById(v);
            if (el) el.style.display = (v === viewId) ? 'block' : 'none';
        });
    },

    showToast: function(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        // Deduplicate identical toasts
        const existingToasts = Array.from(container.children);
        if (existingToasts.some(t => t.innerHTML === message)) {
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    openModal: function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('active');
    },

    closeModal: function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

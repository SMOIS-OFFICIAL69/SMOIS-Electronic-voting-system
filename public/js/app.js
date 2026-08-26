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

    apiFetch: async function(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.state.token) {
            headers['Authorization'] = `Bearer ${this.state.token}`;
        }

        const options = { method, headers };
        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(body);
        }

        // Auto-detect base URL if page is opened via file:// protocol
        const baseUrl = (window.location.protocol === 'file:') ? 'http://localhost:8000' : '';
        const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

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
            console.error(`[API ERROR ${method} ${url}]`, err);
            if (window.location.protocol === 'file:' && err.message.includes('Failed to fetch')) {
                throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่าเปิด server.py ไว้ที่ http://localhost:8000 แล้วหรือยัง');
            }
            throw err;
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

    login: async function(username, password) {
        try {
            const res = await this.apiFetch('/api/login', 'POST', { username, password });
            this.state.token = res.token;
            this.state.user = res.user;
            localStorage.setItem('mc_token', res.token);
            
            this.setupHeader();
            this.showToast(`ยินดีต้อนรับ ${res.user.name}`, 'success');

            if (res.user.role === 'admin') {
                Admin.init();
            } else {
                Judge.init();
            }
        } catch (err) {
            this.showToast(err.message, 'error');
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

/* MC OF ISKKU 2026 - Admin Interface & Control Logic */

const Admin = {
    state: {
        dashboard: null,
        selectedRoundId: null,
        currentPairFilter: 'all',
        currentCriteriaFilter: 'all',
        pollTimer: null,
        logs: []
    },

    init: async function() {
        console.log("[ADMIN] Initializing admin dashboard...");
        App.showView('view-admin');
        this.bindEvents();
        await this.loadDashboard();
        this.startAutoPolling();
    },

    startAutoPolling: function() {
        if (this.state.pollTimer) clearInterval(this.state.pollTimer);
        this.state.pollTimer = setInterval(async () => {
            if (App.state.currentView !== 'view-admin') {
                clearInterval(this.state.pollTimer);
                return;
            }
            if (document.querySelector('.modal-overlay.active')) return;

            const badge = document.getElementById('admin-sync-badge');
            if (badge) badge.innerHTML = `<span class="live-dot" style="background:#f59e0b; animation-duration:0.4s;">⚡</span> กำลังดึงข้อมูลจากฐานชีต...`;

            const t0 = performance.now();
            try {
                const url = this.state.selectedRoundId ? `/api/admin/dashboard?round_id=${this.state.selectedRoundId}` : '/api/admin/dashboard';
                const data = await App.apiFetch(url);
                const t1 = performance.now();
                const ms = Math.round(t1 - t0);

                this.state.dashboard = data;
                this.state.selectedRoundId = data.round.id;
                localStorage.setItem('mc_admin_cache', JSON.stringify(data));

                this.renderScoreboard();
                this.renderRoundControls();
                this.renderContestantsTable();
                this.loadPairsTable(true);

                if (badge) badge.innerHTML = `<span class="live-dot">●</span> เรียลไทม์ (${ms}ms)`;
            } catch (e) {
                if (badge) badge.innerHTML = `<span class="live-dot" style="background:#ef4444;">●</span> ออฟไลน์`;
            }
        }, 1200);
    },

    bindEvents: function() {
        // Tab switching
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const targetTab = tab.getAttribute('data-tab');
                document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
                document.getElementById(targetTab).style.display = 'block';

                if (targetTab === 'tab-audit') {
                    this.loadAuditLogs();
                } else if (targetTab === 'tab-judges') {
                    this.loadJudgesTable();
                } else if (targetTab === 'tab-criteria') {
                    this.loadCriteriaTable();
                }
            };
        });

        // Round select dropdown
        const selRound = document.getElementById('admin-select-round');
        if (selRound) {
            selRound.onchange = (e) => {
                this.state.selectedRoundId = e.target.value;
                this.loadDashboard();
            };
        }

        const btnRefresh = document.getElementById('btn-refresh-admin');
        if (btnRefresh) {
            btnRefresh.onclick = () => this.loadDashboard();
        }

        // Add Contestant Buttons
        const btnAddC = document.getElementById('btn-add-contestant');
        if (btnAddC) {
            btnAddC.onclick = () => this.openAddContestantModal();
        }

        const btnBatchAddC = document.getElementById('btn-batch-add-contestant');
        if (btnBatchAddC) {
            btnBatchAddC.onclick = () => this.openBatchContestantModal();
        }

        const btnCancelC = document.getElementById('btn-cancel-c-modal');
        if (btnCancelC) {
            btnCancelC.onclick = () => App.closeModal('modal-contestant');
        }

        const formC = document.getElementById('form-contestant');
        if (formC) {
            formC.onsubmit = (e) => {
                e.preventDefault();
                this.saveContestant();
            };
        }

        const btnCancelBatchC = document.getElementById('btn-cancel-batch-c-modal');
        if (btnCancelBatchC) {
            btnCancelBatchC.onclick = () => App.closeModal('modal-batch-contestant');
        }

        const formBatchC = document.getElementById('form-batch-contestant');
        if (formBatchC) {
            formBatchC.onsubmit = (e) => {
                e.preventDefault();
                this.submitBatchContestants();
            };
        }

        const btnDemoBatch = document.getElementById('btn-demo-batch');
        if (btnDemoBatch) {
            btnDemoBatch.onclick = () => {
                document.getElementById('batch-c-text').value = 
                    "MC-11 | โอม | อภิสิทธิ์ ชัยชนะ | สารสนเทศศาสตร์ | https://drive.google.com/file/d/1Bzx7y8z9aBCDEFG/view\n" +
                    "MC-12 | โบว์ | ณิชาภัทร วงศ์ดี | วิทยาการคอมพิวเตอร์ | https://drive.google.com/file/d/1Bzx7y8z9bHIJKLMN/view";
            };
        }

        // Pair Modals
        const btnAddPair = document.getElementById('btn-add-pair');
        if (btnAddPair) {
            btnAddPair.onclick = () => this.openAddPairModal();
        }

        const btnCancelPair = document.getElementById('btn-cancel-pair-modal');
        if (btnCancelPair) {
            btnCancelPair.onclick = () => App.closeModal('modal-pair');
        }

        const formPair = document.getElementById('form-pair');
        if (formPair) {
            formPair.onsubmit = (e) => {
                e.preventDefault();
                this.savePair();
            };
        }

        // Pair Round Filter Sub-tabs
        document.querySelectorAll('#pair-filter-tabs .pair-filter-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#pair-filter-tabs .pair-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentPairFilter = btn.getAttribute('data-round');
                this.loadPairsTable();
            };
        });

        // Criteria Modals & Filter Tabs
        const btnAddCrit = document.getElementById('btn-add-criterion');
        if (btnAddCrit) {
            btnAddCrit.onclick = () => this.openAddCriterionModal();
        }

        const btnCancelCrit = document.getElementById('btn-cancel-crit-modal');
        if (btnCancelCrit) {
            btnCancelCrit.onclick = () => App.closeModal('modal-criterion');
        }

        const formCrit = document.getElementById('form-criterion');
        if (formCrit) {
            formCrit.onsubmit = (e) => {
                e.preventDefault();
                this.saveCriterion();
            };
        }

        document.querySelectorAll('#criteria-filter-tabs .criteria-filter-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#criteria-filter-tabs .criteria-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentCriteriaFilter = btn.getAttribute('data-round');
                this.loadCriteriaTable();
            };
        });

        // Google Sheets Integration Events
        const btnSaveGsUrl = document.getElementById('btn-save-gsheet-url');
        if (btnSaveGsUrl) {
            btnSaveGsUrl.onclick = () => this.saveGSheetUrl();
        }

        const btnSyncGsNow = document.getElementById('btn-sync-gsheet-now');
        if (btnSyncGsNow) {
            btnSyncGsNow.onclick = () => this.syncGSheetNow();
        }

        const btnCopyGsCode = document.getElementById('btn-copy-gs-code');
        if (btnCopyGsCode) {
            btnCopyGsCode.onclick = () => this.copyGSheetCode();
        }

        const btnCopyGsCodeModal = document.getElementById('btn-copy-gs-code-modal');
        if (btnCopyGsCodeModal) {
            btnCopyGsCodeModal.onclick = () => this.copyGSheetCode();
        }

        const btnGsGuide = document.getElementById('btn-gs-guide-modal');
        if (btnGsGuide) {
            btnGsGuide.onclick = () => App.openModal('modal-gs-guide');
        }

        const btnCloseGsGuide = document.getElementById('btn-close-gs-guide');
        if (btnCloseGsGuide) {
            btnCloseGsGuide.onclick = () => App.closeModal('modal-gs-guide');
        }

        const btnCloseGsGuide2 = document.getElementById('btn-close-gs-guide-2');
        if (btnCloseGsGuide2) {
            btnCloseGsGuide2.onclick = () => App.closeModal('modal-gs-guide');
        }

        // Add Judge Button & Modal
        const btnAddJudge = document.getElementById('btn-add-judge');
        if (btnAddJudge) {
            btnAddJudge.onclick = () => this.openAddJudgeModal();
        }

        const btnCancelJudge = document.getElementById('btn-cancel-judge-modal');
        if (btnCancelJudge) {
            btnCancelJudge.onclick = () => App.closeModal('modal-judge');
        }

        const formJudge = document.getElementById('form-judge');
        if (formJudge) {
            formJudge.onsubmit = (e) => {
                e.preventDefault();
                this.saveJudge();
            };
        }

        // Winner stage modal
        const btnWinner = document.getElementById('btn-winner-stage-trigger');
        if (btnWinner) {
            btnWinner.onclick = () => this.openWinnerStage();
        }

        const btnCloseWinner = document.getElementById('btn-close-winner');
        if (btnCloseWinner) {
            btnCloseWinner.onclick = () => App.closeModal('modal-winner-stage');
        }

        // Round CRUD
        const btnAddRound = document.getElementById('btn-add-round');
        if (btnAddRound) {
            btnAddRound.onclick = () => this.openAddRoundModal();
        }

        const btnCancelRound = document.getElementById('btn-cancel-round-modal');
        if (btnCancelRound) {
            btnCancelRound.onclick = () => App.closeModal('modal-round');
        }

        const formRound = document.getElementById('form-round');
        if (formRound) {
            formRound.onsubmit = (e) => {
                e.preventDefault();
                this.saveRound();
            };
        }

        // Export button
        const btnExport = document.getElementById('btn-export-trigger');
        if (btnExport) {
            btnExport.onclick = () => Export.openExportModal(this.state.dashboard);
        }
    },

    loadDashboard: async function() {
        // Instant render from localStorage cache (0ms UI latency!)
        const cached = localStorage.getItem('mc_admin_cache');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                this.state.dashboard = data;
                this.state.selectedRoundId = data.round.id;
                this.renderRoundSelectOptions();
                this.renderScoreboard();
                this.renderRoundControls();
                this.renderContestantsTable();
            } catch (e) {}
        }

        try {
            const url = this.state.selectedRoundId ? `/api/admin/dashboard?round_id=${this.state.selectedRoundId}` : '/api/admin/dashboard';
            const data = await App.apiFetch(url);
            this.state.dashboard = data;
            this.state.selectedRoundId = data.round.id;
            localStorage.setItem('mc_admin_cache', JSON.stringify(data));

            this.renderRoundSelectOptions();
            this.renderScoreboard();
            this.renderRoundControls();
            this.renderContestantsTable();
            this.loadPairsTable();
            this.loadGSheetConfig();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    loadGSheetConfig: async function() {
        try {
            const res = await App.apiFetch('/api/admin/gsheet_config');
            const input = document.getElementById('gsheet-url-input');
            if (input && res.gsheet_url) {
                input.value = res.gsheet_url;
            }
        } catch (e) {
            // Ignore error
        }
    },

    saveGSheetUrl: async function() {
        const url = document.getElementById('gsheet-url-input').value.trim();
        try {
            const res = await App.apiFetch('/api/admin/gsheet_config', 'POST', { gsheet_url: url });
            App.showToast(`✅ ${res.message}`, 'success');
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    syncGSheetNow: async function() {
        App.showToast('⏳ กำลังทำการส่งซิงค์ข้อมูลทั้งหมดไปยัง Google Sheets...', 'info');
        try {
            const res = await App.apiFetch('/api/admin/gsheet_sync_now', 'POST');
            App.showToast(`✅ ${res.message}`, 'success');
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    copyGSheetCode: async function() {
        try {
            const response = await fetch('/Code.gs');
            let text = '';
            if (response.ok) {
                text = await response.text();
            } else {
                text = `// กรุณาคัดลอกโค้ดจากไฟล์ Code.gs ในโฟลเดอร์โครงการ`;
            }
            await navigator.clipboard.writeText(text);
            App.showToast('📋 คัดลอกโค้ด Code.gs สำเร็จ! นำไปวางใน Apps Script ได้ทันที', 'success');
        } catch (e) {
            App.showToast('คัดลอกไม่สำเร็จ กรุณาเปิดไฟล์ Code.gs จากโฟลเดอร์โครงการเพื่อคัดลอก', 'error');
        }
    },

    renderRoundSelectOptions: function() {
        const sel = document.getElementById('admin-select-round');
        if (!sel || !this.state.dashboard) return;

        sel.innerHTML = this.state.dashboard.all_rounds.map(r => `
            <option value="${r.id}" ${r.id === this.state.dashboard.round.id ? 'selected' : ''}>
                ${r.name} — ${r.subtitle} ${r.is_active ? '(เปิดอยู่)' : ''}
            </option>
        `).join('');
    },

    renderScoreboard: function() {
        const d = this.state.dashboard;
        if (!d) return;

        const tbody = document.getElementById('admin-scoreboard-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        d.leaderboard.forEach(item => {
            const c = item.contestant;
            const tr = document.createElement('tr');

            let rankClass = '';
            if (item.rank === 1) rankClass = 'rank-1';
            else if (item.rank === 2) rankClass = 'rank-2';
            else if (item.rank === 3) rankClass = 'rank-3';

            const j1 = item.judge_scores[d.judges[0]?.id] || { submitted: false };
            const j2 = item.judge_scores[d.judges[1]?.id] || { submitted: false };
            const j3 = item.judge_scores[d.judges[2]?.id] || { submitted: false };

            tr.innerHTML = `
                <td style="text-align: center;" class="${rankClass}">
                    ${item.rank === 1 ? '🥇 1' : item.rank === 2 ? '🥈 2' : item.rank === 3 ? '🥉 3' : item.rank}
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${c.avatar_url}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: #1e293b;">
                        <div>
                            <div style="font-weight: 700; color: #fff;">${c.code}: ${c.name}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${c.faculty}</div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">
                    ${j1.submitted ? `<span class="badge badge-success">${j1.total.toFixed(2)}</span>` : `<span class="badge badge-muted">ยังไม่ส่ง</span>`}
                </td>
                <td style="text-align: center;">
                    ${j2.submitted ? `<span class="badge badge-success">${j2.total.toFixed(2)}</span>` : `<span class="badge badge-muted">ยังไม่ส่ง</span>`}
                </td>
                <td style="text-align: center;">
                    ${j3.submitted ? `<span class="badge badge-success">${j3.total.toFixed(2)}</span>` : `<span class="badge badge-muted">ยังไม่ส่ง</span>`}
                </td>
                <td style="text-align: center; font-weight: 700;">
                    ${item.sum_score.toFixed(2)}
                </td>
                <td style="text-align: center; font-weight: 800; font-size: 1.1rem; color: var(--text-gold);">
                    ${item.avg_score.toFixed(2)}
                </td>
                <td style="text-align: center;">
                    ${item.voted_judges_count === d.total_judges ? `
                        <span class="badge badge-gold">ครบ 3 ท่าน</span>
                    ` : `
                        <span class="badge badge-cyan">${item.voted_judges_count}/${d.total_judges} ท่าน</span>
                    `}
                </td>
            `;

            tbody.appendChild(tr);
        });
    },

    renderRoundControls: function() {
        const d = this.state.dashboard;
        if (!d) return;

        const container = document.getElementById('admin-rounds-list');
        if (!container) return;
        container.innerHTML = '';

        d.all_rounds.forEach(r => {
            const card = document.createElement('div');
            card.style.cssText = 'background: rgba(15,23,42,0.6); border: 1px solid var(--border-color); padding: 18px; border-radius: var(--radius-md); margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;';
            if (r.is_active) card.style.borderColor = 'var(--border-gold)';

            card.innerHTML = `
                <div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="badge ${r.is_active ? 'badge-gold' : 'badge-muted'}">${r.code}</span>
                        <h4 style="font-size: 1.2rem; color: #fff;">${r.name} — ${r.subtitle}</h4>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                        คะแนนเต็ม ${r.max_score} คะแนน &bull; ${r.is_active ? '🟢 กำลังเปิดให้ลงคะแนน' : '⚪ ปิดอยู่'}
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    ${r.is_active ? `
                        <button class="btn btn-secondary btn-sm" disabled style="opacity: 0.6;">
                            🟢 รอบปัจจุบัน
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-sm btn-activate-round" data-id="${r.id}">
                            ⚡ เปิดรอบนี้
                        </button>
                    `}
                    <button class="btn btn-secondary btn-sm btn-edit-round" data-id="${r.id}">
                        ✏️ แก้ไข
                    </button>
                    ${!r.is_active ? `
                        <button class="btn btn-danger btn-sm btn-delete-round" data-id="${r.id}">
                            🗑️ ลบ
                        </button>
                    ` : ''}
                </div>
            `;
            container.appendChild(card);
        });

        container.querySelectorAll('.btn-activate-round').forEach(btn => {
            btn.onclick = async () => {
                const rId = parseInt(btn.getAttribute('data-id'));
                try {
                    const res = await App.apiFetch('/api/rounds/activate', 'POST', { round_id: rId });
                    App.showToast(`✅ ${res.message}`, 'success');
                    await this.loadDashboard();
                } catch (err) {
                    App.showToast(err.message, 'error');
                }
            };
        });

        container.querySelectorAll('.btn-edit-round').forEach(btn => {
            btn.onclick = () => {
                const rId = parseInt(btn.getAttribute('data-id'));
                const round = d.all_rounds.find(x => x.id === rId);
                if (round) this.openEditRoundModal(round);
            };
        });

        container.querySelectorAll('.btn-delete-round').forEach(btn => {
            btn.onclick = () => {
                const rId = btn.getAttribute('data-id');
                this.deleteRound(rId);
            };
        });
    },

    openAddRoundModal: function() {
        document.getElementById('modal-round-title').textContent = '🏆 เพิ่มรอบการแข่งขันใหม่';
        document.getElementById('round-edit-id').value = '';
        document.getElementById('round-code-input').value = '';
        document.getElementById('round-name-input').value = '';
        document.getElementById('round-subtitle-input').value = '';
        document.getElementById('round-max-score-input').value = '100';
        document.getElementById('round-order-input').value = (this.state.dashboard?.all_rounds?.length || 0) + 1;

        App.openModal('modal-round');
    },

    openEditRoundModal: function(round) {
        document.getElementById('modal-round-title').textContent = '✏️ แก้ไขข้อมูลรอบการแข่งขัน';
        document.getElementById('round-edit-id').value = round.id;
        document.getElementById('round-code-input').value = round.code;
        document.getElementById('round-name-input').value = round.name;
        document.getElementById('round-subtitle-input').value = round.subtitle;
        document.getElementById('round-max-score-input').value = round.max_score || 100;
        document.getElementById('round-order-input').value = round.sort_order || 1;

        App.openModal('modal-round');
    },

    saveRound: async function() {
        const rId = document.getElementById('round-edit-id').value;
        const code = document.getElementById('round-code-input').value.trim();
        const name = document.getElementById('round-name-input').value.trim();
        const subtitle = document.getElementById('round-subtitle-input').value.trim();
        const max_score = parseFloat(document.getElementById('round-max-score-input').value) || 100;
        const sort_order = parseInt(document.getElementById('round-order-input').value) || 1;

        if (!code || !name) {
            App.showToast('กรุณากรอกรหัสรอบและชื่อรอบให้ครบถ้วน', 'error');
            return;
        }

        try {
            if (rId) {
                await App.apiFetch(`/api/rounds/${rId}`, 'PUT', { code, name, subtitle, max_score, sort_order });
                App.showToast('แก้ไขรอบการแข่งขันเรียบร้อยแล้ว', 'success');
            } else {
                await App.apiFetch('/api/rounds', 'POST', { code, name, subtitle, max_score, sort_order });
                App.showToast('เพิ่มรอบการแข่งขันใหม่เรียบร้อยแล้ว', 'success');
            }

            App.closeModal('modal-round');
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    deleteRound: async function(rId) {
        if (!confirm('คุณต้องการลบรอบการแข่งขันนี้ใช่หรือไม่? (เกณฑ์คะแนนประจำรอบนี้จะถูกลบไปด้วย)')) return;

        try {
            await App.apiFetch(`/api/rounds/${rId}`, 'DELETE');
            App.showToast('ลบรอบการแข่งขันเรียบร้อยแล้ว', 'success');
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    renderContestantsTable: function() {
        const d = this.state.dashboard;
        if (!d) return;

        const tbody = document.getElementById('admin-contestants-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        d.leaderboard.forEach(item => {
            const c = item.contestant;
            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td style="font-weight: 700; color: var(--text-gold);">${c.code}</td>
                <td><img src="${c.avatar_url}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #1e293b;"></td>
                <td style="font-weight: 600; color: #fff;">${c.name}</td>
                <td>${c.nickname || '-'}</td>
                <td>${c.faculty}</td>
                <td style="text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <button class="btn btn-secondary btn-sm btn-edit-c" data-id="${c.id}">
                            ✏️ แก้ไข
                        </button>
                        <button class="btn btn-danger btn-sm btn-delete-c" data-id="${c.id}">
                            🗑️ ลบ
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-edit-c').forEach(btn => {
            btn.onclick = () => {
                const cId = parseInt(btn.getAttribute('data-id'));
                const item = d.leaderboard.find(x => x.contestant.id === cId);
                if (item) this.openEditContestantModal(item.contestant);
            };
        });

        tbody.querySelectorAll('.btn-delete-c').forEach(btn => {
            btn.onclick = () => {
                const cId = btn.getAttribute('data-id');
                this.deleteContestant(cId);
            };
        });
    },

    openAddContestantModal: function() {
        document.getElementById('modal-c-title').textContent = '🎤 เพิ่มผู้เข้าแข่งขัน';
        document.getElementById('c-edit-id').value = '';
        document.getElementById('c-code-input').value = '';
        document.getElementById('c-name-input').value = '';
        document.getElementById('c-nickname-input').value = '';
        document.getElementById('c-faculty-input').value = 'สารสนเทศศาสตร์ (ISKKU)';
        document.getElementById('c-avatar-input').value = '';
        document.getElementById('c-bio-input').value = '';

        App.openModal('modal-contestant');
    },

    openEditContestantModal: function(c) {
        document.getElementById('modal-c-title').textContent = '✏️ แก้ไขข้อมูลผู้เข้าแข่งขัน';
        document.getElementById('c-edit-id').value = c.id;
        document.getElementById('c-code-input').value = c.code;
        document.getElementById('c-name-input').value = c.name;
        document.getElementById('c-nickname-input').value = c.nickname || '';
        document.getElementById('c-faculty-input').value = c.faculty || 'ISKKU';
        document.getElementById('c-avatar-input').value = c.avatar_url || '';
        document.getElementById('c-bio-input').value = c.bio || '';

        App.openModal('modal-contestant');
    },

    saveContestant: async function() {
        const cId = document.getElementById('c-edit-id').value;
        const code = document.getElementById('c-code-input').value.trim();
        const name = document.getElementById('c-name-input').value.trim();
        const nickname = document.getElementById('c-nickname-input').value.trim();
        const faculty = document.getElementById('c-faculty-input').value.trim();
        const avatar_url = document.getElementById('c-avatar-input').value.trim();
        const bio = document.getElementById('c-bio-input').value.trim();

        if (!code || !name) {
            App.showToast('กรุณากรอกรหัสประจำตัวและชื่อ-นามสกุล', 'error');
            return;
        }

        try {
            if (cId) {
                await App.apiFetch(`/api/contestants/${cId}`, 'PUT', { code, name, nickname, faculty, avatar_url, bio });
                App.showToast('แก้ไขข้อมูลผู้เข้าแข่งขันเรียบร้อยแล้ว', 'success');
            } else {
                await App.apiFetch('/api/contestants', 'POST', { code, name, nickname, faculty, avatar_url, bio });
                App.showToast('เพิ่มผู้เข้าแข่งขันเรียบร้อยแล้ว', 'success');
            }

            App.closeModal('modal-contestant');
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    deleteContestant: async function(cId) {
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบผู้เข้าแข่งขันรายนี้?')) {
            try {
                await App.apiFetch(`/api/contestants/${cId}`, 'DELETE');
                App.showToast('ลบผู้เข้าแข่งขันเรียบร้อยแล้ว', 'success');
                await this.loadDashboard();
            } catch (err) {
                App.showToast(err.message, 'error');
            }
        }
    },

    openBatchContestantModal: function() {
        document.getElementById('batch-c-text').value = '';
        App.openModal('modal-batch-contestant');
    },

    submitBatchContestants: async function() {
        const rawText = document.getElementById('batch-c-text').value.trim();
        if (!rawText) return;

        const lines = rawText.split('\n');
        const items = [];

        lines.forEach(line => {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) {
                items.push({
                    code: parts[0],
                    nickname: parts.length > 2 ? parts[1] : '',
                    name: parts.length > 2 ? parts[2] : parts[1],
                    faculty: parts.length > 3 ? parts[3] : 'สารสนเทศศาสตร์ (ISKKU)',
                    avatar_url: parts.length > 4 ? parts[4] : ''
                });
            }
        });

        if (items.length === 0) {
            App.showToast('รูปแบบข้อมูลไม่ถูกต้อง กรุณาใช้อักขระ | คั่นข้อมูล', 'error');
            return;
        }

        try {
            const res = await App.apiFetch('/api/contestants/batch', 'POST', { items });
            App.showToast(`✅ ${res.message}`, 'success');
            App.closeModal('modal-batch-contestant');
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    loadPairsTable: async function(silent = false) {
        try {
            const res = await App.apiFetch('/api/pairs');
            const allPairs = res.pairs || [];

            const filter = this.state.currentPairFilter || 'all';
            const pairs = (filter === 'all') ? allPairs : allPairs.filter(p => p.round_id == filter);

            const tbody = document.getElementById('admin-pairs-tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (pairs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">ไม่มีรายการจับคู่สำหรับรอบนี้ (กดปุ่ม "เพิ่มคู่แข่งขันใหม่" ด้านบนเพื่อจัดคู่)</td></tr>`;
                return;
            }

            pairs.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="badge badge-gold">${p.round_name} (${p.round_subtitle})</span></td>
                    <td style="text-align: center; font-weight: 700; color: var(--text-gold);">คู่ที่ ${p.pair_number}</td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <img src="${p.c1_avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">
                            <span style="font-weight: 600; color: #fff;">${p.c1_code}: ${p.c1_name}</span>
                        </div>
                    </td>
                    <td style="text-align: center; color: var(--text-rose); font-weight: 800;">VS</td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <img src="${p.c2_avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">
                            <span style="font-weight: 600; color: #fff;">${p.c2_code}: ${p.c2_name}</span>
                        </div>
                    </td>
                    <td style="font-size: 0.85rem; color: var(--text-cyan);">
                        ${p.keywords ? `<strong>Keywords:</strong> ${p.keywords}` : ''}
                        ${p.topic ? `<strong>Topic/โจทย์:</strong> ${p.topic}` : ''}
                    </td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button class="btn btn-secondary btn-sm btn-edit-pair" data-id="${p.id}">
                                ✏️ แก้ไข
                            </button>
                            <button class="btn btn-danger btn-sm btn-delete-pair" data-id="${p.id}">
                                🗑️ ลบ
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('.btn-edit-pair').forEach(btn => {
                btn.onclick = () => {
                    const pId = parseInt(btn.getAttribute('data-id'));
                    const pair = allPairs.find(x => x.id === pId);
                    if (pair) this.openEditPairModal(pair);
                };
            });

            tbody.querySelectorAll('.btn-delete-pair').forEach(btn => {
                btn.onclick = () => {
                    const pId = btn.getAttribute('data-id');
                    this.deletePair(pId);
                };
            });
        } catch (err) {
            console.error(err);
        }
    },

    openAddPairModal: function() {
        document.getElementById('modal-pair-title').textContent = '⚔️ เพิ่มคู่แข่งขันใหม่';
        document.getElementById('pair-edit-id').value = '';
        document.getElementById('pair-round-select').value = '2';
        document.getElementById('pair-num-input').value = '1';
        document.getElementById('pair-keywords-input').value = '';
        document.getElementById('pair-topic-input').value = '';

        this.populatePairContestantsDropdowns();
        App.openModal('modal-pair');
    },

    openEditPairModal: function(pair) {
        document.getElementById('modal-pair-title').textContent = '✏️ แก้ไขการจับคู่แข่งขัน';
        document.getElementById('pair-edit-id').value = pair.id;
        document.getElementById('pair-round-select').value = pair.round_id;
        document.getElementById('pair-num-input').value = pair.pair_number;
        document.getElementById('pair-keywords-input').value = pair.keywords || '';
        document.getElementById('pair-topic-input').value = pair.topic || '';

        this.populatePairContestantsDropdowns(pair.contestant1_id, pair.contestant2_id);
        App.openModal('modal-pair');
    },

    populatePairContestantsDropdowns: function(c1Selected = null, c2Selected = null) {
        const contestants = (this.state.dashboard?.leaderboard || []).map(x => x.contestant);
        const sel1 = document.getElementById('pair-c1-select');
        const sel2 = document.getElementById('pair-c2-select');

        if (!sel1 || !sel2) return;

        const optionsHtml = contestants.map(c => `
            <option value="${c.id}">${c.code}: ${c.name} (${c.nickname || '-'})</option>
        `).join('');

        sel1.innerHTML = optionsHtml;
        sel2.innerHTML = optionsHtml;

        if (c1Selected) sel1.value = c1Selected;
        if (c2Selected) sel2.value = c2Selected;
        else if (contestants.length > 1) sel2.value = contestants[1].id;
    },

    savePair: async function() {
        const pairId = document.getElementById('pair-edit-id').value;
        const round_id = parseInt(document.getElementById('pair-round-select').value);
        const pair_number = parseInt(document.getElementById('pair-num-input').value) || 1;
        const contestant1_id = parseInt(document.getElementById('pair-c1-select').value);
        const contestant2_id = parseInt(document.getElementById('pair-c2-select').value);
        const keywords = document.getElementById('pair-keywords-input').value.trim();
        const topic = document.getElementById('pair-topic-input').value.trim();

        if (contestant1_id === contestant2_id) {
            App.showToast('กรุณาเลือกผู้เข้าแข่งขัน 2 คนที่ไม่ซ้ำกัน', 'error');
            return;
        }

        try {
            if (pairId) {
                await App.apiFetch(`/api/pairs/${pairId}`, 'PUT', { round_id, pair_number, contestant1_id, contestant2_id, keywords, topic });
                App.showToast('แก้ไขข้อมูลคู่แข่งขันเรียบร้อยแล้ว', 'success');
            } else {
                await App.apiFetch('/api/pairs', 'POST', { round_id, pair_number, contestant1_id, contestant2_id, keywords, topic });
                App.showToast('เพิ่มคู่แข่งขันเรียบร้อยแล้ว', 'success');
            }

            App.closeModal('modal-pair');
            await this.loadPairsTable();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    deletePair: async function(pairId) {
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบการจับคู่นี้?')) {
            try {
                await App.apiFetch(`/api/pairs/${pairId}`, 'DELETE');
                App.showToast('ลบข้อมูลการจับคู่เรียบร้อยแล้ว', 'success');
                await this.loadPairsTable();
            } catch (err) {
                App.showToast(err.message, 'error');
            }
        }
    },

    loadCriteriaTable: async function(silent = false) {
        try {
            const res = await App.apiFetch('/api/criteria');
            const allCriteria = res.criteria || [];

            const filter = this.state.currentCriteriaFilter || 'all';
            const criteria = (filter === 'all') ? allCriteria : allCriteria.filter(c => c.round_id == filter);

            const tbody = document.getElementById('admin-criteria-tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (criteria.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">ไม่มีข้อมูลเกณฑ์คะแนนสำหรับรอบนี้ (กดปุ่ม "เพิ่มเกณฑ์คะแนนใหม่" เพื่อจัดเกณฑ์)</td></tr>`;
                return;
            }

            criteria.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="badge badge-gold">${c.round_name}</span></td>
                    <td style="font-size: 0.85rem; color: var(--text-cyan);">${c.part_name || '-'}</td>
                    <td style="font-weight: 600; color: #fff;">${c.name}</td>
                    <td style="text-align: center; font-weight: 700; color: var(--text-gold);">${c.max_score} คะแนน</td>
                    <td style="text-align: center;">${c.sort_order}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button class="btn btn-secondary btn-sm btn-edit-crit" data-id="${c.id}">
                                ✏️ แก้ไข
                            </button>
                            <button class="btn btn-danger btn-sm btn-delete-crit" data-id="${c.id}">
                                🗑️ ลบ
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('.btn-edit-crit').forEach(btn => {
                btn.onclick = () => {
                    const cId = parseInt(btn.getAttribute('data-id'));
                    const crit = allCriteria.find(x => x.id === cId);
                    if (crit) this.openEditCriterionModal(crit);
                };
            });

            tbody.querySelectorAll('.btn-delete-crit').forEach(btn => {
                btn.onclick = () => {
                    const cId = btn.getAttribute('data-id');
                    this.deleteCriterion(cId);
                };
            });
        } catch (err) {
            console.error(err);
        }
    },

    openAddCriterionModal: function() {
        document.getElementById('modal-crit-title').textContent = '🎯 เพิ่มเกณฑ์การให้คะแนน';
        document.getElementById('crit-edit-id').value = '';
        document.getElementById('crit-round-select').value = '1';
        document.getElementById('crit-order-input').value = '1';
        document.getElementById('crit-part-input').value = '';
        document.getElementById('crit-name-input').value = '';
        document.getElementById('crit-max-score-input').value = '25';

        App.openModal('modal-criterion');
    },

    openEditCriterionModal: function(crit) {
        document.getElementById('modal-crit-title').textContent = '✏️ แก้ไขเกณฑ์การให้คะแนน';
        document.getElementById('crit-edit-id').value = crit.id;
        document.getElementById('crit-round-select').value = crit.round_id;
        document.getElementById('crit-order-input').value = crit.sort_order;
        document.getElementById('crit-part-input').value = crit.part_name || '';
        document.getElementById('crit-name-input').value = crit.name;
        document.getElementById('crit-max-score-input').value = crit.max_score;

        App.openModal('modal-criterion');
    },

    saveCriterion: async function() {
        const cId = document.getElementById('crit-edit-id').value;
        const round_id = parseInt(document.getElementById('crit-round-select').value);
        const sort_order = parseInt(document.getElementById('crit-order-input').value) || 1;
        const part_name = document.getElementById('crit-part-input').value.trim();
        const name = document.getElementById('crit-name-input').value.trim();
        const max_score = parseFloat(document.getElementById('crit-max-score-input').value) || 10.0;

        if (!name) {
            App.showToast('กรุณากรอกชื่อเกณฑ์การให้คะแนน', 'error');
            return;
        }

        try {
            if (cId) {
                await App.apiFetch(`/api/criteria/${cId}`, 'PUT', { round_id, sort_order, part_name, name, max_score });
                App.showToast('แก้ไขเกณฑ์คะแนนเรียบร้อยแล้ว', 'success');
            } else {
                await App.apiFetch('/api/criteria', 'POST', { round_id, sort_order, part_name, name, max_score });
                App.showToast('เพิ่มเกณฑ์คะแนนเรียบร้อยแล้ว', 'success');
            }

            App.closeModal('modal-criterion');
            await this.loadCriteriaTable();
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    deleteCriterion: async function(cId) {
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบเกณฑ์การให้คะแนนนี้?')) {
            try {
                await App.apiFetch(`/api/criteria/${cId}`, 'DELETE');
                App.showToast('ลบเกณฑ์คะแนนเรียบร้อยแล้ว', 'success');
                await this.loadCriteriaTable();
                await this.loadDashboard();
            } catch (err) {
                App.showToast(err.message, 'error');
            }
        }
    },

    promptAddContestant: async function() {
        const code = prompt('กรอกรหัสผู้เข้าแข่งขัน (เช่น MC-11):');
        if (!code) return;
        const name = prompt('กรอกชื่อ-นามสกุล ผู้เข้าแข่งขัน:');
        if (!name) return;
        const nickname = prompt('กรอกชื่อเล่น (ถ้ามี):') || '';
        const faculty = prompt('กรอกคณะ/สาขาวิชา:', 'สารสนเทศศาสตร์ (ISKKU)') || 'ISKKU';

        try {
            await App.apiFetch('/api/contestants', 'POST', { code, name, nickname, faculty });
            App.showToast('เพิ่มผู้เข้าแข่งขันเรียบร้อยแล้ว', 'success');
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    loadAuditLogs: async function(silent = false) {
        try {
            const res = await App.apiFetch('/api/admin/audit_logs');
            this.state.logs = res.logs;
            const container = document.getElementById('admin-audit-logs-container');
            container.innerHTML = res.logs.map(log => `
                <div class="log-item">
                    <span class="log-time">[${log.timestamp}]</span>
                    <span class="log-user">${log.user_name}</span>
                    <span class="log-action">${log.action}</span>
                    <span class="log-details">${log.details}</span>
                </div>
            `).join('');
        } catch (err) {
            if (!silent) App.showToast(err.message, 'error');
        }
    },

    openWinnerStage: function() {
        const d = this.state.dashboard;
        if (!d) return;

        const winnersContainer = document.getElementById('winner-announcement-cards');
        winnersContainer.innerHTML = '';

        const top3 = d.leaderboard.slice(0, 3);
        const titles = ['🏆 MC OF ISKKU 2026 (ผู้ชนะเลิศ)', '🥈 รองชนะเลิศอันดับ 1', '🥉 รองชนะเลิศอันดับ 2'];

        top3.forEach((item, idx) => {
            const c = item.contestant;
            const card = document.createElement('div');
            card.className = 'winner-card';
            card.innerHTML = `
                <div class="badge badge-gold" style="font-size: 1rem; margin-bottom: 12px;">${titles[idx]}</div>
                <img src="${c.avatar_url}" style="width: 110px; height: 110px; border-radius: 50%; border: 4px solid var(--text-gold); margin-bottom: 12px;">
                <h2 style="font-size: 1.8rem; color: #fff; margin-bottom: 4px;">${c.name} (${c.code})</h2>
                <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 12px;">${c.faculty}</p>
                <div style="font-size: 2.2rem; font-weight: 800; color: var(--text-gold);">
                    คะแนนเฉลี่ย: ${item.avg_score.toFixed(2)} / 100
                </div>
            `;
            winnersContainer.appendChild(card);
        });

        App.openModal('modal-winner-stage');
    },

    loadJudgesTable: async function(silent = false) {
        try {
            const res = await App.apiFetch('/api/judges');
            const judges = res.judges || [];

            const tbody = document.getElementById('admin-judges-tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const currentUserId = App.state.currentUser ? App.state.currentUser.id : null;

            judges.forEach(j => {
                const tr = document.createElement('tr');
                const avatarUrl = j.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${j.username}`;
                const roleBadge = j.role === 'admin' 
                    ? `<span class="badge badge-gold">👑 ผู้ดูแลระบบ (Admin)</span>`
                    : `<span class="badge badge-cyan">👨‍⚖️ กรรมการ (Judge)</span>`;

                const isSelf = (currentUserId && j.id === currentUserId);
                const deleteBtnHtml = isSelf
                    ? `<button class="btn btn-secondary btn-sm" disabled title="ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่">🚫 บัญชีปัจจุบัน</button>`
                    : `<button class="btn btn-danger btn-sm btn-delete-judge" data-id="${j.id}">🗑️ ลบ</button>`;

                tr.innerHTML = `
                    <td><img src="${avatarUrl}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: #1e293b;"></td>
                    <td style="font-weight: 600; color: #fff;">${j.name}</td>
                    <td style="color: var(--text-cyan);">@${j.username}</td>
                    <td>${roleBadge}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button class="btn btn-secondary btn-sm btn-edit-judge" data-id="${j.id}">
                                ✏️ แก้ไข
                            </button>
                            ${deleteBtnHtml}
                        </div>
                    </td>
                `;

                tbody.appendChild(tr);
            });

            // Bind edit/delete events
            tbody.querySelectorAll('.btn-edit-judge').forEach(btn => {
                btn.onclick = () => {
                    const jId = parseInt(btn.getAttribute('data-id'));
                    const judge = judges.find(x => x.id === jId);
                    if (judge) this.openEditJudgeModal(judge);
                };
            });

            tbody.querySelectorAll('.btn-delete-judge').forEach(btn => {
                btn.onclick = () => {
                    const jId = btn.getAttribute('data-id');
                    this.deleteJudge(jId);
                };
            });
        } catch (err) {
            if (!silent) App.showToast(err.message, 'error');
        }
    },

    openAddJudgeModal: function() {
        document.getElementById('modal-judge-title').textContent = '👥 เพิ่มข้อมูลผู้ใช้งาน / แอดมินใหม่';
        document.getElementById('judge-edit-id').value = '';
        document.getElementById('judge-name-input').value = '';
        document.getElementById('judge-username-input').value = '';
        document.getElementById('judge-password-input').value = '';
        document.getElementById('judge-role-input').value = 'judge';
        document.getElementById('judge-avatar-input').value = '';
        document.getElementById('judge-pwd-note').style.display = 'none';

        App.openModal('modal-judge');
    },

    openEditJudgeModal: function(judge) {
        document.getElementById('modal-judge-title').textContent = '✏️ แก้ไขข้อมูลผู้ใช้งาน';
        document.getElementById('judge-edit-id').value = judge.id;
        document.getElementById('judge-name-input').value = judge.name;
        document.getElementById('judge-username-input').value = judge.username;
        document.getElementById('judge-password-input').value = '';
        document.getElementById('judge-role-input').value = judge.role || 'judge';
        document.getElementById('judge-avatar-input').value = judge.avatar_url || '';
        document.getElementById('judge-pwd-note').style.display = 'inline';

        App.openModal('modal-judge');
    },

    saveJudge: async function() {
        const jId = document.getElementById('judge-edit-id').value;
        const name = document.getElementById('judge-name-input').value.trim();
        const username = document.getElementById('judge-username-input').value.trim();
        const password = document.getElementById('judge-password-input').value.trim();
        const role = document.getElementById('judge-role-input').value;
        const avatar_url = document.getElementById('judge-avatar-input').value.trim();

        if (!name || !username) {
            App.showToast('กรุณากรอกชื่อและ Username ให้ครบถ้วน', 'error');
            return;
        }

        try {
            if (jId) {
                // Update existing user
                await App.apiFetch(`/api/judges/${jId}`, 'PUT', { name, username, password, role, avatar_url });
                App.showToast('แก้ไขข้อมูลผู้ใช้งานเรียบร้อยแล้ว', 'success');
            } else {
                // Create new user
                if (!password) {
                    App.showToast('กรุณากรอกรหัสผ่านสำหรับผู้ใช้งานใหม่', 'error');
                    return;
                }
                await App.apiFetch('/api/judges', 'POST', { name, username, password, role, avatar_url });
                App.showToast('เพิ่มผู้ใช้งานใหม่เรียบร้อยแล้ว', 'success');
            }

            App.closeModal('modal-judge');
            await this.loadJudgesTable();
            await this.loadDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    deleteJudge: async function(jId) {
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบกรรมการท่านนี้?')) {
            try {
                await App.apiFetch(`/api/judges/${jId}`, 'DELETE');
                App.showToast('ลบข้อมูลกรรมการเรียบร้อยแล้ว', 'success');
                await this.loadJudgesTable();
                await this.loadDashboard();
            } catch (err) {
                App.showToast(err.message, 'error');
            }
        }
    }
};

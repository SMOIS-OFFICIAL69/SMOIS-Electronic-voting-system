/* MC OF ISKKU 2026 - Judge Interface & Scoring Logic */

const Judge = {
    state: {
        dashboard: null,
        selectedContestant: null,
        currentCriteria: [],
        currentScores: {},
        isSubmitting: false,
        pollTimer: null,
        lastActiveRoundId: null
    },

    init: async function() {
        console.log("[JUDGE] Initializing judge dashboard...");
        App.showView('view-judge');
        this.bindEvents();
        await this.loadDashboard();
        this.startAutoPolling();
    },

    startAutoPolling: function() {
        if (this.state.pollTimer) clearInterval(this.state.pollTimer);
        this.state.pollTimer = setInterval(async () => {
            if (App.state.currentView !== 'view-judge' && App.state.currentView !== 'view-vote-form') {
                return;
            }
            if (document.querySelector('.modal-overlay.active:not(#modal-round-activated-alert)')) return;

            const badge = document.getElementById('judge-sync-badge');
            if (badge) badge.innerHTML = `<span class="live-dot" style="background:#f59e0b; animation-duration:0.4s;">⚡</span> กำลังดึงข้อมูลจากฐานชีต...`;

            const t0 = performance.now();
            try {
                const data = await App.apiFetch('/api/judge/dashboard');
                const t1 = performance.now();
                const ms = Math.round(t1 - t0);

                const activeRound = data.active_round;

                if (activeRound && this.state.lastActiveRoundId && this.state.lastActiveRoundId !== activeRound.id) {
                    this.showRoundActivatedAlert(activeRound);
                }

                if (activeRound) {
                    this.state.lastActiveRoundId = activeRound.id;
                }

                this.state.dashboard = data;
                localStorage.setItem('mc_judge_cache', JSON.stringify(data));
                this.renderDashboard();
                if (badge) badge.innerHTML = `<span class="live-dot">●</span> เรียลไทม์ (${ms}ms)`;
            } catch (e) {
                if (badge) badge.innerHTML = `<span class="live-dot" style="background:#ef4444;">●</span> ออฟไลน์`;
            }
        }, 1200);
    },

    showRoundActivatedAlert: function(round) {
        const modal = document.getElementById('modal-round-activated-alert');
        if (!modal) return;

        const codeBadge = document.getElementById('alert-round-code-badge');
        const nameDisplay = document.getElementById('alert-round-name-display');
        const subtitleDisplay = document.getElementById('alert-round-subtitle-display');

        if (codeBadge) codeBadge.textContent = round.code || 'ACTIVE ROUND';
        if (nameDisplay) nameDisplay.textContent = round.name || 'สลับรอบการแข่งขันใหม่!';
        if (subtitleDisplay) subtitleDisplay.textContent = round.subtitle || '';

        App.openModal('modal-round-activated-alert');
    },

    bindEvents: function() {
        const btnAckRound = document.getElementById('btn-acknowledge-round-alert');
        if (btnAckRound) {
            btnAckRound.onclick = () => {
                App.closeModal('modal-round-activated-alert');
                App.showView('view-judge');
                this.loadDashboard();
            };
        }

        const btnRefresh = document.getElementById('btn-refresh-judge');
        if (btnRefresh) {
            btnRefresh.onclick = () => this.loadDashboard();
        }

        const btnBack = document.getElementById('btn-back-to-judge');
        if (btnBack) {
            btnBack.onclick = () => App.showView('view-judge');
        }

        const btnReview = document.getElementById('btn-review-score');
        if (btnReview) {
            btnReview.onclick = () => this.openReviewModal();
        }

        const btnModalEdit = document.getElementById('btn-modal-edit');
        if (btnModalEdit) {
            btnModalEdit.onclick = () => App.closeModal('modal-review-score');
        }

        const btnModalConfirm = document.getElementById('btn-modal-confirm-submit');
        if (btnModalConfirm) {
            btnModalConfirm.onclick = () => this.submitFinalScore();
        }
    },

    loadDashboard: async function() {
        // Instant render from localStorage cache (0ms latency UI!)
        const cached = localStorage.getItem('mc_judge_cache');
        let hasCache = false;
        if (cached) {
            try {
                this.state.dashboard = JSON.parse(cached);
                this.renderDashboard();
                hasCache = true;
            } catch (e) {}
        }

        if (!hasCache) {
            App.showLoadingModal('กำลังเชื่อมต่อและโหลดข้อมูลสด...', 'ระบบกำลังดึงข้อมูลการแข่งขัน คะแนน และรายชื่อผู้เข้าแข่งขันทั้งหมดจาก Google Sheets');
        }

        try {
            const data = await App.apiFetch('/api/judge/dashboard');
            this.state.dashboard = data;
            localStorage.setItem('mc_judge_cache', JSON.stringify(data));
            this.renderDashboard();
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            App.hideLoadingModal();
        }
    },

    renderDashboard: function() {
        const d = this.state.dashboard;
        if (!d) return;

        const currentJudgeId = App.state.user ? Number(App.state.user.id) : null;
        const judgeName = d.judge_name && d.judge_name !== 'undefined' ? d.judge_name : (App.state.user ? App.state.user.name : 'กรรมการ');

        // Header info
        document.getElementById('judge-name-display').textContent = `กรรมการ: ${judgeName}`;
        if (d.active_round) {
            document.getElementById('judge-round-code').textContent = (d.active_round.code || 'ROUND 1').replace('_', ' ');
            document.getElementById('judge-round-title').textContent = `${d.active_round.name} — ${d.active_round.subtitle}`;
        }

        // Compute voted & score_info for contestants if missing
        if (d.contestants && d.contestants.length > 0) {
            d.contestants.forEach(c => {
                if (c.voted === undefined && currentJudgeId && d.leaderboard) {
                    const lbItem = d.leaderboard.find(item => item.contestant && item.contestant.id == c.id);
                    if (lbItem && lbItem.judge_scores && lbItem.judge_scores[currentJudgeId]) {
                        const js = lbItem.judge_scores[currentJudgeId];
                        c.voted = js.submitted;
                        if (c.voted) {
                            c.score_info = { total_score: js.total };
                        }
                    }
                }
                if (c.voted === undefined) c.voted = false;
                if (!c.score_info) c.score_info = { total_score: 0 };
            });
        }

        const rawContestants = d.contestants || [];
        let votedCount = (d.voted_count !== undefined && !isNaN(d.voted_count)) ? Number(d.voted_count) : rawContestants.filter(c => c.voted).length;
        let totalContestants = (d.total_contestants !== undefined && !isNaN(d.total_contestants)) ? Number(d.total_contestants) : rawContestants.length;
        let remainingCount = (d.remaining_count !== undefined && !isNaN(d.remaining_count)) ? Number(d.remaining_count) : (totalContestants - votedCount);

        // Header Stats
        document.getElementById('stat-total-contestants').textContent = `${totalContestants} คน`;
        document.getElementById('stat-voted').textContent = `${votedCount} คน`;
        document.getElementById('stat-remaining').textContent = `${remainingCount} คน`;

        // Render Pairs if Round 2, 3 or 4
        const pairsContainer = document.getElementById('judge-pairs-container');
        if (d.pairs && d.pairs.length > 0) {
            pairsContainer.style.display = 'block';
            pairsContainer.innerHTML = `
                <div class="pair-box" style="margin-bottom: 24px;">
                    <h3 class="pair-title">
                        <span>⚔️ คู่การแข่งขันประจำรอบ (${d.active_round.subtitle})</span>
                        <span class="badge badge-cyan">${d.pairs.length} คู่</span>
                    </h3>
                    <div style="display: grid; gap: 16px;">
                        ${d.pairs.map(p => {
                            const c1 = d.contestants.find(c => c.id === p.contestant1_id) || { id: p.contestant1_id, name: p.c1_name, code: p.c1_code, avatar_url: p.c1_avatar, voted: false };
                            const c2 = d.contestants.find(c => c.id === p.contestant2_id) || { id: p.contestant2_id, name: p.c2_name, code: p.c2_code, avatar_url: p.c2_avatar, voted: false };

                            return `
                            <div style="background: rgba(15,23,42,0.6); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                                <div style="font-size: 0.85rem; color: var(--text-gold); font-weight: 700; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                    <span>คู่ที่ ${p.pair_number} ${p.keywords ? `| Keyword: ${p.keywords}` : ''} ${p.topic ? `(${p.topic})` : ''}</span>
                                    <span style="font-size: 0.75rem; color: var(--text-cyan); font-weight: 400;">👉 คลิกที่การ์ดผู้เข้าแข่งขันเพื่อกดให้คะแนนได้ทันที</span>
                                </div>
                                <div class="pair-vs-grid" style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center;">
                                    <!-- Contestant 1 -->
                                    <div class="pair-contestant-card ${c1.voted ? 'voted' : 'clickable'} btn-pair-vote" data-id="${c1.id}">
                                        <img src="${c1.avatar_url}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #1e293b;">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-weight: 700; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c1.code}: ${c1.name}</div>
                                            <div style="margin-top: 4px;">
                                                ${c1.voted ? `
                                                    <span class="badge badge-success" style="font-size: 0.75rem; padding: 2px 8px;">✅ ${c1.score_info?.total_score.toFixed(2)} คะแนน</span>
                                                ` : `
                                                    <button class="btn btn-primary btn-sm" style="padding: 2px 10px; font-size: 0.75rem; font-weight: 600;">
                                                        📝 ให้คะแนน
                                                    </button>
                                                `}
                                            </div>
                                        </div>
                                    </div>

                                    <!-- VS Badge -->
                                    <div class="vs-badge" style="margin: 0 2px;">VS</div>

                                    <!-- Contestant 2 -->
                                    <div class="pair-contestant-card ${c2.voted ? 'voted' : 'clickable'} btn-pair-vote" data-id="${c2.id}" style="justify-content: flex-end; text-align: right;">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-weight: 700; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c2.code}: ${c2.name}</div>
                                            <div style="margin-top: 4px; display: flex; justify-content: flex-end;">
                                                ${c2.voted ? `
                                                    <span class="badge badge-success" style="font-size: 0.75rem; padding: 2px 8px;">✅ ${c2.score_info?.total_score.toFixed(2)} คะแนน</span>
                                                ` : `
                                                    <button class="btn btn-primary btn-sm" style="padding: 2px 10px; font-size: 0.75rem; font-weight: 600;">
                                                        📝 ให้คะแนน
                                                    </button>
                                                `}
                                            </div>
                                        </div>
                                        <img src="${c2.avatar_url}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #1e293b;">
                                    </div>
                                </div>
                            </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;

            // Bind click events on pair contestant cards!
            pairsContainer.querySelectorAll('.btn-pair-vote').forEach(card => {
                card.onclick = () => {
                    const cId = parseInt(card.getAttribute('data-id'));
                    const contestant = d.contestants.find(c => c.id === cId);
                    if (contestant) {
                        if (contestant.voted) {
                            App.showToast(`ผู้เข้าแข่งขัน ${contestant.code}: ${contestant.name} ลงคะแนนเรียบร้อยแล้ว`, 'info');
                        } else {
                            this.openVoteSheet(contestant);
                        }
                    }
                };
            });
        } else {
            pairsContainer.style.display = 'none';
        }

        // Render Contestants Grid
        const grid = document.getElementById('judge-contestant-grid');
        grid.innerHTML = '';

        d.contestants.forEach(c => {
            const card = document.createElement('div');
            card.className = `contestant-card ${c.voted ? 'voted' : ''}`;

            card.innerHTML = `
                <img src="${c.avatar_url}" alt="${c.name}" class="contestant-avatar">
                <div class="contestant-code">${c.code}</div>
                <div class="contestant-name">${c.name} ${c.nickname ? `(${c.nickname})` : ''}</div>
                <div class="contestant-faculty">${c.faculty}</div>

                ${c.voted ? `
                    <div class="badge badge-success" style="margin-bottom: 12px; font-size: 0.9rem;">
                        ✅ ลงคะแนนเรียบร้อยแล้ว
                    </div>
                    <div style="font-size: 1.2rem; font-weight: 800; color: var(--text-gold); margin-bottom: 12px;">
                        ${c.score_info.total_score.toFixed(2)} / ${d.active_round.max_score} คะแนน
                    </div>
                    <button class="btn btn-secondary btn-sm" disabled style="opacity: 0.6; cursor: not-allowed; width: 100%;">
                        🔒 ล็อกคะแนนแล้ว
                    </button>
                ` : `
                    <div class="badge badge-gold" style="margin-bottom: 12px;">
                        ⏳ ยังไม่ได้ลงคะแนน
                    </div>
                    <button class="btn btn-primary btn-sm btn-vote" data-id="${c.id}" style="width: 100%;">
                        📝 ให้คะแนน
                    </button>
                `}
            `;

            grid.appendChild(card);
        });

        // Add event listeners to vote buttons
        grid.querySelectorAll('.btn-vote').forEach(btn => {
            btn.onclick = () => {
                const cId = parseInt(btn.getAttribute('data-id'));
                const contestant = d.contestants.find(x => x.id === cId);
                this.openVoteSheet(contestant);
            };
        });
    },

    openVoteSheet: async function(contestant) {
        this.state.selectedContestant = contestant;
        this.state.currentScores = {};

        // Fetch criteria for active round
        try {
            const res = await App.apiFetch(`/api/criteria?round_id=${this.state.dashboard.active_round.id}`);
            this.state.currentCriteria = res.criteria;

            // Fill contestant details in vote form
            document.getElementById('vote-c-avatar').src = contestant.avatar_url;
            document.getElementById('vote-c-code').textContent = contestant.code;
            document.getElementById('vote-c-name').textContent = `${contestant.name} ${contestant.nickname ? `(${contestant.nickname})` : ''}`;
            document.getElementById('vote-c-faculty').textContent = contestant.faculty;
            document.getElementById('vote-round-subtitle').textContent = `รอบการแข่งขัน: ${this.state.dashboard.active_round.name} — ${this.state.dashboard.active_round.subtitle}`;

            // Check if there is pair info for this contestant
            const pairBox = document.getElementById('vote-pair-box');
            const pair = (this.state.dashboard.pairs || []).find(p => p.contestant1_id === contestant.id || p.contestant2_id === contestant.id);
            if (pair) {
                pairBox.style.display = 'block';
                const opponentCode = pair.contestant1_id === contestant.id ? pair.c2_code : pair.c1_code;
                const opponentName = pair.contestant1_id === contestant.id ? pair.c2_name : pair.c1_name;
                pairBox.innerHTML = `
                    <div style="font-weight: 700; color: var(--text-gold);">
                        ⚔️ คู่แข่งขัน: ${pair.pair_number} | แข่งร่วมกับ ${opponentCode} (${opponentName})
                    </div>
                    ${pair.keywords ? `<div style="font-size: 0.9rem; color: #fff; margin-top: 4px;">Keywords: <strong>${pair.keywords}</strong></div>` : ''}
                `;
            } else {
                pairBox.style.display = 'none';
            }

            // Render Criteria Inputs
            this.renderCriteriaInputs();
            App.showView('view-vote-form');
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    renderCriteriaInputs: function() {
        const container = document.getElementById('criteria-inputs-container');
        container.innerHTML = '';

        let lastPart = null;

        this.state.currentCriteria.forEach(crit => {
            // Initialize score to default (80% of max score for quick scoring)
            if (!(crit.id in this.state.currentScores)) {
                this.state.currentScores[crit.id] = Math.round(crit.max_score * 0.85);
            }

            // Render Part Header if Round 4 multi-part
            if (crit.part_name && crit.part_name !== lastPart) {
                lastPart = crit.part_name;
                const partTitle = document.createElement('h4');
                partTitle.style.cssText = 'color: var(--text-cyan); font-size: 1.1rem; margin: 20px 0 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;';
                partTitle.textContent = partName = crit.part_name;
                container.appendChild(partTitle);
            }

            const item = document.createElement('div');
            item.className = 'criteria-item';
            item.innerHTML = `
                <div class="criteria-header">
                    <span class="criteria-name">${crit.name}</span>
                    <span class="criteria-max">เต็ม ${crit.max_score} คะแนน</span>
                </div>
                <div class="score-input-wrapper">
                    <input type="range" class="score-slider" id="slider-${crit.id}" min="0" max="${crit.max_score}" step="0.5" value="${this.state.currentScores[crit.id]}">
                    <div class="score-number-box">
                        <button type="button" class="btn-step btn-minus" data-id="${crit.id}">-</button>
                        <input type="number" class="form-control score-num-input" id="num-${crit.id}" min="0" max="${crit.max_score}" step="0.5" value="${this.state.currentScores[crit.id]}">
                        <button type="button" class="btn-step btn-plus" data-id="${crit.id}">+</button>
                    </div>
                </div>
            `;
            container.appendChild(item);

            // Bind slider & numeric input listeners
            const slider = item.querySelector(`#slider-${crit.id}`);
            const numInput = item.querySelector(`#num-${crit.id}`);
            const btnMinus = item.querySelector(`.btn-minus`);
            const btnPlus = item.querySelector(`.btn-plus`);

            const updateScore = (val) => {
                let num = parseFloat(val) || 0;
                if (num < 0) num = 0;
                if (num > crit.max_score) num = crit.max_score;
                this.state.currentScores[crit.id] = num;
                slider.value = num;
                numInput.value = num;
                this.calculateLiveTotal();
            };

            slider.oninput = (e) => updateScore(e.target.value);
            numInput.onchange = (e) => updateScore(e.target.value);
            btnMinus.onclick = () => updateScore(this.state.currentScores[crit.id] - 1);
            btnPlus.onclick = () => updateScore(this.state.currentScores[crit.id] + 1);
        });

        this.calculateLiveTotal();
    },

    calculateLiveTotal: function() {
        let sum = 0;
        Object.values(this.state.currentScores).forEach(val => {
            sum += parseFloat(val) || 0;
        });
        document.getElementById('vote-live-total').textContent = sum.toFixed(2);
    },

    openReviewModal: function() {
        const c = this.state.selectedContestant;
        const round = this.state.dashboard.active_round;
        if (!c || !round) return;

        document.getElementById('modal-c-name').textContent = `${c.name} (${c.code})`;
        document.getElementById('modal-round-name').textContent = `${round.name} — ${round.subtitle}`;

        // Breakdown list
        const breakdownContainer = document.getElementById('modal-score-breakdown');
        breakdownContainer.innerHTML = '';

        let total = 0;
        this.state.currentCriteria.forEach(crit => {
            const score = this.state.currentScores[crit.id] || 0;
            total += score;

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.95rem;';
            row.innerHTML = `
                <span style="color: var(--text-main);">${crit.name}:</span>
                <span style="font-weight: 700; color: var(--text-gold);">${score} / ${crit.max_score}</span>
            `;
            breakdownContainer.appendChild(row);
        });

        document.getElementById('modal-total-score').textContent = `${total.toFixed(2)} / ${round.max_score}`;
        App.openModal('modal-review-score');
    },

    submitFinalScore: async function() {
        if (this.state.isSubmitting) return;
        this.state.isSubmitting = true;

        const c = this.state.selectedContestant;
        const round = this.state.dashboard.active_round;

        try {
            const res = await App.apiFetch('/api/vote', 'POST', {
                contestant_id: c.id,
                round_id: round.id,
                scores: this.state.currentScores
            });

            App.closeModal('modal-review-score');
            App.showToast(`✅ ${res.message}`, 'success');

            // Refresh judge dashboard and show list
            await this.loadDashboard();
            App.showView('view-judge');
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            this.state.isSubmitting = false;
        }
    }
};

/* =============================================
   MITRE ATT&CK Flashcards - Core Application
   Spaced Repetition (SM-2 / Anki-style)
   ============================================= */

const App = (() => {
    // ===== STATE =====
    let techniques = [];
    let mitigations = [];
    let progress = {};     // { cardId: { interval, ease, due, reps, lapses, state } }
    let settings = { newCardsPerSession: 20 };
    let currentDeck = [];  // cards for current study session
    let currentIndex = 0;
    let isFlipped = false;
    let currentMode = '';  // 'techniques' or 'mitigations'
    let sessionStats = { again: 0, hard: 0, good: 0, easy: 0, reviewed: 0 };

    // ===== CONSTANTS =====
    const STORAGE_KEY = 'mitre_flashcards_progress';
    const SETTINGS_KEY = 'mitre_flashcards_settings';
    const DAY_MS = 86400000;

    // Card states
    const STATE = { NEW: 0, LEARNING: 1, REVIEW: 2 };

    // ===== PERSISTENCE (IndexedDB + localStorage fallback) =====
    const Storage = {
        dbName: 'MitreFlashcardsDB',
        storeName: 'progress',
        db: null,

        async init() {
            try {
                this.db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open(this.dbName, 1);
                    req.onerror = () => reject(req.error);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            db.createObjectStore(this.storeName);
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                });
                return true;
            } catch {
                this.db = null;
                return false;
            }
        },

        async save(key, data) {
            const json = JSON.stringify(data);
            // Always save to localStorage as backup
            try { localStorage.setItem(key, json); } catch { /* quota */ }
            
            if (this.db) {
                try {
                    await new Promise((resolve, reject) => {
                        const tx = this.db.transaction(this.storeName, 'readwrite');
                        tx.objectStore(this.storeName).put(json, key);
                        tx.oncomplete = resolve;
                        tx.onerror = () => reject(tx.error);
                    });
                } catch { /* fallback to localStorage only */ }
            }
        },

        async load(key) {
            // Try IndexedDB first
            if (this.db) {
                try {
                    const result = await new Promise((resolve, reject) => {
                        const tx = this.db.transaction(this.storeName, 'readonly');
                        const req = tx.objectStore(this.storeName).get(key);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });
                    if (result) return JSON.parse(result);
                } catch { /* fall through */ }
            }
            // Fallback to localStorage
            try {
                const data = localStorage.getItem(key);
                if (data) return JSON.parse(data);
            } catch { /* corrupted */ }
            return null;
        }
    };

    // ===== SM-2 SPACED REPETITION (Anki-style) =====
    function getCardProgress(cardId) {
        if (!progress[cardId]) {
            progress[cardId] = {
                interval: 0,     // days
                ease: 2.5,       // ease factor (starting 250%)
                due: 0,          // timestamp when due
                reps: 0,         // successful reps in a row
                lapses: 0,       // times "again" was pressed after learning
                state: STATE.NEW
            };
        }
        return progress[cardId];
    }

    function isDue(cardId) {
        const p = progress[cardId];
        if (!p) return true; // new card
        return Date.now() >= p.due;
    }

    function scheduleCard(cardId, quality) {
        // quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
        const p = getCardProgress(cardId);
        const now = Date.now();

        if (p.state === STATE.NEW || p.state === STATE.LEARNING) {
            // Learning phase
            switch (quality) {
                case 0: // Again
                    p.interval = 0;
                    p.due = now + 60000; // 1 minute
                    p.state = STATE.LEARNING;
                    if (p.reps > 0) p.lapses++;
                    p.reps = 0;
                    break;
                case 1: // Hard
                    p.interval = 0;
                    p.due = now + 600000; // 10 minutes
                    p.state = STATE.LEARNING;
                    p.reps++;
                    break;
                case 2: // Good
                    if (p.reps >= 1) {
                        // Graduate to review
                        p.interval = 1;
                        p.due = now + DAY_MS;
                        p.state = STATE.REVIEW;
                    } else {
                        p.interval = 0;
                        p.due = now + 600000; // 10 min
                        p.state = STATE.LEARNING;
                    }
                    p.reps++;
                    break;
                case 3: // Easy
                    // Graduate immediately with 4-day interval
                    p.interval = 4;
                    p.due = now + 4 * DAY_MS;
                    p.state = STATE.REVIEW;
                    p.reps++;
                    break;
            }
        } else {
            // Review phase (SM-2)
            switch (quality) {
                case 0: // Again (lapse)
                    p.lapses++;
                    p.reps = 0;
                    p.interval = Math.max(1, Math.round(p.interval * 0.5));
                    p.ease = Math.max(1.3, p.ease - 0.2);
                    p.due = now + 600000; // 10 min relearn
                    p.state = STATE.LEARNING;
                    break;
                case 1: // Hard
                    p.interval = Math.max(1, Math.round(p.interval * 1.2));
                    p.ease = Math.max(1.3, p.ease - 0.15);
                    p.due = now + p.interval * DAY_MS;
                    p.reps++;
                    break;
                case 2: // Good
                    p.interval = Math.max(1, Math.round(p.interval * p.ease));
                    p.due = now + p.interval * DAY_MS;
                    p.reps++;
                    break;
                case 3: // Easy
                    p.interval = Math.max(1, Math.round(p.interval * p.ease * 1.3));
                    p.ease += 0.15;
                    p.due = now + p.interval * DAY_MS;
                    p.reps++;
                    break;
            }
        }

        progress[cardId] = p;
        Storage.save(STORAGE_KEY, progress);
    }

    function getNextIntervals(cardId) {
        const p = { ...getCardProgress(cardId) };
        const intervals = {};

        if (p.state === STATE.NEW || p.state === STATE.LEARNING) {
            intervals.again = '<1m';
            intervals.hard = '10m';
            intervals.good = p.reps >= 1 ? '1d' : '10m';
            intervals.easy = '4d';
        } else {
            const lapseInterval = Math.max(1, Math.round(p.interval * 0.5));
            const hardInterval = Math.max(1, Math.round(p.interval * 1.2));
            const goodInterval = Math.max(1, Math.round(p.interval * p.ease));
            const easyInterval = Math.max(1, Math.round(p.interval * p.ease * 1.3));
            
            intervals.again = '10m';
            intervals.hard = formatInterval(hardInterval);
            intervals.good = formatInterval(goodInterval);
            intervals.easy = formatInterval(easyInterval);
        }
        return intervals;
    }

    function formatInterval(days) {
        if (days < 1) return '<1d';
        if (days === 1) return '1d';
        if (days < 30) return days + 'd';
        if (days < 365) return Math.round(days / 30) + 'mo';
        return (days / 365).toFixed(1) + 'y';
    }

    // ===== DATA LOADING =====
    function loadData() {
        if (!window.MITRE_TECHNIQUES || !window.MITRE_MITIGATIONS) {
            throw new Error('Data files not loaded. Check that data/techniques.js and data/mitigations.js exist.');
        }
        techniques = window.MITRE_TECHNIQUES;
        mitigations = window.MITRE_MITIGATIONS;
    }

    // ===== VIEW MANAGEMENT =====
    function showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        window.scrollTo(0, 0);
    }

    // ===== WELCOME SCREEN =====
    function updateWelcomeStats() {
        const allCards = [...techniques.map(t => 'T:' + t.id), ...mitigations.map(m => 'M:' + m.id)];
        let newCount = 0, learningCount = 0, dueCount = 0, matureCount = 0;
        
        for (const id of allCards) {
            const p = progress[id];
            if (!p) { newCount++; continue; }
            if (p.state === STATE.LEARNING) learningCount++;
            else if (p.state === STATE.REVIEW && p.interval >= 21) matureCount++;
            if (isDue(id)) dueCount++;
        }

        document.getElementById('welcome-stats').innerHTML = `
            <div class="stat-item"><span class="stat-value">${allCards.length}</span><span class="stat-label">Total Cards</span></div>
            <div class="stat-item"><span class="stat-value" style="color:var(--blue)">${newCount}</span><span class="stat-label">New</span></div>
            <div class="stat-item"><span class="stat-value" style="color:var(--orange)">${learningCount}</span><span class="stat-label">Learning</span></div>
            <div class="stat-item"><span class="stat-value" style="color:var(--red)">${dueCount}</span><span class="stat-label">Due</span></div>
            <div class="stat-item"><span class="stat-value" style="color:var(--green)">${matureCount}</span><span class="stat-label">Mature</span></div>
        `;

        document.getElementById('ttp-count').textContent = techniques.length + ' techniques';
        document.getElementById('mit-count').textContent = mitigations.length + ' mitigations';
    }

    // ===== TTP SUB-CATEGORIES (by Tactic) =====
    function showTTPs() {
        currentMode = 'techniques';
        document.getElementById('subcat-title').textContent = 'Techniques by Tactic';
        
        // Get unique tactics
        const tacticsMap = {};
        for (const t of techniques) {
            if (t.tactics) {
                for (const tactic of t.tactics) {
                    if (!tacticsMap[tactic]) tacticsMap[tactic] = [];
                    tacticsMap[tactic].push(t);
                }
            }
        }

        const grid = document.getElementById('subcat-grid');
        grid.innerHTML = '';
        
        // Sort tactics alphabetically
        const sortedTactics = Object.keys(tacticsMap).sort();
        let totalDue = 0;

        for (const tactic of sortedTactics) {
            const cards = tacticsMap[tactic];
            const dueCards = cards.filter(c => isDue('T:' + c.id)).length;
            const newCards = cards.filter(c => !progress['T:' + c.id]).length;
            totalDue += dueCards;

            const btn = document.createElement('button');
            btn.className = 'subcat-card';
            btn.innerHTML = `
                <div class="subcat-card-left">
                    <div class="subcat-card-name">${escapeHtml(tactic)}</div>
                    <div class="subcat-card-stats">
                        ${newCards > 0 ? `<span style="color:var(--blue)">${newCards} new</span> · ` : ''}
                        ${dueCards > 0 ? `<span class="subcat-due">${dueCards} due</span>` : '<span style="color:var(--green)">up to date</span>'}
                    </div>
                </div>
                <span class="subcat-card-count">${cards.length}</span>
            `;
            btn.onclick = () => startStudy(cards.map(c => ({ ...c, _prefix: 'T:' })), tactic);
            grid.appendChild(btn);
        }

        document.getElementById('due-count-badge').textContent = totalDue || '';
        showView('view-subcategory');
    }

    function showMitigations() {
        currentMode = 'mitigations';
        document.getElementById('subcat-title').textContent = 'Mitigations';
        
        const grid = document.getElementById('subcat-grid');
        grid.innerHTML = '';

        const dueCards = mitigations.filter(m => isDue('M:' + m.id)).length;
        const newCards = mitigations.filter(m => !progress['M:' + m.id]).length;

        // Single card for all mitigations
        const btn = document.createElement('button');
        btn.className = 'subcat-card';
        btn.innerHTML = `
            <div class="subcat-card-left">
                <div class="subcat-card-name">All Mitigations</div>
                <div class="subcat-card-stats">
                    ${newCards > 0 ? `<span style="color:var(--blue)">${newCards} new</span> · ` : ''}
                    ${dueCards > 0 ? `<span class="subcat-due">${dueCards} due</span>` : '<span style="color:var(--green)">up to date</span>'}
                </div>
            </div>
            <span class="subcat-card-count">${mitigations.length}</span>
        `;
        btn.onclick = () => startStudy(mitigations.map(m => ({ ...m, _prefix: 'M:' })), 'Mitigations');
        grid.appendChild(btn);

        document.getElementById('due-count-badge').textContent = dueCards || '';
        showView('view-subcategory');
    }

    // ===== STUDY SESSIONS =====
    function studyDue() {
        let cards;
        if (currentMode === 'techniques') {
            cards = techniques.map(c => ({ ...c, _prefix: 'T:' }));
        } else {
            cards = mitigations.map(c => ({ ...c, _prefix: 'M:' }));
        }
        const dueCards = cards.filter(c => isDue(c._prefix + c.id));
        if (dueCards.length === 0) {
            alert('No cards are due for review! Great job! 🎉');
            return;
        }
        startStudy(dueCards, 'Due Review');
    }

    function studyAll() {
        let cards;
        if (currentMode === 'techniques') {
            cards = techniques.map(c => ({ ...c, _prefix: 'T:' }));
        } else {
            cards = mitigations.map(c => ({ ...c, _prefix: 'M:' }));
        }
        startStudy(cards, 'All Cards');
    }

    function startStudy(cards, label) {
        sessionStats = { again: 0, hard: 0, good: 0, easy: 0, reviewed: 0 };

        // Build study queue: due cards first, then new cards (limited)
        const dueCards = cards.filter(c => {
            const p = progress[c._prefix + c.id];
            return p && isDue(c._prefix + c.id);
        });

        const newCards = cards.filter(c => !progress[c._prefix + c.id]);
        const maxNew = settings.newCardsPerSession;

        // Shuffle new cards so user gets variety
        shuffleArray(newCards);

        currentDeck = [...shuffleArray([...dueCards]), ...newCards.slice(0, maxNew)];
        
        if (currentDeck.length === 0) {
            alert('No cards to study right now!');
            return;
        }

        currentIndex = 0;
        showView('view-study');
        showCard();
    }

    function showCard() {
        if (currentIndex >= currentDeck.length) {
            showComplete();
            return;
        }

        const card = currentDeck[currentIndex];
        const cardId = card._prefix + card.id;
        const isTechnique = card._prefix === 'T:';
        const badgeClass = isTechnique ? 'badge-technique' : 'badge-mitigation';
        const badgeText = isTechnique ? 'Technique' : 'Mitigation';

        // Reset flip
        isFlipped = false;
        document.getElementById('card-front').classList.remove('hidden');
        document.getElementById('card-back').classList.add('hidden');
        document.getElementById('rating-buttons').style.display = 'none';

        // Front
        const frontBadge = document.getElementById('card-badge');
        frontBadge.textContent = badgeText;
        frontBadge.className = 'card-badge ' + badgeClass;
        document.getElementById('card-id').textContent = card.id;
        document.getElementById('card-name').textContent = card.name;

        // Tags
        const tagsEl = document.getElementById('card-tags');
        tagsEl.innerHTML = '';
        if (isTechnique && card.tactics) {
            card.tactics.forEach(t => {
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = t;
                tagsEl.appendChild(tag);
            });
        }

        // Back
        const backBadge = document.getElementById('card-badge-back');
        backBadge.textContent = badgeText;
        backBadge.className = 'card-badge ' + badgeClass;
        document.getElementById('card-id-back').textContent = card.id;
        document.getElementById('card-name-back').textContent = card.name;
        
        // Clean up description
        let desc = card.description || '';
        desc = desc.replace(/\(Citation:[^)]*\)/g, '');
        desc = desc.replace(/<[^>]+>/g, '');
        // Convert markdown links [text](url) to just text
        desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        // Collapse multiple spaces/newlines
        desc = desc.replace(/\n{3,}/g, '\n\n');
        if (desc.length > 1500) {
            desc = desc.substring(0, 1500) + '...';
        }
        // Escape HTML then convert backtick content to <code> tags
        desc = desc.trim();
        const safeDesc = desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const htmlDesc = safeDesc.replace(/`([^`]+)`/g, '<code>$1</code>');
        document.getElementById('card-description').innerHTML = htmlDesc;
        
        const link = document.getElementById('card-link');
        link.href = card.url || '#';

        // Intervals
        const intervals = getNextIntervals(cardId);
        document.getElementById('hard-interval').textContent = intervals.hard;
        document.getElementById('good-interval').textContent = intervals.good;
        document.getElementById('easy-interval').textContent = intervals.easy;

        // Progress bar
        updateStudyProgress();
    }

    function flipCard() {
        if (isFlipped) return;
        isFlipped = true;
        document.getElementById('card-front').classList.add('hidden');
        document.getElementById('card-back').classList.remove('hidden');
        document.getElementById('rating-buttons').style.display = 'grid';
    }

    function rateCard(quality) {
        const card = currentDeck[currentIndex];
        const cardId = card._prefix + card.id;
        
        scheduleCard(cardId, quality);
        sessionStats.reviewed++;
        
        if (quality === 0) {
            sessionStats.again++;
            // Put card back in queue (a few cards later)
            const reinsertAt = Math.min(currentIndex + 3 + Math.floor(Math.random() * 3), currentDeck.length);
            currentDeck.splice(reinsertAt, 0, card);
        } else if (quality === 1) {
            sessionStats.hard++;
        } else if (quality === 2) {
            sessionStats.good++;
        } else {
            sessionStats.easy++;
        }

        currentIndex++;
        showCard();
    }

    function updateStudyProgress() {
        const total = currentDeck.length;
        const pct = total > 0 ? (currentIndex / total) * 100 : 0;
        document.getElementById('study-counter').textContent = `${currentIndex} / ${total}`;
        document.getElementById('study-progress-bar').style.width = pct + '%';
    }

    function exitStudy() {
        if (currentIndex > 0 && currentIndex < currentDeck.length) {
            if (!confirm('Exit study session? Your progress on reviewed cards is saved.')) return;
        }
        goHome();
    }

    // ===== SESSION COMPLETE =====
    function showComplete() {
        document.getElementById('complete-stats').innerHTML = `
            <div class="complete-stat-row">
                <span class="complete-stat-label">Cards Reviewed</span>
                <span class="complete-stat-value">${sessionStats.reviewed}</span>
            </div>
            <div class="complete-stat-row">
                <span class="complete-stat-label" style="color:var(--red)">Again</span>
                <span class="complete-stat-value">${sessionStats.again}</span>
            </div>
            <div class="complete-stat-row">
                <span class="complete-stat-label" style="color:var(--orange)">Hard</span>
                <span class="complete-stat-value">${sessionStats.hard}</span>
            </div>
            <div class="complete-stat-row">
                <span class="complete-stat-label" style="color:var(--green)">Good</span>
                <span class="complete-stat-value">${sessionStats.good}</span>
            </div>
            <div class="complete-stat-row">
                <span class="complete-stat-label" style="color:var(--blue)">Easy</span>
                <span class="complete-stat-value">${sessionStats.easy}</span>
            </div>
        `;
        showView('view-complete');
    }

    // ===== STATISTICS VIEW =====
    function showStats() {
        const container = document.getElementById('stats-container');
        
        // Gather stats
        const allIds = [
            ...techniques.map(t => 'T:' + t.id),
            ...mitigations.map(m => 'M:' + m.id)
        ];

        let newCount = 0, learningCount = 0, reviewCount = 0, matureCount = 0;
        let totalReviews = 0, totalLapses = 0;
        const tacticStats = {};

        for (const id of allIds) {
            const p = progress[id];
            if (!p) { newCount++; continue; }
            if (p.state === STATE.NEW) newCount++;
            else if (p.state === STATE.LEARNING) learningCount++;
            else if (p.interval >= 21) matureCount++;
            else reviewCount++;
            totalReviews += p.reps;
            totalLapses += p.lapses;
        }

        // Tactic breakdown
        for (const t of techniques) {
            if (!t.tactics) continue;
            for (const tactic of t.tactics) {
                if (!tacticStats[tactic]) tacticStats[tactic] = { total: 0, studied: 0, due: 0 };
                tacticStats[tactic].total++;
                const p = progress['T:' + t.id];
                if (p) tacticStats[tactic].studied++;
                if (isDue('T:' + t.id)) tacticStats[tactic].due++;
            }
        }

        // Build HTML
        let html = `
            <div class="stats-section">
                <h3>📊 Overview</h3>
                <div class="stats-grid">
                    <div class="mini-stat"><div class="mini-stat-value" style="color:var(--blue)">${newCount}</div><div class="mini-stat-label">New</div></div>
                    <div class="mini-stat"><div class="mini-stat-value" style="color:var(--orange)">${learningCount}</div><div class="mini-stat-label">Learning</div></div>
                    <div class="mini-stat"><div class="mini-stat-value" style="color:var(--green)">${reviewCount}</div><div class="mini-stat-label">Young</div></div>
                    <div class="mini-stat"><div class="mini-stat-value" style="color:var(--accent2)">${matureCount}</div><div class="mini-stat-label">Mature</div></div>
                </div>
            </div>
            <div class="stats-section">
                <h3>🔢 Totals</h3>
                <div class="stats-grid">
                    <div class="mini-stat"><div class="mini-stat-value">${totalReviews}</div><div class="mini-stat-label">Total Reviews</div></div>
                    <div class="mini-stat"><div class="mini-stat-value">${totalLapses}</div><div class="mini-stat-label">Total Lapses</div></div>
                    <div class="mini-stat"><div class="mini-stat-value">${allIds.length - newCount}</div><div class="mini-stat-label">Cards Seen</div></div>
                    <div class="mini-stat"><div class="mini-stat-value">${allIds.length}</div><div class="mini-stat-label">Total Cards</div></div>
                </div>
            </div>
            <div class="stats-section">
                <h3>⚔️ Techniques by Tactic</h3>
                <div class="stats-bar-chart">
        `;

        const sortedTactics = Object.entries(tacticStats).sort((a, b) => b[1].total - a[1].total);
        const maxTotal = sortedTactics.length > 0 ? sortedTactics[0][1].total : 1;

        for (const [tactic, stats] of sortedTactics) {
            const studiedPct = (stats.studied / maxTotal) * 100;
            const totalPct = (stats.total / maxTotal) * 100;
            html += `
                <div class="bar-row">
                    <span class="bar-label">${escapeHtml(tactic)}</span>
                    <div class="bar-track">
                        <div class="bar-fill review" style="width:${studiedPct}%"></div>
                        <span class="bar-value">${stats.studied}/${stats.total}</span>
                    </div>
                </div>
            `;
        }

        html += `</div></div>`;

        // Mitigations stats
        const mitStudied = mitigations.filter(m => progress['M:' + m.id]).length;
        html += `
            <div class="stats-section">
                <h3>🛡️ Mitigations</h3>
                <div class="stats-grid">
                    <div class="mini-stat"><div class="mini-stat-value">${mitStudied}</div><div class="mini-stat-label">Studied</div></div>
                    <div class="mini-stat"><div class="mini-stat-value">${mitigations.length - mitStudied}</div><div class="mini-stat-label">Remaining</div></div>
                    <div class="mini-stat"><div class="mini-stat-value">${mitigations.length}</div><div class="mini-stat-label">Total</div></div>
                </div>
            </div>
        `;

        container.innerHTML = html;
        showView('view-stats');
    }

    // ===== SETTINGS =====
    function showSettings() {
        document.getElementById('new-cards-slider').value = settings.newCardsPerSession;
        document.getElementById('new-cards-value').textContent = settings.newCardsPerSession;
        showView('view-settings');
    }

    function updateNewCards(val) {
        settings.newCardsPerSession = parseInt(val);
        document.getElementById('new-cards-value').textContent = val;
        Storage.save(SETTINGS_KEY, settings);
    }

    function exportProgress() {
        const data = {
            version: 1,
            exportDate: new Date().toISOString(),
            progress: progress,
            settings: settings
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mitre-flashcards-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importProgress(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.progress || typeof data.progress !== 'object') {
                    throw new Error('Invalid format');
                }
                
                // Validate structure: each entry must have expected fields
                for (const [key, val] of Object.entries(data.progress)) {
                    if (typeof val.interval !== 'number' || typeof val.ease !== 'number') {
                        throw new Error('Invalid card data');
                    }
                }
                
                progress = data.progress;
                if (data.settings) {
                    settings = { ...settings, ...data.settings };
                }
                
                await Storage.save(STORAGE_KEY, progress);
                await Storage.save(SETTINGS_KEY, settings);
                
                updateWelcomeStats();
                alert('Progress imported successfully! ✅');
            } catch (err) {
                alert('Invalid backup file. Please select a valid export file.');
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    function resetProgress() {
        if (!confirm('⚠️ This will delete ALL your progress. This cannot be undone!\n\nAre you sure?')) return;
        if (!confirm('Really? Type OK to confirm.')) return;
        
        progress = {};
        Storage.save(STORAGE_KEY, progress);
        updateWelcomeStats();
        alert('All progress has been reset.');
    }

    // ===== NAVIGATION =====
    function goHome() {
        updateWelcomeStats();
        showView('view-welcome');
    }

    // ===== UTILITIES =====
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== KEYBOARD SHORTCUTS =====
    document.addEventListener('keydown', (e) => {
        const studyView = document.getElementById('view-study');
        if (!studyView.classList.contains('active')) return;

        if (!isFlipped && (e.code === 'Space' || e.code === 'Enter')) {
            e.preventDefault();
            flipCard();
        } else if (isFlipped) {
            switch (e.code) {
                case 'Digit1': case 'Numpad1': e.preventDefault(); rateCard(0); break;
                case 'Digit2': case 'Numpad2': e.preventDefault(); rateCard(1); break;
                case 'Digit3': case 'Numpad3': e.preventDefault(); rateCard(2); break;
                case 'Digit4': case 'Numpad4': e.preventDefault(); rateCard(3); break;
                case 'Space': case 'Enter': e.preventDefault(); rateCard(2); break;
            }
        }
    });

    // ===== INITIALIZATION =====
    async function init() {
        const overlay = document.getElementById('loading-overlay');
        const overlayMsg = overlay.querySelector('p');
        try {
            await Storage.init();
            
            const [savedProgress, savedSettings] = await Promise.all([
                Storage.load(STORAGE_KEY),
                Storage.load(SETTINGS_KEY)
            ]);
            
            if (savedProgress) progress = savedProgress;
            if (savedSettings) settings = { ...settings, ...savedSettings };

            loadData();
            
            updateWelcomeStats();
            overlay.classList.add('hidden');
        } catch (err) {
            console.error('Init failed:', err);
            overlayMsg.innerHTML = '❌ Failed to load data.<br><small style="color:#94a3b8">' +
                escapeHtml(err.message) +
                '<br><br>Make sure you serve this site via a web server (e.g. Live Server),<br>not by opening index.html directly as a file.</small>';
            overlay.querySelector('.loader').style.display = 'none';
        }
    }

    init();

    // ===== PUBLIC API =====
    return {
        showTTPs,
        showMitigations,
        studyDue,
        studyAll,
        flipCard,
        rateCard,
        exitStudy,
        goHome,
        showStats,
        showSettings,
        updateNewCards,
        exportProgress,
        importProgress,
        resetProgress
    };
})();

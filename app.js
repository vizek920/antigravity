/* ==========================================================================
   GAME ENGINE: شاركني أو اسرقني — الخزنة السرية
   Complete rewrite with new UI, alternating picks, hidden cards, PeerJS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════════════════════════
    // 1. CONSTANTS & STATE
    // ══════════════════════════════════════════════════════════════
    const DEFAULT_CARDS = [
        20, 30, 50, 100, 200,
        'قاتل', 500, 1000, 50, 150,
        300, 750, 'قاتل', 1500, 10,
        40, 80, 250, 600, 1200
    ];

    let state = {
        cardsConfig: [...DEFAULT_CARDS],
        mode: 'local',      // 'host' | 'client' | 'local'
        myRole: 'host',     // 'host' | 'p1' | 'p2'
        roomCode: '',
        players: {
            p1: { name: 'المتنافس 1', picks: [], conn: null },
            p2: { name: 'المتنافس 2', picks: [], conn: null }
        },
        currentTurn: 'p1',
        selectedOrder: [],  // [{cardIdx, owner, val}, ...]
        revealIdx: 0,
        runningPot: 0,
        showdownChoices: { p1: null, p2: null },
        soundOn: true,
        heartbeat: false
    };

    let peer = null;
    let hostConn = null;
    let peerConns = [];

    // ══════════════════════════════════════════════════════════════
    // 2. SCREEN NAVIGATION
    // ══════════════════════════════════════════════════════════════
    function goTo(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(screenId);
        if (el) { el.classList.add('active'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }

    // ══════════════════════════════════════════════════════════════
    // 3. TOAST
    // ══════════════════════════════════════════════════════════════
    function toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('show'), 2800);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. AUDIO (Web Audio API)
    // ══════════════════════════════════════════════════════════════
    let audioCtx = null;
    let heartbeatTimer = null;

    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function tone(freq, dur, type = 'sine', vol = 0.1) {
        if (!state.soundOn) return;
        try {
            initAudio();
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
            g.gain.setValueAtTime(vol, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(); o.stop(audioCtx.currentTime + dur);
        } catch(e) {}
    }

    const snd = {
        click:  () => tone(600, 0.08, 'triangle', 0.07),
        pick:   () => { tone(400, 0.1, 'sine', 0.14); setTimeout(() => tone(800, 0.12, 'sine', 0.14), 50); },
        flip:   () => { tone(300, 0.15, 'sine', 0.18); setTimeout(() => tone(600, 0.2, 'triangle', 0.18), 80); },
        points: () => [523, 659, 784, 1047].forEach((f,i) => setTimeout(() => tone(f, 0.18, 'sine', 0.18), i*70)),
        killer: () => { initAudio(); try { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(150, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime+0.6); g.gain.setValueAtTime(0.4, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime+0.6); o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.6); } catch(e) {} },
        fanfare:() => [440,554,659,880,1109].forEach((f,i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.22), i*100)),
        beep:   () => tone(500, 0.15, 'sine', 0.18)
    };

    function setHeartbeat(on) {
        state.heartbeat = on;
        const btn = document.getElementById('btn-heartbeat-toggle');
        if (on) {
            btn.classList.add('active-heartbeat');
            btn.innerHTML = '<i class="fa-solid fa-heart-circle-bolt"></i> إيقاف التوتر';
            if (!heartbeatTimer) {
                heartbeatTimer = setInterval(() => {
                    tone(80, 0.12, 'sine', 0.22);
                    setTimeout(() => tone(60, 0.15, 'sine', 0.18), 180);
                }, 1000);
            }
        } else {
            btn.classList.remove('active-heartbeat');
            btn.innerHTML = '<i class="fa-solid fa-heart-pulse"></i> صوت التوتر';
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        }
    }

    document.getElementById('btn-sound').addEventListener('click', () => {
        snd.click();
        state.soundOn = !state.soundOn;
        const ico = document.querySelector('#btn-sound i');
        ico.className = state.soundOn ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
        toast(state.soundOn ? 'الصوت مفعّل' : 'الصوت مكتوم');
    });

    // ══════════════════════════════════════════════════════════════
    // 5. LANDING SCREEN
    // ══════════════════════════════════════════════════════════════
    document.getElementById('btn-go-host').addEventListener('click', () => {
        snd.click(); goTo('screen-host-lobby');
    });

    document.getElementById('btn-go-join').addEventListener('click', () => {
        snd.click(); goTo('screen-join');
    });

    document.getElementById('btn-go-local').addEventListener('click', () => {
        snd.click(); goTo('screen-local');
    });

    // Back buttons
    document.getElementById('btn-back-from-host-lobby').addEventListener('click', () => {
        snd.click(); goTo('screen-landing');
    });
    document.getElementById('btn-back-from-join').addEventListener('click', () => {
        snd.click(); goTo('screen-landing');
    });
    document.getElementById('btn-back-from-local').addEventListener('click', () => {
        snd.click(); goTo('screen-landing');
    });

    // ══════════════════════════════════════════════════════════════
    // 6. HOST LOBBY
    // ══════════════════════════════════════════════════════════════
    document.getElementById('btn-create-room-action').addEventListener('click', () => {
        snd.click();
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        state.roomCode = code;
        state.mode = 'host';
        state.myRole = 'host';

        document.getElementById('disp-room-code').textContent = code;
        document.getElementById('watch-code-disp').textContent = `الغرفة: ${code}`;
        document.getElementById('host-pre-create').style.display = 'none';
        document.getElementById('host-room-live').style.display = 'block';

        // Init PeerJS host
        peer = new Peer(`sos-vault-${code}`);
        peer.on('open', () => toast(`✅ الغرفة جاهزة! الكود: ${code}`));
        peer.on('connection', (conn) => {
            peerConns.push(conn);
            conn.on('open', () => toast('متنافس جديد انضم للغرفة!'));
            conn.on('data', (data) => handleHostData(data, conn));
        });
        peer.on('error', () => toast('خطأ في إنشاء الغرفة، جرب كوداً آخر'));
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
        navigator.clipboard.writeText(state.roomCode).then(() => toast('تم نسخ الكود ✓'));
    });

    function handleHostData(data, conn) {
        if (data.type === 'JOIN') {
            if (!state.players.p1.conn) {
                state.players.p1.name = data.name;
                state.players.p1.conn = conn;
                conn.send({ type: 'WELCOME', role: 'p1', code: state.roomCode, p1: state.players.p1.name, p2: state.players.p2.name });
                updateHostLobbySlot('p1');
            } else if (!state.players.p2.conn) {
                state.players.p2.name = data.name;
                state.players.p2.conn = conn;
                conn.send({ type: 'WELCOME', role: 'p2', code: state.roomCode, p1: state.players.p1.name, p2: state.players.p2.name });
                updateHostLobbySlot('p2');
                document.getElementById('btn-host-start-game').disabled = false;
            }
            broadcastState();
        } else if (data.type === 'PICK') {
            if (data.player === state.currentTurn) {
                doCardPick(data.cardIdx);
                broadcastState();
            }
        } else if (data.type === 'CHOICE') {
            receiveShowdownChoice(data.player, data.choice);
        }
    }

    function updateHostLobbySlot(role) {
        const name = state.players[role].name;
        document.getElementById(`name-${role}-slot`).textContent = name;
        const card = document.getElementById(`slot-${role}-card`);
        card.classList.remove('waiting');
        card.classList.add('connected');
        card.querySelector('.note-status').textContent = 'متصل ✓';
        card.querySelector('.note-status').classList.remove('waiting-dots');
    }

    document.getElementById('btn-host-start-game').addEventListener('click', () => {
        snd.click();
        initGame();
        peerConns.forEach(c => c.send({ type: 'START', p1: state.players.p1.name, p2: state.players.p2.name }));
    });

    // ══════════════════════════════════════════════════════════════
    // 7. JOIN ROOM (PLAYER)
    // ══════════════════════════════════════════════════════════════
    document.getElementById('btn-join-action').addEventListener('click', () => {
        snd.click();
        const code = document.getElementById('join-code-input').value.trim();
        const name = document.getElementById('join-name-input').value.trim() || 'لاعب';
        if (!code) { toast('أدخل كود الغرفة!'); return; }

        const statusBox = document.getElementById('join-status');
        const statusTxt = document.getElementById('join-status-text');
        statusBox.style.display = 'flex';
        statusTxt.textContent = 'جاري الاتصال...';

        peer = new Peer();
        peer.on('open', () => {
            hostConn = peer.connect(`sos-vault-${code}`);
            hostConn.on('open', () => {
                state.mode = 'client';
                statusTxt.textContent = 'تم الاتصال! في انتظار الهوست...';
                hostConn.send({ type: 'JOIN', name });
            });
            hostConn.on('data', handleClientData);
            hostConn.on('error', () => { statusTxt.textContent = 'فشل الاتصال! تأكد من الكود.'; });
        });
    });

    function handleClientData(data) {
        if (data.type === 'WELCOME') {
            state.myRole = data.role;
            state.roomCode = data.code;
            state.players.p1.name = data.p1;
            state.players.p2.name = data.p2;
            // Move to client waiting screen
            goTo('screen-client');
            document.getElementById('client-room-code').textContent = data.code;
            const myName = data.role === 'p1' ? data.p1 : data.p2;
            document.getElementById('client-welcome-name').textContent = myName;
            document.getElementById('client-role-badge').textContent = data.role === 'p1' ? '١' : '٢';
            toast(`مرحباً ${myName}! انتظر بدء الهوست`);
        } else if (data.type === 'START') {
            state.players.p1.name = data.p1;
            state.players.p2.name = data.p2;
            initGame(true); // client mode
        } else if (data.type === 'STATE') {
            syncClientState(data);
        } else if (data.type === 'GOTO_REVEAL') {
            prepareRevealStage();
            goTo('screen-reveal');
        } else if (data.type === 'REVEAL_CARD') {
            revealOneCard(data.idx, data.val);
        } else if (data.type === 'GOTO_SHOWDOWN') {
            prepareShowdownStage();
            goTo('screen-showdown');
        } else if (data.type === 'FINAL_REVEAL') {
            executeFinalOutcome(data.c1, data.c2);
        }
    }

    function syncClientState(data) {
        state.currentTurn = data.currentTurn;
        state.players.p1.picks = data.p1Picks;
        state.players.p2.picks = data.p2Picks;
        state.runningPot = data.pot;
        state.selectedOrder = data.order;
        state.revealIdx = data.revealIdx;
        // Update client UI
        updateClientUI();
    }

    function broadcastState() {
        const payload = {
            type: 'STATE',
            currentTurn: state.currentTurn,
            p1Picks: state.players.p1.picks,
            p2Picks: state.players.p2.picks,
            pot: state.runningPot,
            order: state.selectedOrder,
            revealIdx: state.revealIdx
        };
        peerConns.forEach(c => { if (c.open) c.send(payload); });
    }

    // ══════════════════════════════════════════════════════════════
    // 8. LOCAL GAME
    // ══════════════════════════════════════════════════════════════
    document.getElementById('btn-start-local').addEventListener('click', () => {
        snd.click();
        state.mode = 'local';
        state.myRole = 'host';
        state.players.p1.name = document.getElementById('local-p1-name').value.trim() || 'المتنافس 1';
        state.players.p2.name = document.getElementById('local-p2-name').value.trim() || 'المتنافس 2';
        initGame();
    });

    // ══════════════════════════════════════════════════════════════
    // 9. GAME INITIALIZATION (STEP 2 — CARD SELECTION)
    // ══════════════════════════════════════════════════════════════
    function initGame(isClient = false) {
        // Reset game state
        state.players.p1.picks = [];
        state.players.p2.picks = [];
        state.selectedOrder = [];
        state.currentTurn = 'p1';
        state.runningPot = 0;
        state.revealIdx = 0;
        state.showdownChoices = { p1: null, p2: null };

        if (isClient) {
            // Client goes to client screen, which updates dynamically
            goTo('screen-client');
            updateClientUI();
            return;
        }

        // Host/local goes to selection screen
        buildSelectionScreen();
        goTo('screen-selection');
    }

    function buildSelectionScreen() {
        // Set names in status bar
        document.getElementById('sel-p1-name').textContent = state.players.p1.name;
        document.getElementById('sel-p2-name').textContent = state.players.p2.name;

        // Show room code badge if online
        const badge = document.getElementById('sel-room-code-badge');
        if (state.mode === 'host') {
            badge.textContent = `الغرفة: ${state.roomCode}`;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

        render20Cards();
        updateSelectionUI();
    }

    function render20Cards() {
        const grid = document.getElementById('cards-grid-20');
        grid.innerHTML = '';
        for (let i = 0; i < 20; i++) {
            const card = document.createElement('div');
            card.className = 'vault-card';
            card.dataset.idx = i;
            card.style.animationDelay = `${i * 0.02}s`;
            card.innerHTML = `
                <span class="card-serial mono">#${String(i+1).padStart(2,'0')}</span>
                <i class="card-icon fa-solid fa-question"></i>
                <span class="card-qmarks">؟ ؟ ؟</span>
                <span class="card-owner-tag"></span>
            `;
            card.addEventListener('click', () => onCardClick(i, card));
            grid.appendChild(card);
        }
    }

    function onCardClick(idx, cardEl) {
        // Clients send to host
        if (state.mode === 'client') {
            if (state.myRole === state.currentTurn) {
                hostConn.send({ type: 'PICK', cardIdx: idx, player: state.myRole });
            } else {
                toast('ليس دورك الآن!');
            }
            return;
        }
        doCardPick(idx);
        if (state.mode === 'host') broadcastState();
    }

    function doCardPick(idx) {
        if (state.players.p1.picks.includes(idx) || state.players.p2.picks.includes(idx)) {
            toast('هذا الكرت مختار مسبقاً!'); return;
        }

        const turn = state.currentTurn;
        const p = state.players[turn];
        if (p.picks.length >= 3) return;

        p.picks.push(idx);
        state.selectedOrder.push({ cardIdx: idx, owner: turn, val: state.cardsConfig[idx] });

        // Update card visually
        const cardEl = document.querySelector(`.vault-card[data-idx="${idx}"]`);
        if (cardEl) {
            cardEl.classList.add(`picked-${turn}`, 'disabled');
            cardEl.querySelector('.card-owner-tag').textContent = p.name;
            snd.pick();
        }

        // Alternate turn: p1→p2→p1→p2→p1→p2
        const other = turn === 'p1' ? 'p2' : 'p1';
        if (state.players[other].picks.length < 3) {
            state.currentTurn = other;
        } else if (p.picks.length === 3) {
            state.currentTurn = 'complete';
        }

        updateSelectionUI();
    }

    function updateSelectionUI() {
        const p1c = state.players.p1.picks.length;
        const p2c = state.players.p2.picks.length;
        const total = p1c + p2c;

        document.getElementById('sel-p1-count').textContent = `${p1c}/3`;
        document.getElementById('sel-p2-count').textContent = `${p2c}/3`;

        const p1Token = document.getElementById('sel-p1-token');
        const p2Token = document.getElementById('sel-p2-token');
        const banner  = document.getElementById('turn-banner');
        const btn     = document.getElementById('btn-proceed-reveal');

        p1Token.classList.toggle('active-turn', state.currentTurn === 'p1');
        p2Token.classList.toggle('active-turn', state.currentTurn === 'p2');

        if (state.currentTurn === 'complete') {
            banner.innerHTML = `<span style="color:var(--brass)">✅ تم اختيار الـ 6 كروت! انتقل لمرحلة الكشف</span>`;
            btn.disabled = false;
        } else {
            const curName = state.currentTurn === 'p1' ? state.players.p1.name : state.players.p2.name;
            const colorVar = state.currentTurn === 'p1' ? 'var(--p1-color)' : 'var(--p2-color)';
            banner.innerHTML = `الاختيار رقم <strong style="color:var(--brass)">${total + 1}</strong> من 6 — دور <span class="turn-name-highlight" style="color:${colorVar}">${curName}</span>`;
            btn.disabled = true;
        }
    }

    document.getElementById('btn-proceed-reveal').addEventListener('click', () => {
        snd.click();
        prepareRevealStage();
        goTo('screen-reveal');
        if (state.mode === 'host') peerConns.forEach(c => c.send({ type: 'GOTO_REVEAL' }));
    });

    // ══════════════════════════════════════════════════════════════
    // 10. CLIENT MOBILE UI UPDATES
    // ══════════════════════════════════════════════════════════════
    function updateClientUI() {
        if (state.mode !== 'client') return;

        // Hide all sub-areas
        ['client-waiting-area', 'client-pick-area', 'client-wait-other', 'client-wait-reveal'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
        document.getElementById('client-showdown-area').style.display = 'none';

        const myPicks = state.players[state.myRole].picks.length;

        if (state.currentTurn === 'complete') {
            document.getElementById('client-wait-reveal').style.display = 'block';
        } else if (state.currentTurn === state.myRole && myPicks < 3) {
            // It's my turn
            document.getElementById('client-pick-area').style.display = 'block';
            document.getElementById('client-pick-num').textContent = myPicks + 1;
            buildMiniCards();
        } else {
            document.getElementById('client-wait-other').style.display = 'block';
        }
    }

    function buildMiniCards() {
        const container = document.getElementById('client-mini-cards');
        container.innerHTML = '';
        for (let i = 0; i < 20; i++) {
            const picked1 = state.players.p1.picks.includes(i);
            const picked2 = state.players.p2.picks.includes(i);
            const card = document.createElement('div');
            card.className = 'mini-vault-card';
            if (picked1 || picked2) card.classList.add('taken');
            card.textContent = String(i + 1).padStart(2, '0');
            if (!picked1 && !picked2) {
                card.addEventListener('click', () => {
                    snd.pick();
                    hostConn.send({ type: 'PICK', cardIdx: i, player: state.myRole });
                    card.classList.add('picked');
                });
            }
            container.appendChild(card);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 11. REVEAL STAGE
    // ══════════════════════════════════════════════════════════════
    function prepareRevealStage() {
        state.revealIdx = 0;
        state.runningPot = 0;
        document.getElementById('rev-pot-num').textContent = '0';
        document.getElementById('killer-alert').style.display = 'none';

        const badge = document.getElementById('rev-room-code-badge');
        badge.textContent = state.mode === 'host' || state.mode === 'client' ? `الغرفة: ${state.roomCode}` : '';
        badge.style.display = state.roomCode ? 'inline-block' : 'none';

        // Build 6 stage cards
        const row = document.getElementById('stage-cards-row');
        row.innerHTML = '';
        state.selectedOrder.forEach((item, idx) => {
            const ownerName = state.players[item.owner].name;
            const isKiller  = String(item.val).includes('قاتل');
            const card = document.createElement('div');
            card.className = `stage-card owner-${item.owner}`;
            card.dataset.stageIdx = idx;
            if (idx === 0) card.classList.add('pending');
            card.innerHTML = `
                <div class="stage-card-owner">${ownerName}</div>
                <div class="stage-card-content">
                    <i class="stage-card-icon fa-solid fa-question"></i>
                    <div class="stage-card-val ${isKiller ? 'is-killer' : ''}" style="display:none">
                        ${isKiller ? '<i class="fa-solid fa-skull-crossbones"></i>' : item.val}
                    </div>
                </div>
                <div class="stage-card-num mono">#${String(idx+1).padStart(2,'0')}</div>
            `;
            row.appendChild(card);
        });

        // Host dock visibility
        const isHost = (state.mode === 'host' || state.mode === 'local');
        document.getElementById('host-dock').style.display = isHost ? 'flex' : 'none';

        document.getElementById('btn-reveal-next').classList.remove('hidden');
        document.getElementById('btn-goto-showdown').classList.add('hidden');
        document.getElementById('host-dock-status').textContent = `جاهز لكشف الكرت #1`;
    }

    document.getElementById('btn-heartbeat-toggle').addEventListener('click', () => {
        setHeartbeat(!state.heartbeat);
    });

    document.getElementById('btn-reveal-next').addEventListener('click', () => {
        const idx = state.revealIdx;
        if (idx >= state.selectedOrder.length) return;

        const item  = state.selectedOrder[idx];
        const cards = document.querySelectorAll('.stage-card');
        const card  = cards[idx];
        if (!card) return;

        card.classList.remove('pending');
        card.classList.add('revealed');
        if (String(item.val).includes('قاتل')) card.classList.add('is-killer');

        // Show value
        card.querySelector('.stage-card-icon').style.display = 'none';
        card.querySelector('.stage-card-val').style.display = 'block';

        snd.flip();

        setTimeout(() => {
            if (typeof item.val === 'number') {
                state.runningPot += item.val;
                document.getElementById('rev-pot-num').textContent = state.runningPot.toLocaleString('ar-EG');
                snd.points();
            } else if (String(item.val).includes('قاتل')) {
                state.runningPot = 0;
                document.getElementById('rev-pot-num').textContent = '0';
                const alert = document.getElementById('killer-alert');
                alert.style.display = 'flex';
                snd.killer();
                setTimeout(() => alert.style.display = 'none', 3500);
            }

            state.revealIdx++;
            if (state.revealIdx < state.selectedOrder.length) {
                const next = cards[state.revealIdx];
                if (next) next.classList.add('pending');
                const nextOwner = state.players[state.selectedOrder[state.revealIdx].owner].name;
                document.getElementById('host-dock-status').textContent = `جاهز لكشف الكرت #${state.revealIdx + 1} (${nextOwner})`;
            } else {
                setHeartbeat(false);
                document.getElementById('host-dock-status').textContent = `اكتمل الكشف! الخزنة = ${state.runningPot.toLocaleString('ar-EG')} نقطة`;
                document.getElementById('btn-reveal-next').classList.add('hidden');
                document.getElementById('btn-goto-showdown').classList.remove('hidden');
            }

            // Broadcast to clients
            if (state.mode === 'host') {
                peerConns.forEach(c => c.send({ type: 'REVEAL_CARD', idx, val: item.val }));
                broadcastState();
            }
        }, 500);
    });

    // Client-side card reveal animation
    function revealOneCard(idx, val) {
        const cards = document.querySelectorAll('.stage-card');
        const card  = cards[idx];
        if (!card) return;

        card.classList.remove('pending');
        card.classList.add('revealed');
        if (String(val).includes('قاتل')) card.classList.add('is-killer');

        card.querySelector('.stage-card-icon').style.display = 'none';
        const valEl = card.querySelector('.stage-card-val');
        valEl.style.display = 'block';
        if (String(val).includes('قاتل')) {
            valEl.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i>';
        } else {
            valEl.textContent = val;
        }
    }

    document.getElementById('btn-goto-showdown').addEventListener('click', () => {
        snd.click();
        prepareShowdownStage();
        goTo('screen-showdown');
        if (state.mode === 'host') peerConns.forEach(c => c.send({ type: 'GOTO_SHOWDOWN' }));
    });

    // ══════════════════════════════════════════════════════════════
    // 12. FINAL SHOWDOWN
    // ══════════════════════════════════════════════════════════════
    function prepareShowdownStage() {
        state.showdownChoices = { p1: null, p2: null };
        document.getElementById('showdown-pot-num').textContent = state.runningPot.toLocaleString('ar-EG');
        document.getElementById('showdown-p1-name').textContent = state.players.p1.name;
        document.getElementById('showdown-p2-name').textContent = state.players.p2.name;

        const b1 = document.getElementById('p1-choice-badge');
        const b2 = document.getElementById('p2-choice-badge');
        b1.textContent = 'في انتظار الاختيار السري...';
        b1.className = 'choice-status-badge';
        b2.textContent = 'في انتظار الاختيار السري...';
        b2.className = 'choice-status-badge';

        document.getElementById('btn-trigger-reveal').disabled = true;
        document.getElementById('result-card').classList.add('hidden');
        document.getElementById('countdown-num').classList.add('hidden');

        // Show client showdown UI if on phone
        if (state.mode === 'client') {
            showClientShowdown();
        }
    }

    function showClientShowdown() {
        ['client-waiting-area','client-pick-area','client-wait-other','client-wait-reveal'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
        const area = document.getElementById('client-showdown-area');
        area.style.display = 'block';
        document.getElementById('client-showdown-pot').textContent = `الخزنة: ${state.runningPot.toLocaleString('ar-EG')} نقطة`;
        document.getElementById('client-chose-badge').classList.add('hidden');
    }

    // Choice buttons (main showdown screen)
    document.querySelectorAll('.btn-choice-split, .btn-choice-steal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            snd.click();
            const player = e.currentTarget.dataset.player;
            const choice = e.currentTarget.dataset.choice;
            if (!player) return; // client btns handled separately

            if (state.mode === 'client') {
                hostConn.send({ type: 'CHOICE', player: state.myRole, choice });
                toast('تم إرسال اختيارك السري!');
            } else {
                receiveShowdownChoice(player === '1' ? 'p1' : 'p2', choice);
            }
        });
    });

    // Client mobile choice buttons
    ['client-btn-split', 'client-btn-steal'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const choice = id.includes('split') ? 'split' : 'steal';
            snd.click();
            hostConn.send({ type: 'CHOICE', player: state.myRole, choice });
            document.getElementById('client-chose-badge').classList.remove('hidden');
            btn.parentElement.querySelectorAll('button').forEach(b => b.disabled = true);
            toast('تم إرسال اختيارك سرياً! ✓');
        });
    });

    function receiveShowdownChoice(playerRole, choice) {
        state.showdownChoices[playerRole] = choice;
        const badge = document.getElementById(`${playerRole}-choice-badge`);
        badge.textContent = '✓ تم الاختيار سرياً';
        badge.classList.add('chosen');
        // Disable that player's buttons
        const btnsContainer = playerRole === 'p1' ? 'p1-choice-btns' : 'p2-choice-btns';
        document.getElementById(btnsContainer).querySelectorAll('button').forEach(b => b.disabled = true);

        if (state.showdownChoices.p1 && state.showdownChoices.p2) {
            document.getElementById('btn-trigger-reveal').disabled = false;
        }
    }

    document.getElementById('btn-trigger-reveal').addEventListener('click', () => {
        snd.click();
        document.getElementById('btn-trigger-reveal').disabled = true;

        const countEl = document.getElementById('countdown-num');
        countEl.classList.remove('hidden');
        let n = 3;
        countEl.textContent = n;
        snd.beep();

        const timer = setInterval(() => {
            n--;
            if (n > 0) { countEl.textContent = n; snd.beep(); }
            else {
                clearInterval(timer);
                countEl.classList.add('hidden');
                const c1 = state.showdownChoices.p1;
                const c2 = state.showdownChoices.p2;
                executeFinalOutcome(c1, c2);
                if (state.mode === 'host') {
                    peerConns.forEach(c => c.send({ type: 'FINAL_REVEAL', c1, c2 }));
                }
            }
        }, 1000);
    });

    function executeFinalOutcome(c1, c2) {
        const pot   = state.runningPot;
        const p1n   = state.players.p1.name;
        const p2n   = state.players.p2.name;
        let headline, subtext, p1score, p2score, icon;

        if (c1 === 'split' && c2 === 'split') {
            p1score = Math.floor(pot / 2);
            p2score = Math.floor(pot / 2);
            headline = '🤝 مشاركة عادلة!';
            subtext  = `اختار الطرفان "شاركني" — تم تقاسم ${pot.toLocaleString('ar-EG')} نقطة بالتساوي.`;
            icon = '<i class="fa-solid fa-handshake" style="color:var(--split-color)"></i>';
            snd.fanfare();
        } else if (c1 === 'steal' && c2 === 'split') {
            p1score = pot; p2score = 0;
            headline = `😈 ${p1n} يسرق الخزنة!`;
            subtext  = `${p1n} اختار "اسرقني" و${p2n} اختار "شاركني" — السارق أخذ كل شيء!`;
            icon = '<i class="fa-solid fa-user-ninja" style="color:var(--steal-color)"></i>';
            snd.fanfare();
        } else if (c1 === 'split' && c2 === 'steal') {
            p1score = 0; p2score = pot;
            headline = `😈 ${p2n} يسرق الخزنة!`;
            subtext  = `${p2n} اختار "اسرقني" و${p1n} اختار "شاركني" — السارق أخذ كل شيء!`;
            icon = '<i class="fa-solid fa-user-ninja" style="color:var(--steal-color)"></i>';
            snd.fanfare();
        } else {
            p1score = 0; p2score = 0;
            headline = '💥 طمع مزدوج — خسارة للجميع!';
            subtext  = 'اختار الاثنان "اسرقني" — ضاعت الخزنة بالكامل!';
            icon = '<i class="fa-solid fa-skull-crossbones" style="color:var(--steal-color)"></i>';
            snd.killer();
        }

        const result = document.getElementById('result-card');
        document.getElementById('result-icon').innerHTML = icon;
        document.getElementById('result-headline').textContent = headline;
        document.getElementById('result-subtext').textContent = subtext;

        document.getElementById('res-p1-name').textContent = p1n;
        document.getElementById('res-p1-choice').textContent = c1 === 'split' ? '🤝 شاركني' : '😈 اسرقني';
        document.getElementById('res-p1-score').textContent = `+${p1score.toLocaleString('ar-EG')} نقطة`;

        document.getElementById('res-p2-name').textContent = p2n;
        document.getElementById('res-p2-choice').textContent = c2 === 'split' ? '🤝 شاركني' : '😈 اسرقني';
        document.getElementById('res-p2-score').textContent = `+${p2score.toLocaleString('ar-EG')} نقطة`;

        result.classList.remove('hidden');
    }

    document.getElementById('btn-play-again').addEventListener('click', () => {
        snd.click();
        goTo('screen-landing');
    });

    // ══════════════════════════════════════════════════════════════
    // 13. ADMIN MODAL
    // ══════════════════════════════════════════════════════════════
    const savedCfg = localStorage.getItem('sos_vault_cards');
    if (savedCfg) { try { state.cardsConfig = JSON.parse(savedCfg); } catch(e) {} }

    document.getElementById('btn-open-admin').addEventListener('click', () => {
        snd.click();
        renderAdminGrid();
        document.getElementById('modal-admin').style.display = 'flex';
    });

    document.getElementById('btn-close-admin').addEventListener('click', () => {
        document.getElementById('modal-admin').style.display = 'none';
    });

    document.getElementById('modal-admin').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });

    function renderAdminGrid() {
        const grid = document.getElementById('admin-cards-grid');
        grid.innerHTML = '';
        state.cardsConfig.forEach((val, i) => {
            const item = document.createElement('div');
            item.className = 'admin-card-item';
            item.innerHTML = `
                <label>كارت ${String(i+1).padStart(2,'0')}</label>
                <input type="text" data-idx="${i}" value="${val}">
            `;
            grid.appendChild(item);
        });
    }

    document.getElementById('btn-save-admin').addEventListener('click', () => {
        snd.click();
        const inputs = document.querySelectorAll('#admin-cards-grid input');
        const newCfg = [];
        inputs.forEach(inp => {
            const v = inp.value.trim();
            if (!isNaN(v) && v !== '') newCfg.push(Number(v));
            else newCfg.push(v);
        });
        state.cardsConfig = newCfg;
        localStorage.setItem('sos_vault_cards', JSON.stringify(newCfg));
        document.getElementById('modal-admin').style.display = 'none';
        toast('✅ تم حفظ قيم الكروت!');
    });

    // Presets
    document.getElementById('preset-default').addEventListener('click', () => {
        state.cardsConfig = [...DEFAULT_CARDS]; renderAdminGrid(); toast('تم تحميل التوزيع الافتراضي');
    });

    document.getElementById('preset-big').addEventListener('click', () => {
        state.cardsConfig = [100,250,500,1000,2500,'قاتل',5000,10000,500,1500,3000,7500,'قاتل',15000,200,400,800,2000,6000,12000];
        renderAdminGrid(); toast('تم تحميل إعداد المبالغ الضخمة');
    });

    document.getElementById('preset-random').addEventListener('click', () => {
        state.cardsConfig = [...state.cardsConfig].sort(() => Math.random() - 0.5);
        renderAdminGrid(); toast('تم الخلط العشوائي');
    });

}); // end DOMContentLoaded

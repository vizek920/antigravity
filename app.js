/* ==========================================================================
   GAME ENGINE: SHARIKNI OR ASRIQNI (SPLIT OR STEAL) WITH PEERJS ONLINE ROOMS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. STATE & CONSTANTS
    // ==========================================
    const DEFAULT_CARDS_20 = [
        20, 30, 50, 100, 200, 
        "القاتل", 500, 1000, 50, 150, 
        300, 750, "القاتل", 1500, 10, 
        40, 80, 250, 600, 1200
    ];

    let gameState = {
        cardsConfig: [...DEFAULT_CARDS_20],
        players: {
            p1: { name: "المتنافس 1", picks: [], conn: null },
            p2: { name: "المتنافس 2", picks: [], conn: null }
        },
        mode: 'local', // 'host', 'client', 'local'
        roomCode: '',
        myRole: 'host', // 'host', 'p1', 'p2', 'spectator'
        currentTurn: 'p1',
        selectedCardsOrder: [], // Array of { cardIndex, owner, val }
        currentRevealStageIndex: 0,
        runningPot: 0,
        showdownChoices: { p1: null, p2: null },
        soundEnabled: true,
        heartbeatActive: false
    };

    // PeerJS Networking Handles
    let peer = null;
    let hostConn = null; // Client connection to host
    let peerConnections = []; // Host connections list

    // ==========================================
    // 2. AUDIO SYNTHESIZER (WEB AUDIO API)
    // ==========================================
    let audioCtx = null;
    let heartbeatInterval = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playTone(freq, duration, type = 'sine', gainVal = 0.1) {
        if (!gameState.soundEnabled) return;
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) {}
    }

    function playClickSound() { playTone(600, 0.08, 'triangle', 0.08); }
    function playCardSelectSound() { playTone(400, 0.1, 'sine', 0.15); setTimeout(() => playTone(800, 0.12, 'sine', 0.15), 50); }
    function playCardFlipSound() { playTone(300, 0.15, 'sine', 0.2); setTimeout(() => playTone(600, 0.2, 'triangle', 0.2), 80); }
    function playPointsGainSound() { [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => setTimeout(() => playTone(freq, 0.18, 'sine', 0.2), idx * 70)); }
    
    function playKillerExplosionSound() {
        if (!gameState.soundEnabled) return;
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.6);
            gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
        } catch (e) {}
    }

    function playShowdownFanfareSound() {
        [440, 554.37, 659.25, 880, 1108.73].forEach((freq, idx) => setTimeout(() => playTone(freq, 0.3, 'triangle', 0.25), idx * 100));
    }

    function toggleHeartbeatSound(forceState) {
        if (typeof forceState === 'boolean') {
            gameState.heartbeatActive = forceState;
        } else {
            gameState.heartbeatActive = !gameState.heartbeatActive;
        }

        const btnHeartbeat = document.getElementById('btn-host-heartbeat-toggle');
        if (!btnHeartbeat) return;
        
        if (gameState.heartbeatActive) {
            btnHeartbeat.classList.add('btn-danger');
            btnHeartbeat.innerHTML = '<i class="fa-solid fa-heart-circle-bolt"></i> إيقاف صوت التوتر';
            if (!heartbeatInterval) {
                heartbeatInterval = setInterval(() => {
                    playTone(80, 0.12, 'sine', 0.25);
                    setTimeout(() => playTone(60, 0.15, 'sine', 0.2), 180);
                }, 1000);
            }
        } else {
            btnHeartbeat.classList.remove('btn-danger');
            btnHeartbeat.innerHTML = '<i class="fa-solid fa-heart-pulse"></i> صوت التوتر والقلب';
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
        }
    }

    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
        gameState.soundEnabled = !gameState.soundEnabled;
        const icon = document.getElementById('btn-sound-toggle').querySelector('i');
        if (gameState.soundEnabled) {
            icon.className = 'fa-solid fa-volume-high';
            showToast("تم تشغيل الصوت");
        } else {
            icon.className = 'fa-solid fa-volume-xmark';
            showToast("تم كتم الصوت");
        }
    });

    // ==========================================
    // 3. BACKGROUND CANVAS
    // ==========================================
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2.5 + 0.5;
            this.speedY = Math.random() * 0.4 - 0.2;
            this.speedX = Math.random() * 0.4 - 0.2;
            this.opacity = Math.random() * 0.5 + 0.2;
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.reset();
        }
        draw() {
            ctx.fillStyle = `rgba(240, 201, 106, ${this.opacity})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let i = 0; i < 45; i++) particles.push(new Particle());
    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animateParticles);
    }
    animateParticles();

    // ==========================================
    // 4. UI STEP NAVIGATION & TABS
    // ==========================================
    function showStep(stepId) {
        document.querySelectorAll('.game-step').forEach(sec => sec.classList.remove('active'));
        const target = document.getElementById(stepId);
        if (target) {
            target.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2800);
    }

    // Setup Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            playClickSound();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // ==========================================
    // 5. PEERJS ONLINE MULTIPLAYER ROOM ENGINE
    // ==========================================
    
    // TAB 1: Host Room Creation
    document.getElementById('btn-create-online-room').addEventListener('click', () => {
        playClickSound();
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        gameState.roomCode = code;
        gameState.mode = 'host';
        gameState.myRole = 'host';

        document.getElementById('disp-room-code').textContent = code;
        document.getElementById('host-room-active-info').classList.remove('hidden');
        document.getElementById('btn-create-online-room').classList.add('hidden');

        // Init Host Peer
        const peerId = `sos-room-${code}`;
        peer = new Peer(peerId);

        peer.on('open', (id) => {
            showToast(`تم إنشاء الغرفة الكود: ${code}`);
        });

        peer.on('connection', (conn) => {
            peerConnections.push(conn);

            conn.on('data', (data) => {
                handleHostReceivedData(data, conn);
            });

            conn.on('open', () => {
                showToast("متنافس جديد انضم للغرفة!");
            });
        });

        peer.on('error', (err) => {
            console.error("Peer Error:", err);
            showToast("تعذر إنشاء الغرفة بنفس الكود، جرب كود آخر");
        });
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
        playClickSound();
        navigator.clipboard.writeText(gameState.roomCode);
        showToast("تم نسخ كود الغرفة إلى الحافظة!");
    });

    function handleHostReceivedData(data, conn) {
        if (data.type === 'JOIN_REQUEST') {
            if (!gameState.players.p1.conn) {
                gameState.players.p1.name = data.playerName || "المتنافس 1";
                gameState.players.p1.conn = conn;
                document.getElementById('name-p1-slot').textContent = gameState.players.p1.name;
                conn.send({ type: 'JOIN_ACCEPTED', role: 'p1', p1Name: gameState.players.p1.name, p2Name: gameState.players.p2.name });
            } else if (!gameState.players.p2.conn) {
                gameState.players.p2.name = data.playerName || "المتنافس 2";
                gameState.players.p2.conn = conn;
                document.getElementById('name-p2-slot').textContent = gameState.players.p2.name;
                conn.send({ type: 'JOIN_ACCEPTED', role: 'p2', p1Name: gameState.players.p1.name, p2Name: gameState.players.p2.name });
                document.getElementById('btn-host-start-online-game').disabled = false;
            }
            broadcastGameState();
        } else if (data.type === 'PICK_CARD') {
            if (data.player === gameState.currentTurn) {
                const cardEl = cardsGrid.children[data.cardIdx];
                if (cardEl) handleCardPick(data.cardIdx, cardEl);
                broadcastGameState();
            }
        } else if (data.type === 'SUBMIT_SHOWDOWN') {
            if (data.player === '1') gameState.showdownChoices.p1 = data.choice;
            if (data.player === '2') gameState.showdownChoices.p2 = data.choice;
            
            document.getElementById('p1-choice-status').textContent = gameState.showdownChoices.p1 ? "تم الاختيار سرياً ✓" : "في انتظار الاختيار...";
            document.getElementById('p2-choice-status').textContent = gameState.showdownChoices.p2 ? "تم الاختيار سرياً ✓" : "في انتظار الاختيار...";

            if (gameState.showdownChoices.p1 && gameState.showdownChoices.p2) {
                document.getElementById('btn-host-trigger-final-reveal').disabled = false;
            }
            broadcastGameState();
        }
    }

    function broadcastGameState(customAction = null) {
        const payload = {
            type: 'STATE_SYNC',
            action: customAction,
            currentTurn: gameState.currentTurn,
            p1Picks: gameState.players.p1.picks,
            p2Picks: gameState.players.p2.picks,
            p1Name: gameState.players.p1.name,
            p2Name: gameState.players.p2.name,
            runningPot: gameState.runningPot,
            selectedCardsOrder: gameState.selectedCardsOrder,
            currentRevealStageIndex: gameState.currentRevealStageIndex,
            showdownChoicesReady: { p1: !!gameState.showdownChoices.p1, p2: !!gameState.showdownChoices.p2 }
        };

        peerConnections.forEach(conn => {
            if (conn.open) conn.send(payload);
        });
    }

    // TAB 2: Player Join Room
    document.getElementById('btn-join-room-action').addEventListener('click', () => {
        playClickSound();
        const code = document.getElementById('join-room-code-input').value.trim();
        const name = document.getElementById('join-player-name-input').value.trim() || "لاعب أونلاين";

        if (!code) { showToast("يرجى إدخال كود الغرفة!"); return; }

        const statusBanner = document.getElementById('join-status-msg');
        statusBanner.classList.remove('hidden');
        statusBanner.textContent = "جاري الاتصال بالغرفة...";

        peer = new Peer();

        peer.on('open', () => {
            const hostPeerId = `sos-room-${code}`;
            hostConn = peer.connect(hostPeerId);

            hostConn.on('open', () => {
                statusBanner.textContent = "تم الاتصال بالهوست! في انتظار بدء المسابقة...";
                gameState.mode = 'client';
                hostConn.send({ type: 'JOIN_REQUEST', playerName: name });
            });

            hostConn.on('data', (data) => {
                handleClientReceivedData(data);
            });

            hostConn.on('error', (err) => {
                statusBanner.textContent = "فشل الاتصال بالغرفة. التأكد من الكود!";
            });
        });
    });

    function handleClientReceivedData(data) {
        if (data.type === 'JOIN_ACCEPTED') {
            gameState.myRole = data.role;
            showToast(`تم قبولك في الغرفة كـ (${data.role === 'p1' ? 'المتنافس الأول' : 'المتنافس الثاني'})`);
        } else if (data.type === 'STATE_SYNC') {
            syncClientState(data);
        } else if (data.type === 'START_GAME') {
            document.getElementById('disp-p1-name').textContent = data.p1Name;
            document.getElementById('disp-p2-name').textContent = data.p2Name;
            render20CardsGrid();
            updateSelectionStatus();
            showStep('step-selection');
        } else if (data.type === 'GOTO_HOST_REVEAL') {
            prepareHostStage();
            showStep('step-host-reveal');
        } else if (data.type === 'GOTO_SHOWDOWN') {
            prepareShowdownStage();
            showStep('step-showdown');
        } else if (data.type === 'EXECUTE_FINAL_OUTCOME') {
            executeFinalOutcome(data.p1Choice, data.p2Choice);
        }
    }

    function syncClientState(data) {
        gameState.currentTurn = data.currentTurn;
        gameState.players.p1.picks = data.p1Picks;
        gameState.players.p2.picks = data.p2Picks;
        gameState.players.p1.name = data.p1Name;
        gameState.players.p2.name = data.p2Name;
        gameState.runningPot = data.runningPot;
        gameState.selectedCardsOrder = data.selectedCardsOrder;
        gameState.currentRevealStageIndex = data.currentRevealStageIndex;

        updateSelectionStatus();
    }

    // TAB 3: Local Game
    document.getElementById('btn-start-local-game').addEventListener('click', () => {
        playClickSound();
        gameState.mode = 'local';
        gameState.myRole = 'host';

        const p1Name = document.getElementById('p1-name-local').value.trim() || "المتنافس 1";
        const p2Name = document.getElementById('p2-name-local').value.trim() || "المتنافس 2";

        gameState.players.p1.name = p1Name;
        gameState.players.p1.picks = [];
        gameState.players.p2.name = p2Name;
        gameState.players.p2.picks = [];
        gameState.currentTurn = 'p1';
        gameState.selectedCardsOrder = [];
        gameState.runningPot = 0;

        document.getElementById('disp-p1-name').textContent = p1Name;
        document.getElementById('disp-p2-name').textContent = p2Name;
        document.getElementById('showdown-p1-title').textContent = p1Name;
        document.getElementById('showdown-p2-title').textContent = p2Name;

        render20CardsGrid();
        updateSelectionStatus();
        showStep('step-selection');
    });

    document.getElementById('btn-host-start-online-game').addEventListener('click', () => {
        playClickSound();
        document.getElementById('disp-p1-name').textContent = gameState.players.p1.name;
        document.getElementById('disp-p2-name').textContent = gameState.players.p2.name;
        document.getElementById('showdown-p1-title').textContent = gameState.players.p1.name;
        document.getElementById('showdown-p2-title').textContent = gameState.players.p2.name;

        render20CardsGrid();
        updateSelectionStatus();
        showStep('step-selection');

        peerConnections.forEach(conn => conn.send({ type: 'START_GAME', p1Name: gameState.players.p1.name, p2Name: gameState.players.p2.name }));
    });

    // ==========================================
    // 6. ADMIN CONTROL PANEL
    // ==========================================
    const modalAdmin = document.getElementById('modal-admin');
    const adminInputsContainer = document.getElementById('admin-cards-inputs-container');

    const savedConfig = localStorage.getItem('split_steal_admin_cards');
    if (savedConfig) {
        try { gameState.cardsConfig = JSON.parse(savedConfig); } catch (e) {}
    }

    function renderAdminInputs() {
        adminInputsContainer.innerHTML = '';
        gameState.cardsConfig.forEach((val, idx) => {
            const item = document.createElement('div');
            item.className = 'admin-card-input-item';
            item.innerHTML = `
                <label>كارت رقم ${idx + 1}</label>
                <input type="text" data-card-idx="${idx}" value="${val}">
            `;
            adminInputsContainer.appendChild(item);
        });
    }

    document.getElementById('btn-admin-modal').addEventListener('click', () => {
        playClickSound();
        renderAdminInputs();
        modalAdmin.classList.add('open');
    });

    document.getElementById('btn-close-admin-modal').addEventListener('click', () => {
        playClickSound();
        modalAdmin.classList.remove('open');
    });

    document.getElementById('btn-save-admin-config').addEventListener('click', () => {
        playClickSound();
        const inputs = adminInputsContainer.querySelectorAll('input');
        const newConfig = [];
        inputs.forEach(inp => {
            let val = inp.value.trim();
            if (!isNaN(val) && val !== '') newConfig.push(Number(val));
            else newConfig.push(val);
        });
        gameState.cardsConfig = newConfig;
        localStorage.setItem('split_steal_admin_cards', JSON.stringify(newConfig));
        modalAdmin.classList.remove('open');
        showToast("تم حفظ قيم الـ 20 كرت بنجاح!");
    });

    document.getElementById('btn-preset-default').addEventListener('click', () => { playClickSound(); gameState.cardsConfig = [...DEFAULT_CARDS_20]; renderAdminInputs(); });
    document.getElementById('btn-preset-high-stakes').addEventListener('click', () => {
        playClickSound();
        gameState.cardsConfig = [
            100, 250, 500, 1000, 2500, 
            "القاتل", 5000, 10000, 500, 1500, 
            3000, 7500, "القاتل", 15000, 200, 
            400, 800, 2000, 6000, 12000
        ];
        renderAdminInputs();
    });
    document.getElementById('btn-preset-randomize').addEventListener('click', () => {
        playClickSound();
        gameState.cardsConfig = [...gameState.cardsConfig].sort(() => Math.random() - 0.5);
        renderAdminInputs();
    });

    // ==========================================
    // 7. STEP 2: 20 CARDS SELECTION GRID
    // ==========================================
    const cardsGrid = document.getElementById('cards-grid-20');

    function render20CardsGrid() {
        cardsGrid.innerHTML = '';
        for (let i = 0; i < 20; i++) {
            const cardEl = document.createElement('div');
            cardEl.className = 'card-item';
            cardEl.dataset.cardIndex = i;

            cardEl.innerHTML = `
                <div class="card-inner">
                    <div class="card-front">
                        <div class="card-pattern">
                            <i class="fa-solid fa-vault"></i>
                            <span class="card-num-badge">${i + 1}</span>
                        </div>
                    </div>
                </div>
            `;

            cardEl.addEventListener('click', () => {
                if (gameState.mode === 'client') {
                    if (gameState.myRole === gameState.currentTurn) {
                        hostConn.send({ type: 'PICK_CARD', cardIdx: i, player: gameState.myRole });
                    } else {
                        showToast("ليس دورك الآن للاختيار!");
                    }
                } else {
                    handleCardPick(i, cardEl);
                }
            });

            cardsGrid.appendChild(cardEl);
        }
    }

    function handleCardPick(cardIdx, cardEl) {
        if (gameState.players.p1.picks.includes(cardIdx) || gameState.players.p2.picks.includes(cardIdx)) {
            showToast("هذا الكرت مختار مسبقاً!");
            return;
        }

        const turn = gameState.currentTurn;
        if (turn === 'p1') {
            if (gameState.players.p1.picks.length >= 3) return;
            gameState.players.p1.picks.push(cardIdx);
            gameState.selectedCardsOrder.push({ cardIndex: cardIdx, owner: 'p1', val: gameState.cardsConfig[cardIdx] });
            cardEl.classList.add('picked-p1', 'selected');
            cardEl.querySelector('.card-front').insertAdjacentHTML('beforeend', `<span class="picked-tag p1">${gameState.players.p1.name}</span>`);
            playCardSelectSound();

            if (gameState.players.p1.picks.length === 3) gameState.currentTurn = 'p2';
        } else if (turn === 'p2') {
            if (gameState.players.p2.picks.length >= 3) return;
            gameState.players.p2.picks.push(cardIdx);
            gameState.selectedCardsOrder.push({ cardIndex: cardIdx, owner: 'p2', val: gameState.cardsConfig[cardIdx] });
            cardEl.classList.add('picked-p2', 'selected');
            cardEl.querySelector('.card-front').insertAdjacentHTML('beforeend', `<span class="picked-tag p2">${gameState.players.p2.name}</span>`);
            playCardSelectSound();

            if (gameState.players.p2.picks.length === 3) gameState.currentTurn = 'complete';
        }

        updateSelectionStatus();
        if (gameState.mode === 'host') broadcastGameState();
    }

    function updateSelectionStatus() {
        const p1Count = gameState.players.p1.picks.length;
        const p2Count = gameState.players.p2.picks.length;

        document.getElementById('p1-picks-count').textContent = `${p1Count}/3`;
        document.getElementById('p2-picks-count').textContent = `${p2Count}/3`;

        const indP1 = document.getElementById('ind-p1');
        const indP2 = document.getElementById('ind-p2');
        const promptText = document.getElementById('turn-prompt-text');
        const btnProceed = document.getElementById('btn-proceed-to-host-approval');

        if (gameState.currentTurn === 'p1') {
            indP1.classList.add('active-turn');
            indP2.classList.remove('active-turn');
            promptText.innerHTML = `دور <span class="highlight-player" style="color:var(--p1-color)">${gameState.players.p1.name}</span> لاختيار الكرت ${p1Count + 1} من 3`;
            btnProceed.disabled = true;
        } else if (gameState.currentTurn === 'p2') {
            indP1.classList.remove('active-turn');
            indP2.classList.add('active-turn');
            promptText.innerHTML = `دور <span class="highlight-player" style="color:var(--p2-color)">${gameState.players.p2.name}</span> لاختيار الكرت ${p2Count + 1} من 3`;
            btnProceed.disabled = true;
        } else {
            indP1.classList.remove('active-turn');
            indP2.classList.remove('active-turn');
            promptText.innerHTML = `<span class="highlight-player" style="color:var(--gold-bright)">تم اختيار الـ 6 كروت بنجاح! انتقل لمرحلة موافقة الهوست.</span>`;
            btnProceed.disabled = false;
        }
    }

    document.getElementById('btn-proceed-to-host-approval').addEventListener('click', () => {
        playClickSound();
        prepareHostStage();
        showStep('step-host-reveal');
        if (gameState.mode === 'host') peerConnections.forEach(c => c.send({ type: 'GOTO_HOST_REVEAL' }));
    });

    // ==========================================
    // 8. STEP 3: HOST SUSPENSE & CARD REVEAL STAGE
    // ==========================================
    const selectedCardsStageContainer = document.getElementById('selected-cards-stage-container');
    const hostStagePotDisp = document.getElementById('host-stage-pot');
    const killerAlertBanner = document.getElementById('killer-alert-banner');
    const hostActionStatus = document.getElementById('host-action-status');
    const btnHostRevealNext = document.getElementById('btn-host-reveal-next');
    const btnGotoShowdown = document.getElementById('btn-goto-showdown');

    function prepareHostStage() {
        gameState.runningPot = 0;
        gameState.currentRevealStageIndex = 0;
        hostStagePotDisp.textContent = "0";
        killerAlertBanner.classList.add('hidden');
        btnHostRevealNext.disabled = false;
        btnHostRevealNext.classList.remove('hidden');
        btnGotoShowdown.classList.add('hidden');

        selectedCardsStageContainer.innerHTML = '';
        gameState.selectedCardsOrder.forEach((item, idx) => {
            const ownerName = item.owner === 'p1' ? gameState.players.p1.name : gameState.players.p2.name;
            const ownerClass = item.owner;

            const box = document.createElement('div');
            box.className = 'stage-card-box';
            box.dataset.stageIdx = idx;
            if (idx === 0) box.classList.add('pending-pulse');

            box.innerHTML = `
                <div class="stage-card-inner">
                    <div class="stage-card-front">
                        <span class="owner-pill ${ownerClass}">${ownerName}</span>
                        <div class="card-pattern">
                            <i class="fa-solid fa-question"></i>
                            <span style="font-size:0.9rem; color:var(--text-muted)">كرت #${idx + 1}</span>
                        </div>
                    </div>
                    <div class="stage-card-back ${String(item.val).includes('القاتل') ? 'is-killer' : ''}">
                        <span class="owner-pill ${ownerClass}">${ownerName}</span>
                        <span class="card-val-text">${item.val}</span>
                    </div>
                </div>
            `;

            selectedCardsStageContainer.appendChild(box);
        });

        hostActionStatus.textContent = `جاهز لكشف كرت #${1} (${gameState.selectedCardsOrder[0].owner === 'p1' ? gameState.players.p1.name : gameState.players.p2.name})`;
    }

    document.getElementById('btn-host-heartbeat-toggle').addEventListener('click', () => { toggleHeartbeatSound(); });

    btnHostRevealNext.addEventListener('click', () => {
        const idx = gameState.currentRevealStageIndex;
        if (idx >= gameState.selectedCardsOrder.length) return;

        const currentItem = gameState.selectedCardsOrder[idx];
        const cardBox = selectedCardsStageContainer.children[idx];

        cardBox.classList.remove('pending-pulse');
        cardBox.classList.add('revealed');
        playCardFlipSound();

        const cardVal = currentItem.val;

        setTimeout(() => {
            if (typeof cardVal === 'number') {
                gameState.runningPot += cardVal;
                hostStagePotDisp.textContent = gameState.runningPot.toLocaleString('ar-EG');
                playPointsGainSound();
            } else if (String(cardVal).includes('القاتل')) {
                gameState.runningPot = 0;
                hostStagePotDisp.textContent = "0";
                killerAlertBanner.classList.remove('hidden');
                playKillerExplosionSound();
            }

            gameState.currentRevealStageIndex++;

            if (gameState.currentRevealStageIndex < gameState.selectedCardsOrder.length) {
                const nextItem = gameState.selectedCardsOrder[gameState.currentRevealStageIndex];
                const nextBox = selectedCardsStageContainer.children[gameState.currentRevealStageIndex];
                nextBox.classList.add('pending-pulse');
                const nextOwner = nextItem.owner === 'p1' ? gameState.players.p1.name : gameState.players.p2.name;
                hostActionStatus.textContent = `جاهز لكشف كرت #${gameState.currentRevealStageIndex + 1} (${nextOwner})`;
            } else {
                toggleHeartbeatSound(false);
                hostActionStatus.textContent = `تم كشف جميع الكروت الـ 6! الخزنة النهائية = ${gameState.runningPot.toLocaleString('ar-EG')} نقطة`;
                btnHostRevealNext.classList.add('hidden');
                btnGotoShowdown.classList.remove('hidden');
            }

            if (gameState.mode === 'host') broadcastGameState();
        }, 600);
    });

    btnGotoShowdown.addEventListener('click', () => {
        playClickSound();
        prepareShowdownStage();
        showStep('step-showdown');
        if (gameState.mode === 'host') peerConnections.forEach(c => c.send({ type: 'GOTO_SHOWDOWN' }));
    });

    // ==========================================
    // 9. STEP 4: FINAL SHOWDOWN (SPLIT OR STEAL)
    // ==========================================
    const finalPotValueDisp = document.getElementById('final-pot-value');
    const p1ChoiceStatus = document.getElementById('p1-choice-status');
    const p2ChoiceStatus = document.getElementById('p2-choice-status');
    const btnTriggerFinalReveal = document.getElementById('btn-host-trigger-final-reveal');
    const showdownResultBox = document.getElementById('showdown-result-box');

    function prepareShowdownStage() {
        finalPotValueDisp.textContent = gameState.runningPot.toLocaleString('ar-EG');
        gameState.showdownChoices = { p1: null, p2: null };

        p1ChoiceStatus.textContent = "في انتظار الاختيار السري...";
        p1ChoiceStatus.className = "choice-status-badge";
        p2ChoiceStatus.textContent = "في انتظار الاختيار السري...";
        p2ChoiceStatus.className = "choice-status-badge";

        btnTriggerFinalReveal.disabled = true;
        showdownResultBox.classList.add('hidden');
    }

    document.querySelectorAll('.btn-choice').forEach(btn => {
        btn.addEventListener('click', (e) => {
            playClickSound();
            const player = e.currentTarget.dataset.player;
            const choice = e.currentTarget.dataset.choice;

            if (gameState.mode === 'client') {
                if (gameState.myRole === `p${player}`) {
                    hostConn.send({ type: 'SUBMIT_SHOWDOWN', player, choice });
                    showToast("تم إرسال اختيارك السري للهوست بنجاح!");
                } else {
                    showToast("يمكنك اختيار زرك الخاص بك فقط من جوالك!");
                }
            } else {
                if (player === '1') {
                    gameState.showdownChoices.p1 = choice;
                    p1ChoiceStatus.textContent = "تم الاختيار سرياً ✓";
                    p1ChoiceStatus.classList.add('chosen');
                } else if (player === '2') {
                    gameState.showdownChoices.p2 = choice;
                    p2ChoiceStatus.textContent = "تم الاختيار سرياً ✓";
                    p2ChoiceStatus.classList.add('chosen');
                }

                if (gameState.showdownChoices.p1 && gameState.showdownChoices.p2) {
                    btnTriggerFinalReveal.disabled = false;
                }
            }
        });
    });

    btnTriggerFinalReveal.addEventListener('click', () => {
        playClickSound();
        btnTriggerFinalReveal.disabled = true;

        const countdownNum = document.getElementById('final-countdown-num');
        countdownNum.classList.remove('hidden');

        let count = 3;
        countdownNum.textContent = count;
        playTone(500, 0.15, 'sine', 0.2);

        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                countdownNum.textContent = count;
                playTone(500, 0.15, 'sine', 0.2);
            } else {
                clearInterval(timer);
                countdownNum.classList.add('hidden');
                executeFinalOutcome(gameState.showdownChoices.p1, gameState.showdownChoices.p2);
                if (gameState.mode === 'host') {
                    peerConnections.forEach(c => c.send({ type: 'EXECUTE_FINAL_OUTCOME', p1Choice: gameState.showdownChoices.p1, p2Choice: gameState.showdownChoices.p2 }));
                }
            }
        }, 1000);
    });

    function executeFinalOutcome(c1, c2) {
        const totalPot = gameState.runningPot;
        const p1Name = gameState.players.p1.name;
        const p2Name = gameState.players.p2.name;

        let resHeadline = "";
        let resSubtext = "";
        let resP1Score = 0;
        let resP2Score = 0;
        let iconClass = "fa-trophy";

        if (c1 === 'split' && c2 === 'split') {
            resP1Score = Math.floor(totalPot / 2);
            resP2Score = Math.floor(totalPot / 2);
            resHeadline = "🤝 اتّفاق ومشاركة عادلة!";
            resSubtext = `اختار الطرفان "شاركني" وتم تقاسم الـ ${totalPot.toLocaleString('ar-EG')} نقطة بالتساوي!`;
            iconClass = "fa-handshake";
            playShowdownFanfareSound();
        } else if (c1 === 'steal' && c2 === 'split') {
            resP1Score = totalPot;
            resP2Score = 0;
            resHeadline = `😈 ${p1Name} يستحوذ ويُسقط الخزنة!`;
            resSubtext = `اختار ${p1Name} "اسرقني" واختار ${p2Name} "شاركني"! السارق أخذ الـ 100% كاملاً.`;
            iconClass = "fa-mask";
            playShowdownFanfareSound();
        } else if (c1 === 'split' && c2 === 'steal') {
            resP1Score = 0;
            resP2Score = totalPot;
            resHeadline = `😈 ${p2Name} يستحوذ ويُسقط الخزنة!`;
            resSubtext = `اختار ${p2Name} "اسرقني" واختار ${p1Name} "شاركني"! السارق أخذ الـ 100% كاملاً.`;
            iconClass = "fa-mask";
            playShowdownFanfareSound();
        } else if (c1 === 'steal' && c2 === 'steal') {
            resP1Score = 0;
            resP2Score = 0;
            resHeadline = "💥 طمع مزدوج وخسارة كليّة!";
            resSubtext = `اختار الاثنين "اسرقني"! ضاعت الخزنة بالكامل وخرج الطرفان بـ 0 نقطة!`;
            iconClass = "fa-skull-crossbones";
            playKillerExplosionSound();
        }

        document.getElementById('result-icon').innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
        document.getElementById('result-headline').textContent = resHeadline;
        document.getElementById('result-subtext').textContent = resSubtext;

        document.getElementById('res-p1-name').textContent = p1Name;
        document.getElementById('res-p1-choice-text').textContent = c1 === 'split' ? "شاركني (Split)" : "اسرقني (Steal)";
        document.getElementById('res-p1-score').textContent = `+${resP1Score.toLocaleString('ar-EG')} نقطة`;

        document.getElementById('res-p2-name').textContent = p2Name;
        document.getElementById('res-p2-choice-text').textContent = c2 === 'split' ? "شاركني (Split)" : "اسرقني (Steal)";
        document.getElementById('res-p2-score').textContent = `+${resP2Score.toLocaleString('ar-EG')} نقطة`;

        showdownResultBox.classList.remove('hidden');
    }

    document.getElementById('btn-restart-new-game').addEventListener('click', () => {
        playClickSound();
        showStep('step-setup');
    });

});

// ==========================================
// NEON BINGO BLAST - ADMIN PORTAL SCRIPT
// ==========================================

// --- State Variables ---
let gameStarted = false;
let gameEnded = false;
let drawnNumbers = new Set();
let allAvailableNumbers = [];
let callerTimer = null;
let autoPlaySpeed = 4000; // in ms
let isAutoPlaying = false;
let isMuted = false;
let isVoiceEnabled = true;

// Sound effects settings
let audioCtx = null;
let totalCalls = 0;

// Game Config
const TOTAL_NUMBERS = 75;
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const LETTER_RANGES = {
    'B': { min: 1, max: 15 },
    'I': { min: 16, max: 30 },
    'N': { min: 31, max: 45 },
    'G': { min: 46, max: 60 },
    'O': { min: 61, max: 75 }
};

let currentTargetPattern = 'line';

// --- Web Audio API Synth ---
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSynthSound(type) {
    if (isMuted) return;
    initAudio();
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    switch (type) {
        case 'draw':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
            
        case 'claim':
            // High chime to alert host
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.1);
            osc.frequency.setValueAtTime(783.99, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
            osc.start(now);
            osc.stop(now + 0.45);
            break;
            
        case 'correct':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
            break;
            
        case 'incorrect':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(130.81, now);
            osc.frequency.setValueAtTime(110.00, now + 0.1);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
            break;
    }
}

// --- Text to Speech Caller ---
function speakNumber(letter, number) {
    if (!isVoiceEnabled || window.speechSynthesis.speaking) return;
    const text = `${letter}, ${number}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = isMuted ? 0 : 0.8;
    utterance.rate = 1.1;
    
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en-GB'));
    if (englishVoice) {
        utterance.voice = englishVoice;
    }
    
    window.speechSynthesis.speak(utterance);
}

// --- Helpers ---
function getNumberLetter(num) {
    for (const letter of LETTERS) {
        if (num >= LETTER_RANGES[letter].min && num <= LETTER_RANGES[letter].max) {
            return letter;
        }
    }
    return '';
}

function getBingoCallerPhrase(letter, num) {
    const phrases = {
        1: "Kelly's Eye", 2: "One Little Duck", 3: "Cup of Tea", 8: "Garden Gate",
        9: "Doctor's Orders", 11: "Legs Eleven", 12: "One Dozen", 16: "Sweet Sixteen",
        17: "Dancing Queen", 21: "Key of the Door", 22: "Two Little Ducks", 30: "Dirty Gertie",
        44: "Droopy Drawers", 55: "Snakes Alive", 66: "Clickety Click", 75: "Granddaddy of them all"
    };
    return phrases[num] || `Number ${num}`;
}

// Setup numbers (1-75)
function resetCallerPool() {
    allAvailableNumbers = [];
    for (let i = 1; i <= TOTAL_NUMBERS; i++) {
        allAvailableNumbers.push(i);
    }
    for (let i = allAvailableNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allAvailableNumbers[i], allAvailableNumbers[j]] = [allAvailableNumbers[j], allAvailableNumbers[i]];
    }
    drawnNumbers.clear();
    totalCalls = 0;
}

function updateHistoryUI(letter, num) {
    const historyContainer = document.getElementById('history-balls');
    const emptyMsg = historyContainer.querySelector('.empty-history');
    if (emptyMsg) emptyMsg.remove();

    const ballHtml = `<div class="history-ball ball-${letter}">${letter}${num}</div>`;
    historyContainer.insertAdjacentHTML('afterbegin', ballHtml);

    const balls = historyContainer.querySelectorAll('.history-ball');
    if (balls.length > 8) {
        balls[balls.length - 1].remove();
    }
}

function renderMasterBoard() {
    const board = document.getElementById('master-board');
    board.innerHTML = '';

    for (let c = 0; c < 5; c++) {
        const letter = LETTERS[c];
        board.insertAdjacentHTML('beforeend', `<div class="mb-letter">${letter}</div>`);
        
        const range = LETTER_RANGES[letter];
        for (let num = range.min; num <= range.max; num++) {
            board.insertAdjacentHTML('beforeend', `
                <div class="mb-cell" data-num="${num}">
                    ${num}
                </div>
            `);
        }
    }
}

// --- Pattern Preview Grid Drawings ---
function drawPatternPreviews() {
    const lineGrid = document.querySelector('.line-pattern');
    lineGrid.innerHTML = '';
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const isMarked = (r === 2);
            lineGrid.insertAdjacentHTML('beforeend', `<div class="${isMarked ? 'marked' : ''}"></div>`);
        }
    }

    const dLineGrid = document.querySelector('.double-line-pattern');
    dLineGrid.innerHTML = '';
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const isMarked = (r === 1 || r === 3);
            dLineGrid.insertAdjacentHTML('beforeend', `<div class="${isMarked ? 'marked' : ''}"></div>`);
        }
    }

    const cornersGrid = document.querySelector('.corners-pattern');
    cornersGrid.innerHTML = '';
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const isMarked = (r === 0 || r === 4) && (c === 0 || c === 4);
            cornersGrid.insertAdjacentHTML('beforeend', `<div class="${isMarked ? 'marked' : ''}"></div>`);
        }
    }

    const fhGrid = document.querySelector('.full-house-pattern');
    fhGrid.innerHTML = '';
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            fhGrid.insertAdjacentHTML('beforeend', `<div class="marked"></div>`);
        }
    }
}

// --- Active Players Sync & Rendering ---
let activePlayersRef = null;
let claimsRef = null;
let currentClaimsCount = 0;

function setupFirebaseListeners() {
    if (!fbService.connected) return;

    // 1. Listen to Players
    if (activePlayersRef) activePlayersRef.off();
    activePlayersRef = fbService.listenActivePlayers((players) => {
        renderPlayersList(players);
    });

    // 2. Listen to BINGO Claims
    if (claimsRef) claimsRef.off();
    claimsRef = fbService.listenClaims((claims) => {
        renderClaimsList(claims);
    });
}

function renderPlayersList(players) {
    const listBody = document.getElementById('players-list-body');
    const countBadge = document.getElementById('player-count');
    listBody.innerHTML = '';

    const onlinePlayers = players.filter(p => p.active !== false);
    countBadge.textContent = `${onlinePlayers.length} ACTIVE`;

    if (onlinePlayers.length === 0) {
        listBody.innerHTML = `
            <tr>
                <td colspan="4" class="no-players">No active players online.</td>
            </tr>
        `;
        return;
    }

    onlinePlayers.forEach(p => {
        const isClaiming = p.claimed;
        const statusClass = isClaiming ? 'claiming' : 'online';
        const statusText = isClaiming ? 'BINGO CLAIM!' : 'ONLINE';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <span style="font-weight: 700; color: var(--text-main);">${p.nickname}</span>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${p.identity}</div>
            </td>
            <td>${p.cardCount || 1} Cards</td>
            <td class="player-progress-cell">
                <div class="player-progress-wrapper">
                    <span class="player-progress-val">${p.progress || 0}%</span>
                    <div class="player-progress-bar">
                        <div class="player-progress-fill" style="width: ${p.progress || 0}%"></div>
                    </div>
                </div>
            </td>
            <td>
                <span class="player-status-badge ${statusClass}">
                    <i class="fa-solid ${isClaiming ? 'fa-triangle-exclamation' : 'fa-circle-dot'}"></i>
                    ${statusText}
                </span>
            </td>
        `;
        listBody.appendChild(row);
    });
}

function renderClaimsList(claims) {
    const container = document.getElementById('claims-container');
    container.innerHTML = '';

    if (claims.length > currentClaimsCount) {
        playSynthSound('claim');
    }
    currentClaimsCount = claims.length;

    claims.forEach(c => {
        const cardHtml = `
            <div class="claims-card" data-key="${c.key}">
                <div class="claim-header">
                    <span class="claim-title">
                        <i class="fa-solid fa-trophy"></i> BINGO CLAIM FILED!
                    </span>
                    <span class="claim-time">${new Date(c.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="claim-details">
                    Player <strong>${c.nickname}</strong> has filed a Bingo claim on Ticket <strong>#${c.cardId}</strong>.
                    <br>Declared card progress: <strong>${c.progress}%</strong>
                </div>
                <div class="claim-actions">
                    <button class="btn btn-success btn-approve-claim" data-key="${c.key}" data-nickname="${c.nickname}" data-identity="${c.identity}">
                        <i class="fa-solid fa-check"></i> VERIFY & APPROVE
                    </button>
                    <button class="btn btn-danger btn-reject-claim" data-key="${c.key}" data-nickname="${c.nickname}" data-identity="${c.identity}">
                        <i class="fa-solid fa-xmark"></i> REJECT
                    </button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHtml);
    });

    // Add click listeners to claims action buttons
    container.querySelectorAll('.btn-approve-claim').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const nickname = btn.dataset.nickname;
            const identity = btn.dataset.identity;
            approveClaim(identity, nickname);
        });
    });

    container.querySelectorAll('.btn-reject-claim').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const nickname = btn.dataset.nickname;
            const identity = btn.dataset.identity;
            rejectClaim(identity, nickname);
        });
    });
}

async function approveClaim(identity, nickname) {
    if (!confirm(`Approve BINGO claim for ${nickname}? This will end the game and declare them winner.`)) return;
    try {
        pauseAutoPlay();
        await fbService.adminVerifyBingo(identity, true, nickname);
        playSynthSound('correct');
        document.getElementById('stat-state').textContent = "Game Ended";
        document.getElementById('caller-status').textContent = "ENDED";
        document.getElementById('caller-status').className = "status-badge";
        gameEnded = true;
    } catch (e) {
        console.error(e);
    }
}

async function rejectClaim(identity, nickname) {
    if (!confirm(`Reject BINGO claim for ${nickname} and let them continue?`)) return;
    try {
        await fbService.adminVerifyBingo(identity, false, nickname);
        playSynthSound('incorrect');
    } catch (e) {
        console.error(e);
    }
}

// --- Game Life-cycle ---

async function startGame() {
    if (!fbService.connected) {
        alert("Please connect to Firebase before starting!");
        return;
    }

    gameStarted = true;
    gameEnded = false;
    resetCallerPool();
    
    // UI resets
    document.getElementById('stat-state').textContent = "Playing";
    document.getElementById('stat-state').className = "stat-value text-accent";
    document.getElementById('caller-status').textContent = "PLAYING";
    document.getElementById('caller-status').className = "status-badge active";
    
    document.getElementById('current-ball').textContent = "-";
    document.getElementById('ball-letter').textContent = "CALLING ACTIVE";
    document.getElementById('ball-phrase').textContent = "Draw next ball to push to players";
    document.getElementById('history-balls').innerHTML = '<div class="empty-history">No numbers called yet</div>';
    document.getElementById('stat-calls').textContent = `0 / ${TOTAL_NUMBERS}`;

    // Reset Master Board Cells Visually
    renderMasterBoard();

    // Disable target patterns selection
    const patternCards = document.querySelectorAll('.pattern-card');
    patternCards.forEach(c => c.style.pointerEvents = 'none');

    // Enable Buttons
    document.getElementById('draw-btn').disabled = false;
    document.getElementById('auto-btn').disabled = false;
    document.getElementById('start-game-btn').disabled = true;

    // Push state to Firebase
    try {
        await fbService.adminStartGame(currentTargetPattern);
    } catch (e) {
        console.error(e);
    }
}

async function drawNextBall() {
    if (!gameStarted || gameEnded) return;

    if (allAvailableNumbers.length === 0) {
        pauseAutoPlay();
        alert("All numbers called!");
        return;
    }

    const ballNum = allAvailableNumbers.pop();
    drawnNumbers.add(ballNum);
    totalCalls++;

    const letter = getNumberLetter(ballNum);

    // Local visuals
    const currentBallEl = document.getElementById('current-ball');
    currentBallEl.textContent = `${letter}-${ballNum}`;
    currentBallEl.classList.remove('pulse-ball');
    void currentBallEl.offsetWidth;
    currentBallEl.classList.add('pulse-ball');

    document.getElementById('ball-letter').textContent = `${letter} ${ballNum}`;
    document.getElementById('ball-phrase').textContent = getBingoCallerPhrase(letter, ballNum);
    document.getElementById('stat-calls').textContent = `${totalCalls} / ${TOTAL_NUMBERS}`;

    playSynthSound('draw');
    speakNumber(letter, ballNum);

    const mbCell = document.querySelector(`.mb-cell[data-num="${ballNum}"]`);
    if (mbCell) mbCell.classList.add('called');

    updateHistoryUI(letter, ballNum);

    // Sync to Firebase
    try {
        const drawnNumbersMap = {};
        drawnNumbers.forEach(n => drawnNumbersMap[n] = true);
        await fbService.adminDrawBall(letter, ballNum, drawnNumbersMap);
    } catch (e) {
        console.error(e);
    }

    if (allAvailableNumbers.length === 0) {
        pauseAutoPlay();
    }
}

function startAutoPlay() {
    if (isAutoPlaying || gameEnded) return;
    isAutoPlaying = true;
    
    const autoBtn = document.getElementById('auto-btn');
    autoBtn.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE';
    autoBtn.className = 'btn btn-secondary active';
    
    document.getElementById('caller-status').textContent = "AUTOPLAY";
    document.getElementById('caller-status').classList.add('active');

    drawNextBall();
    callerTimer = setInterval(drawNextBall, autoPlaySpeed);
}

function pauseAutoPlay() {
    if (!isAutoPlaying) return;
    isAutoPlaying = false;

    const autoBtn = document.getElementById('auto-btn');
    autoBtn.innerHTML = '<i class="fa-solid fa-play"></i> AUTO-PLAY';
    autoBtn.className = 'btn btn-secondary';

    document.getElementById('caller-status').textContent = "PLAYING";
    
    if (callerTimer) {
        clearInterval(callerTimer);
        callerTimer = null;
    }
}

async function resetGame() {
    pauseAutoPlay();
    gameStarted = false;
    gameEnded = false;
    drawnNumbers.clear();
    allAvailableNumbers = [];
    totalCalls = 0;

    // Visual Reset
    document.getElementById('stat-state').textContent = "Lobby";
    document.getElementById('stat-state').className = "stat-value";
    document.getElementById('caller-status').textContent = "LOBBY";
    document.getElementById('caller-status').className = "status-badge";

    document.getElementById('current-ball').textContent = "-";
    document.getElementById('ball-letter').textContent = "STANDBY";
    document.getElementById('ball-phrase').textContent = "Awaiting game start";
    document.getElementById('history-balls').innerHTML = '<div class="empty-history">No numbers called yet</div>';
    document.getElementById('stat-calls').textContent = "0 / 75";

    renderMasterBoard();

    // Enable pattern selection
    const patternCards = document.querySelectorAll('.pattern-card');
    patternCards.forEach(c => c.style.pointerEvents = 'auto');

    // Controls reset
    document.getElementById('draw-btn').disabled = true;
    document.getElementById('auto-btn').disabled = true;
    document.getElementById('start-game-btn').disabled = false;

    // Reset Firebase state
    try {
        await fbService.adminResetGame();
    } catch (e) {
        console.error(e);
    }
}

// --- DOM Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    drawPatternPreviews();
    renderMasterBoard();

    // 1. Controls
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    
    document.getElementById('draw-btn').addEventListener('click', () => {
        pauseAutoPlay();
        drawNextBall();
    });

    document.getElementById('auto-btn').addEventListener('click', () => {
        if (isAutoPlaying) {
            pauseAutoPlay();
        } else {
            startAutoPlay();
        }
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        if (confirm("Reset current lobby/game state? This will clear active player progress boards.")) {
            resetGame();
        }
    });

    // Speed Slider
    const speedSlider = document.getElementById('speed-range');
    const speedValSpan = document.getElementById('speed-val');
    speedSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        speedValSpan.textContent = `${val}s`;
        autoPlaySpeed = val * 1000;
        
        if (isAutoPlaying) {
            clearInterval(callerTimer);
            callerTimer = setInterval(drawNextBall, autoPlaySpeed);
        }
    });

    // Sound toggle buttons
    const soundBtn = document.getElementById('sound-btn');
    soundBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        soundBtn.classList.toggle('muted', isMuted);
        soundBtn.innerHTML = isMuted ? 
            '<i class="fa-solid fa-volume-xmark"></i>' : 
            '<i class="fa-solid fa-volume-high"></i>';
    });

    const voiceBtn = document.getElementById('voice-btn');
    voiceBtn.addEventListener('click', () => {
        isVoiceEnabled = !isVoiceEnabled;
        voiceBtn.classList.toggle('muted', !isVoiceEnabled);
        voiceBtn.innerHTML = isVoiceEnabled ? 
            '<i class="fa-solid fa-microphone-lines"></i>' : 
            '<i class="fa-solid fa-microphone-lines-slash"></i>';
    });

    // Pattern Selection Cards
    const patternCards = document.querySelectorAll('.select-patterns-grid .pattern-card');
    patternCards.forEach(card => {
        card.addEventListener('click', () => {
            if (gameStarted) return;
            patternCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentTargetPattern = card.dataset.pattern;
        });
    });

    // --- Firebase configuration binding (Admin side) ---
    const fbModal = document.getElementById('fb-modal');
    const fbSettingsBtn = document.getElementById('fb-settings-btn');
    const closeFbModal = document.getElementById('close-fb-modal');
    const fbConfigForm = document.getElementById('fb-config-form');
    const fbClearBtn = document.getElementById('fb-clear-btn');
    const fbStatusText = document.getElementById('fb-status-text');

    function populateFbForm() {
        if (fbService.config) {
            document.getElementById('fb-apiKey').value = fbService.config.apiKey || '';
            document.getElementById('fb-authDomain').value = fbService.config.authDomain || '';
            document.getElementById('fb-databaseURL').value = fbService.config.databaseURL || '';
            document.getElementById('fb-projectId').value = fbService.config.projectId || '';
            document.getElementById('fb-storageBucket').value = fbService.config.storageBucket || '';
            document.getElementById('fb-messagingSenderId').value = fbService.config.messagingSenderId || '';
            document.getElementById('fb-appId').value = fbService.config.appId || '';
        } else {
            fbConfigForm.reset();
        }
    }

    fbSettingsBtn.addEventListener('click', () => {
        populateFbForm();
        fbModal.classList.add('show');
    });

    closeFbModal.addEventListener('click', () => {
        fbModal.classList.remove('show');
    });

    window.addEventListener('click', (e) => {
        if (e.target === fbModal) {
            fbModal.classList.remove('show');
        }
    });

    fbConfigForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fbConfigError = document.getElementById('fb-config-error');
        fbConfigError.textContent = '';

        const newConfig = {
            apiKey: document.getElementById('fb-apiKey').value.trim(),
            authDomain: document.getElementById('fb-authDomain').value.trim(),
            databaseURL: document.getElementById('fb-databaseURL').value.trim(),
            projectId: document.getElementById('fb-projectId').value.trim(),
            storageBucket: document.getElementById('fb-storageBucket').value.trim(),
            messagingSenderId: document.getElementById('fb-messagingSenderId').value.trim(),
            appId: document.getElementById('fb-appId').value.trim()
        };

        try {
            fbService.saveConfig(newConfig);
            if (fbService.connected) {
                fbModal.classList.remove('show');
                location.reload();
            } else {
                fbConfigError.textContent = "Could not connect to Firebase database.";
            }
        } catch (err) {
            fbConfigError.textContent = err.message;
        }
    });

    fbClearBtn.addEventListener('click', () => {
        if (confirm("Disconnect and clear Firebase? Controls will be locked.")) {
            fbService.clearConfig();
            fbModal.classList.remove('show');
            location.reload();
        }
    });

    fbService.onConfigChanged((connected, config) => {
        updateFbUi(connected);
    });

    function updateFbUi(connected) {
        if (connected) {
            fbStatusText.textContent = "Connected";
            fbStatusText.className = "connected";
            fbSettingsBtn.className = "header-btn connected";
            document.getElementById('start-game-btn').disabled = false;
        } else {
            fbStatusText.textContent = "Offline (Unconnected)";
            fbStatusText.className = "disconnected";
            fbSettingsBtn.className = "header-btn disconnected";
            
            // Lock controls
            document.getElementById('start-game-btn').disabled = true;
            document.getElementById('draw-btn').disabled = true;
            document.getElementById('auto-btn').disabled = true;
            document.getElementById('reset-btn').disabled = true;
        }
    }

    updateFbUi(fbService.connected);

    if (fbService.connected) {
        setupFirebaseListeners();
        // Load initial state if exists
        fbService.db.ref('gameState').once('value').then(snapshot => {
            if (snapshot.exists()) {
                const state = snapshot.val();
                if (state.status === 'playing') {
                    // Recover game state
                    gameStarted = true;
                    gameEnded = false;
                    currentTargetPattern = state.targetPattern || 'line';
                    
                    patternCards.forEach(c => {
                        if (c.dataset.pattern === currentTargetPattern) c.classList.add('active');
                        else c.classList.remove('active');
                        c.style.pointerEvents = 'none';
                    });
                    
                    // Recover drawn numbers
                    if (state.drawnNumbers) {
                        Object.keys(state.drawnNumbers).forEach(numStr => {
                            const num = parseInt(numStr);
                            drawnNumbers.add(num);
                            const letter = getNumberLetter(num);
                            const mbCell = document.querySelector(`.mb-cell[data-num="${num}"]`);
                            if (mbCell) mbCell.classList.add('called');
                        });
                        totalCalls = drawnNumbers.size;
                        document.getElementById('stat-calls').textContent = `${totalCalls} / ${TOTAL_NUMBERS}`;
                    }
                    
                    // Regenerate remaining numbers pool (excluding already called ones)
                    allAvailableNumbers = [];
                    for (let i = 1; i <= TOTAL_NUMBERS; i++) {
                        if (!drawnNumbers.has(i)) {
                            allAvailableNumbers.push(i);
                        }
                    }
                    // Shuffle remaining
                    for (let i = allAvailableNumbers.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allAvailableNumbers[i], allAvailableNumbers[j]] = [allAvailableNumbers[j], allAvailableNumbers[i]];
                    }
                    
                    document.getElementById('stat-state').textContent = "Playing";
                    document.getElementById('stat-state').className = "stat-value text-accent";
                    document.getElementById('caller-status').textContent = "PLAYING";
                    document.getElementById('caller-status').className = "status-badge active";
                    
                    if (state.currentBall) {
                        document.getElementById('current-ball').textContent = state.currentBall;
                        const [letter, num] = state.currentBall.split('-');
                        document.getElementById('ball-letter').textContent = `${letter} ${num}`;
                        document.getElementById('ball-phrase').textContent = getBingoCallerPhrase(letter, parseInt(num));
                    }
                    
                    document.getElementById('draw-btn').disabled = false;
                    document.getElementById('auto-btn').disabled = false;
                    document.getElementById('start-game-btn').disabled = true;
                }
            }
        });
    }

    document.body.addEventListener('click', () => {
        initAudio();
    }, { once: true });
});

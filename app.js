// ==========================================
// NEON BINGO BLAST - MAIN APPLICATION SCRIPT
// ==========================================

// --- State Variables ---

//import { initializeApp } from "firebase/app";
//import { getFirestore, doc, onSnapshot } from "firebase/firestore";
let gameStarted = false;
let gameEnded = false;
let drawnNumbers = new Set();
let allAvailableNumbers = [];
let playerCards = [];
let aiOpponents = [];
let callerTimer = null;
let autoPlaySpeed = 4000; // in ms
let isAutoPlaying = false;
let isMuted = false;
let isVoiceEnabled = true;
let currentUser = { identity: "Player1", nickname: "Player 1" }; // Fallback user state

// Sound effects settings
let audioCtx = null;

// Stats tracking
let startTime = null;
let gameTimeInterval = null;
let totalCalls = 0;
let daubAttempts = 0;
let correctDaubs = 0;

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

// Selected Winning Pattern (defaults to 'line')
let currentTargetPattern = 'line';

// AI Names & Difficulty (delay multiplier)
const AI_PROFILES = [
    { name: "CyberBot 9000", difficulty: 1.0, color: "#9d4edd" },
    { name: "AI Sparky", difficulty: 1.4, color: "#00f2fe" },
    { name: "Vector Neon", difficulty: 1.8, color: "#ff007f" }
];

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
            
        case 'correct':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
            break;
            
        case 'incorrect':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(130.81, now); // C3
            osc.frequency.setValueAtTime(110.00, now + 0.1); // A2
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
            break;

        case 'win':
            const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C Major
            osc.type = 'triangle';
            notes.forEach((freq, idx) => {
                const noteTime = now + (idx * 0.08);
                osc.frequency.setValueAtTime(freq, noteTime);
            });
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.85);
            osc.start(now);
            osc.stop(now + 0.85);
            break;

        case 'lose':
            const loseNotes = [392.00, 311.13, 261.63, 196.00]; // G minor
            osc.type = 'sawtooth';
            loseNotes.forEach((freq, idx) => {
                const noteTime = now + (idx * 0.15);
                osc.frequency.setValueAtTime(freq, noteTime);
            });
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
            osc.start(now);
            osc.stop(now + 0.7);
            break;
    }
}

// --- Text to Speech Caller ---
function speakNumber(letter, number) {
    if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
    
    window.speechSynthesis.cancel(); // Cancel queue so speech doesn't lag
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

// --- Bingo Helper Functions ---
function getNumberLetter(num) {
    for (const letter of LETTERS) {
        if (num >= LETTER_RANGES[letter].min && num <= LETTER_RANGES[letter].max) {
            return letter;
        }
    }
    return '';
}

function getRandomUniqueNumbers(count, min, max) {
    const nums = [];
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    
    for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        nums.push(pool.splice(idx, 1)[0]);
    }
    return nums;
}

function generateCardData(cardId) {
    const columns = {};
    for (const letter of LETTERS) {
        const range = LETTER_RANGES[letter];
        columns[letter] = getRandomUniqueNumbers(5, range.min, range.max);
    }
    
    for (const letter of LETTERS) {
        columns[letter].sort((a, b) => a - b);
    }
    
    const rows = [];
    for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
            const letter = LETTERS[c];
            if (r === 2 && c === 2) {
                row.push({ value: 'FREE', daubed: true, isFree: true });
            } else {
                row.push({ value: columns[letter][r], daubed: false, isFree: false });
            }
        }
        rows.push(row);
    }
    
    return { id: cardId, grid: rows };
}

// --- Opponent AI Logic ---
function initAI() {
    aiOpponents = AI_PROFILES.map((profile, index) => {
        const card = generateCardData(`AI-${index + 1}`);
        return {
            ...profile,
            card: card,
            daubedCount: 1,
            progress: 0,
            hasBingo: false
        };
    });
    updateOpponentUI();
}

function processAICalls(numberCalled) {
    aiOpponents.forEach(ai => {
        if (ai.hasBingo || gameEnded) return;

        let cellFound = null;

        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (ai.card.grid[r][c].value === numberCalled) {
                    cellFound = ai.card.grid[r][c];
                    break;
                }
            }
            if (cellFound) break;
        }

        if (cellFound) {
            const delay = (500 + Math.random() * 1500) * ai.difficulty;
            setTimeout(() => {
                if (gameEnded || !drawnNumbers.has(numberCalled)) return;
                
                cellFound.daubed = true;
                ai.daubedCount++;
                ai.progress = calculateBestPatternProgress(ai.card);
                
                if (ai.progress >= 100) {
                    ai.hasBingo = true;
                    triggerAIBingo(ai);
                }
                
                updateOpponentUI();
            }, delay);
        }
    });
}

function calculateBestPatternProgress(card) {
    let bestScore = 0;

    const checkCells = (coords) => {
        let marked = 0;
        coords.forEach(([r, c]) => {
            if (card.grid[r][c].daubed) marked++;
        });
        return (marked / coords.length) * 100;
    };

    if (currentTargetPattern === 'line') {
        for (let r = 0; r < 5; r++) {
            bestScore = Math.max(bestScore, checkCells(Array.from({length:5}, (_, c) => [r, c])));
        }
        for (let c = 0; c < 5; c++) {
            bestScore = Math.max(bestScore, checkCells(Array.from({length:5}, (_, r) => [r, c])));
        }
        bestScore = Math.max(bestScore, checkCells([[0,0], [1,1], [2,2], [3,3], [4,4]]));
        bestScore = Math.max(bestScore, checkCells([[0,4], [1,3], [2,2], [3,1], [4,0]]));
    } 
    else if (currentTargetPattern === 'double-line') {
        let lineScores = [];
        for (let r = 0; r < 5; r++) lineScores.push(checkCells(Array.from({length:5}, (_, c) => [r, c])));
        for (let c = 0; c < 5; c++) lineScores.push(checkCells(Array.from({length:5}, (_, r) => [r, c])));
        lineScores.push(checkCells([[0,0], [1,1], [2,2], [3,3], [4,4]]));
        lineScores.push(checkCells([[0,4], [1,3], [2,2], [3,1], [4,0]]));
        
        lineScores.sort((a, b) => b - a);
        bestScore = (lineScores[0] + lineScores[1]) / 2;
    }
    else if (currentTargetPattern === 'four-corners') {
        bestScore = checkCells([[0,0], [0,4], [4,0], [4,4]]);
    }
    else if (currentTargetPattern === 'full-house') {
        let totalMarked = 0;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (card.grid[r][c].daubed) totalMarked++;
            }
        }
        bestScore = (totalMarked / 25) * 100;
    }

    return Math.round(bestScore);
}

function updateOpponentUI() {
    const listEl = document.getElementById('opponents-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    aiOpponents.forEach(ai => {
        const cardHtml = `
            <div class="opponent-card">
                <div class="opponent-info">
                    <span class="opponent-name" style="color: ${ai.color}">
                        <i class="fa-solid fa-robot"></i> ${ai.name}
                    </span>
                    <span class="opponent-progress-text">${ai.progress}%</span>
                </div>
                <div class="opponent-progress-bar">
                    <div class="progress-fill" style="width: ${ai.progress}%; background: linear-gradient(90deg, ${ai.color}, var(--primary-color))"></div>
                </div>
            </div>
        `;
        listEl.insertAdjacentHTML('beforeend', cardHtml);
    });
}

function triggerAIBingo(ai) {
    if (gameEnded) return;
    endGame(false, ai.name);
}

// --- Player Card Generator & Rendering ---
function renderPlayerCards() {
    const container = document.getElementById('cards-wrapper');
    if (!container) return;
    container.innerHTML = '';

    playerCards.forEach((card, cardIndex) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'bingo-card';
        cardEl.dataset.index = cardIndex;

        let gridHtml = `
            <div class="card-header-bar">
                <span class="card-id">TICKET #${card.id}</span>
                <span class="card-status" id="card-status-${cardIndex}">READY</span>
            </div>
            <div class="bingo-grid">
                <div class="grid-row-header">
                    <div class="grid-header-cell letter-B">B</div>
                    <div class="grid-header-cell letter-I">I</div>
                    <div class="grid-header-cell letter-N">N</div>
                    <div class="grid-header-cell letter-G">G</div>
                    <div class="grid-header-cell letter-O">O</div>
                </div>
        `;

        for (let r = 0; r < 5; r++) {
            gridHtml += `<div class="grid-row">`;
            for (let c = 0; c < 5; c++) {
                const cell = card.grid[r][c];
                if (cell.isFree) {
                    gridHtml += `<div class="grid-cell free-space daubed valid-hit" data-row="${r}" data-col="${c}">FREE</div>`;
                } else {
                    gridHtml += `
                        <div class="grid-cell" data-row="${r}" data-col="${c}">
                            ${cell.value}
                        </div>`;
                }
            }
            gridHtml += `</div>`;
        }

        gridHtml += `</div>`;
        cardEl.innerHTML = gridHtml;
        container.appendChild(cardEl);

        const cells = cardEl.querySelectorAll('.grid-cell:not(.free-space)');
        cells.forEach(cellEl => {
            cellEl.addEventListener('click', () => {
                handleCellClick(cardIndex, parseInt(cellEl.dataset.row), parseInt(cellEl.dataset.col), cellEl);
            });
        });
    });
}

function handleCellClick(cardIndex, row, col, cellEl) {
    if (!gameStarted || gameEnded) return;

    const card = playerCards[cardIndex];
    const cell = card.grid[row][col];
    
    if (!cell.daubed) {
        cell.daubed = true;
        daubAttempts++;
        cellEl.classList.add('daubed');

        const numberVal = cell.value;
        if (drawnNumbers.has(numberVal)) {
            correctDaubs++;
            cellEl.classList.add('valid-hit');
            playSynthSound('correct');
        } else {
            cellEl.classList.add('invalid-hit');
            playSynthSound('incorrect');
        }
    } else {
        cell.daubed = false;
        cellEl.className = 'grid-cell';
        if (drawnNumbers.has(cell.value)) {
            correctDaubs = Math.max(0, correctDaubs - 1);
        }
    }

    updateStats();
    
    const cardProgress = calculateBestPatternProgress(card);
    const statusEl = document.getElementById(`card-status-${cardIndex}`);
    if (statusEl) {
        if (cardProgress >= 100) {
            statusEl.textContent = "READY FOR BINGO!";
            statusEl.className = "card-status winning";
        } else if (cardProgress > 70) {
            statusEl.textContent = "CLOSE!";
            statusEl.className = "card-status text-accent";
        } else {
            statusEl.textContent = `${cardProgress}%`;
            statusEl.className = "card-status";
        }
    }

    if (window.fbService?.connected && currentUser) {
        let maxProgress = 0;
        playerCards.forEach(c => {
            maxProgress = Math.max(maxProgress, calculateBestPatternProgress(c));
        });
        window.fbService.updatePlayerStatus(currentUser.identity, currentUser.nickname, {
            progress: maxProgress
        });
    }
}

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
}

function drawNextBall() {
    if (!gameStarted || gameEnded) return;
    
    if (allAvailableNumbers.length === 0) {
        pauseAutoPlay();
        alert("All numbers have been drawn!");
        return;
    }

    initAudio();

    const ballNum = allAvailableNumbers.pop();
    drawnNumbers.add(ballNum);
    totalCalls++;
    
    const letter = getNumberLetter(ballNum);
    
    const currentBallEl = document.getElementById('current-ball');
    if (currentBallEl) {
        currentBallEl.textContent = `${letter}-${ballNum}`;
        currentBallEl.classList.remove('pulse-ball');
        void currentBallEl.offsetWidth;
        currentBallEl.classList.add('pulse-ball');
    }

    const ballLetterEl = document.getElementById('ball-letter');
    if (ballLetterEl) ballLetterEl.textContent = `${letter} ${ballNum}`;

    const ballPhraseEl = document.getElementById('ball-phrase');
    if (ballPhraseEl) ballPhraseEl.textContent = getBingoCallerPhrase(letter, ballNum);

    playSynthSound('draw');
    speakNumber(letter, ballNum);

    const mbCell = document.querySelector(`.mb-cell[data-num="${ballNum}"]`);
    if (mbCell) mbCell.classList.add('called');

    updateHistoryUI(letter, ballNum);
    updateStats();
    processAICalls(ballNum);

    if (allAvailableNumbers.length === 0) {
        pauseAutoPlay();
    }
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

function updateHistoryUI(letter, num) {
    const historyContainer = document.getElementById('history-balls');
    if (!historyContainer) return;

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
    if (!board) return;
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

function checkPlayerBingo() {
    if (!gameStarted || gameEnded) return;

    let winningCardIndex = -1;

    for (let i = 0; i < playerCards.length; i++) {
        const result = verifyCardPattern(playerCards[i]);
        if (result.win) {
            winningCardIndex = i;
            break;
        }
    }

    if (winningCardIndex !== -1) {
        if (window.fbService?.connected) {
            const card = playerCards[winningCardIndex];
            const progress = calculateBestPatternProgress(card);
            window.fbService.sendBingoClaim(currentUser.identity, currentUser.nickname, card.id, progress);
            window.fbService.updatePlayerStatus(currentUser.identity, currentUser.nickname, { claimed: true });
            alert("BINGO claim submitted! Waiting for host to verify...");
        } else {
            endGame(true, null, winningCardIndex);
        }
    } else {
        playSynthSound('incorrect');
        alert("No valid Bingo pattern completed yet! Keep checking your numbers.");
    }
}

function verifyCardPattern(card) {
    const grid = card.grid;

    const isMarked = (r, c) => {
        const cell = grid[r][c];
        return cell.daubed && (cell.isFree || drawnNumbers.has(cell.value));
    };

    const checkLine = (coords) => coords.every(([r, c]) => isMarked(r, c));

    if (currentTargetPattern === 'line') {
        for (let r = 0; r < 5; r++) {
            if (checkLine(Array.from({length:5}, (_, c) => [r, c]))) return { win: true };
        }
        for (let c = 0; c < 5; c++) {
            if (checkLine(Array.from({length:5}, (_, r) => [r, c]))) return { win: true };
        }
        if (checkLine([[0,0], [1,1], [2,2], [3,3], [4,4]])) return { win: true };
        if (checkLine([[0,4], [1,3], [2,2], [3,1], [4,0]])) return { win: true };
    }
    else if (currentTargetPattern === 'double-line') {
        let completedLines = 0;
        for (let r = 0; r < 5; r++) if (checkLine(Array.from({length:5}, (_, c) => [r, c]))) completedLines++;
        for (let c = 0; c < 5; c++) if (checkLine(Array.from({length:5}, (_, r) => [r, c]))) completedLines++;
        if (checkLine([[0,0], [1,1], [2,2], [3,3], [4,4]])) completedLines++;
        if (checkLine([[0,4], [1,3], [2,2], [3,1], [4,0]])) completedLines++;

        if (completedLines >= 2) return { win: true };
    }
    else if (currentTargetPattern === 'four-corners') {
        if (isMarked(0,0) && isMarked(0,4) && isMarked(4,0) && isMarked(4,4)) return { win: true };
    }
    else if (currentTargetPattern === 'full-house') {
        let full = true;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (!isMarked(r, c)) { full = false; break; }
            }
            if (!full) break;
        }
        if (full) return { win: true };
    }

    return { win: false };
}

function initGame(cardQty = 1) {
    if (!currentUser) return;
    gameStarted = true;
    gameEnded = false;
    totalCalls = 0;
    daubAttempts = 0;
    correctDaubs = 0;
    startTime = Date.now();

    const statState = document.getElementById('stat-state');
    if (statState) {
        statState.textContent = "In Game";
        statState.className = "stat-value text-accent";
    }

    if (!window.fbService?.connected) {
        resetCallerPool();
    } else {
        drawnNumbers.clear();
    }
    initAI();

    playerCards = [];
    for (let i = 0; i < cardQty; i++) {
        playerCards.push(generateCardData(1000 + i + Math.floor(Math.random() * 8999)));
    }

    renderPlayerCards();
    renderMasterBoard();

    const cb = document.getElementById('current-ball'); if (cb) cb.textContent = "-";
    const bl = document.getElementById('ball-letter'); if (bl) bl.textContent = "READY TO BLAST";
    const bp = document.getElementById('ball-phrase'); if (bp) bp.textContent = window.fbService?.connected ? "Waiting for Admin..." : "Draw first ball to start";
    const hb = document.getElementById('history-balls'); if (hb) hb.innerHTML = '<div class="empty-history">No numbers called yet</div>';
    const dc = document.getElementById('drawn-counter'); if (dc) dc.textContent = "0 / 75";

    if (gameTimeInterval) clearInterval(gameTimeInterval);
    gameTimeInterval = setInterval(updateTimer, 1000);

    updateStats();

    if (window.fbService?.connected) {
        window.fbService.updatePlayerStatus(currentUser.identity, currentUser.nickname, {
            cardCount: cardQty,
            progress: 0,
            claimed: false
        });
    }
}

function updateTimer() {
    if (!startTime || gameEnded) return;
    const diff = Date.now() - startTime;
    const totalSecs = Math.floor(diff / 1000);
    const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
    const secs = (totalSecs % 60).toString().padStart(2, '0');
    const timeEl = document.getElementById('stat-time');
    if (timeEl) timeEl.textContent = `${mins}:${secs}`;
}

function updateStats() {
    const callsEl = document.getElementById('stat-calls'); if (callsEl) callsEl.textContent = totalCalls;
    const counterEl = document.getElementById('drawn-counter'); if (counterEl) counterEl.textContent = `${drawnNumbers.size} / 75`;
    
    let accuracy = 100;
    if (daubAttempts > 0) {
        accuracy = Math.round((correctDaubs / daubAttempts) * 100);
    }
    const accEl = document.getElementById('stat-accuracy'); if (accEl) accEl.textContent = `${accuracy}%`;
}

function startAutoPlay() {
    if (isAutoPlaying || gameEnded) return;
    isAutoPlaying = true;
    
    const autoBtn = document.getElementById('auto-btn');
    if (autoBtn) {
        autoBtn.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE';
        autoBtn.className = 'btn btn-secondary active';
    }
    
    const cs = document.getElementById('caller-status');
    if (cs) {
        cs.textContent = "AUTOPLAY";
        cs.classList.add('active');
    }

    drawNextBall();
    callerTimer = setInterval(drawNextBall, autoPlaySpeed);
}

function pauseAutoPlay() {
    if (!isAutoPlaying) return;
    isAutoPlaying = false;

    const autoBtn = document.getElementById('auto-btn');
    if (autoBtn) {
        autoBtn.innerHTML = '<i class="fa-solid fa-play"></i> AUTO-PLAY';
        autoBtn.className = 'btn btn-secondary';
    }

    const cs = document.getElementById('caller-status');
    if (cs) {
        cs.textContent = "PAUSED";
        cs.classList.remove('active');
    }

    if (callerTimer) {
        clearInterval(callerTimer);
        callerTimer = null;
    }
}

function endGame(playerWon, winnerName = null, cardIndex = null) {
    gameEnded = true;
    pauseAutoPlay();
    if (gameTimeInterval) clearInterval(gameTimeInterval);

    const ss = document.getElementById('stat-state');
    if (ss) {
        ss.textContent = "Game Over";
        ss.className = "stat-value text-accent";
    }

    const gameOverModal = document.getElementById('game-over-modal');
    const goTitle = document.getElementById('game-over-title');
    const goMsg = document.getElementById('game-over-message');
    const goIcon = document.getElementById('game-over-icon');
    
    const goBalls = document.getElementById('go-balls'); if (goBalls) goBalls.textContent = totalCalls;
    let accuracy = 100;
    if (daubAttempts > 0) {
        accuracy = Math.round((correctDaubs / daubAttempts) * 100);
    }
    const goAcc = document.getElementById('go-accuracy'); if (goAcc) goAcc.textContent = `${accuracy}%`;

    if (playerWon) {
        playSynthSound('win');
        if (goTitle) {
            goTitle.textContent = "BINGO! YOU WON!";
            goTitle.style.color = "var(--success-color)";
            goTitle.style.textShadow = "0 0 15px var(--success-glow)";
        }
        if (goMsg) goMsg.textContent = `Excellent! You completed the pattern on Ticket #${playerCards[cardIndex]?.id || ''} before the AI.`;
        if (goIcon) {
            goIcon.className = "fa-solid fa-trophy winner-icon";
            goIcon.style.color = "var(--warning-color)";
            goIcon.style.filter = "drop-shadow(0 0 15px rgba(255, 183, 3, 0.6))";
        }
        startConfetti();
    } else {
        playSynthSound('lose');
        if (goTitle) {
            goTitle.textContent = "OPPONENT BINGO!";
            goTitle.style.color = "var(--danger-color)";
            goTitle.style.textShadow = "0 0 15px rgba(255, 51, 51, 0.5)";
        }
        if (goMsg) goMsg.textContent = `Aww, ${winnerName} claimed BINGO first! Try again.`;
        if (goIcon) {
            goIcon.className = "fa-solid fa-face-frown winner-icon";
            goIcon.style.color = "var(--danger-color)";
            goIcon.style.filter = "drop-shadow(0 0 15px rgba(255, 51, 51, 0.5))";
        }
    }

    if (gameOverModal) gameOverModal.classList.add('show');
}

// --- Canvas Confetti Effect ---
let confettiActive = false;
let confettiCanvas = null;
let confettiCtx = null;
let particles = [];
const particleCount = 120;
const colors = ['#00f2fe', '#9d4edd', '#ff007f', '#39ff14', '#ffb703'];

function resizeConfettiCanvas() {
    if (confettiCanvas) {
        confettiCanvas.width = window.innerWidth;
        confettiCanvas.height = window.innerHeight;
    }
}

function startConfetti() {
    confettiCanvas = document.getElementById('confetti-canvas');
    if (!confettiCanvas) return;
    confettiCtx = confettiCanvas.getContext('2d');
    
    confettiCanvas.style.display = 'block';
    confettiActive = true;
    resizeConfettiCanvas();
    window.addEventListener('resize', resizeConfettiCanvas);
    
    particles = [];
    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * confettiCanvas.width,
            y: Math.random() * confettiCanvas.height - confettiCanvas.height,
            size: Math.random() * 8 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            speedX: Math.random() * 4 - 2,
            speedY: Math.random() * 3 + 2,
            rotation: Math.random() * 360,
            rotationSpeed: Math.random() * 4 - 2
        });
    }
    
    requestAnimationFrame(updateConfetti);
}

function updateConfetti() {
    if (!confettiActive || !confettiCtx) return;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    
    let activeParticles = 0;
    
    particles.forEach(p => {
        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;
        
        if (p.y > confettiCanvas.height) {
            p.y = -20;
            p.x = Math.random() * confettiCanvas.width;
        } else {
            activeParticles++;
        }
        
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate((p.rotation * Math.PI) / 180);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        confettiCtx.restore();
    });
    
    if (activeParticles > 0) {
        requestAnimationFrame(updateConfetti);
    }
}

function stopConfetti() {
    confettiActive = false;
    if (confettiCanvas) confettiCanvas.style.display = 'none';
    window.removeEventListener('resize', resizeConfettiCanvas);
}

// --- Pattern Preview Grid Drawings ---
function drawPatternPreviews() {
    const patterns = {
        'line-pattern': (r, c) => r === 2,
        'double-line-pattern': (r, c) => r === 1 || r === 3,
        'corners-pattern': (r, c) => (r === 0 || r === 4) && (c === 0 || c === 4),
        'full-pattern': () => true
    };

    Object.entries(patterns).forEach(([className, isMarked]) => {
        const grid = document.querySelector(`.${className}`);
        if (!grid) return;
        grid.innerHTML = '';
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const marked = isMarked(r, c);
                grid.insertAdjacentHTML('beforeend', `<div class="preview-cell ${marked ? 'marked' : ''}"></div>`);
            }
        }
    });
}

// --- Global Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    setupAuthentication();
    drawPatternPreviews();

    // Event Bindings
    document.getElementById('draw-btn')?.addEventListener('click', drawNextBall);
    document.getElementById('auto-btn')?.addEventListener('click', () => {
        if (isAutoPlaying) pauseAutoPlay();
        else startAutoPlay();
    });
    
    document.getElementById('bingo-claim-btn')?.addEventListener('click', checkPlayerBingo);
    
    document.getElementById('play-again-btn')?.addEventListener('click', () => {
        document.getElementById('game-over-modal')?.classList.remove('show');
        stopConfetti();
        const activeQtyBtn = document.querySelector('.card-qty-btn.active');
        const qty = activeQtyBtn ? parseInt(activeQtyBtn.dataset.qty) : 1;
        initGame(qty);
    });

    document.querySelectorAll('.card-qty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.card-qty-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const qty = parseInt(e.currentTarget.dataset.qty);
            initGame(qty);
        });
    });

    // Initial game boot
    initGame(1);
});
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
                          apiKey: "AIzaSyARaTTQ75MRaUaXLVF9WIOchkTaupvIoSw",
                          authDomain: "bingo-game-4751b.firebaseapp.com",
                          databaseURL: "https://bingo-game-4751b-default-rtdb.firebaseio.com",
                          projectId: "bingo-game-4751b",
                          storageBucket: "bingo-game-4751b.firebasestorage.app",
                          messagingSenderId: "512330967286",
                          appId: "1:512330967286:web:774cfbe1a0743b7c0224d7",
                          measurementId: "G-8YHXWVX2V2"
                    };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app); // Available globally across the entire file

function setupAuthentication() {
    const authScreen = document.getElementById('auth-screen');
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const toggleAuthLink = document.getElementById('toggle-auth-link');
    const toggleAuthMessage = document.getElementById('toggle-auth-msg');
    const logoutButton = document.getElementById('logout-btn');
    // --- FIRESTORE REALTIME LISTENER ---
    const db = getFirestore();
    onSnapshot(doc(db, "game", "current"), (snapshot) => {
        if (!snapshot.exists()) return;
        
        const data = snapshot.data();
        console.log("Live Client Data Received:", data);

        // Extract called number or fallback
        const lastNumber = data.lastDrawnNumber;
        if (!lastNumber || drawnNumbers.has(lastNumber)) return;

        // Sync local state with remote draw
        drawnNumbers.add(lastNumber);
        totalCalls++;

        const letter = getNumberLetter(lastNumber);

        // Update UI elements
        const currentBallEl = document.getElementById('current-ball');
        if (currentBallEl) {
            currentBallEl.textContent = data.currentBall || `${letter}-${lastNumber}`;
            currentBallEl.classList.remove('pulse-ball');
            void currentBallEl.offsetWidth;
            currentBallEl.classList.add('pulse-ball');
        }

        const ballLetterEl = document.getElementById('ball-letter');
        if (ballLetterEl) ballLetterEl.textContent = `${letter} ${lastNumber}`;

        const ballPhraseEl = document.getElementById('ball-phrase');
        if (ballPhraseEl) ballPhraseEl.textContent = getBingoCallerPhrase(letter, lastNumber);

        playSynthSound('draw');
        speakNumber(letter, lastNumber);

        const mbCell = document.querySelector(`.mb-cell[data-num="${lastNumber}"]`);
        if (mbCell) mbCell.classList.add('called');

        updateHistoryUI(letter, lastNumber);
        updateStats();
        processAICalls(lastNumber);
    });
    if (!authScreen || !loginTab || !registerTab || !loginForm || !registerForm) {
        return;
    }

    const showForm = (formName) => {
        const isRegister = formName === 'register';
        loginTab.classList.toggle('active', !isRegister);
        registerTab.classList.toggle('active', isRegister);
        loginForm.classList.toggle('active', !isRegister);
        registerForm.classList.toggle('active', isRegister);
        toggleAuthMessage.innerHTML = isRegister
            ? 'Already have an account? <a href="#" id="toggle-auth-link">Login</a>'
            : 'Don\'t have an account? <a href="#" id="toggle-auth-link">Register Now</a>';
        document.getElementById('toggle-auth-link').addEventListener('click', (event) => {
            event.preventDefault();
            showForm(isRegister ? 'login' : 'register');
        });
    };

    const showAuthenticatedState = (user) => {
        currentUser = { identity: user.identity, nickname: user.nickname };
        const username = document.getElementById('welcome-username');
        if (username) username.textContent = currentUser.nickname;
        authScreen.classList.add('hide');
        window.localStorage.setItem('neon_bingo_session', JSON.stringify(currentUser));
        if (window.fbService?.connected) {
            window.fbService.updatePlayerStatus(currentUser.identity, currentUser.nickname, {
                cardCount: 1,
                progress: 0,
                claimed: false,
                active: true
            });
        }
    };

    const showError = (elementId, error) => {
        const errorElement = document.getElementById(elementId);
        if (errorElement) errorElement.textContent = error.message || 'Something went wrong. Please try again.';
    };

    loginTab.addEventListener('click', () => showForm('login'));
    registerTab.addEventListener('click', () => showForm('register'));

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const identity = document.getElementById('login-identity').value.trim();
        const password = document.getElementById('login-password').value;
        document.getElementById('login-error').textContent = '';

        try {
            const user = await window.fbService.loginUser(identity, password);
            showAuthenticatedState(user);
        } catch (error) {
            showError('login-error', error);
        }
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const nickname = document.getElementById('reg-nickname').value.trim();
        const identity = document.getElementById('reg-identity').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-confirm-password').value;
        document.getElementById('reg-error').textContent = '';

        if (password.length < 6) {
            showError('reg-error', new Error('Password must be at least 6 characters.'));
            return;
        }
        if (password !== confirmPassword) {
            showError('reg-error', new Error('Passwords do not match.'));
            return;
        }

        try {
            const user = await window.fbService.registerUser(nickname, identity, password);
            showAuthenticatedState(user);
        } catch (error) {
            showError('reg-error', error);
        }
    });

    toggleAuthLink.addEventListener('click', (event) => {
        event.preventDefault();
        showForm('register');
    });

    logoutButton?.addEventListener('click', async () => {
        const loggedOutUser = currentUser;

        try {
            if (window.fbService?.connected && loggedOutUser) {
                await window.fbService.logoutUser(loggedOutUser.identity);
            }
        } catch (error) {
            console.error('Failed to clear active player status during logout.', error);
        } finally {
            window.localStorage.removeItem('neon_bingo_session');
            currentUser = null;
            authScreen.classList.remove('hide');
            loginForm.reset();
            registerForm.reset();
            showForm('login');
        }
    });

    const storedSession = window.localStorage.getItem('neon_bingo_session');
    if (storedSession) {
        try {
            showAuthenticatedState(JSON.parse(storedSession));
        } catch (error) {
            window.localStorage.removeItem('neon_bingo_session');
            console.error('Failed to restore login session', error);
        }
    }
}

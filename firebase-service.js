// ===================================================
// NEON BINGO BLAST - FIREBASE INTEGRATION SERVICE
// ===================================================

class FirebaseService {
    constructor() {
        this.app = null;
        this.db = null;
        this.auth = null;
        this.config = null;
        this.connected = false;
        this.onConfigChangedCallbacks = [];
        this.loadConfig();
    }

    // Load configuration from local storage or fallback to default project config
    loadConfig() {
        const stored = localStorage.getItem('neon_bingo_firebase_config');
        if (stored) {
            try {
                this.config = JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse stored Firebase config", e);
            }
        }

        // Default project configuration fallback
        if (!this.config) {
            this.config = {
                apiKey: "AIzaSyARaTTQ75MRaUaXLVF9WIOchkTaupvIoSw",
                authDomain: "bingo-game-4751b.firebaseapp.com",
                databaseURL: "https://bingo-game-4751b-default-rtdb.firebaseio.com",
                projectId: "bingo-game-4751b",
                storageBucket: "bingo-game-4751b.firebasestorage.app",
                messagingSenderId: "512330967286",
                appId: "1:512330967286:web:774cfbe1a0743b7c0224d7"
            };
        }

        this.init();
    }

    // Save config and initialize
    saveConfig(config) {
        localStorage.setItem('neon_bingo_firebase_config', JSON.stringify(config));
        this.config = config;
        this.init();
        this.triggerConfigChanged();
    }

    // Clear config
    clearConfig() {
        localStorage.removeItem('neon_bingo_firebase_config');
        this.config = null;
        this.connected = false;
        this.triggerConfigChanged();
    }

    // Check if Firebase compatibility scripts are loaded
    isSdkLoaded() {
        return typeof firebase !== 'undefined';
    }

    // Initialize Firebase
    init() {
        if (!this.config || !this.isSdkLoaded()) {
            this.connected = false;
            return;
        }

        // Auth can be unavailable briefly if its SDK script has not finished loading.
        if (typeof firebase.auth !== 'function') {
            console.error("Firebase Auth SDK is not loaded. Ensure firebase-auth.js is included BEFORE firebase-service.js in your HTML.");
            this.connected = false;
            return;
        }

        try {
            // Check if already initialized to avoid duplicate app errors
            if (firebase.apps.length === 0) {
                this.app = firebase.initializeApp(this.config);
            } else {
                this.app = firebase.app();
            }
            
            this.db = firebase.database();
            this.auth = firebase.auth();
            this.connected = true;
            console.log("Firebase initialized successfully with Auth!");
        } catch (e) {
            console.error("Error initializing Firebase:", e);
            this.connected = false;
        }
    }

    // Register callback for configuration changes
    onConfigChanged(callback) {
        this.onConfigChangedCallbacks.push(callback);
    }

    triggerConfigChanged() {
        this.onConfigChangedCallbacks.forEach(cb => cb(this.connected, this.config));
    }

    // Helper to sanitize database keys (remove invalid characters like ., #, $, [, or ])
    sanitizeKey(key) {
        if (!key) return '';
        return key.replace(/[^a-zA-Z0-9]/g, '_');
    }

    // Firebase Email/Password Auth requires an email-shaped identifier.
    getAuthEmail(identity) {
        const normalizedIdentity = identity.trim();
        return normalizedIdentity.includes('@')
            ? normalizedIdentity
            : `${this.sanitizeKey(normalizedIdentity)}@bingogame.local`;
    }

    // --- User & Enrollment Operations ---

    async registerUser(nickname, identity, password) {
        if (!this.isSdkLoaded() || typeof firebase.auth !== 'function' || !this.auth || !this.db) {
            console.warn("Firebase Authentication is unavailable; using local demo registration.");
            return this.localRegister(nickname, identity, password);
        }

        const normalizedIdentity = identity.trim();
        const authEmail = this.getAuthEmail(normalizedIdentity);

        try {
            const userCredential = await this.auth.createUserWithEmailAndPassword(authEmail, password);
            const user = userCredential.user;
            await user.updateProfile({ displayName: nickname });

            const userData = {
                uid: user.uid,
                nickname,
                identity: normalizedIdentity,
                authEmail,
                registeredAt: Date.now()
            };
            const cleanKey = this.sanitizeKey(normalizedIdentity);
            await this.db.ref(`users/${cleanKey}`).set(userData);

            return userData;
        } catch (error) {
            console.error("Firebase Auth Registration Error:", error.code, error.message);
            throw new Error(error.message);
        }
    }

    async loginUser(identity, password) {
        if (!this.auth) {
            console.warn("Firebase Authentication is unavailable; using local demo login.");
            return this.localLogin(identity, password);
        }

        try {
            const authEmail = this.getAuthEmail(identity);
            const userCredential = await this.auth.signInWithEmailAndPassword(authEmail, password);
            const user = userCredential.user;

            return {
                uid: user.uid,
                nickname: user.displayName || identity,
                identity: user.email
            };
        } catch (error) {
            console.error("Login error:", error);
            throw new Error("Invalid email/phone number or password.");
        }
    }

    // Local fallbacks
    localRegister(nickname, identity, password) {
        const users = JSON.parse(localStorage.getItem('neon_bingo_users')) || [];
        const exists = users.some(u => u.identity.toLowerCase() === identity.toLowerCase());
        if (exists) {
            throw new Error("This email or phone number is already registered.");
        }

        const newUser = { nickname, identity, password };
        users.push(newUser);
        localStorage.setItem('neon_bingo_users', JSON.stringify(users));
        return newUser;
    }

    localLogin(identity, password) {
        const users = JSON.parse(localStorage.getItem('neon_bingo_users')) || [];
        const matched = users.find(u => u.identity.toLowerCase() === identity.toLowerCase() && u.password === password);
        if (!matched) {
            throw new Error("Invalid email/phone number or password.");
        }
        return matched;
    }

    // Sync active player details
    async updatePlayerStatus(identity, nickname, data = {}) {
        if (!this.connected) return;
        const cleanKey = this.sanitizeKey(identity);
        const playerRef = this.db.ref(`activePlayers/${cleanKey}`);
        
        if (data === null) {
            await playerRef.remove();
        } else {
            await playerRef.onDisconnect().remove();
            await playerRef.update({
                nickname,
                identity,
                lastActive: Date.now(),
                ...data
            });
        }
    }

    async logoutUser(identity) {
        if (!this.connected) return;

        const cleanKey = this.sanitizeKey(identity);
        await this.db.ref(`activePlayers/${cleanKey}`).remove();

        if (this.auth && this.auth.currentUser) {
            await this.auth.signOut();
        }
    }

    // --- Game State Operations ---

    // Listen to game state updates
    listenGameState(callback) {
        if (!this.connected) return null;
        const ref = this.db.ref('gameState');
        ref.on('value', snapshot => {
            if (snapshot.exists()) {
                callback(snapshot.val());
            } else {
                callback(null);
            }
        });
        return ref;
    }

    // Send a bingo claim
    async sendBingoClaim(identity, nickname, cardId, cardProgress) {
        if (!this.connected) return;
        const cleanKey = this.sanitizeKey(identity);
        await this.db.ref(`gameState/claims/${cleanKey}`).set({
            nickname,
            identity,
            cardId,
            progress: cardProgress,
            timestamp: Date.now()
        });
    }

    // --- Admin Operations ---

    // Initialize game state (Admin only)
    async adminStartGame(targetPattern) {
        if (!this.connected) return;
        
        // Fetch current reset count or default to 0
        const counterRef = this.db.ref('gameState/resetCounter');
        const countSnap = await counterRef.once('value');
        const nextCount = (countSnap.val() || 0) + 1;

        await this.db.ref('gameState').set({
            status: 'playing',
            currentBall: '-',
            drawnNumbers: {},
            targetPattern: targetPattern,
            calledCount: 0,
            winner: null,
            resetCounter: nextCount,
            claims: {}
        });

        // Clear player progress but keep them enrolled
        const playersRef = this.db.ref('activePlayers');
        const playersSnap = await playersRef.once('value');
        if (playersSnap.exists()) {
            const updates = {};
            playersSnap.forEach(child => {
                updates[`${child.key}/progress`] = 0;
                updates[`${child.key}/claimed`] = false;
            });
            await playersRef.update(updates);
        }
    }

    // Draw and publish next ball (Admin only)
    async adminDrawBall(letter, num, drawnNumbersMap) {
        if (!this.connected) return;
        
        const updates = {};
        updates['gameState/currentBall'] = `${letter}-${num}`;
        updates[`gameState/drawnNumbers/${num}`] = true;
        updates['gameState/calledCount'] = Object.keys(drawnNumbersMap).length;

        await this.db.ref().update(updates);
    }

    // Reset game state back to Lobby (Admin only)
    async adminResetGame() {
        if (!this.connected) return;
        
        const counterRef = this.db.ref('gameState/resetCounter');
        const countSnap = await counterRef.once('value');
        const nextCount = (countSnap.val() || 0) + 1;

        await this.db.ref('gameState').set({
            status: 'lobby',
            currentBall: '-',
            drawnNumbers: {},
            targetPattern: 'line',
            calledCount: 0,
            winner: null,
            resetCounter: nextCount,
            claims: {}
        });

        // Reset players in activePlayers
        const playersRef = this.db.ref('activePlayers');
        const playersSnap = await playersRef.once('value');
        if (playersSnap.exists()) {
            const updates = {};
            playersSnap.forEach(child => {
                updates[`${child.key}/progress`] = 0;
                updates[`${child.key}/claimed`] = false;
            });
            await playersRef.update(updates);
        }
    }

    // Verify player BINGO claim (Admin only)
    async adminVerifyBingo(playerIdentity, approve, nickname) {
        if (!this.connected) return;
        const cleanKey = this.sanitizeKey(playerIdentity);
        
        if (approve) {
            // Player won
            await this.db.ref('gameState').update({
                status: 'ended',
                winner: nickname
            });
            // Clear claims
            await this.db.ref('gameState/claims').remove();
        } else {
            // Reject claim: delete this player's claim and update their status
            await this.db.ref(`gameState/claims/${cleanKey}`).remove();
            await this.db.ref(`activePlayers/${cleanKey}`).update({
                claimed: false,
                progress: 0 // Reset their progress or keep it, let's keep it but mark claimed false
            });
        }
    }

    // Listen to active players (Admin only)
    listenActivePlayers(callback) {
        if (!this.connected) return null;
        const ref = this.db.ref('activePlayers');
        ref.on('value', snapshot => {
            const players = [];
            snapshot.forEach(child => {
                players.push({
                    key: child.key,
                    ...child.val()
                });
            });
            callback(players);
        });
        return ref;
    }

    // Listen to bingo claims (Admin only)
    listenClaims(callback) {
        if (!this.connected) return null;
        const ref = this.db.ref('gameState/claims');
        ref.on('value', snapshot => {
            const claims = [];
            snapshot.forEach(child => {
                claims.push({
                    key: child.key,
                    ...child.val()
                });
            });
            callback(claims);
        });
        return ref;
    }
}

const fbService = new FirebaseService();
window.fbService = fbService;

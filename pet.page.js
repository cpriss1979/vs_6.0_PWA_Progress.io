// pet.page.js
// Keep only db here; Firestore methods are passed in from the bootloader.
import { db } from "./firebase-init.js";

// Exported entrypoint the HTML bootloader will call.
export async function bootPetPage({ firestore, auth, user }) {
    const {
        doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc,
        collection, serverTimestamp, increment, runTransaction,
        arrayUnion, getDocs
    } = firestore;

    /* ---------- Theme meta ---------- */
    function syncMetaTheme() {
        try {
            const cs = getComputedStyle(document.documentElement);
            const accent = (cs.getPropertyValue('--accent-color') || cs.getPropertyValue('--accent') || '#6a5acd').trim() || '#6a5acd';
            let meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
            meta.content = accent;
        } catch { }
    }
    function applyThemeClass(themeClass) {
        const root = document.documentElement;
        const next = themeClass || "theme-original";
        const keep = (root.className || "").split(/\s+/).filter(Boolean).filter(c => !c.startsWith("theme-"));
        const curr = (root.className.match(/\btheme-[^\s]+/g) || [])[0];
        if (curr !== next) {
            root.className = [...keep, next].join(" ");
            try {
                const userKey = localStorage.getItem("currentUser") || "anon";
                localStorage.setItem(userKey + ":themeClass", next);
                localStorage.setItem("themeClass:last", next);
            } catch { }
        }
        syncMetaTheme();
    }

    /* ---------- Sparkles ---------- */
    function createFullPageSparkles(count = 100) {
        const container = document.getElementById('sparkleWrapper'); if (!container) return;
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div'); s.className = 'sparkle';
            s.style.top = `${Math.random() * 100}vh`;
            s.style.left = `${Math.random() * 100}vw`;
            s.style.animationDelay = `${Math.random() * 3}s`;
            s.style.animationDuration = `${2 + Math.random() * 2.5}s`;
            container.appendChild(s);
        }
    }

    /* ---------- Utils ---------- */
    const esc = (s = "") =>
        s.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    const CENTRAL_TZ = 'America/Chicago';
    function centralTodayId(d = new Date()) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: CENTRAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(d);
    }

    let lastSeenDay = centralTodayId();
    function startMidnightWatcher() {
        setInterval(() => {
            const nowId = centralTodayId();
            if (nowId !== lastSeenDay) {
                lastSeenDay = nowId;
                rolloverDailyIfNeeded().catch(console.error);
            }
        }, 60_000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                const nowId = centralTodayId();
                if (nowId !== lastSeenDay) {
                    lastSeenDay = nowId;
                    rolloverDailyIfNeeded().catch(console.error);
                }
            }
        });
        window.addEventListener('pageshow', () => {
            const nowId = centralTodayId();
            if (nowId !== lastSeenDay) {
                lastSeenDay = nowId;
                rolloverDailyIfNeeded().catch(console.error);
            }
        });
    }

    const $ = (id) => document.getElementById(id);

    const petMessage = $("petMessage");
    const img = $("petImage");
    const stageEl = $("petStage");
    const feedsEl = $("feedCount");
    const gridEl = $("petBadgeGrid");

    const feedBtn = $("feedPetBtn");
    const feedMsg = $("feedMsg");

    const doneMsg = $("completeMsg");
    function setCompleteBarVisible(show) { doneMsg?.classList.toggle("show", !!show); }

    const waterYes = $("waterYesBtn");
    const waterNo = $("waterNoBtn");
    const waterMsg = $("waterMsg");

    const bathYes = $("bathYesBtn");
    const bathNo = $("bathNoBtn");
    const bathMsg = $("bathMsg");

    const DEFAULT_MSG = "Hi, I'm your wellness buddy! <br> Let's grow together 🌱";
    function showDefaultMessage() { if (petMessage) petMessage.innerHTML = DEFAULT_MSG; }
    function hideThankLines() {
        if (feedMsg) feedMsg.style.display = "none";
        if (waterMsg) waterMsg.style.display = "none";
        if (bathMsg) bathMsg.style.display = "none";
    }

    function stageFromStreak(n = 0) {
        if (n >= 90) return { file: "pet-adult.png", label: "Adult" };
        if (n >= 30) return { file: "pet-teen.png", label: "Teen" };
        if (n >= 7) return { file: "pet-child.png", label: "Child" };
        return { file: "pet-baby.png", label: "Baby" };
    }

    /* ---------- Firestore helpers ---------- */
    let uid = user.uid; // <- comes from bootloader
    const petRef = () => doc(db, "users", uid, "pet", "state");

    async function ensureDoc(ref, defaults) {
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, defaults, { merge: true });
        return (await getDoc(ref)).data() || defaults;
    }

    async function ensureBadge(userId, key, label, emoji) {
        const bRef = doc(db, "users", userId, "badges", key);
        if (!(await getDoc(bRef)).exists()) {
            await setDoc(bRef, { key, label, emoji, earnedAt: serverTimestamp() }, { merge: true });
        }
        const rootRef = doc(db, "users", userId);
        try { await updateDoc(rootRef, { badges: arrayUnion(key) }); }
        catch { await setDoc(rootRef, { badges: [key] }, { merge: true }); }
    }

    async function maybeAwardCareBadges(userId, streak) {
        if (streak >= 1) await ensureBadge(userId, "pawprint", "First Pet Care", "🐰");
        if (streak >= 7) await ensureBadge(userId, "flower", "1 Week", "🌸");
        if (streak >= 30) await ensureBadge(userId, "gem", "1 Month", "💎");
        if (streak >= 90) await ensureBadge(userId, "crown", "3 Months", "👑");
        if (streak >= 180) await ensureBadge(userId, "halfyear", "6 Months", "🏆");
    }

    async function rolloverDailyIfNeeded() {
        const ref = petRef();
        const today = centralTodayId();
        let changed = false;

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.exists() ? snap.data() : {};
            if (d.lastDailyYMD === today) return;
            tx.set(ref, {
                lastDailyYMD: today,
                fedToday: false,
                wateredToday: false,
                bathedToday: false
            }, { merge: true });
            changed = true;
        });

        if (changed) {
            showDefaultMessage();
            hideThankLines();
            if (feedBtn) feedBtn.disabled = true;
            if (waterYes) waterYes.disabled = false;
            if (waterNo) waterNo.disabled = false;
            if (bathYes) bathYes.disabled = false;
            if (bathNo) bathNo.disabled = false;
            setCompleteBarVisible(false);
        }
    }

    async function advanceIfComplete() {
        const ref = petRef();
        const today = centralTodayId();

        let advanced = false;
        let newStreakValue = 0;

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.exists() ? snap.data() : {};

            const fed = (d.lastFedYMD || "") === today;
            const watered = !!d.wateredToday && (d.lastDailyYMD || "") === today;
            const bathed = !!d.bathedToday && (d.lastDailyYMD || "") === today;

            if (!fed || !watered || !bathed) return;
            if ((d.lastAdvanceYMD || "") === today) return;

            newStreakValue = (d.careStreak || 0) + 1;
            const newLevel = (d.petLevel || 0) + 1;

            tx.set(ref, { careStreak: newStreakValue, petLevel: newLevel, lastAdvanceYMD: today }, { merge: true });
            advanced = true;
        });

        if (advanced) {
            if (petMessage) petMessage.textContent = "Great job! Your pet grew today 🌱";
            await maybeAwardCareBadges(uid, newStreakValue);
        }
    }

    let feedBusy = false;
    async function feedPet() {
        if (!uid || feedBusy) return;
        feedBusy = true;
        feedBtn?.setAttribute("disabled", "disabled");

        await rolloverDailyIfNeeded();
        const ref = petRef();
        const today = centralTodayId();

        try {
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(ref);
                const d = snap.exists() ? snap.data() : {};
                const canFeed = (d.canFeedYMD || "") === today;
                const already = (d.lastFedYMD || "") === today;

                if (!canFeed) throw new Error("not-allowed");
                if (already) throw new Error("already-fed");

                tx.set(ref, {
                    fedToday: true,
                    lastFed: serverTimestamp(),
                    lastFedYMD: today,
                    feedCount: increment(1),
                    canFeedYMD: "",
                    lastDailyYMD: today
                }, { merge: true });
            });

            if (petMessage) petMessage.textContent = "Yum! Thank you for feeding me! 🍽️";
            if (feedMsg) feedMsg.style.display = "block";
            await advanceIfComplete();
        } catch (e) {
            if (e.message === "not-allowed") { if (petMessage) petMessage.textContent = "Please journal first to feed your pet. 📔"; }
            else if (e.message === "already-fed") { if (petMessage) petMessage.textContent = "Already fed today 🐾"; }
            else { console.error("[pet] feed error:", e); if (petMessage) petMessage.textContent = "Hmm, couldn't feed right now."; }
        } finally { feedBusy = false; }
    }

    async function waterPet() {
        if (!uid) return;
        await rolloverDailyIfNeeded();
        const ref = petRef(); const d = await ensureDoc(ref, {}); const today = centralTodayId();

        if (d.wateredToday && d.lastDailyYMD === today) {
            if (waterMsg) waterMsg.style.display = "block";
            if (waterYes) waterYes.disabled = true;
            if (waterNo) waterNo.disabled = true;
            return;
        }

        await setDoc(ref, { wateredToday: true, lastWatered: serverTimestamp(), lastDailyYMD: today }, { merge: true });

        if (petMessage) petMessage.textContent = "So refreshing! Thank you for the water! 💧";
        if (waterYes) waterYes.disabled = true;
        if (waterNo) waterNo.disabled = true;
        if (waterMsg) waterMsg.style.display = "block";
        await advanceIfComplete();
    }

    async function bathePet() {
        if (!uid) return;
        await rolloverDailyIfNeeded();
        const ref = petRef(); const d = await ensureDoc(ref, {}); const today = centralTodayId();

        if (d.bathedToday && d.lastDailyYMD === today) {
            if (bathMsg) bathMsg.style.display = "block";
            if (bathYes) bathYes.disabled = true;
            if (bathNo) bathNo.disabled = true;
            return;
        }

        await setDoc(ref, { bathedToday: true, lastBathed: serverTimestamp(), lastDailyYMD: today }, { merge: true });

        if (petMessage) petMessage.textContent = "All clean and sparkly now! 🧽";
        if (bathYes) bathYes.disabled = true;
        if (bathNo) bathNo.disabled = true;
        if (bathMsg) bathMsg.style.display = "block";
        await advanceIfComplete();
    }

    async function resetPet() {
        if (!uid) return;
        if (!confirm("Reset your pet and pet-care badges? (Journal + Login badges stay)")) return;

        setCompleteBarVisible(false);
        await setDoc(petRef(), {
            feedCount: 0, careStreak: 0, petLevel: 0,
            fedToday: false, wateredToday: false, bathedToday: false,
            lastAdvanceYMD: "", canFeedYMD: "", lastDailyYMD: "", lastFedYMD: ""
        }, { merge: true });

        const KEEP = new Set(["firstJournal", "login"]);
        const rootRef = doc(db, "users", uid);
        const rootSnap = await getDoc(rootRef);
        const current = Array.isArray(rootSnap.data()?.badges) ? rootSnap.data().badges : [];
        const kept = current.filter(id => KEEP.has(id));
        await setDoc(rootRef, { badges: kept }, { merge: true });

        const sub = collection(db, "users", uid, "badges");
        const qs = await getDocs(sub);
        for (const d of qs.docs) {
            if (!KEEP.has(d.id)) await deleteDoc(d.ref);
        }

        showDefaultMessage();
        hideThankLines();
        if (feedBtn) feedBtn.disabled = true;
        if (waterYes) waterYes.disabled = false;
        if (waterNo) waterNo.disabled = false;
        if (bathYes) bathYes.disabled = false;
        if (bathNo) bathNo.disabled = false;
    }

    // Expose UI handlers
    window.feedPet = feedPet;
    window.waterPet = waterPet;
    window.bathePet = bathePet;
    window.resetPet = resetPet;
    window.setJournalClicked = () => { };

    // Badge catalog
    const CATALOG = [
        { id: "login", label: "First Login", emoji: "🔑", hue: 200 },
        { id: "themeChange", label: "Changed Theme", emoji: "🎨", hue: 280 },
        { id: "feelgood1", label: "1 Feel-Good Idea", emoji: "💡", hue: 50 },
        { id: "firstJournal", label: "First Journal", emoji: "📝", hue: 300 },
        { id: "wellnessPlan1", label: "Wellness Plan Created", emoji: "🧭", hue: 160 },
        { id: "letter1", label: "Letter to Future Me", emoji: "💌", hue: 340 },
        { id: "pawprint", label: "First Pet Care", emoji: "🐰", hue: 85 },
        { id: "flower", label: "1 Week", emoji: "🌸", hue: 330 },
        { id: "gem", label: "1 Month", emoji: "💎", hue: 200 },
        { id: "crown", label: "3 Months", emoji: "👑", hue: 45 },
        { id: "halfyear", label: "6 Months", emoji: "🏆", hue: 15 },
    ];

    function buildBadgeGrid() {
        if (!gridEl) return;
        gridEl.innerHTML = CATALOG.map(b => `
      <div class="badge locked" data-badge="${b.id}">
        <div class="icon" style="--h:${b.hue}">${b.emoji}</div>
        <div class="label">${esc(b.label)}</div>
      </div>`).join("");
    }

    function renderBadgeGrid(earned = []) {
        if (!gridEl) return;
        const ids = new Set(earned);
        gridEl.querySelectorAll(".badge").forEach(el => {
            const has = ids.has(el.dataset.badge);
            el.classList.toggle("locked", !has);
            el.classList.toggle("unlocked", has);
        });
    }

    buildBadgeGrid();

    // ===== Boot for the already-signed-in user =====
    try { localStorage.setItem("currentUser", uid); } catch { }

    await ensureDoc(petRef(), {
        feedCount: 0, careStreak: 0, petLevel: 0,
        fedToday: false, wateredToday: false, bathedToday: false,
        lastAdvanceYMD: "", canFeedYMD: "", lastDailyYMD: "", lastFedYMD: ""
    });
    await ensureDoc(doc(db, "users", uid), { badges: [] });
    await rolloverDailyIfNeeded();

    let unsubTheme = null, unsubPet = null, unsubRoot = null, unsubSub = null;

    unsubPet = onSnapshot(petRef(), (snap) => {
        const d = snap.data() || {};
        const st = stageFromStreak(d.careStreak || 0);

        if (img) {
            img.src = st.file;
            img.style.maxWidth = "240px";
            img.style.width = "100%";
            img.style.borderRadius = "18px";
            img.style.display = "block";
            img.style.margin = "0 auto";
        }
        if (stageEl) stageEl.textContent = st.label;
        if (feedsEl) feedsEl.textContent = d.feedCount || 0;

        const today = centralTodayId();
        const tokenIsToday = (d.canFeedYMD || "") === today;
        const fedLocked = (d.lastFedYMD || "") === today;
        const didWater = !!d.wateredToday && d.lastDailyYMD === today;
        const didBath = !!d.bathedToday && d.lastDailyYMD === today;
        const isComplete = fedLocked && didWater && didBath;
        setCompleteBarVisible(isComplete);

        if (feedBtn) feedBtn.disabled = fedLocked || !tokenIsToday;
        if (feedMsg) feedMsg.style.display = fedLocked ? "block" : "none";
        if (waterYes) waterYes.disabled = didWater;
        if (waterNo) waterNo.disabled = didWater;
        if (waterMsg) waterMsg.style.display = didWater ? "block" : "none";
        if (bathYes) bathYes.disabled = didBath;
        if (bathNo) bathNo.disabled = didBath;
        if (bathMsg) bathMsg.style.display = didBath ? "block" : "none";
    });

    let first = true;
    unsubTheme = onSnapshot(doc(db, "users", uid), (snap) => {
        applyThemeClass((snap.data() || {}).themeClass || "theme-original");
        if (first) {
            const wrap = document.getElementById('sparkleWrapper');
            if (wrap && wrap.children.length === 0) requestAnimationFrame(() => createFullPageSparkles(140));
            first = false;
        }
    }, () => { applyThemeClass("theme-original"); });

    let rootEarned = new Set(), subEarned = new Set();
    const applyEarned = () => {
        const combined = new Set([...rootEarned, ...subEarned]);
        renderBadgeGrid([...combined]);
    };

    unsubRoot = onSnapshot(doc(db, "users", uid), (s) => {
        const arr = Array.isArray(s.data()?.badges) ? s.data().badges : [];
        rootEarned = new Set(arr); applyEarned();
    });

    unsubSub = onSnapshot(collection(db, "users", uid, "badges"), (qs) => {
        subEarned = new Set(); qs.forEach(d => subEarned.add(d.id)); applyEarned();
    });

    feedBtn?.addEventListener("click", feedPet);
    lastSeenDay = centralTodayId();
    startMidnightWatcher();
}

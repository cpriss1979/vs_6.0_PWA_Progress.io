// auth.js — Firebase Auth helpers (Play Store ready)
// REQUIRES: firebase-init.js exporting { auth, db }

import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* -------------------- One-time cleanup of legacy localStorage auth -------------------- */
(() => {
  try {
    if (localStorage.getItem("users") || localStorage.getItem("currentUser")) {
      localStorage.removeItem("users");
      localStorage.removeItem("currentUser");
      console.info("[auth] Removed legacy localStorage auth artifacts.");
    }
  } catch (e) {
    console.warn("[auth] Cleanup warning:", e);
  }
})();

/* -------------------- Auth gate (only on pages that ask for it) -------------------- */
(() => {
  // Only gate pages that include: <meta name="auth" content="required">
  const needsAuth = document.querySelector('meta[name="auth"][content="required"]');
  if (!needsAuth) return;

  // Prevent flashing protected UI while we check auth
  const html = document.documentElement;
  html.style.visibility = "hidden";
  const safety = setTimeout(() => (html.style.visibility = "visible"), 2500);

  onAuthStateChanged(auth, (user) => {
    clearTimeout(safety);
    if (user) {
      try { localStorage.setItem("currentUser", user.uid); } catch { }
      html.style.visibility = "visible";
    } else {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.replace(`login.html?next=${next}`);
    }
  });
})();

/* -------------------- Public helpers -------------------- */

// Promise that resolves only when user is available or redirects if not.
export function requireAuth(redirect = "login.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        const next =
          new URLSearchParams(location.search).get("next") ||
          location.pathname.split("/").pop();
        const url = `${redirect}?next=${encodeURIComponent(next)}`;
        location.replace(url);
        return;
      }
      resolve(user);
    });
  });
}

// Lightweight accessor (null if not signed in)
export function currentUser() {
  return auth.currentUser;
}

// Consistent per-user key for local caches
export function getKey(key) {
  const u = auth.currentUser;
  if (!u) throw new Error("No user is signed in");
  return `user:${u.uid}:${key}`;
}

// Sign in
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

// Register new user (optional displayName)
export async function register(email, password, displayName = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    try { await updateProfile(cred.user, { displayName }); }
    catch (e) { console.warn("[auth] updateProfile failed:", e); }
  }
  await ensureUserDoc(cred.user);
  return cred.user;
}

// Sign out
export async function signOutUser() {
  await signOut(auth);
}

/* -------------------- Theme helpers -------------------- */

export async function loadThemeClass() {
  const user = auth.currentUser;
  if (!user) return "theme-original";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      return data?.themeClass || data?.theme || "theme-original";
    }
  } catch (e) {
    console.warn("[auth] Theme fetch failed, trying local cache:", e);
  }

  try {
    const ls = localStorage.getItem(`user:${user.uid}:themeClass`);
    if (ls) return ls;
  } catch { }
  return "theme-original";
}

export async function saveThemeClass(themeClass) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, "users", user.uid), { themeClass }, { merge: true });
  } catch (e) {
    console.warn("[auth] Theme save to Firestore failed, caching locally:", e);
    try { localStorage.setItem(`user:${user.uid}:themeClass`, themeClass); } catch { }
  }
}

/* -------------------- Internal: ensure user profile doc exists -------------------- */
async function ensureUserDoc(user) {
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          createdAt: Date.now(),
          themeClass: "theme-original",
        },
        { merge: true }
      );
      console.info("[auth] Created users/" + user.uid);
    }
  } catch (e) {
    console.warn("[auth] ensureUserDoc failed:", e);
  }
}

/* -------------------- Optional: global shim for legacy inline code -------------------- */
window.Auth = {
  requireAuth,
  currentUser,
  signIn,
  register,
  signOutUser,
  loadThemeClass,
  saveThemeClass,
  getKey,
};

// script.js — Firebase-ready helpers for Support List, Wellness Plan, Affirmations, Theme
// Requires: firebase-init.js and auth.js (both as ES modules on the page)

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  enableIndexedDbPersistence,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThemeClass, saveThemeClass } from "./auth.js";

// Optional offline cache (ok if it fails in multi-tab)
try { await enableIndexedDbPersistence(db); } catch { }

/* -------------------------------------------------------
   Auth helpers
------------------------------------------------------- */
function pageName() {
  const last = location.pathname.split("/").pop() || "index.html";
  return last;
}
function currentUser() {
  return auth.currentUser;
}
function requireUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        location.replace(`login.html?next=${encodeURIComponent(pageName())}`);
      } else {
        unsub();
        resolve(user);
      }
    });
  });
}

/* -------------------------------------------------------
   Support List (Firestore: users/{uid}/supportPeople/*)
   HTML expectations:
   - inputs: #name, #relationship, #phone
   - <ul id="savedSupport"></ul>
------------------------------------------------------- */
async function saveSupport() {
  const user = await requireUser();

  const name = (document.getElementById("name")?.value || "").trim();
  const relationship = (document.getElementById("relationship")?.value || "").trim();
  const phone = (document.getElementById("phone")?.value || "").trim();
  if (!name && !relationship && !phone) return;

  await addDoc(collection(db, "users", user.uid, "supportPeople"), {
    name, relationship, phone, createdAt: serverTimestamp(),
  });

  const n = document.getElementById("name"); if (n) n.value = "";
  const r = document.getElementById("relationship"); if (r) r.value = "";
  const p = document.getElementById("phone"); if (p) p.value = "";

  await displaySupport(); // re-render
}

async function deleteSupport(id) {
  const user = await requireUser();
  await deleteDoc(doc(db, "users", user.uid, "supportPeople", id));
  await displaySupport();
}

async function displaySupport() {
  const ul = document.getElementById("savedSupport");
  if (!ul) return; // page might not have the list
  const user = await requireUser();

  // Order reliably by createdAt from Firestore
  const q = query(
    collection(db, "users", user.uid, "supportPeople"),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);

  ul.innerHTML = "";
  snap.forEach((d) => {
    const person = { id: d.id, ...d.data() };

    const li = document.createElement("li");
    li.className = "support-clean";
    li.textContent = `📞 ${person.name || ""} (${person.relationship || ""}) ${person.phone || ""}`;

    const btn = document.createElement("button");
    btn.textContent = "❌";
    btn.className = "delete-button-inline";
    btn.onclick = () => deleteSupport(person.id);

    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function printSupportList() {
  const section = document.querySelector(".saved-section");
  if (!section) { alert("Nothing to print yet."); return; }
  const html = `
    <html>
      <head>
        <title>Print Support List</title>
        <style>
          body { font-family: Arial; padding: 2rem; background-color: #fffafc; color: #4a2c2a; }
        </style>
      </head>
      <body>${section.outerHTML}</body>
    </html>`;
  const w = window.open("", "", "width=850,height=600");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onload = () => { w.print(); w.close(); };
}

/* -------------------------------------------------------
   Wellness Plan (Firestore: users/{uid}/private/wellnessPlan)
   HTML expectations (inputs):
   #wellnessLook, #dailyHabits, #triggerList, #afterTriggered,
   #warningSigns, #actionPlan, #anotherAction
   Output fields (spans/divs):
   #displayWellnessLook, #displayDailyHabits, #displayTriggerList,
   #displayAfterTriggered, #displayWarningSigns, #displayActionPlan, #displayAnotherAction
   Optional: form id="wellnessForm"
------------------------------------------------------- */
function getPlanIn() {
  const val = (id) => (document.getElementById(id)?.value ?? "").toString();
  return {
    wellnessLook: val("wellnessLook"),
    dailyHabits: val("dailyHabits"),
    triggerList: val("triggerList"),
    afterTriggered: val("afterTriggered"),
    warningSigns: val("warningSigns"),
    actionPlan: val("actionPlan"),
    anotherAction: val("anotherAction"),
    updatedAt: Date.now(),
  };
}
function applyPlanOut(obj) {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ""; };
  setText("displayWellnessLook", obj.wellnessLook);
  setText("displayDailyHabits", obj.dailyHabits);
  setText("displayTriggerList", obj.triggerList);
  setText("displayAfterTriggered", obj.afterTriggered);
  setText("displayWarningSigns", obj.warningSigns);
  setText("displayActionPlan", obj.actionPlan);
  setText("displayAnotherAction", obj.anotherAction);
}

async function savePlan() {
  const user = await requireUser();
  const plan = getPlanIn();
  const ref = doc(db, "users", user.uid, "private", "wellnessPlan");
  await setDoc(ref, plan, { merge: true });
  await displaySavedPlan();
}

async function displaySavedPlan() {
  // Only run if the page has display targets
  if (!document.getElementById("displayWellnessLook")) return;

  const user = await requireUser();
  const ref = doc(db, "users", user.uid, "private", "wellnessPlan");
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  applyPlanOut(snap.data() || {});
}

async function resetPlan() {
  if (!confirm("Are you sure you want to reset your wellness plan? This will delete all saved data.")) return;
  const user = await requireUser();
  const ref = doc(db, "users", user.uid, "private", "wellnessPlan");
  await setDoc(ref, {}, { merge: false }); // clear the doc

  const form = document.getElementById("wellnessForm");
  if (form) form.reset();
  applyPlanOut({
    wellnessLook: "", dailyHabits: "", triggerList: "",
    afterTriggered: "", warningSigns: "", actionPlan: "", anotherAction: ""
  });
}

function printPlan() {
  const el = document.getElementById("savedPlan");
  if (!el) { alert("No saved plan to print."); return; }
  const html = `
    <html>
      <head>
        <title>Print My Wellness Plan</title>
        <style>
          body { font-family: Georgia; padding: 2rem; background:#fffafc; color: rgb(46,46,57); }
          h2, h3 { color: #b04bb3; }
          strong { color: rgb(207,125,225); }
          p { margin: .5rem 0; font-size: 1.1rem; }
          .saved-section { background-color:#fdf0f4; padding:1rem; border-radius:1rem; border:2px dashed #ce85a6; }
        </style>
      </head>
      <body>${el.outerHTML}</body>
    </html>`;
  const w = window.open("", "", "width=850,height=600");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onload = () => { w.print(); w.close(); };
}

/* -------------------------------------------------------
   Affirmations (kept local; no DB needed)
------------------------------------------------------- */
const dingSound = new Audio("chime.mp3");
dingSound.preload = "auto";
let soundEnabled = false;

const affirmations = [
  "You are n🚫t your diagnosis. You are n🚫t a stereotype.",
  "You've been through worse ⛈️ days, you can get through this day too 🤗.",
  "Your feelings are valid. Be assertive.",
  "Everyday you come closer 🎯 to reaching your goals.",
  "Your days will never be the same. You will never stay down ☀️.",
  "Sometimes you have to take life 1 second ⏱️ at a time. You've got this.",
  "How do you eat an elephant 🐘? One bite at a time.",
  "You are never 'always' angry/sad/mad/happy! You will bounce back.",
  "You are never alone ✝.",
  "Sometimes you just need to rest ❤️‍🩹 and that's ok .",
  "You accomplish much on a tough day, by waking up and facing the day.",
  "You surround yourself with others that love ❤️ you.",
  "You are strong, smart, kind, and worthy to be loved.",
  "It's not how you start the race... it's how you finish it ⌛️.",
  "Sometimes we all need a little help. It's ok to ask.",
  "God loves ❤️ you!",
  "God created you, and God doesn't make mistakes.",
  "Never let fear win! Don't give up! Try/try again!",
  "You might be nothing to everyone, but to someone you're everything.",
  "Everyone has good and bad days, everyone.",
  "God will protect you.",
  "God will guide you.",
  "Someone loves 💖you.",
  "Even if you feel alone, your not. ✞ God is always there.",
  "You have a beautiful heart 💙.",
  "You must try, to succeed",
  "Jesus loves me this I know, for the Bible tells me so.",
  "God has big plans for you here.",
  "Your smile brightens the world.",
  "I forgive me, I forgive myself for my mistakes and bad choices.",
  "Because of you, this world is a better place.",
  "Like a 'bumblebee' is - You're essential, gentle and strong.",
  "'A' is for always, 'B' is for bounceback, 'C' is for can do."
];

function showAffirmation() {
  const idx = Math.floor(Math.random() * affirmations.length);
  const message = affirmations[idx];

  if (soundEnabled) {
    dingSound.currentTime = 0;
    dingSound.play().catch(() => { });
  }

  const popup = document.createElement("div");
  popup.className = "affirmation-popup";
  popup.textContent = message;
  document.body.appendChild(popup);

  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 1400);
  }, 1400);
}

function enableSound() {
  soundEnabled = true;
  document.removeEventListener("click", enableSound);
  document.removeEventListener("touchstart", enableSound);
  showAffirmation();
}

function createRandomSparkles(containerSelector, sparkleCount = 25) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  for (let i = 0; i < sparkleCount; i++) {
    const sparkle = document.createElement("div");
    sparkle.classList.add("sparkle");
    sparkle.style.top = `${Math.random() * 100}%`;
    sparkle.style.left = `${Math.random() * 100}%`;
    sparkle.style.animationDelay = `${Math.random() * 3}s`;
    sparkle.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    container.appendChild(sparkle);
  }
}

/* -------------------------------------------------------
   Theme helpers (uses Firestore via auth.js helpers)
------------------------------------------------------- */
async function setTheme(theme) {
  // Accept "theme-brady" or "brady"
  const cls = theme.startsWith("theme-") ? theme : `theme-${theme}`;
  const root = document.documentElement;

  // Remove any existing theme-* class
  [...root.classList].forEach(c => { if (c.startsWith("theme-")) root.classList.remove(c); });
  root.classList.add(cls);

  // Persist to Firestore (and local fallback inside auth.js)
  await saveThemeClass(cls);
}

// Don’t force login just to load theme; use fallback/local.
async function loadUserTheme() {
  const cls = await loadThemeClass().catch(() => null);
  const root = document.documentElement;
  if (!root) return;
  // remove any existing theme-* classes
  [...root.classList].forEach(c => { if (c.startsWith("theme-")) root.classList.remove(c); });
  if (cls) root.classList.add(cls);
}

/* -------------------------------------------------------
   Auto-wire on load (only runs on pages that have the targets)
------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  // If a Support list is present, render it
  if (document.getElementById("savedSupport")) {
    displaySupport().catch(() => { });
  }

  // If Wellness display targets exist, populate them
  if (document.getElementById("displayWellnessLook")) {
    displaySavedPlan().catch(() => { });
  }

  // Sound unlock on first gesture
  document.addEventListener("click", enableSound, { once: true });
  document.addEventListener("touchstart", enableSound, { once: true });

  // Optional sparkle hook for pages that use .dreamy-box
  createRandomSparkles(".dreamy-box", 25);

  // Load the user's theme if pages care about it
  try { await loadUserTheme(); } catch { }
});

/* -------------------------------------------------------
   Expose functions for inline onclick="" usage
------------------------------------------------------- */
window.saveSupport = saveSupport;
window.deleteSupport = deleteSupport;
window.displaySupport = displaySupport;
window.printSupportList = printSupportList;

window.savePlan = savePlan;
window.displaySavedPlan = displaySavedPlan;
window.resetPlan = resetPlan;
window.printPlan = printPlan;

window.showAffirmation = showAffirmation;
window.setTheme = setTheme;
window.loadUserTheme = loadUserTheme;

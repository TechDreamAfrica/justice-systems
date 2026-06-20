// ============================================================
// app.js  —  TaskFlow application logic
// Firebase v10+ ESM SDK
// ============================================================

import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Constants ────────────────────────────────────────────────
const TASKS_COLLECTION = "tasks";

// ── App state ────────────────────────────────────────────────
let currentUser    = null;
let tasksData      = [];           // local cache of Firestore tasks
let unsubscribeFn  = null;         // Firestore real-time listener teardown
let activeFilter   = "all";
let searchQuery    = "";
let editingTaskId  = null;
let isDark         = false;

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  // Initialise Feather icons
  if (window.feather) feather.replace();

  // Restore dark mode preference
  isDark = localStorage.getItem("taskflow-dark") === "true";
  applyDarkMode(isDark);

  bindAuthEvents();
  bindDashboardEvents();
  bindModalEvents();

  // Watch auth state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      showDashboard(user);
      subscribeToTasks(user.uid);
    } else {
      currentUser = null;
      if (unsubscribeFn) { unsubscribeFn(); unsubscribeFn = null; }
      showAuth();
    }
  });
});

// ════════════════════════════════════════════════════════════
//  DARK MODE
// ════════════════════════════════════════════════════════════
function applyDarkMode(on) {
  document.documentElement.classList.toggle("dark", on);
  document.body.classList.toggle("dark", on);
  const label = document.getElementById("dark-toggle-label");
  if (label) label.textContent = on ? "Light mode" : "Dark mode";
}

// ════════════════════════════════════════════════════════════
//  AUTH ─ events
// ════════════════════════════════════════════════════════════
function bindAuthEvents() {
  // Toggle login ↔ signup
  document.getElementById("go-signup")?.addEventListener("click", () => switchAuthCard("signup"));
  document.getElementById("go-login")?.addEventListener("click",  () => switchAuthCard("login"));

  // Password visibility toggles
  addTogglePw("toggle-login-pw",  "login-password");
  addTogglePw("toggle-signup-pw", "signup-password");

  // Password strength meter
  document.getElementById("signup-password")?.addEventListener("input", (e) => {
    updatePwStrength(e.target.value);
  });

  // Login form
  document.getElementById("login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleLogin();
  });

  // Signup form
  document.getElementById("signup-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleSignup();
  });
}

function switchAuthCard(to) {
  document.getElementById("login-card")?.classList.toggle("hidden",  to !== "login");
  document.getElementById("signup-card")?.classList.toggle("hidden", to !== "signup");
  clearAuthErrors();
}

function addTogglePw(btnId, inputId) {
  document.getElementById(btnId)?.addEventListener("click", () => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isText = input.type === "text";
    input.type = isText ? "password" : "text";
    const icon = document.querySelector(`#${btnId} [data-feather]`);
    if (icon) { icon.setAttribute("data-feather", isText ? "eye" : "eye-off"); feather.replace(); }
  });
}

function updatePwStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const widths = ["0%", "25%", "50%", "75%", "100%"];
  const colors = ["#94a3b8", "#ef4444", "#f59e0b", "#22c55e", "#10b981"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];

  const bar   = document.getElementById("pw-strength");
  const label = document.getElementById("pw-strength-label");
  if (bar)   { bar.style.width = widths[score]; bar.style.background = colors[score]; }
  if (label) label.textContent = labels[score] || "\u00a0";
}

// ── Login ─────────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById("login-email")?.value.trim();
  const password = document.getElementById("login-password")?.value;
  const errEl    = document.getElementById("login-error");

  clearAuthErrors();

  if (!email || !password) { showAuthError("login-error", "Please fill in all fields."); return; }

  setLoadingState("login-btn", "login-btn-text", "login-spinner", true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will handle the rest
  } catch (err) {
    showAuthError("login-error", friendlyAuthError(err.code));
    setLoadingState("login-btn", "login-btn-text", "login-spinner", false);
  }
}

// ── Signup ────────────────────────────────────────────────
async function handleSignup() {
  const name     = document.getElementById("signup-name")?.value.trim();
  const email    = document.getElementById("signup-email")?.value.trim();
  const password = document.getElementById("signup-password")?.value;

  clearAuthErrors();

  if (!name || !email || !password) { showAuthError("signup-error", "Please fill in all fields."); return; }
  if (password.length < 8)          { showAuthError("signup-error", "Password must be at least 8 characters."); return; }

  setLoadingState("signup-btn", "signup-btn-text", "signup-spinner", true);

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: name });
    toast("Account created — welcome aboard! 🎉", "success");
  } catch (err) {
    showAuthError("signup-error", friendlyAuthError(err.code));
    setLoadingState("signup-btn", "signup-btn-text", "signup-spinner", false);
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found":        "No account with that email address.",
    "auth/wrong-password":        "Incorrect password.",
    "auth/email-already-in-use":  "An account with this email already exists.",
    "auth/invalid-email":         "Please enter a valid email address.",
    "auth/too-many-requests":     "Too many attempts. Please try again later.",
    "auth/weak-password":         "Password must be at least 8 characters.",
    "auth/network-request-failed":"Network error — check your connection.",
    "auth/invalid-credential":    "Incorrect email or password.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = msg; el.classList.remove("hidden"); }
}

function clearAuthErrors() {
  ["login-error", "signup-error"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
}

// ════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════
function showDashboard(user) {
  document.getElementById("auth-container").style.display  = "none";
  document.getElementById("app-container").style.display   = "flex";
  document.getElementById("app-container").classList.add("active");

  // Populate user info in sidebar
  const name  = user.displayName || user.email.split("@")[0];
  const email = user.email;

  setText("sidebar-name",  name);
  setText("sidebar-email", email);
  setAvatar("sidebar-avatar", name);
  setText("welcome-name",  name.split(" ")[0]);

  // Profile view
  setText("profile-name-display",  name);
  setText("profile-email-display", email);
  const input = document.getElementById("profile-name-input");
  if (input) input.value = name;

  const joined = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";
  setText("profile-joined", joined);
  setAvatar("profile-avatar", name, "large");

  setView("dashboard");
  feather.replace();
}

function showAuth() {
  document.getElementById("auth-container").style.display  = "";
  document.getElementById("app-container").style.display   = "none";
  document.getElementById("app-container").classList.remove("active");
  // Reset login form
  document.getElementById("login-form")?.reset();
  document.getElementById("signup-form")?.reset();
  switchAuthCard("login");
  feather.replace();
}

// ── Navigation ────────────────────────────────────────────
function bindDashboardEvents() {
  // Sidebar nav items
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      const view = el.dataset.view;
      setView(view);
      closeSidebar();
    });
  });

  // "View all" shortcut links in dashboard
  document.querySelectorAll(".nav-switch").forEach((el) => {
    el.addEventListener("click", () => setView(el.dataset.view));
  });

  // Mobile sidebar toggle
  document.getElementById("sidebar-toggle")?.addEventListener("click", openSidebar);
  document.getElementById("sidebar-overlay")?.addEventListener("click", closeSidebar);

  // Logout
  document.getElementById("logout-btn")?.addEventListener("click", handleLogout);

  // Dark mode
  document.getElementById("dark-toggle")?.addEventListener("click", () => {
    isDark = !isDark;
    localStorage.setItem("taskflow-dark", isDark);
    applyDarkMode(isDark);
    feather.replace();
  });

  // Task add button
  document.getElementById("add-task-btn")?.addEventListener("click", openAddModal);

  // Search
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderTasks();
  });

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.toggle("btn-primary", b === btn);
        b.classList.toggle("btn-ghost", b !== btn);
      });
      renderTasks();
    });
  });

  // Profile save
  document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleProfileSave();
  });

  // Password change
  document.getElementById("password-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handlePasswordChange();
  });
}

function setView(viewName) {
  // Hide all views
  ["dashboard", "tasks", "profile"].forEach((v) => {
    document.getElementById(`view-${v}`)?.classList.add("hidden");
  });
  document.getElementById(`view-${viewName}`)?.classList.remove("hidden");

  // Update nav active state
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === viewName);
  });

  // Update page title
  const titles = { dashboard: "Dashboard", tasks: "My Tasks", profile: "Profile" };
  setText("page-title", titles[viewName] || "");

  // Show/hide search and add button on tasks view
  document.getElementById("search-bar")?.classList.toggle("hidden", viewName !== "tasks");
  document.getElementById("add-task-btn")?.classList.toggle("hidden", viewName !== "tasks");

  feather.replace();
}

function openSidebar() {
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("sidebar-overlay")?.classList.add("open");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-overlay")?.classList.remove("open");
}

async function handleLogout() {
  try {
    await signOut(auth);
    toast("Signed out successfully.", "info");
  } catch {
    toast("Sign-out failed. Try again.", "error");
  }
}

// ════════════════════════════════════════════════════════════
//  FIRESTORE — Real-time subscription
// ════════════════════════════════════════════════════════════
function subscribeToTasks(uid) {
  const q = query(
    collection(db, TASKS_COLLECTION),
    where("uid", "==", uid),
    orderBy("createdAt", "desc")
  );

  // Show loading state
  document.getElementById("tasks-loading")?.classList.remove("hidden");
  document.getElementById("tasks-empty")?.classList.add("hidden");
  document.getElementById("tasks-table-wrapper")?.classList.add("hidden");

  unsubscribeFn = onSnapshot(
    q,
    (snapshot) => {
      tasksData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTasks();
      updateStats();
      renderRecentTasks();
      updateSidebarCount();
    },
    (err) => {
      console.error("Firestore snapshot error:", err);
      toast("Failed to load tasks. Please refresh.", "error");
    }
  );
}

// ════════════════════════════════════════════════════════════
//  TASKS — CRUD
// ════════════════════════════════════════════════════════════
async function createTask(data) {
  return await addDoc(collection(db, TASKS_COLLECTION), {
    ...data,
    uid:       currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function editTask(id, data) {
  await updateDoc(doc(db, TASKS_COLLECTION, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

async function removeTask(id) {
  await deleteDoc(doc(db, TASKS_COLLECTION, id));
}

// ════════════════════════════════════════════════════════════
//  MODAL — Add / Edit
// ════════════════════════════════════════════════════════════
function bindModalEvents() {
  document.getElementById("modal-close")?.addEventListener("click",  closeModal);
  document.getElementById("modal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeModal();
  });
  document.getElementById("task-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleTaskSubmit();
  });
}

function openAddModal() {
  editingTaskId = null;
  document.getElementById("task-form")?.reset();
  document.getElementById("task-id").value = "";
  setText("modal-title", "New task");
  setText("task-submit-text", "Create task");
  document.getElementById("task-form-error")?.classList.add("hidden");
  document.getElementById("modal-overlay")?.classList.add("active");
}

function openEditModal(task) {
  editingTaskId = task.id;
  setText("modal-title", "Edit task");
  setText("task-submit-text", "Save changes");

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  setVal("task-id",       task.id);
  setVal("task-title",    task.title);
  setVal("task-desc",     task.description);
  setVal("task-priority", task.priority);
  setVal("task-status",   task.status);
  setVal("task-due",      task.dueDate);

  document.getElementById("task-form-error")?.classList.add("hidden");
  document.getElementById("modal-overlay")?.classList.add("active");
}

function closeModal() {
  document.getElementById("modal-overlay")?.classList.remove("active");
  editingTaskId = null;
}

async function handleTaskSubmit() {
  const title       = document.getElementById("task-title")?.value.trim();
  const description = document.getElementById("task-desc")?.value.trim();
  const priority    = document.getElementById("task-priority")?.value;
  const status      = document.getElementById("task-status")?.value;
  const dueDate     = document.getElementById("task-due")?.value;

  if (!title) {
    showFormError("task-form-error", "Task name is required.");
    return;
  }

  setLoadingState("task-submit-btn", "task-submit-text", "task-submit-spinner", true);

  try {
    const payload = { title, description, priority, status, dueDate };

    if (editingTaskId) {
      await editTask(editingTaskId, payload);
      toast("Task updated.", "success");
    } else {
      await createTask(payload);
      toast("Task created.", "success");
    }
    closeModal();
  } catch (err) {
    console.error("Task save error:", err);
    showFormError("task-form-error", "Failed to save task. Please try again.");
  } finally {
    setLoadingState("task-submit-btn", "task-submit-text", "task-submit-spinner", false);
  }
}

// ════════════════════════════════════════════════════════════
//  RENDERING
// ════════════════════════════════════════════════════════════
function renderTasks() {
  const loadingEl  = document.getElementById("tasks-loading");
  const emptyEl    = document.getElementById("tasks-empty");
  const tableEl    = document.getElementById("tasks-table-wrapper");
  const bodyEl     = document.getElementById("tasks-body");

  loadingEl?.classList.add("hidden");

  // Filter
  let filtered = tasksData.filter((t) => {
    const matchFilter = activeFilter === "all" || t.status === activeFilter;
    const matchSearch = !searchQuery
      || t.title?.toLowerCase().includes(searchQuery)
      || t.description?.toLowerCase().includes(searchQuery);
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    emptyEl?.classList.remove("hidden");
    tableEl?.classList.add("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");
  tableEl?.classList.remove("hidden");

  bodyEl.innerHTML = filtered.map((task) => `
    <tr>
      <td>
        <div>
          <p class="font-medium text-slate-700 dark:text-slate-200 truncate max-w-xs">${escHtml(task.title)}</p>
          ${task.description ? `<p class="text-xs text-slate-400 truncate max-w-xs mt-0.5">${escHtml(task.description)}</p>` : ""}
        </div>
      </td>
      <td>${priorityBadge(task.priority)}</td>
      <td>${statusBadge(task.status)}</td>
      <td class="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
        ${task.dueDate ? formatDate(task.dueDate) : "—"}
      </td>
      <td>
        <div class="flex items-center gap-2">
          <button class="btn btn-ghost btn-sm" onclick="window._editTask('${task.id}')">
            <i data-feather="edit-2" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="window._deleteTask('${task.id}')">
            <i data-feather="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  feather.replace();
}

function renderRecentTasks() {
  const el = document.getElementById("recent-tasks-list");
  if (!el) return;

  const recent = tasksData.slice(0, 5);

  if (recent.length === 0) {
    el.innerHTML = `<div class="empty-state py-10">
      <p class="text-sm text-slate-400">No tasks yet. <button data-view="tasks" class="nav-switch text-brand-500 font-medium hover:underline" onclick="window._setView('tasks')">Add your first task →</button></p>
    </div>`;
    return;
  }

  el.innerHTML = recent.map((task) => `
    <div class="flex items-center gap-4 px-5 py-3.5">
      <div class="w-2 h-2 rounded-full flex-shrink-0 ${statusDot(task.status)}"></div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escHtml(task.title)}</p>
        <p class="text-xs text-slate-400 mt-0.5">${task.dueDate ? "Due " + formatDate(task.dueDate) : "No due date"}</p>
      </div>
      ${priorityBadge(task.priority)}
    </div>
  `).join("");
}

function updateStats() {
  const total   = tasksData.length;
  const done    = tasksData.filter((t) => t.status === "done").length;
  const pending = tasksData.filter((t) => t.status === "pending").length;
  const rate    = total > 0 ? Math.round((done / total) * 100) : 0;

  setText("stat-total",   total);
  setText("stat-pending", pending);
  setText("stat-done",    done);
  setText("stat-rate",    rate + "%");

  const fill  = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  if (fill)  fill.style.width = rate + "%";
  if (label) label.textContent = rate + "%";
}

function updateSidebarCount() {
  const count = tasksData.filter((t) => t.status !== "done").length;
  const el    = document.getElementById("sidebar-task-count");
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ── Global handlers (called from inline onclick) ──────────
window._editTask = (id) => {
  const task = tasksData.find((t) => t.id === id);
  if (task) openEditModal(task);
};

window._deleteTask = async (id) => {
  if (!confirm("Delete this task? This cannot be undone.")) return;
  try {
    await removeTask(id);
    toast("Task deleted.", "info");
  } catch {
    toast("Failed to delete task.", "error");
  }
};

window._setView = (v) => setView(v);

// ════════════════════════════════════════════════════════════
//  PROFILE
// ════════════════════════════════════════════════════════════
async function handleProfileSave() {
  const name = document.getElementById("profile-name-input")?.value.trim();
  const errEl = document.getElementById("profile-error");

  errEl?.classList.add("hidden");

  if (!name) { showFormError("profile-error", "Name cannot be empty."); return; }

  setLoadingState("profile-save-btn", "profile-save-text", "profile-save-spinner", true);

  try {
    await updateProfile(currentUser, { displayName: name });
    // Update UI
    setText("sidebar-name",        name);
    setText("profile-name-display", name);
    setText("welcome-name",         name.split(" ")[0]);
    setAvatar("sidebar-avatar",  name);
    setAvatar("profile-avatar",  name, "large");

    toast("Profile saved.", "success");
  } catch (err) {
    console.error("Profile update error:", err);
    showFormError("profile-error", "Failed to update profile.");
  } finally {
    setLoadingState("profile-save-btn", "profile-save-text", "profile-save-spinner", false);
  }
}

async function handlePasswordChange() {
  const newPw  = document.getElementById("new-password")?.value;
  const confPw = document.getElementById("confirm-password")?.value;
  const errEl  = document.getElementById("pw-change-error");

  errEl?.classList.add("hidden");

  if (!newPw || !confPw)   { showFormError("pw-change-error", "Please fill in both fields."); return; }
  if (newPw.length < 8)    { showFormError("pw-change-error", "Password must be at least 8 characters."); return; }
  if (newPw !== confPw)    { showFormError("pw-change-error", "Passwords do not match."); return; }

  const btn = document.getElementById("pw-change-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Updating…"; }

  try {
    await updatePassword(currentUser, newPw);
    document.getElementById("password-form")?.reset();
    toast("Password updated.", "success");
  } catch (err) {
    const msg = err.code === "auth/requires-recent-login"
      ? "Please sign in again before changing your password."
      : "Password update failed.";
    showFormError("pw-change-error", msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Update password"; }
  }
}

// ════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════
/**
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 */
function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const icons = { success: "check-circle", error: "alert-circle", info: "info" };

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <i data-feather="${icons[type]}" class="w-4 h-4 flex-shrink-0"></i>
    <span>${escHtml(message)}</span>
  `;
  container.appendChild(el);
  feather.replace();

  setTimeout(() => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove());
  }, 3500);
}

// ════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setAvatar(id, name, size = "normal") {
  const el = document.getElementById(id);
  if (!el) return;
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  el.textContent = initials;
  if (size === "large") { el.style.width = "64px"; el.style.height = "64px"; el.style.fontSize = "1.25rem"; }
}

function showFormError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove("hidden"); }
}

/**
 * Manage loading state on a button.
 * @param {string} btnId   - button element id
 * @param {string} textId  - span containing button label
 * @param {string} spinId  - span containing spinner
 * @param {boolean} loading
 */
function setLoadingState(btnId, textId, spinId, loading) {
  const btn  = document.getElementById(btnId);
  const text = document.getElementById(textId);
  const spin = document.getElementById(spinId);
  if (btn)  btn.disabled  = loading;
  if (text) text.classList.toggle("hidden", loading);
  if (spin) spin.classList.toggle("hidden", !loading);
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function priorityBadge(priority) {
  const map = {
    low:    ["badge-green",  "Low"],
    medium: ["badge-yellow", "Medium"],
    high:   ["badge-red",    "High"],
  };
  const [cls, label] = map[priority] || ["badge-green", "Low"];
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(status) {
  const map = {
    "pending":     ["badge-yellow", "Pending"],
    "in-progress": ["badge-green",  "In Progress"],
    "done":        ["badge-green",  "Done"],
  };
  const [cls, label] = map[status] || ["badge-yellow", "Pending"];
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusDot(status) {
  return {
    "pending":     "bg-yellow-400",
    "in-progress": "bg-blue-400",
    "done":        "bg-green-400",
  }[status] || "bg-slate-300";
}

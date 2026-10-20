/* X Privacy — popup logic */

const DEFAULTS = {
  enabled: true,
  hideSidebar: true,
  hideMenu: true,
  hidePosts: false,
  hideProfile: false,
  blurAvatar: false,
  mode: "hide",
  revealOnHover: true,
};

const BOOL_KEYS = [
  "enabled",
  "hideSidebar",
  "hideMenu",
  "hidePosts",
  "hideProfile",
  "blurAvatar",
  "revealOnHover",
];
const FEATURE_KEYS = ["hideSidebar", "hideMenu", "hidePosts", "hideProfile", "blurAvatar"];
const X_URL = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;

const $ = (id) => document.getElementById(id);

function normalize(raw) {
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (raw && raw[key] !== undefined && raw[key] !== null) s[key] = raw[key];
  }
  s.enabled = s.enabled !== false;
  s.mode = s.mode === "blur" ? "blur" : "hide";
  return s;
}

function render(s) {
  for (const key of BOOL_KEYS) $(key).checked = Boolean(s[key]);
  const radio = document.querySelector(`input[name="mode"][value="${s.mode}"]`);
  if (radio) radio.checked = true;
  document.body.classList.toggle("is-off", !s.enabled);
  document.body.classList.toggle("mode-blur", s.mode === "blur");
  $("statusPill").textContent = s.enabled ? "Active" : "Paused";
  const allOn = FEATURE_KEYS.every((key) => s[key]);
  $("toggleAll").textContent = allOn ? "Reset to defaults" : "Enable all";
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (res) => render(normalize(res)));
}

/* ---------- settings ↔ controls ---------- */

for (const key of BOOL_KEYS) {
  $(key).addEventListener("change", (event) => {
    chrome.storage.sync.set({ [key]: event.target.checked });
  });
}

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", () => {
    if (radio.checked) chrome.storage.sync.set({ mode: radio.value });
  });
}

$("toggleAll").addEventListener("click", () => {
  chrome.storage.sync.get(DEFAULTS, (res) => {
    const s = normalize(res);
    const allOn = FEATURE_KEYS.every((key) => s[key]);
    const patch = {};
    for (const key of FEATURE_KEYS) patch[key] = allOn ? DEFAULTS[key] : true;
    chrome.storage.sync.set(patch);
  });
});

// Keep the popup in sync if settings change elsewhere (keyboard shortcut, another window).
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") load();
});

/* ---------- status of the current tab ---------- */

function maskHandle(handle) {
  if (!handle) return "";
  const dots = "•".repeat(Math.min(Math.max(handle.length - 1, 2), 6));
  return `@${handle[0]}${dots}`;
}

function setStatus(kind, text) {
  const el = $("status");
  el.classList.remove("ok", "warn");
  if (kind) el.classList.add(kind);
  $("statusText").textContent = text;
}

function setAction(label, handler, primary) {
  const btn = $("tabAction");
  btn.hidden = !label;
  btn.textContent = label || "";
  btn.classList.toggle("primary", Boolean(primary));
  btn.onclick = handler || null;
}

async function queryActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  } catch (_err) {
    return null;
  }
}

async function refreshStatus() {
  const tab = await queryActiveTab();
  const url = tab && tab.url ? tab.url : "";

  if (!tab || !X_URL.test(url)) {
    setStatus("", "Open X to see it in action");
    setAction("Open X", () => chrome.tabs.create({ url: "https://x.com/home" }), true);
    return;
  }

  const reload = () => {
    chrome.tabs.reload(tab.id);
    window.close();
  };

  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: "xp:status" });
  } catch (_err) {
    res = null;
  }

  if (!res || !res.ok) {
    setStatus("warn", "Reload this X tab to activate");
    setAction("Reload tab", reload, true);
    return;
  }

  if (!res.enabled) {
    setStatus("", "Paused on this tab");
  } else if (res.handle) {
    setStatus("ok", `Active on this tab · hiding ${maskHandle(res.handle)}`);
  } else {
    setStatus("warn", "Active · waiting for X to show your account");
  }
  setAction("Reload tab", reload, false);
}

load();
refreshStatus();

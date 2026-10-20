/* X Privacy — content script
 *
 * Hides your identity (display name, @handle and optionally your avatar) on
 * x.com. The actual hiding is done by styles.css, keyed off:
 *   - feature flags on <html>   (data-xp-on, data-xp-mode, data-xp-sidebar, …)
 *   - marks on page elements    (data-xp-m-sidebar="collapse", …)
 *
 * This script reads the settings, detects your @handle from the page, marks
 * the elements that show your identity, and keeps those marks fresh while X
 * re-renders its single-page app.
 */
(() => {
  "use strict";

  const ROOT = document.documentElement;

  const DEFAULTS = {
    enabled: true, // master switch (key kept from v1 for backwards compatibility)
    hideSidebar: true, // bottom-left account switcher
    hideMenu: true, // the account menu that opens from the switcher
    hidePosts: false, // your own posts, replies and quotes in any timeline
    hideProfile: false, // the header of your own profile page
    blurAvatar: false, // blur your avatar wherever it appears
    mode: "hide", // "hide" removes the text, "blur" keeps the layout
    revealOnHover: true, // in blur mode, un-blur while hovering
  };

  // Settings key -> attribute on <html>
  const FLAGS = {
    hideSidebar: "data-xp-sidebar",
    hideMenu: "data-xp-menu",
    hidePosts: "data-xp-posts",
    hideProfile: "data-xp-profile",
    blurAvatar: "data-xp-avatar",
    revealOnHover: "data-xp-hover",
  };

  // Feature -> attribute placed on marked page elements
  const MARK = {
    sidebar: "data-xp-m-sidebar",
    menu: "data-xp-m-menu",
    posts: "data-xp-m-posts",
    profile: "data-xp-m-profile",
    avatar: "data-xp-m-avatar",
  };
  const ANY_MARK = Object.values(MARK)
    .map((a) => `[${a}]`)
    .join(",");

  const SWITCHER = '[data-testid="SideNav_AccountSwitcher_Button"]';
  const AVATAR_PREFIX = "UserAvatar-Container-";
  const AVATAR_ANY = `[data-testid^="${AVATAR_PREFIX}"]`;
  const PROFILE_LINK = 'a[data-testid="AppTabBar_Profile_Link"]';
  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  const SCAN_INTERVAL_MS = 120;

  const state = {
    settings: { ...DEFAULTS },
    handle: null,
    scans: 0,
  };

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  function normalize(raw) {
    const s = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (raw && raw[key] !== undefined && raw[key] !== null) s[key] = raw[key];
    }
    s.enabled = s.enabled !== false;
    s.mode = s.mode === "blur" ? "blur" : "hide";
    return s;
  }

  function applySettings() {
    const s = state.settings;
    ROOT.toggleAttribute("data-xp-on", s.enabled);
    ROOT.setAttribute("data-xp-mode", s.mode);
    for (const [key, attr] of Object.entries(FLAGS)) {
      ROOT.toggleAttribute(attr, Boolean(s[key]));
    }
    scheduleScan();
  }

  chrome.storage.sync.get(DEFAULTS, (res) => {
    state.settings = normalize(res);
    applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let touched = false;
    const next = { ...state.settings };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in changes) {
        next[key] = changes[key].newValue;
        touched = true;
      }
    }
    if (!touched) return;
    state.settings = normalize(next);
    applySettings();
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  const hasText = (el) => /\S/.test(el.textContent || "");

  function handleRegExp(handle) {
    return new RegExp(`@${handle}(?![A-Za-z0-9_])`, "i");
  }

  function setMark(el, attr, value) {
    if (!el || el.getAttribute(attr) === value) return;
    el.setAttribute(attr, value);
  }

  function clearMarks() {
    for (const el of document.querySelectorAll(ANY_MARK)) {
      for (const attr of Object.values(MARK)) el.removeAttribute(attr);
    }
  }

  function nthAncestor(el, n, stopAt) {
    let node = el;
    for (let i = 0; i < n; i += 1) {
      if (!node.parentElement || node.parentElement === stopAt) break;
      node = node.parentElement;
    }
    return node;
  }

  /**
   * Walk from `inner` up to (but not including) `row`. At every level, mark
   * the siblings of the current node: text-bearing siblings get "collapse",
   * icon-only siblings (e.g. the "…" chevron next to your name) get "aux".
   * The avatar itself and everything inside it is never touched.
   */
  function markOutside(row, inner, attr) {
    let node = inner;
    while (node && node !== row) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const sib of parent.children) {
        if (sib === node) continue;
        if (hasText(sib)) setMark(sib, attr, "collapse");
        else if (sib.querySelector("svg") && !sib.querySelector("img")) setMark(sib, attr, "aux");
      }
      node = parent;
    }
  }

  /**
   * Find text nodes that spell out @handle (e.g. "Log out @handle") and wrap
   * just the handle in a marked <span>, so the rest of the label stays
   * readable. Falls back to masking the whole parent if splitting fails.
   */
  function markHandleText(root, handle, attr) {
    const re = handleRegExp(handle);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (re.test(node.nodeValue || "")) nodes.push(node);
    }
    for (const text of nodes) {
      const parent = text.parentElement;
      if (!parent) continue;
      if (parent.hasAttribute(attr) && parent.childNodes.length === 1) continue; // already wrapped
      try {
        const m = re.exec(text.nodeValue);
        const handleNode = text.splitText(m.index);
        handleNode.splitText(m[0].length);
        const wrap = document.createElement("span");
        setMark(wrap, attr, "collapse");
        parent.insertBefore(wrap, handleNode);
        wrap.appendChild(handleNode);
      } catch (_err) {
        setMark(parent, attr, "mask");
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Handle detection
   * ------------------------------------------------------------------ */

  function detectHandle() {
    let handle = "";

    // 1. The avatar in the account switcher carries data-testid="UserAvatar-Container-<handle>"
    const avatar = document.querySelector(`${SWITCHER} ${AVATAR_ANY}`);
    if (avatar) handle = avatar.getAttribute("data-testid").slice(AVATAR_PREFIX.length);

    // 2. The "Profile" link in the left navigation points at /<handle>
    if (!HANDLE_RE.test(handle) || handle.toLowerCase() === "unknown") {
      const link = document.querySelector(PROFILE_LINK);
      const m = link && /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(link.getAttribute("href") || "");
      handle = m ? m[1] : "";
    }

    // 3. The @handle text inside the account switcher
    if (!handle) {
      const btn = document.querySelector(SWITCHER);
      const m = btn && /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/.exec(btn.textContent || "");
      handle = m ? m[1] : "";
    }

    return HANDLE_RE.test(handle) ? handle.toLowerCase() : null;
  }

  /* ------------------------------------------------------------------ *
   * Scanners — one per feature
   * ------------------------------------------------------------------ */

  function scanSidebar() {
    for (const btn of document.querySelectorAll(SWITCHER)) {
      const avatar = btn.querySelector(AVATAR_ANY) || btn.querySelector("img");
      if (avatar) {
        markOutside(btn, avatar, MARK.sidebar);
        setMark(avatar, MARK.avatar, "");
      } else {
        // No avatar found: hide every text block instead (CSS baseline does this too).
        for (const el of btn.querySelectorAll('[dir="ltr"]')) {
          if (!el.querySelector("img")) setMark(el, MARK.sidebar, "collapse");
        }
      }
    }
  }

  function scanMenu() {
    const layers = document.getElementById("layers");
    if (!layers) return;
    for (const menu of layers.querySelectorAll('[role="menu"]')) {
      for (const avatar of menu.querySelectorAll(AVATAR_ANY)) {
        const row =
          avatar.closest('[role="menuitem"], [data-testid="UserCell"]') ||
          avatar.closest("a, button") ||
          nthAncestor(avatar, 3, menu);
        markOutside(row, avatar, MARK.menu);
        setMark(avatar, MARK.avatar, "");
      }
      // Items that spell out your handle, e.g. "Log out @handle".
      if (state.handle) {
        for (const item of menu.querySelectorAll('[role="menuitem"]')) {
          markHandleText(item, state.handle, MARK.menu);
        }
      }
    }
  }

  function scanPosts() {
    const handle = state.handle;
    if (!handle) return;
    const link = `a[href="/${handle}" i]`;
    const selector = [
      `[data-testid="User-Name"] ${link}`,
      `[data-testid="UserCell"] ${link}`,
      `[data-testid="HoverCard"] ${link}`,
    ].join(",");
    for (const el of document.querySelectorAll(selector)) setMark(el, MARK.posts, "collapse");
  }

  function scanProfile() {
    const handle = state.handle;
    if (!handle) return;
    const re = handleRegExp(handle);
    for (const el of document.querySelectorAll('[data-testid="UserName"]')) {
      if (re.test(el.textContent || "")) setMark(el, MARK.profile, "mask");
    }
  }

  function scanAvatars() {
    const handle = state.handle;
    if (!handle) return;
    for (const el of document.querySelectorAll(`[data-testid="${AVATAR_PREFIX}${handle}" i]`)) {
      setMark(el, MARK.avatar, "");
    }
  }

  /* ------------------------------------------------------------------ *
   * Scheduling
   * ------------------------------------------------------------------ */

  let scanQueued = false;
  let lastScan = 0;

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    const wait = Math.max(0, SCAN_INTERVAL_MS - (performance.now() - lastScan));
    setTimeout(() => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(runScan);
      else runScan();
    }, wait);
  }

  function runScan() {
    scanQueued = false;
    lastScan = performance.now();
    const s = state.settings;
    if (!s.enabled) return;

    const handle = detectHandle();
    if (handle !== state.handle) {
      if (state.handle) clearMarks(); // account switched: start over
      state.handle = handle;
    }

    if (s.hideSidebar) scanSidebar();
    if (s.hideMenu) scanMenu();
    if (s.hidePosts) scanPosts();
    if (s.hideProfile) scanProfile();
    if (s.blurAvatar) scanAvatars();
    state.scans += 1;
  }

  // X re-renders constantly; attribute changes are NOT observed so our own
  // marks never re-trigger the observer.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(ROOT, { childList: true, subtree: true });

  /* ------------------------------------------------------------------ *
   * Popup ↔ page messaging
   * ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "xp:status") return undefined;
    sendResponse({
      ok: true,
      enabled: state.settings.enabled,
      handle: state.handle,
      marks: document.querySelectorAll(ANY_MARK).length,
      scans: state.scans,
    });
    return undefined;
  });
})();

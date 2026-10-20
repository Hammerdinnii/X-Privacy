/* Minimal chrome.* stub for running the extension's scripts in a plain page.
 * Installed via Playwright's addInitScript before the fixture / popup loads.
 *
 * Test helpers exposed on window:
 *   __xpStore()            -> current storage object
 *   __xpSet(patch)         -> write + fire storage.onChanged (like another context would)
 *   __xpMessage(msg)       -> deliver a runtime message, resolves with the response
 */
(() => {
  const store = Object.assign({}, window.__XP_INITIAL_STORE__ || {});
  const storageListeners = [];
  const messageListeners = [];
  const calls = { reload: [], create: [], badge: [] };

  function pick(keys) {
    let out = {};
    if (keys === null || keys === undefined) {
      out = { ...store };
    } else if (typeof keys === "string") {
      if (keys in store) out[keys] = store[keys];
    } else if (Array.isArray(keys)) {
      for (const k of keys) if (k in store) out[k] = store[k];
    } else {
      out = { ...keys };
      for (const k of Object.keys(keys)) if (k in store) out[k] = store[k];
    }
    return out;
  }

  function fireChanges(changes) {
    for (const fn of storageListeners) {
      try {
        fn(changes, "sync");
      } catch (err) {
        console.error(err);
      }
    }
  }

  function write(patch) {
    const changes = {};
    for (const [k, v] of Object.entries(patch)) {
      changes[k] = { oldValue: store[k], newValue: v };
      store[k] = v;
    }
    setTimeout(() => fireChanges(changes), 0);
  }

  const sync = {
    get(keys, cb) {
      const out = pick(keys);
      if (typeof cb === "function") {
        setTimeout(() => cb(out), 0);
        return undefined;
      }
      return Promise.resolve(out);
    },
    set(patch, cb) {
      write(patch);
      if (typeof cb === "function") setTimeout(cb, 0);
      return Promise.resolve();
    },
  };

  window.chrome = {
    storage: {
      sync,
      local: sync,
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      lastError: null,
    },
    tabs: {
      query: async () => [window.__XP_TAB__ || { id: 1, url: "https://x.com/home" }],
      sendMessage: async (_id, msg) => {
        if (window.__XP_NO_RECEIVER__) throw new Error("Could not establish connection");
        return window.__XP_RESPONSE__ || { ok: true, enabled: true, handle: "janedoe" };
      },
      reload: (id) => calls.reload.push(id),
      create: (opts) => calls.create.push(opts),
    },
    action: {
      setBadgeText: async (o) => calls.badge.push(o),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  };

  window.__xpStore = () => ({ ...store });
  window.__xpCalls = () => calls;
  window.__xpSet = (patch) => write(patch);
  window.__xpMessage = (msg) =>
    new Promise((resolve) => {
      let answered = false;
      for (const fn of messageListeners) {
        fn(msg, {}, (res) => {
          answered = true;
          resolve(res);
        });
      }
      if (!answered) setTimeout(() => resolve(null), 50);
    });
})();

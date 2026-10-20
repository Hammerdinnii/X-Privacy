/* X Privacy — background service worker
 *
 * - Seeds default settings on install / update (keeps v1's "enabled" key)
 * - Keeps the toolbar badge in sync with the master switch
 * - Handles the Alt+Shift+X keyboard shortcut
 */

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

async function seedDefaults() {
  const current = await chrome.storage.sync.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!(key in current)) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

async function updateBadge() {
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  const on = enabled !== false;
  await chrome.action.setBadgeText({ text: on ? "" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: "#71767b" });
  await chrome.action.setTitle({
    title: `X Privacy — ${on ? "on" : "off"} (Alt+Shift+X to toggle)`,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await seedDefaults();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "enabled" in changes) updateBadge();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-enabled") return;
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  await chrome.storage.sync.set({ enabled: enabled === false });
});

updateBadge();

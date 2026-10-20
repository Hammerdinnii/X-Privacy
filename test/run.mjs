/* X Privacy — end-to-end checks against the DOM fixture, plus popup screenshots.
 *
 *   node test/run.mjs            run the checks
 *   node test/run.mjs --shots    also refresh docs/popup*.png
 *
 * Requires Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => path.join(ROOT, ...p);
const SHOTS = process.argv.includes("--shots");

let failures = 0;
let passes = 0;
function check(name, ok, detail = "") {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `  — ${detail}`}`);
}
const section = (t) => console.log(`\n${t}`);

/* ---------- browser helpers injected into the page ---------- */
const HELPERS = `
  window.__q = (sel) => document.querySelector(sel);
  window.__hidden = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    if (el.getClientRects().length === 0) return true;
    return getComputedStyle(el).visibility === "hidden";
  };
  window.__blurred = (sel) => {
    let el = document.querySelector(sel);
    if (!el) return "missing";
    for (; el && el !== document; el = el.parentElement) {
      if (getComputedStyle(el).filter.includes("blur")) return true;
    }
    return false;
  };
`;

async function settle(page, ms = 350) {
  await page.waitForTimeout(ms);
}

async function setSettings(page, patch) {
  await page.evaluate((p) => window.__xpSet(p), patch);
  await settle(page);
}

/* ---------- content script checks ---------- */
async function testContent(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => check(`no page error: ${err.message}`, false));
  await page.addInitScript({ path: P("test", "chrome-stub.js") });
  await page.addInitScript(HELPERS);
  await page.goto("file://" + P("test", "fixture.html"));
  await page.addStyleTag({ path: P("styles.css") });
  await page.addScriptTag({ path: P("content.js") });
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-xp-on"));
  await settle(page);

  const hidden = (sel) => page.evaluate((s) => window.__hidden(s), sel);
  const blurred = (sel) => page.evaluate((s) => window.__blurred(s), sel);
  const visible = async (sel) => (await hidden(sel)) === false && (await blurred(sel)) === false;

  section("Defaults (hide mode: sidebar + account menu)");
  check("sidebar display name is hidden", await hidden("#sidebar-name"));
  check("sidebar @handle is hidden", await hidden("#sidebar-handle"));
  check("sidebar '…' icon column is hidden", await hidden("#sidebar-more"));
  check("sidebar avatar stays visible", await visible("#sidebar-avatar-img"));
  check("account menu: name hidden", await hidden("#menu-name"));
  check("account menu: @handle hidden", await hidden("#menu-handle"));
  check("account menu: 'Log out' label stays readable", await visible("#menu-logout-text"));
  check(
    "account menu: @handle inside 'Log out @handle' hidden",
    await hidden("#menu-logout [data-xp-m-menu]"),
  );
  check(
    "account menu: only the handle was wrapped",
    (await page.textContent("#menu-logout [data-xp-m-menu]")) === "@janedoe",
  );
  check("account menu: 'Add an existing account' untouched", await visible("#menu-add"));
  check("account menu: 'Manage accounts' untouched", await visible("#menu-manage"));
  check("own post name still visible (feature off by default)", await visible("#self-tweet-name"));
  check("profile header still visible (feature off by default)", await visible("#profile-name"));
  const status = await page.evaluate(() => window.__xpMessage({ type: "xp:status" }));
  check(
    "status message reports detected handle",
    status && status.ok && status.handle === "janedoe",
    JSON.stringify(status),
  );

  section("Posts + profile enabled");
  await setSettings(page, { hidePosts: true, hideProfile: true });
  check("own post: name link hidden", await hidden("#self-tweet-name"));
  check("own post: @handle link hidden (case-insensitive href)", await hidden("#self-tweet-handle"));
  check("own post: timestamp stays", await visible("#self-tweet-time"));
  check("own post: text stays", await visible("#tweet-self [data-testid='tweetText']"));
  check("other user's name untouched", await visible("#other-tweet-name"));
  check("other user's @handle untouched", await visible("#other-tweet-handle"));
  check("@mention of you inside someone's post untouched", await visible("#mention-link"));
  check("profile header: name hidden", await hidden("#profile-name"));
  check("profile header: @handle hidden", await hidden("#profile-handle"));
  check("profile bio untouched", await visible("#profile-bio"));
  check("nav 'Profile' link untouched", await visible("a[data-testid='AppTabBar_Profile_Link']"));

  section("Blur mode");
  await setSettings(page, { mode: "blur" });
  check(
    "sidebar name blurred, not removed",
    (await blurred("#sidebar-name")) && !(await hidden("#sidebar-name")),
  );
  check("sidebar '…' icon stays in blur mode", await visible("#sidebar-more"));
  check(
    "own post name blurred, not removed",
    (await blurred("#self-tweet-name")) && !(await hidden("#self-tweet-name")),
  );
  check("profile header blurred", await blurred("#profile-name"));
  check("@handle in 'Log out @handle' blurred", await blurred("#menu-logout [data-xp-m-menu]"));
  check("'Log out' label not blurred", !(await blurred("#menu-logout-text")));
  check("other user's name not blurred", await visible("#other-tweet-name"));
  await page.hover("#switcher");
  await settle(page, 250);
  check("reveal on hover: sidebar name readable while hovered", !(await blurred("#sidebar-name")));
  await page.mouse.move(900, 700);
  await settle(page, 250);
  check("blur returns after hover ends", await blurred("#sidebar-name"));
  await setSettings(page, { revealOnHover: false });
  await page.hover("#switcher");
  await settle(page, 250);
  check("reveal on hover off: stays blurred while hovered", await blurred("#sidebar-name"));
  await page.mouse.move(900, 700);

  section("Avatar blur");
  await setSettings(page, { blurAvatar: true });
  check("sidebar avatar blurred", await blurred("#sidebar-avatar-img"));
  check("own post avatar blurred", await blurred("#self-tweet-avatar-img"));
  check("account menu avatar blurred", await blurred("#menu-avatar img"));
  check("other user's avatar not blurred", !(await blurred("#other-tweet-avatar-img")));
  await setSettings(page, { blurAvatar: false });
  check("avatar blur turns off", !(await blurred("#sidebar-avatar-img")));

  section("Master switch off");
  await setSettings(page, { enabled: false });
  for (const sel of [
    "#sidebar-name",
    "#sidebar-handle",
    "#menu-name",
    "#self-tweet-name",
    "#profile-name",
    "#menu-logout [data-xp-m-menu]",
  ]) {
    check(`${sel} fully visible when paused`, await visible(sel));
  }
  await setSettings(page, { enabled: true, mode: "hide" });
  check("re-enabling hides again", await hidden("#sidebar-name"));

  section("Dynamic DOM (X re-rendering)");
  await page.evaluate(() => {
    const art = document.getElementById("tweet-self").cloneNode(true);
    art.id = "tweet-self-2";
    art.querySelector("#self-tweet-name").id = "self-tweet-name-2";
    document.getElementById("timeline").appendChild(art);
  });
  await settle(page, 400);
  check("newly inserted own post gets hidden", await hidden("#self-tweet-name-2"));

  section("Account switch");
  await page.evaluate(() => {
    document.getElementById("sidebar-avatar").setAttribute("data-testid", "UserAvatar-Container-otheracct");
    document.querySelector("a[data-testid='AppTabBar_Profile_Link']").setAttribute("href", "/otheracct");
    document.getElementById("sidebar-handle").textContent = "@otheracct";
    const art = document.getElementById("tweet-other").cloneNode(true);
    art.id = "tweet-otheracct";
    const a = art.querySelector("#other-tweet-name");
    a.id = "otheracct-name";
    a.setAttribute("href", "/otheracct");
    art.querySelector("#other-tweet-handle").setAttribute("href", "/otheracct");
    document.getElementById("timeline").appendChild(art);
  });
  await settle(page, 450);
  const status2 = await page.evaluate(() => window.__xpMessage({ type: "xp:status" }));
  check("new handle detected", status2 && status2.handle === "otheracct", JSON.stringify(status2));
  check("old account's posts no longer hidden", await visible("#self-tweet-name"));
  check("new account's posts hidden", await hidden("#otheracct-name"));

  await ctx.close();
}

/* ---------- popup checks + screenshots ---------- */
async function testPopup(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => check(`popup: no page error: ${err.message}`, false));
  await page.addInitScript(() => {
    window.__XP_INITIAL_STORE__ = { enabled: true, hideSidebar: true, hideMenu: true, hidePosts: false };
  });
  await page.addInitScript({ path: P("test", "chrome-stub.js") });
  await page.goto("file://" + P("popup.html"));
  await settle(page, 300);

  section("Popup");
  check("master switch reflects storage", await page.isChecked("#enabled"));
  check("sidebar toggle on", await page.isChecked("#hideSidebar"));
  check("posts toggle off", !(await page.isChecked("#hidePosts")));
  check("'Hide' mode selected", await page.isChecked('input[name="mode"][value="hide"]'));
  check("hover row hidden in hide mode", !(await page.isVisible("#hoverRow")));
  check(
    "status shows masked handle",
    (await page.textContent("#statusText")).includes("@j•••••"),
    await page.textContent("#statusText"),
  );

  await page.click("#hidePosts");
  await settle(page, 100);
  check(
    "toggling posts writes to storage",
    (await page.evaluate(() => window.__xpStore().hidePosts)) === true,
  );

  await page.click('label.seg:has(input[value="blur"])');
  await settle(page, 150);
  check("choosing Blur writes mode", (await page.evaluate(() => window.__xpStore().mode)) === "blur");
  check("hover row appears in blur mode", await page.isVisible("#hoverRow"));

  await page.click("#toggleAll");
  await settle(page, 150);
  const st = await page.evaluate(() => window.__xpStore());
  check(
    "'Enable all' turns every feature on",
    ["hideSidebar", "hideMenu", "hidePosts", "hideProfile", "blurAvatar"].every((k) => st[k] === true),
  );
  check("button now offers reset", (await page.textContent("#toggleAll")).includes("Reset"));

  await page.evaluate(() => window.__xpSet({ enabled: false }));
  await settle(page, 150);
  check("external change (shortcut) updates pill", (await page.textContent("#statusPill")) === "Paused");
  await page.evaluate(() => window.__xpSet({ enabled: true }));
  await settle(page, 150);

  // Keyboard accessibility: space toggles a focused switch
  await page.focus("#hideProfile");
  await page.keyboard.press("Space");
  await settle(page, 100);
  check(
    "space toggles a focused switch",
    (await page.evaluate(() => window.__xpStore().hideProfile)) === false,
  );

  if (SHOTS) {
    await page.evaluate(() =>
      window.__xpSet({
        hideSidebar: true,
        hideMenu: true,
        hidePosts: true,
        hideProfile: false,
        blurAvatar: false,
        mode: "hide",
      }),
    );
    await settle(page, 200);
    const app = page.locator(".app");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.mouse.move(0, 0);
    await page.emulateMedia({ colorScheme: "dark" });
    await settle(page, 400); // let colour transitions finish
    await app.screenshot({ path: P("docs", "popup.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await settle(page, 400);
    await app.screenshot({ path: P("docs", "popup-light.png") });
    console.log("\n  screenshots → docs/popup.png, docs/popup-light.png");
  }

  await ctx.close();
}

const browser = await chromium.launch();
try {
  await testContent(browser);
  await testPopup(browser);
} finally {
  await browser.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

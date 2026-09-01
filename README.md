# X Sidebar Identity Hider

For a easy install just click here to add to chrome! https://chromewebstore.google.com/detail/x-privacy/hfailpkhbdhkmlgpogmdogdghfacjomm?authuser=0&hl=en

Chrome extension that hides **your display name and @username** in the bottom-left account switcher on [x.com](https://x.com). The profile picture stays so you can still open the account menu.

## Install (unpacked)

1. Unzip this folder if you downloaded the zip.
2. Open Chrome and go to `chrome://extensions/`
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `X-Privacy` folder.
6. Open or refresh `https://x.com`.

Click the extension icon to turn hiding on/off.

## What it hides

- Display name next to your avatar in the left nav
- `@username` under that name

It does **not** hide:

- Your avatar
- Your name on posts, profile pages, or replies
- Other people’s names

X is a single-page app and restyles often. If a layout change brings the text back, reload the tab. The extension watches the DOM and re-applies the hide.

## Files

- `manifest.json` — Manifest V3
- `content.js` — applies the hide + MutationObserver
- `styles.css` — CSS targeting `SideNav_AccountSwitcher_Button`
- `popup.html` / `popup.js` — on/off toggle
- `icons/` — toolbar icons

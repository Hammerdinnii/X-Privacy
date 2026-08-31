(() => {
  "use strict";

  const CLASS_NAME = "x-hide-sidebar-identity";
  const STORAGE_KEY = "enabled";

  function apply(enabled) {
    document.documentElement.classList.toggle(CLASS_NAME, enabled);
    hideSwitcherText(enabled);
  }

  function hideSwitcherText(enabled) {
    const buttons = document.querySelectorAll(
      '[data-testid="SideNav_AccountSwitcher_Button"]'
    );
    buttons.forEach((btn) => {
      const kids = Array.from(btn.children);
      kids.forEach((child, i) => {
        const isAvatar =
          child.querySelector("img, [data-testid^='UserAvatar']") &&
          !child.querySelector('[dir="ltr"] span');
        // First child is almost always the avatar. Hide everything else.
        if (i > 0 || (!isAvatar && kids.length > 1 && i === kids.length - 1)) {
          child.style.display = enabled ? "none" : "";
        }
      });
    });
  }

  function loadAndApply() {
    chrome.storage.sync.get({ [STORAGE_KEY]: true }, (res) => {
      apply(res[STORAGE_KEY] !== false);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      apply(changes[STORAGE_KEY].newValue !== false);
    }
  });

  loadAndApply();

  const observer = new MutationObserver(() => {
    if (document.documentElement.classList.contains(CLASS_NAME)) {
      hideSwitcherText(true);
    }
  });

  const startObserver = () => {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();

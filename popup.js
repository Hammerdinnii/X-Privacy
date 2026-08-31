const STORAGE_KEY = "enabled";
const toggle = document.getElementById("toggle");

chrome.storage.sync.get({ [STORAGE_KEY]: true }, (res) => {
  toggle.checked = res[STORAGE_KEY] !== false;
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEY]: toggle.checked });
});

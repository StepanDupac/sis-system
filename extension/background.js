import { inspectCuniPage, isCuniStudyUrl } from "./cuni/inspect.js";

// Timing and execution live in the visible extension tab, never in this worker.
chrome.action.onClicked.addListener((tab) => {
  const source = isCuniStudyUrl(tab.url) ? `?sisTab=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${source}`) });
});

let powerQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("app.html")) return;
  if (message?.type === "inspect-cuni") {
    (async () => {
      if (!Number.isInteger(message.tabId)) throw new Error("missing_tab");
      const tab = await chrome.tabs.get(message.tabId);
      if (!isCuniStudyUrl(tab.url)) return { status: "wrong_site" };
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectCuniPage });
      return results[0]?.result || { status: "unavailable" };
    })().then(reply).catch(() => reply({ status: "unavailable" }));
    return true;
  }
  if (!["wake", "release"].includes(message?.type)) return;
  powerQueue = powerQueue.catch(() => {}).then(async () => {
    if (message.type === "wake" && Number.isInteger(message.tabId)) {
      await chrome.storage.session.set({ awakeTab: message.tabId });
      chrome.power.requestKeepAwake("display");
    } else if (message.type === "release") {
      const { awakeTab } = await chrome.storage.session.get("awakeTab");
      if (awakeTab === message.tabId) {
        chrome.power.releaseKeepAwake();
        await chrome.storage.session.remove("awakeTab");
      }
    }
    reply({ ok: true });
  }).catch(() => reply({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  powerQueue = powerQueue.catch(() => {}).then(async () => {
    const { awakeTab } = await chrome.storage.session.get("awakeTab");
    if (awakeTab === tabId) {
      chrome.power.releaseKeepAwake();
      await chrome.storage.session.remove("awakeTab");
    }
  });
});

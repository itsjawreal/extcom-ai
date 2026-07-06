chrome.runtime.onInstalled.addListener(() => {
  console.info("Ekskomen AI Reply installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true });
  }
});

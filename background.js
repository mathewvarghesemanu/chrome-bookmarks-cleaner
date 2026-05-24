// Service worker: opens the side panel on toolbar click and brokers
// bookmark navigation in a dedicated review tab.

// Open the side panel when the toolbar icon is clicked.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Make the side panel available everywhere.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

// The side panel talks to us through messages. We keep the id of the tab
// being used for review so we can reuse it and report its current URL.
let reviewTabId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "openBookmark": {
        const tabId = await openInReviewTab(msg.url, msg.windowId);
        sendResponse({ ok: true, tabId });
        break;
      }
      case "getCurrentUrl": {
        const url = await getReviewTabUrl();
        sendResponse({ ok: true, url });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // keep the message channel open for the async response
});

async function openInReviewTab(url, windowId) {
  // Reuse the existing review tab if it is still around.
  if (reviewTabId !== null) {
    try {
      await chrome.tabs.get(reviewTabId);
      await chrome.tabs.update(reviewTabId, { url, active: true });
      return reviewTabId;
    } catch {
      reviewTabId = null; // tab was closed; fall through to create a new one
    }
  }
  const tab = await chrome.tabs.create({ url, windowId, active: true });
  reviewTabId = tab.id;
  return reviewTabId;
}

async function getReviewTabUrl() {
  if (reviewTabId === null) return null;
  try {
    const tab = await chrome.tabs.get(reviewTabId);
    return tab.pendingUrl || tab.url || null;
  } catch {
    reviewTabId = null;
    return null;
  }
}

// Forget the review tab once it closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === reviewTabId) reviewTabId = null;
});

/**
 * Coursera Assistant - Background Service Worker
 * Based on AutoCoursera-v1.3 with background reload and auto-quiz listeners
 */

// 1. Auto-quiz trigger when navigation lands on an attempt page
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (tab.url && changeInfo.status === 'complete' && tab.url.startsWith("https://www.coursera.org/learn")) {
    try {
      const urlpath = new URL(tab.url).pathname;
      if (urlpath.endsWith('attempt')) {
        chrome.tabs.sendMessage(tabId, 'attempt', function (response) {
          if (chrome.runtime.lastError) {
            console.log('Notice sending message to tab:', chrome.runtime.lastError.message);
          }
        });
      }
    } catch (_) {}
  }
});

// 2. On extension installed / reloaded, automatically reload open Coursera tabs so interceptor runs at document_start
chrome.runtime.onInstalled.addListener(function () {
  chrome.tabs.query({ url: "https://www.coursera.org/*" }, function (tabs) {
    if (tabs && tabs.length > 0) {
      tabs.forEach(function (tab) {
        if (tab.id) {
          chrome.tabs.reload(tab.id);
        }
      });
    }
  });
});

// 3. Gemini Proxy Fetch for CSP bypass (used by Coach Dialogue)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "GEMINI_PROXY_FETCH") {
    (async () => {
      try {
        const { url, options } = request.payload || {};
        const response = await fetch(url, options);
        const data = await response.json();
        sendResponse({ success: response.ok, status: response.status, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message || "Proxy fetch failed" });
      }
    })();
    return true; // Keep channel open for async response
  }
});

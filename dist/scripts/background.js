chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (tab.url && changeInfo.status === 'complete' && tab.url.startsWith("https://www.coursera.org/learn")) {
        const urlpath = new URL(tab.url).pathname;
        if (urlpath.endsWith('attempt')) {
            chrome.tabs.sendMessage(tabId,'attempt',function (response) {
                if (chrome.runtime.lastError) {
                    console.log('Error sending message to tab:', chrome.runtime.lastError.message);
                }
            });
        }
    }
});


chrome.runtime.onInstalled.addListener(function () {
    chrome.tabs.query({ url: "https://www.coursera.org/*" }, function (tabs) {
        tabs.forEach(function (tab) {
            chrome.tabs.reload(tab.id);
        });
    });
});

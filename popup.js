document.getElementById("toggleFeature").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "toggleFeature" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("Content script가 로드되지 않음");
                } else {
                    console.log("메시지 전송 완료:", response);
                }
            });
        }
    });
});

document.getElementById("openRecords").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("records.html") });
});
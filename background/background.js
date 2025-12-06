// background.js - service worker for the extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('Hackathon Starter Extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked on tab:', tab.id);
  alert("hello");
});


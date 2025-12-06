# Hackathon Chrome Extension Starter

A minimal Chrome Extension template using Manifest V3.

## Structure

- `manifest.json` – core extension configuration
- `background/background.js` – service worker background script
- `content/content.js` – content script injected into pages
- `popup/` – popup UI (HTML/CSS/JS) opened from the toolbar icon
- `options/` – options page for simple settings (stored via `chrome.storage.sync`)
- `icons/` – placeholder icons (add your own PNGs here)

## How to Load in Chrome

1. Run Chrome.
2. Go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select this folder: `hackathon` (the one containing `manifest.json`).

You should now see **Hackathon Starter Extension** in the extensions list.

## Try It

- Click the extension icon to open the popup.
- Click **Ping Content Script** and check the DevTools console of the active tab.
- Open the options page from the extension card on `chrome://extensions/`, change the highlight color, and reload a page to see the content script flash it briefly.

## Next Steps

- Replace the icons in `icons/` with your branding.
- Update `manifest.json` name, description, and permissions as needed.
- Extend `popup.js`, `background.js`, and `content.js` with your actual logic.

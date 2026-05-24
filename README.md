# Bookmarks Cleaner

A Chrome extension that walks you through your bookmarks one at a time in a
side panel, so you can **Keep** or **Reject** each one. All actions are keyed
on the bookmark's ID, not the tab URL — so navigating away from a bookmarked
page never changes what Keep/Reject acts on.

## Features

- **Side panel** that stays open across page navigations.
- Pick a folder (or *All bookmarks*) to review; shows how many are queued.
- For each bookmark, shows the **original bookmarked URL** and the **live tab URL**.
- If they differ, shows a warning plus:
  - **Go back to bookmarked page** — re-navigates the tab to the original URL.
  - **Update bookmark to current page** — points the bookmark at where you are now.
- **Keep** leaves the bookmark; **Reject** deletes it by ID.
- **Skip** to defer, **Stop** to end early. Summary at the end.
- **Delete empty folders** — one-click cleanup of folders whose entire subtree
  contains no bookmarks (with a confirmation listing them first).
- **All-time stats** (kept / deleted) and a count of bookmarks marked for
  "later", persisted across sessions in `chrome.storage.local`.
- **Reset** — clears the stats and the "later" list after a confirmation.
  Only marks and counters are cleared; no bookmarks are deleted.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the extension's toolbar icon to open the side panel.

## Files

- `manifest.json` — MV3 manifest (permissions: bookmarks, sidePanel, tabs, storage).
- `background.js` — opens the side panel and manages the dedicated review tab.
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js` — the review UI and logic.
- `icons/` — toolbar icons.

// Side panel logic. Everything is keyed on the bookmark ID, never on the
// tab URL, so navigating away from a bookmarked page never changes what
// Keep/Reject acts on.

const els = {
  setup: document.getElementById("setup"),
  review: document.getElementById("review"),
  done: document.getElementById("done"),
  folderSelect: document.getElementById("folderSelect"),
  setupCount: document.getElementById("setupCount"),
  startBtn: document.getElementById("startBtn"),
  emptyCount: document.getElementById("emptyCount"),
  cleanFoldersBtn: document.getElementById("cleanFoldersBtn"),
  statsLine: document.getElementById("statsLine"),
  resetBtn: document.getElementById("resetBtn"),
  progress: document.getElementById("progress"),
  bmTitle: document.getElementById("bmTitle"),
  bmUrl: document.getElementById("bmUrl"),
  currentUrl: document.getElementById("currentUrl"),
  navWarning: document.getElementById("navWarning"),
  navActions: document.getElementById("navActions"),
  goBackBtn: document.getElementById("goBackBtn"),
  updateBtn: document.getElementById("updateBtn"),
  keepBtn: document.getElementById("keepBtn"),
  rejectBtn: document.getElementById("rejectBtn"),
  skipBtn: document.getElementById("skipBtn"),
  stopBtn: document.getElementById("stopBtn"),
  summary: document.getElementById("summary"),
  restartBtn: document.getElementById("restartBtn"),
};

// Review session state.
let queue = []; // [{ id, title, url }]
let index = 0;
let kept = 0;
let rejected = 0;
let skipped = []; // bookmarks deferred to a second pass
let urlPollTimer = null;
let windowId = null;

// Persisted across sessions in chrome.storage.local.
//   stats: cumulative { kept, deleted } totals
//   later: bookmark IDs the user skipped ("visit later")
let stats = { kept: 0, deleted: 0 };
let later = [];

init();

async function init() {
  const win = await chrome.windows.getCurrent();
  windowId = win.id;
  await loadState();
  await populateFolders();
  wireEvents();
}

// --- Persistence -----------------------------------------------------------

async function loadState() {
  const data = await chrome.storage.local.get(["stats", "later"]);
  stats = data.stats || { kept: 0, deleted: 0 };
  later = data.later || [];
}

async function saveState() {
  await chrome.storage.local.set({ stats, later });
}

// Record a decision and drop the bookmark from the "later" list if present.
async function recordDecision(bookmarkId, kind) {
  if (kind === "kept") stats.kept++;
  else if (kind === "deleted") stats.deleted++;
  later = later.filter((id) => id !== bookmarkId);
  await saveState();
}

function updateStatsDisplay() {
  els.statsLine.textContent =
    `All-time: kept ${stats.kept}, deleted ${stats.deleted}. ` +
    `${later.length} marked for later.`;
  els.resetBtn.disabled =
    stats.kept === 0 && stats.deleted === 0 && later.length === 0;
}

// --- Setup -----------------------------------------------------------------

// Walk the bookmark tree, collecting folders and their bookmark counts.
async function populateFolders() {
  const tree = await chrome.bookmarks.getTree();
  const folders = []; // { id, label, count }

  function countBookmarks(node) {
    let n = 0;
    for (const child of node.children || []) {
      if (child.url) n++;
      else n += countBookmarks(child);
    }
    return n;
  }

  function walk(node, depth) {
    for (const child of node.children || []) {
      if (!child.url) {
        // It's a folder.
        const count = countBookmarks(child);
        folders.push({
          id: child.id,
          label: `${"  ".repeat(depth)}${child.title || "(unnamed)"} (${count})`,
          count,
        });
        walk(child, depth + 1);
      }
    }
  }

  for (const root of tree) walk(root, 0);

  els.folderSelect.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "__all__";
  const allCount = await countAll();
  allOpt.textContent = `All bookmarks (${allCount})`;
  els.folderSelect.appendChild(allOpt);

  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    els.folderSelect.appendChild(opt);
  }

  updateSetupCount();
  updateEmptyCount();
  updateStatsDisplay();
}

// --- Empty-folder cleanup --------------------------------------------------

// Find the top-most empty folders: a folder whose entire subtree contains no
// bookmarks, and whose parent is NOT itself empty (so deleting it via
// removeTree also clears any empty subfolders, with no double-deletes).
async function findEmptyFolders() {
  const tree = await chrome.bookmarks.getTree();

  function hasBookmarks(node) {
    for (const child of node.children || []) {
      if (child.url) return true;
      if (hasBookmarks(child)) return true;
    }
    return false;
  }

  const empties = [];
  function walk(node) {
    for (const child of node.children || []) {
      if (child.url) continue; // a bookmark, not a folder
      const empty = !hasBookmarks(child);
      // parentId "0" are the unremovable root folders; skip those as parents
      // but their empty children are still removable.
      if (empty && child.parentId !== "0") {
        empties.push(child); // top-most empty folder; don't descend
      } else {
        walk(child); // search deeper for empty folders
      }
    }
  }
  for (const root of tree) walk(root);
  return empties;
}

async function updateEmptyCount() {
  const empties = await findEmptyFolders();
  els.cleanFoldersBtn.disabled = empties.length === 0;
  els.emptyCount.textContent =
    empties.length === 0
      ? "No empty folders found."
      : `${empties.length} empty folder${empties.length === 1 ? "" : "s"} found.`;
}

async function cleanEmptyFolders() {
  const empties = await findEmptyFolders();
  if (empties.length === 0) return;

  const names = empties.map((f) => f.title || "(unnamed)").join(", ");
  const ok = confirm(
    `Delete ${empties.length} empty folder${empties.length === 1 ? "" : "s"}?\n\n${names}`
  );
  if (!ok) return;

  let removed = 0;
  for (const folder of empties) {
    try {
      await chrome.bookmarks.removeTree(folder.id);
      removed++;
    } catch (err) {
      console.error("Failed to remove folder", folder.id, err);
    }
  }

  // Re-scan to refresh the button state, then show the result message.
  const remaining = await findEmptyFolders();
  els.cleanFoldersBtn.disabled = remaining.length === 0;
  els.emptyCount.textContent = `Deleted ${removed} empty folder${removed === 1 ? "" : "s"}.`;
}

// --- Reset -----------------------------------------------------------------

// Zero the cumulative stats and clear the "later" list. Bookmarks are NOT
// deleted — only the marks and counters are cleared.
async function resetStats() {
  const ok = confirm(
    "Reset all statistics and clear the “visit later” list?\n\n" +
      "This only clears counters and marks — no bookmarks will be deleted."
  );
  if (!ok) return;

  stats = { kept: 0, deleted: 0 };
  later = [];
  await saveState();
  updateStatsDisplay();
}

async function countAll() {
  const all = await collectBookmarks("__all__");
  return all.length;
}

// Collect the flat list of bookmarks to review for a given folder id.
async function collectBookmarks(folderId) {
  const out = [];
  function gather(node) {
    for (const child of node.children || []) {
      if (child.url) out.push({ id: child.id, title: child.title, url: child.url });
      else gather(child);
    }
  }

  if (folderId === "__all__") {
    const tree = await chrome.bookmarks.getTree();
    for (const root of tree) gather(root);
  } else {
    const [subtree] = await chrome.bookmarks.getSubTree(folderId);
    gather(subtree);
  }
  return out;
}

async function updateSetupCount() {
  const list = await collectBookmarks(els.folderSelect.value);
  if (list.length === 0) {
    els.setupCount.textContent = "This folder has no bookmarks to review.";
    els.startBtn.disabled = true;
  } else {
    els.setupCount.textContent = `${list.length} bookmark${list.length === 1 ? "" : "s"} to review.`;
    els.startBtn.disabled = false;
  }
}

// --- Events ----------------------------------------------------------------

function wireEvents() {
  els.folderSelect.addEventListener("change", updateSetupCount);
  els.startBtn.addEventListener("click", startReview);
  els.cleanFoldersBtn.addEventListener("click", cleanEmptyFolders);
  els.resetBtn.addEventListener("click", resetStats);
  els.keepBtn.addEventListener("click", keepCurrent);
  els.rejectBtn.addEventListener("click", rejectCurrent);
  els.skipBtn.addEventListener("click", skipCurrent);
  els.stopBtn.addEventListener("click", stopReview);
  els.goBackBtn.addEventListener("click", goBackToBookmark);
  els.updateBtn.addEventListener("click", updateBookmarkToCurrent);
  els.restartBtn.addEventListener("click", showSetup);
  els.bmUrl.addEventListener("click", (e) => e.preventDefault());
}

// --- Review flow -----------------------------------------------------------

async function startReview() {
  queue = await collectBookmarks(els.folderSelect.value);
  index = 0;
  kept = 0;
  rejected = 0;
  skipped = [];

  if (queue.length === 0) {
    els.setupCount.textContent = "Nothing to review in this folder.";
    return;
  }

  show("review");
  await openCurrent();
  startUrlPolling();
}

async function openCurrent() {
  const bm = queue[index];
  els.progress.textContent = `Bookmark ${index + 1} of ${queue.length}`;
  els.bmTitle.textContent = bm.title || "(untitled)";
  els.bmUrl.textContent = bm.url;
  els.bmUrl.href = bm.url;
  els.currentUrl.textContent = "Loading…";
  els.navWarning.hidden = true;
  els.navActions.hidden = true;

  await chrome.runtime.sendMessage({ type: "openBookmark", url: bm.url, windowId });
}

// Keep = leave the bookmark alone, move on.
async function keepCurrent() {
  const bm = queue[index];
  kept++;
  await recordDecision(bm.id, "kept");
  advance();
}

// Reject = delete the bookmark by ID (not the current tab URL).
async function rejectCurrent() {
  const bm = queue[index];
  try {
    await chrome.bookmarks.remove(bm.id);
    rejected++;
    await recordDecision(bm.id, "deleted");
  } catch (err) {
    console.error("Failed to delete bookmark", bm.id, err);
  }
  advance();
}

// Skip = undecided. Defer to a second pass and remember it for "later".
async function skipCurrent() {
  const bm = queue[index];
  skipped.push(bm);
  if (!later.includes(bm.id)) {
    later.push(bm.id);
    await saveState();
  }
  advance();
}

function advance() {
  index++;
  if (index >= queue.length) {
    if (skipped.length > 0) {
      // Roll the deferred bookmarks into a fresh pass.
      queue = skipped;
      skipped = [];
      index = 0;
      openCurrent();
    } else {
      finish();
    }
  } else {
    openCurrent();
  }
}

async function goBackToBookmark() {
  const bm = queue[index];
  await chrome.runtime.sendMessage({ type: "openBookmark", url: bm.url, windowId });
}

async function updateBookmarkToCurrent() {
  const bm = queue[index];
  const { url } = await chrome.runtime.sendMessage({ type: "getCurrentUrl" });
  if (!url) return;
  try {
    await chrome.bookmarks.update(bm.id, { url });
    bm.url = url; // reflect locally
    els.bmUrl.textContent = url;
    els.bmUrl.href = url;
    refreshNavState(url);
  } catch (err) {
    console.error("Failed to update bookmark", bm.id, err);
  }
}

function stopReview() {
  stopUrlPolling();
  showSetup();
}

function finish() {
  stopUrlPolling();
  els.summary.textContent = `Kept ${kept}, deleted ${rejected} — ${kept + rejected} reviewed.`;
  show("done");
}

async function showSetup() {
  stopUrlPolling();
  await populateFolders();
  show("setup");
}

// --- Current-URL tracking --------------------------------------------------

function startUrlPolling() {
  stopUrlPolling();
  urlPollTimer = setInterval(refreshCurrentUrl, 1000);
  refreshCurrentUrl();
}

function stopUrlPolling() {
  if (urlPollTimer) clearInterval(urlPollTimer);
  urlPollTimer = null;
}

async function refreshCurrentUrl() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getCurrentUrl" });
    const url = res && res.url;
    els.currentUrl.textContent = url || "(no review tab open)";
    refreshNavState(url);
  } catch {
    // Background may be momentarily unavailable; ignore.
  }
}

// Show the warning + nav actions only when the live tab URL differs from
// the bookmarked URL (ignoring trailing-slash / hash noise).
function refreshNavState(currentUrl) {
  const bm = queue[index];
  if (!bm || !currentUrl) {
    els.navWarning.hidden = true;
    els.navActions.hidden = true;
    return;
  }
  const differs = normalize(currentUrl) !== normalize(bm.url);
  els.navWarning.hidden = !differs;
  els.navActions.hidden = !differs;
}

function normalize(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

// --- View switching --------------------------------------------------------

function show(view) {
  els.setup.hidden = view !== "setup";
  els.review.hidden = view !== "review";
  els.done.hidden = view !== "done";
}

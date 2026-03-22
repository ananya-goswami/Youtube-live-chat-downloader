const TAG = "Silver_1.0";
const log = (...a) => console.log(`✅ ${TAG}:`, ...a);
const warn = (...a) => console.warn(`⚠️ ${TAG}:`, ...a);
const err = (...a) => console.error(`❌ ${TAG}:`, ...a);

log("service worker starting");

// ---------- context menu (must be resilient to SW restarts) ----------
async function ensureContextMenu() {
  try {
    // Remove then add to avoid duplicates and ensure it exists after restarts
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: "SILVER_DOWNLOAD_CSV",
      title: "Silver_1.0: Download chat CSV for this video",
      contexts: ["page"],
    });
    log("context menu ensured");
  } catch (e) {
    err("ensureContextMenu failed", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
});

// Runs when Chrome starts (and when extension wakes after restart)
chrome.runtime.onStartup?.addListener(() => {
  ensureContextMenu();
});

// Also call immediately on SW load (covers normal wake-ups)
ensureContextMenu();

// ---------- CSV helpers ----------
function csvCell(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function toIST(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

function getVideoIdFromPageUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return u.searchParams.get("v") || u.searchParams.get("video_id") || null;
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  return String(name || "Untitled")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "Untitled";
}

function downloadCsv(filename, csvText) {
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvText);

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      err("download failed", chrome.runtime.lastError.message);
    } else {
      log("download started", { downloadId, filename });
    }
  });
}

// ---------- title cache + fetch ----------
async function getCachedTitle(videoId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["silverVideoTitleByVideo"], (res) => {
      const map = res.silverVideoTitleByVideo || {};
      resolve(map[videoId] || "");
    });
  });
}

async function setCachedTitle(videoId, title) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["silverVideoTitleByVideo"], (res) => {
      const map = res.silverVideoTitleByVideo || {};
      map[videoId] = title || "";
      chrome.storage.local.set({ silverVideoTitleByVideo: map }, resolve);
    });
  });
}

async function fetchVideoTitleFromYouTube(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const resp = await fetch(url, { credentials: "omit" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const m1 = html.match(/<title>([^<]{1,300})<\/title>/i);
    if (m1 && m1[1]) {
      return m1[1].replace(/\s*-\s*YouTube\s*$/i, "").trim();
    }

    const m2 = html.match(/"title"\s*:\s*"([^"]{1,200})"/i);
    if (m2 && m2[1]) {
      return m2[1]
        .replace(/\\"/g, '"')
        .replace(/\\u0026/g, "&")
        .replace(/\\n/g, " ")
        .trim();
    }

    return "";
  } catch (e) {
    warn("failed to fetch video title", { videoId, error: String(e) });
    return "";
  }
}

async function getBestVideoTitle(videoId) {
  let title = await getCachedTitle(videoId);
  if (title) return title;

  title = await fetchVideoTitleFromYouTube(videoId);
  if (title) {
    await setCachedTitle(videoId, title);
    return title;
  }
  return "";
}

// ---------- export ----------
async function exportVideoCsv(videoId) {
  chrome.storage.local.get(["savedChatsByVideo"], async (res) => {
    const all = res.savedChatsByVideo || {};
    const chats = all[videoId] || [];

    log("export requested", { videoId, count: chats.length });

    if (!chats.length) {
      warn("no chats saved yet for this video (wait 10–20 seconds, then try again)");
      return;
    }

    // Sort chronological
    chats.sort((a, b) => Date.parse(a.actualISO) - Date.parse(b.actualISO));

    let csv = "Real Time (IST),Author,Message\n";
    for (const c of chats) {
      csv += [csvCell(toIST(c.actualISO)), csvCell(c.author), csvCell(c.message)].join(",") + "\n";
    }

    const title = await getBestVideoTitle(videoId);
    const safeTitle = sanitizeFilename(title);
    const filename =
      safeTitle && safeTitle !== "Untitled"
        ? `Silver_1.0_${safeTitle}.csv`
        : `Silver_1.0_${videoId}.csv`;

    downloadCsv(filename, csv);

    // clear only this video's saved chats
    delete all[videoId];
    chrome.storage.local.set({ savedChatsByVideo: all }, () => {
      log("cleared saved chats for video after export", { videoId });
    });
  });
}

// ✅ Register click handler (works even after SW wakes up)
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== "SILVER_DOWNLOAD_CSV") return;

  const pageUrl = info.pageUrl || "";
  const videoId = getVideoIdFromPageUrl(pageUrl);

  log("menu clicked", { pageUrl, videoId });

  if (!videoId) {
    warn("no videoId found. Open a YouTube watch page like /watch?v=XXXX and try again.");
    return;
  }

  exportVideoCsv(videoId);
});
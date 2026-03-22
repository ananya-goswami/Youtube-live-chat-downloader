console.log("✅ Silver_1.0: service worker running");

// Create right-click menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "DOWNLOAD_CHAT_CSV",
    title: "Download Silver_1.0 CSV (this video)",
    contexts: ["page"]
  });
});

// ---------- Helpers ----------
function getVideoIdFromTab(tab) {
  try {
    const u = new URL(tab.url);
    return u.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function toISTReadable(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

// ✅ Reliable download method for MV3 (data URL)
function downloadTextAsCsv(filename, csvText) {
  const base64 = btoa(unescape(encodeURIComponent(csvText)));
  const url = `data:text/csv;charset=utf-8;base64,${base64}`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.log("❌ Download failed:", chrome.runtime.lastError.message);
      } else {
        console.log("✅ Download started. ID:", downloadId);
      }
    }
  );
}

// ---------- Download CSV for current tab video ----------
function downloadCsvForVideo(videoId) {
  chrome.storage.local.get(["savedChatsByVideo"], (res) => {
    const all = res.savedChatsByVideo || {};
    const chats = all[videoId] || [];

    console.log("📦 Chats found for video:", videoId, "count:", chats.length);

    if (!chats.length) {
      console.log("⚠️ No chats saved yet for this video. Wait 10–20 seconds, then try again.");
      return;
    }

    // ✅ ONLY 3 columns (as you requested)
    let csv = "Real Time (IST),Author,Message\n";

    chats.forEach((c) => {
      const realISO = c.actualTime || c.capturedAt || "";

      const row = [
        csvEscape(toISTReadable(realISO)),
        csvEscape(c.author),
        csvEscape(c.message)
      ].join(",");

      csv += row + "\n";
    });

    // ✅ One CSV per video
    const filename = `Silver_1.0_${videoId}.csv`;
    downloadTextAsCsv(filename, csv);

    // ✅ Clear saved chats for THIS video after download (fresh next time)
    delete all[videoId];
    chrome.storage.local.set({ savedChatsByVideo: all }, () => {
      console.log("🧹 Cleared saved chats for video:", videoId);
    });
  });
}

// Right-click menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "DOWNLOAD_CHAT_CSV") return;

  const videoId = getVideoIdFromTab(tab);

  console.log("🖱️ Menu clicked. Tab URL:", tab?.url);
  console.log("🎬 Extracted videoId:", videoId);

  if (!videoId) {
    console.log("⚠️ No videoId found. Open a YouTube watch page like /watch?v=XXXX");
    return;
  }

  downloadCsvForVideo(videoId);
});

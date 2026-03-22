console.log("✅ YT Chat Saver: content script active");

// -------------------- helpers --------------------
function getVideoId() {
  const url = new URL(window.top.location.href);
  return url.searchParams.get("v") || "unknown_video";
}

// convert "0:51" or "18:03:11" to seconds
function timeToSeconds(t) {
  if (!t) return null;
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Ask service worker to fetch + store startTimestamp for this video
(function ensureStartTimeSaved() {
  const videoId = getVideoId();
  chrome.runtime.sendMessage({ type: "GET_LIVE_START", videoId }, (resp) => {
    console.log("🕒 Live start fetch response:", resp);
  });
})();

// -------------------- main watcher --------------------
setTimeout(() => {
  console.log("⏳ Looking for chat messages...");

  const observer = new MutationObserver(() => {
    const messages = document.querySelectorAll("yt-live-chat-text-message-renderer");
    if (messages.length === 0) return;

    const last = messages[messages.length - 1];

    const author = last.querySelector("#author-name")?.innerText?.trim() || "";
    const message = last.querySelector("#message")?.innerText?.trim() || "";
    if (!author || !message) return;

    const offsetTime =
      last.querySelector("#timestamp")?.innerText?.trim() ||
      last.querySelector("yt-live-chat-timestamp")?.innerText?.trim() ||
      "";

    const offsetSeconds = timeToSeconds(offsetTime);

    // Get saved start time (from service worker) and compute actualTime
    chrome.storage.local.get(["streamStartByVideo", "savedChatsByVideo"], (res) => {
      const starts = res.streamStartByVideo || {};
      const allChats = res.savedChatsByVideo || {};

      const videoId = getVideoId();
      const startISO = starts[videoId] || "";

      let actualTimeISO = "";
      if (startISO && offsetSeconds !== null) {
        const startDate = new Date(startISO);
        actualTimeISO = new Date(startDate.getTime() + offsetSeconds * 1000).toISOString();
      }

      const chatData = {
        author,
        message,
        offsetTime,                      // YouTube shows this (like 0:51 or 18:03:11)
        actualTime: actualTimeISO,       // REAL time if startISO is found
        capturedAt: new Date().toISOString() // backup time (always present)
      };

      // Per-video array
      const existing = allChats[videoId] || [];

      // Deduplicate
      const lastSaved = existing[existing.length - 1];
      const isDuplicate =
        lastSaved &&
        lastSaved.author === chatData.author &&
        lastSaved.message === chatData.message &&
        lastSaved.offsetTime === chatData.offsetTime;

      if (!isDuplicate) {
        existing.push(chatData);
        allChats[videoId] = existing;

        chrome.storage.local.set({ savedChatsByVideo: allChats }, () => {
          console.log("💬 Saved:", chatData);
        });
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("👀 Tracking chat (live + replay) per-video...");
}, 4000);

(() => {
  const TAG = "Silver_1.0";
  const log = (...a) => console.log(`✅ ${TAG}:`, ...a);
  const warn = (...a) => console.warn(`⚠️ ${TAG}:`, ...a);
  const err = (...a) => console.error(`❌ ${TAG}:`, ...a);

  log("contentScript running", { url: location.href, isTop: window === window.top });

  // ---------- helpers ----------
  function getVideoIdFromUrl(urlString) {
    try {
      const u = new URL(urlString);
      return u.searchParams.get("v") || u.searchParams.get("video_id") || null;
    } catch {
      return null;
    }
  }

  function getCurrentVideoId() {
    return (
      getVideoIdFromUrl(location.href) ||
      getVideoIdFromUrl(window.top?.location?.href || "") ||
      null
    );
  }

  function looksLikeOffsetTime(text) {
    if (!text) return false;
    const t = text.trim();
    if (/am|pm/i.test(t)) return false;
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
  }

  function looksLikeClockTime(text) {
    if (!text) return false;
    return /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(text.trim());
  }

  function offsetToSeconds(text) {
    if (!text) return null;
    const parts = text.trim().split(":").map(Number);
    if (parts.some(Number.isNaN)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  function clockTimeOnStreamDateToIso(clockText, streamStartIso) {
    try {
      const m = clockText.trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
      if (!m) return null;

      let hh = Number(m[1]);
      const mm = Number(m[2]);
      const ap = m[3].toUpperCase();

      if (ap === "AM") {
        if (hh === 12) hh = 0;
      } else {
        if (hh !== 12) hh += 12;
      }

      const start = new Date(streamStartIso);
      if (Number.isNaN(start.getTime())) return null;

      const d = new Date(start);
      d.setHours(hh, mm, 0, 0);

      // handle midnight crossover
      if (d.getTime() < start.getTime()) {
        d.setDate(d.getDate() + 1);
      }

      return d.toISOString();
    } catch {
      return null;
    }
  }

  async function getStreamStartIso(videoId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["silverStreamStartByVideo"], (res) => {
        const map = res.silverStreamStartByVideo || {};
        resolve(map[videoId] || "");
      });
    });
  }

  async function saveStreamStartIso(videoId, startIso) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["silverStreamStartByVideo"], (res) => {
        const map = res.silverStreamStartByVideo || {};
        map[videoId] = startIso;
        chrome.storage.local.set({ silverStreamStartByVideo: map }, resolve);
      });
    });
  }

  async function appendChat(videoId, row) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["savedChatsByVideo"], (res) => {
        const all = res.savedChatsByVideo || {};
        const list = all[videoId] || [];

        const last = list[list.length - 1];
        const isDup =
          last &&
          last.author === row.author &&
          last.message === row.message &&
          last.actualISO === row.actualISO;

        if (!isDup) {
          list.push(row);
          all[videoId] = list;
          chrome.storage.local.set({ savedChatsByVideo: all }, () => resolve(true));
        } else {
          resolve(false);
        }
      });
    });
  }

  // ---------- inject pageScript on /watch ----------
  function injectPageScript() {
    const src = chrome.runtime.getURL("pageScript.js");
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => {
      s.remove();
      log("pageScript.js injected");
    };
    s.onerror = () => err("Failed to inject pageScript.js");
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "SILVER_STREAM_META") return;

    const { videoId, startTimestamp } = event.data;
    if (!videoId) return;

    log("received stream meta", { videoId, startTimestamp });

    if (startTimestamp) {
      await saveStreamStartIso(videoId, startTimestamp);
      log("stored startTimestamp for video", videoId);
    } else {
      warn("startTimestamp missing", videoId);
    }
  });

  if (location.pathname === "/watch") injectPageScript();

  // ---------- chat capture ----------
  function isChatPage() {
    return (
      location.pathname.startsWith("/live_chat") ||
      location.pathname.startsWith("/live_chat_replay") ||
      !!document.querySelector("yt-live-chat-item-list-renderer")
    );
  }

  async function startChatObserver() {
    if (!isChatPage()) return;

    const videoId = getCurrentVideoId() || "unknown_video";
    let streamStartIso =
      videoId !== "unknown_video" ? await getStreamStartIso(videoId) : "";

    log("chat observer starting", { videoId, streamStartIso });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.silverStreamStartByVideo) return;

      const newMap = changes.silverStreamStartByVideo.newValue || {};
      const newIso = newMap[videoId];
      if (newIso && newIso !== streamStartIso) {
        streamStartIso = newIso;
        log("updated streamStartIso", { videoId, streamStartIso });
      }
    });

    const processRenderer = async (renderer) => {
      const author =
        renderer.querySelector("#author-name")?.innerText?.trim() || "";
      const message =
        renderer.querySelector("#message")?.innerText?.trim() || "";
      const timeText =
        renderer.querySelector("#timestamp")?.innerText?.trim() ||
        renderer.querySelector("yt-live-chat-timestamp")?.innerText?.trim() ||
        "";

      if (!author || !message) return;

      let actualISO = new Date().toISOString();

      if (streamStartIso && looksLikeOffsetTime(timeText)) {
        const offsetSec = offsetToSeconds(timeText);
        const startMs = Date.parse(streamStartIso);
        if (offsetSec !== null && !Number.isNaN(startMs)) {
          actualISO = new Date(startMs + offsetSec * 1000).toISOString();
        }
      } else if (streamStartIso && looksLikeClockTime(timeText)) {
        const iso = clockTimeOnStreamDateToIso(timeText, streamStartIso);
        if (iso) actualISO = iso;
      }

      const row = { actualISO, author, message };
      const saved = await appendChat(videoId, row);

      if (saved)
        console.log(`💬 ${TAG}: saved`, {
          videoId,
          timeText,
          actualISO
        });
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;

          if (node.matches?.("yt-live-chat-text-message-renderer")) {
            processRenderer(node);
          } else {
            const found =
              node.querySelectorAll?.(
                "yt-live-chat-text-message-renderer"
              );
            if (found?.length) found.forEach(processRenderer);
          }
        }
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    log("chat observer active");
  }

  startChatObserver().catch((e) =>
    err("chat observer crashed", e)
  );
})();
(() => {
  const TAG = "Silver_1.0";
  const log = (...a) => console.log(`✅ ${TAG}: pageScript`, ...a);

  if (location.pathname !== "/watch") return;

  function getVideoId() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get("v") || null;
    } catch {
      return null;
    }
  }

  function readStartTimestamp() {
    try {
      const details =
        window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
      return details?.startTimestamp || "";
    } catch {
      return "";
    }
  }

  const videoId = getVideoId();
  if (!videoId) return;

  // Poll a bit because ytInitialPlayerResponse may appear after page load
  let tries = 0;
  const maxTries = 50; // 50 * 100ms = 5 seconds

  const timer = setInterval(() => {
    tries++;
    const startTimestamp = readStartTimestamp();

    if (startTimestamp || tries >= maxTries) {
      clearInterval(timer);

      log("stream meta extracted", { videoId, startTimestamp, tries });

      window.postMessage(
        { type: "SILVER_STREAM_META", videoId, startTimestamp },
        "*"
      );
    }
  }, 100);
})();
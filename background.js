/**
 * Coursera Automation Extension - Background Service Worker (background.js)
 * 
 * Handles extension lifecycle events, options page triggers,
 * tab navigation tracking (urlChanged messages), and keyboard shortcuts.
 */
(() => {
  'use strict';

  // -------------------------------------------------------------
  // Lifecycle Event Handlers
  // -------------------------------------------------------------
  chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "update") {
      chrome.runtime.onUpdateAvailable?.addListener(function (updateInfo) {
        console.log("Updating extension to version " + updateInfo.version);
        chrome.runtime.reload();
      });
    }
  });

  // -------------------------------------------------------------
  // Skip Video+ Engine Helper Functions
  // -------------------------------------------------------------
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const COURSERA_API_BASE = "https://www.coursera.org/api";

  /**
   * Dispatches toast notification to the active Coursera tab
   */
  async function showToastInTab(tabId, message, type = "info", keep = false) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "SHOW_TOAST",
        payload: { message, type, keep }
      }, () => {
        // Suppress lastError if tab closed or reloaded
        chrome.runtime.lastError;
      });
    }
  }

  /**
   * Dispatches lecture video event (play or ended) with retry and completion verification
   */
  async function postVideoEvent(userId, item, eventName = "play", maxRetries = 5, retryDelay = 8000) {
    const url = `${COURSERA_API_BASE}/opencourse.v1/user/${userId}/course/${item.open_course_slug}/item/${item.item_id}/lecture/videoEvents/${eventName}?autoEnroll=false`;
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({ contentRequestBody: {} });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: headers,
          credentials: "include",
          body: body
        });

        const data = await res.json().catch(() => ({}));

        if (eventName === "play" && res.ok) {
          return true;
        }

        const progressState = data?.itemProgress?.progressState;
        if (res.ok && progressState === "Completed") {
          return true;
        }

        if (eventName === "ended" && (res.status === 400 || progressState === "Started") && attempt < maxRetries) {
          await sleep(retryDelay);
          continue;
        }

        return false;
      } catch (err) {
        if (eventName !== "ended" || attempt >= maxRetries) {
          return false;
        }
        await sleep(retryDelay);
      }
    }
    return false;
  }

  /**
   * Creates the required server-side video progress record via PUT onDemandVideoProgresses.v1
   */
  async function putVideoProgress(userId, courseId, videoId, timeCommitment) {
    if (!videoId) return;
    const viewedUpTo = Math.floor(timeCommitment || 0);
    const videoProgressId = `${userId}~${courseId}~${videoId}`;
    const url = `${COURSERA_API_BASE}/onDemandVideoProgresses.v1/${videoProgressId}`;

    try {
      const payload = {
        viewedUpTo: viewedUpTo,
        videoProgressId: videoProgressId
      };
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("[Skip Video+] Failed to PUT video progress:", err);
    }
  }

  // -------------------------------------------------------------
  // Quiz Progress State Management (In-Memory Relay Only — No Window Clutter)
  // -------------------------------------------------------------
  let latestQuizProgress = null;

  // -------------------------------------------------------------
  // Message Listener for Extension Actions
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "OPEN_OPTIONS") {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "OPEN_POPUP") {
      chrome.action.openPopup?.().catch(() => { });
      sendResponse({ success: true });
      return true;
    }

    // Skip Video+ Master Engine
    if (request.action === "SKIP_VIDEO_PLUS") {
      (async () => {
        const userId = request.payload?.userId;
        const items = request.payload?.items || [];
        const tabId = sender?.tab?.id;

        try {
          // Phase 1: Optimistic probe pass (ended event directly)
          const probeResults = await Promise.all(items.map(async item => {
            const isComplete = await postVideoEvent(userId, item, "ended", 1, 0);
            return {
              videoData: item,
              success: isComplete
            };
          }));

          const alreadyCompleted = probeResults.filter(r => r.success).length;
          const failedItems = probeResults.filter(r => !r.success).map(r => r.videoData);
          const failedCount = failedItems.length;

          if (failedCount === 0) {
            await showToastInTab(tabId, `All ${items.length} lecture videos completed.`, "success");
            sendResponse({ success: true, completed: items.length, total: items.length });
            return;
          }

          await showToastInTab(tabId, `Completing ${failedCount} remaining lecture videos...`, "info", true);

          // Phase 2: Remediation loop for failed items (play -> PUT progress -> sleep 2000 -> ended)
          let processedCount = 0;
          let remediationSuccessCount = 0;

          await Promise.all(failedItems.map(async item => {
            try {
              // A. Start playback session on server
              await postVideoEvent(userId, item, "play", 1, 0);

              // B. Write 100% video progress record to database
              await putVideoProgress(userId, item.course_id, item.videoId, item.timeCommitment);

              // C. Mandatory 2000ms delay for database / cache commit
              await sleep(2000);

              // D. Final ended event with up to 5 retries at 8000ms intervals
              const endedOk = await postVideoEvent(userId, item, "ended", 5, 8000);

              processedCount++;
              if (endedOk) remediationSuccessCount++;

              await showToastInTab(tabId, `Completing lecture ${processedCount} of ${failedCount}...`, "info", true);

              return {
                item_id: item.item_id,
                item_name: item.item_name,
                status: endedOk ? "completed" : "failed_again"
              };
            } catch (err) {
              processedCount++;
              return {
                item_id: item.item_id,
                item_name: item.item_name,
                status: "error",
                error: err.message
              };
            }
          }));

          const totalCompleted = alreadyCompleted + remediationSuccessCount;
          if (totalCompleted === items.length) {
            await showToastInTab(tabId, `All ${totalCompleted} of ${items.length} lecture videos completed.`, "success");
          } else {
            const failedFinal = items.length - totalCompleted;
            await showToastInTab(tabId, `Completed ${totalCompleted} of ${items.length} lecture videos. ${failedFinal} items require attention.`, "warn");
          }

          sendResponse({
            success: true,
            completed: totalCompleted,
            total: items.length
          });
        } catch (err) {
          console.error("[Skip Video+] Error during video processing:", err);
          await showToastInTab(tabId, "Coursera did not return the expected response for video completion.", "error");
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep message channel open for async sendResponse
    }

    // AI Provider Proxy Helpers & Whitelist
    const ALLOWED_AI_HOSTS = [
      "https://generativelanguage.googleapis.com/",
      "https://api.groq.com/",
      "https://api.cerebras.ai/",
      "https://openrouter.ai/",
      "https://integrate.api.nvidia.com/",
      "https://api.deepseek.com/"
    ];

    function isAllowedAiUrl(url) {
      if (!url || typeof url !== "string") return false;
      return ALLOWED_AI_HOSTS.some(host => url.startsWith(host));
    }

    async function executeAiProxyFetch(url, options, timeoutMs = 30000) {
      if (!isAllowedAiUrl(url)) {
        return { error: "Unauthorized destination host: " + url };
      }
      const controller = new AbortController();
      const actualTimeout = Math.min(Math.max(timeoutMs || 30000, 5000), 120000);
      const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

      try {
        const fetchHeaders = { ...(options?.headers || {}) };
        const fetchRes = await fetch(url, {
          ...(options || {}),
          headers: fetchHeaders,
          body: options?.body,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const bodyText = await fetchRes.text();
        return {
          ok: fetchRes.ok,
          status: fetchRes.status,
          statusText: fetchRes.statusText,
          text: bodyText
        };
      } catch (netErr) {
        clearTimeout(timeoutId);
        const isAbort = netErr.name === "AbortError" || /aborted/i.test(netErr.message);
        return {
          error: isAbort ? `Request timed out after ${Math.round(actualTimeout / 1000)}s` : (netErr.message || "Network request failed in background worker"),
          status: isAbort ? 408 : 0,
          isTimeout: isAbort
        };
      }
    }

    // -------------------------------------------------------------
    // Provider Model Discovery Adapters
    // -------------------------------------------------------------
    async function getGroqModels(apiKey) {
      const url = "https://api.groq.com/openai/v1/models";
      const res = await executeAiProxyFetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json"
        }
      }, 15000);

      if (!res.ok) {
        let msg = res.error || `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(res.text || "{}");
          msg = parsed.error?.message || parsed.message || msg;
        } catch (_) { }
        const err = new Error(`Groq: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const data = JSON.parse(res.text || "{}");
      const list = Array.isArray(data.data) ? data.data : [];

      // Filter text models, exclude audio/whisper/guard/embeddings
      const filtered = list.filter(m => {
        if (!m || !m.id) return false;
        if (m.active === false) return false;
        const id = m.id.toLowerCase();
        if (id.includes("whisper") || id.includes("guard") || id.includes("embed") || id.includes("tts")) return false;
        return true;
      });

      const normalized = filtered.map(m => ({
        id: m.id,
        name: m.id,
        provider: "groq",
        contextLength: m.context_window || null,
        isFree: true,
        supportsText: true,
        supportsVision: m.id.toLowerCase().includes("vision")
      }));

      // Sort: prioritize versatile/70b models first
      normalized.sort((a, b) => {
        const aScore = a.id.includes("70b-versatile") ? 100 : a.id.includes("70b") ? 80 : a.id.includes("8b") ? 60 : 10;
        const bScore = b.id.includes("70b-versatile") ? 100 : b.id.includes("70b") ? 80 : b.id.includes("8b") ? 60 : 10;
        return bScore - aScore;
      });

      return normalized;
    }

    async function getNvidiaModels(apiKey) {
      const url = "https://integrate.api.nvidia.com/v1/models";
      const res = await executeAiProxyFetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json"
        }
      }, 15000);

      if (!res.ok) {
        let msg = res.error || `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(res.text || "{}");
          msg = parsed.error?.message || parsed.message || msg;
        } catch (_) { }
        const err = new Error(`NVIDIA: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const data = JSON.parse(res.text || "{}");
      const list = Array.isArray(data.data) ? data.data : [];

      const filtered = list.filter(m => {
        if (!m || !m.id) return false;
        const id = m.id.toLowerCase();
        if (id.includes("embed") || id.includes("rerank") || id.includes("clip") || id.includes("audio")) return false;
        return true;
      });

      let models = filtered.map(m => ({
        id: m.id,
        name: m.id,
        provider: "nvidia",
        contextLength: m.context_window || null,
        isFree: null,
        supportsText: true,
        supportsVision: m.id.toLowerCase().includes("vision") || m.id.toLowerCase().includes("multimodal")
      }));

      // If catalogue is empty or filtered out, provide verified NVIDIA NIM text models
      if (models.length === 0) {
        const fallbackCatalogue = [
          "meta/llama-3.3-70b-instruct",
          "deepseek-ai/deepseek-r1",
          "nvidia/nemotron-4-340b-instruct",
          "meta/llama-3.1-8b-instruct",
          "meta/llama-3.1-70b-instruct",
          "mistralai/mistral-large-2-instruct",
          "qwen/qwen2.5-72b-instruct"
        ];
        models = fallbackCatalogue.map(id => ({
          id: id,
          name: id,
          provider: "nvidia",
          contextLength: 131072,
          isFree: null,
          supportsText: true,
          supportsVision: false
        }));
      }

      return models;
    }

    async function getDeepSeekModels(apiKey) {
      const url = "https://api.deepseek.com/models";
      const res = await executeAiProxyFetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json"
        }
      }, 15000);

      if (!res.ok) {
        let msg = res.error || `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(res.text || "{}");
          msg = parsed.error?.message || parsed.message || msg;
        } catch (_) { }
        const err = new Error(`DeepSeek: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const data = JSON.parse(res.text || "{}");
      const list = Array.isArray(data.data) && data.data.length > 0 ? data.data : [
        { id: "deepseek-chat" },
        { id: "deepseek-reasoner" }
      ];

      return list.map(m => ({
        id: m.id,
        name: m.id === "deepseek-chat" ? "deepseek-chat (DeepSeek-V3)" : m.id === "deepseek-reasoner" ? "deepseek-reasoner (DeepSeek-R1)" : m.id,
        provider: "deepseek",
        contextLength: 65536,
        isFree: null,
        supportsText: true,
        supportsVision: false
      }));
    }

    async function getOpenRouterModels(apiKey, freeOnly = false) {
      const url = "https://openrouter.ai/api/v1/models";
      const headers = {
        "HTTP-Referer": "https://github.com/sxtyx-bugs/Coursera-Auto",
        "X-Title": "Coursera Assistant"
      };
      if (apiKey && apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      }

      const res = await executeAiProxyFetch(url, {
        method: "GET",
        headers: headers
      }, 15000);

      if (!res.ok) {
        let msg = res.error || `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(res.text || "{}");
          msg = parsed.error?.message || parsed.message || msg;
        } catch (_) { }
        const err = new Error(`OpenRouter: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const data = JSON.parse(res.text || "{}");
      const list = Array.isArray(data.data) ? data.data : [];

      const normalized = list
        .filter(m => {
          if (!m || !m.id) return false;
          // Exclude pure image generation or audio models
          const mod = m.architecture?.modality || "";
          if (mod.includes("image->image") || mod.includes("audio->")) return false;
          return true;
        })
        .map(m => {
          const promptPrice = parseFloat(m.pricing?.prompt || "0");
          const compPrice = parseFloat(m.pricing?.completion || "0");
          const isFree = (promptPrice === 0 && compPrice === 0) || m.id.endsWith(":free");

          return {
            id: m.id,
            name: m.name || m.id,
            provider: "openrouter",
            contextLength: m.context_length || null,
            isFree: isFree,
            supportsText: true,
            supportsVision: Boolean(m.architecture?.modality?.includes("image->"))
          };
        });

      if (freeOnly) {
        return normalized.filter(m => m.isFree);
      }

      // Sort: free models first, then popular models
      normalized.sort((a, b) => {
        if (a.isFree && !b.isFree) return -1;
        if (!a.isFree && b.isFree) return 1;
        return a.name.localeCompare(b.name);
      });

      return normalized;
    }

    async function getGeminiModels(apiKey) {
      const trimmedKey = (apiKey || "").trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
      const res = await executeAiProxyFetch(url, { method: "GET" }, 15000);

      if (!res.ok) {
        let msg = res.error || `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(res.text || "{}");
          msg = parsed.error?.message || parsed.message || msg;
        } catch (_) { }
        const err = new Error(`Gemini: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const data = JSON.parse(res.text || "{}");
      const list = Array.isArray(data.models) ? data.models : [];

      // Filter only models that support generateContent
      const filtered = list.filter(m => {
        if (!m || !m.name) return false;
        const methods = m.supportedGenerationMethods || [];
        if (!methods.includes("generateContent")) return false;
        const name = m.name.toLowerCase();
        if (name.includes("embedding") || name.includes("imagen") || name.includes("aqa")) return false;
        return true;
      });

      const normalized = filtered.map(m => {
        const cleanId = m.name.replace(/^models\//, "");
        return {
          id: cleanId,
          name: m.displayName ? `${m.displayName} (${cleanId})` : cleanId,
          provider: "gemini",
          contextLength: m.inputTokenLimit || null,
          isFree: true,
          supportsText: true,
          supportsVision: cleanId.includes("flash") || cleanId.includes("pro")
        };
      });

      // Sort: prioritize 2.5-flash, 2.5-pro, 2.0-flash, 1.5-flash
      normalized.sort((a, b) => {
        const aScore = a.id.includes("2.5-flash") ? 100 : a.id.includes("2.5-pro") ? 90 : a.id.includes("2.0-flash") ? 80 : a.id.includes("1.5-flash") ? 70 : 10;
        const bScore = b.id.includes("2.5-flash") ? 100 : b.id.includes("2.5-pro") ? 90 : b.id.includes("2.0-flash") ? 80 : b.id.includes("1.5-flash") ? 70 : 10;
        return bScore - aScore;
      });

      return normalized;
    }

    // Unified AI API Request Proxy (handles fetch in extension context to avoid page CSP issues)
    if (request.action === "AI_PROXY_FETCH" || request.action === "GEMINI_PROXY_FETCH") {
      (async () => {
        try {
          const { url, options, timeoutMs } = request.payload || {};
          if (!url || typeof url !== "string") {
            sendResponse({ error: "Missing or invalid URL" });
            return;
          }
          const result = await executeAiProxyFetch(url, options, timeoutMs || 35000);
          sendResponse(result);
        } catch (netErr) {
          sendResponse({
            error: netErr.message || "Network request failed in background worker"
          });
        }
      })();
      return true;
    }

    // Dynamic Provider Model Discovery
    if (request.action === "FETCH_PROVIDER_MODELS") {
      (async () => {
        const { provider, apiKey, freeOnly } = request.payload || {};
        if (!provider || typeof provider !== "string") {
          sendResponse({ ok: false, error: "Provider name is required" });
          return;
        }

        const trimmedKey = (apiKey || "").trim();
        // OpenRouter can return public models without a key; other providers require key for discovery
        if (provider !== "openrouter" && !trimmedKey) {
          sendResponse({ ok: false, error: `Add your ${provider.toUpperCase()} API key to load available models.` });
          return;
        }

        try {
          let models = [];
          if (provider === "groq") {
            models = await getGroqModels(trimmedKey);
          } else if (provider === "nvidia") {
            models = await getNvidiaModels(trimmedKey);
          } else if (provider === "deepseek") {
            models = await getDeepSeekModels(trimmedKey);
          } else if (provider === "openrouter") {
            models = await getOpenRouterModels(trimmedKey, Boolean(freeOnly));
          } else if (provider === "gemini") {
            models = await getGeminiModels(trimmedKey);
          } else {
            sendResponse({ ok: false, error: `Unsupported provider: ${provider}` });
            return;
          }

          sendResponse({
            ok: true,
            provider: provider,
            models: models,
            count: models.length
          });
        } catch (err) {
          sendResponse({
            ok: false,
            provider: provider,
            status: err.status || 0,
            error: err.message || `Failed to fetch models for ${provider}`
          });
        }
      })();
      return true;
    }

    // Test AI Provider Connection (validates authentication by fetching models)
    if (request.action === "TEST_AI_PROVIDER") {
      (async () => {
        const { provider, apiKey, freeOnly } = request.payload || {};
        if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
          sendResponse({ ok: false, error: "API key is required" });
          return;
        }

        const trimmedKey = apiKey.trim();
        try {
          let models = [];
          if (provider === "groq") {
            models = await getGroqModels(trimmedKey);
          } else if (provider === "nvidia") {
            models = await getNvidiaModels(trimmedKey);
          } else if (provider === "deepseek") {
            models = await getDeepSeekModels(trimmedKey);
          } else if (provider === "openrouter") {
            models = await getOpenRouterModels(trimmedKey, Boolean(freeOnly));
          } else if (provider === "gemini") {
            models = await getGeminiModels(trimmedKey);
          } else if (provider === "cerebras") {
            // Cerebras ping chat test for backward compatibility
            const testRes = await executeAiProxyFetch("https://api.cerebras.ai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${trimmedKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "llama3.3-70b",
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1
              })
            }, 15000);
            if (!testRes.ok) {
              throw new Error(testRes.error || `HTTP ${testRes.status}`);
            }
            models = [{ id: "llama3.3-70b", name: "llama3.3-70b", provider: "cerebras" }];
          } else {
            sendResponse({ ok: false, error: `Unknown provider: ${provider}` });
            return;
          }

          sendResponse({
            ok: true,
            provider: provider,
            modelsCount: models.length,
            models: models,
            message: `Connection verified: ${models.length} accessible model${models.length === 1 ? '' : 's'} found.`
          });
        } catch (err) {
          let cleanErr = err.message || "Failed to verify connection";
          if (trimmedKey && cleanErr.includes(trimmedKey)) {
            cleanErr = cleanErr.split(trimmedKey).join("[REDACTED]");
          }
          sendResponse({
            ok: false,
            status: err.status || 0,
            error: cleanErr
          });
        }
      })();
      return true;
    }

    // Quiz Progress State Relays (Maintains in-memory progress for popup UI without external popup windows)
    if (request.action === "OPEN_QUIZ_WINDOW") {
      sendResponse({ success: true, windowId: null });
      return true;
    }

    if (request.action === "CLOSE_QUIZ_WINDOW") {
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "GET_QUIZ_PROGRESS") {
      sendResponse({ payload: latestQuizProgress });
      return true;
    }

    if (request.action === "QUIZ_PROGRESS") {
      latestQuizProgress = request.payload;
      try {
        chrome.runtime.sendMessage(request).catch(() => {});
      } catch (_) {}
      sendResponse({ received: true });
      return true;
    }

    return undefined;
  });

  // -------------------------------------------------------------
  // URL Change & Tab Navigation Tracker
  // -------------------------------------------------------------
  const activeTabUrls = {};

  chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
    const currentUrl = changeInfo.url || tab.url;
    if (!currentUrl) return;

    const urlChanged = activeTabUrls[tabId] !== currentUrl;
    if (urlChanged || changeInfo.status === "complete") {
      activeTabUrls[tabId] = currentUrl;
      console.log("[Coursera Extension] Tab navigation updated:", currentUrl);

      chrome.tabs.sendMessage(tabId, {
        message: "urlChanged",
        url: currentUrl
      }, function () {
        // Consume lastError to prevent uncaught error when content script is not yet injected
        chrome.runtime.lastError;
      });

      // Auto-Quiz navigation event: if on coursera.org and on an active attempt
      if (currentUrl.includes("coursera.org")) {
        try {
          const urlObj = new URL(currentUrl);
          const urlpath = urlObj.pathname.toLowerCase();
          const isFeedback = urlpath.includes("/view-feedback") || urlpath.includes("/feedback") || urlpath.includes("/review");
          const isSupplement = urlpath.includes("/supplement/") || urlpath.includes("/reading/") || urlpath.includes("/lecture/") || urlpath.includes("/discussions/");
          const isAttempt = !isFeedback && !isSupplement && (
            urlpath.endsWith("/attempt") ||
            urlpath.includes("/attempt/") ||
            (urlpath.includes("/assignment-submission/") && urlpath.includes("/attempt"))
          );

          if (isAttempt) {
            chrome.tabs.sendMessage(
              tabId,
              { action: "attempt" },
              function () {
                chrome.runtime.lastError;
              }
            );
          }
        } catch (_) {}
      }
    }
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    delete activeTabUrls[tabId];
  });

  // -------------------------------------------------------------
  // Keyboard Shortcut Commands
  // -------------------------------------------------------------
  chrome.commands.onCommand.addListener(command => {
    if (command === "open_popup_1" || command === "open_popup_2") {
      chrome.action.openPopup?.();
    }
  });
})();

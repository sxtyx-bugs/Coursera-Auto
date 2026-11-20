/**
 * Coursera Assistant — Editorial Edition
 * Popup Controller (popup.js)
 * Created by satydev & satuxcodes • https://github.com/sxtyx-bugs
 */
(() => {
  'use strict';

  const FALLBACK_PROVIDER_MODELS = {
    groq: [
      { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile (Recommended)" },
      { id: "llama-3.1-8b-instant", name: "llama-3.1-8b-instant (Fastest)" },
      { id: "qwen-2.5-32b", name: "qwen-2.5-32b" },
      { id: "mixtral-8x7b-32768", name: "mixtral-8x7b-32768" }
    ],
    nvidia: [
      { id: "meta/llama-3.3-70b-instruct", name: "meta/llama-3.3-70b-instruct (Recommended)" },
      { id: "meta/llama-3.1-8b-instruct", name: "meta/llama-3.1-8b-instruct" },
      { id: "deepseek-ai/deepseek-r1", name: "deepseek-ai/deepseek-r1 (Reasoning)" },
      { id: "nvidia/nemotron-4-340b-instruct", name: "nvidia/nemotron-4-340b-instruct" }
    ],
    deepseek: [
      { id: "deepseek-chat", name: "deepseek-chat (V3 Recommended)" },
      { id: "deepseek-reasoner", name: "deepseek-reasoner (R1 Reasoning)" }
    ],
    openrouter: [
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "llama-3.3-70b-instruct:free" },
      { id: "deepseek/deepseek-r1:free", name: "deepseek-r1:free" },
      { id: "google/gemini-2.0-flash-exp:free", name: "gemini-2.0-flash-exp:free" },
      { id: "mistralai/mistral-small-24b-instruct-2501:free", name: "mistral-small:free" }
    ],
    gemini: [
      { id: "gemini-2.0-flash", name: "gemini-2.0-flash (Recommended)" },
      { id: "gemini-1.5-flash", name: "gemini-1.5-flash" },
      { id: "gemini-2.5-flash", name: "gemini-2.5-flash" },
      { id: "gemini-1.5-pro", name: "gemini-1.5-pro" }
    ],
    cerebras: [
      { id: "llama3.3-70b", name: "llama3.3-70b (Recommended)" },
      { id: "llama3.1-8b", name: "llama3.1-8b" }
    ]
  };

  const PROVIDER_KEY_LINKS = {
    groq: "https://console.groq.com/keys",
    nvidia: "https://build.nvidia.com/",
    deepseek: "https://platform.deepseek.com/api_keys",
    openrouter: "https://openrouter.ai/keys",
    gemini: "https://aistudio.google.com/app/apikey",
    cerebras: "https://cloud.cerebras.ai/"
  };

  /**
   * Helper to send action message to active Coursera tab
   * Supports auto-injection if extension was reloaded in developer mode
   */
  function sendTabAction(action, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) {
        if (callback) callback("No active tab found");
        return;
      }

      const activeTab = tabs[0];
      const tabId = activeTab.id;
      const url = activeTab.url || "";

      if (!url.includes("coursera.org")) {
        if (callback) callback("Please open an active Coursera course page first.");
        return;
      }

      // First attempt: direct message
      chrome.tabs.sendMessage(tabId, { action: action }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[Coursera Extension] Connection pending, injecting content script:", err.message);
          // If receiving end is missing (e.g. extension updated/reloaded), inject content script
          if (chrome.scripting) {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ["dist/scripts/content.js"]
            }, () => {
              const injectErr = chrome.runtime.lastError;
              if (injectErr) {
                console.error("[Coursera Extension] Content script injection failed:", injectErr.message);
                if (callback) callback("Could not attach to Coursera tab. Check tab permissions.");
                return;
              }
              // Wait briefly for content script to mount message listeners
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: action }, (retryResp) => {
                  const retryErr = chrome.runtime.lastError;
                  if (retryErr) {
                    console.error("[Coursera Extension] Message retry failed:", retryErr.message);
                    if (callback) callback("Connection to Coursera failed. Try refreshing the tab.");
                  } else {
                    console.log("[Coursera Extension] Message sent and response received:", action);
                    if (callback) callback(null, retryResp);
                  }
                });
              }, 250);
            });
            return;
          }

          if (callback) callback(err.message);
          return;
        }

        console.log("[Coursera Extension] Message sent and response received:", action);
        if (callback) callback(null, response);
      });
    });
  }

  /**
   * Performs an initialization handshake with the active Coursera tab on popup startup.
   * Accurately distinguishes between:
   * - Unsupported page (non-Coursera)
   * - Content script not injected
   * - Content script initializing
   * - Runtime communication failure
   */
  function initConnectionHandshake() {
    const statusEl = document.getElementById("key-status");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) {
        if (statusEl) {
          statusEl.textContent = "No active tab detected.";
          statusEl.style.color = "#94a3b8";
        }
        return;
      }

      const activeTab = tabs[0];
      const tabId = activeTab.id;
      const url = activeTab.url || "";

      // 1. Unsupported page
      if (!url.includes("coursera.org")) {
        console.log("[Coursera Extension] Non-Coursera page detected:", url);
        if (statusEl) {
          statusEl.textContent = "Open a Coursera course or assignment to activate.";
          statusEl.style.color = "#64748b";
        }
        return;
      }

      console.log("[Coursera Extension] Coursera page detected in active tab. Initiating handshake...");

      // 2. Check if content script is responding to PING
      chrome.tabs.sendMessage(tabId, { action: "PING" }, (res) => {
        const pingErr = chrome.runtime.lastError;
        if (!pingErr && res && res.ok) {
          console.log(`[Coursera Extension] Popup handshake received. Content script v${res.version || '1.0'} active.`);
          if (statusEl && !statusEl.textContent.includes("saved")) {
            if (res.isAssignment) {
              statusEl.textContent = "✓ Connected • Assignment active";
              statusEl.style.color = "#10b981";
            } else {
              statusEl.textContent = "✓ Connected to Coursera";
              statusEl.style.color = "#10b981";
            }
          }

          // Check if a quiz solve is currently active or recently completed
          chrome.runtime.sendMessage({ action: "GET_QUIZ_PROGRESS" }, (progRes) => {
            if (chrome.runtime.lastError || !progRes || !progRes.payload) return;
            const prog = progRes.payload;
            if (statusEl) {
              if (prog.state === "solving" || prog.state === "filling_answers" || prog.state === "submitting" || prog.state === "loading_questions") {
                statusEl.textContent = prog.message || "Solving active quiz...";
                statusEl.style.color = "#0284c7";
              } else if (prog.state === "completed" && prog.message) {
                statusEl.textContent = prog.message;
                statusEl.style.color = "#10b981";
              }
            }
          });
          return;
        }

        // 3. Content script not responding — attempt recovery via scripting.executeScript
        console.warn("[Coursera Extension] Content script not responding. Attempting dynamic recovery injection...");
        if (statusEl && !statusEl.textContent.includes("saved")) {
          statusEl.textContent = "Connecting to Coursera page...";
          statusEl.style.color = "#0284c7";
        }

        if (chrome.scripting) {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["dist/scripts/content.js"]
          }, () => {
            const injectErr = chrome.runtime.lastError;
            if (injectErr) {
              console.error("[Coursera Extension] Script injection failed:", injectErr.message);
              if (statusEl && !statusEl.textContent.includes("saved")) {
                statusEl.textContent = "Could not attach to Coursera. Please check page permissions.";
                statusEl.style.color = "#ef4444";
              }
              return;
            }

            // Allow content script to mount
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: "PING" }, (retryRes) => {
                const retryPingErr = chrome.runtime.lastError;
                if (!retryPingErr && retryRes && retryRes.ok) {
                  console.log("[Coursera Extension] Handshake recovered successfully!");
                  if (statusEl && !statusEl.textContent.includes("saved")) {
                    statusEl.textContent = "✓ Connected to Coursera";
                    statusEl.style.color = "#10b981";
                  }
                  // Reload user profile now that connection is established
                  loadUserProfile();
                } else {
                  console.warn("[Coursera Extension] Content script initializing or page still loading.");
                  if (statusEl && !statusEl.textContent.includes("saved")) {
                    statusEl.textContent = "Coursera page is still loading. Please wait...";
                    statusEl.style.color = "#f59e0b";
                  }
                }
              });
            }, 250);
          });
        } else {
          if (statusEl && !statusEl.textContent.includes("saved")) {
            statusEl.textContent = "Communication error. Scripting permission unavailable.";
            statusEl.style.color = "#ef4444";
          }
        }
      });
    });
  }

  /**
   * 1. Initialize Course Workflow Buttons
   */
  function initWorkflows() {
    const statusEl = document.getElementById("key-status");

    const workflowMap = [
      { id: "bypass", action: "bypass", activeText: "Running All...", doneText: "Progression started. Check page banner." },
      { id: "dialogueBtn", action: "dialogue", activeText: "Solving...", doneText: "Coach dialogues active. Check page banner." },
      { id: "discussionBtn", action: "discussion", activeText: "Posting...", doneText: "Discussion answers active. Check page banner." },
      { id: "readingBtn", action: "reading", activeText: "Marking...", doneText: "Reading completion active. Check page banner." },
      { id: "videoBtn", action: "video", activeText: "Skipping...", doneText: "Video completion active. Check page banner." }
    ];

    workflowMap.forEach(({ id, action, activeText, doneText }) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      btn.addEventListener("click", () => {
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add("is-active");
        btn.innerHTML = `<span class="btn-feature-label">${activeText}</span>`;

        if (statusEl) {
          statusEl.textContent = `Executing ${action}...`;
          statusEl.style.color = "#0f172a";
        }

        sendTabAction(action, (err) => {
          if (err && statusEl) {
            statusEl.textContent = err;
            statusEl.style.color = "#ef4444";
          }
        });

        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.disabled = false;
          btn.classList.remove("is-active");
          if (statusEl && (!statusEl.textContent || !statusEl.textContent.includes("Please open"))) {
            statusEl.textContent = doneText;
            statusEl.style.color = "#64748b";
          }
        }, 2200);
      });
    });
  }

  /**
   * 2. Initialize Multi-Provider AI Settings & Quiz Solver
   */
  function initAiSettings() {
    const providerSelect = document.getElementById("provider-select");
    const keyInput = document.getElementById("key");
    const modelSelect = document.getElementById("model-select");
    const refreshModelsBtn = document.getElementById("refreshModelsBtn");
    const testConnectionBtn = document.getElementById("testConnectionBtn");
    const saveBtn = document.getElementById("save");
    const quizToggle = document.getElementById("quizToggel");
    const autoBadge = document.getElementById("autoBadge");
    const autoQuizBtn = document.getElementById("autoQuiz");
    const statusEl = document.getElementById("key-status");
    const toggleKeyBtn = document.getElementById("toggleKeyVisibility");
    const apiKeyLink = document.getElementById("apiKeyLink");
    const openSettingsDetailBtn = document.getElementById("openSettingsDetailBtn");

    let loadedConfig = {
      groq: { enabled: true, apiKey: "", model: "llama-3.3-70b-versatile" },
      nvidia: { enabled: true, apiKey: "", model: "meta/llama-3.3-70b-instruct" },
      deepseek: { enabled: true, apiKey: "", model: "deepseek-chat" },
      openrouter: { enabled: true, apiKey: "", model: "meta-llama/llama-3.3-70b-instruct:free" },
      gemini: { enabled: true, apiKey: "", model: "gemini-2.0-flash" },
      cerebras: { enabled: true, apiKey: "", model: "llama3.3-70b" }
    };
    let currentProvider = "groq";
    let modelFetchToken = 0;

    openSettingsDetailBtn?.addEventListener("click", () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL("dist/settings.html"));
      }
    });

    const updateBadge = (on) => {
      if (!autoBadge) return;
      autoBadge.textContent = on ? "ON" : "OFF";
      autoBadge.classList.toggle("is-on", on);
    };

    /**
     * Populate model select with strict provider isolation
     */
    function renderModelOptions(pid, models, preferredModel) {
      if (!modelSelect) return;
      modelSelect.innerHTML = "";

      const list = Array.isArray(models) && models.length > 0
        ? models
        : (FALLBACK_PROVIDER_MODELS[pid] || []);

      let matched = false;
      list.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        if (preferredModel && (preferredModel === m.id || preferredModel.endsWith(m.id))) {
          opt.selected = true;
          matched = true;
        }
        modelSelect.appendChild(opt);
      });

      // If custom model ID was saved and not in discovered list, preserve it as an option
      if (preferredModel && !matched) {
        const customOpt = document.createElement("option");
        customOpt.value = preferredModel;
        customOpt.textContent = `${preferredModel} (Custom)`;
        customOpt.selected = true;
        modelSelect.insertBefore(customOpt, modelSelect.firstChild);
      }

      if (!preferredModel && modelSelect.options.length > 0) {
        modelSelect.options[0].selected = true;
      }
    }

    /**
     * Fetch dynamic models from background worker with race-condition prevention
     */
    function fetchAndPopulateModels(pid, apiKey, preferredModel) {
      const thisToken = ++modelFetchToken;

      if (!apiKey || !apiKey.trim()) {
        renderModelOptions(pid, FALLBACK_PROVIDER_MODELS[pid], preferredModel);
        if (statusEl) {
          statusEl.textContent = `Add your ${pid.toUpperCase()} API key to discover live models.`;
          statusEl.style.color = "#64748b";
        }
        return;
      }

      // Show temporary loading indicator in dropdown
      if (modelSelect) {
        modelSelect.innerHTML = `<option value="">Discovering ${pid.toUpperCase()} models...</option>`;
      }

      chrome.runtime.sendMessage(
        {
          action: "FETCH_PROVIDER_MODELS",
          payload: {
            provider: pid,
            apiKey: apiKey.trim(),
            freeOnly: pid === "openrouter"
          }
        },
        (response) => {
          if (thisToken !== modelFetchToken) {
            // User already switched to a different provider; discard stale response
            return;
          }

          if (response && response.ok && Array.isArray(response.models) && response.models.length > 0) {
            renderModelOptions(pid, response.models, preferredModel);
            if (statusEl) {
              statusEl.textContent = `✓ Discovered ${response.models.length} ${pid.toUpperCase()} models.`;
              statusEl.style.color = "#10b981";
            }
          } else {
            console.warn(`[Popup] Model discovery failed for ${pid}, using fallback:`, response?.error);
            renderModelOptions(pid, FALLBACK_PROVIDER_MODELS[pid], preferredModel);
            if (statusEl && response?.error) {
              statusEl.textContent = `Using verified catalogue (${response.error.slice(0, 45)}...)`;
              statusEl.style.color = "#f59e0b";
            }
          }
        }
      );
    }

    /**
     * Switch the active provider view and load its isolated configuration
     */
    function switchProviderView(pid) {
      currentProvider = pid;
      if (apiKeyLink && PROVIDER_KEY_LINKS[pid]) {
        apiKeyLink.href = PROVIDER_KEY_LINKS[pid];
      }
      const pCfg = loadedConfig[pid] || {};
      if (keyInput) {
        keyInput.value = pCfg.apiKey || "";
        keyInput.placeholder = `Paste ${pid.toUpperCase()} API key`;
      }

      fetchAndPopulateModels(pid, pCfg.apiKey, pCfg.model);
    }

    providerSelect?.addEventListener("change", () => {
      // Save any pending input for previous provider
      if (loadedConfig[currentProvider]) {
        if (keyInput) loadedConfig[currentProvider].apiKey = keyInput.value.trim();
        if (modelSelect && modelSelect.value) loadedConfig[currentProvider].model = modelSelect.value;
      }
      switchProviderView(providerSelect.value);
    });

    // Refresh Models Button (↻)
    refreshModelsBtn?.addEventListener("click", () => {
      const keyVal = keyInput?.value?.trim() || loadedConfig[currentProvider]?.apiKey || "";
      if (!keyVal) {
        if (statusEl) {
          statusEl.textContent = `Enter a ${currentProvider.toUpperCase()} API key first to discover models.`;
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }
      const currentSelectedModel = modelSelect?.value;
      fetchAndPopulateModels(currentProvider, keyVal, currentSelectedModel);
    });

    // Test Connection Button
    testConnectionBtn?.addEventListener("click", () => {
      const keyVal = keyInput?.value?.trim() || "";
      if (!keyVal) {
        if (statusEl) {
          statusEl.textContent = `Please enter a ${currentProvider.toUpperCase()} API key to test.`;
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }

      testConnectionBtn.disabled = true;
      testConnectionBtn.textContent = "Testing...";
      if (statusEl) {
        statusEl.textContent = `Verifying ${currentProvider.toUpperCase()} connection...`;
        statusEl.style.color = "#0f172a";
      }

      chrome.runtime.sendMessage(
        {
          action: "TEST_AI_PROVIDER",
          payload: {
            provider: currentProvider,
            apiKey: keyVal,
            model: modelSelect?.value || "",
            freeOnly: currentProvider === "openrouter"
          }
        },
        (resp) => {
          testConnectionBtn.disabled = false;
          testConnectionBtn.textContent = "Test";

          if (resp && resp.ok) {
            const count = resp.modelsCount || 0;
            if (statusEl) {
              statusEl.textContent = `✓ Connected! ${count} accessible model${count === 1 ? '' : 's'} verified.`;
              statusEl.style.color = "#10b981";
            }
            if (Array.isArray(resp.models) && resp.models.length > 0) {
              renderModelOptions(currentProvider, resp.models, modelSelect?.value);
            }
          } else {
            const err = resp?.error || "Connection test failed";
            if (statusEl) {
              statusEl.textContent = `✗ ${err.slice(0, 60)}`;
              statusEl.style.color = "#ef4444";
            }
          }
        }
      );
    });

    // Load initial storage settings
    chrome.storage.local.get(
      ["quiz", "activeProvider", "providersConfig", "key", "model", "groqApiKey", "nvidiaApiKey", "deepseekApiKey", "openrouterApiKey"],
      (data) => {
        if (!data) return;
        if (quizToggle) {
          const isEnabled = data.quiz !== undefined ? Boolean(data.quiz) : true;
          quizToggle.checked = isEnabled;
          updateBadge(isEnabled);
        }

        if (data.providersConfig) {
          loadedConfig = { ...loadedConfig, ...data.providersConfig };
        }
        // Legacy key mappings fallback
        if (data.key && !loadedConfig.gemini.apiKey) loadedConfig.gemini.apiKey = data.key;
        if (data.model && !loadedConfig.gemini.model) loadedConfig.gemini.model = data.model;
        if (data.groqApiKey && !loadedConfig.groq.apiKey) loadedConfig.groq.apiKey = data.groqApiKey;
        if (data.nvidiaApiKey && !loadedConfig.nvidia.apiKey) loadedConfig.nvidia.apiKey = data.nvidiaApiKey;
        if (data.deepseekApiKey && !loadedConfig.deepseek.apiKey) loadedConfig.deepseek.apiKey = data.deepseekApiKey;
        if (data.openrouterApiKey && !loadedConfig.openrouter.apiKey) loadedConfig.openrouter.apiKey = data.openrouterApiKey;

        const activeP = data.activeProvider || "groq";
        if (providerSelect) providerSelect.value = activeP;
        switchProviderView(activeP);

        const anyKey = Object.values(loadedConfig).some(c => c.apiKey && c.apiKey.trim());
        if (statusEl) {
          statusEl.textContent = anyKey
            ? `Ready with auto-failover (${activeP.toUpperCase()} primary).`
            : "Enter an API key to enable quiz solving.";
          statusEl.style.color = anyKey ? "#10b981" : "#64748b";
        }
      }
    );

    // Toggle API Key visibility
    toggleKeyBtn?.addEventListener("click", () => {
      if (!keyInput) return;
      const isPass = keyInput.type === "password";
      keyInput.type = isPass ? "text" : "password";
      toggleKeyBtn.classList.toggle("is-revealed", isPass);
    });

    // Auto-Solve Quiz Toggle
    quizToggle?.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      const anyKey = Object.values(loadedConfig).some(c => c.apiKey && c.apiKey.trim()) || (keyInput?.value && keyInput.value.trim());
      if (isChecked && !anyKey) {
        e.target.checked = false;
        updateBadge(false);
        if (statusEl) {
          statusEl.textContent = "Please enter and save an API key first.";
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }

      chrome.storage.local.set({ quiz: isChecked });
      chrome.storage.sync?.set({ quiz: isChecked });
      updateBadge(isChecked);
      if (statusEl) {
        statusEl.textContent = isChecked ? "Auto-Solve on Open enabled." : "Auto-Solve disabled.";
        statusEl.style.color = isChecked ? "#10b981" : "#64748b";
      }
    });

    // Save Settings Button
    saveBtn?.addEventListener("click", () => {
      const keyVal = keyInput?.value?.trim() || "";
      const modelVal = modelSelect?.value || FALLBACK_PROVIDER_MODELS[currentProvider]?.[0]?.id;

      if (!keyVal) {
        if (statusEl) {
          statusEl.textContent = `Please enter a ${currentProvider.toUpperCase()} API key to save.`;
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      // Update current provider config
      loadedConfig[currentProvider] = {
        ...loadedConfig[currentProvider],
        enabled: true,
        apiKey: keyVal,
        model: modelVal
      };

      const allProviderIds = ["groq", "nvidia", "deepseek", "openrouter", "gemini", "cerebras"];
      const remaining = allProviderIds.filter(id => id !== currentProvider);
      const priorityList = [currentProvider, ...remaining];

      const savePayload = {
        activeProvider: currentProvider,
        providerPriority: priorityList,
        providersConfig: loadedConfig
      };

      // Legacy compatibility keys
      if (loadedConfig.gemini.apiKey) {
        savePayload.key = loadedConfig.gemini.apiKey;
        savePayload.model = loadedConfig.gemini.model;
        savePayload.geminiApiKey = loadedConfig.gemini.apiKey;
      }
      if (loadedConfig.groq.apiKey) savePayload.groqApiKey = loadedConfig.groq.apiKey;
      if (loadedConfig.nvidia?.apiKey) savePayload.nvidiaApiKey = loadedConfig.nvidia.apiKey;
      if (loadedConfig.deepseek?.apiKey) savePayload.deepseekApiKey = loadedConfig.deepseek.apiKey;
      if (loadedConfig.openrouter?.apiKey) savePayload.openrouterApiKey = loadedConfig.openrouter.apiKey;

      chrome.storage.local.set(savePayload, () => {
        chrome.storage.sync?.set(savePayload);
        if (statusEl) {
          statusEl.textContent = `✓ ${currentProvider.toUpperCase()} saved (${modelVal}). Failover enabled.`;
          statusEl.style.color = "#10b981";
        }
        saveBtn.textContent = "Saved ✓";
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }, 1500);
      });
    });

    // Solve Active Quiz Button
    autoQuizBtn?.addEventListener("click", () => {
      const anyKey = Object.values(loadedConfig).some(c => c.apiKey && c.apiKey.trim()) || (keyInput?.value && keyInput.value.trim());
      if (!anyKey) {
        if (statusEl) {
          statusEl.textContent = "Please enter and save an API key to solve quizzes.";
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }

      const origText = autoQuizBtn.innerHTML;
      autoQuizBtn.disabled = true;
      autoQuizBtn.classList.add("is-active");
      autoQuizBtn.innerHTML = `<span>Solving Quiz Draft...</span>`;

      if (statusEl) {
        statusEl.textContent = `Solving active quiz (${currentProvider.toUpperCase()})...`;
        statusEl.style.color = "#0f172a";
      }

      sendTabAction("quiz", (err, res) => {
        if (err) {
          if (statusEl) {
            statusEl.textContent = err;
            statusEl.style.color = "#ef4444";
          }
        } else if (res && res.result) {
          if (statusEl) {
            statusEl.textContent = res.result.message || "✓ Quiz processing completed.";
            statusEl.style.color = res.result.ok !== false ? "#10b981" : "#ef4444";
          }
        }
      });

      setTimeout(() => {
        autoQuizBtn.innerHTML = origText;
        autoQuizBtn.disabled = false;
        autoQuizBtn.classList.remove("is-active");
      }, 2500);
    });
  }

  /**
   * 3. Load Authenticated User Profile
   */
  function loadUserProfile() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) return;
      const url = tabs[0].url || "";
      if (!url.includes("coursera.org")) return;

      chrome.tabs.sendMessage(tabs[0].id, { action: "GET_USER_DATA" }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        const user = res.user;
        if (user) {
          const profileEl = document.getElementById("userProfile");
          const nameEl = document.getElementById("userName");
          const emailEl = document.getElementById("userEmail");
          if (profileEl && nameEl) {
            profileEl.classList.remove("hidden");
            nameEl.textContent = user.name || "Coursera Student";
            if (emailEl && user.email) {
              emailEl.textContent = user.email;
            }
          }
        }
      });
    });
  }

  /**
   * 4. Settings Gear Button
   */
  function initSettingsButton() {
    const settingsBtn = document.getElementById("settingsBtn");
    settingsBtn?.addEventListener("click", () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL("dist/settings.html"));
      }
    });
  }

  /**
   * 5. Real-time Solver Progress Broadcast Listener
   */
  function initProgressBroadcastListener() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "QUIZ_PROGRESS") {
        const payload = msg.payload || {};
        const statusEl = document.getElementById("key-status");
        if (statusEl) {
          if (payload.state === "completed") {
            statusEl.textContent = payload.message || "✓ All questions answered & assignment submitted.";
            statusEl.style.color = "#10b981";
          } else if (payload.state === "submitting") {
            statusEl.textContent = payload.message || "Submitting assignment...";
            statusEl.style.color = "#0284c7";
          } else if (payload.state === "error") {
            statusEl.textContent = `✗ ${payload.message || "Quiz solver error"}`;
            statusEl.style.color = "#ef4444";
          } else if (payload.state === "filling_answers") {
            statusEl.textContent = payload.message || `Applying answers (${payload.model || ""})...`;
            statusEl.style.color = "#0284c7";
          } else if (payload.state === "solving") {
            statusEl.textContent = payload.message || `Reasoning with AI (${payload.model || ""})...`;
            statusEl.style.color = "#0284c7";
          } else if (payload.state === "loading_questions") {
            statusEl.textContent = payload.message || "Discovering assignment questions...";
            statusEl.style.color = "#0284c7";
          } else if (payload.state === "starting") {
            statusEl.textContent = payload.message || "Preparing solver...";
            statusEl.style.color = "#0f172a";
          }
        }
        sendResponse({ received: true });
        return true;
      }
      return undefined;
    });
  }

  /**
   * Master initialization runner
   */
  function initAll() {
    initWorkflows();
    initAiSettings();
    loadUserProfile();
    initSettingsButton();
    initProgressBroadcastListener();
    initConnectionHandshake();
  }

  // Ensure DOM is ready before executing initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();

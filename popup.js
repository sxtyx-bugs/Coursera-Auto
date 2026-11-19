/**
 * Coursera Assistant — Editorial Edition
 * Popup Controller (popup.js)
 * Created by satydev & satuxcodes • https://github.com/sxtyx-bugs
 */
(() => {
  'use strict';

  const PROVIDER_MODELS = {
    groq: [
      { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile (Recommended)" },
      { id: "llama-3.1-8b-instant", name: "llama-3.1-8b-instant (Fastest)" },
      { id: "mixtral-8x7b-32768", name: "mixtral-8x7b-32768 (MoE)" }
    ],
    cerebras: [
      { id: "llama3.3-70b", name: "llama3.3-70b (Recommended)" },
      { id: "llama3.1-8b", name: "llama3.1-8b (High Throughput)" }
    ],
    openrouter: [
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "llama-3.3-70b (Recommended Free)" },
      { id: "google/gemini-2.0-flash-exp:free", name: "gemini-2.0-flash-exp:free" },
      { id: "mistralai/mistral-small-24b-instruct-2501:free", name: "mistral-small:free" },
      { id: "deepseek/deepseek-r1:free", name: "deepseek-r1:free" }
    ],
    gemini: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Recommended)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" }
    ]
  };

  const PROVIDER_KEY_LINKS = {
    groq: "https://console.groq.com/keys",
    cerebras: "https://cloud.cerebras.ai/",
    openrouter: "https://openrouter.ai/keys",
    gemini: "https://aistudio.google.com/app/apikey"
  };

  /**
   * 2. Initialize Multi-Provider AI Settings & Quiz Solver
   */
  function initAiSettings() {
    const providerSelect = document.getElementById("provider-select");
    const keyInput = document.getElementById("key");
    const modelSelect = document.getElementById("model-select");
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
      cerebras: { enabled: true, apiKey: "", model: "llama3.3-70b" },
      openrouter: { enabled: true, apiKey: "", model: "meta-llama/llama-3.3-70b-instruct:free" },
      gemini: { enabled: true, apiKey: "", model: "gemini-2.5-flash" }
    };
    let currentProvider = "groq";

    openSettingsDetailBtn?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    const updateBadge = (on) => {
      if (!autoBadge) return;
      autoBadge.textContent = on ? "ON" : "OFF";
      autoBadge.classList.toggle("is-on", on);
    };

    function populateModelsForProvider(pid, selectedModel) {
      if (!modelSelect) return;
      modelSelect.innerHTML = "";
      const models = PROVIDER_MODELS[pid] || [];
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name;
        if (selectedModel && (selectedModel === m.id || selectedModel.endsWith(m.id))) {
          opt.selected = true;
        }
        modelSelect.appendChild(opt);
      });
      // If custom model not in list, add it
      if (selectedModel && !models.some(m => m.id === selectedModel)) {
        const customOpt = document.createElement("option");
        customOpt.value = selectedModel;
        customOpt.textContent = selectedModel;
        customOpt.selected = true;
        modelSelect.appendChild(customOpt);
      }
    }

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
      populateModelsForProvider(pid, pCfg.model);
    }

    providerSelect?.addEventListener("change", () => {
      switchProviderView(providerSelect.value);
    });

    // Load initial storage settings
    chrome.storage.local.get(
      ["quiz", "activeProvider", "providersConfig", "key", "model"],
      (data) => {
        if (!data) return;
        if (quizToggle && data.quiz !== undefined) {
          quizToggle.checked = Boolean(data.quiz);
          updateBadge(Boolean(data.quiz));
        }

        if (data.providersConfig) {
          loadedConfig = { ...loadedConfig, ...data.providersConfig };
        }
        // Legacy Gemini key mapping
        if (data.key && !loadedConfig.gemini.apiKey) {
          loadedConfig.gemini.apiKey = data.key;
        }
        if (data.model && !loadedConfig.gemini.model) {
          loadedConfig.gemini.model = data.model;
        }

        const activeP = data.activeProvider || "groq";
        if (providerSelect) providerSelect.value = activeP;
        switchProviderView(activeP);

        // Check if at least one provider has key
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
      const anyKey = Object.values(loadedConfig).some(c => c.apiKey && c.apiKey.trim());
      if (isChecked && !anyKey && (!keyInput?.value || !keyInput.value.trim())) {
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
      const modelVal = modelSelect?.value || PROVIDER_MODELS[currentProvider]?.[0]?.id;

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

      const remaining = ["groq", "cerebras", "openrouter", "gemini"].filter(id => id !== currentProvider);
      const priorityList = [currentProvider, ...remaining];

      const savePayload = {
        activeProvider: currentProvider,
        providerPriority: priorityList,
        providersConfig: loadedConfig
      };

      // Legacy compatibility
      if (currentProvider === "gemini" || loadedConfig.gemini.apiKey) {
        savePayload.key = loadedConfig.gemini.apiKey;
        savePayload.model = loadedConfig.gemini.model;
        savePayload.geminiApiKey = loadedConfig.gemini.apiKey;
      }

      chrome.storage.local.set(savePayload, () => {
        chrome.storage.sync?.set(savePayload);
        if (statusEl) {
          statusEl.textContent = `✓ ${currentProvider.toUpperCase()} saved. Failover enabled.`;
          statusEl.style.color = "#10b981";
        }
        saveBtn.textContent = "Saved ✓";
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Settings";
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

      sendTabAction("quiz", (err) => {
        if (err && statusEl) {
          statusEl.textContent = err;
          statusEl.style.color = "#ef4444";
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
   * Master initialization runner
   */
  function initAll() {
    initWorkflows();
    initAiSettings();
    loadUserProfile();
    initSettingsButton();
  }

  // Ensure DOM is ready before executing initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();
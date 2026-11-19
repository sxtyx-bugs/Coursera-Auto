/**
 * Coursera Automation Extension - Multi-Provider Settings Controller (settings.js)
 * 
 * Manages user preferences for:
 * - Multi-provider AI quiz solving: Groq, Cerebras, OpenRouter, and Gemini
 * - Primary provider & priority failover chain
 * - Request timeout limits & Auto-Solve toggle
 * - Direct connection testing with live status verification
 * - Discussion automation response delay speed
 */
(() => {
  'use strict';

  const DEFAULT_PROVIDERS = {
    groq: {
      enabled: true,
      apiKey: "",
      model: "llama-3.3-70b-versatile"
    },
    cerebras: {
      enabled: true,
      apiKey: "",
      model: "llama3.3-70b"
    },
    openrouter: {
      enabled: true,
      apiKey: "",
      model: "meta-llama/llama-3.3-70b-instruct:free"
    },
    gemini: {
      enabled: true,
      apiKey: "",
      model: "gemini-2.5-flash"
    }
  };

  const PROVIDER_NAMES = {
    groq: "Groq",
    cerebras: "Cerebras",
    openrouter: "OpenRouter",
    gemini: "Gemini"
  };

  document.addEventListener("DOMContentLoaded", () => {
    // Workflow pacing
    const speedInput = document.getElementById("speedInput");

    // General AI strategy controls
    const primarySelect = document.getElementById("primaryProviderSelect");
    const timeoutInput = document.getElementById("timeoutInput");
    const autoQuizToggle = document.getElementById("geminiAutoQuizToggle");
    const saveBtn = document.getElementById("saveBtn");
    const statusDiv = document.getElementById("status");

    // Provider elements mapping
    const providers = {
      groq: {
        enable: document.getElementById("groqEnableToggle"),
        key: document.getElementById("groqKeyInput"),
        toggleKey: document.getElementById("groqToggleKey"),
        model: document.getElementById("groqModelSelect"),
        testBtn: document.getElementById("groqTestBtn"),
        badge: document.getElementById("groqStatusBadge"),
        feedback: document.getElementById("groqTestFeedback")
      },
      cerebras: {
        enable: document.getElementById("cerebrasEnableToggle"),
        key: document.getElementById("cerebrasKeyInput"),
        toggleKey: document.getElementById("cerebrasToggleKey"),
        model: document.getElementById("cerebrasModelSelect"),
        testBtn: document.getElementById("cerebrasTestBtn"),
        badge: document.getElementById("cerebrasStatusBadge"),
        feedback: document.getElementById("cerebrasTestFeedback")
      },
      openrouter: {
        enable: document.getElementById("openrouterEnableToggle"),
        key: document.getElementById("openrouterKeyInput"),
        toggleKey: document.getElementById("openrouterToggleKey"),
        model: document.getElementById("openrouterModelSelect"),
        testBtn: document.getElementById("openrouterTestBtn"),
        badge: document.getElementById("openrouterStatusBadge"),
        feedback: document.getElementById("openrouterTestFeedback")
      },
      gemini: {
        enable: document.getElementById("geminiEnableToggle"),
        key: document.getElementById("geminiKeyInput"),
        toggleKey: document.getElementById("geminiToggleKey"),
        model: document.getElementById("geminiModelSelect"),
        testBtn: document.getElementById("geminiTestBtn"),
        badge: document.getElementById("geminiStatusBadge"),
        feedback: document.getElementById("geminiTestFeedback")
      }
    };

    // Priority chain pills
    const pillPrimary = document.getElementById("pillPrimary");
    const pillFb1 = document.getElementById("pillFb1");
    const pillFb2 = document.getElementById("pillFb2");
    const pillFb3 = document.getElementById("pillFb3");

    function updatePriorityChainDisplay(primaryId) {
      const activePrimary = primaryId || primarySelect?.value || "groq";
      const remaining = ["groq", "cerebras", "openrouter", "gemini"].filter(id => id !== activePrimary);

      if (pillPrimary) {
        pillPrimary.textContent = `1. ${PROVIDER_NAMES[activePrimary]}`;
      }
      if (pillFb1 && remaining[0]) {
        pillFb1.textContent = `2. ${PROVIDER_NAMES[remaining[0]]}`;
      }
      if (pillFb2 && remaining[1]) {
        pillFb2.textContent = `3. ${PROVIDER_NAMES[remaining[1]]}`;
      }
      if (pillFb3 && remaining[2]) {
        pillFb3.textContent = `4. ${PROVIDER_NAMES[remaining[2]]}`;
      }
    }

    primarySelect?.addEventListener("change", () => {
      updatePriorityChainDisplay(primarySelect.value);
    });

    // Toggle password visibility
    Object.keys(providers).forEach(pid => {
      const p = providers[pid];
      p.toggleKey?.addEventListener("click", () => {
        if (!p.key) return;
        const isPass = p.key.type === "password";
        p.key.type = isPass ? "text" : "password";
      });
    });

    // Test connection action
    Object.keys(providers).forEach(pid => {
      const p = providers[pid];
      p.testBtn?.addEventListener("click", () => {
        const apiKey = p.key?.value?.trim() || "";
        const model = p.model?.value || DEFAULT_PROVIDERS[pid].model;

        if (!apiKey) {
          if (p.feedback) {
            p.feedback.textContent = "Please enter an API key to test.";
            p.feedback.className = "test-feedback error";
          }
          if (p.badge) {
            p.badge.textContent = "Missing Key";
            p.badge.className = "provider-status-badge status-error";
          }
          p.key?.focus();
          return;
        }

        p.testBtn.disabled = true;
        p.testBtn.textContent = "Testing...";
        if (p.badge) {
          p.badge.textContent = "Testing";
          p.badge.className = "provider-status-badge status-testing";
        }
        if (p.feedback) {
          p.feedback.textContent = `Sending test request to ${PROVIDER_NAMES[pid]}...`;
          p.feedback.className = "test-feedback";
        }

        chrome.runtime.sendMessage(
          {
            action: "TEST_AI_PROVIDER",
            payload: {
              provider: pid,
              apiKey: apiKey,
              model: model
            }
          },
          (response) => {
            p.testBtn.disabled = false;
            p.testBtn.textContent = "Test Connection";

            if (chrome.runtime.lastError) {
              if (p.badge) {
                p.badge.textContent = "Error";
                p.badge.className = "provider-status-badge status-error";
              }
              if (p.feedback) {
                p.feedback.textContent = `Test failed: ${chrome.runtime.lastError.message}`;
                p.feedback.className = "test-feedback error";
              }
              return;
            }

            if (response?.ok) {
              if (p.badge) {
                p.badge.textContent = "Connected ✓";
                p.badge.className = "provider-status-badge status-connected";
              }
              if (p.feedback) {
                p.feedback.textContent = `✓ Connected to ${PROVIDER_NAMES[pid]} (${model})`;
                p.feedback.className = "test-feedback success";
              }
            } else {
              if (p.badge) {
                p.badge.textContent = "Error ✕";
                p.badge.className = "provider-status-badge status-error";
              }
              if (p.feedback) {
                let errText = response?.error || "Connection refused";
                p.feedback.textContent = errText.length > 60 ? errText.slice(0, 57) + "..." : errText;
                p.feedback.className = "test-feedback error";
              }
            }
          }
        );
      });
    });

    // 1. Load discussion speed delay
    chrome.storage.sync?.get(["s"], stored => {
      const parsedSpeed = parseInt(stored?.s);
      if (speedInput && !isNaN(parsedSpeed) && parsedSpeed > 0) {
        speedInput.value = parsedSpeed;
      }
    });

    // 2. Load provider settings from chrome.storage.local
    chrome.storage.local.get(
      [
        "activeProvider",
        "providerPriority",
        "providersConfig",
        "aiTimeoutLimit",
        "quiz",
        "key",
        "model",
        "groqApiKey",
        "cerebrasApiKey",
        "openrouterApiKey"
      ],
      stored => {
        if (!stored) return;

        // Active primary provider
        const primary = stored.activeProvider || "groq";
        if (primarySelect) primarySelect.value = primary;
        updatePriorityChainDisplay(primary);

        // Timeout
        if (stored.aiTimeoutLimit && timeoutInput) {
          timeoutInput.value = stored.aiTimeoutLimit;
        }

        // Auto quiz toggle
        if (stored.quiz !== undefined && autoQuizToggle) {
          autoQuizToggle.checked = Boolean(stored.quiz);
        }

        // Provider configs
        const cfg = stored.providersConfig || {};

        // Groq
        const groqCfg = cfg.groq || {};
        if (providers.groq.enable && groqCfg.enabled !== undefined) providers.groq.enable.checked = groqCfg.enabled;
        if (providers.groq.key) providers.groq.key.value = groqCfg.apiKey || stored.groqApiKey || "";
        if (providers.groq.model && groqCfg.model) providers.groq.model.value = groqCfg.model;
        if (providers.groq.key?.value) {
          providers.groq.badge.textContent = "Ready";
          providers.groq.badge.className = "provider-status-badge";
        }

        // Cerebras
        const cerCfg = cfg.cerebras || {};
        if (providers.cerebras.enable && cerCfg.enabled !== undefined) providers.cerebras.enable.checked = cerCfg.enabled;
        if (providers.cerebras.key) providers.cerebras.key.value = cerCfg.apiKey || stored.cerebrasApiKey || "";
        if (providers.cerebras.model && cerCfg.model) providers.cerebras.model.value = cerCfg.model;
        if (providers.cerebras.key?.value) {
          providers.cerebras.badge.textContent = "Ready";
          providers.cerebras.badge.className = "provider-status-badge";
        }

        // OpenRouter
        const orCfg = cfg.openrouter || {};
        if (providers.openrouter.enable && orCfg.enabled !== undefined) providers.openrouter.enable.checked = orCfg.enabled;
        if (providers.openrouter.key) providers.openrouter.key.value = cerCfg.apiKey || stored.openrouterApiKey || orCfg.apiKey || "";
        if (providers.openrouter.model && orCfg.model) providers.openrouter.model.value = orCfg.model;
        if (providers.openrouter.key?.value) {
          providers.openrouter.badge.textContent = "Ready";
          providers.openrouter.badge.className = "provider-status-badge";
        }

        // Gemini (with legacy fallback to 'key' and 'model')
        const gemCfg = cfg.gemini || {};
        if (providers.gemini.enable && gemCfg.enabled !== undefined) providers.gemini.enable.checked = gemCfg.enabled;
        if (providers.gemini.key) providers.gemini.key.value = gemCfg.apiKey || stored.key || "";
        if (providers.gemini.model) {
          const gemModel = gemCfg.model || stored.model || DEFAULT_PROVIDERS.gemini.model;
          providers.gemini.model.value = gemModel;
        }
        if (providers.gemini.key?.value) {
          providers.gemini.badge.textContent = "Ready";
          providers.gemini.badge.className = "provider-status-badge";
        }
      }
    );

    // 3. Save all updated preferences
    saveBtn?.addEventListener("click", () => {
      // Discussion speed
      let speedVal = parseInt(speedInput?.value || "5000");
      if (isNaN(speedVal) || speedVal < 1000) speedVal = 1000;
      else if (speedVal > 20000) speedVal = 20000;
      if (speedInput) speedInput.value = speedVal;

      // Timeout
      let timeoutVal = parseInt(timeoutInput?.value || "25");
      if (isNaN(timeoutVal) || timeoutVal < 10) timeoutVal = 10;
      else if (timeoutVal > 60) timeoutVal = 60;
      if (timeoutInput) timeoutInput.value = timeoutVal;

      const primaryVal = primarySelect?.value || "groq";
      const autoQuizVal = Boolean(autoQuizToggle?.checked);

      // Build priority list
      const remaining = ["groq", "cerebras", "openrouter", "gemini"].filter(id => id !== primaryVal);
      const priorityList = [primaryVal, ...remaining];

      // Build providers config
      const updatedConfig = {
        groq: {
          enabled: Boolean(providers.groq.enable?.checked),
          apiKey: providers.groq.key?.value?.trim() || "",
          model: providers.groq.model?.value || DEFAULT_PROVIDERS.groq.model
        },
        cerebras: {
          enabled: Boolean(providers.cerebras.enable?.checked),
          apiKey: providers.cerebras.key?.value?.trim() || "",
          model: providers.cerebras.model?.value || DEFAULT_PROVIDERS.cerebras.model
        },
        openrouter: {
          enabled: Boolean(providers.openrouter.enable?.checked),
          apiKey: providers.openrouter.key?.value?.trim() || "",
          model: providers.openrouter.model?.value || DEFAULT_PROVIDERS.openrouter.model
        },
        gemini: {
          enabled: Boolean(providers.gemini.enable?.checked),
          apiKey: providers.gemini.key?.value?.trim() || "",
          model: providers.gemini.model?.value || DEFAULT_PROVIDERS.gemini.model
        }
      };

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      chrome.storage.sync?.set({ s: speedVal });

      chrome.storage.local.set(
        {
          activeProvider: primaryVal,
          providerPriority: priorityList,
          providersConfig: updatedConfig,
          aiTimeoutLimit: timeoutVal,
          quiz: autoQuizVal,
          // Legacy keys for backward compatibility
          key: updatedConfig.gemini.apiKey,
          model: updatedConfig.gemini.model,
          geminiApiKey: updatedConfig.gemini.apiKey,
          groqApiKey: updatedConfig.groq.apiKey,
          cerebrasApiKey: updatedConfig.cerebras.apiKey,
          openrouterApiKey: updatedConfig.openrouter.apiKey
        },
        () => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Saved ✓";
          if (statusDiv) {
            statusDiv.textContent = "Preferences and provider configurations saved successfully.";
            statusDiv.style.color = "#10b981";
          }
          setTimeout(() => {
            saveBtn.textContent = "Save Preferences";
            if (statusDiv) statusDiv.textContent = "";
          }, 2000);
        }
      );
    });
  });
})();

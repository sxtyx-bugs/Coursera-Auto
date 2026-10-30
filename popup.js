/**
 * Coursera Assistant — Editorial Edition
 * Popup Controller (popup.js)
 * Created by satydev & satuxcodes • https://github.com/sxtyx-bugs
 */
(() => {
  'use strict';

  const APPROVED_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash"
  ];
  const DEFAULT_MODEL = "gemini-3.8-flash";

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
          console.warn("[CourseraAssistant] Connection pending, injecting content script:", err.message);
          // If receiving end is missing (e.g. extension updated/reloaded), inject content script
          if (chrome.scripting) {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ["dist/scripts/content.js"]
            }, () => {
              if (chrome.runtime.lastError) {
                // Try plain string send fallback
                chrome.tabs.sendMessage(tabId, action, (resp2) => {
                  const err2 = chrome.runtime.lastError;
                  if (callback) callback(err2 ? "Please reload the Coursera course page." : null, resp2);
                });
                return;
              }
              // Wait briefly for content script to mount message listeners
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: action }, (retryResp) => {
                  const retryErr = chrome.runtime.lastError;
                  if (retryErr) {
                    chrome.tabs.sendMessage(tabId, action, (finalResp) => {
                      const finalErr = chrome.runtime.lastError;
                      if (callback) callback(finalErr ? "Please reload the Coursera course page." : null, finalResp);
                    });
                  } else {
                    if (callback) callback(null, retryResp);
                  }
                });
              }, 300);
            });
            return;
          }

          if (callback) callback(err.message);
          return;
        }

        if (callback) callback(null, response);
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
   * 2. Initialize Gemini Settings & AI Quiz Solver
   */
  function initGeminiSettings() {
    const keyInput = document.getElementById("key");
    const modelSelect = document.getElementById("model-select");
    const saveBtn = document.getElementById("save");
    const quizToggle = document.getElementById("quizToggel");
    const autoBadge = document.getElementById("autoBadge");
    const autoQuizBtn = document.getElementById("autoQuiz");
    const statusEl = document.getElementById("key-status");
    const toggleKeyBtn = document.getElementById("toggleKeyVisibility");

    const updateBadge = (on) => {
      if (!autoBadge) return;
      autoBadge.textContent = on ? "ON" : "OFF";
      autoBadge.classList.toggle("is-on", on);
    };

    // Load initial storage settings
    chrome.storage.local.get(["quiz", "key", "model"], (data) => {
      if (data) {
        if (quizToggle && data.quiz !== undefined) {
          quizToggle.checked = Boolean(data.quiz);
          updateBadge(Boolean(data.quiz));
        }
        if (keyInput && data.key) {
          keyInput.value = data.key;
        }
        if (modelSelect && data.model) {
          modelSelect.value = data.model;
        }
      }
    });

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
      chrome.storage.local.get(["key"], (res) => {
        if (isChecked && (!res.key || !res.key.trim())) {
          e.target.checked = false;
          updateBadge(false);
          if (statusEl) {
            statusEl.textContent = "Please enter and save your Gemini API key first.";
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
    });

    // Save Settings Button
    saveBtn?.addEventListener("click", () => {
      const keyVal = keyInput?.value?.trim() || "";
      const modelVal = modelSelect?.value || DEFAULT_MODEL;

      if (!keyVal) {
        if (statusEl) {
          statusEl.textContent = "Please enter an API key to save.";
          statusEl.style.color = "#ef4444";
        }
        keyInput?.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      chrome.storage.local.set({ key: keyVal, model: modelVal }, () => {
        chrome.storage.sync?.set({ key: keyVal, model: modelVal, geminiApiKey: keyVal });
        if (statusEl) {
          statusEl.textContent = "✓ Settings saved successfully.";
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
      chrome.storage.local.get(["key"], (res) => {
        if (!res.key || !res.key.trim()) {
          if (statusEl) {
            statusEl.textContent = "Please enter and save your API key to solve quizzes.";
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
          statusEl.textContent = "Solving active quiz with Gemini AI...";
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
    initGeminiSettings();
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
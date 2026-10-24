/**
 * Coursera Assistant - Swiss Editorial Monochrome Popup Controller
 * Pure monochrome skeuomorphic UI with live telemetry monitoring
 */
(() => {
  'use strict';

  const DEFAULT_MODEL = 'gemini-3.8-flash';

  document.addEventListener('DOMContentLoaded', () => {
    initUI();
  });

  function initUI() {
    const bypassBtn = document.getElementById('bypass');
    const dialogueBtn = document.getElementById('dialogueBtn');
    const autoQuizBtn = document.getElementById('autoQuiz');
    const quizToggle = document.getElementById('quizToggel');
    const autoBadge = document.getElementById('autoBadge');
    const modelSelect = document.getElementById('model-select');
    const keyInput = document.getElementById('key');
    const saveBtn = document.getElementById('save');
    const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
    const statusEl = document.getElementById('key-status');
    const settingsBtn = document.getElementById('settingsBtn');

    let isSolving = false;
    let solveTimeoutId = null;

    // 1. Load Stored Settings from chrome.storage.local
    chrome.storage.local.get(['key', 'model', 'quiz'], (data) => {
      if (data) {
        if (data.key && keyInput) {
          keyInput.value = data.key;
        }

        if (modelSelect) {
          modelSelect.value = data.model || DEFAULT_MODEL;
        }

        if (quizToggle) {
          const isAutoOn = Boolean(data.quiz);
          quizToggle.checked = isAutoOn;
          updateBadge(isAutoOn);
        }
      }
    });

    // Helper: Update ON/OFF badge
    function updateBadge(isOn) {
      if (!autoBadge) return;
      autoBadge.textContent = isOn ? 'ON' : 'OFF';
      autoBadge.classList.toggle('badge-on', isOn);
    }

    // Helper: Send message to active tab
    function sendTabMessage(msg, onDone) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0] || !tabs[0].id) {
          if (onDone) onDone('No active tab detected.');
          return;
        }

        const tab = tabs[0];
        const tabUrl = tab.url || '';
        if (!tabUrl.includes('coursera.org')) {
          if (onDone) onDone('Please open a Coursera course tab.');
          return;
        }

        chrome.tabs.sendMessage(tab.id, msg, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Notice sending message:', chrome.runtime.lastError.message);
          }
          if (onDone) onDone(null, response);
        });
      });
    }

    // 2. Real-time Telemetry Listener from Quiz & Automation Subsystems
    chrome.runtime.onMessage.addListener((request) => {
      if (request?.action === 'PROGRESS_STATUS_UPDATE' && request.text) {
        if (statusEl) {
          statusEl.textContent = request.text;
          statusEl.style.color = '#0f172a';
        }
        return;
      }

      if (request?.action === 'QUIZ_PROGRESS' && request.payload) {
        const payload = request.payload;
        if (!statusEl) return;

        if (payload.state === 'starting' || payload.state === 'loading_questions') {
          statusEl.textContent = payload.message || 'Reading quiz draft...';
          statusEl.style.color = '#0f172a';
        } else if (payload.state === 'questions_ready' || payload.state === 'solving') {
          statusEl.textContent = payload.message || 'Analyzing questions with Gemini...';
          statusEl.style.color = '#0f172a';
        } else if (payload.state === 'filling_answers' || payload.state === 'answers_ready') {
          statusEl.textContent = payload.message || 'Applying answers to quiz options...';
          statusEl.style.color = '#0f172a';
        } else if (payload.state === 'completed') {
          statusEl.textContent = '✓ Quiz answers applied successfully!';
          statusEl.style.color = '#0f172a';
          restoreQuizBtn();
        } else if (payload.state === 'error') {
          statusEl.textContent = payload.message || 'Quiz solving encountered an error.';
          statusEl.style.color = '#0f172a';
          restoreQuizBtn();
        }
      }
    });

    function restoreQuizBtn() {
      if (!autoQuizBtn) return;
      isSolving = false;
      autoQuizBtn.disabled = false;
      autoQuizBtn.classList.remove('is-active');
      autoQuizBtn.innerHTML = '<span>Solve Active Quiz</span>';
      if (solveTimeoutId) {
        clearTimeout(solveTimeoutId);
        solveTimeoutId = null;
      }
    }

    // 3. Solve Active Quiz Button Handler
    autoQuizBtn?.addEventListener('click', () => {
      if (isSolving) return;

      const currentInputKey = keyInput?.value?.trim();

      chrome.storage.local.get(['key', 'model'], (stored) => {
        const activeKey = currentInputKey || stored.key;

        if (!activeKey) {
          if (statusEl) {
            statusEl.textContent = 'Enter and save your Gemini API key to continue.';
            statusEl.style.color = '#0f172a';
          }
          keyInput?.focus();
          return;
        }

        // Auto-save key & model if modified in input
        const selectedModel = modelSelect?.value || DEFAULT_MODEL;
        if (currentInputKey && (currentInputKey !== stored.key || selectedModel !== stored.model)) {
          chrome.storage.local.set({ key: currentInputKey, model: selectedModel });
        }

        isSolving = true;
        autoQuizBtn.disabled = true;
        autoQuizBtn.classList.add('is-active');
        autoQuizBtn.innerHTML = '<span>Solving Quiz...</span>';
        if (statusEl) {
          statusEl.textContent = 'Initiating quiz reasoning environment...';
          statusEl.style.color = '#0f172a';
        }

        // Dispatch quiz solve command to active tab
        sendTabMessage('quiz', (err) => {
          if (err) {
            if (statusEl) {
              statusEl.textContent = err;
              statusEl.style.color = '#0f172a';
            }
            restoreQuizBtn();
          }
        });

        // Safety fallback: if no event within 25 seconds, restore button
        solveTimeoutId = setTimeout(() => {
          if (isSolving) {
            restoreQuizBtn();
            if (statusEl) {
              statusEl.textContent = 'Quiz command dispatched. Check Coursera tab for status.';
              statusEl.style.color = '#64748b';
            }
          }
        }, 25000);
      });
    });

    // 4. Course Progression (Skip Videos & Discussions)
    bypassBtn?.addEventListener('click', () => {
      const origContent = bypassBtn.innerHTML;
      bypassBtn.disabled = true;
      bypassBtn.classList.add('is-active');
      bypassBtn.innerHTML = '<span class="btn-feature-label">Processing...</span>';
      if (statusEl) {
        statusEl.textContent = 'Executing course progression...';
        statusEl.style.color = '#0f172a';
      }

      sendTabMessage('bypass', (err) => {
        if (err && statusEl) {
          statusEl.textContent = err;
          statusEl.style.color = '#0f172a';
        }
      });

      setTimeout(() => {
        bypassBtn.innerHTML = origContent;
        bypassBtn.disabled = false;
        bypassBtn.classList.remove('is-active');
        if (statusEl) {
          statusEl.textContent = 'Course progression active. Check page banner.';
          statusEl.style.color = '#64748b';
        }
      }, 2500);
    });

    // 5. Coach Dialogue Button
    dialogueBtn?.addEventListener('click', () => {
      const origContent = dialogueBtn.innerHTML;
      dialogueBtn.disabled = true;
      dialogueBtn.classList.add('is-active');
      dialogueBtn.innerHTML = '<span class="btn-feature-label">Advancing...</span>';
      if (statusEl) {
        statusEl.textContent = 'Advancing Coach Dialogue...';
        statusEl.style.color = '#0f172a';
      }

      sendTabMessage('dialogue', (err) => {
        if (err && statusEl) {
          statusEl.textContent = err;
          statusEl.style.color = '#0f172a';
        }
      });

      setTimeout(() => {
        dialogueBtn.innerHTML = origContent;
        dialogueBtn.disabled = false;
        dialogueBtn.classList.remove('is-active');
        if (statusEl) {
          statusEl.textContent = 'Dialogue action completed.';
          statusEl.style.color = '#64748b';
        }
      }, 2000);
    });

    // 6. Auto-Solve on Open Toggle
    quizToggle?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      chrome.storage.local.get(['key'], (res) => {
        if (isChecked && (!res.key || !res.key.trim())) {
          e.target.checked = false;
          updateBadge(false);
          if (statusEl) {
            statusEl.textContent = 'Enter and save your API key to enable auto-solve.';
            statusEl.style.color = '#0f172a';
          }
          keyInput?.focus();
          return;
        }

        chrome.storage.local.set({ quiz: isChecked }, () => {
          updateBadge(isChecked);
          if (statusEl) {
            statusEl.textContent = isChecked
              ? 'Auto-solve enabled. Quizzes will be answered on open.'
              : 'Auto-solve disabled.';
            statusEl.style.color = '#64748b';
          }
        });
      });
    });

    // 7. Save Settings Button
    saveBtn?.addEventListener('click', () => {
      const keyVal = keyInput?.value?.trim();
      const modelVal = modelSelect?.value || DEFAULT_MODEL;

      if (!keyVal) {
        if (statusEl) {
          statusEl.textContent = 'Please enter an API key to save.';
          statusEl.style.color = '#0f172a';
        }
        keyInput?.focus();
        return;
      }

      chrome.storage.local.set({ key: keyVal, model: modelVal }, () => {
        saveBtn.textContent = 'Saved ✓';
        saveBtn.classList.add('saved');
        if (statusEl) {
          statusEl.textContent = 'API key saved successfully.';
          statusEl.style.color = '#0f172a';
        }
        setTimeout(() => {
          saveBtn.textContent = 'Save Settings';
          saveBtn.classList.remove('saved');
          if (statusEl) {
            statusEl.textContent = 'Required for auto-solving Coursera quizzes.';
            statusEl.style.color = '#64748b';
          }
        }, 1800);
      });
    });

    // 8. Password Visibility Toggle
    toggleKeyBtn?.addEventListener('click', () => {
      if (!keyInput) return;
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      toggleKeyBtn.setAttribute('title', isPassword ? 'Hide key' : 'Show key');
    });

    // 9. Settings Button
    settingsBtn?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage?.();
    });

    // 10. External Link Handler (GitHub & AI Studio)
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.getAttribute('href');
        if (url) {
          if (chrome.tabs?.create) {
            chrome.tabs.create({ url });
          } else {
            window.open(url, '_blank');
          }
        }
      });
    });

    // 10. Load User Profile if available from active tab
    loadUserProfile();
  }

  function loadUserProfile() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) return;
      const tabUrl = tabs[0].url || '';
      if (!tabUrl.includes('coursera.org')) return;

      chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_USER_DATA' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.user) {
          const profileEl = document.getElementById('userProfile');
          const nameEl = document.getElementById('userName');
          const emailEl = document.getElementById('userEmail');
          if (profileEl && nameEl) {
            profileEl.classList.remove('hidden');
            nameEl.textContent = response.user.name || 'Coursera Student';
            if (emailEl && response.user.email) {
              emailEl.textContent = response.user.email;
            }
          }
        }
      });
    });
  }
})();

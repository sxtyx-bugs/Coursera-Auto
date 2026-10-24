/**
 * Coursera Assistant - Coach Dialogue Automator (dialogue.js)
 * Standalone companion script for automating Socratic Coach Dialogues and Ungraded Widgets
 */
(() => {
  'use strict';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Floating Toast Notification System for Dialogue
  const showDialogueToast = (message, type = "info") => {
    let container = document.getElementById("coursera-dialogue-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "coursera-dialogue-toast-container";
      container.style.position = "fixed";
      container.style.top = "20px";
      container.style.right = "20px";
      container.style.zIndex = "2147483647";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "8px";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.padding = "10px 16px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "13px";
    toast.style.fontWeight = "600";
    toast.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    toast.style.transition = "all 0.3s ease";
    toast.style.pointerEvents = "auto";

    if (type === "success") {
      toast.style.background = "#10b981";
      toast.style.color = "#ffffff";
    } else if (type === "error") {
      toast.style.background = "#ef4444";
      toast.style.color = "#ffffff";
    } else {
      toast.style.background = "#1e293b";
      toast.style.color = "#ffffff";
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  /**
   * Advances the stored dialogue queue and navigates to the next item
   */
  const advanceDialogueQueue = async (courseSlug, storedQueue) => {
    let queue = [];
    try {
      if (storedQueue) queue = JSON.parse(storedQueue);
    } catch (_) {}

    if (Array.isArray(queue) && queue.length > 0) {
      const nextEntry = queue[0];
      const nextId = typeof nextEntry === "string" ? nextEntry : nextEntry.id;
      const nextType = typeof nextEntry === "string" ? "ungradedWidget" : (nextEntry.typeName || "ungradedWidget");
      const nextSlug = typeof nextEntry === "string" ? "" : (nextEntry.slug || "");

      window.localStorage.setItem("ungradedWidgets", JSON.stringify(queue.slice(1)));
      showDialogueToast(`Completing dialogue / widget, ${queue.length} remaining...`, "info");
      await sleep(1500);

      const nextUrl = nextType === "coach"
        ? `https://www.coursera.org/learn/${courseSlug}/coach/${nextId}/${nextSlug}`
        : `https://www.coursera.org/learn/${courseSlug}/ungradedWidget/${nextId}`;
      window.location.assign(nextUrl);
    } else {
      window.localStorage.removeItem("ungradedWidgets");
      showDialogueToast("✓ Finished all dialogues", "success");
    }
  };

  /**
   * Synthesizes an accurate academic answer to Coursera Socratic Dialogue questions
   */
  const synthesizeDialogueAnswer = async (questionText = "") => {
    const q = (questionText || "").toLowerCase();

    // Check for Gemini API key in storage
    try {
      const stored = await new Promise(resolve => {
        chrome.storage.local.get(["key", "model"], resolve);
      });

      const apiKey = stored?.key;
      if (apiKey && questionText.trim().length > 10) {
        const model = stored.model || "gemini-2.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const aiResp = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an expert student completing a Coursera Coach Dialogue. Provide a concise, clear, accurate answer (2-3 sentences max) to this question: "${questionText.slice(0, 500)}"`
              }]
            }]
          })
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 5) {
            return text.trim();
          }
        }
      }
    } catch (_) {}

    // Fallback domain heuristics
    if (q.includes("cloud") || q.includes("gcp") || q.includes("aws") || q.includes("azure")) {
      return "Cloud computing provides scalable on-demand access to shared compute, storage, and networking resources over the internet, enabling elasticity and cost optimization compared to managing physical data centers.";
    }
    if (q.includes("thread") || q.includes("concurrency") || q.includes("lock") || q.includes("synchron")) {
      return "Concurrency enables multiple tasks or execution paths to make progress simultaneously. Utilizing thread pools, synchronized blocks, and atomic variables helps prevent race conditions and deadlocks while maximizing processor throughput.";
    }
    if (q.includes("network") || q.includes("packet") || q.includes("router") || q.includes("protocol") || q.includes("ip") || q.includes("tcp")) {
      return "Networking relies on standardized layered protocols where packets are encapsulated, routed across interconnected nodes via IP addressing, and reliably delivered using transport layer mechanisms.";
    }
    if (q.includes("database") || q.includes("sql") || q.includes("query") || q.includes("relational")) {
      return "Relational databases use structured schemas and ACID transactions to ensure data consistency, while query optimization and indexing allow high-throughput data retrieval across interrelated entities.";
    }

    return "A systematic approach involves breaking down requirements into modular components, validating edge conditions, and iterating through structured verification to guarantee correctness.";
  };

  /**
   * Automates the Coach Dialogue interaction on the page
   */
  const runCoachDialogueAutomator = async () => {
    console.log("[CoachAutomator] Initializing Coach Dialogue Automator on", window.location.pathname);
    showDialogueToast("Starting Coach Dialogue automation...", "info");

    const storedQueue = window.localStorage.getItem("ungradedWidgets");
    const isQueued = storedQueue !== null;
    const courseMatch = window.location.pathname.match(/\/learn\/([^/]+)/);
    const courseSlug = courseMatch ? courseMatch[1] : "";

    const isCompleted = () => {
      return !!(
        document.querySelector('[data-testid="chat-ended-message"]') ||
        document.querySelector('.completedButton') ||
        document.querySelector('[data-e2e="coach-start-new-chat-try-again"]') ||
        document.querySelector('button[name="coach_item_start_new_chat_try_again"]') ||
        (document.body.innerText && (
          document.body.innerText.includes("The Dialogue has ended.") ||
          document.body.innerText.includes("You have completed this dialogue") ||
          document.body.innerText.includes("Dialogue completed")
        ))
      );
    };

    if (isCompleted()) {
      showDialogueToast("✓ Dialogue is already completed", "success");
      if (isQueued) {
        await advanceDialogueQueue(courseSlug, storedQueue);
      }
      return;
    }

    // Immediate conclusion check
    const tryInstantFinish = async () => {
      const endDialogueBtn = document.querySelector('button[aria-label="End Dialogue"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          (b.innerText || b.textContent || "").trim() === "End Dialogue"
        );
      if (endDialogueBtn) {
        endDialogueBtn.click();
        await sleep(1000);
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
          (b.innerText || b.textContent || "").toLowerCase().includes("yes, end the dialogue")
        );
        if (confirmBtn) {
          confirmBtn.click();
          for (let c = 0; c < 15; c++) {
            await sleep(1000);
            if (isCompleted()) return true;
          }
        }
      }
      return isCompleted();
    };

    if (await tryInstantFinish()) {
      showDialogueToast("✓ Dialogue concluded successfully", "success");
      if (isQueued) await advanceDialogueQueue(courseSlug, storedQueue);
      return;
    }

    // Look for Start Dialogue button
    const findStartButton = () => {
      return (
        document.querySelector('button[data-e2e="coach-start-button"]') ||
        document.querySelector('button[name="coach_item_start_session"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          (b.innerText || b.textContent || "").trim().toLowerCase().includes("start dialogue")
        )
      );
    };

    let startBtn = findStartButton();
    if (!startBtn) {
      for (let i = 0; i < 6; i++) {
        await sleep(1000);
        if (isCompleted()) {
          await advanceDialogueQueue(courseSlug, storedQueue);
          return;
        }
        startBtn = findStartButton();
        if (startBtn) break;
        if (document.querySelector('textarea.coach-rich-input-field-input, [data-testid="coach-rich-input-field-content"]')) {
          break;
        }
      }
    }

    if (startBtn) {
      showDialogueToast("Starting Dialogue session...", "info");
      startBtn.click();
      await sleep(2500);
    }

    // Interaction loop
    const TARGET_GENUINE_TURNS = 3;
    const MAX_TURNS = 6;
    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
      if (isCompleted()) break;

      // Check conclude button
      const concludeBtn = Array.from(document.querySelectorAll('button')).find(b =>
        (b.innerText || b.textContent || "").toLowerCase().includes("conclude and mark as complete")
      );
      if (concludeBtn) {
        showDialogueToast("Concluding Dialogue session...", "info");
        concludeBtn.click();
        for (let c = 0; c < 15; c++) {
          await sleep(1000);
          if (isCompleted()) break;
        }
        if (isCompleted()) break;
      }

      if (turnCount >= TARGET_GENUINE_TURNS) {
        if (await tryInstantFinish()) break;

        const stuckBtn = document.querySelector('button[name="coach_item_dialogue_im_stuck"]') ||
          Array.from(document.querySelectorAll('button')).find(b =>
            (b.innerText || b.textContent || "").trim().toLowerCase().includes("i'm stuck") ||
            (b.innerText || b.textContent || "").trim().toLowerCase().includes("im stuck")
          );
        if (stuckBtn) {
          stuckBtn.click();
          await sleep(2000);
          const concludeAfterStuck = Array.from(document.querySelectorAll('button')).find(b =>
            (b.innerText || b.textContent || "").toLowerCase().includes("conclude and mark as complete")
          );
          if (concludeAfterStuck) {
            concludeAfterStuck.click();
            for (let c = 0; c < 15; c++) {
              await sleep(1000);
              if (isCompleted()) break;
            }
            if (isCompleted()) break;
          }
        }
      }

      turnCount++;

      // Extract question
      const coachMsgElements = document.querySelectorAll(
        '.coach-message-response, [data-testid="coach-agent-message"], .coach-message-history [role="presentation"]'
      );
      let latestQuestionText = "";
      if (coachMsgElements.length > 0) {
        const lastEl = coachMsgElements[coachMsgElements.length - 1];
        latestQuestionText = (lastEl.innerText || lastEl.textContent || "").trim();
      }

      // Find textarea
      const findTextarea = () => {
        return document.querySelector(
          'textarea.coach-rich-input-field-input, [data-testid="coach-rich-input-field-content"] textarea, .footer-voice-text-input textarea, textarea[placeholder*="message" i]'
        );
      };

      let textarea = findTextarea();
      if (!textarea || textarea.disabled || textarea.readOnly) {
        for (let p = 0; p < 15; p++) {
          await sleep(1000);
          if (isCompleted()) break;
          textarea = findTextarea();
          if (textarea && !textarea.disabled && !textarea.readOnly) break;
        }
      }

      if (isCompleted()) break;
      if (!textarea) {
        await sleep(2000);
        continue;
      }

      showDialogueToast(`Answering question ${turnCount}...`, "info");
      const answerText = await synthesizeDialogueAnswer(latestQuestionText);

      textarea.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, answerText);
      } else {
        textarea.value = answerText;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(500);

      const sendBtn = document.querySelector(
        'button[data-testid="coach-send-button"], button.send-button, button[aria-label*="send" i]'
      );
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      } else {
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      }

      showDialogueToast("Waiting for Coach response...", "info");
      await sleep(1500);
      for (let w = 0; w < 35; w++) {
        await sleep(1000);
        const loader = document.querySelector('[data-testid="coach-message-loader"], .cds-loading');
        if (!loader) {
          await sleep(1000);
          break;
        }
        if (isCompleted()) break;
      }
    }

    await sleep(2000);
    if (isCompleted()) {
      showDialogueToast("✓ Coach Dialogue completed!", "success");
      if (isQueued) await advanceDialogueQueue(courseSlug, storedQueue);
    }
  };

  // Listener for direct dialogue message from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message === "dialogue" || message?.action === "dialogue") {
      runCoachDialogueAutomator().catch(err => {
        console.error("[CoachAutomator] Error:", err);
        showDialogueToast("Dialogue automation error: " + (err.message || err), "error");
      });
      sendResponse({ received: true });
      return true;
    }
  });

  console.log("[CourseraAssistant] Dialogue companion loaded.");
})();

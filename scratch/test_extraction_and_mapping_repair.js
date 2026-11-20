/**
 * scratch/test_extraction_and_mapping_repair.js
 *
 * Comprehensive standalone regression test suite validating:
 * 1. Strategy-2 & Strategy-4 question container discovery and leaf-container resolution.
 * 2. Coursera question stem extraction without options-concatenation pollution.
 * 3. ARIA aria-labelledby prompt resolution.
 * 4. Anti-corruption validation in validateQuestionCandidate.
 * 5. Cache sanitization and distinct single vs multi-choice cache keys.
 * 6. Single-choice DOM mapping: exactly 1 radio checked, verification on ambiguity.
 * 7. Zero-mapped options failure semantics (ok: false, attemptKey released).
 * 8. Honor Code and Submit button protection.
 * 9. End-to-end simulation of the user's reported directedrooted bug case.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

console.log("==================================================================");
console.log("STARTING TEST SUITE: EXTRACTION AND DOM MAPPING REPAIR");
console.log("==================================================================");

// Self-contained Mock DOM implementation
class MockDOMNode {
  constructor(tagName = "DIV", attrs = {}, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.checked = Boolean(attrs.checked);
    this.disabled = Boolean(attrs.disabled);
    this.value = attrs.value || "";
    this.id = attrs.id || "";
    this.name = attrs.name || "";
    this.type = attrs.type || "";
    const classSet = new Set((attrs.class || "").split(" ").filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach(n => classSet.add(n)),
      remove: (...names) => names.forEach(n => classSet.delete(n)),
      contains: (n) => classSet.has(n),
      has: (n) => classSet.has(n)
    };
    this._text = textContent;
    this.isConnected = true;
    this._valueTracker = null;
  }

  get textContent() {
    if (this.children.length === 0) return this._text || "";
    const childText = this.children.map(c => c.textContent).filter(Boolean).join(" ");
    return this._text ? `${this._text} ${childText}`.trim() : childText.trim();
  }
  set textContent(v) { this._text = v; }
  get innerText() { return this.textContent; }
  set innerText(v) { this._text = v; }
  get parentElement() { return this.parentNode; }

  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === "id") this.id = String(v);
    if (k === "name") this.name = String(v);
    if (k === "type") this.type = String(v);
    if (k === "aria-checked") this.attributes["aria-checked"] = String(v);
  }
  hasAttribute(k) { return k in this.attributes; }

  appendChild(child) {
    if (!child) return null;
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  cloneNode(deep = true) {
    const clone = new MockDOMNode(this.tagName, { ...this.attributes }, this._text);
    clone.style = { ...this.style };
    clone.checked = this.checked;
    clone.disabled = this.disabled;
    clone.value = this.value;
    clone.id = this.id;
    clone.name = this.name;
    clone.type = this.type;
    if (deep) {
      for (const c of this.children) {
        clone.appendChild(c.cloneNode(true));
      }
    }
    return clone;
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  contains(other) {
    if (!other) return false;
    if (other === this) return true;
    for (const c of this.children) {
      if (c === other || c.contains(other)) return true;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  matches(sel) {
    const tag = this.tagName.toLowerCase();
    const parts = sel.split(",").map(s => s.trim());
    if (parts.length > 1) {
      return parts.some(p => this.matches(p));
    }

    if (sel === "fieldset" && tag === "fieldset") return true;
    if (sel === "label" && tag === "label") return true;
    if (sel === "input" && tag === "input") return true;
    if (sel === "button" && tag === "button") return true;
    if (sel === "textarea" && tag === "textarea") return true;
    if (sel === "legend" && tag === "legend") return true;
    if (sel === "span" && tag === "span") return true;
    if (sel === "div" && tag === "div") return true;
    if (/^h[1-6]$/i.test(sel)) {
      if (tag === sel.toLowerCase()) return true;
    }

    if (sel.includes(":checked")) {
      if (!this.checked && this.getAttribute("aria-checked") !== "true") return false;
    }

    if (sel.startsWith("input[")) {
      if (tag !== "input") return false;
      const typeMatch = sel.match(/type="([^"]+)"/i);
      if (typeMatch && this.getAttribute("type") === typeMatch[1]) return true;
    }

    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this.classList.has(cls);
    }

    if (sel.startsWith("#")) {
      return this.id === sel.slice(1);
    }

    if (sel.includes("[data-testid")) {
      const testId = (this.getAttribute("data-testid") || "").toLowerCase();
      const valMatch = sel.match(/data-testid[*~|]?="([^"]+)"/i);
      if (valMatch) {
        const val = valMatch[1].toLowerCase();
        return testId.includes(val);
      }
    }

    if (sel.includes('[role="')) {
      const roleMatch = sel.match(/role="([^"]+)"/i);
      if (roleMatch && this.getAttribute("role") === roleMatch[1]) return true;
    }

    if (sel.includes('[class*="')) {
      const clsMatch = sel.match(/class\*="([^"]+)"/i);
      if (clsMatch) {
        const needle = clsMatch[1].toLowerCase();
        const fullClass = (this.getAttribute("class") || Array.from(this.classList).join(" ")).toLowerCase();
        return fullClass.includes(needle);
      }
    }

    if (sel.includes(".rc-FormPartsQuestion")) {
      return this.classList.has("rc-FormPartsQuestion");
    }

    return false;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const matches = [];
    const check = (node) => {
      if (node !== this) {
        const parts = sel.split(",").map(s => s.trim());
        for (const part of parts) {
          if (node.matches(part)) {
            matches.push(node);
            break;
          }
        }
      }
      for (const child of node.children) {
        check(child);
      }
    };
    check(this);
    return matches;
  }

  getBoundingClientRect() {
    return { top: 100, left: 100, width: 400, height: 200, bottom: 300, right: 500 };
  }

  compareDocumentPosition(other) {
    return 4;
  }

  scrollIntoView() {}
  focus() {}
  click() {
    if (this.type === "radio" || this.type === "checkbox") {
      this.checked = true;
    }
    this.dispatchEvent(new Event("click"));
  }
  dispatchEvent(evt) { return true; }
}

const contentCode = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");

function createSandbox(rootDoc) {
  const document = {
    body: rootDoc,
    documentElement: rootDoc,
    cookie: "",
    querySelectorAll: (sel) => rootDoc.querySelectorAll(sel),
    querySelector: (sel) => rootDoc.querySelector(sel),
    getElementsByTagName: (t) => rootDoc.querySelectorAll(t),
    getElementById: (id) => {
      const findId = (node) => {
        if (node.id === id) return node;
        for (const c of node.children) {
          const res = findId(c);
          if (res) return res;
        }
        return null;
      };
      return findId(rootDoc);
    },
    addEventListener: () => {}
  };

  const sandbox = {
    console: {
      log: (...args) => sandbox.logs.push(args.join(" ")),
      warn: (...args) => sandbox.logs.push(args.join(" ")),
      error: (...args) => sandbox.logs.push(args.join(" ")),
      group: () => {},
      groupEnd: () => {}
    },
    logs: [],
    window: {
      location: {
        href: "https://www.coursera.org/learn/algorithms/quiz/12345/attempt",
        pathname: "/learn/algorithms/quiz/12345/attempt",
        origin: "https://www.coursera.org"
      },
      scrollY: 0,
      innerHeight: 900,
      scrollTo: () => {},
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
      addEventListener: () => {}
    },
    document,
    chrome: {
      runtime: {
        id: "mock-ext",
        getManifest: () => ({ version: "1.0.0" }),
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg.action === "AI_PROXY_FETCH" && sandbox.mockAiProxyHandler) {
            Promise.resolve(sandbox.mockAiProxyHandler(msg.payload.url, msg.payload.options, msg.payload.timeoutMs))
              .then(res => cb && cb(res))
              .catch(err => cb && cb({ error: err.message, status: 500 }));
            return true;
          }
          if (cb) cb({ received: true });
        },
        lastError: null
      },
      storage: {
        local: {
          get: (keys, cb) => cb && cb(sandbox.mockStorage || {}),
          set: (obj, cb) => {
            Object.assign(sandbox.mockStorage, obj);
            if (cb) cb();
          }
        },
        onChanged: { addListener: () => {} }
      }
    },
    mockStorage: {
      activeProvider: "groq",
      providerPriority: ["groq", "gemini"],
      groqApiKey: "gsk_mock_groq_key_1234",
      geminiApiKey: "AIzaSy_mock_gemini_key_5678",
      providersConfig: {
        groq: { apiKey: "gsk_mock_groq_key_1234", model: "llama-3.3-70b-versatile", enabled: true },
        gemini: { apiKey: "AIzaSy_mock_gemini_key_5678", model: "gemini-2.0-flash", enabled: true }
      }
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    sleep: (ms) => new Promise(res => setTimeout(res, 5)),
    sanitizeCourseraPromptInjection: (s) => (s ? s.replace(/\s+/g, " ").trim() : ""),
    AbortController: global.AbortController,
    Event: class Event { constructor(type) { this.type = type; } },
    MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
    PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    URL: global.URL
  };

  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;

  return sandbox;
}

// Extract required functions from content.js into sandbox VM context
function createBoundContext(sandbox) {
  const startIdx = contentCode.indexOf("(function () {") + "(function () {".length;
  const endPattern = contentCode.includes("\r\n") ? "  })();\r\n})();" : "  })();\n})();";
  const endIdx = contentCode.indexOf(endPattern);
  const body = contentCode.slice(startIdx, endIdx);

  const wrapped = `
    function __initCoursera() {
      ${body}
      window.__exports = {
        findVisibleQuestionElements,
        findQuestionOptionInputs,
        extractQuestionPrompt,
        validateQuestionCandidate,
        extractQuestionsFromDOM,
        applyQuestionAnswers,
        resolveQuestionRecommendations,
        setInputChecked,
        solveQuiz,
        aiSolverInstance,
        autoSolvedAttemptKeys,
        getAssignmentAttemptKey,
        isAcademicIntegrityDeclaration,
        findHonorCodeCheckbox,
        findReadyToSubmitModal,
        findSubmitButton,
        tickHonorCodeCheckbox,
        clickAssessmentSubmitButton,
        confirmSubmissionModal,
        completeAssignmentSubmission
      };
    }
    __initCoursera();
  `;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(wrapped, ctx);
  return sandbox.window.__exports;
}

(async () => {
  // ------------------------------------------------------------------
  // TEST 1: Container Resolution: rc-FormPartsQuestion vs [role="radiogroup"]
  // ------------------------------------------------------------------
  console.log("\n[Test 1] Strategy-2 & Strategy-4 Leaf Container Resolution");
  {
    const root = new MockDOMNode("div", { id: "main-container" });
    const questionDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion", "data-testid": "question-item" });
    const titleDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" }, "What is the time complexity of insertion in a binary heap?");
    const contentDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__content" });
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });

    const opt1Label = new MockDOMNode("label", {}, "O(log n)");
    const opt1 = new MockDOMNode("input", { type: "radio", name: "q1", value: "0" });
    opt1Label.appendChild(opt1);

    const opt2Label = new MockDOMNode("label", {}, "O(n)");
    const opt2 = new MockDOMNode("input", { type: "radio", name: "q1", value: "1" });
    opt2Label.appendChild(opt2);

    radioGroup.appendChild(opt1Label);
    radioGroup.appendChild(opt2Label);
    contentDiv.appendChild(radioGroup);
    questionDiv.appendChild(titleDiv);
    questionDiv.appendChild(contentDiv);
    root.appendChild(questionDiv);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    const containers = exportsObj.findVisibleQuestionElements();
    assert.strictEqual(containers.length, 1, "Must find exactly 1 resolved question container");
    const c = containers[0];
    assert.strictEqual(c.classList.has("rc-FormPartsQuestion"), true, "Must retain outer rc-FormPartsQuestion container");
    assert.strictEqual(c.getAttribute("role"), null, "Must NOT retain inner [role='radiogroup'] as the question container");
    console.log("✓ PASS: Strategy-4 retains rc-FormPartsQuestion and drops inner [role='radiogroup']");
  }

  // ------------------------------------------------------------------
  // TEST 2: Question Stem Extraction on Coursera Structure
  // ------------------------------------------------------------------
  console.log("\n[Test 2] Question Stem Extraction (No Options Pollution)");
  {
    const questionDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion" });
    const titleDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" });
    const textSpan = new MockDOMNode("span", {}, "What is the time complexity of insertion in a binary heap?");
    titleDiv.appendChild(textSpan);

    const contentDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__content" });
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });
    const l1 = new MockDOMNode("label", {}, "directed");
    l1.appendChild(new MockDOMNode("input", { type: "radio", name: "q1" }));
    const l2 = new MockDOMNode("label", {}, "rooted");
    l2.appendChild(new MockDOMNode("input", { type: "radio", name: "q1" }));
    radioGroup.appendChild(l1);
    radioGroup.appendChild(l2);
    contentDiv.appendChild(radioGroup);

    questionDiv.appendChild(titleDiv);
    questionDiv.appendChild(contentDiv);

    const root = new MockDOMNode("div");
    root.appendChild(questionDiv);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    const prompt = exportsObj.extractQuestionPrompt(questionDiv);
    assert.strictEqual(prompt, "What is the time complexity of insertion in a binary heap?");
    assert.strictEqual(prompt.includes("directed"), false, "Prompt must NOT contain option label 'directed'");
    assert.strictEqual(prompt.includes("rooted"), false, "Prompt must NOT contain option label 'rooted'");
    console.log("✓ PASS: Prompt extracted accurately: \"" + prompt + "\"");
  }

  // ------------------------------------------------------------------
  // TEST 3: ARIA aria-labelledby Resolution
  // ------------------------------------------------------------------
  console.log("\n[Test 3] ARIA aria-labelledby ID Lookup");
  {
    const root = new MockDOMNode("div");
    const heading = new MockDOMNode("h3", { id: "prompt-heading-42" }, "Which data structure supports O(1) average lookup?");
    const radioGroup = new MockDOMNode("div", { role: "radiogroup", "aria-labelledby": "prompt-heading-42" });
    const l1 = new MockDOMNode("label", {}, "Hash Table");
    l1.appendChild(new MockDOMNode("input", { type: "radio", name: "ds" }));
    radioGroup.appendChild(l1);

    root.appendChild(heading);
    root.appendChild(radioGroup);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    const prompt = exportsObj.extractQuestionPrompt(radioGroup);
    assert.strictEqual(prompt, "Which data structure supports O(1) average lookup?");
    console.log("✓ PASS: Resolved prompt via aria-labelledby: \"" + prompt + "\"");
  }

  // ------------------------------------------------------------------
  // TEST 4: Anti-Corruption Check in validateQuestionCandidate
  // ------------------------------------------------------------------
  console.log("\n[Test 4] Anti-Corruption Validation in validateQuestionCandidate");
  {
    const root = new MockDOMNode("div");
    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    // 1. Corrupted candidate: prompt is concatenated options
    const corruptCandidate = {
      question: "directedrooted, directedrooted, undirectedundirect",
      options: ["directed", "rooted", "directed", "rooted", "undirected"],
      type: "mcq"
    };
    const res1 = exportsObj.validateQuestionCandidate(corruptCandidate);
    assert.strictEqual(res1.isValid, false, "Corrupt candidate must be rejected");
    assert.strictEqual(res1.reason, "prompt is formed from concatenated option labels");
    console.log("✓ PASS: Rejected concatenated options prompt with reason: " + res1.reason);

    // 2. Valid candidate
    const validCandidate = {
      question: "What is the time complexity of inserting into an AVL tree?",
      options: ["O(log n)", "O(n)", "O(1)", "O(n log n)"],
      type: "mcq"
    };
    const res2 = exportsObj.validateQuestionCandidate(validCandidate);
    assert.strictEqual(res2.isValid, true, "Valid candidate must be accepted");
    console.log("✓ PASS: Accepted valid candidate");
  }

  // ------------------------------------------------------------------
  // TEST 5: Cache Sanitization & Key Separation
  // ------------------------------------------------------------------
  console.log("\n[Test 5] Cache Sanitization and Key Separation");
  {
    const root = new MockDOMNode("div");
    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    const solver = exportsObj.aiSolverInstance;
    solver.cache = new Map();

    // Populate cache with good and bad entries
    solver.cache.set("mcq:::directedrooted:::directed|||rooted", { answers: [] });
    solver.cache.set("mcq:::character counter:::a|||b", { answers: [] });
    solver.cache.set("mcq:::what is a graph?:::tree|||directed|||undirected", {
      answers: [{ selectedOptionIndexes: [0], content: "tree" }],
      providerName: "Groq",
      model: "llama-3.3-70b"
    });
    solver.cache.set("multiple-select:::what is a graph?:::tree|||directed|||undirected", {
      answers: [{ selectedOptionIndexes: [1, 2], content: "directed, undirected" }],
      providerName: "Groq",
      model: "llama-3.3-70b"
    });

    solver.sanitizeCache();
    assert.strictEqual(solver.cache.has("mcq:::directedrooted:::directed|||rooted"), false, "Must purge directedrooted");
    assert.strictEqual(solver.cache.has("mcq:::character counter:::a|||b"), false, "Must purge character counter");
    assert.strictEqual(solver.cache.has("mcq:::what is a graph?:::tree|||directed|||undirected"), true, "Must retain valid MCQ");
    assert.strictEqual(solver.cache.has("multiple-select:::what is a graph?:::tree|||directed|||undirected"), true, "Must retain valid multi-select");

    // Verify single-select and multiple-select keys are distinct
    const qMcq = [{ question: "what is a graph?", options: ["tree", "directed", "undirected"], type: "mcq" }];
    const qMulti = [{ question: "what is a graph?", options: ["tree", "directed", "undirected"], type: "multiple-select", isMultipleSelect: true }];
    const kMcq = solver.getCacheKey(qMcq);
    const kMulti = solver.getCacheKey(qMulti);

    assert.notStrictEqual(kMcq, kMulti, "Single-select and multiple-select cache keys must be distinct");
    assert.strictEqual(kMcq.startsWith("mcq:::"), true);
    assert.strictEqual(kMulti.startsWith("multiple-select:::"), true);
    console.log("✓ PASS: Corrupt cache entries purged; single vs multi-choice keys strictly segregated");
  }

  // ------------------------------------------------------------------
  // TEST 6: Single-Choice Option Mapping & Verified Checked State
  // ------------------------------------------------------------------
  console.log("\n[Test 6] Single-Choice DOM Mapping & Checked Verification");
  {
    const root = new MockDOMNode("div");
    const qEl = new MockDOMNode("div", { class: "rc-FormPartsQuestion" });
    const title = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" }, "Which graph has no cycles?");
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });

    const l1 = new MockDOMNode("label", {}, "Cyclic Graph");
    const opt0 = new MockDOMNode("input", { type: "radio", name: "g1", value: "0" });
    l1.appendChild(opt0);

    const l2 = new MockDOMNode("label", {}, "Tree");
    const opt1 = new MockDOMNode("input", { type: "radio", name: "g1", value: "1" });
    l2.appendChild(opt1);

    const l3 = new MockDOMNode("label", {}, "Complete Graph");
    const opt2 = new MockDOMNode("input", { type: "radio", name: "g1", value: "2" });
    l3.appendChild(opt2);

    radioGroup.appendChild(l1);
    radioGroup.appendChild(l2);
    radioGroup.appendChild(l3);
    qEl.appendChild(title);
    qEl.appendChild(radioGroup);
    root.appendChild(qEl);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    // AI response recommends option 1 ("Tree")
    const aiAnswer = {
      question: "Which graph has no cycles?",
      answers: ["Tree"],
      confidence: 0.95
    };

    const res = await exportsObj.applyQuestionAnswers(qEl, aiAnswer);
    assert.strictEqual(res.markedCount, 1, "Must mark exactly 1 option");
    assert.strictEqual(opt0.checked, false, "Option 0 must not be checked");
    assert.strictEqual(opt1.checked, true, "Option 1 (Tree) must be checked in DOM");
    assert.strictEqual(opt2.checked, false, "Option 2 must not be checked");
    assert.strictEqual(res.verified, true, "Result must verify checked state in DOM");
    console.log("✓ PASS: Single-choice option 1 ('Tree') selected and verified checked in DOM");
  }

  // ------------------------------------------------------------------
  // TEST 7: Single-Choice Ambiguity Enforces Exactly One Recommendation
  // ------------------------------------------------------------------
  console.log("\n[Test 7] Single-Choice Ambiguity Enforces Limit of 1");
  {
    const root = new MockDOMNode("div");
    const qEl = new MockDOMNode("div", { class: "rc-FormPartsQuestion" });
    const title = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" }, "Select the best answer.");
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });

    const l1 = new MockDOMNode("label", {}, "Option Alpha");
    const opt0 = new MockDOMNode("input", { type: "radio", name: "amb", value: "0" });
    l1.appendChild(opt0);

    const l2 = new MockDOMNode("label", {}, "Option Beta");
    const opt1 = new MockDOMNode("input", { type: "radio", name: "amb", value: "1" });
    l2.appendChild(opt1);

    radioGroup.appendChild(l1);
    radioGroup.appendChild(l2);
    qEl.appendChild(title);
    qEl.appendChild(radioGroup);
    root.appendChild(qEl);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    const options = [opt0, opt1];

    // AI incorrectly returns both answers for a single-choice question
    const ambiguousAnswer = {
      answers: ["Option Alpha", "Option Beta"],
      confidence: 0.8
    };

    const rec = exportsObj.resolveQuestionRecommendations(qEl, ambiguousAnswer, options);
    assert.strictEqual(rec.questionType, "single-choice", "Must be single-choice");
    assert.strictEqual(rec.recommendedOptionIndexes.length, 1, "Must enforce strictly ONE recommendation");
    assert.strictEqual(rec.needsVerification, true, "Must flag needsVerification for ambiguous tie");
    console.log("✓ PASS: Ambiguous response clamped to 1 recommendation with needsVerification=true");
  }

  // ------------------------------------------------------------------
  // TEST 8: Zero-Mapped Answers Reports Failure & Releases Attempt Key
  // ------------------------------------------------------------------
  console.log("\n[Test 8] Zero-Mapped Answers Failure Semantics");
  {
    const root = new MockDOMNode("div");
    const qEl = new MockDOMNode("div", { class: "rc-FormPartsQuestion" });
    const title = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" }, "Unanswerable Question");
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });

    const l1 = new MockDOMNode("label", {}, "Option 1");
    const opt0 = new MockDOMNode("input", { type: "radio", name: "u", value: "0" });
    l1.appendChild(opt0);

    const l2 = new MockDOMNode("label", {}, "Option 2");
    const opt1 = new MockDOMNode("input", { type: "radio", name: "u", value: "1" });
    l2.appendChild(opt1);

    radioGroup.appendChild(l1);
    radioGroup.appendChild(l2);
    qEl.appendChild(title);
    qEl.appendChild(radioGroup);
    root.appendChild(qEl);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    // Mock solver returning nonsense that cannot be mapped
    exportsObj.aiSolverInstance.solveQuestions = async () => ({
      answers: [{ question: "Different Question", answers: ["Completely Unmatched Text"] }],
      providerName: "MockProvider",
      model: "mock-model"
    });

    const res = await exportsObj.solveQuiz();
    assert.strictEqual(res.ok, false, "Solver must report ok: false when 0 options mapped");
    assert.strictEqual(res.answeredCount, 0, "Answered count must be 0");
    assert.strictEqual(res.message.includes("Mapping failed"), true, "Must provide clear failure message");

    // Attempt key must be released so retry is allowed
    const attemptKey = exportsObj.getAssignmentAttemptKey();
    assert.strictEqual(exportsObj.autoSolvedAttemptKeys.has(attemptKey), false, "Attempt key must be released");
    console.log("✓ PASS: 0-mapped answers correctly reports failure and releases attempt key for retry");
  }

  // ------------------------------------------------------------------
  // TEST 9: Academic Integrity Declaration Protection (Screenshot 2)
  // ------------------------------------------------------------------
  console.log("\n[Test 9] Academic Integrity / Honor Code Protection");
  {
    const root = new MockDOMNode("div");
    const honorSection = new MockDOMNode("div", { class: "honor-code-section" });
    const label = new MockDOMNode("label", {}, "I, Satyajit Kiran Patil, understand and agree.");
    const honorCheckbox = new MockDOMNode("input", { type: "checkbox", id: "honor-code-checkbox" });
    label.appendChild(honorCheckbox);
    honorSection.appendChild(label);
    root.appendChild(honorSection);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    assert.strictEqual(exportsObj.isAcademicIntegrityDeclaration(honorCheckbox), true, "Must detect honor declaration");

    // Attempt to set honor checkbox via setInputChecked
    const touched = await exportsObj.setInputChecked(honorCheckbox, true);
    assert.strictEqual(touched, false, "Must refuse to check honor code declaration");
    assert.strictEqual(honorCheckbox.checked, false, "Honor code checkbox must remain unticked");
    console.log("✓ PASS: Honor code checkbox preserved unticked");
  }

  // ------------------------------------------------------------------
  // TEST 10: Full End-to-End Simulation of Directed/Rooted Question
  // ------------------------------------------------------------------
  console.log("\n[Test 10] End-to-End Simulation of User Reported Directed/Rooted Case");
  {
    const root = new MockDOMNode("div", { id: "main-container" });
    const qDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion", "data-testid": "question-item" });
    const titleDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" });
    const titleSpan = new MockDOMNode("span", {}, "What type of graph has edges with a defined direction and a single root?");
    titleDiv.appendChild(titleSpan);

    const contentDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__content" });
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });

    const opt0Label = new MockDOMNode("label", { class: "rc-Option" }, "directed and rooted");
    const opt0 = new MockDOMNode("input", { type: "radio", name: "q1", value: "0" });
    opt0Label.appendChild(opt0);

    const opt1Label = new MockDOMNode("label", { class: "rc-Option" }, "undirected");
    const opt1 = new MockDOMNode("input", { type: "radio", name: "q1", value: "1" });
    opt1Label.appendChild(opt1);

    const opt2Label = new MockDOMNode("label", { class: "rc-Option" }, "cyclic unrooted");
    const opt2 = new MockDOMNode("input", { type: "radio", name: "q1", value: "2" });
    opt2Label.appendChild(opt2);

    radioGroup.appendChild(opt0Label);
    radioGroup.appendChild(opt1Label);
    radioGroup.appendChild(opt2Label);
    contentDiv.appendChild(radioGroup);
    qDiv.appendChild(titleDiv);
    qDiv.appendChild(contentDiv);
    root.appendChild(qDiv);

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    // 1. Extraction
    const extracted = exportsObj.extractQuestionsFromDOM();
    assert.ok(extracted && extracted.length === 1, "Must extract 1 valid question");
    const q = extracted[0];
    assert.strictEqual(q.question, "What type of graph has edges with a defined direction and a single root?");
    assert.strictEqual(q.type, "mcq");
    assert.strictEqual(q.options.length, 3);
    assert.strictEqual(q.options[0], "directed and rooted");

    // 2. Mock AI solver responding with answer "directed and rooted"
    exportsObj.aiSolverInstance.solveQuestions = async () => ({
      answers: [{
        question: q.question,
        answers: ["directed and rooted"],
        confidence: 0.98
      }],
      providerName: "Gemini",
      model: "gemini-2.0-flash"
    });

    // 3. Run solver
    const res = await exportsObj.solveQuiz();
    console.log("Test 11 solveQuiz res:", JSON.stringify(res, null, 2));
    assert.strictEqual(res.ok, true, "Solver must complete successfully");
    assert.strictEqual(res.answeredCount, 1, "Must answer 1 question");

    // 4. Verify DOM
    assert.strictEqual(opt0.checked, true, "First option ('directed and rooted') must be checked in DOM");
    assert.strictEqual(opt1.checked, false, "Second option must not be checked");
    assert.strictEqual(opt2.checked, false, "Third option must not be checked");
    console.log("✓ PASS: Directed/Rooted question extracted properly, solved by AI, and mapped to DOM successfully");
  }

  // ------------------------------------------------------------------
  // TEST 11: Automated Post-Solve Submission Flow (Honor Code -> Submit -> Confirmation Modal)
  // ------------------------------------------------------------------
  console.log("\n[Test 11] Automated Post-Solve Submission Flow");
  {
    const root = new MockDOMNode("div", { id: "main-container" });

    // Question
    const qDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion", "data-testid": "question-item" });
    const titleDiv = new MockDOMNode("div", { class: "rc-FormPartsQuestion__title" }, "What is 2 + 2?");
    const radioGroup = new MockDOMNode("div", { role: "radiogroup" });
    const l1 = new MockDOMNode("label", { class: "rc-Option" }, "3");
    const r0 = new MockDOMNode("input", { type: "radio", name: "math", value: "0" });
    l1.appendChild(r0);
    const l2 = new MockDOMNode("label", { class: "rc-Option" }, "4");
    const r1 = new MockDOMNode("input", { type: "radio", name: "math", value: "1" });
    l2.appendChild(r1);
    radioGroup.appendChild(l1);
    radioGroup.appendChild(l2);
    qDiv.appendChild(titleDiv);
    qDiv.appendChild(radioGroup);
    root.appendChild(qDiv);

    // Honor Code Section (exact Coursera markup from user request)
    const honorSection = new MockDOMNode("div", { class: "rc-HonorCode" });
    const labelContainer = new MockDOMNode("label", { class: "cds-checkboxAndRadio-container" });
    const honorInput = new MockDOMNode("input", {
      type: "checkbox",
      id: "agreement-checkbox-base",
      "aria-labelledby": "agreement-checkbox-base-label-text"
    });
    const labelSpan = new MockDOMNode("span", {
      class: "cds-checkboxAndRadio-labelContent css-tvqrra",
      id: "agreement-checkbox-base-label-text"
    });
    const innerSpan = new MockDOMNode("span", {}, "I, ");
    const nameB = new MockDOMNode("b", { class: "honor-code-agreement full-name pii-hide" }, "Satyajit Kiran Patil");
    innerSpan.appendChild(nameB);
    labelSpan.appendChild(innerSpan);
    labelSpan.appendChild(new MockDOMNode("span", {}, ", understand and agree."));

    labelContainer.appendChild(honorInput);
    labelContainer.appendChild(labelSpan);
    honorSection.appendChild(labelContainer);
    root.appendChild(honorSection);

    // In-Page Submit Button below Honor Code
    const submitBtn = new MockDOMNode("button", { "data-testid": "submit-button" }, "Submit");
    submitBtn.disabled = true; // initially disabled until checkbox is checked!
    root.appendChild(submitBtn);

    // Modal Dialog container
    const modalDialog = new MockDOMNode("div", { role: "dialog", class: "cds-dialog" });
    const modalTitle = new MockDOMNode("h2", {}, "Ready to submit?");
    const modalSubmitBtn = new MockDOMNode("button", { "data-testid": "confirm-submit-button" }, "Submit");
    const modalCancelBtn = new MockDOMNode("button", {}, "Cancel");
    modalDialog.appendChild(modalTitle);
    modalDialog.appendChild(modalSubmitBtn);
    modalDialog.appendChild(modalCancelBtn);

    // Event hooks for DOM simulation
    honorInput.click = function() {
      this.checked = true;
      submitBtn.disabled = false;
    };
    submitBtn.click = function() {
      submitBtn.wasClicked = true;
      root.appendChild(modalDialog);
    };
    modalSubmitBtn.click = function() {
      modalSubmitBtn.wasClicked = true;
    };

    const sandbox = createSandbox(root);
    const exportsObj = createBoundContext(sandbox);

    // 1. Verify findHonorCodeCheckbox locates the exact user checkbox
    const detectedCb = exportsObj.findHonorCodeCheckbox(honorSection);
    assert.strictEqual(detectedCb, honorInput, "findHonorCodeCheckbox must locate #agreement-checkbox-base");

    const rawExtracted = exportsObj.extractQuestionsFromDOM();
    console.log("Test 11 rawExtracted count:", rawExtracted ? rawExtracted.length : null);
    if (!rawExtracted || rawExtracted.length === 0) {
      const candidates = exportsObj.extractQuestionCandidates();
      console.log("Test 11 candidates count:", candidates.length);
      for (const c of candidates) {
        console.log("Candidate validation:", exportsObj.validateQuestionCandidate(c));
      }
    }

    // 2. Mock AI solver
    exportsObj.aiSolverInstance.solveQuestions = async () => ({
      answers: [{ question: "What is 2 + 2?", answers: ["4"], confidence: 0.99 }],
      providerName: "Gemini",
      model: "gemini-2.0-flash"
    });

    // 3. Run solver
    const res = await exportsObj.solveQuiz();
    console.log("Test 11 solveQuiz res:", JSON.stringify(res, null, 2));
    assert.strictEqual(res.ok, true, "Solver must complete successfully");
    assert.strictEqual(r1.checked, true, "Question option 4 must be checked");

    // 4. Verify automated post-solve submission flow
    assert.strictEqual(honorInput.checked, true, "Honor Code checkbox must be automatically ticked");
    assert.strictEqual(submitBtn.wasClicked, true, "In-page Submit button below Honor Code must be automatically clicked");
    assert.strictEqual(modalSubmitBtn.wasClicked, true, "Pop-up 'Ready to submit?' modal Submit button must be automatically clicked");
    console.log("✓ PASS: Honor Code ticked -> Submit button clicked -> Pop-up modal Submit clicked automatically!");
  }

  console.log("\n==================================================================");
  console.log("ALL 11 EXTRACTION & DOM MAPPING REPAIR TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
})();

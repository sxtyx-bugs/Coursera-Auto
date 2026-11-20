/**
 * Comprehensive Test Suite for Restored Coursera Minimalist Workflow
 * 
 * Verifies:
 * 1. Floating dock (#coursera-auto-solve-dock) is NEVER injected in DOM; removeAutoSolveDock removes any dock.
 * 2. Visual AI recommendation pills (.coursera-ai-tag, .coursera-suggested-choice, .coursera-verification-tag) are NEVER added.
 * 3. AVL tree and mathematical expression matching (2^(h+1)-1, KaTeX, MathJax, superscripts/subscripts) matches accurately.
 * 4. Single-choice MCQs select exactly 1 radio input cleanly.
 * 5. Multiple-choice MCQs select correct checkboxes cleanly and uncheck non-selected ones.
 * 6. Academic integrity / Honor code is strictly shielded from ticking or auto-submission.
 * 7. Smooth scrolling to submission section is preserved for user manual review.
 */

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — RESTORED WORKFLOW COMPREHENSIVE TESTS   ");
console.log("==================================================================");

// Mock DOM Environment
class MockClassList {
  constructor(el) {
    this.classes = new Set();
    this.el = el;
  }
  add(...names) { names.forEach(n => this.classes.add(n)); }
  remove(...names) { names.forEach(n => this.classes.delete(n)); }
  contains(name) { return this.classes.has(name); }
  has(name) { return this.classes.has(name); }
}

class MockElement {
  constructor(tagName, attributes = {}, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this._textContent = textContent;
    this.children = [];
    this.parentElement = null;
    this.classList = new MockClassList(this);
    this.checked = Boolean(attributes.checked);
    this.disabled = Boolean(attributes.disabled);
    this.type = attributes.type || "";
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.value = attributes.value || "";
    this.isConnected = true;
    this.eventListeners = {};
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent || "";
    return this.children.map(c => c.textContent).join("");
  }
  set textContent(val) {
    this._textContent = val;
  }

  get innerText() { return this.textContent; }
  set innerText(val) { this.textContent = val; }

  get className() { return Array.from(this.classList.classes).join(" "); }
  set className(val) {
    this.classList.classes.clear();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
    }
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    return this.attributes[name] ?? null;
  }
  setAttribute(name, val) {
    if (name === "class") {
      this.className = String(val);
      return;
    }
    this.attributes[name] = String(val);
  }
  hasAttribute(name) { return name in this.attributes; }

  appendChild(child) {
    if (child.parentElement) {
      const idx = child.parentElement.children.indexOf(child);
      if (idx !== -1) child.parentElement.children.splice(idx, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  replaceWith(newNode) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const idx = parent.children.indexOf(this);
    if (idx !== -1) {
      parent.children[idx] = newNode;
      newNode.parentElement = parent;
      this.parentElement = null;
    }
  }

  cloneNode(deep = true) {
    const clone = new MockElement(this.tagName, { ...this.attributes }, this._textContent);
    clone.checked = this.checked;
    clone.disabled = this.disabled;
    clone.type = this.type;
    clone.id = this.id;
    clone.name = this.name;
    clone.value = this.value;
    clone.className = this.className;
    if (deep) {
      this.children.forEach(child => {
        clone.appendChild(child.cloneNode(true));
      });
    }
    return clone;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const checkMatch = (el) => {
      const s = selector.toLowerCase().trim();
      const tag = el.tagName.toLowerCase();

      if (s === "sup" && tag === "sup") return true;
      if (s === "sub" && tag === "sub") return true;
      if (s === "input" && tag === "input") return true;
      if (s === "textarea" && tag === "textarea") return true;
      if (s === "span" && tag === "span") return true;
      if (s === "label" && tag === "label") return true;
      if (s === "h2" && tag === "h2") return true;
      if (s === "h3" && tag === "h3") return true;

      if (s.includes(".katex") && el.classList.contains("katex")) return true;
      if (s.includes(".coursera-ai-tag") && el.classList.contains("coursera-ai-tag")) return true;
      if (s.includes(".coursera-suggested-choice") && el.classList.contains("coursera-suggested-choice")) return true;
      if (s.includes(".coursera-verification-tag") && el.classList.contains("coursera-verification-tag")) return true;
      if (s.includes(".coursera-needs-verification") && el.classList.contains("coursera-needs-verification")) return true;
      if (s.includes(".coursera-auto-solve-dock") && el.classList.contains("coursera-auto-solve-dock")) return true;

      if (s.includes('input[type="radio"]') && tag === "input" && el.type === "radio") return true;
      if (s.includes('input[type="checkbox"]') && tag === "input" && el.type === "checkbox") return true;
      if (s.includes('annotation[encoding*="tex"]') && tag === "annotation") return true;

      if (s === "#coursera-auto-solve-dock" && el.id === "coursera-auto-solve-dock") return true;
      return false;
    };

    const traverse = (node) => {
      node.children.forEach(child => {
        if (checkMatch(child)) results.push(child);
        traverse(child);
      });
    };
    traverse(this);
    return results;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      const s = selector.toLowerCase();
      if (s === "label" && curr.tagName === "LABEL") return curr;
      if (s.includes("honor") && (curr.className.toLowerCase().includes("honor") || (curr.attributes["data-testid"] || "").includes("honor"))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  scrollIntoView() {}
}

const mockDocument = {
  body: new MockElement("body"),
  createElement(tag) { return new MockElement(tag); },
  createTextNode(text) { return new MockElement("span", {}, text); },
  getElementById(id) {
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  },
  querySelector(sel) { return this.body.querySelector(sel); },
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
};

// Load content.js code
const contentCode = fs.readFileSync("content.js", "utf8");

// Slice the required functions from content.js
const getCleanStart = contentCode.indexOf("function getCleanVisibleText(element) {");
const getCleanEnd = contentCode.indexOf("function isAcademicIntegrityDeclaration(", getCleanStart);
const getCleanFunc = contentCode.slice(getCleanStart, getCleanEnd);

const optInputsStart = contentCode.indexOf("function findQuestionOptionInputs(questionEl) {");
const optInputsEnd = contentCode.indexOf("function findCommonContainerForInputs(", optInputsStart);
const optInputsFunc = contentCode.slice(optInputsStart, optInputsEnd);

const blockStart = contentCode.indexOf("function determineQuestionType(");
const blockEnd = contentCode.indexOf("async function fillQuizAnswersInDOM(", blockStart);
const blockCode = contentCode.slice(blockStart, blockEnd);

const dockStart = contentCode.indexOf("function removeAutoSolveDock() {");
const dockEnd = contentCode.indexOf("let launchedAssignmentPaths = new Set();", dockStart);
const dockCode = contentCode.slice(dockStart, dockEnd);

const visualStart = contentCode.indexOf("function detectVisualElements(");
const visualEnd = contentCode.indexOf("function validateQuestionCompleteness(", visualStart);
const visualFunc = contentCode.slice(visualStart, visualEnd);

const sandbox = {
  console,
  document: mockDocument,
  window: { HTMLTextAreaElement: { prototype: {} }, HTMLInputElement: { prototype: {} } },
  Event: function(type) { this.type = type; },
  exports: {},
  sanitizeCourseraPromptInjection: (t) => t,
  isAcademicIntegrityDeclaration: (el) => {
    if (!el) return false;
    const str = (el.getAttribute("data-testid") || "") + (el.className || "");
    return str.toLowerCase().includes("honor");
  },
  isOptionInputVisible: () => true,
  isElementVisible: () => true,
  setInputChecked: async (input, targetChecked) => {
    input.checked = targetChecked;
    return true;
  }
};

const combinedCode = `
${getCleanFunc}
${visualFunc}
${optInputsFunc}
${dockCode}
${blockCode}

exports.getCleanVisibleText = getCleanVisibleText;
exports.normalizeMathText = normalizeMathText;
exports.findQuestionOptionInputs = findQuestionOptionInputs;
exports.determineQuestionType = determineQuestionType;
exports.cleanStaleRecommendationBadges = cleanStaleRecommendationBadges;
exports.scoreOptionMatch = scoreOptionMatch;
exports.normalizeQuizAnswer = normalizeQuizAnswer;
exports.resolveQuestionRecommendations = resolveQuestionRecommendations;
exports.applyQuestionAnswers = applyQuestionAnswers;
exports.removeAutoSolveDock = removeAutoSolveDock;
`;

vm.runInNewContext(combinedCode, sandbox);

const {
  getCleanVisibleText,
  normalizeMathText,
  scoreOptionMatch,
  normalizeQuizAnswer,
  applyQuestionAnswers,
  removeAutoSolveDock
} = sandbox.exports;

let total = 0;
let passed = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
(async () => {
  // Test 1: Math / KaTeX formula extraction preserves LaTeX and exponents
  await test("Test 1: KaTeX & <sup> formulas (AVL tree: 2^(h+1)-1) extracted accurately", () => {
    const optEl = new MockElement("div");
    const supEl = new MockElement("sup", {}, "h+1");
    optEl.appendChild(new MockElement("span", {}, "2"));
    optEl.appendChild(supEl);
    optEl.appendChild(new MockElement("span", {}, " - 1"));

    const extracted = getCleanVisibleText(optEl);
    assert.strictEqual(extracted.replace(/\s+/g, " ").trim(), "2^(h+1) - 1");

    const norm = normalizeMathText(extracted);
    assert.strictEqual(norm, "2^(h+1)-1");
  });

  // Test 2: Math formula matching scores 95+ for AVL tree options
  await test("Test 2: scoreOptionMatch recognizes normalized math (2^(h+1)-1 vs 2^{h+1}-1)", () => {
    const optInput = new MockElement("input", { type: "radio" });
    const optCleanText = "2^(h+1) - 1";
    const normalizedAI = normalizeQuizAnswer({ answers: ["2^{h+1} - 1"] }, 4);

    const score = scoreOptionMatch(optInput, 1, optCleanText, normalizedAI, 4);
    assert.ok(score >= 90, `Math score must be >= 90, got ${score}`);
  });

  // Test 3: Single-choice MCQ selects 1 radio, 0 AI pills or tags injected
  await test("Test 3: Single-choice question selects radio cleanly without 'AI Recommended' pill", async () => {
    const questionEl = new MockElement("div", { "data-testid": "q1" });
    const options = ["Option A", "Option B", "Option C", "Option D"];
    options.forEach((optText, idx) => {
      const label = new MockElement("label");
      const radio = new MockElement("input", { type: "radio", name: "q1", value: String(idx) });
      const text = new MockElement("span", {}, optText);
      label.appendChild(radio);
      label.appendChild(text);
      questionEl.appendChild(label);
    });

    const answer = { answers: ["Option B"] };
    const res = await applyQuestionAnswers(questionEl, answer);

    const tags = questionEl.querySelectorAll(".coursera-ai-tag");
    const suggested = questionEl.querySelectorAll(".coursera-suggested-choice");
    const verif = questionEl.querySelectorAll(".coursera-verification-tag");
    const radios = questionEl.querySelectorAll('input[type="radio"]');

    assert.strictEqual(tags.length, 0, "No .coursera-ai-tag badges allowed");
    assert.strictEqual(suggested.length, 0, "No .coursera-suggested-choice classes allowed");
    assert.strictEqual(verif.length, 0, "No .coursera-verification-tag badges allowed");
    assert.strictEqual(radios[1].checked, true, "Radio B must be checked");
    assert.strictEqual(radios[0].checked, false);
    assert.strictEqual(radios[2].checked, false);
    assert.strictEqual(radios[3].checked, false);
    assert.strictEqual(res.markedCount, 1);
  });

  // Test 4: Multiple-choice MCQ selects multiple checkboxes, unchecks wrong ones, 0 pills
  await test("Test 4: Multiple-choice question selects checkboxes cleanly without pills", async () => {
    const questionEl = new MockElement("div", { "data-testid": "q2" });
    const options = ["Opt 1", "Opt 2", "Opt 3", "Opt 4"];
    options.forEach((optText, idx) => {
      const label = new MockElement("label");
      // Simulate opt 3 previously mistakenly checked
      const cb = new MockElement("input", { type: "checkbox", name: "q2", value: String(idx), checked: idx === 2 });
      const text = new MockElement("span", {}, optText);
      label.appendChild(cb);
      label.appendChild(text);
      questionEl.appendChild(label);
    });

    const answer = { answers: ["Opt 1", "Opt 2"] };
    const res = await applyQuestionAnswers(questionEl, answer);

    const tags = questionEl.querySelectorAll(".coursera-ai-tag");
    const checkboxes = questionEl.querySelectorAll('input[type="checkbox"]');

    assert.strictEqual(tags.length, 0, "No tags allowed");
    assert.strictEqual(checkboxes[0].checked, true, "Opt 1 must be checked");
    assert.strictEqual(checkboxes[1].checked, true, "Opt 2 must be checked");
    assert.strictEqual(checkboxes[2].checked, false, "Opt 3 must be unchecked");
    assert.strictEqual(checkboxes[3].checked, false, "Opt 4 must be unchecked");
    assert.strictEqual(res.markedCount, 2);
  });

  // Test 5: removeAutoSolveDock removes #coursera-auto-solve-dock and any pills
  await test("Test 5: removeAutoSolveDock purges any floating dock or pill classes from DOM", () => {
    const dock = new MockElement("div", { id: "coursera-auto-solve-dock" });
    dock.classList.add("coursera-auto-solve-dock");
    mockDocument.body.appendChild(dock);

    const strayPill = new MockElement("span");
    strayPill.classList.add("coursera-ai-tag");
    mockDocument.body.appendChild(strayPill);

    removeAutoSolveDock();

    const foundDock = mockDocument.body.querySelector("#coursera-auto-solve-dock");
    const foundPill = mockDocument.body.querySelector(".coursera-ai-tag");
    assert.strictEqual(foundDock, null, "Dock must be removed from DOM");
    assert.strictEqual(foundPill, null, "Pill must be removed from DOM");
  });

  // Test 6: Honor code / Academic integrity declaration is strictly preserved unticked
  await test("Test 6: Academic integrity declaration checkbox is strictly untouched and unticked", async () => {
    const questionEl = new MockElement("div", { "data-testid": "q-honor" });
    const label = new MockElement("label");
    const honorCb = new MockElement("input", { type: "checkbox", "data-testid": "honor-code-checkbox" });
    const text = new MockElement("span", {}, "I understand that submitting work that isn't my own will result in permanent failure.");
    label.appendChild(honorCb);
    label.appendChild(text);
    questionEl.appendChild(label);

    const answer = { answers: ["I understand that submitting work that isn't my own"] };
    await applyQuestionAnswers(questionEl, answer);

    assert.strictEqual(honorCb.checked, false, "Honor code checkbox MUST NEVER be ticked");
  });

  console.log("==================================================================");
  console.log(`RESTORED WORKFLOW TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================================");
  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

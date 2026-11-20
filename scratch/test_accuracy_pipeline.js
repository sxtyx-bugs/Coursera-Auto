/**
 * Comprehensive Accuracy Pipeline & Question Validation Test Suite
 * Tests:
 * 1. 5-Second stabilization delay and content stability check sequence.
 * 2. Academic formatting preservation: MathML fractions, exponents, roots, <sup>, <sub>, code blocks, lists, tables.
 * 3. Question completeness validation & retry mechanism.
 * 4. Visual elements detection (images, SVG diagrams, trees, tables).
 * 5. Answer validation: Concordance check, out-of-bounds check, single-choice invariant, uncertainty flagging.
 */

const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — ACCURACY & VALIDATION PIPELINE TESTS   ");
console.log("==================================================================");

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] Test ${totalTests}: ${name}`);
    console.error(err);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] Test ${totalTests}: ${name}`);
    console.error(err);
  }
}

// Simple DOM Mock
class MockElement {
  constructor(tagName, attributes = {}, text = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this._textContent = text;
    this.children = [];
    this.parentElement = null;
    this.checked = Boolean(attributes.checked);
    this.disabled = Boolean(attributes.disabled);
    this.id = attributes.id || "";
    this.type = attributes.type || "";
    this.name = attributes.name || "";
    this.value = attributes.value || "";
    this.className = attributes.class || attributes.className || "";
    this.classList = {
      contains: (cls) => (this.className || "").split(/\s+/).includes(cls),
      add: (cls) => {
        const set = new Set((this.className || "").split(/\s+/).filter(Boolean));
        set.add(cls);
        this.className = Array.from(set).join(" ");
      },
      remove: (cls) => {
        const set = new Set((this.className || "").split(/\s+/).filter(Boolean));
        set.delete(cls);
        this.className = Array.from(set).join(" ");
      }
    };
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, val) { this.attributes[name] = val; }
  hasAttribute(name) { return name in this.attributes; }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => c.textContent).join("");
  }
  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  get innerText() { return this.textContent; }
  set innerText(val) { this.textContent = val; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
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
      this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map(s => s.trim().toLowerCase());
    const results = [];
    const checkMatch = (el) => {
      const tag = el.tagName.toLowerCase();
      for (const s of selectors) {
        if (s === tag) return true;
        if (s.startsWith(".") && el.classList.contains(s.slice(1))) return true;
        if (s.startsWith("#") && el.id === s.slice(1)) return true;
        if (s.startsWith("[") && s.endsWith("]")) {
          const inner = s.slice(1, -1);
          if (inner.includes("*=")) {
            const [attr, val] = inner.split("*=").map(x => x.replace(/['"]/g, "").trim());
            const attrVal = el.getAttribute(attr);
            if (attrVal && attrVal.toLowerCase().includes(val.toLowerCase())) return true;
          } else if (inner.includes("=")) {
            const [attr, val] = inner.split("=").map(x => x.replace(/['"]/g, "").trim());
            if (el.getAttribute(attr) === val) return true;
          } else if (el.hasAttribute(inner)) return true;
        }
      }
      return false;
    };

    const traverse = (el) => {
      el.children.forEach(child => {
        if (checkMatch(child)) results.push(child);
        traverse(child);
      });
    };
    traverse(this);
    return results;
  }

  closest(selector) {
    let curr = this;
    const selectors = selector.split(",").map(s => s.trim().toLowerCase());
    while (curr) {
      const tag = curr.tagName ? curr.tagName.toLowerCase() : "";
      for (const s of selectors) {
        if (s === tag) return curr;
        if (s.startsWith(".") && curr.classList.contains(s.slice(1))) return curr;
        if (s.startsWith("#") && curr.id === s.slice(1)) return curr;
        if (s.startsWith("[") && s.endsWith("]")) {
          const inner = s.slice(1, -1);
          if (inner.includes("*=")) {
            const [attr, val] = inner.split("*=").map(x => x.replace(/['"]/g, "").trim());
            const attrVal = curr.getAttribute(attr);
            if (attrVal && attrVal.toLowerCase().includes(val.toLowerCase())) return curr;
          } else if (inner.includes("=")) {
            const [attr, val] = inner.split("=").map(x => x.replace(/['"]/g, "").trim());
            if (curr.getAttribute(attr) === val) return curr;
          } else if (curr.hasAttribute(inner)) return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }
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

// Load functions from content.js
const contentCode = fs.readFileSync("content.js", "utf8");

// Slice needed functions
const getCleanStart = contentCode.indexOf("function getCleanVisibleText(element) {");
const getCleanEnd = contentCode.indexOf("function isAcademicIntegrityDeclaration(", getCleanStart);
const getCleanFunc = contentCode.slice(getCleanStart, getCleanEnd);

const visualStart = contentCode.indexOf("function detectVisualElements(");
const visualEnd = contentCode.indexOf("function findVisibleQuestionElements() {", visualStart);
const visualFunc = contentCode.slice(visualStart, visualEnd);

const optInputsStart = contentCode.indexOf("function findQuestionOptionInputs(questionEl) {");
const optInputsEnd = contentCode.indexOf("function findCommonContainerForInputs(", optInputsStart);
const optInputsFunc = contentCode.slice(optInputsStart, optInputsEnd);

const blockStart = contentCode.indexOf("function determineQuestionType(");
const blockEnd = contentCode.indexOf("async function fillQuizAnswersInDOM(", blockStart);
const blockCode = contentCode.slice(blockStart, blockEnd);

const dockStart = contentCode.indexOf("function removeAutoSolveDock() {");
const dockEnd = contentCode.indexOf("let launchedAssignmentPaths = new Set();", dockStart);
const dockCode = contentCode.slice(dockStart, dockEnd);

const stabilityStart = contentCode.indexOf("async function waitForQuestionsContentStable(");
const stabilityEnd = contentCode.indexOf("function getAssignmentAttemptKey() {", stabilityStart);
const stabilityFunc = contentCode.slice(stabilityStart, stabilityEnd);

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
  sleep: (ms) => new Promise(res => setTimeout(res, 10)),
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
${stabilityFunc}
${blockCode}

exports.getCleanVisibleText = getCleanVisibleText;
exports.normalizeMathText = normalizeMathText;
exports.detectVisualElements = detectVisualElements;
exports.validateQuestionCompleteness = validateQuestionCompleteness;
exports.waitForQuestionsContentStable = waitForQuestionsContentStable;
exports.normalizeQuizAnswer = normalizeQuizAnswer;
exports.scoreOptionMatch = scoreOptionMatch;
exports.resolveQuestionRecommendations = resolveQuestionRecommendations;
`;

vm.runInNewContext(combinedCode, sandbox);

const {
  getCleanVisibleText,
  normalizeMathText,
  detectVisualElements,
  validateQuestionCompleteness,
  waitForQuestionsContentStable,
  normalizeQuizAnswer,
  scoreOptionMatch,
  resolveQuestionRecommendations
} = sandbox.exports;

// ==========================================
// TEST SUITE EXECUTION
// ==========================================

async function runAllTests() {
  // Test 1: MathML and Exponent Preservation
  test("Academic formatting: Exponents 2^(h+1)-1, subscripts, and fractions preserved", () => {
    const parent = new MockElement("div");
    const p = new MockElement("p");
    p.appendChild(new MockElement("span", {}, "The maximum number of nodes in an AVL tree of height h is "));
    
    // MathML msup
    const msup = new MockElement("msup");
    msup.appendChild(new MockElement("span", {}, "2"));
    msup.appendChild(new MockElement("span", {}, "h+1"));
    p.appendChild(msup);
    p.appendChild(new MockElement("span", {}, " - 1"));
    parent.appendChild(p);

    const extracted = getCleanVisibleText(parent);
    assert.ok(extracted.includes("2^(h+1) - 1"), `Expected 2^(h+1) - 1, got: "${extracted}"`);
  });

  // Test 2: Code blocks and lists preservation
  test("Academic formatting: Code blocks and ordered/unordered lists preserved with indentation", () => {
    const parent = new MockElement("div");
    const pre = new MockElement("pre");
    pre.appendChild(new MockElement("code", {}, "def insert(heap, val):\n    heap.append(val)\n    sift_up(heap)"));
    parent.appendChild(pre);

    const ol = new MockElement("ol");
    const li1 = new MockElement("li", {}, "Insert at the end");
    const li2 = new MockElement("li", {}, "Sift up to restore heap property");
    ol.appendChild(li1);
    ol.appendChild(li2);
    parent.appendChild(ol);

    const extracted = getCleanVisibleText(parent);
    assert.ok(extracted.includes("def insert(heap, val):"), "Should contain function definition");
    assert.ok(extracted.includes("    heap.append(val)"), "Should preserve indentation");
    assert.ok(extracted.includes("1. Insert at the end"), "Should preserve ordered list numbering");
  });

  // Test 3: MathML fractions and roots
  test("Academic formatting: Fractions <mfrac> and roots <msqrt> formatted cleanly", () => {
    const parent = new MockElement("div");
    const mfrac = new MockElement("mfrac");
    mfrac.appendChild(new MockElement("span", {}, "n(n+1)"));
    mfrac.appendChild(new MockElement("span", {}, "2"));
    parent.appendChild(mfrac);

    const msqrt = new MockElement("msqrt", {}, "n");
    parent.appendChild(msqrt);

    const extracted = getCleanVisibleText(parent);
    assert.ok(extracted.includes("(n(n+1))/(2)"), `Expected fraction formatting, got: "${extracted}"`);
    assert.ok(extracted.includes("sqrt(n)"), `Expected root formatting, got: "${extracted}"`);
  });

  // Test 4: Visual Elements Detection
  test("Visual element detection: Detects diagrams, SVGs, figures, images, and tables", () => {
    const qEl = new MockElement("div");
    const img = new MockElement("img", { src: "https://d3c33hcgiwev3.cloudfront.net/heap_diagram.png", alt: "Binary Max-Heap" });
    const svg = new MockElement("svg", { "aria-label": "AVL Tree Rotation Diagram" });
    const table = new MockElement("table");
    qEl.appendChild(img);
    qEl.appendChild(svg);
    qEl.appendChild(table);

    const result = detectVisualElements(qEl);
    assert.strictEqual(result.hasVisual, true, "Should flag hasVisual: true");
    assert.strictEqual(result.visualContext.length, 3, "Should detect 3 visual items");
    assert.strictEqual(result.visualContext[0].type, "image");
    assert.strictEqual(result.visualContext[1].type, "diagram");
    assert.strictEqual(result.visualContext[2].type, "table");
  });

  // Test 5: Question Completeness Validation
  test("Completeness validation: Identifies complete vs incomplete questions", () => {
    // Incomplete: missing prompt
    const inc1 = { question: "", options: ["A", "B"], type: "mcq" };
    assert.strictEqual(validateQuestionCompleteness(inc1).isComplete, false);

    // Incomplete: MCQ with only 1 option
    const inc2 = { question: "What is the time complexity?", options: ["O(log n)"], type: "mcq" };
    assert.strictEqual(validateQuestionCompleteness(inc2).isComplete, false);

    // Complete MCQ
    const comp = { question: "What is the time complexity of insert in a heap?", options: ["O(1)", "O(log n)", "O(n)"], type: "mcq" };
    assert.strictEqual(validateQuestionCompleteness(comp).isComplete, true);
  });

  // Test 6: Normalization of structured AI response schema
  test("AI schema normalization: parses selectedOptionIndexes, selectedOptionText, confidence, explanation, needsVerification", () => {
    const aiResp = {
      questionId: "q1",
      questionType: "multiple_choice",
      selectedOptionIndexes: [1],
      selectedOptionText: ["O(log n)"],
      answers: ["O(log n)"],
      explanation: "Heap insertion places element at leaf and sifts up along the tree height of log n.",
      confidence: 0.98,
      needsVerification: false
    };

    const norm = normalizeQuizAnswer(aiResp, 3);
    assert.deepStrictEqual([...norm.indices], [1], "Should extract index 1");
    assert.deepStrictEqual([...norm.texts], ["O(log n)"], "Should extract option text");
    assert.strictEqual(norm.confidence, 0.98, "Should retain confidence");
    assert.strictEqual(norm.needsVerification, false, "Should retain needsVerification false");
    assert.ok(norm.explanation.includes("Heap insertion"), "Should retain explanation");
  });

  // Test 7: Answer Validation - Concordance Check detects index vs text mismatch
  test("Answer validation: Concordance mismatch between index and option text flags needsVerification", () => {
    const qEl = new MockElement("div", { id: "q1" });
    const lbl0 = new MockElement("label");
    const opt0 = new MockElement("input", { type: "radio", id: "opt0" });
    lbl0.appendChild(opt0);
    lbl0.appendChild(new MockElement("span", {}, "O(1)"));

    const lbl1 = new MockElement("label");
    const opt1 = new MockElement("input", { type: "radio", id: "opt1" });
    lbl1.appendChild(opt1);
    lbl1.appendChild(new MockElement("span", {}, "O(log n)"));

    qEl.appendChild(lbl0);
    qEl.appendChild(lbl1);

    // AI returned index 0, but text "O(log n)" which actually belongs to index 1!
    const mismatchedAnswer = {
      selectedOptionIndexes: [0],
      selectedOptionText: ["O(log n)"],
      answers: ["O(log n)"],
      confidence: 0.95
    };

    const rec = resolveQuestionRecommendations(qEl, mismatchedAnswer, [opt0, opt1]);
    assert.strictEqual(rec.needsVerification, true, "Should flag needsVerification due to concordance mismatch");
    assert.ok(rec.confidence <= 0.6, `Confidence should be lowered (got ${rec.confidence})`);
  });

  // Test 8: Answer Validation - Out of bounds index check
  test("Answer validation: Out-of-bounds index flags needsVerification and lowers confidence", () => {
    const qEl = new MockElement("div", { id: "q2" });
    const opt0 = new MockElement("input", { type: "radio", id: "opt0" });
    const lbl0 = new MockElement("label", { for: "opt0" }, "Option A");
    const opt1 = new MockElement("input", { type: "radio", id: "opt1" });
    const lbl1 = new MockElement("label", { for: "opt1" }, "Option B");
    qEl.appendChild(opt0);
    qEl.appendChild(lbl0);
    qEl.appendChild(opt1);
    qEl.appendChild(lbl1);

    // AI returned index 5 for a 2-option question
    const outOfBoundsAnswer = {
      selectedOptionIndexes: [5],
      selectedOptionText: ["Option F"],
      confidence: 0.9
    };

    const rec = resolveQuestionRecommendations(qEl, outOfBoundsAnswer, [opt0, opt1]);
    assert.strictEqual(rec.needsVerification, true, "Should flag needsVerification for out-of-bounds index");
  });

  // Test 9: Visual Question Uncertainty Flagging
  test("Visual Question: Questions containing diagrams automatically receive needsVerification: true", () => {
    const qEl = new MockElement("div", { id: "q3" });
    const svg = new MockElement("svg", { "aria-label": "Binary Tree" });
    qEl.appendChild(svg);
    const opt0 = new MockElement("input", { type: "radio", id: "opt0" });
    const lbl0 = new MockElement("label", { for: "opt0" }, "Node 4");
    qEl.appendChild(opt0);
    qEl.appendChild(lbl0);

    const normalAnswer = {
      selectedOptionIndexes: [0],
      selectedOptionText: ["Node 4"],
      confidence: 0.9
    };

    const rec = resolveQuestionRecommendations(qEl, normalAnswer, [opt0]);
    assert.strictEqual(rec.needsVerification, true, "Visual diagram questions must require user verification");
  });

  // Test 10: Single-Choice Invariant Enforcement
  test("Single-choice limit: Never permits more than 1 recommended option index", () => {
    const qEl = new MockElement("div", { id: "q4" });
    const opt0 = new MockElement("input", { type: "radio", id: "opt0" });
    const lbl0 = new MockElement("label", { for: "opt0" }, "Option A");
    const opt1 = new MockElement("input", { type: "radio", id: "opt1" });
    const lbl1 = new MockElement("label", { for: "opt1" }, "Option B");
    qEl.appendChild(opt0);
    qEl.appendChild(lbl0);
    qEl.appendChild(opt1);
    qEl.appendChild(lbl1);

    // AI hallucinates 2 answers for radio question
    const multiAnswer = {
      selectedOptionIndexes: [0, 1],
      selectedOptionText: ["Option A", "Option B"],
      answers: ["Option A", "Option B"]
    };

    const rec = resolveQuestionRecommendations(qEl, multiAnswer, [opt0, opt1]);
    assert.strictEqual(rec.recommendedOptionIndexes.length, 1, "Single choice must strictly contain at most 1 recommendation");
  });

  // Test 11: Content Stability Check Simulation
  await testAsync("Stability check: waitForQuestionsContentStable verifies DOM stability across frames", async () => {
    sandbox.findVisibleQuestionElements = () => {
      const q = new MockElement("div", {}, "What is heap sort?");
      const inp = new MockElement("input", { type: "radio" });
      q.appendChild(inp);
      return [q];
    };
    sandbox.findQuestionOptionInputs = (q) => q.querySelectorAll("input");

    const stable = await waitForQuestionsContentStable(1500);
    assert.strictEqual(stable, true, "Stable DOM across consecutive checks should resolve true");
  });

  console.log("==================================================================");
  console.log(`ACCURACY PIPELINE TESTS: ${passedTests}/${totalTests} PASSED (${Math.round((passedTests/totalTests)*100)}%)`);
  console.log("==================================================================");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

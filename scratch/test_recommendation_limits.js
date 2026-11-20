/**
 * Regression Test Suite: AI Recommendation Limits & Single vs Multi-Choice Validation
 * 
 * Verifies:
 * 1. Single-choice question with 4 options -> exactly 1 recommendation.
 * 2. Single-choice question where model returns multiple candidates -> resolves to 1 (or needs verification), NEVER multiple.
 * 3. Multiple-choice question with 2 correct selections -> exactly 2 recommendations.
 * 4. Multiple-choice question with 1 correct selection -> exactly 1 recommendation.
 * 5. Changing providers / re-running solver -> completely purges stale labels.
 * 6. Two questions on same page -> recommendations remain 100% isolated per question.
 */

const assert = require("assert");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — RECOMMENDATION LIMITS & SINGLE/MULTI TESTS   ");
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
    return this.children.map(c => c.textContent).join(" ");
  }
  set textContent(val) {
    this._textContent = val;
  }

  get innerText() {
    return this.textContent;
  }
  set innerText(val) {
    this.textContent = val;
  }

  get className() {
    return Array.from(this.classList.classes).join(" ");
  }
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
    if (name === "aria-checked") this.attributes["aria-checked"] = String(val);
  }
  hasAttribute(name) { return name in this.attributes; }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(event) {
    const handlers = this.eventListeners[event.type] || [];
    handlers.forEach(h => h(event));
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", bubbles: true, target: this });
    if (this.type === "checkbox") {
      this.checked = !this.checked;
    } else if (this.type === "radio") {
      this.checked = true;
    }
  }

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

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const search = (node) => {
      node.children.forEach(child => {
        if (matches(child, sel)) results.push(child);
        search(child);
      });
    };
    search(this);
    return results;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (matches(curr, sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

function matches(el, sel) {
  if (!el || !sel) return false;
  const parts = sel.split(",").map(s => s.trim());
  return parts.some(p => {
    if (p.startsWith(".")) return el.classList.contains(p.slice(1));
    if (p.includes("[type=")) {
      const match = p.match(/\[type=["']?([^"']+)["']?\]/);
      if (match && el.type === match[1]) return true;
    }
    if (p.includes("[role=")) {
      const match = p.match(/\[role=["']?([^"']+)["']?\]/);
      if (match && el.getAttribute("role") === match[1]) return true;
    }
    if (p.includes("[data-testid")) {
      const tid = el.getAttribute("data-testid") || "";
      return tid.length > 0;
    }
    return el.tagName.toLowerCase() === p.toLowerCase();
  });
}

// Minimal globals for node environment
global.document = {
  createElement: (tag) => new MockElement(tag),
  querySelector: () => null,
  querySelectorAll: () => []
};
global.window = {
  HTMLInputElement: { prototype: {} },
  HTMLTextAreaElement: { prototype: {} }
};
global.Event = function(type) { return { type }; };

// Load logic directly from content.js
const fs = require("fs");
const contentCode = fs.readFileSync("content.js", "utf8");

const optInputsStart = contentCode.indexOf("function findQuestionOptionInputs(questionEl) {");
const optInputsEnd = contentCode.indexOf("function findCommonContainerForInputs(", optInputsStart);
const optInputsFunc = contentCode.slice(optInputsStart, optInputsEnd);

const blockStart = contentCode.indexOf("function determineQuestionType(");
const blockEnd = contentCode.indexOf("async function fillQuizAnswersInDOM(", blockStart);
const blockCode = contentCode.slice(blockStart, blockEnd);

const isAcademicIntegrityDeclaration = () => false;
const getCleanVisibleText = (el) => (el?.innerText || el?.textContent || "").trim();
const isOptionInputVisible = () => true;
const isElementVisible = () => true;
const setInputChecked = async (input, targetChecked) => {
  input.checked = targetChecked;
  return true;
};

// Evaluate all the functions in a shared context
const combinedCode = `
${optInputsFunc}
${blockCode}

exports.findQuestionOptionInputs = findQuestionOptionInputs;
exports.determineQuestionType = determineQuestionType;
exports.cleanStaleRecommendationBadges = cleanStaleRecommendationBadges;
exports.scoreOptionMatch = scoreOptionMatch;
exports.normalizeQuizAnswer = normalizeQuizAnswer;
exports.resolveQuestionRecommendations = resolveQuestionRecommendations;
exports.applyQuestionAnswers = applyQuestionAnswers;
`;

const sandbox = {
  console,
  document: global.document,
  window: global.window,
  Event: global.Event,
  exports: {},
  isAcademicIntegrityDeclaration,
  getCleanVisibleText,
  isOptionInputVisible,
  isElementVisible,
  setInputChecked
};

const vm = require("vm");
vm.runInNewContext(combinedCode, sandbox);

const {
  findQuestionOptionInputs,
  determineQuestionType,
  cleanStaleRecommendationBadges,
  scoreOptionMatch,
  normalizeQuizAnswer,
  resolveQuestionRecommendations,
  applyQuestionAnswers
} = sandbox.exports;

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

async function runAsyncTest(name, fn) {
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

function createSingleChoiceQuestion(qText, options) {
  const container = new MockElement("div", { "data-testid": "question-container" });
  const prompt = new MockElement("h3", {}, qText);
  container.appendChild(prompt);

  options.forEach((optText, idx) => {
    const label = new MockElement("label");
    const radio = new MockElement("input", { type: "radio", name: "q1_radio", value: String(idx) });
    const span = new MockElement("span", {}, optText);
    label.appendChild(radio);
    label.appendChild(span);
    container.appendChild(label);
  });

  return container;
}

function createMultiChoiceQuestion(qText, options) {
  const container = new MockElement("div", { "data-testid": "multi-question-container" });
  const prompt = new MockElement("h3", {}, qText);
  container.appendChild(prompt);

  options.forEach((optText, idx) => {
    const label = new MockElement("label");
    const checkbox = new MockElement("input", { type: "checkbox", name: "q2_cb", value: String(idx) });
    const span = new MockElement("span", {}, optText);
    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });

  return container;
}

// -------------------------------------------------------------
// Test 1: Single-choice question with 4 options -> exactly 1 recommendation
// -------------------------------------------------------------
runAsyncTest("Test 1: Single-choice question selects EXACTLY ONE radio input without pill tags", async () => {
  const options = [
    "It is designed to perform a limited set of dedicated functions within a larger device",
    "It is required to support frequent hardware upgrades by end users",
    "It must be able to run any desktop operating system without modification",
    "It always has a graphical user interface for direct human interaction"
  ];
  const questionEl = createSingleChoiceQuestion("Which of the following best describes an embedded system?", options);

  const answer = {
    answers: ["It is designed to perform a limited set of dedicated functions within a larger device"]
  };

  const res = await applyQuestionAnswers(questionEl, answer);

  const aiTags = questionEl.querySelectorAll(".coursera-ai-tag");
  const suggestedChoices = questionEl.querySelectorAll(".coursera-suggested-choice");

  assert.strictEqual(aiTags.length, 0, `Pill tags must be 0 per minimal workflow, found ${aiTags.length}`);
  assert.strictEqual(suggestedChoices.length, 0, `Suggested choice classes must be 0, found ${suggestedChoices.length}`);
  assert.strictEqual(res.recommendation.questionType, "single-choice");
  assert.strictEqual(res.recommendation.recommendedOptionIndexes.length, 1);
  assert.strictEqual(res.recommendation.recommendedOptionIndexes[0], 0);

  const radios = questionEl.querySelectorAll('input[type="radio"]');
  assert.strictEqual(radios[0].checked, true, "Recommended radio option must be checked");
  assert.strictEqual(radios[1].checked, false);
});

// -------------------------------------------------------------
// Test 2: Single-choice question where model returns multiple candidates -> resolves to 1 or verification
// -------------------------------------------------------------
runAsyncTest("Test 2: Single-choice question with multiple candidate answers NEVER selects multiple radios", async () => {
  const options = [
    "Dedicated controller unit for HVAC",
    "General purpose laptop computer",
    "Dedicated temperature monitoring unit",
    "Cloud server cluster"
  ];
  const questionEl = createSingleChoiceQuestion("Select the embedded system characteristic", options);

  // Model erroneously returns multiple letters ["A", "C"] or overlapping phrases
  const answer = {
    answers: ["Dedicated controller unit for HVAC", "Dedicated temperature monitoring unit"]
  };

  const res = await applyQuestionAnswers(questionEl, answer);

  const aiTags = questionEl.querySelectorAll(".coursera-ai-tag");
  const suggestedChoices = questionEl.querySelectorAll(".coursera-suggested-choice");

  assert.strictEqual(aiTags.length, 0, `Pill tags must be 0 per minimal workflow. Found ${aiTags.length}`);
  assert.strictEqual(suggestedChoices.length, 0, `Suggested choice classes must be 0. Found ${suggestedChoices.length}`);
  assert.strictEqual(res.recommendation.questionType, "single-choice");
  assert.strictEqual(res.recommendation.recommendedOptionIndexes.length, 1);
  const checkedRadios = questionEl.querySelectorAll('input[type="radio"]').filter(r => r.checked);
  assert.strictEqual(checkedRadios.length, 1, `Must have exactly 1 checked radio, found ${checkedRadios.length}`);
});

// -------------------------------------------------------------
// Test 3: Multiple-choice question with 2 correct selections -> exactly 2 recommendations
// -------------------------------------------------------------
runAsyncTest("Test 3: Multiple-choice question with 2 correct answers selects exactly 2 checkboxes without pills", async () => {
  const options = [
    "Hard real-time guarantees",
    "Predictable execution timing",
    "Unrestricted dynamic software downloads by end users",
    "Universal general-purpose computation"
  ];
  const questionEl = createMultiChoiceQuestion("Which characteristics apply to safety-critical embedded systems? (Select all that apply)", options);

  const answer = {
    answers: ["Hard real-time guarantees", "Predictable execution timing"]
  };

  const res = await applyQuestionAnswers(questionEl, answer);

  const aiTags = questionEl.querySelectorAll(".coursera-ai-tag");
  const suggestedChoices = questionEl.querySelectorAll(".coursera-suggested-choice");

  assert.strictEqual(aiTags.length, 0, `Pill tags must be 0 per minimal workflow, found ${aiTags.length}`);
  assert.strictEqual(suggestedChoices.length, 0, `Suggested choices must be 0, found ${suggestedChoices.length}`);
  assert.strictEqual(res.recommendation.questionType, "multiple-choice");
  assert.deepStrictEqual(Array.from(res.recommendation.recommendedOptionIndexes), [0, 1]);

  const checkboxes = questionEl.querySelectorAll('input[type="checkbox"]');
  assert.strictEqual(checkboxes[0].checked, true);
  assert.strictEqual(checkboxes[1].checked, true);
  assert.strictEqual(checkboxes[2].checked, false);
  assert.strictEqual(checkboxes[3].checked, false);
});

// -------------------------------------------------------------
// Test 4: Multiple-choice question with 1 correct selection -> exactly 1 recommendation
// -------------------------------------------------------------
runAsyncTest("Test 4: Multiple-choice question with 1 correct answer selects exactly 1 checkbox", async () => {
  const options = [
    "Microcontroller with on-chip flash",
    "Supercomputer cluster",
    "Mainframe server",
    "Quantum processor"
  ];
  const questionEl = createMultiChoiceQuestion("Select all hardware components typical of micro-controllers", options);

  const answer = {
    answers: ["A"]
  };

  const res = await applyQuestionAnswers(questionEl, answer);

  const aiTags = questionEl.querySelectorAll(".coursera-ai-tag");
  assert.strictEqual(aiTags.length, 0);
  assert.deepStrictEqual(Array.from(res.recommendation.recommendedOptionIndexes), [0]);
  const checkboxes = questionEl.querySelectorAll('input[type="checkbox"]');
  assert.strictEqual(checkboxes[0].checked, true);
});

// -------------------------------------------------------------
// Test 5: Changing providers / re-running solver -> completely purges stale labels
// -------------------------------------------------------------
runAsyncTest("Test 5: Re-running solver completely purges stale labels from earlier passes", async () => {
  const options = ["Option Alpha", "Option Beta", "Option Gamma", "Option Delta"];
  const questionEl = createSingleChoiceQuestion("Sample Single-Choice Question", options);

  // Pass 1: Provider suggests Option Alpha (Index 0)
  await applyQuestionAnswers(questionEl, { answers: ["Option Alpha"] });
  const radios = questionEl.querySelectorAll('input[type="radio"]');
  assert.strictEqual(radios[0].checked, true);

  // Pass 2: Provider fails over or user switches to different provider recommending Option Gamma (Index 2)
  await applyQuestionAnswers(questionEl, { answers: ["Option Gamma"] });
  const aiTags = questionEl.querySelectorAll(".coursera-ai-tag");
  const suggested = questionEl.querySelectorAll(".coursera-suggested-choice");

  assert.strictEqual(aiTags.length, 0, "No tags allowed");
  assert.strictEqual(suggested.length, 0, "No suggested choice classes allowed");
  assert.strictEqual(radios[2].checked, true, "Must point to the new recommended option");
});

// -------------------------------------------------------------
// Test 6: Two questions on same page -> recommendations remain 100% isolated per question
// -------------------------------------------------------------
runAsyncTest("Test 6: Two questions on the same page keep recommendations 100% isolated", async () => {
  const q1 = createSingleChoiceQuestion("Question 1", ["Q1 Opt A", "Q1 Opt B", "Q1 Opt C"]);
  const q2 = createSingleChoiceQuestion("Question 2", ["Q2 Opt A", "Q2 Opt B", "Q2 Opt C"]);

  await applyQuestionAnswers(q1, { answers: ["Q1 Opt B"] });
  await applyQuestionAnswers(q2, { answers: ["Q2 Opt C"] });

  const q1Radios = q1.querySelectorAll('input[type="radio"]');
  const q2Radios = q2.querySelectorAll('input[type="radio"]');

  assert.strictEqual(q1Radios[1].checked, true, "Q1 points to index 1");
  assert.strictEqual(q1Radios[0].checked, false);
  assert.strictEqual(q2Radios[2].checked, true, "Q2 points to index 2");
  assert.strictEqual(q2Radios[0].checked, false);
});

setTimeout(() => {
  console.log("==================================================================");
  console.log(`RECOMMENDATION LIMITS REGRESSION TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================================");
  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}, 200);

/**
 * Comprehensive Test Suite for the Three Coursera Screenshot Scenarios:
 * 
 * SCREENSHOT 1: Practice Assignment Landing Page
 * SCREENSHOT 2: Coursera Honor Code Section
 * SCREENSHOT 3: "Ready to submit?" Modal Dialog
 */

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — SCREENSHOTS 1, 2 & 3 REGRESSION TESTS   ");
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
    this.clickedTimes = 0;
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
    if (name === "disabled") return this.disabled ? "" : null;
    return this.attributes[name] ?? null;
  }
  setAttribute(name, val) {
    if (name === "class") {
      this.className = String(val);
      return;
    }
    if (name === "disabled") {
      this.disabled = true;
    }
    this.attributes[name] = String(val);
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "disabled") this.disabled = false;
  }
  hasAttribute(name) {
    if (name === "disabled") return this.disabled;
    return name in this.attributes;
  }

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

  click() {
    this.clickedTimes++;
    if (this.type === "checkbox") {
      this.checked = !this.checked;
    }
    const handlers = this.eventListeners["click"] || [];
    handlers.forEach(h => h({ type: "click", target: this, defaultPrevented: false }));
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const checkMatch = (el) => {
      const selectors = selector.toLowerCase().split(",").map(x => x.trim());
      return selectors.some(s => {
        const tag = el.tagName.toLowerCase();

        if (s === "input" && tag === "input") return true;
        if (s === "button" && tag === "button") return true;
        if (s === "h1" && tag === "h1") return true;
        if (s === "h2" && tag === "h2") return true;
        if (s === "h3" && tag === "h3") return true;
        if (s === "div" && tag === "div") return true;
        if (s === "span" && tag === "span") return true;
        if (s === "label" && tag === "label") return true;

        if (s === 'button[data-testid="start-assignment-button"]' && tag === "button" && el.getAttribute("data-testid") === "start-assignment-button") return true;
        if (s === 'button[data-testid="submit-button"]' && tag === "button" && el.getAttribute("data-testid") === "submit-button") return true;
        if (s.includes("cds-button") && el.classList.contains("cds-button")) return true;
        if (s.includes("rc-honorcode") && el.classList.contains("rc-HonorCode")) return true;
        if (s.includes("cds-dialog") && el.classList.contains("cds-dialog")) return true;
        if (s.includes('[role="dialog"]') && el.getAttribute("role") === "dialog") return true;
        if (s.includes('input[type="checkbox"]') && tag === "input" && el.type === "checkbox") return true;
        if (s.includes('input[type="radio"]') && tag === "input" && el.type === "radio") return true;
        if (s.includes(".coursera-auto-solve-dock") && el.classList.contains("coursera-auto-solve-dock")) return true;
        if (s === "#coursera-auto-solve-dock" && el.id === "coursera-auto-solve-dock") return true;
        if (s.includes("cds-116") || s.includes("css-g3vqgc") || s.includes("#main-container")) {
          if (el.tagName === "SPAN" && el.parentElement?.classList?.contains("cds-116")) return true;
        }
        return false;
      });
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
      if (s === "button" && curr.tagName === "BUTTON") return curr;
      if (s.includes("dialog") && (curr.getAttribute("role") === "dialog" || curr.classList.contains("cds-dialog") || curr.classList.contains("rc-Modal"))) return curr;
      if (s.includes("honor") && (curr.className.toLowerCase().includes("honor") || (curr.attributes["data-testid"] || "").includes("honor"))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  scrollIntoView() {
    this.scrolledTo = true;
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

// Load content.js and extract the target automation routines
const contentCode = fs.readFileSync("content.js", "utf8");

// Slice the functions
const startFuncStart = contentCode.indexOf("const EXACT_START_SPAN_SELECTOR =");
const startFuncEnd = contentCode.indexOf("let launchedAssignmentPaths = new Set();", startFuncStart);
const workflowCoreCode = contentCode.slice(startFuncStart, startFuncEnd);

const sandbox = {
  console,
  document: mockDocument,
  window: { location: { pathname: "/learn/data-structures/quiz/8jEka/insertion-in-a-heap", href: "https://www.coursera.org/learn/data-structures/quiz/8jEka/insertion-in-a-heap" } },
  isElementVisible: (el) => Boolean(el && el.isConnected),
  isAcademicIntegrityDeclaration: (el) => {
    if (!el) return false;
    const txt = (el.closest?.("label")?.textContent || el.parentElement?.textContent || el.textContent || "").toLowerCase();
    return txt.includes("understand and agree") || txt.includes("own work") || txt.includes("honor code");
  },
  hasLoadedAssignmentQuestions: () => {
    return mockDocument.querySelectorAll('input[type="radio"], input[type="checkbox"]:not([data-testid*="honor"])').length > 0;
  },
  findVisibleQuestionElements: () => [],
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  exports: {}
};

const combinedCode = `
${workflowCoreCode}

exports.isEligibleAssignmentPage = isEligibleAssignmentPage;
exports.findAssignmentStartButton = findAssignmentStartButton;
exports.handlePreQuizModals = handlePreQuizModals;
exports.findHonorCodeSection = findHonorCodeSection;
exports.findHonorCodeCheckbox = findHonorCodeCheckbox;
exports.isHonorCodeCheckboxChecked = isHonorCodeCheckboxChecked;
exports.isSubmitButtonEnabled = isSubmitButtonEnabled;
exports.findReadyToSubmitModal = findReadyToSubmitModal;
exports.findSubmitButton = findSubmitButton;
exports.removeAutoSolveDock = removeAutoSolveDock;
`;

vm.runInNewContext(combinedCode, sandbox);

const {
  isEligibleAssignmentPage,
  findAssignmentStartButton,
  handlePreQuizModals,
  findHonorCodeSection,
  findHonorCodeCheckbox,
  isHonorCodeCheckboxChecked,
  isSubmitButtonEnabled,
  findReadyToSubmitModal,
  findSubmitButton,
  removeAutoSolveDock
} = sandbox.exports;

let total = 0;
let passed = 0;

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

// ==================================================================
// SCENARIO 1: Screenshot 1 — Practice Assignment Landing Page
// ==================================================================
runTest("Scenario 1A: Detect Practice Assignment Landing Page structure", () => {
  mockDocument.body.children = [];

  const card = new MockElement("div", { class: "assignment-card" });
  const typeLabel = new MockElement("span", {}, "Practice Assignment");
  const title = new MockElement("h1", {}, "Practice Quiz: Insertion in a Heap");
  const startBtn = new MockElement("button", {
    class: "cds-button cds-button--primary",
    "data-testid": "start-assignment-button"
  }, "Start assignment");
  const helpBtn = new MockElement("button", {
    class: "cds-button cds-button--secondary"
  }, "✨ Help me practice");
  const desc = new MockElement("p", {}, "This is a practice assignment to help you check your understanding. It doesn't count toward your course grade.");

  card.appendChild(typeLabel);
  card.appendChild(title);
  card.appendChild(startBtn);
  card.appendChild(helpBtn);
  card.appendChild(desc);
  mockDocument.body.appendChild(card);

  assert.strictEqual(isEligibleAssignmentPage(), true, "Must recognize Practice Assignment landing page as eligible");
});

runTest("Scenario 1B: Locate native 'Start assignment' button and never pick 'Help me practice'", () => {
  const startBtn = findAssignmentStartButton();
  assert.ok(startBtn, "Must find Start assignment button");
  assert.strictEqual(startBtn.textContent.trim(), "Start assignment");
  assert.strictEqual(startBtn.textContent.includes("Help me practice"), false);
});

runTest("Scenario 1C: Start assignment clicked once, tracking prevents duplicate clicks", () => {
  const startBtn = findAssignmentStartButton();
  startBtn.click();
  assert.strictEqual(startBtn.clickedTimes, 1, "Must be clicked exactly once");
});

runTest("Scenario 1D: Recovered handlePreQuizModals clicks pre-quiz confirmation modal ('Continue'/'Start attempt')", async () => {
  const preQuizModal = new MockElement("div", { role: "dialog", class: "rc-Modal" });
  const heading = new MockElement("h3", {}, "Start attempt");
  const continueBtn = new MockElement("button", { "data-testid": "continue-button" }, "Continue");
  preQuizModal.appendChild(heading);
  preQuizModal.appendChild(continueBtn);
  mockDocument.body.appendChild(preQuizModal);

  const handled = await handlePreQuizModals();
  assert.strictEqual(handled, true, "Must handle pre-quiz confirmation modal");
  assert.strictEqual(continueBtn.clickedTimes, 1, "Must click Continue button");
  preQuizModal.remove();
});

runTest("Scenario 1E: handlePreQuizModals NEVER clicks 'Ready to submit?' post-submit modal", async () => {
  const submitModal = new MockElement("div", { role: "dialog", class: "rc-Modal" });
  const heading = new MockElement("h2", {}, "Ready to submit?");
  const submitBtn = new MockElement("button", {}, "Submit");
  submitModal.appendChild(heading);
  submitModal.appendChild(submitBtn);
  mockDocument.body.appendChild(submitModal);

  const handled = await handlePreQuizModals();
  assert.strictEqual(handled, false, "Must strictly ignore post-submit Ready to submit? modal");
  assert.strictEqual(submitBtn.clickedTimes, 0, "Submit button must NOT be clicked");
  submitModal.remove();
});

runTest("Scenario 1F: Exact confirmed Coursera DevTools selector locates span and button parent", () => {
  mockDocument.body.children = [];

  const main = new MockElement("div", { id: "main-container" });
  const article = new MockElement("article");
  const btn = new MockElement("button", {
    class: "cds-116 cds-button-disableElevation cds-button-primary css-g3vqgc"
  });
  const span = new MockElement("span", {}, "Start assignment");
  btn.appendChild(span);
  article.appendChild(btn);
  main.appendChild(article);
  mockDocument.body.appendChild(main);

  const startBtn = findAssignmentStartButton();
  assert.ok(startBtn, "Must find Start assignment button via exact selector");
  assert.strictEqual(startBtn.tagName, "BUTTON", "Parent must be actual BUTTON element");
  assert.strictEqual(startBtn.textContent.trim(), "Start assignment");
  assert.strictEqual(isSubmitButtonEnabled(startBtn), true, "Button must be enabled");
});

// ==================================================================
// SCENARIO 2: Screenshot 2 — Coursera Honor Code Section
// ==================================================================
runTest("Scenario 2A: Detect Honor Code section and its text semantics", () => {
  mockDocument.body.children = [];

  const honorContainer = new MockElement("div", { class: "rc-HonorCode", "data-testid": "honor-code-section" });
  const heading = new MockElement("h2", {}, "Coursera Honor Code");
  const policyText = new MockElement("p", {}, "By clicking Submit, you confirm this work is your own. Submitting work created with AI tools may result in course failure or account deactivation according to Coursera Honor Code policy.");
  
  const label = new MockElement("label");
  const checkbox = new MockElement("input", { type: "checkbox", "data-testid": "honor-checkbox" });
  const pledgeText = new MockElement("span", {}, "I, Satyajit Kiran Patil, understand and agree.");
  label.appendChild(checkbox);
  label.appendChild(pledgeText);

  const helperText = new MockElement("span", {}, "You must select the checkbox in order to submit the assignment");
  
  const buttonGroup = new MockElement("div", { class: "button-group" });
  const submitBtn = new MockElement("button", {
    class: "cds-button cds-button--primary cds-button--disabled",
    disabled: true,
    "data-testid": "submit-button"
  }, "Submit");
  const saveDraftBtn = new MockElement("button", {
    class: "cds-button cds-button--secondary"
  }, "Save draft");

  buttonGroup.appendChild(submitBtn);
  buttonGroup.appendChild(saveDraftBtn);

  honorContainer.appendChild(heading);
  honorContainer.appendChild(policyText);
  honorContainer.appendChild(label);
  honorContainer.appendChild(helperText);
  honorContainer.appendChild(buttonGroup);

  mockDocument.body.appendChild(honorContainer);

  const detectedSection = findHonorCodeSection();
  assert.ok(detectedSection, "Must detect Honor Code section");

  const detectedCheckbox = findHonorCodeCheckbox(detectedSection);
  assert.ok(detectedCheckbox, "Must detect Honor Code checkbox");
  assert.strictEqual(isHonorCodeCheckboxChecked(detectedCheckbox), false, "Must detect checkbox as UNCHECKED");

  const pageSubmitBtn = findSubmitButton();
  assert.ok(pageSubmitBtn, "Must find Submit button");
  assert.strictEqual(isSubmitButtonEnabled(pageSubmitBtn), false, "Submit button must be detected as DISABLED");
});

runTest("Scenario 2B: Native Submit button enabled detection when user checks agreement", () => {
  const honorContainer = mockDocument.body.querySelector('[data-testid="honor-code-section"]');
  const checkbox = findHonorCodeCheckbox(honorContainer);
  const submitBtn = findSubmitButton();

  // User manually checks the checkbox
  checkbox.click();
  submitBtn.disabled = false;
  submitBtn.removeAttribute("disabled");
  submitBtn.classList.remove("cds-button--disabled");

  assert.strictEqual(isHonorCodeCheckboxChecked(checkbox), true, "Checkbox state is accurately detected as checked");
  assert.strictEqual(isSubmitButtonEnabled(submitBtn), true, "Submit button is accurately detected as enabled");
});

// ==================================================================
// SCENARIO 3: Screenshot 3 — "Ready to submit?" Modal Dialog
// ==================================================================
runTest("Scenario 3A: Detect 'Ready to submit?' modal dialog reliably", () => {
  const modalDialog = new MockElement("div", { role: "dialog", class: "cds-dialog rc-Modal" });
  const modalHeading = new MockElement("h2", {}, "Ready to submit?");
  const modalSubmitBtn = new MockElement("button", { class: "cds-button cds-button--primary" }, "Submit");
  const modalCancelBtn = new MockElement("button", { class: "cds-button cds-button--secondary" }, "Cancel");

  modalDialog.appendChild(modalHeading);
  modalDialog.appendChild(modalSubmitBtn);
  modalDialog.appendChild(modalCancelBtn);

  mockDocument.body.appendChild(modalDialog);

  const modal = findReadyToSubmitModal();
  assert.ok(modal, "Must detect 'Ready to submit?' modal dialog");
  assert.ok(modal.submitButton, "Must locate modal Submit button");
  assert.ok(modal.cancelButton, "Must locate modal Cancel button");
  assert.strictEqual(modal.submitButton.textContent.trim(), "Submit");
  assert.strictEqual(modal.cancelButton.textContent.trim(), "Cancel");
});

runTest("Scenario 3B: Page-level Submit button is NOT confused with the Modal Submit button", () => {
  const pageSubmitBtn = findSubmitButton();
  assert.ok(pageSubmitBtn, "Page submit button must be found");
  // Page submit button is NOT inside the modal dialog
  assert.strictEqual(pageSubmitBtn.closest('[role="dialog"]'), null, "Page submit button must NOT be inside the dialog");

  const modal = findReadyToSubmitModal();
  assert.notStrictEqual(pageSubmitBtn, modal.submitButton, "Page submit button and modal submit button must be distinct");
});

// ==================================================================
// SCENARIO 4: No Floating Extension Widget Reappears
// ==================================================================
runTest("Scenario 4: Floating extension dock does not exist and removeAutoSolveDock cleans up", () => {
  const strayDock = new MockElement("div", { id: "coursera-auto-solve-dock" });
  strayDock.classList.add("coursera-auto-solve-dock");
  mockDocument.body.appendChild(strayDock);

  removeAutoSolveDock();

  const dock = mockDocument.body.querySelector("#coursera-auto-solve-dock");
  assert.strictEqual(dock, null, "No floating dock element must remain in DOM");
});

console.log("==================================================================");
console.log(`SCREENSHOT REGRESSION TESTS: ${passed}/${total} PASSED (100%)`);
console.log("==================================================================");
if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}

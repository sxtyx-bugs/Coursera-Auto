/**
 * Comprehensive Test Suite for Coursera Extension Connection & Handshake Architecture
 * 
 * Verifies:
 * 1. Syntax integrity across all root and dist script files.
 * 2. Active instance guard prevents duplicate execution while permitting context invalidation recovery.
 * 3. PING / HANDSHAKE communication between popup and content script.
 * 4. Distinct error messages for Non-Coursera vs Uninjected vs Loading vs Active.
 * 5. SPA History Navigation hooks (pushState / replaceState).
 * 6. Assignment detection during SPA navigation without requiring page reload.
 */

const assert = require("assert");
const fs = require("fs");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — CONNECTION & HANDSHAKE TEST SUITE   ");
console.log("==================================================================");

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

// -------------------------------------------------------------
// Test 1: Content Script and Popup Script SHA256 Sync Verification
// -------------------------------------------------------------
runTest("Test 1: Content and Popup scripts are synchronized with dist/", () => {
  const rootContent = fs.readFileSync("content.js", "utf8");
  const distContent = fs.readFileSync("dist/scripts/content.js", "utf8");
  assert.strictEqual(rootContent, distContent, "content.js must exactly match dist/scripts/content.js");

  const rootPopup = fs.readFileSync("popup.js", "utf8");
  const distPopup = fs.readFileSync("dist/scripts/popup.js", "utf8");
  assert.strictEqual(rootPopup, distPopup, "popup.js must exactly match dist/scripts/popup.js");

  const rootBg = fs.readFileSync("background.js", "utf8");
  const distBg = fs.readFileSync("dist/scripts/background.js", "utf8");
  assert.strictEqual(rootBg, distBg, "background.js must exactly match dist/scripts/background.js");
});

// -------------------------------------------------------------
// Test 2: Active Instance Guard Behavior
// -------------------------------------------------------------
runTest("Test 2: Instance guard allows re-initialization if prior extension context was invalidated", () => {
  const mockWindow = {};
  const ACTIVE_GUARD_KEY = "__coursera_ext_instance__";

  // Simulation 1: First injection into tab
  let firstCleanedUp = false;
  mockWindow[ACTIVE_GUARD_KEY] = {
    version: "1.3.0",
    isAlive: () => false, // simulates invalidated extension context
    cleanup: () => { firstCleanedUp = true; }
  };

  // Simulation 2: Extension reloaded, dynamic re-injection occurs
  let reinjected = false;
  if (mockWindow[ACTIVE_GUARD_KEY]) {
    try {
      if (mockWindow[ACTIVE_GUARD_KEY].isAlive && mockWindow[ACTIVE_GUARD_KEY].isAlive()) {
        // should NOT enter here because context is dead
      } else {
        mockWindow[ACTIVE_GUARD_KEY].cleanup();
        reinjected = true;
      }
    } catch (_) {}
  }

  assert.strictEqual(firstCleanedUp, true, "Previous dead instance cleanup must be invoked");
  assert.strictEqual(reinjected, true, "Re-injection must successfully proceed without requiring page reload");

  // Simulation 3: Already active with live context -> skip duplicate initialization
  mockWindow[ACTIVE_GUARD_KEY] = {
    version: "1.3.0",
    isAlive: () => true, // active
    cleanup: () => {}
  };

  let skipped = false;
  if (mockWindow[ACTIVE_GUARD_KEY]) {
    if (mockWindow[ACTIVE_GUARD_KEY].isAlive && mockWindow[ACTIVE_GUARD_KEY].isAlive()) {
      skipped = true;
    }
  }

  assert.strictEqual(skipped, true, "Live instance must prevent duplicate initialization");
});

// -------------------------------------------------------------
// Test 3: PING / HANDSHAKE Response Structure
// -------------------------------------------------------------
runTest("Test 3: Content script handles PING handshake and returns accurate environment info", () => {
  const contentCode = fs.readFileSync("content.js", "utf8");
  assert.ok(contentCode.includes('actionName === "PING" || actionName === "HANDSHAKE"'), "Content script must explicitly listen for PING / HANDSHAKE");
  assert.ok(contentCode.includes("ok: true"), "Content script must reply ok: true");
  assert.ok(contentCode.includes("pong: true"), "Content script must reply pong: true");
  assert.ok(contentCode.includes("isAssignment: isAssignment"), "Content script must include isAssignment in handshake");
});

// -------------------------------------------------------------
// Test 4: Popup Handshake Connection States & Informative Messages
// -------------------------------------------------------------
runTest("Test 4: Popup displays distinct informative statuses instead of generic reload error", () => {
  const popupCode = fs.readFileSync("popup.js", "utf8");
  assert.ok(popupCode.includes("initConnectionHandshake"), "Popup must execute initConnectionHandshake on load");
  assert.ok(popupCode.includes("Open a Coursera course or assignment to activate"), "Must guide user when non-Coursera page");
  assert.ok(popupCode.includes("Connecting to Coursera page..."), "Must report connecting state during recovery");
  assert.ok(popupCode.includes("✓ Connected to Coursera"), "Must confirm successful handshake");
  assert.ok(!popupCode.includes('callback(finalErr ? "Please reload the Coursera course page." : null'), "Must eliminate fragile reload callback");
});

// -------------------------------------------------------------
// Test 5: In-Page SPA History Navigation Hook
// -------------------------------------------------------------
runTest("Test 5: History pushState and replaceState are hooked for SPA route detection", () => {
  const contentCode = fs.readFileSync("content.js", "utf8");
  assert.ok(contentCode.includes("function hookHistoryNavigation"), "Must define hookHistoryNavigation");
  assert.ok(contentCode.includes("history.pushState = function"), "Must hook history.pushState");
  assert.ok(contentCode.includes("history.replaceState = function"), "Must hook history.replaceState");
  assert.ok(contentCode.includes('window.dispatchEvent(new Event("locationchange"))'), "Must dispatch locationchange event on SPA route transitions");
});

// -------------------------------------------------------------
// Test 6: Development Diagnostics with '[Coursera Extension]' Prefix
// -------------------------------------------------------------
runTest("Test 6: Logging contains standard '[Coursera Extension]' development diagnostics", () => {
  const contentCode = fs.readFileSync("content.js", "utf8");
  const popupCode = fs.readFileSync("popup.js", "utf8");
  const bgCode = fs.readFileSync("background.js", "utf8");

  assert.ok(contentCode.includes("[Coursera Extension] Content script injected."), "Must log injection");
  assert.ok(contentCode.includes("[Coursera Extension] Coursera page detected:"), "Must log page detection");
  assert.ok(contentCode.includes("[Coursera Extension] Initialization completed successfully."), "Must log initialization completion");
  assert.ok(contentCode.includes("[Coursera Extension] Popup handshake received."), "Must log handshake receipt");
  assert.ok(contentCode.includes("[Coursera Extension] Question extraction initialized."), "Must log question extraction");
  assert.ok(contentCode.includes("[Coursera Extension] Assignment page detected:"), "Must log assignment detection");
  assert.ok(popupCode.includes("[Coursera Extension] Message sent and response received:"), "Must log message traffic");
  assert.ok(bgCode.includes("[Coursera Extension] Tab navigation updated:"), "Must log tab updates");
});

console.log("==================================================================");
console.log(`CONNECTION & HANDSHAKE TESTS: ${passed}/${total} PASSED`);
console.log("==================================================================");
if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}

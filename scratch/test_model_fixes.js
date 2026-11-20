const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

console.log("==================================================================");
console.log("TESTING GEMINI 3.5/3.8 PRIMARY AND WORKING GROQ RECOVERY");
console.log("==================================================================");

// Load content script context
const contentScript = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");

// Mock browser globals
class MockDOMNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.isConnected = true;
    this.classList = {
      contains: () => false,
      add: () => {},
      remove: () => {}
    };
  }
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  JSON,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Set,
  Map,
  Promise,
  window: {
    location: { href: "https://www.coursera.org/learn/test/exam/123/attempt", pathname: "/learn/test/exam/123/attempt" },
    addEventListener: () => {}
  },
  document: {
    body: new MockDOMNode("body"),
    documentElement: new MockDOMNode("html"),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null
  },
  chrome: {
    runtime: {
      getManifest: () => ({ version: "2.5.0" }),
      sendMessage: (msg, cb) => cb && cb({ ok: true }),
      onMessage: { addListener: () => {} }
    },
    storage: {
      local: { get: (k, cb) => cb({}), set: (d, cb) => cb && cb() },
      sync: { get: (k, cb) => cb({}), set: (d, cb) => cb && cb() }
    }
  }
};

const ctx = vm.createContext(sandbox);

// Extract AI Solver classes
const startIdx = contentScript.indexOf("async function performAiProxyRequest(");
const endIdx = contentScript.indexOf("const aiSolverInstance = new MultiProviderAISolver();");
const slice = contentScript.slice(startIdx, endIdx);

const wrapped = `
  ${slice}
  this.GeminiProvider = GeminiProvider;
  this.GroqProvider = GroqProvider;
  this.MultiProviderAISolver = MultiProviderAISolver;
  this.setProxy = (fn) => { performAiProxyRequest = fn; };
`;

vm.runInContext(wrapped, ctx);

const { GeminiProvider, GroqProvider, MultiProviderAISolver } = ctx;

(async () => {
  // Test 1: Gemini Model Normalization
  console.log("\n[Test 1] Gemini Model Normalization & Deprecation Protection");
  assert.strictEqual(GeminiProvider.normalizeModelName("gemini-3.5-flash"), "gemini-3.5-flash");
  assert.strictEqual(GeminiProvider.normalizeModelName("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.strictEqual(GeminiProvider.normalizeModelName("models/gemini-3.5-flash"), "gemini-3.5-flash");
  assert.strictEqual(GeminiProvider.normalizeModelName("models/gemini-3.8-flash"), "gemini-3.8-flash");
  assert.strictEqual(GeminiProvider.normalizeModelName("gemini-2.5-flash"), "gemini-2.5-flash");
  // Deprecated 1.5 models must auto-upgrade to 3.5-flash
  assert.strictEqual(GeminiProvider.normalizeModelName("gemini-1.5-flash"), "gemini-3.5-flash");
  assert.strictEqual(GeminiProvider.normalizeModelName("models/gemini-1.5-flash"), "gemini-3.5-flash");
  console.log("✓ PASS: Gemini 3.5 & 3.8 preserved, deprecated models safely upgraded");

  // Test 2: Groq Model Normalization
  console.log("\n[Test 2] Groq Model Normalization & gpt-oss-120b Protection");
  assert.strictEqual(GroqProvider.normalizeModelName("llama-3.3-70b-versatile"), "llama-3.3-70b-versatile");
  assert.strictEqual(GroqProvider.normalizeModelName("llama-3.1-8b-instant"), "llama-3.1-8b-instant");
  // Rate-limited openai/gpt-oss-120b must normalize to versatile
  assert.strictEqual(GroqProvider.normalizeModelName("openai/gpt-oss-120b"), "llama-3.3-70b-versatile");
  assert.strictEqual(GroqProvider.normalizeModelName("gpt-oss-20b"), "llama-3.3-70b-versatile");
  console.log("✓ PASS: Rate-limited Groq models safely intercepted");

  // Test 3: MultiProviderAISolver Defaults
  console.log("\n[Test 3] Solver Defaults & Priority Chain");
  const solver = new MultiProviderAISolver();
  assert.strictEqual(solver.activeProviderId, "gemini", "Gemini must be primary active provider by default");
  assert.strictEqual(solver.priority[0], "gemini", "Priority[0] must be gemini");
  assert.strictEqual(solver.priority[1], "groq", "Priority[1] must be groq");
  assert.strictEqual(solver.providers.gemini.getModel(), "gemini-3.5-flash", "Default Gemini model must be gemini-3.5-flash");
  assert.strictEqual(solver.providers.groq.getModel(), "llama-3.3-70b-versatile", "Default Groq model must be llama-3.3-70b-versatile");
  console.log("✓ PASS: Gemini set as Primary with Groq as #1 failover");

  // Test 4: Gemini 404 Automatic Flash Model Fallback
  console.log("\n[Test 4] Gemini 404 Model Fallback Recovery");
  const gemini = new GeminiProvider({ apiKey: "AIzaSyFakeKey", model: "gemini-3.8-flash" });
  let geminiCallCount = 0;
  ctx.setProxy(async (url, options) => {
    geminiCallCount++;
    if (geminiCallCount === 1) {
      // First attempt on 3.8-flash returns 404 Not Found
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: { message: "models/gemini-3.8-flash is not found" } })
      };
    }
    // Fallback succeeds!
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ results: [{ questionId: "q1", answers: ["Option B"] }] }) }]
          }
        }]
      })
    };
  });

  const geminiAnswers = await gemini.solve([{ question: "What is testing?", options: ["A", "Option B"] }]);
  assert.strictEqual(geminiAnswers.length, 1);
  assert.strictEqual(geminiCallCount, 2, "Must have retried with fallback model after 404");
  console.log("✓ PASS: Gemini 404 auto-fallback successfully recovered");

  // Test 5: Groq 429 Rate Limit Automatic Fallback
  console.log("\n[Test 5] Groq 429 Rate Limit Recovery");
  const groq = new GroqProvider({ apiKey: "gsk_fake", model: "llama-3.3-70b-versatile" });
  let groqCallCount = 0;
  ctx.setProxy(async (url, options) => {
    groqCallCount++;
    if (groqCallCount === 1) {
      // First attempt hits 429 rate limit
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Rate limit reached on tokens per day (TPD)" } })
      };
    }
    // Fallback to llama-3.1-8b-instant succeeds!
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ results: [{ questionId: "q1", answers: ["Coverage"] }] })
          }
        }]
      })
    };
  });

  const groqAnswers = await groq.solve([{ question: "What is coverage?", options: ["Coverage", "Speed"] }]);
  assert.strictEqual(groqAnswers.length, 1);
  assert.strictEqual(groqCallCount, 2, "Must have retried on 8b-instant after 70b hit 429");
  console.log("✓ PASS: Groq 429 rate limit auto-fallback successfully recovered");

  console.log("\n==================================================================");
  console.log("ALL MODEL FIX TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
})();

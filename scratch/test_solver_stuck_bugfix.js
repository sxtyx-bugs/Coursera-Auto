/**
 * Test Suite: Verifying Solver Stuck Bug Fix and Execution Pipeline
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

console.log("==================================================================");
console.log("   COURSERA AUTO SOLVER — PIPELINE & STUCK BUG FIX VERIFICATION   ");
console.log("==================================================================");

const contentCode = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");

function createSandbox(initialUrl = "https://www.coursera.org/learn/data-structures/quiz/8jeka/insertion-in-a-heap/attempt") {
  const urlObj = new URL(initialUrl);

  const elements = [];
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
        href: urlObj.href,
        pathname: urlObj.pathname,
        origin: urlObj.origin
      },
      scrollY: 0,
      innerHeight: 900,
      scrollTo: () => {},
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} }
    },
    document: {
      body: { scrollHeight: 1200 },
      documentElement: { scrollHeight: 1200 },
      querySelectorAll: (sel) => [],
      querySelector: (sel) => null,
      getElementById: (id) => null,
      addEventListener: () => {}
    },
    chrome: {
      runtime: {
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
          get: (keys, cb) => {
            if (cb) cb(sandbox.mockStorage || {});
          },
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
      groqApiKey: "gsk_test_mock_groq_key_9999",
      geminiApiKey: "AIzaSy_mock_gemini_key_8888",
      providersConfig: {
        groq: { apiKey: "gsk_test_mock_groq_key_9999", model: "llama-3.3-70b-versatile", enabled: true },
        gemini: { apiKey: "AIzaSy_mock_gemini_key_8888", model: "gemini-2.0-flash", enabled: true }
      }
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    sleep: (ms) => new Promise(res => setTimeout(res, 5)),
    sanitizeCourseraPromptInjection: (s) => s || "",
    AbortController: global.AbortController,
    Event: global.Event || class {},
    MouseEvent: global.MouseEvent || class {},
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    URL: global.URL
  };

  return sandbox;
}

// Slice out relevant core functions and classes from content.js
const classifyStart = contentCode.indexOf("function classifyCourseraRoute");
const classifyEnd = contentCode.indexOf("function findAssignmentStartButton");
const classifySrc = contentCode.slice(classifyStart, classifyEnd);

const baseProviderStart = contentCode.indexOf("async function performAiProxyRequest");
const baseProviderEnd = contentCode.indexOf("const aiSolverInstance = new MultiProviderAISolver();");
const providersSrc = contentCode.slice(baseProviderStart, baseProviderEnd);

const validationStart = contentCode.indexOf("function isControlGeneratedOrUIMetadata");
const validationEnd = contentCode.indexOf("function validateQuestionCompleteness");
const validationSrc = contentCode.slice(validationStart, contentCode.indexOf("function findVisibleQuestionElements", validationEnd));

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalCount++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

(async () => {
  // Test 1: Active attempt route with background video in DOM is NOT misclassified as supplement
  runTest("1. Active attempt route with video player in DOM is classified as active-attempt", () => {
    const sandbox = createSandbox("https://www.coursera.org/learn/data-structures/quiz/8jeka/insertion-in-a-heap/attempt");
    // Mock video element present in DOM
    sandbox.document.querySelector = (sel) => {
      if (sel.includes("video")) return { tagName: "VIDEO" };
      return null;
    };
    vm.createContext(sandbox);
    vm.runInContext(classifySrc + "\nglobalThis.classifyCourseraRoute = classifyCourseraRoute;", sandbox);

    const route = sandbox.classifyCourseraRoute();
    assert.strictEqual(route.type, "active-attempt");
    assert.strictEqual(route.isAttempt, true);
    assert.strictEqual(route.isSupplement, false);
  });

  // Test 2: GroqProvider audit: request dispatch, 200 response, parsing, key masking
  await runAsyncTest("2. GroqProvider: dispatches request, parses JSON response, logs stages, masks keys", async () => {
    const sandbox = createSandbox();
    let proxyCalled = false;
    let proxyUrl = "";
    let proxyPayload = null;

    sandbox.mockAiProxyHandler = async (url, options, timeoutMs) => {
      proxyCalled = true;
      proxyUrl = url;
      proxyPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                results: [
                  { questionId: "q1", selectedOptionIndexes: [0], explanation: "Heap root definition", confidence: 0.95 }
                ]
              })
            }
          }]
        })
      };
    };

    vm.createContext(sandbox);
    vm.runInContext(providersSrc + "\nglobalThis.GroqProvider = GroqProvider;", sandbox);

    const groq = new sandbox.GroqProvider({
      apiKey: "gsk_secret_12345_test",
      model: "llama-3.3-70b-versatile"
    });

    const stageLogs = [];
    const answers = await groq.solve([{ question: "What is a heap?", options: ["A tree", "A list"] }], 20000, (stage, detail) => {
      stageLogs.push({ stage, detail });
    });

    assert.strictEqual(proxyCalled, true);
    assert.strictEqual(proxyUrl, "https://api.groq.com/openai/v1/chat/completions");
    assert.strictEqual(answers.length, 1);
    assert.strictEqual(answers[0].selectedOptionIndexes[0], 0);

    // Verify stage logs emitted
    const stages = stageLogs.map(s => s.stage);
    assert(stages.includes("request_dispatched"), "Must emit request_dispatched");
    assert(stages.includes("response_received"), "Must emit response_received");
    assert(stages.includes("response_parsed"), "Must emit response_parsed");

    // Verify key masking
    const masked = groq.maskApiKey("Error at gsk_secret_12345_test connection");
    assert(!masked.includes("gsk_secret_12345_test"), "API key must be masked");
    assert(masked.includes("[REDACTED_GROQ_KEY]"), "Must use redacted token");
  });

  // Test 3: GroqProvider error handling: 401 auth error, 429 rate limit
  await runAsyncTest("3. GroqProvider: flags isAuthError on 401/403 and isRateLimit on 429", async () => {
    const sandbox = createSandbox();
    sandbox.mockAiProxyHandler = async () => ({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: { message: "Invalid API Key provided: gsk_secret_12345_test" } })
    });

    vm.createContext(sandbox);
    vm.runInContext(providersSrc + "\nglobalThis.GroqProvider = GroqProvider;", sandbox);

    const groq = new sandbox.GroqProvider({ apiKey: "gsk_secret_12345_test" });
    try {
      await groq.solve([{ question: "Test?", options: ["A", "B"] }]);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.strictEqual(err.isAuthError, true);
      assert.strictEqual(err.status, 401);
      assert(!err.message.includes("gsk_secret_12345_test"), "Key must be masked in error message");
    }

    // Test 429
    sandbox.mockAiProxyHandler = async () => ({
      ok: false,
      status: 429,
      text: JSON.stringify({ error: { message: "Rate limit reached. Quota exhausted." } })
    });
    try {
      await groq.solve([{ question: "Test?", options: ["A", "B"] }]);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.strictEqual(err.isRateLimit, true);
      assert.strictEqual(err.status, 429);
    }
  });

  // Test 4: GeminiProvider audit: request dispatch, 200 response, parsing, key masking
  await runAsyncTest("4. GeminiProvider: dispatches request, handles JSON, logs stages, masks keys", async () => {
    const sandbox = createSandbox();
    let proxyCalled = false;
    let proxyUrl = "";

    sandbox.mockAiProxyHandler = async (url, options, timeoutMs) => {
      proxyCalled = true;
      proxyUrl = url;
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  results: [
                    { questionId: "q1", selectedOptionIndexes: [1], explanation: "O(log n) insertion", confidence: 0.98 }
                  ]
                })
              }]
            }
          }]
        })
      };
    };

    vm.createContext(sandbox);
    vm.runInContext(providersSrc + "\nglobalThis.GeminiProvider = GeminiProvider;", sandbox);

    const gemini = new sandbox.GeminiProvider({
      apiKey: "AIzaSy_mock_secret_key_1234",
      model: "gemini-2.0-flash"
    });

    const stageLogs = [];
    const answers = await gemini.solve([{ question: "Complexity?", options: ["O(1)", "O(log n)"] }], 20000, (stage, detail) => {
      stageLogs.push({ stage, detail });
    });

    assert.strictEqual(proxyCalled, true);
    assert(proxyUrl.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"));
    assert.strictEqual(answers.length, 1);
    assert.strictEqual(answers[0].selectedOptionIndexes[0], 1);

    const stages = stageLogs.map(s => s.stage);
    assert(stages.includes("request_dispatched"));
    assert(stages.includes("response_received"));
    assert(stages.includes("response_parsed"));

    const masked = gemini.maskApiKey("Error at AIzaSy_mock_secret_key_1234");
    assert(!masked.includes("AIzaSy_mock_secret_key_1234"));
    assert(masked.includes("[REDACTED_GEMINI_KEY]"));
  });

  // Test 5: GeminiProvider error handling: 400 API_KEY_INVALID treated as auth error
  await runAsyncTest("5. GeminiProvider: 400 API_KEY_INVALID is recognized as auth error and masked", async () => {
    const sandbox = createSandbox();
    sandbox.mockAiProxyHandler = async () => ({
      ok: false,
      status: 400,
      text: JSON.stringify({
        error: {
          code: 400,
          message: "API_KEY_INVALID. Please pass a valid API key: AIzaSy_mock_secret_key_1234",
          status: "INVALID_ARGUMENT"
        }
      })
    });

    vm.createContext(sandbox);
    vm.runInContext(providersSrc + "\nglobalThis.GeminiProvider = GeminiProvider;", sandbox);

    const gemini = new sandbox.GeminiProvider({ apiKey: "AIzaSy_mock_secret_key_1234" });
    try {
      await gemini.solve([{ question: "Test?", options: ["A", "B"] }]);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.strictEqual(err.isAuthError, true);
      assert(!err.message.includes("AIzaSy_mock_secret_key_1234"));
    }
  });

  // Test 6: MultiProviderAISolver logs all stage timestamps and performs failover without leaking keys
  await runAsyncTest("6. MultiProviderAISolver: emits required diagnostic logs and fails over cleanly", async () => {
    const sandbox = createSandbox();
    const capturedLogs = [];
    sandbox.console.log = (...args) => capturedLogs.push(args.join(" "));

    // Groq fails with 429, Gemini succeeds
    let callCount = 0;
    sandbox.mockAiProxyHandler = async (url) => {
      callCount++;
      if (url.includes("api.groq.com")) {
        return {
          ok: false,
          status: 429,
          text: JSON.stringify({ error: { message: "Groq rate limit exceeded" } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  results: [{ questionId: "q1", selectedOptionIndexes: [0], explanation: "ok", confidence: 0.9 }]
                })
              }]
            }
          }]
        })
      };
    };

    vm.createContext(sandbox);
    vm.runInContext(providersSrc + "\nglobalThis.MultiProviderAISolver = MultiProviderAISolver;", sandbox);

    const solver = new sandbox.MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "groq",
      providerPriority: ["groq", "gemini"],
      groqApiKey: "gsk_test_key_1",
      geminiApiKey: "AIzaSy_test_key_2",
      providersConfig: {
        groq: { apiKey: "gsk_test_key_1", enabled: true },
        gemini: { apiKey: "AIzaSy_test_key_2", enabled: true }
      }
    });

    const res = await solver.solveQuestions(
      [{ question: "What is an algorithm?", options: ["A step-by-step procedure", "A computer"] }],
      null,
      Date.now()
    );

    assert.strictEqual(res.providerName, "Google Gemini");
    assert.strictEqual(res.isFallback, true);
    assert.strictEqual(res.answers.length, 1);

    // Verify stage logs with timestamps exist in capturedLogs
    const hasSelectedGroq = capturedLogs.some(l => l.includes("[Provider]") && l.includes("Selected: Groq"));
    const hasDispatchedGroq = capturedLogs.some(l => l.includes("[Provider]") && l.includes("Request dispatched"));
    const hasResponse429 = capturedLogs.some(l => l.includes("[Provider]") && l.includes("HTTP 429"));
    const hasSelectedGemini = capturedLogs.some(l => l.includes("[Provider]") && l.includes("Selected: Google Gemini"));
    const hasResponse200 = capturedLogs.some(l => l.includes("[Provider]") && l.includes("HTTP 200"));
    const hasParsed = capturedLogs.some(l => l.includes("[Provider]") && l.includes("Response parsed"));

    assert(hasSelectedGroq, "Must log [Provider] Selected: Groq");
    assert(hasDispatchedGroq, "Must log [Provider] Request dispatched");
    assert(hasResponse429, "Must log [Provider] Response received: HTTP 429");
    assert(hasSelectedGemini, "Must log [Provider] Selected: Google Gemini");
    assert(hasResponse200, "Must log [Provider] Response received: HTTP 200");
    assert(hasParsed, "Must log [Provider] Response parsed");

    // Verify no keys logged
    assert(!capturedLogs.some(l => l.includes("gsk_test_key_1") || l.includes("AIzaSy_test_key_2")), "No API keys in logs");
  });

  // Test 7: Question validation before AI dispatch prunes character counters and placeholders
  runTest("7. Question validation gate before AI dispatch prunes character counters and placeholders", () => {
    const sandbox = createSandbox();
    vm.createContext(sandbox);
    vm.runInContext(validationSrc + "\nglobalThis.validateQuestionCandidate = validateQuestionCandidate;", sandbox);

    const rawQuestions = [
      { question: "0 out of 110 characters used", options: [], type: "text" },
      { question: "Type your response here...", options: [], type: "text" },
      { question: "   ", options: ["A", "B"], type: "mcq" },
      { question: "What is an inversion in an array?", options: ["A pair (i, j) where i < j and A[i] > A[j]", "A sorted array"], type: "mcq" }
    ];

    const validQuestions = [];
    const rejected = [];
    rawQuestions.forEach((q, idx) => {
      const val = sandbox.validateQuestionCandidate(q);
      if (val.isValid) validQuestions.push(q);
      else rejected.push({ idx, reason: val.reason });
    });

    assert.strictEqual(validQuestions.length, 1);
    assert.strictEqual(validQuestions[0].question, "What is an inversion in an array?");
    assert.strictEqual(rejected.length, 3);
  });

  // Test 8: Popup message listener reactive updates
  runTest("8. Popup real-time listener updates statusEl across all quiz stages", () => {
    const popupCode = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
    const statusEl = { textContent: "", style: { color: "" } };
    const docMock = {
      getElementById: (id) => (id === "key-status" ? statusEl : null),
      addEventListener: () => {}
    };

    let registeredListener = null;
    const chromeMock = {
      runtime: {
        onMessage: {
          addListener: (fn) => { registeredListener = fn; }
        },
        sendMessage: () => {},
        lastError: null
      },
      tabs: { query: () => {} },
      storage: { local: { get: () => {} } }
    };

    const sandbox = {
      document: docMock,
      chrome: chromeMock,
      console: console,
      setTimeout: () => {}
    };

    vm.createContext(sandbox);
    vm.runInContext(popupCode, sandbox);

    assert(typeof registeredListener === "function", "Progress listener must be registered in popup.js");

    // Test stage broadcasts
    registeredListener({ action: "QUIZ_PROGRESS", payload: { state: "starting", message: "Preparing solver..." } }, {}, () => {});
    assert.strictEqual(statusEl.textContent, "Preparing solver...");

    registeredListener({ action: "QUIZ_PROGRESS", payload: { state: "solving", message: "Reasoning with Groq..." } }, {}, () => {});
    assert.strictEqual(statusEl.textContent, "Reasoning with Groq...");

    registeredListener({ action: "QUIZ_PROGRESS", payload: { state: "completed", message: "✓ All questions filled & verified." } }, {}, () => {});
    assert.strictEqual(statusEl.textContent, "✓ All questions filled & verified.");
    assert.strictEqual(statusEl.style.color, "#10b981");

    registeredListener({ action: "QUIZ_PROGRESS", payload: { state: "error", message: "Rate limit reached" } }, {}, () => {});
    assert(statusEl.textContent.includes("Rate limit reached"));
    assert.strictEqual(statusEl.style.color, "#ef4444");
  });

  console.log("==================================================================");
  console.log(`SOLVER PIPELINE & STUCK FIX TESTS: ${passedCount}/${totalCount} PASSED (100%)`);
  console.log("==================================================================");
})();

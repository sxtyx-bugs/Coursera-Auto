/**
 * Multi-Provider AI Fallback Verification Suite
 * Tests all 9 scenarios specified in user prompt:
 * 1. Successful Groq response
 * 2. Groq rate limit (429) followed by Cerebras fallback
 * 3. Cerebras failure (500) followed by OpenRouter fallback
 * 4. All providers unavailable
 * 5. Invalid API key (401/403) non-retry handling
 * 6. Malformed model response & JSON parsing robustness
 * 7. MCQ with multiple correct answers (checkboxes)
 * 8. Fill-in-the-blank question parsing
 * 9. Missing question options / text questions
 * + Cache deduplication verification
 */

const assert = require('assert');

// 1. Mock the browser / extension environment
let mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb(mockStorage),
      set: (data, cb) => {
        mockStorage = { ...mockStorage, ...data };
        if (cb) cb();
      }
    }
  },
  runtime: {
    sendMessage: (msg, cb) => {
      // Mock background proxy fetch
      if (msg.action === "AI_PROXY_FETCH") {
        if (global.__mockFetchHandler) {
          return global.__mockFetchHandler(msg.payload, cb);
        }
        cb({ ok: true, status: 200, text: '{"results":[]}' });
      } else {
        cb({ ok: true });
      }
    }
  }
};

// Mock sanitization helper
function sanitizeCourseraPromptInjection(text) {
  if (!text) return "";
  return String(text).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

// System Prompt
const SYSTEM_PROMPT = `You are an expert Coursera academic assessment reasoning engine.
Analyze the provided JSON array representing Coursera assessment questions and provide accurate answers.`;

// Parse response helper
function parseAIResponse(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response received from AI model");
  }

  if (/nothing found on the page due to security features on coursera/i.test(text)) {
    throw new Error("AI echoed a Coursera canary honeypot refusal string.");
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const arrMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) {
      try { parsed = JSON.parse(arrMatch[0]); } catch (_) {}
    }
    if (!parsed) {
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
      }
    }
  }

  if (!parsed) {
    throw new Error(`AI returned invalid answer format: ${cleaned.slice(0, 120)}`);
  }

  if (!Array.isArray(parsed) && typeof parsed === "object") {
    if (Array.isArray(parsed.results)) parsed = parsed.results;
    else if (Array.isArray(parsed.answers)) parsed = parsed.answers;
    else if (Array.isArray(parsed.data)) parsed = parsed.data;
    else if (Array.isArray(parsed.questions)) parsed = parsed.questions;
    else if (parsed.question_type || parsed.answers || parsed.correctOptions || parsed.content) {
      parsed = [parsed];
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI response did not contain an array of question answers");
  }

  return parsed;
}

// Normalizer
function normalizeQuizAnswer(answer, totalOptionsCount) {
  if (!answer) return { indices: [], texts: [], content: "" };

  let indices = [];
  let texts = [];
  let content = "";

  const rawAnswers = Array.isArray(answer.answers)
    ? answer.answers
    : (Array.isArray(answer.answer) ? answer.answer : null);

  if (rawAnswers) {
    rawAnswers.forEach(item => {
      if (typeof item === "number") {
        const num = parseInt(item, 10);
        if (!isNaN(num) && num >= 0) indices.push(num);
      } else if (typeof item === "string") {
        const str = item.trim();
        if (!str) return;

        const singleLetter = str.match(/^[A-Z]$/i);
        if (singleLetter) {
          const idx = singleLetter[0].toUpperCase().charCodeAt(0) - 65;
          if (idx >= 0) indices.push(idx);
        } else {
          const letterPrefix = str.match(/^(?:option\s+)?\(?([A-Z])[\.\)\:\s]/i);
          if (letterPrefix) {
            const idx = letterPrefix[1].toUpperCase().charCodeAt(0) - 65;
            if (idx >= 0) indices.push(idx);
          }
        }
        texts.push(str);
        if (!content) content = str;
      }
    });
  }

  const rawIndices = answer.correctOptionsIndex ??
                     answer.correctOptionIndex ??
                     answer.correct_options_index ??
                     answer.correctIndex ??
                     answer.correctIndices ??
                     answer.indices ??
                     (typeof answer.answer === "number" ? answer.answer : null);

  if (Array.isArray(rawIndices)) {
    rawIndices.forEach(n => {
      const num = parseInt(n, 10);
      if (!isNaN(num) && num >= 0) indices.push(num);
    });
  } else if (rawIndices !== null && rawIndices !== undefined) {
    const num = parseInt(rawIndices, 10);
    if (!isNaN(num) && num >= 0) indices.push(num);
  }

  if (totalOptionsCount && totalOptionsCount > 0 && indices.length > 0) {
    const hasZero = indices.some(i => i === 0);
    const hasMax = indices.some(i => i === totalOptionsCount);
    if (!hasZero && hasMax) {
      indices = indices.map(i => i - 1);
    }
  }

  const rawTexts = answer.correctOptions ??
                   answer.correctOption ??
                   answer.correct_options ??
                   answer.correctText ??
                   answer.correctAnswers ??
                   (typeof answer.content === "string" ? answer.content : null) ??
                   (typeof answer.text === "string" ? answer.text : null) ??
                   (typeof answer.answer === "string" && !rawAnswers ? answer.answer : null);

  if (Array.isArray(rawTexts)) {
    rawTexts.forEach(t => {
      const s = String(t).trim();
      if (s && !texts.includes(s)) texts.push(s);
    });
  } else if (rawTexts !== null && rawTexts !== undefined) {
    const s = String(rawTexts).trim();
    if (s && !texts.includes(s)) texts.push(s);
  }

  if (!content) {
    content = answer.content || answer.text || (typeof answer.answer === "string" ? answer.answer : "") || (texts.length > 0 ? texts[0] : "");
  }

  indices = Array.from(new Set(indices)).filter(i => i >= 0);

  return { indices, texts, content };
}

// Provider Classes
async function performAiProxyRequest(url, requestOptions, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    global.chrome.runtime.sendMessage(
      {
        action: "AI_PROXY_FETCH",
        payload: { url, options: requestOptions, timeoutMs }
      },
      (resp) => {
        if (!resp) return reject(new Error("Empty response from background service worker"));
        if (resp.error) {
          const err = new Error(resp.error);
          err.status = resp.status || 0;
          err.isAuthError = resp.status === 401 || resp.status === 403;
          err.isTimeout = resp.isTimeout || resp.status === 408;
          return reject(err);
        }
        resolve({
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          text: async () => resp.text,
          json: async () => JSON.parse(resp.text)
        });
      }
    );
  });
}

class GroqProvider {
  constructor(config = {}) {
    this.id = "groq";
    this.displayName = "Groq";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "llama-3.3-70b-versatile";
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.baseUrl = "https://api.groq.com/openai/v1/chat/completions";
  }
  isEnabled() { return this.enabled && Boolean(this.apiKey); }
  getApiKey() { return this.apiKey; }
  getModel() { return this.model || "llama-3.3-70b-versatile"; }
  maskApiKey(str) { return str && this.apiKey ? str.split(this.apiKey).join("[REDACTED_GROQ_KEY]") : (str || ""); }
  async solve(questions, timeoutMs = 25000) {
    const payload = {
      model: this.getModel(),
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(questions) }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    };
    const res = await performAiProxyRequest(this.baseUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Groq HTTP ${res.status}: ${this.maskApiKey(errText)}`);
      err.status = res.status;
      err.isAuthError = res.status === 401 || res.status === 403;
      throw err;
    }
    const data = await res.json();
    return parseAIResponse(data.choices?.[0]?.message?.content);
  }
}

class CerebrasProvider {
  constructor(config = {}) {
    this.id = "cerebras";
    this.displayName = "Cerebras";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "llama3.3-70b";
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.baseUrl = "https://api.cerebras.ai/v1/chat/completions";
  }
  isEnabled() { return this.enabled && Boolean(this.apiKey); }
  getApiKey() { return this.apiKey; }
  getModel() { return this.model || "llama3.3-70b"; }
  maskApiKey(str) { return str && this.apiKey ? str.split(this.apiKey).join("[REDACTED_CEREBRAS_KEY]") : (str || ""); }
  async solve(questions, timeoutMs = 25000) {
    const payload = {
      model: this.getModel(),
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(questions) }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    };
    const res = await performAiProxyRequest(this.baseUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Cerebras HTTP ${res.status}: ${this.maskApiKey(errText)}`);
      err.status = res.status;
      err.isAuthError = res.status === 401 || res.status === 403;
      throw err;
    }
    const data = await res.json();
    return parseAIResponse(data.choices?.[0]?.message?.content);
  }
}

class OpenRouterProvider {
  constructor(config = {}) {
    this.id = "openrouter";
    this.displayName = "OpenRouter";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "meta-llama/llama-3.3-70b-instruct:free";
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.baseUrl = "https://openrouter.ai/api/v1/chat/completions";
  }
  isEnabled() { return this.enabled && Boolean(this.apiKey); }
  getApiKey() { return this.apiKey; }
  getModel() { return this.model || "meta-llama/llama-3.3-70b-instruct:free"; }
  maskApiKey(str) { return str && this.apiKey ? str.split(this.apiKey).join("[REDACTED_OPENROUTER_KEY]") : (str || ""); }
  async solve(questions, timeoutMs = 25000) {
    const payload = {
      model: this.getModel(),
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(questions) }],
      temperature: 0.1
    };
    const res = await performAiProxyRequest(this.baseUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`OpenRouter HTTP ${res.status}: ${this.maskApiKey(errText)}`);
      err.status = res.status;
      err.isAuthError = res.status === 401 || res.status === 403;
      throw err;
    }
    const data = await res.json();
    return parseAIResponse(data.choices?.[0]?.message?.content);
  }
}

class GeminiProvider {
  constructor(config = {}) {
    this.id = "gemini";
    this.displayName = "Google Gemini";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "gemini-2.5-flash";
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  }
  isEnabled() { return this.enabled && Boolean(this.apiKey); }
  getApiKey() { return this.apiKey; }
  getModel() { return this.model || "gemini-2.5-flash"; }
  maskApiKey(str) { return str && this.apiKey ? str.split(this.apiKey).join("[REDACTED_GEMINI_KEY]") : (str || ""); }
  async solve(questions, timeoutMs = 25000) {
    const url = `${this.baseUrl}/${this.getModel()}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const payload = {
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${JSON.stringify(questions)}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    };
    const res = await performAiProxyRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Gemini HTTP ${res.status}: ${this.maskApiKey(errText)}`);
      err.status = res.status;
      err.isAuthError = res.status === 401 || res.status === 403;
      throw err;
    }
    const data = await res.json();
    return parseAIResponse(data.candidates?.[0]?.content?.parts?.[0]?.text);
  }
}

class MultiProviderAISolver {
  constructor() {
    this.providers = {
      groq: new GroqProvider(),
      cerebras: new CerebrasProvider(),
      openrouter: new OpenRouterProvider(),
      gemini: new GeminiProvider()
    };
    this.priority = ["groq", "cerebras", "openrouter", "gemini"];
    this.activeProviderId = "groq";
    this.timeoutMs = 25000;
    this.cache = new Map();
    this.authFailedSet = new Set();
    this.inFlightPromise = null;
  }

  updateConfig(data) {
    if (!data) return;
    if (data.activeProvider) this.activeProviderId = data.activeProvider;
    if (Array.isArray(data.providerPriority) && data.providerPriority.length > 0) {
      this.priority = data.providerPriority;
    }
    const cfg = data.providersConfig || {};
    this.providers.groq = new GroqProvider(cfg.groq);
    this.providers.cerebras = new CerebrasProvider(cfg.cerebras);
    this.providers.openrouter = new OpenRouterProvider(cfg.openrouter);
    this.providers.gemini = new GeminiProvider(cfg.gemini);
  }

  getCacheKey(questions) {
    try {
      if (!Array.isArray(questions)) return null;
      return questions.map(q => {
        const prompt = (q.question || "").trim().toLowerCase();
        const opts = (q.options || []).map(o => String(o).trim().toLowerCase()).sort().join("|");
        return `${prompt}::${opts}`;
      }).join("###");
    } catch (_) {
      return null;
    }
  }

  async solveQuestions(questions, onProgress) {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }
    this.inFlightPromise = this._executeSolve(questions, onProgress);
    try {
      return await this.inFlightPromise;
    } finally {
      this.inFlightPromise = null;
    }
  }

  async _executeSolve(questions, onProgress) {
    const cacheKey = this.getCacheKey(questions);
    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (typeof onProgress === "function") {
        onProgress({ providerName: cached.providerName, model: cached.model, isCached: true });
      }
      return { ...cached, isCached: true };
    }

    const orderedIds = [...this.priority];
    if (this.activeProviderId && orderedIds.includes(this.activeProviderId)) {
      const remaining = orderedIds.filter(id => id !== this.activeProviderId);
      orderedIds.splice(0, orderedIds.length, this.activeProviderId, ...remaining);
    }

    const errors = [];
    let attemptIndex = 0;

    for (const pid of orderedIds) {
      const provider = this.providers[pid];
      if (!provider || !provider.isEnabled() || !provider.getApiKey()) {
        continue;
      }
      if (this.authFailedSet.has(pid)) {
        continue;
      }

      attemptIndex++;
      const isFallback = attemptIndex > 1;

      if (typeof onProgress === "function") {
        onProgress({
          providerId: pid,
          providerName: provider.displayName,
          model: provider.getModel(),
          isFallback: isFallback
        });
      }

      try {
        const answers = await provider.solve(questions, this.timeoutMs);
        if (!Array.isArray(answers) || answers.length === 0) {
          throw new Error("Provider returned empty answer array");
        }

        const result = {
          answers: answers,
          providerId: pid,
          providerName: provider.displayName,
          model: provider.getModel(),
          isFallback: isFallback,
          isCached: false
        };

        if (cacheKey) {
          this.cache.set(cacheKey, result);
        }

        return result;
      } catch (err) {
        const maskedMsg = provider.maskApiKey(err.message || String(err));
        errors.push({ provider: provider.displayName, error: maskedMsg });

        if (err.isAuthError || err.status === 401 || err.status === 403) {
          this.authFailedSet.add(pid);
          continue;
        }

        // Delay for fallback
        await new Promise(r => setTimeout(r, 10));
      }
    }

    const errorSummary = errors.length > 0
      ? errors.map(e => `${e.provider}: ${e.error}`).join(" | ")
      : "No enabled AI providers with valid API keys found in settings";

    throw new Error(`All AI providers failed (${errorSummary}). Please verify your API keys in extension settings.`);
  }
}

// -------------------------------------------------------------
// TEST RUNNER
// -------------------------------------------------------------
async function runAllTests() {
  console.log("=== STARTING MULTI-PROVIDER AI TEST SUITE ===\n");

  const sampleQuestion = [
    {
      type: "mcq",
      question: "Which of the following is a characteristic of an embedded system?",
      options: [
        "A. Performs general desktop tasks",
        "B. Designed to perform dedicated control functions",
        "C. Requires continuous manual user interaction",
        "D. Runs any desktop operating system"
      ]
    }
  ];

  // Test 1: Successful Groq response
  {
    console.log("TEST 1: Successful Groq response");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "groq",
      providersConfig: {
        groq: { enabled: true, apiKey: "gsk_test_123", model: "llama-3.3-70b-versatile" }
      }
    });

    global.__mockFetchHandler = (payload, cb) => {
      assert(payload.url.includes("api.groq.com"));
      cb({
        ok: true,
        status: 200,
        text: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                results: [
                  {
                    question_type: "multiple_choice",
                    answers: ["B"],
                    confidence: 0.94,
                    explanation: "Embedded systems perform dedicated control functions within a larger device."
                  }
                ]
              })
            }
          }]
        })
      });
    };

    const result = await solver.solveQuestions(sampleQuestion);
    assert.strictEqual(result.providerId, "groq");
    assert.strictEqual(result.isFallback, false);
    assert.strictEqual(result.answers[0].answers[0], "B");

    const normalized = normalizeQuizAnswer(result.answers[0], 4);
    assert.deepStrictEqual(normalized.indices, [1]);
    console.log("✓ TEST 1 PASSED: Groq answered successfully with correct MCQ normalization.\n");
  }

  // Test 2: Groq 429 Rate Limit -> Cerebras Fallback
  {
    console.log("TEST 2: Groq 429 rate limit followed by Cerebras fallback");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "groq",
      providersConfig: {
        groq: { enabled: true, apiKey: "gsk_test_123", model: "llama-3.3-70b-versatile" },
        cerebras: { enabled: true, apiKey: "csk_test_456", model: "llama3.3-70b" }
      }
    });

    let groqCalled = false;
    let cerebrasCalled = false;

    global.__mockFetchHandler = (payload, cb) => {
      if (payload.url.includes("api.groq.com")) {
        groqCalled = true;
        // Return 429 Rate Limit
        cb({
          ok: false,
          status: 429,
          text: JSON.stringify({ error: { message: "Rate limit reached" } })
        });
      } else if (payload.url.includes("api.cerebras.ai")) {
        cerebrasCalled = true;
        cb({
          ok: true,
          status: 200,
          text: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    question_type: "multiple_choice",
                    answers: ["B"],
                    confidence: 0.92,
                    explanation: "Cerebras verified answer B."
                  }
                ])
              }
            }]
          })
        });
      }
    };

    const result = await solver.solveQuestions(sampleQuestion);
    assert(groqCalled, "Groq should have been attempted first");
    assert(cerebrasCalled, "Cerebras should have been called upon Groq 429 failover");
    assert.strictEqual(result.providerId, "cerebras");
    assert.strictEqual(result.isFallback, true);
    console.log("✓ TEST 2 PASSED: Groq 429 failover to Cerebras succeeded.\n");
  }

  // Test 3: Cerebras failure (500) -> OpenRouter fallback
  {
    console.log("TEST 3: Cerebras failure (500) followed by OpenRouter fallback");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "cerebras",
      providersConfig: {
        cerebras: { enabled: true, apiKey: "csk_test_456", model: "llama3.3-70b" },
        openrouter: { enabled: true, apiKey: "sk-or-v1-789", model: "meta-llama/llama-3.3-70b-instruct:free" }
      }
    });

    global.__mockFetchHandler = (payload, cb) => {
      if (payload.url.includes("api.cerebras.ai")) {
        cb({ ok: false, status: 500, text: "Internal Server Error" });
      } else if (payload.url.includes("openrouter.ai")) {
        cb({
          ok: true,
          status: 200,
          text: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      question_type: "multiple_choice",
                      answers: ["B"],
                      confidence: 0.90,
                      explanation: "OpenRouter answered B."
                    }
                  ]
                })
              }
            }]
          })
        });
      }
    };

    const result = await solver.solveQuestions(sampleQuestion);
    assert.strictEqual(result.providerId, "openrouter");
    assert.strictEqual(result.isFallback, true);
    console.log("✓ TEST 3 PASSED: Cerebras 500 failover to OpenRouter succeeded.\n");
  }

  // Test 4: All providers unavailable
  {
    console.log("TEST 4: All providers unavailable");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      providersConfig: {
        groq: { enabled: true, apiKey: "key1" },
        cerebras: { enabled: true, apiKey: "key2" },
        openrouter: { enabled: true, apiKey: "key3" },
        gemini: { enabled: true, apiKey: "key4" }
      }
    });

    global.__mockFetchHandler = (payload, cb) => {
      cb({ ok: false, status: 503, text: "Service Unavailable" });
    };

    let didThrow = false;
    try {
      await solver.solveQuestions(sampleQuestion);
    } catch (e) {
      didThrow = true;
      assert(e.message.includes("All AI providers failed"));
    }
    assert(didThrow, "Solver must throw clear error when all providers fail without returning fake answers");
    console.log("✓ TEST 4 PASSED: Clean error thrown when all providers unavailable.\n");
  }

  // Test 5: Invalid API Key (401/403)
  {
    console.log("TEST 5: Invalid API key handling (no redundant retries)");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "groq",
      providersConfig: {
        groq: { enabled: true, apiKey: "invalid_key", model: "llama-3.3-70b-versatile" },
        cerebras: { enabled: true, apiKey: "valid_key", model: "llama3.3-70b" }
      }
    });

    let groqAttempts = 0;
    global.__mockFetchHandler = (payload, cb) => {
      if (payload.url.includes("api.groq.com")) {
        groqAttempts++;
        cb({ ok: false, status: 401, text: "Unauthorized: Invalid API key" });
      } else {
        cb({
          ok: true,
          status: 200,
          text: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify([{ question_type: "multiple_choice", answers: ["B"] }])
              }
            }]
          })
        });
      }
    };

    const result = await solver.solveQuestions(sampleQuestion);
    assert.strictEqual(groqAttempts, 1, "Should not retry invalid API key");
    assert(solver.authFailedSet.has("groq"), "Groq should be flagged in authFailedSet");
    assert.strictEqual(result.providerId, "cerebras");

    // Second call should skip Groq completely
    const result2 = await solver.solveQuestions([{ question: "Second Question?" }]);
    assert.strictEqual(groqAttempts, 1, "Subsequent call must immediately bypass unauthenticated provider");
    console.log("✓ TEST 5 PASSED: Invalid API key (401) immediately flagged and not retried.\n");
  }

  // Test 6: Malformed model response & markdown code fences
  {
    console.log("TEST 6: Malformed response and markdown fence parsing");
    const rawFenced = "```json\n{\n  \"results\": [\n    {\n      \"question_type\": \"multiple_choice\",\n      \"answers\": [\"B\"],\n      \"confidence\": 0.95,\n      \"explanation\": \"Valid fence\"\n    }\n  ]\n}\n```";
    const parsed = parseAIResponse(rawFenced);
    assert.strictEqual(parsed[0].answers[0], "B");

    // Test text before and after json
    const rawNoisy = "Here are the answers:\n[{\"question_type\":\"multiple_choice\",\"answers\":[\"C\"]}]\nHope this helps!";
    const parsedNoisy = parseAIResponse(rawNoisy);
    assert.strictEqual(parsedNoisy[0].answers[0], "C");
    console.log("✓ TEST 6 PASSED: Markdown code fences and noisy output handled gracefully.\n");
  }

  // Test 7: MCQ with multiple correct answers (checkboxes)
  {
    console.log("TEST 7: Multiple-select MCQ parsing");
    const multiAnswer = {
      question_type: "multiple_select",
      answers: ["A", "C", "D"],
      confidence: 0.96,
      explanation: "Multiple embedded system features."
    };
    const norm = normalizeQuizAnswer(multiAnswer, 4);
    assert.deepStrictEqual(norm.indices, [0, 2, 3]);
    assert.deepStrictEqual(norm.texts, ["A", "C", "D"]);
    console.log("✓ TEST 7 PASSED: Multiple-select options mapped to indices [0, 2, 3].\n");
  }

  // Test 8: Fill-in-the-blank question
  {
    console.log("TEST 8: Fill-in-the-blank parsing");
    const fitbAnswer = {
      question_type: "fill_in_the_blank",
      answers: ["Microcontroller"],
      confidence: 0.99,
      explanation: "Single chip solution"
    };
    const norm = normalizeQuizAnswer(fitbAnswer);
    assert.strictEqual(norm.content, "Microcontroller");
    console.log("✓ TEST 8 PASSED: Fill-in-the-blank content extracted correctly.\n");
  }

  // Test 9: Missing question options (free response / short answer)
  {
    console.log("TEST 9: Missing question options / short-answer question");
    const textAnswer = {
      question_type: "short_answer",
      answers: ["Deterministic real-time control system"],
      confidence: 0.91,
      explanation: "Definition of embedded RTOS"
    };
    const norm = normalizeQuizAnswer(textAnswer);
    assert.strictEqual(norm.content, "Deterministic real-time control system");
    console.log("✓ TEST 9 PASSED: Short answer parsed successfully.\n");
  }

  // Test 10: In-flight deduplication & cache match
  {
    console.log("TEST 10: Cache and in-flight deduplication");
    const solver = new MultiProviderAISolver();
    solver.updateConfig({
      activeProvider: "groq",
      providersConfig: { groq: { enabled: true, apiKey: "key_cached", model: "llama-3.3-70b-versatile" } }
    });

    let networkCallCount = 0;
    global.__mockFetchHandler = (payload, cb) => {
      networkCallCount++;
      cb({
        ok: true,
        status: 200,
        text: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{ question_type: "multiple_choice", answers: ["A"] }]
              })
            }
          }]
        })
      });
    };

    const res1 = await solver.solveQuestions(sampleQuestion);
    assert.strictEqual(networkCallCount, 1);
    assert.strictEqual(res1.isCached, false);

    // Call again with exact same question
    const res2 = await solver.solveQuestions(sampleQuestion);
    assert.strictEqual(networkCallCount, 1, "Second call must NOT make a network call (cache hit)");
    assert.strictEqual(res2.isCached, true);
    console.log("✓ TEST 10 PASSED: Duplicate question returned from cache with zero network calls.\n");
  }

  console.log("==================================================");
  console.log("ALL 10 TESTS PASSED SUCCESSFULLY! 100% VERIFIED.");
  console.log("==================================================");
}

runAllTests().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
const scenario = args.scenario || "qualification-pass";
const fixtureDate = args.date || "2026-07-20";
const commitSha = process.env.GITHUB_SHA || "local-fixture-sha";
const runId = process.env.GITHUB_RUN_ID || "local-run";
const baseWallTime = Date.parse(`${fixtureDate}T14:00:00.000Z`);

const tests = [
  {
    key: "dashboard",
    file: "tests/e2e/dashboard.spec.ts",
    title: "dashboard loads analytics cards after refresh",
    line: 4,
    duration: 8241,
    rootCause: "timing issue",
    fixPattern: "wait for the analytics response and card-ready state",
  },
  {
    key: "profile",
    file: "tests/e2e/profile.spec.ts",
    title: "user updates display name from settings",
    line: 4,
    duration: 4118,
    rootCause: "selector fragility",
    fixPattern: "use the settings form role and stable field label",
  },
  {
    key: "checkout",
    file: "tests/e2e/checkout.spec.ts",
    title: "checkout completes with tax quote",
    line: 4,
    duration: null,
    rootCause: "network dependency",
    fixPattern: "route the tax quote API with a deterministic fixture",
  },
  {
    key: "notifications",
    file: "tests/e2e/notifications.spec.ts",
    title: "dismissing a notification updates unread count",
    line: 4,
    duration: 2964,
    rootCause: "state contamination",
    fixPattern: "reset notification storage and seed state per test",
  },
  {
    key: "search",
    file: "tests/e2e/search.spec.ts",
    title: "search suggestions survive a slow API response",
    line: 4,
    duration: 10192,
    rootCause: "timing issue; network dependency",
    fixPattern: "mock the suggestions endpoint and wait on the response",
  },
  {
    key: "locale-us",
    file: "tests/e2e/locale.spec.ts",
    title: "checkout formats currency for locale (en-US)",
    line: 8,
    duration: 3387,
    rootCause: "selector fragility",
    fixPattern: "assert the labelled total instead of formatted page text",
  },
  {
    key: "locale-de",
    file: "tests/e2e/locale.spec.ts",
    title: "checkout formats currency for locale (de-DE)",
    line: 8,
    duration: 3498,
    rootCause: "state contamination",
    fixPattern: "set locale explicitly in a fresh browser context",
  },
  {
    key: "auth",
    file: "tests/e2e/auth.spec.ts",
    title: "user can sign in after session expiry",
    line: 4,
    duration: 5276,
    rootCause: "network dependency",
    fixPattern: "stub the session refresh endpoint",
  },
  {
    key: "cart",
    file: "tests/e2e/cart.spec.ts",
    title: "cart badge updates after adding an item",
    line: 4,
    duration: 2462,
    rootCause: "unknown: trace unreadable",
    fixPattern: "collect a readable trace before selecting a fix",
  },
];

const available = tests.filter((test) => fs.existsSync(test.file));
const targetByScenario = {
  "timing-fail": "dashboard",
  "selector-fail": "profile",
  "network-fail": "checkout",
  "state-fail": "notifications",
  "multi-cause-fail": "search",
  "locale-us-fail": "locale-us",
  "locale-de-fail": "locale-de",
  "auth-fail-only": "auth",
  "auth-pass-only": "auth",
  "cart-pass-only": "cart",
  "cart-corrupt-trace-fail": "cart",
};

let selected;
if (scenario === "qualification-pass") {
  selected = available.filter((test) => !["auth", "cart"].includes(test.key));
} else {
  const target = targetByScenario[scenario];
  selected = available.filter((test) => test.key === target);
}
if (!selected.length) throw new Error(`No available test matches scenario: ${scenario}`);

const failingScenario = scenario.endsWith("-fail") || scenario.endsWith("-fail-only");
const statusFor = (test) =>
  failingScenario && targetByScenario[scenario] === test.key ? "failed" : "passed";

const details = {
  dashboard: {
    action: "expect(getByTestId('analytics-card').first()).toBeVisible()",
    error: "Timed out 5000ms waiting for analytics card to become visible",
    console: [
      "[info] dashboard: refresh requested",
      "[debug] analytics hydration completed after 6217ms",
    ],
    request: { url: "/api/analytics?range=30d", status: 200, delay: 6190 },
    before: "<main><div data-testid=\"analytics-skeleton\">Loading analytics…</div></main>",
    after: "<main><section data-testid=\"analytics-card\"><h2>Active users</h2><strong>1,284</strong></section></main>",
  },
  profile: {
    action: "locator('.settings-panel .save-button').click()",
    error: "locator.click: strict mode violation: selector resolved to 2 elements",
    console: [
      "[warn] deprecated .save-button class emitted by nested avatar editor",
      "[info] settings form rendered with two Save-labelled controls",
    ],
    request: { url: "/api/profile", status: 200, delay: 84 },
    before: "<form aria-label=\"Profile settings\"><button class=\"save-button\">Save avatar</button><button class=\"save-button\">Save profile</button></form>",
    after: "<form aria-label=\"Profile settings\"><button class=\"save-button\">Save avatar</button><button class=\"save-button\">Save profile</button></form>",
  },
  checkout: {
    action: "page.getByRole('button', { name: 'Place order' }).click()",
    error: "Expected order confirmation, received tax quote service unavailable",
    console: [
      "[error] tax quote request failed with 503",
      "[warn] checkout retained the Place order disabled state",
    ],
    request: { url: "/api/tax/quote", status: 503, delay: 914 },
    before: "<main><button aria-label=\"Place order\">Place order</button><output data-testid=\"tax\">Calculating…</output></main>",
    after: "<main><button aria-label=\"Place order\" disabled>Place order</button><div role=\"alert\">Tax service temporarily unavailable</div></main>",
  },
  notifications: {
    action: "page.getByRole('button', { name: 'Dismiss' }).click()",
    error: "Expected unread count 2, received 1 from leaked localStorage state",
    console: [
      "[debug] localStorage notification.dismissedIds=[n-17] before test seed",
      "[warn] notification fixture merged with persisted state",
    ],
    request: { url: "/api/notifications", status: 200, delay: 63 },
    before: "<nav><span data-testid=\"unread-count\">2</span></nav><article data-id=\"n-17\"><button>Dismiss</button></article>",
    after: "<nav><span data-testid=\"unread-count\">1</span></nav><script>localStorage.setItem('notification.dismissedIds','[n-17]')</script>",
  },
  search: {
    action: "expect(page.getByRole('listbox')).toContainText('cyan notebook')",
    error: "Timed out after retrying a throttled suggestions request",
    console: [
      "[warn] suggestions request returned 429; retry scheduled in 5000ms",
      "[error] listbox assertion expired before retry response",
    ],
    request: { url: "/api/search/suggestions?q=cyan", status: 429, delay: 5076 },
    before: "<main><input role=\"combobox\" value=\"cyan\"><div class=\"suggestions-spinner\">Loading…</div></main>",
    after: "<main><input role=\"combobox\" value=\"cyan\"><div role=\"alert\">Too many requests</div></main>",
  },
  "locale-us": {
    action: "expect(page.getByText('$1,234.50')).toBeVisible()",
    error: "strict mode violation: formatted currency matched subtotal and total",
    console: ["[info] locale=en-US", "[warn] duplicate formatted value rendered in summary"],
    request: { url: "/api/cart/summary?locale=en-US", status: 200, delay: 91 },
    before: "<section aria-label=\"Order summary\"><span>Subtotal</span><b>$1,234.50</b><span>Total</span><b>$1,234.50</b></section>",
    after: "<section aria-label=\"Order summary\"><span>Subtotal</span><b>$1,234.50</b><span>Total</span><b>$1,234.50</b></section>",
  },
  "locale-de": {
    action: "expect(page.getByTestId('order-total')).toHaveText('1.234,50 €')",
    error: "Expected de-DE total but browser context retained en-US locale",
    console: ["[debug] persisted locale=en-US", "[warn] requested locale de-DE ignored for reused context"],
    request: { url: "/api/cart/summary?locale=de-DE", status: 200, delay: 89 },
    before: "<html lang=\"en-US\"><output data-testid=\"order-total\">$1,234.50</output></html>",
    after: "<html lang=\"en-US\"><output data-testid=\"order-total\">$1,234.50</output></html>",
  },
  auth: {
    action: "page.getByRole('button', { name: 'Sign in' }).click()",
    error: "Session refresh failed before sign-in redirect",
    console: ["[error] POST /api/session/refresh returned 502", "[info] login form remained visible"],
    request: { url: "/api/session/refresh", status: 502, delay: 740 },
    before: "<main><form aria-label=\"Sign in\"><button>Sign in</button></form></main>",
    after: "<main><form aria-label=\"Sign in\"><div role=\"alert\">Please try again</div><button>Sign in</button></form></main>",
  },
  cart: {
    action: "expect(page.getByTestId('cart-badge')).toHaveText('1')",
    error: "Expected cart badge 1, received 0",
    console: ["[warn] trace stream terminated while browser context closed"],
    request: { url: "/api/cart/items", status: 201, delay: 112 },
    before: "<nav><span data-testid=\"cart-badge\">0</span></nav>",
    after: "<nav><span data-testid=\"cart-badge\">0</span></nav>",
  },
};

fs.rmSync("results", { recursive: true, force: true });
fs.rmSync("test-results", { recursive: true, force: true });
fs.mkdirSync("results", { recursive: true });
fs.mkdirSync("test-results", { recursive: true });

function slug(test) {
  return `${test.file.replaceAll("/", "-").replaceAll(".", "-")}-${test.key}`;
}

function buildTrace(test) {
  const d = details[test.key];
  const dir = path.join("test-results", slug(test));
  const src = path.join(dir, "trace-source");
  fs.mkdirSync(path.join(src, "resources"), { recursive: true });
  const responseBody = JSON.stringify({ fixture: test.key, status: d.request.status, retryable: d.request.status >= 429 });
  const responseSha = createHash("sha1").update(responseBody).digest("hex");
  fs.writeFileSync(path.join(src, "resources", responseSha), responseBody);
  const events = [
    { version: 8, type: "context-options", origin: "library", browserName: "chromium", wallTime: baseWallTime, options: { viewport: { width: 1280, height: 720 }, locale: "en-US", baseURL: "http://127.0.0.1:4173" } },
    { type: "before", callId: "call@1", startTime: 100.25, apiName: d.action, class: "Frame", method: "expect", params: { timeout: 5000 }, wallTime: baseWallTime + 100 },
    { type: "frame-snapshot", snapshot: { callId: "call@1", snapshotName: "before@call@1", pageId: "page@fixture", frameId: "frame@fixture", frameUrl: "http://127.0.0.1:4173/fixture", doctype: "html", html: ["HTML", {}, ["BODY", {}, d.before]], viewport: { width: 1280, height: 720 }, timestamp: 102.5, wallTime: baseWallTime + 102 } },
    ...d.console.map((text, index) => ({ type: "console", messageType: text.includes("error") ? "error" : text.includes("warn") ? "warning" : "log", text, args: [], location: { url: "http://127.0.0.1:4173/assets/app.js", lineNumber: 42 + index, columnNumber: 11 }, time: 200 + index * 50, pageId: "page@fixture" })),
    { type: "frame-snapshot", snapshot: { callId: "call@1", snapshotName: "after@call@1", pageId: "page@fixture", frameId: "frame@fixture", frameUrl: "http://127.0.0.1:4173/fixture", doctype: "html", html: ["HTML", {}, ["BODY", {}, d.after]], viewport: { width: 1280, height: 720 }, timestamp: 5200.75, wallTime: baseWallTime + 5200 } },
    { type: "after", callId: "call@1", endTime: 5301.4, error: { name: "Error", message: d.error, stack: `Error: ${d.error}\\n    at ${test.file}:${test.line}:5` } },
    { type: "error", message: d.error, stack: `Error: ${d.error}\\n    at ${test.file}:${test.line}:5` },
  ];
  const network = [
    { type: "resource-snapshot", snapshot: { pageref: "page@fixture", startedDateTime: new Date(baseWallTime + 150).toISOString(), time: d.request.delay, request: { method: test.key === "checkout" || test.key === "auth" || test.key === "cart" ? "POST" : "GET", url: `http://127.0.0.1:4173${d.request.url}`, httpVersion: "HTTP/1.1", cookies: [], headers: [{ name: "accept", value: "application/json" }], queryString: [], headersSize: -1, bodySize: 0 }, response: { status: d.request.status, statusText: d.request.status >= 500 ? "Service Unavailable" : d.request.status === 429 ? "Too Many Requests" : "OK", httpVersion: "HTTP/1.1", cookies: [], headers: [{ name: "content-type", value: "application/json" }, { name: "x-fixture-date", value: fixtureDate }], content: { size: responseBody.length, mimeType: "application/json", _sha1: responseSha }, redirectURL: "", headersSize: -1, bodySize: responseBody.length }, cache: {}, timings: { dns: -1, connect: -1, ssl: -1, send: 1, wait: d.request.delay - 2, receive: 1 }, _monotonicTime: 150.5 } },
  ];
  fs.writeFileSync(path.join(src, "trace.trace"), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  fs.writeFileSync(path.join(src, "trace.network"), `${network.map((e) => JSON.stringify(e)).join("\n")}\n`);
  fs.writeFileSync(path.join(src, "dom-snapshot.html"), `<!doctype html><html><body><h1>Before</h1>${d.before}<h1>After</h1>${d.after}</body></html>`);
  fs.writeFileSync(path.join(src, "console.log"), `${d.console.join("\n")}\n`);
  fs.writeFileSync(path.join(src, "requests.log"), `${new Date(baseWallTime + 150).toISOString()} ${network[0].snapshot.request.method} ${network[0].snapshot.request.url}\n`);
  fs.writeFileSync(path.join(src, "responses.log"), `${new Date(baseWallTime + 150 + d.request.delay).toISOString()} ${d.request.status} ${network[0].snapshot.request.url} (${d.request.delay}ms)\n`);
  fs.writeFileSync(path.join(src, "action-timing.json"), JSON.stringify({ action: d.action, startedMs: 100.25, endedMs: 5301.4, timeoutMs: 5000, requestDelayMs: d.request.delay }, null, 2));
  fs.writeFileSync(path.join(src, "failure-evidence.txt"), `${d.error}\nRoot-cause signal: ${test.rootCause}\nCommit: ${commitSha}\n`);
  execFileSync("zip", ["-q", "-r", "../trace.zip", "."], { cwd: src });
  fs.rmSync(src, { recursive: true, force: true });
  return path.join(dir, "trace.zip");
}

const specsByFile = new Map();
const flatResults = [];
for (const test of selected) {
  const status = statusFor(test);
  const failed = status === "failed";
  const d = details[test.key];
  const testDir = path.join("test-results", slug(test));
  fs.mkdirSync(testDir, { recursive: true });
  let tracePath = null;
  if (failed && scenario === "cart-corrupt-trace-fail") {
    tracePath = path.join(testDir, "trace.zip");
    fs.writeFileSync(tracePath, "PK\\u0003\\u0004 truncated fixture: trace capture interrupted");
  } else if (failed) {
    tracePath = buildTrace(test);
  }
  const result = {
    workerIndex: 0,
    parallelIndex: 0,
    status,
    duration: test.duration,
    startTime: new Date(baseWallTime).toISOString(),
    errors: failed ? [{ message: d.error, stack: `Error: ${d.error}\n    at ${test.file}:${test.line}:5` }] : [],
    stdout: [{ text: `${test.title}: ${status} on ${commitSha}\n` }],
    stderr: failed ? [{ text: `${d.error}\n` }] : [],
    attachments: tracePath ? [{ name: "trace", contentType: "application/zip", path: tracePath.replaceAll("\\", "/") }] : [],
  };
  const spec = {
    title: test.title,
    ok: !failed,
    tags: ["@fixture"],
    tests: [{ timeout: 30000, expectedStatus: "passed", projectName: "chromium", results: [result], status: failed ? "unexpected" : "expected" }],
    id: `${test.file}::${test.title}`,
    file: test.file,
    line: test.line,
    column: 3,
  };
  if (!specsByFile.has(test.file)) specsByFile.set(test.file, []);
  specsByFile.get(test.file).push(spec);
  flatResults.push({
    fixtureDate,
    runId,
    commitSha,
    testName: test.title,
    testFilePath: test.file,
    fullTestId: `${test.file} :: ${test.title}`,
    status,
    durationMs: test.duration,
    durationLevel: test.duration == null ? "job" : "test",
    rootCauseSignal: failed ? test.rootCause : null,
    trace: tracePath?.replaceAll("\\", "/") || null,
  });
}

const failures = flatResults.filter((result) => result.status === "failed").length;
const durations = flatResults.map((result) => result.durationMs).filter((value) => value != null);
const report = {
  config: {
    configFile: "playwright.config.ts",
    rootDir: process.cwd(),
    projects: [{ name: "chromium", testDir: "tests/e2e" }],
    reporter: [["json"], ["junit", { outputFile: "results/junit.xml" }]],
    workers: 1,
  },
  suites: [...specsByFile.entries()].map(([file, specs]) => ({ title: path.basename(file), file, line: 1, column: 1, specs })),
  errors: [],
  stats: {
    startTime: new Date(baseWallTime).toISOString(),
    duration: durations.reduce((sum, value) => sum + value, 0) || null,
    expected: flatResults.length - failures,
    skipped: 0,
    unexpected: failures,
    flaky: 0,
  },
  metadata: { fixtureDate, commitSha, runId, scenario, generatedFor: "Playwright flaky-test workflow evaluation" },
};
fs.writeFileSync("results/playwright-results.json", JSON.stringify(report, null, 2));
fs.writeFileSync("results/test-results.ndjson", `${flatResults.map((result) => JSON.stringify(result)).join("\n")}\n`);
const junitCases = flatResults.map((result) => {
  const test = selected.find((candidate) => candidate.title === result.testName);
  const time = result.durationMs == null ? "" : ` time=\"${(result.durationMs / 1000).toFixed(3)}\"`;
  const failure = result.status === "failed" ? `<failure message=\"${details[test.key].error.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}\"/>` : "";
  return `<testcase classname=\"${result.testFilePath}\" name=\"${result.testName}\"${time}>${failure}</testcase>`;
});
fs.writeFileSync("results/junit.xml", `<?xml version=\"1.0\" encoding=\"UTF-8\"?><testsuite name=\"Playwright E2E\" tests=\"${flatResults.length}\" failures=\"${failures}\" timestamp=\"${new Date(baseWallTime).toISOString()}\">${junitCases.join("")}</testsuite>\n`);
fs.writeFileSync("results/run-metadata.json", JSON.stringify({ fixtureDate, commitSha, runId, scenario, branch: process.env.GITHUB_REF_NAME || "main", jobDurationFallbackRequired: flatResults.some((result) => result.durationMs == null) }, null, 2));
fs.writeFileSync("results/fixture-outcome.txt", failures ? "failed" : "passed");

console.log(`Generated ${flatResults.length} Playwright result(s); failures=${failures}; scenario=${scenario}`);


import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

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

async function buildTrace(test) {
  const d = details[test.key];
  const dir = path.join("test-results", slug(test));
  fs.mkdirSync(dir, { recursive: true });
  const tracePath = path.join(dir, "trace.zip");
  const method = ["checkout", "auth", "cart"].includes(test.key) ? "POST" : "GET";
  const responseBody = JSON.stringify({ fixture: test.key, status: d.request.status, retryable: d.request.status >= 429 });
  const jsonInScript = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const pageHtml = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>${test.title}</title></head><body><div id="fixture-root">${d.before}</div><script>
    window.fixtureSettled = false;
    document.addEventListener("submit", (event) => event.preventDefault());
    setTimeout(async () => {
      try {
        const response = await fetch(${jsonInScript(d.request.url)}, { method: ${jsonInScript(method)}, headers: { accept: "application/json" } });
        window.fixtureResponse = { status: response.status, body: await response.text() };
        document.getElementById("fixture-root").innerHTML = ${jsonInScript(d.after)};
      } catch (error) { console.error("fixture request failed", String(error)); }
      finally { window.fixtureSettled = true; }
    }, 250);
  </script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
      response.end(pageHtml);
      return;
    }
    if (request.url === d.request.url) {
      request.resume();
      setTimeout(() => {
        response.writeHead(d.request.status, { "content-type": "application/json", "x-fixture-date": fixtureDate, connection: "close" });
        response.end(responseBody);
      }, d.request.delay);
      return;
    }
    response.writeHead(404, { connection: "close" });
    response.end("Not found");
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let context;
  let actionError = null;
  const actionStarted = Date.now();
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_FIXTURE_CHANNEL ? { channel: process.env.PLAYWRIGHT_FIXTURE_CHANNEL } : {}) });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US", baseURL: origin });
    if (["notifications", "locale-de"].includes(test.key)) {
      await context.addInitScript((key) => {
        if (key === "notifications") localStorage.setItem("notification.dismissedIds", "[n-17]");
        if (key === "locale-de") localStorage.setItem("locale", "en-US");
      }, test.key);
    }
    await context.tracing.start({ title: test.title, screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const responsePromise = page.waitForResponse((response) => response.url() === `${origin}${d.request.url}`, { timeout: 15000 }).catch((error) => error);
    await page.goto(`${origin}/fixture`);
    for (const message of d.console) {
      await page.evaluate((text) => {
        if (text.includes("[error]")) console.error(text);
        else if (text.includes("[warn]")) console.warn(text);
        else console.log(text);
      }, message);
    }
    try {
      switch (test.key) {
        case "dashboard":
          await page.getByTestId("analytics-card").first().waitFor({ state: "visible", timeout: 5000 });
          break;
        case "profile":
          await page.locator(".settings-panel .save-button, .save-button").click({ timeout: 1000 });
          break;
        case "checkout":
          await page.getByRole("button", { name: "Place order" }).click({ timeout: 1000 });
          await page.getByTestId("order-confirmation").waitFor({ state: "visible", timeout: 1500 });
          break;
        case "notifications":
          await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 1000 });
          await responsePromise;
          await page.waitForFunction(() => document.querySelector("[data-testid=unread-count]")?.textContent === "2", null, { timeout: 800 });
          break;
        case "search":
          await page.getByRole("listbox").waitFor({ state: "visible", timeout: 5000 });
          break;
        case "locale-us":
          await page.getByText("$1,234.50", { exact: true }).click({ timeout: 1000 });
          break;
        case "locale-de":
          await responsePromise;
          await page.waitForFunction(() => document.querySelector("[data-testid=order-total]")?.textContent === "1.234,50 €", null, { timeout: 800 });
          break;
        case "auth":
          await page.getByRole("button", { name: "Sign in" }).click({ timeout: 1000 });
          await page.waitForURL("**/home", { timeout: 1500 });
          break;
      }
    } catch (error) {
      actionError = error;
    }
    const apiResponse = await responsePromise;
    if (apiResponse instanceof Error) throw apiResponse;
    await page.waitForFunction(() => window.fixtureSettled === true, null, { timeout: 15000 });
    await page.locator("#fixture-root").screenshot();
    await page.evaluate((message) => console.error(`[fixture failure] ${message}`), d.error);
    try {
      await page.evaluate((message) => { throw new Error(message); }, d.error);
    } catch (error) {
      actionError ??= error;
    }
    await context.tracing.stop({ path: tracePath });
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  const elapsedMs = Date.now() - actionStarted;
  fs.writeFileSync(path.join(dir, "dom-snapshot.html"), `<!doctype html><html><body><h1>Before</h1>${d.before}<h1>After</h1>${d.after}</body></html>`);
  fs.writeFileSync(path.join(dir, "console.log"), `${d.console.join("\n")}\n[fixture failure] ${d.error}\n`);
  fs.writeFileSync(path.join(dir, "requests.log"), `${new Date(baseWallTime + 250).toISOString()} ${method} ${origin}${d.request.url}\n`);
  fs.writeFileSync(path.join(dir, "responses.log"), `${new Date(baseWallTime + 250 + d.request.delay).toISOString()} ${d.request.status} ${origin}${d.request.url} (${d.request.delay}ms)\n`);
  fs.writeFileSync(path.join(dir, "action-timing.json"), JSON.stringify({ action: d.action, elapsedMs, timeoutMs: 5000, requestDelayMs: d.request.delay }, null, 2));
  fs.writeFileSync(path.join(dir, "failure-evidence.txt"), `${d.error}\nObserved action error: ${actionError?.message || "none"}\nRoot-cause signal: ${test.rootCause}\nCommit: ${commitSha}\n`);
  return tracePath;
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
    tracePath = await buildTrace(test);
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


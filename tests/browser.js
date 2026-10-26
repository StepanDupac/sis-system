import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { inspectCuniPage } from "../extension/cuni/inspect.js";

const extension = resolve("extension");
const profile = await mkdtemp(resolve(tmpdir(), "sis-executor-test-"));
await mkdir("test-results", { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 1050 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [];
const externalRequests = [];
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
context.on("request", (request) => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
let checks = 0;
async function check(name, run) { await run(); checks += 1; console.log(`PASS ${name}`); }
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const url = `chrome-extension://${id}/app.html`;
  await page.goto(url);
  await page.locator("html[data-ready=true]").waitFor();
  await check("Czech interface and explicit training disclosure", async () => {
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await expect(page.getByText("Jste v tréninku.", { exact: true })).toBeVisible();
    await expect(page.locator("#slots .slot")).toHaveCount(3);
    await page.screenshot({ path: "test-results/dashboard-desktop.png", fullPage: true });
  });
  await check("slot order is editable and persists after reload", async () => {
    const before = await page.locator(".slot").first().getAttribute("data-slot-id");
    await page.locator(".slot").first().locator(".icon-button").nth(1).click();
    await expect(page.locator(".slot").nth(1)).toHaveAttribute("data-slot-id", before);
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get("demoPreferences")).demoPreferences?.slots[1]?.id)).toBe(before);
    await page.reload();
    await page.locator("html[data-ready=true]").waitFor();
    await expect(page.locator(".slot").nth(1)).toHaveAttribute("data-slot-id", before);
  });
  await check("foreground countdown falls back and verifies the second priority", async () => {
    const fallbackLabel = await page.locator(".slot").nth(1).locator(".slot-title").textContent();
    await page.locator("#start").click();
    await expect(page.locator("#start")).toBeDisabled();
    await expect(page.locator("#result")).toContainText("V tréninku se to povedlo", { timeout: 12_000 });
    await expect(page.locator("#result")).toContainText(fallbackLabel);
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(2);
    await expect(page.locator("li[data-state=success]")).toHaveCount(1);
    await expect(page.locator("#start")).toBeEnabled();
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get("demoUnresolvedAttempt")).demoUnresolvedAttempt), undefined);
    await page.screenshot({ path: "test-results/dashboard-success.png", fullPage: true });
  });
  await check("export is a downloadable training log with no credentials", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#download-log").click();
    const download = await downloadPromise;
    const payload = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(payload.mode, "offline-training");
    assert.ok(payload.events.some((event) => event.state === "success"));
    assert.equal(/password|cookie|csrf/i.test(JSON.stringify(payload)), false);
  });
  await check("second extension tab cannot dispatch while the first is armed", async () => {
    await page.locator("#start").click();
    await expect(page.locator("#status-label")).toHaveText("Čekám na spuštění");
    const second = await context.newPage();
    await second.goto(url);
    await second.locator("html[data-ready=true]").waitFor();
    await second.locator("#start").click();
    await expect(second.locator("#result")).toContainText("Trénink už běží v jiné záložce");
    await expect(second.locator("li[data-state=submitting]")).toHaveCount(0);
    await page.locator("#stop").click();
    await expect(page.locator("#result")).toContainText("Trénink zastaven");
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(0);
    await second.close();
    await page.bringToFront();
  });
  await check("lost response confirms one request rather than trying a backup", async () => {
    await page.locator("#scenario").selectOption("delayed");
    await page.locator("#start").click();
    await expect(page.locator("#result")).toContainText("V tréninku se to povedlo", { timeout: 12_000 });
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(1);
  });
  await check("ambiguous outcome survives reload and needs an explicit demo reset", async () => {
    await page.locator("#scenario").selectOption("unknown");
    await page.locator("#start").click();
    await expect(page.locator("#result")).toContainText("Výsledek není jistý", { timeout: 12_000 });
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(1);
    await page.reload();
    await page.locator("html[data-ready=true]").waitFor();
    await expect(page.locator("#result")).toContainText("Zůstal nejasný výsledek");
    await page.locator("#reset-demo").click();
    await expect(page.locator("#result")).toBeHidden();
  });
  await check("empty selection is rejected without a request", async () => {
    const checkedIds = await page.locator("#slots input[type=checkbox]:checked").evaluateAll((inputs) => inputs.map((input) => input.id));
    for (const checkboxId of checkedIds) await page.locator(`#${checkboxId}`).uncheck();
    await page.locator("#start").click();
    await expect(page.locator("#result")).toContainText("Vyberte alespoň jeden termín");
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(0);
  });
  await check("expired login prevents dispatch", async () => {
    await page.locator("#slots input[type=checkbox]").first().check();
    await page.locator("#scenario").selectOption("expired");
    await page.locator("#start").click();
    await expect(page.locator("#result")).toContainText("Přihlášení vypršelo");
    await expect(page.locator("li[data-state=submitting]")).toHaveCount(0);
  });
  await check("university mode does not pretend to be connected", async () => {
    await page.locator("#live-tab").click();
    await expect(page.locator("#live-panel")).toContainText("Ostrý zápis zatím není dostupný");
    await expect(page.locator("#start")).toBeHidden();
    await page.screenshot({ path: "test-results/cuni-connect.png", fullPage: true });
    await page.locator("#back-to-demo").click();
  });
  await check("mobile layout does not overflow and manual is available offline", async () => {
    await page.setViewportSize({ width: 375, height: 850 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "test-results/dashboard-mobile.png", fullPage: true });
    const manual = await context.newPage();
    await manual.goto(`chrome-extension://${id}/manual.html`);
    await expect(manual.getByRole("heading", { name: "Krátký návod", exact: true })).toBeVisible();
    await expect(manual.locator("main")).toContainText("Skutečný zápis zatím není aktivní");
    await manual.screenshot({ path: "test-results/manual.png", fullPage: true });
    await manual.close();
  });
  await check("runtime has no JavaScript errors and training makes no external requests", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    const { awakeTab } = await worker.evaluate(() => chrome.storage.session.get("awakeTab"));
    assert.equal(awakeTab, undefined, "wake request released after completion");
  });
  await check("CUNI panel explains how to connect a tab without silently inspecting another one", async () => {
    await page.locator("#live-tab").click();
    await page.locator("#inspect-cuni").click();
    await expect(page.locator("#cuni-result")).toContainText("ikonu rozšíření Termín");
  });
  await check("CUNI source binding opens the correct panel and rejects a non-SIS tab", async () => {
    const tabId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    const bound = await context.newPage();
    await bound.goto(`${url}?sisTab=${tabId}`);
    await bound.locator("html[data-ready=true]").waitFor();
    await expect(bound.locator("#live-tab")).toHaveAttribute("aria-selected", "true");
    await bound.locator("#inspect-cuni").click();
    await expect(bound.locator("#cuni-result")).toContainText("už není na is.cuni.cz/studium/");
    await bound.close();
  });
  // Synthetic HTML on an intercepted URL. No requests reach the university.
  const fixturePage = await context.newPage();
  await fixturePage.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Termíny zkoušek - přihlašování</title></head><body>
    <a href="?do=zapsane&KEY=SENSITIVE_SESSION_VALUE">Zapsané</a>
    <form action="/studium/synthetic-fixture/index.php?KEY=SENSITIVE_SESSION_VALUE" method="post">
      <input type="hidden" name="csrf" value="SENSITIVE_CSRF_VALUE">
      <input name="student" value="SENSITIVE_STUDENT_NAME"><input type="password" name="password" value="SENSITIVE_PASSWORD_VALUE">
      <button type="submit" name="action" value="SENSITIVE_ACTION_VALUE" onclick="window.didSubmit=true;return false">Zapsat</button>
    </form><table><tr><th>Datum</th><th>Hodina</th><th>Volno</th><th>Učitel</th></tr><tr><td>12. 1. 2027</td><td>09:00</td><td>2/20</td><td>SENSITIVE_TEACHER_NAME</td></tr></table>
    <a href="https://outside.invalid/?token=SENSITIVE_OTHER_VALUE">Zapsat</a></body></html>` }));
  await fixturePage.goto("https://is.cuni.cz/studium/synthetic-fixture/index.php?KEY=SENSITIVE_URL_VALUE");
  await check("CUNI diagnostic omits credentials, tokens, names and raw URL values", async () => {
    const report = await fixturePage.evaluate(inspectCuniPage);
    assert.equal(report.status, "login_required");
    assert.equal(report.registrationEnabled, false);
    assert.equal(report.sessionVerified, false);
    assert.equal(JSON.stringify(report).includes("SENSITIVE_"), false);
    assert.equal(report.controls.find((item) => item.target === null)?.label, "Zapsat");
    assert.ok(report.forms[0].fields.some((field) => field.name === "csrf"));
    assert.equal(await fixturePage.evaluate(() => window.didSubmit), undefined);
  });
  await check("CUNI diagnostic recognizes synthetic exam structure and is serializable for injection", async () => {
    await fixturePage.locator("input[type=password]").evaluate((node) => node.remove());
    const report = await fixturePage.evaluate(inspectCuniPage);
    assert.equal(report.status, "exam_page");
    assert.equal(report.tables[0].dateExamples[0].date, "12. 1. 2027");
    assert.equal(report.tables[0].dateExamples[0].time, "09:00");
    assert.equal(report.forms[0].target.path, "/studium/synthetic-fixture/index.php");
    assert.equal(await fixturePage.evaluate(() => window.didSubmit), undefined);
    await fixturePage.close();
  });
  assert.deepEqual(errors, []);
  console.log(`${checks} browser checks passed.`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { strict as assert } from "assert";

const app = resolve(import.meta.dir, "..");
const directory = mkdtempSync(join(tmpdir(), "dagdo-connection-browser-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const url = `http://localhost:${port}`;
async function startUi() {
  const child = Bun.spawn(["bun", "run", "src/cli.ts", "ui", "--port", String(port), "--no-open"], { cwd: app, stdout: "ignore", stderr: "ignore", env: { ...process.env, DAGDO_DATA_DIR: directory, DAGDO_LOCAL_MODE: "0" } });
  for (let i = 0; i < 100; i++) {
    if (await fetch(url + "/api/projects").then(() => true, () => false)) return child;
    await Bun.sleep(100);
  }
  child.kill(); throw new Error("UI server did not start.");
}
let server = await startUi();
const browser = await chromium.launch({ headless: true, executablePath: process.env.DAGDO_BROWSER_EXECUTABLE });
try {
  const addTask = (title: string) => fetch(url + "/api/projects/default/tasks", { method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body: JSON.stringify({ title }) }).then(res => assert(res.ok));
  await addTask("Connection task");
  const page = await browser.newPage();
  await page.goto(url);
  const taskButton = page.getByRole("button", { name: "Connection task", exact: true });
  await taskButton.waitFor();
  await taskButton.dblclick();
  const taskDialog = page.getByRole("dialog", { name: "Task", exact: true });
  await taskDialog.waitFor();

  server.kill(); await server.exited;
  const popup = page.getByRole("alertdialog", { name: "dagdo server is not connected", exact: true });
  await popup.waitFor();
  await page.keyboard.press("Escape");
  assert(await popup.isVisible());
  assert.equal(await page.locator("#task-progress").count(), 1);
  assert.equal(await page.getByText("Failed to fetch").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Start Orca", exact: true }).count(), 0);
  await page.mouse.click(5, 300);
  assert(await popup.isVisible());
  if (process.env.DAGDO_KEEP_BROWSER_ARTIFACTS === "1") await page.screenshot({ path: join(directory, "server-down.png"), animations: "disabled" });

  server = await startUi();
  await popup.waitFor({ state: "hidden", timeout: 10_000 });
  await page.getByText("● Connected").waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await taskDialog.waitFor({ state: "hidden" });
  await addTask("After reconnect");
  await page.getByRole("button", { name: "After reconnect", exact: true }).waitFor();

  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Shut down", exact: true }).click();
  await page.getByText(/dagdo has shut down/).waitFor();
  await server.exited;
  await page.waitForTimeout(2500);
  assert.equal(await popup.count(), 0);
  console.log("Connection browser checks passed: blocking popup, no raw fetch error, no Start Orca, auto reconnect, live updates, intentional shutdown.");
  if (process.env.DAGDO_KEEP_BROWSER_ARTIFACTS === "1") console.log("Screenshots: " + directory);
} finally {
  await browser.close(); server.kill();
  if (process.env.DAGDO_KEEP_BROWSER_ARTIFACTS !== "1") rmSync(directory, { recursive: true, force: true });
}

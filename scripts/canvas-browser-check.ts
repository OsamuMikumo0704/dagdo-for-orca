import { strict as assert } from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/server";

const directory = mkdtempSync(join(tmpdir(), "dagdo-canvas-"));
const previous = process.env.DAGDO_DATA_DIR;
process.env.DAGDO_DATA_DIR = directory;
const server = await startServer({ preferredPort: 0 });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

async function blankPoint(page: Page) {
  return page.locator(".react-flow__pane").evaluate(pane => {
    const box = pane.getBoundingClientRect();
    for (const y of [0.25, 0.5, 0.75]) for (const x of [0.15, 0.85, 0.35, 0.65]) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y };
      if (pane.ownerDocument.elementFromPoint(point.x, point.y) === pane) return point;
    }
    throw new Error("No empty canvas point found");
  });
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.DAGDO_BROWSER_EXECUTABLE });
  const seeded = await fetch(server.url + "/api/projects/default/tasks", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: server.url },
    body: JSON.stringify({ title: "Canvas fixture" }),
  });
  assert.equal(seeded.status, 201);
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(server.url);
    await page.locator(".react-flow__node-task").first().waitFor();
    await page.locator('.react-flow__viewport[style*="transform"]').waitFor();
    const ghost = page.locator(".dagdo-create-ghost");
    const point = await blankPoint(page);
    await page.mouse.move(point.x, point.y);
    assert.equal(await ghost.count(), 0);
    await page.keyboard.down("Alt");
    await page.mouse.move(point.x + 1, point.y + 1);
    await ghost.waitFor({ state: "visible" });
    const preview = await ghost.boundingBox();
    assert(preview);
    assert(Math.abs(preview.x + preview.width / 2 - point.x - 1) < 1);
    assert(Math.abs(preview.y + preview.height / 2 - point.y - 1) < 1);
    assert.equal(await ghost.evaluate(e => e.ownerDocument.defaultView!.getComputedStyle(e).borderTopStyle), "dashed");
    await page.screenshot({ path: join(directory, `preview-${scheme}.png`) });
    await page.keyboard.up("Alt");
    await ghost.waitFor({ state: "detached" });

    // The preview must clear over nodes/controls, outside the canvas, and on blur.
    await page.keyboard.down("Alt");
    await page.mouse.move(point.x, point.y);
    await ghost.waitFor();
    const node = page.locator(".react-flow__node-task").first();
    const nodeBox = await node.boundingBox();
    assert(nodeBox);
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await ghost.waitFor({ state: "detached" });
    await page.mouse.move(point.x, point.y);
    await ghost.waitFor();
    const zoom = await page.getByRole("button", { name: "Zoom In", exact: true }).boundingBox();
    assert(zoom);
    await page.mouse.move(zoom.x + zoom.width / 2, zoom.y + zoom.height / 2);
    await ghost.waitFor({ state: "detached" });
    await page.mouse.move(point.x, point.y);
    await ghost.waitFor();
    await page.mouse.move(20, 100);
    await ghost.waitFor({ state: "detached" });
    await page.mouse.move(point.x, point.y);
    await ghost.waitFor();
    await page.locator(".react-flow__pane").evaluate(e => e.ownerDocument.defaultView!.dispatchEvent(new Event("blur")));
    await ghost.waitFor({ state: "detached" });
    await page.keyboard.up("Alt");

    // Ordinary drag selection still selects a task.
    await page.mouse.move(nodeBox.x - 12, nodeBox.y - 12);
    await page.mouse.down();
    await page.mouse.move(nodeBox.x + nodeBox.width + 12, nodeBox.y + nodeBox.height + 12, { steps: 10 });
    await page.mouse.up();
    await page.locator(".react-flow__node-task.selected").first().waitFor();
    assert.equal(await ghost.count(), 0);

    // Space-drag still pans and suppresses the preview even with Alt held.
    const panPoint = await blankPoint(page);
    const viewport = page.locator(".react-flow__viewport");
    const beforePan = await viewport.getAttribute("style");
    await page.keyboard.down("Alt");
    await page.mouse.move(panPoint.x, panPoint.y);
    await ghost.waitFor();
    await page.keyboard.down("Space");
    await ghost.waitFor({ state: "detached" });
    await page.mouse.down();
    await page.mouse.move(panPoint.x + 35, panPoint.y + 25, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.keyboard.up("Alt");
    assert.notEqual(await viewport.getAttribute("style"), beforePan);

    // Alt-click still opens the inline editor and saves exactly one new task.
    const createPoint = await blankPoint(page);
    await page.keyboard.down("Alt");
    await page.mouse.move(createPoint.x, createPoint.y);
    await ghost.waitFor();
    await page.mouse.click(createPoint.x, createPoint.y);
    const input = page.locator(".dagdo-node-draft input");
    await input.waitFor();
    await ghost.waitFor({ state: "detached" });
    await page.keyboard.up("Alt");
    await input.fill(`Created with Alt click ${scheme}`);
    await input.press("Enter");
    await input.waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Created with Alt click ${scheme}`, exact: true }).waitFor();
    const graph = await (await fetch(server.url + "/api/projects/default/graph")).json() as { tasks: { title: string }[] };
    assert.equal(graph.tasks.filter(t => t.title === `Created with Alt click ${scheme}`).length, 1);
    console.log(`Canvas checks passed in ${scheme} theme.`);
    await context.close();
  }
  console.log("Canvas browser checks passed: Alt-hover preview, clearing, drag selection, Space-drag panning and Alt-click creation in both themes.");
  if (process.env.DAGDO_KEEP_BROWSER_ARTIFACTS === "1") console.log("Screenshots: " + directory);
} finally {
  await browser?.close();
  await server.stop();
  if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
  if (process.env.DAGDO_KEEP_BROWSER_ARTIFACTS !== "1") rmSync(directory, { recursive: true, force: true });
}

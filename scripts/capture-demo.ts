// Reproducible README screenshot. Only fictional data in a temporary store.
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { saveStore, withGraphLock } from "../src/storage";
import { startServer } from "../src/server/server";

const data = mkdtempSync(join(tmpdir(), "dagdo-demo-"));
const previous = process.env.DAGDO_DATA_DIR;
process.env.DAGDO_DATA_DIR = data;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  await withGraphLock(() => saveStore({ version: 2, projects: [{
    id: "demo", name: "Product launch", version: 1,
    tasks: [
      { id: "aaa111", title: "Research user needs", progress: "ready" as const, doneAt: "2026-01-03T10:00:00Z" },
      { id: "bbb222", title: "Design the experience", progress: "in_progress" as const, doneAt: null },
      { id: "ccc333", title: "Build the API", progress: "ready" as const, doneAt: null },
      { id: "ddd444", title: "Build the interface", progress: "ready" as const, doneAt: null },
      { id: "eee555", title: "Test the complete workflow", progress: "ready" as const, doneAt: null },
      { id: "fff666", title: "Write the launch guide", progress: "ready" as const, doneAt: null },
      { id: "abc123", title: "Explore mobile support", progress: "backlog" as const, doneAt: null },
    ].map(t => ({ ...t, note: "Fictional demo task. No personal or production data.", createdAt: "2026-01-01T10:00:00Z" })),
    edges: [{ from: "aaa111", to: "bbb222" }, { from: "bbb222", to: "ccc333" },
      { from: "bbb222", to: "ddd444" }, { from: "ccc333", to: "eee555" }, { from: "ddd444", to: "eee555" }],
  }] }));
  server = await startServer({ preferredPort: 0 });
  browser = await chromium.launch({ executablePath: process.env.DAGDO_BROWSER_EXECUTABLE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
  await page.goto(server.url);
  await page.locator(".react-flow__node-task").first().waitFor();
  await page.waitForTimeout(1000);
  const images = resolve(import.meta.dir, "../docs/images");
  mkdirSync(images, { recursive: true });
  await page.screenshot({ path: join(images, "task-map.png"), animations: "disabled" });
  console.log("Saved docs/images/task-map.png using fictional temporary data.");
} finally {
  await browser?.close();
  await server?.stop();
  if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
  rmSync(data, { recursive: true, force: true });
}

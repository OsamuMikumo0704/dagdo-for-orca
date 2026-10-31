// Links the repository skill into the agents' user skill folders. Junctions keep
// agents on the current SKILL.md, so skill changes need no reinstall.
import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { environment } from "../src/environment";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (environment().development) fail("Run this from the main worktree. A linked worktree can be removed, which would break the skill.");

const target = realpathSync(resolve(import.meta.dir, "../skills/dagdo"));
const home = process.env.USERPROFILE || homedir();
const links = [".agents", ".claude"].map((root) => join(home, root, "skills", "dagdo"));

const exists = (path: string) => {
  try { lstatSync(path); return true; }
  catch { return false; }
};
const installed = (path: string) => {
  try { return realpathSync(path).toLowerCase() === target.toLowerCase(); }
  catch { return false; }
};

// Check every location before changing any of them.
for (const link of links) {
  if (exists(link) && !installed(link)) fail(`Refusing to replace ${link}. Remove it first if it is no longer needed.`);
}
for (const link of links) {
  if (exists(link)) {
    console.log(`Already installed: ${link}`);
    continue;
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  console.log(`Installed: ${link}`);
}

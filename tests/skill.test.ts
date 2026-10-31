import { expect, it, spyOn } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { helpCommand } from "../src/commands/help";

const app = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(app, path), "utf8").replace(/\r\n/g, "\n");
const skill = read("skills/dagdo/SKILL.md");
const docs = skill + read("skills/dagdo/references/orca-workspaces.md");
const cliCommands = () => {
  const hidden = ["ls", "remove", "version", "help", "sync", "ui", "upgrade", "view"];
  return [...read("src/cli.ts").matchAll(/case "([a-z]+)":/g)].map(m => m[1]!).filter(name => !hidden.includes(name));
};
const workspaceActions = () => [...read("src/orca.ts").matchAll(/dagdo workspace ([a-z|]+)/g)].flatMap(m => m[1]!.split("|"));

it("has valid skill metadata", () => {
  const metadata = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
  expect(metadata).toContain("name: dagdo\n");
  const description = /^description: (.+)$/m.exec(metadata)?.[1] ?? "";
  expect(description.length).toBeGreaterThan(50);
  expect(description.length).toBeLessThanOrEqual(1024);
});

it("documents every agent command in the skill and help", () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  let help: string;
  try { helpCommand(); help = log.mock.calls.flat().join("\n"); } finally { log.mockRestore(); }
  const commands = cliCommands();
  expect(commands).toContain("reopen");
  for (const command of commands) {
    expect(skill).toContain("`" + command);
    expect(help).toContain(command);
  }
  const actions = workspaceActions();
  expect(actions).toContain("reconcile");
  for (const action of actions) {
    expect(docs).toContain("workspace " + action);
    expect(help).toContain(action);
  }
});

it("mentions only flags the application implements", () => {
  const source = ["src/cli.ts", "src/orca.ts", "scripts/manage.ts", ...["add", "edit", "done", "reopen", "remove", "link", "unlink", "show", "list", "next", "graph", "status", "projects", "history"].map(name => `src/commands/${name}.ts`)].map(read).join("\n");
  for (const [flag] of docs.matchAll(/(?<![\w-])--[a-z][a-z-]+/g)) {
    expect(source, flag).toContain(flag.slice(2));
  }
});

it("installs the skill as links, repeats safely and preserves other content", () => {
  const root = mkdtempSync(join(tmpdir(), "dagdo-skill-"));
  try {
    const repository = join(root, "app"), home = join(root, "home");
    mkdirSync(join(repository, "scripts"), { recursive: true }); mkdirSync(join(repository, "src"));
    cpSync(join(app, "scripts/install-skill.ts"), join(repository, "scripts/install-skill.ts"));
    cpSync(join(app, "src/environment.ts"), join(repository, "src/environment.ts"));
    cpSync(join(app, "skills"), join(repository, "skills"), { recursive: true });
    const git = (...args: string[]) => expect(Bun.spawnSync(["git", "-C", repository, ...args]).exitCode).toBe(0);
    git("init"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
    const install = (from: string, userHome: string) => {
      const child = Bun.spawnSync([process.execPath, "run", join(from, "scripts/install-skill.ts")], { env: { ...process.env, USERPROFILE: userHome } });
      return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString() };
    };
    const first = install(repository, home);
    expect(first.code, first.err).toBe(0);
    for (const folder of [".agents", ".claude"]) {
      expect(readFileSync(join(home, folder, "skills/dagdo/SKILL.md"), "utf8")).toContain("name: dagdo");
    }
    expect(install(repository, home).out).toContain("Already installed");

    const other = join(root, "other-home");
    mkdirSync(join(other, ".claude/skills/dagdo"), { recursive: true });
    const refused = install(repository, other);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("Refusing");
    expect(existsSync(join(other, ".agents/skills/dagdo"))).toBe(false);

    const linked = join(root, "linked");
    git("worktree", "add", "-b", "feature", linked);
    const worktree = install(linked, join(root, "worktree-home"));
    expect(worktree.code).toBe(1);
    expect(worktree.err).toContain("main worktree");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

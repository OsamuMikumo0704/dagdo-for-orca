import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

it.skipIf(process.platform !== "win32" || !process.env.DAGDO_TEST_PWSH)("PowerShell launchers preserve native arguments, Unicode paths, environment isolation and exit codes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dagdo shell \u65e5\u672c\u8a9e "));
  const app = resolve(import.meta.dir, "..");
  const probe = join(directory, "argument probe.ts"), result = join(directory, "result.json");
  const fixture = join(directory, "fixture.ps1");
  const values = ["", "two words", 'say "hello"', 'slash\\"quote', "trailing\\", "two trailing\\\\", "line one\nline two", "\u65e5\u672c\u8a9e", "& ` $(literal) ; %PATH%"];
  const title = 'Task "quoted" \\ \u65e5\u672c\u8a9e';
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const data = join(directory, "task data"), backups = join(directory, "backups");
  writeFileSync(probe, `import { writeFileSync } from "fs";
writeFileSync(process.argv[2]!, JSON.stringify({args: process.argv.slice(3), data: process.env.DAGDO_DATA_DIR, backups: process.env.DAGDO_BACKUP_DIR, mode: process.env.DAGDO_LOCAL_MODE, extra: process.env.DAGDO_TEST_VALUE}));
process.exit(23);
`);
  // A BOM lets Windows PowerShell 5.1 read the Unicode test strings as UTF-8.
  writeFileSync(fixture, "\uFEFF" + `
. ${quote(join(app, "scripts/common.ps1"))}
$code = Invoke-DagdoChild -Arguments @(${["run", probe, result, ...values].map(quote).join(", ")}) -Environment @{ DAGDO_LOCAL_MODE='probe'; DAGDO_TEST_VALUE='child only' }
if ($code -ne 23) { throw "Lost native exit code: $code" }
if ($env:DAGDO_LOCAL_MODE -ne 'parent' -or $env:DAGDO_TEST_VALUE) { throw 'Child environment leaked into the caller.' }
& ${quote(join(app, "scripts/dagdo.ps1"))} add ${quote(title)} --json
exit $LASTEXITCODE
`);
  try {
    const child = Bun.spawn([process.env.DAGDO_TEST_PWSH!, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture], {
      env: { ...process.env, DAGDO_DATA_DIR: data, DAGDO_BACKUP_DIR: backups, DAGDO_LOCAL_MODE: "parent", DAGDO_TEST_VALUE: "" },
      stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err).toBe(0);
    expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({ args: values, data, backups, mode: "probe", extra: "child only" });
    expect(JSON.parse(out).task.title).toBe(title);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

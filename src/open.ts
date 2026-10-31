import { execFileSync } from "child_process";

/**
 * Open a file or URL with the user's default handler. Picks the right
 * invocation per platform; gives a clearer error on Linux when `xdg-open`
 * is missing.
 */
export function openExternal(target: string): void {
  try {
    // Pass paths as data, never interpolate them into a shell command.
    if (process.platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:DAGDO_OPEN_TARGET"], {
        env: { ...process.env, DAGDO_OPEN_TARGET: target }, windowsHide: true, stdio: "ignore",
      });
    } else {
      execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [target], { stdio: "ignore" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.platform !== "darwin" && process.platform !== "win32") {
      console.error(
        `Failed to open ${target}: ${msg}\n` +
          "Hint: xdg-open may not be installed. Install xdg-utils or open the URL manually.",
      );
    } else {
      console.error(`Failed to open ${target}: ${msg}`);
    }
  }
}

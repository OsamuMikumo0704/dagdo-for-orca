import { parseArgs } from "util";
import pc from "picocolors";
import { startServer } from "../server";
import { openExternal } from "../open";
import { environment } from "../environment";
import { globalDataDir } from "../storage";

const DEFAULT_PORT = 3737;

export async function uiCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
    },
  });

  const preferredPort = values.port ? parsePort(values.port as string) : environment().development ? 3738 : DEFAULT_PORT;

  const server = await startServer({ preferredPort });

  console.log(pc.green(`dagdo ui running at ${server.url}`));
  console.log(`  ${environment().development ? "Development" : "Local"} data: ${globalDataDir()}`);
  if (server.port !== preferredPort) {
    console.log(pc.dim(`  (port ${preferredPort} was in use)`));
  }
  console.log(pc.dim("  Ctrl+C to stop"));

  if (!values["no-open"]) {
    openExternal(server.url);
  }

  await waitForShutdown(server.stop, server.closed);
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`Invalid --port ${raw}. Expected integer 1–65535.`);
    process.exit(1);
  }
  return n;
}

function waitForShutdown(stop: () => Promise<void>, closed: Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const shutdown = async () => {
      try {
        await stop();
      } finally {
        resolve();
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    void closed.then(() => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    });
  });
}

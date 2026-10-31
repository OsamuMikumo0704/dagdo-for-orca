#!/usr/bin/env bun

import { addCommand } from "./commands/add";
import { removeCommand } from "./commands/remove";
import { editCommand } from "./commands/edit";
import { showCommand } from "./commands/show";
import { listCommand } from "./commands/list";
import { doneCommand } from "./commands/done";
import { reopenCommand } from "./commands/reopen";
import { nextCommand } from "./commands/next";
import { linkCommand } from "./commands/link";
import { unlinkCommand } from "./commands/unlink";
import { graphCommand } from "./commands/graph";
import { viewCommand } from "./commands/view";
import { statusCommand } from "./commands/status";
import { projectsCommand } from "./commands/projects";
import { historyCommand } from "./commands/history";
import { syncCommand } from "./commands/sync";
import { uiCommand } from "./commands/ui";
import { helpCommand } from "./commands/help";
import { checkAliasOffer } from "./alias";
import { checkForUpdate, upgradeCommand } from "./upgrade";
import pkg from "../package.json";
import { environment } from "./environment";
import { CliError } from "./cli-error";

if (environment().development) process.env.DAGDO_LOCAL_MODE = "1";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

async function main(): Promise<void> {
  const projectFlag = rest.findIndex(a => a === "--project" || a.startsWith("--project="));
  let projectId: string | undefined;
  if (projectFlag >= 0) {
    const flag = rest[projectFlag]!;
    projectId = flag.includes("=") ? flag.slice(10) : rest[projectFlag + 1];
    if (!projectId || projectId.startsWith("--")) throw new CliError("invalid_input", "--project requires an ID");
    rest.splice(projectFlag, flag.includes("=") ? 1 : 2);
  }
  const { withProject } = await import("./storage");
  await withProject(projectId ?? "", async () => {

  // Background update check (non-blocking, once per day)
  if (process.env.DAGDO_LOCAL_MODE !== "1") checkForUpdate();

  switch (command) {
    case "workspace": {
      const { workspaceCommand } = await import("./orca");
      await workspaceCommand(rest, projectId);
      break;
    }
    case "projects":
      await projectsCommand(rest);
      break;
    case "add":
      await addCommand(rest);
      break;
    case "rm":
    case "remove":
      await removeCommand(rest);
      break;
    case "edit":
      await editCommand(rest);
      break;
    case "show":
      await showCommand(rest);
      break;
    case "list":
    case "ls":
      await listCommand(rest);
      break;
    case "done":
      await doneCommand(rest);
      break;
    case "reopen":
      await reopenCommand(rest);
      break;
    case "next":
      await nextCommand(rest);
      break;
    case "link":
      await linkCommand(rest);
      break;
    case "unlink":
      await unlinkCommand(rest);
      break;
    case "undo":
    case "redo":
      await historyCommand(command, rest);
      break;
    case "graph":
      await graphCommand(rest);
      break;
    case "view":
      await viewCommand();
      break;
    case "status":
      await statusCommand(rest);
      break;
    case "sync":
      if (process.env.DAGDO_LOCAL_MODE === "1") {
        console.error("Local mode: cloud sync is disabled.");
        process.exitCode = 1;
      } else await syncCommand(rest);
      break;
    case "ui":
      await uiCommand(rest);
      break;
    case "upgrade":
      if (process.env.DAGDO_LOCAL_MODE === "1") {
        console.error("Local fork: upgrade is disabled. Update the source with Git.");
        process.exitCode = 1;
      } else await upgradeCommand();
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(pkg.version);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      helpCommand();
      break;
    default:
      throw new CliError("unknown_command", `Unknown command: ${command}\nRun "dagdo help" for usage.`);
  }

  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const parseError = (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS");
  const code = error instanceof CliError ? error.code : parseError ? "invalid_input" : "failed";
  console.error(args.includes("--json") ? JSON.stringify({ error: code, message }) : message);
  process.exitCode = 1;
}
if (process.env.DAGDO_LOCAL_MODE !== "1") await checkAliasOffer();

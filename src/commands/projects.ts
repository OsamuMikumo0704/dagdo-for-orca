import { parseArgs } from "util";
import { readStore, saveStore, withGraphLock } from "../storage";
import { CliError } from "../cli-error";
import { addProject, removeProject, renameProject, type ProjectResult } from "../graph/mutations";
import { printJson } from "./shared";

const USAGE = [
  "Usage: dagdo projects [--json]",
  "       dagdo projects add <name> [--json]",
  "       dagdo projects rename <ID> <name> [--json]",
  "       dagdo projects rm <ID> [--force] [--json]",
].join("\n");

const ERRORS = {
  invalid_name: "Project name cannot be empty.",
  project_not_found: "Project not found.",
  last_project: "The last project cannot be deleted.",
};

export async function projectsCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      force: { type: "boolean", short: "f", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const [action = "list", first, ...more] = positionals;

  const update = (change: (store: ReturnType<typeof readStore>) => ProjectResult, verb: string) =>
    withGraphLock(async () => {
      const result = change(readStore());
      if (!result.ok) throw new CliError(result.error, ERRORS[result.error]);
      await saveStore(result.store);
      const { id, name } = result.project;
      if (values.json) printJson({ project: { id, name } });
      else console.log(`${verb} ${id}  ${name}`);
    });

  switch (action) {
    case "list": {
      if (first !== undefined) throw new CliError("invalid_input", USAGE);
      const projects = readStore().projects.map(({ id, name, tasks }) => ({ id, name, taskCount: tasks.length }));
      if (values.json) printJson(projects);
      else console.log(projects.map((p) => `${p.id}  ${p.name}`).join("\n"));
      return;
    }
    case "add":
      if (first === undefined) throw new CliError("invalid_input", USAGE);
      return update((store) => addProject(store, [first, ...more].join(" ")), "Created");
    case "rename":
      if (first === undefined || more.length === 0) throw new CliError("invalid_input", USAGE);
      return update((store) => renameProject(store, first, more.join(" ")), "Renamed");
    case "rm":
    case "remove":
      if (first === undefined || more.length > 0) throw new CliError("invalid_input", USAGE);
      return update((store) => {
        const tasks = store.projects.find((p) => p.id === first)?.tasks.length ?? 0;
        if (tasks > 0 && !values.force) {
          throw new CliError("project_not_empty", `Project contains ${tasks} task(s). Use --force to delete it with its tasks and dependencies.`);
        }
        return removeProject(store, first);
      }, "Removed");
    default:
      throw new CliError("invalid_input", USAGE);
  }
}

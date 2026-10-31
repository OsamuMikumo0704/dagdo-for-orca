import pc from "picocolors";
import { STATE_LABELS } from "./task-state";
import type { Task } from "./types";

export function formatId(id: string): string {
  return pc.cyan(id);
}

export function formatTask(task: Task, extra?: string): string {
  const done = task.doneAt != null;
  const id = formatId(task.id);
  const state = STATE_LABELS[done ? "done" : task.progress];
  const title = done ? pc.strikethrough(pc.dim(task.title)) : task.title;
  const suffix = extra ? ` ${extra}` : "";
  return `${id}  ${state.padEnd(12)}  ${title}${suffix}`;
}

export function formatTaskTable(tasks: Task[], blockerIds?: Map<string, string[]>): string {
  if (tasks.length === 0) return pc.dim("No tasks.");

  // Compute the display width of each task's title (visible characters only)
  const titleWidths: number[] = [];
  const titles: string[] = [];
  for (const t of tasks) {
    const title = t.doneAt != null ? t.title + " ✓" : t.title;
    titles.push(title);
    titleWidths.push(visualWidth(title));
  }
  const maxTitleWidth = Math.max(...titleWidths);

  // State, title, and unfinished dependency count.
  return tasks
    .map((t, i) => {
      const blockers = blockerIds?.get(t.id);
      const blockedCount = blockers ? blockers.length : 0;
      const padding = " ".repeat(maxTitleWidth - titleWidths[i]!);
      const blockedCol = blockedCount > 0 ? `  ${pc.red(`⏳ ${blockedCount}`)}` : "";

      const id = formatId(t.id);
      const state = STATE_LABELS[t.doneAt != null ? "done" : blockedCount > 0 ? "blocked" : t.progress];
      const done = t.doneAt != null;
      const title = done ? pc.strikethrough(pc.dim(titles[i]!)) : titles[i]!;

      return `${id}  ${state.padEnd(12)}  ${title}${padding}${blockedCol}`;
    })
    .join("\n");
}

/** Estimate visible width, accounting for CJK characters as width 2. */
function visualWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs, CJK Compatibility, Fullwidth forms, etc.
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

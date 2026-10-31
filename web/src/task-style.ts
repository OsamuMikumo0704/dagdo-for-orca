import type { NodeState } from "./types";
export const STATE_STYLE: Record<NodeState, string> = {
  backlog: "bg-muted text-muted-foreground border-border",
  ready: "bg-amber-50 text-amber-900 border-amber-400 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-600",
  in_progress: "bg-green-50 text-green-800 border-green-500 dark:bg-green-950 dark:text-green-300 dark:border-green-400",
  blocked: "bg-muted text-muted-foreground border-border",
  done: "bg-muted text-muted-foreground border-border",
};

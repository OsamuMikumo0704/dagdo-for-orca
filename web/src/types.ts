// Mirror of src/types.ts — kept in sync by hand. Stable schema, rarely changes.

export type TaskProgress = "backlog" | "ready" | "in_progress";

export interface Task {
  id: string;
  title: string;
  progress: TaskProgress;
  createdAt: string;
  doneAt: string | null;
  notes?: string;
  orcaWorkspace?: import("../../src/types").OrcaWorkspace;
  orcaCreation?: import("../../src/types").OrcaCreation;
}

export interface Edge {
  from: string;
  to: string;
}

export interface GraphData {
  version: 1;
  tasks: Task[];
  edges: Edge[];
}

export type NodeState = TaskProgress | "blocked" | "done";

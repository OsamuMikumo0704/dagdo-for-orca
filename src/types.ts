export type TaskId = string;

export type TaskProgress = "backlog" | "ready" | "in_progress";

export interface Task {
  id: TaskId;
  title: string;
  progress: TaskProgress;
  createdAt: string;
  doneAt: string | null;
  notes?: string;
  orcaWorkspace?: OrcaWorkspace;
  orcaCreation?: OrcaCreation;
}

export interface OrcaWorkspace {
  identityKey: string;
  id: string;
  repoId: string;
  projectId: string;
  setupId: string;
  path: string;
  displayName: string;
  branch: string;
  createdAt: string;
}
export interface OrcaCreation {
  requestId: string;
  setupId: string;
  repoId: string;
  name: string;
  baseBranch?: string;
  branch?: string;
  setup: "inherit" | "run" | "skip";
  startedAt: string;
  uncertain?: boolean;
}

export interface Edge {
  from: TaskId;
  to: TaskId;
}

export interface GraphData {
  version: 1;
  tasks: Task[];
  edges: Edge[];
}

export interface AdjacencyGraph {
  inEdges: Map<TaskId, Set<TaskId>>;
  outEdges: Map<TaskId, Set<TaskId>>;
  tasks: Map<TaskId, Task>;
}

/** Layout node for rendering — separates layout computation from output format */
export interface LayoutNode {
  task: Task;
  level: number;
  blocked: number;   // number of unfinished blockers
  blocking: number;  // number of tasks this blocks
}

export interface LayoutEdge {
  from: TaskId;
  to: TaskId;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  levels: Map<number, TaskId[]>;
}

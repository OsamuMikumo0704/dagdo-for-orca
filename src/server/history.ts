import type { GraphData } from "../types";

export type Positions = Record<"tree" | "mindmap", Record<string, { x: number; y: number }>>;
export interface Snapshot { graph: GraphData; positions: Positions }
export interface HistoryState extends Snapshot { revision: number; canUndo: boolean; canRedo: boolean }
const copy = <T>(value: T): T => structuredClone(value);
// Workspace operations have external effects. Their metadata is live, never rewound.
function content(graph: GraphData) {
  return JSON.stringify({ ...graph, tasks: graph.tasks.map(({ orcaWorkspace, orcaCreation, ...task }) => task) });
}
export class ProjectHistory {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private present: Snapshot;
  private revision = 0;
  constructor(graph: GraphData) { this.present = { graph: copy(graph), positions: { tree: {}, mindmap: {} } }; }
  state(): HistoryState { return copy({ ...this.present, revision: this.revision, canUndo: !!this.past.length, canRedo: !!this.future.length }); }
  observe(graph: GraphData): void {
    if (content(graph) === content(this.present.graph)) { this.present.graph = copy(graph); return; }
    const positions = copy(this.present.positions);
    const ids = new Set(graph.tasks.map(t => t.id));
    for (const mode of ["tree", "mindmap"] as const) for (const id of Object.keys(positions[mode])) if (!ids.has(id)) delete positions[mode][id];
    this.push({ graph: copy(graph), positions });
  }
  place(mode: "tree" | "mindmap", positions: Record<string, { x: number; y: number }>): void {
    const next = copy(this.present);
    Object.assign(next.positions[mode], positions);
    if (JSON.stringify(next.positions) !== JSON.stringify(this.present.positions)) this.push(next);
  }
  private push(next: Snapshot) {
    this.past.push(copy(this.present));
    if (this.past.length > 100) this.past.shift();
    this.present = next; this.future = []; this.revision++;
  }
  target(direction: "undo" | "redo"): Snapshot | undefined {
    const target = (direction === "undo" ? this.past : this.future).at(-1);
    if (!target) return;
    const next = copy(target);
    const live = new Map(this.present.graph.tasks.map(t => [t.id, t]));
    next.graph.tasks = next.graph.tasks.map(task => {
      const current = live.get(task.id);
      if (!current) return task;
      const { orcaWorkspace, orcaCreation, ...rest } = task;
      return { ...rest, ...(current.orcaWorkspace ? { orcaWorkspace: current.orcaWorkspace } : {}), ...(current.orcaCreation ? { orcaCreation: current.orcaCreation } : {}) };
    });
    return next;
  }
  commit(direction: "undo" | "redo", next: Snapshot): void {
    const source = direction === "undo" ? this.past : this.future;
    const destination = direction === "undo" ? this.future : this.past;
    source.pop(); destination.push(copy(this.present)); this.present = copy(next); this.revision++;
  }
  // Creating a task at a pointer location belongs to the creation operation.
  initialPosition(id: string, mode: "tree" | "mindmap", position: { x: number; y: number }) {
    this.present.positions[mode][id] = copy(position);
  }
}

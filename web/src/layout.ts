import { computeTaskStates } from "../../src/task-state";
import dagre from "dagre";
import type { Edge, NodeState, Task } from "./types";

const NODE_WIDTH = 280;
const NODE_HEIGHT = 100;

// Gap between connected components when packed side-by-side. 120px is ~3x the
// intra-component nodesep (40px) so the break clearly reads as "separate
// subgraph" rather than "wide edge".
const COMPONENT_GAP = 120;

export type LayoutMode = "tree" | "mindmap";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  task: Task;
  state: NodeState;
}

interface ComponentLayout {
  nodes: LaidOutNode[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // Smallest (lexicographic) task id in this component — used as a stable
  // secondary sort key so that components of equal size keep their relative
  // order when tasks are added or removed.
  sortKey: string;
}

/**
 * Dagre layout per connected component. In `mindmap` mode (default) ranks
 * flow left-to-right and components stack vertically; in `tree` mode ranks
 * flow top-to-bottom and components pack horizontally. Component order is
 * stable (size desc, then lex-smallest task id) so mutations inside one
 * component don't shuffle the others. See issue #20.
 */
export function layoutGraph(
  tasks: Task[],
  edges: Edge[],
  mode: LayoutMode = "mindmap",
): LaidOutNode[] {
  if (tasks.length === 0) return [];

  const states = computeTaskStates(tasks, edges);
  const components = findComponents(tasks, edges);

  const laidOut: ComponentLayout[] = components.map((componentTasks) =>
    layoutComponent(componentTasks, edges, states, mode),
  );

  // Stable order: larger components first, ties broken by lex-smallest id.
  laidOut.sort((a, b) => {
    if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length;
    return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
  });

  const result: LaidOutNode[] = [];
  if (mode === "tree") {
    // Pack components left-to-right under the vertical tree.
    let cursorX = 0;
    for (const comp of laidOut) {
      const shift = cursorX - comp.minX;
      for (const node of comp.nodes) result.push({ ...node, x: node.x + shift });
      cursorX += comp.maxX - comp.minX + COMPONENT_GAP;
    }
  } else {
    // Pack components top-to-bottom alongside the horizontal mindmap.
    let cursorY = 0;
    for (const comp of laidOut) {
      const shift = cursorY - comp.minY;
      for (const node of comp.nodes) result.push({ ...node, y: node.y + shift });
      cursorY += comp.maxY - comp.minY + COMPONENT_GAP;
    }
  }

  // Preserve the input task order in the returned array so downstream
  // consumers (e.g. App.tsx's reconciliation) can index by task.id without
  // caring about layout ordering.
  const byId = new Map(result.map((n) => [n.id, n]));
  return tasks.map((t) => {
    const n = byId.get(t.id);
    // Every task belongs to exactly one component, so this is always defined.
    if (!n) throw new Error(`layoutGraph: task ${t.id} missing from layout`);
    return n;
  });
}

/**
 * Undirected connected components over (tasks, edges). Returns each component
 * as an array of tasks in input order.
 */
function findComponents(tasks: Task[], edges: Edge[]): Task[][] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, []);
  for (const e of edges) {
    if (!taskIds.has(e.from) || !taskIds.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  const visited = new Set<string>();
  const components: Task[][] = [];
  for (const t of tasks) {
    if (visited.has(t.id)) continue;
    const bucket = new Set<string>();
    const stack = [t.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      bucket.add(id);
      for (const nb of adj.get(id) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    // Preserve input task order inside each component for determinism.
    components.push(tasks.filter((task) => bucket.has(task.id)));
  }
  return components;
}

/**
 * Dagre layout for a single component. Returns nodes in component-local
 * coordinates plus the component's bounding-box bounds so the caller can
 * pack multiple components side-by-side.
 */
function layoutComponent(
  componentTasks: Task[],
  allEdges: Edge[],
  states: Map<string, NodeState>,
  mode: LayoutMode,
): ComponentLayout {
  const memberIds = new Set(componentTasks.map((t) => t.id));

  const g = new dagre.graphlib.Graph();
  // In LR mode keep nodes (still horizontal cards) further apart along the
  // edge axis since the wide cards eat into the rank gap visually.
  const rankdir = mode === "mindmap" ? "LR" : "TB";
  const ranksep = mode === "mindmap" ? 120 : 70;
  g.setGraph({ rankdir, nodesep: 60, ranksep, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of componentTasks) {
    g.setNode(t.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of allEdges) {
    if (memberIds.has(e.from) && memberIds.has(e.to)) {
      g.setEdge(e.from, e.to);
    }
  }

  dagre.layout(g);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sortKey: string | null = null;

  const nodes = componentTasks.map<LaidOutNode>((t) => {
    const n = g.node(t.id);
    const x = n.x - NODE_WIDTH / 2;
    const y = n.y - NODE_HEIGHT / 2;
    if (x < minX) minX = x;
    if (x + NODE_WIDTH > maxX) maxX = x + NODE_WIDTH;
    if (y < minY) minY = y;
    if (y + NODE_HEIGHT > maxY) maxY = y + NODE_HEIGHT;
    if (sortKey === null || t.id < sortKey) sortKey = t.id;
    return {
      id: t.id,
      x,
      y,
      task: t,
      state: states.get(t.id) ?? "blocked",
    };
  });

  // componentTasks is non-empty (findComponents only emits non-empty buckets),
  // so sortKey is always assigned.
  if (sortKey === null) throw new Error("layoutComponent: empty component");

  return { nodes, minX, maxX, minY, maxY, sortKey };
}

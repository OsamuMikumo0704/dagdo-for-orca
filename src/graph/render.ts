import pc from "picocolors";
import type { AdjacencyGraph, GraphLayout, LayoutNode, LayoutEdge, TaskId } from "../types";
import { computeTaskStates, STATE_LABELS } from "../task-state";
import { topologicalSort } from "./topo";
import { effectiveInDegree } from "./dag";

/**
 * Compute the graph layout — pure data, no rendering.
 * This separation allows future renderers (e.g. image/SVG) to reuse the same layout.
 */
export function computeLayout(graph: AdjacencyGraph): GraphLayout {
  const { levels } = topologicalSort(graph);

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const levelGroups = new Map<number, TaskId[]>();

  for (const [id, task] of graph.tasks) {
    const level = levels.get(id) ?? 0;
    const blocked = effectiveInDegree(graph, id);
    const blocking = graph.outEdges.get(id)?.size ?? 0;
    nodes.push({ task, level, blocked, blocking });

    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(id);
  }

  for (const [id] of graph.tasks) {
    for (const to of graph.outEdges.get(id) ?? []) {
      edges.push({ from: id, to });
    }
  }

  return { nodes, edges, levels: levelGroups };
}

/**
 * Render the DAG as ASCII tree(s) in the terminal.
 */
export function renderAscii(graph: AdjacencyGraph): string {
  if (graph.tasks.size === 0) return pc.dim("Empty graph.");

  const layout = computeLayout(graph);
  const lines: string[] = [];
  const rendered = new Set<TaskId>();

  // Find roots (level 0 / no in-edges)
  const roots = layout.nodes
    .filter((n) => n.blocked === 0)
    .sort((a, b) => {
      return a.task.createdAt.localeCompare(b.task.createdAt);
    });

  const states = computeTaskStates([...graph.tasks.values()], [...graph.outEdges].flatMap(([from, tos]) => [...tos].map(to => ({ from, to }))));

  function formatNode(id: TaskId): string {
    const task = graph.tasks.get(id)!;
    const done = task.doneAt != null;
    if (done) {
      return pc.dim(`${id} ${pc.strikethrough(task.title)} done`);
    }
    const state = STATE_LABELS[states.get(id)!];
    return `${pc.cyan(id)} ${task.title} ${state}`;
  }

  function renderTree(id: TaskId, prefix: string, isLast: boolean, isRoot: boolean): void {
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const nodePrefix = isRoot ? "" : prefix + connector;

    if (rendered.has(id)) {
      lines.push(`${nodePrefix}${pc.dim(`→ ${id} (see above)`)}`);
      return;
    }

    rendered.add(id);
    lines.push(`${nodePrefix}${formatNode(id)}`);

    const children = [...(graph.outEdges.get(id) ?? [])];
    const childPrefix = isRoot ? prefix : prefix + (isLast ? "    " : "│   ");

    for (let i = 0; i < children.length; i++) {
      renderTree(children[i]!, childPrefix, i === children.length - 1, false);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    if (i > 0) lines.push("");
    renderTree(roots[i]!.task.id, "", true, true);
  }

  // Render any orphan nodes not reached from roots (shouldn't happen in a DAG, but safety)
  for (const [id] of graph.tasks) {
    if (!rendered.has(id)) {
      lines.push("");
      renderTree(id, "", true, true);
    }
  }

  return lines.join("\n");
}

/**
 * Render the DAG as a Mermaid flowchart definition.
 */
export function renderMermaid(graph: AdjacencyGraph): string {
  if (graph.tasks.size === 0) return "graph TD\n    empty[No tasks]";

  // Light palette for exported diagrams.
  const theme = `%%{init: {'theme': 'base', 'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryTextColor': '#1a1a1e',
    'primaryBorderColor': '#e6e6e6',
    'lineColor': '#62666d',
    'secondaryColor': '#f7f8f8',
    'tertiaryColor': '#f3f4f5',
    'background': '#f7f8f8',
    'mainBkg': '#ffffff',
    'nodeBorder': '#e6e6e6',
    'clusterBkg': '#f7f8f8',
    'clusterBorder': '#e6e6e6',
    'titleColor': '#1a1a1e',
    'edgeLabelBackground': '#f7f8f8',
    'nodeTextColor': '#1a1a1e',
    'fontFamily': 'system-ui, -apple-system, sans-serif'
  }}}%%`;

  const lines: string[] = [theme, "graph TD"];

  const doneIds: string[] = [];
  const activeIds: string[] = [];
  const readyIds: string[] = [];

  for (const [id, task] of graph.tasks) {
    const done = task.doneAt != null;
    if (done) {
      doneIds.push(id);
      lines.push(`    ${id}("${task.title} ✓")`);
    } else {
      lines.push(`    ${id}("${task.title}")`);
      // "Ready" means no unfinished predecessors — done blockers don't count.
      const isReady = effectiveInDegree(graph, id) === 0;
      if (isReady) {
        readyIds.push(id);
      } else {
        activeIds.push(id);
      }
    }
  }

  for (const [id] of graph.tasks) {
    const done = graph.tasks.get(id)!.doneAt != null;
    for (const to of graph.outEdges.get(id) ?? []) {
      if (done) {
        lines.push(`    ${id} -.-> ${to}`);
      } else {
        lines.push(`    ${id} --> ${to}`);
      }
    }
  }

  // Done: muted panel + subtle text
  for (const id of doneIds) {
    lines.push(`    style ${id} fill:#f3f4f5,color:#8a8f98,stroke:#d0d6e0`);
  }
  // Actionable tasks use their progress color.
  for (const id of readyIds) {
    lines.push(`    style ${id} fill:${{ backlog: "#a1a1aa", ready: "#fbbf24", in_progress: "#22c55e" }[graph.tasks.get(id)!.progress]},color:#ffffff,stroke:#666666`);
  }
  // Blocked: white card with subtle border
  for (const id of activeIds) {
    lines.push(`    style ${id} fill:#ffffff,color:#1a1a1e,stroke:#e6e6e6`);
  }

  return lines.join("\n");
}

/**
 * Render the DAG as Graphviz DOT format (used internally for PNG generation).
 */
export function renderDot(graph: AdjacencyGraph): string {
  if (graph.tasks.size === 0) return 'digraph G {\n  label="No tasks"\n}';

  const lines: string[] = [
    "digraph G {",
    '  rankdir=TB',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=12, margin="0.3,0.15"]',
    '  edge [color="#666666"]',
  ];

  for (const [id, task] of graph.tasks) {
    const done = task.doneAt != null;
    if (done) {
      const label = `${task.title}\\n(done)`;
      lines.push(`  "${id}" [label="${label}", fillcolor="#dddddd", fontcolor="#999999", style="rounded,filled,dashed"]`);
    } else {
      const label = `${task.title}`;
      const state = effectiveInDegree(graph, id) > 0 ? "blocked" : task.progress;
      const color = { blocked: "#f3f4f5", backlog: "#a1a1aa", ready: "#fbbf24", in_progress: "#22c55e" }[state];
      lines.push(`  "${id}" [label="${label}\\n${STATE_LABELS[state]}", fillcolor="${color}"]`);
    }
  }

  for (const [id] of graph.tasks) {
    const done = graph.tasks.get(id)!.doneAt != null;
    for (const to of graph.outEdges.get(id) ?? []) {
      if (done) {
        lines.push(`  "${id}" -> "${to}" [color="#cccccc", style=dashed]`);
      } else {
        lines.push(`  "${id}" -> "${to}"`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

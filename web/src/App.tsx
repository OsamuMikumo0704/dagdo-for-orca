import { setApiProject } from "./api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  SelectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toaster, toast } from "sonner";
import { Sun, Moon, Plus, Network, Workflow, Map as MapIcon, Minimize2, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/components/theme-provider";
import { computeTaskStates } from "../../src/task-state";
import { layoutGraph, type LayoutMode } from "./layout";
import {
  ApiError,
  shutdownServer,
  createEdge,
  createTask,
  deleteTask,
  mapAction,
  type HistoryState,
  isConnectionError,
  isServerReachable,
  openWorkspace,
  updateTask,
  type TaskPatch,
} from "./api";
import { TaskNode, type TaskNodeData } from "./TaskNode";
import { DraftNode, type DraftNodeData } from "./DraftNode";
import { TaskPanel } from "./TaskPanel";
import { BACKLOG_DRAG_TYPE, FocusPanel } from "./FocusPanel";
import { ProjectPicker, type ProjectInfo } from "./ProjectPicker";
import { ServerDownDialog } from "./ServerDownDialog";

import type { GraphData } from "./types";

const EMPTY: GraphData = { version: 1, tasks: [], edges: [] };

type Status = "loading" | "connected" | "disconnected";

const NODE_TYPES: NodeTypes = { task: TaskNode, draft: DraftNode };

function hasCreateModifier(event: { altKey: boolean }): boolean {
  return event.altKey;
}

const PAN_BUTTONS_DEFAULT: number[] = [1, 2];
const PAN_BUTTONS_SPACE: number[] = [0, 1, 2];

const NODE_WIDTH = 280;
const NODE_HEIGHT = 100;
const LAYOUT_MODE_STORAGE_KEY = "dagdo-layout-mode";
const DRAFT_NODE_ID_PREFIX = "__dagdo_draft_";
const draftNodeId = (seq: number): string => `${DRAFT_NODE_ID_PREFIX}${seq}`;
const isDraftId = (id: string): boolean => id.startsWith(DRAFT_NODE_ID_PREFIX);

type Draft = { id: number; position: { x: number; y: number } };
type Ghost = { clientX: number; clientY: number };

function ProjectCanvas({ projectId, picker, onProjects }: {projectId:string; picker:React.ReactNode; onProjects:()=>void}) {
  const { resolved, setTheme } = useTheme();
  const [history, setHistory] = useState<HistoryState | null>(null);
  const historyRef = useRef<HistoryState | null>(null);
  const initialFitRef = useRef<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const applyHistory = useCallback((state: HistoryState) => {
    if (historyRef.current && state.revision < historyRef.current.revision) return;
    initialFitRef.current ??= state.graph.tasks.some(t => t.progress !== "backlog");
    historyRef.current = state; setHistory(state); setGraph(state.graph);
  }, []);
  const runMapAction = useCallback(async (path: string, method: string, body: Record<string, unknown> = {}) => {
    if (busyRef.current || !historyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { applyHistory(await mapAction(projectId, path, method, { ...body, revision: historyRef.current.revision })); }
    catch (err) {
      toast.error(formatError("Map action failed", err));
      try { applyHistory(await mapAction(projectId, "history", "GET")); } catch { /* reconnect will refresh */ }
    } finally { busyRef.current = false; setBusy(false); }
  }, [projectId, applyHistory]);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingMutations = useRef(0);
  const mutate = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    pendingMutations.current++; busyRef.current = true; setBusy(true);
    const result = mutationQueue.current.catch(() => {}).then(operation);
    mutationQueue.current = result;
    return result.finally(() => {
      pendingMutations.current--;
      if (!pendingMutations.current) { busyRef.current = false; setBusy(false); }
    });
  }, []);
  const [graph, setGraph] = useState<GraphData>(EMPTY);
  const [status, setStatus] = useState<Status>("loading");
  const [serverDown, setServerDown] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [shutdownState, setShutdownState] = useState<"idle" | "pending" | "done">("idle");
  const shutdownRef = useRef(false);
  const shutdownDoneRef = useRef(false);
  const eventsRef = useRef<EventSource | null>(null);
  const [nodes, setNodes] = useState<FlowNode<TaskNodeData>[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [workspaceCreateId, setWorkspaceCreateId] = useState<string | null>(null);
  const [minimapExpanded, setMinimapExpanded] = useState(true);
  const taskStates = useMemo(() => computeTaskStates(graph.tasks, graph.edges), [graph]);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(() => {
    if (typeof window === "undefined") return "mindmap";
    const stored = localStorage.getItem(LAYOUT_MODE_STORAGE_KEY);
    // Preserve an explicit "tree" choice; everything else (unset, garbage,
    // "mindmap") falls through to the new default.
    return stored === "tree" ? "tree" : "mindmap";
  });



  const dragMovedRef = useRef(false);
  const flowRef = useRef<ReactFlowInstance<FlowNode<TaskNodeData | DraftNodeData>, FlowEdge> | null>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftSeq = useRef(0);

  // ─── data layer ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    historyRef.current = null;
    setHistory(null);

    fetch(`/api/projects/${projectId}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: HistoryState) => {
        if (!cancelled) applyHistory(data);
      })
      .catch((err) => {
        if (!cancelled) toast.error(formatError("Failed to load graph", err));
      });

    const es = new EventSource(`/api/projects/${projectId}/events`);
    eventsRef.current = es;
    es.addEventListener("projects", onProjects);
    es.addEventListener("project_deleted", onProjects);
    es.addEventListener("shutdown", () => {
      shutdownRef.current = true;
      shutdownDoneRef.current = true;
      es.close();
      setShutdownState("done");
    });
    es.addEventListener("open", () => setStatus("connected"));
    es.addEventListener("history", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as HistoryState;
        if (!cancelled) applyHistory(payload);
      } catch {
        // malformed — next update will correct
      }
    });
    es.addEventListener("error", () => {
      setStatus("disconnected");
      // An SSE error alone is not proof of an outage; confirm before blocking the UI.
      if (shutdownRef.current) return;
      void isServerReachable().then((reachable) => {
        if (!reachable && !cancelled && !shutdownRef.current) setServerDown(true);
      });
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [connectionEpoch]);

  useEffect(() => {
    if (!serverDown) return;
    eventsRef.current?.close();
    let cancelled = false;
    const timer = setInterval(() => {
      void isServerReachable().then((reachable) => {
        if (!reachable || cancelled) return;
        cancelled = true;
        setServerDown(false);
        setConnectionEpoch((epoch) => epoch + 1);
        onProjects();
      });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serverDown, onProjects]);

  const visibleTasks = useMemo(() => graph.tasks.filter(t => t.progress !== "backlog"), [graph.tasks]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleTasks.map(t => t.id));
    return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  }, [graph.edges, visibleTasks]);
  const backlogTasks = useMemo(() => graph.tasks.filter(t => t.progress === "backlog").sort((a,b) => a.createdAt.localeCompare(b.createdAt)), [graph.tasks]);
  // ─── mutation handlers ───────────────────────────────────────────────

  const handlePatch = useCallback((id: string, patch: TaskPatch) => {
    mutate(() => updateTask(id, patch, projectId)).catch((err: unknown) => {
      toast.error(formatError("Update failed", err));
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    mutate(() => deleteTask(id, projectId)).catch((err: unknown) => {
      toast.error(formatError("Delete failed", err));
    });
    setDetailId((sel) => (sel === id ? null : sel));
  }, []);

  const handleClosePanel = useCallback(() => {
    setDetailId(null);
  }, []);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    // Each orientation has its own shared manual positions.
    setLayoutModeState(mode);
    if (typeof window !== "undefined") localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode);
    // Refit after the new layout has been applied to nodes.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => flowRef.current?.fitView({ duration: 300, padding: 0.15 }));
    });
  }, []);

  // ─── hide-completed filter (applied on top of tab filter) ────────────
  const displayedTasks = useMemo(
    () => (hideCompleted ? visibleTasks.filter((t) => t.doneAt == null) : visibleTasks),
    [hideCompleted, visibleTasks],
  );

  const displayedEdges = useMemo(() => {
    if (!hideCompleted) return visibleEdges;
    const shownIds = new Set(displayedTasks.map((t) => t.id));
    return visibleEdges.filter((e) => shownIds.has(e.from) && shownIds.has(e.to));
  }, [hideCompleted, displayedTasks, visibleEdges]);

  const selectedTask = graph.tasks.find((task) => task.id === detailId);

  // ─── reconcile Flow state whenever server state or active tab changes ─
  useEffect(() => {
    const autoLayout = layoutGraph(displayedTasks, displayedEdges, layoutMode);
    const autoById = new Map(autoLayout.map((n) => [n.id, n]));

    setNodes((current) => {


      return displayedTasks.map<FlowNode<TaskNodeData>>((task) => {
        const auto = autoById.get(task.id);
        const autoPos = auto ? { x: auto.x, y: auto.y } : { x: 0, y: 0 };
        const preserved = history?.positions[layoutMode][task.id];
        return {
          id: task.id,
          type: "task",
          position: preserved ?? autoPos,
          selected: current.find(n => n.id === task.id)?.selected ?? false,
          data: {
            task,
            state: taskStates.get(task.id) ?? "blocked",
            layoutMode,
          },
          draggable: true,
        };
      });
    });

    if (detailId && !graph.tasks.some(t => t.id === detailId)) {
      setDetailId(null);
    }

    setEdges(
      displayedEdges.map<FlowEdge>((e) => {
        const fromTask = displayedTasks.find((t) => t.id === e.from);
        const dashed = fromTask?.doneAt != null;
        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          animated: false,
          className: dashed ? "edge-done" : undefined,
        };
      }),
    );
  }, [displayedTasks, displayedEdges, layoutMode, taskStates, graph.tasks, detailId, history]);

  // ─── React Flow event handlers ───────────────────────────────────────
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns) as FlowNode<TaskNodeData>[]);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const dragStart = useRef<Record<string, { x: number; y: number }>>({});
  const onNodeDragStart = useCallback(() => {
    dragMovedRef.current = false;
    dragStart.current = Object.fromEntries(nodes.map(n => [n.id, { ...n.position }]));
  }, [nodes]);
  const onNodeDrag = useCallback(() => { dragMovedRef.current = true; }, []);
  const onNodeDragStop = useCallback(() => {
    const positions = Object.fromEntries(nodes.filter(n => {
      const before = dragStart.current[n.id];
      return before && (before.x !== n.position.x || before.y !== n.position.y);
    }).map(n => [n.id, n.position]));
    if (Object.keys(positions).length) void runMapAction("positions", "PATCH", { mode: layoutMode, positions });
  }, [nodes, layoutMode, runMapAction]);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    if (conn.source === conn.target) {
      toast.error("A task can't depend on itself.");
      return;
    }
    mutate(() => createEdge(conn.source!, conn.target!, projectId)).catch((err: unknown) => {
      toast.error(formatError("Can't add dependency", err));
    });
  }, []);

  const onBeforeDelete = useCallback(async ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
    await runMapAction("selection", "DELETE", { tasks: deletedNodes.filter(n => !isDraftId(n.id)).map(n => n.id), edges: deletedEdges.map(e => ({ from: e.source, to: e.target })) });
    return false;
  }, [runMapAction]);

  const onNodeDoubleClick = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow>["onNodeClick"]>>(
    (_event, node) => {
      if (isDraftId(node.id)) return;
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      setDetailId(node.id);
    },
    [],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (hasCreateModifier(event)) {
        const flow = flowRef.current;
        if (!flow) return;
        const flowPos = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const position = {
          x: flowPos.x - NODE_WIDTH / 2,
          y: flowPos.y - NODE_HEIGHT / 2,
        };
        draftSeq.current += 1;
        setDraft({ id: draftSeq.current, position });
        setGhost(null);
        return;
      }
      setDetailId(null);
    },
    [],
  );

  // React Flow consumes pane pointer moves while selectionOnDrag is enabled.
  // Observe them in capture phase without changing its selection behavior.
  const onCanvasPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const onPane = event.target instanceof Element && event.target.classList.contains("react-flow__pane");
      if (onPane && hasCreateModifier(event) && event.buttons === 0 && !isSpaceDown && !draft && !selectedTask && !busy && !serverDown) {
        setGhost({ clientX: event.clientX, clientY: event.clientY });
      } else {
        setGhost(null);
      }
    },
    [isSpaceDown, draft, selectedTask, busy, serverDown],
  );

  const clearGhost = useCallback(() => {
    setGhost(null);
  }, []);

  // ─── draft task handlers ─────────────────────────────────────────────
  const handleDraftCommit = useCallback(
    async (draftId: number, position: { x: number; y: number }, title: string) => {
      try {
        const task = await mutate(() => createTask({
          title,
          placement: { mode: layoutMode, ...position },
        }, projectId));
        setNodes((current) => {
          const idx = current.findIndex((n) => n.id === task.id);
          const nodeData = {
            task,
            state: "ready" as const,
            layoutMode,
          };
          if (idx >= 0) {
            const next = [...current];
            next[idx] = { ...next[idx], position, data: nodeData };
            return next;
          }
          return [
            ...current,
            {
              id: task.id,
              type: "task",
              position,
              selected: false,
              draggable: true,
              data: nodeData,
            },
          ];
        });
        toast.success(`Added "${task.title}"`);
      } catch (err) {
        toast.error(formatError("Add failed", err));
      } finally {
        setDraft((cur) => (cur && cur.id === draftId ? null : cur));
      }
    },
    [layoutMode],
  );

  const handleDraftCancel = useCallback((draftId: number) => {
    setDraft((cur) => (cur && cur.id === draftId ? null : cur));
  }, []);

  const onInit = useCallback(
    (instance: ReactFlowInstance<FlowNode<TaskNodeData | DraftNodeData>, FlowEdge>) => {
      flowRef.current = instance;
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.isComposing || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || selectedTask || draft || serverDown || status !== "connected") return;
      if (!event.ctrlKey && !event.metaKey && (event.key === "Delete" || event.key === "Backspace")) {
        const tasks = nodes.filter(n => n.selected).map(n => n.id);
        const selectedEdges = edges.filter(e => e.selected).map(e => ({ from: e.source, to: e.target }));
        if (tasks.length || selectedEdges.length) {
          event.preventDefault();
          if (!event.repeat) void runMapAction("selection", "DELETE", { tasks, edges: selectedEdges });
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const action = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
      if (!action) return;
      event.preventDefault();
      if (!event.repeat && (action === "undo" ? historyRef.current?.canUndo : historyRef.current?.canRedo)) void runMapAction("history/" + action, "POST");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runMapAction, selectedTask, draft, serverDown, status, nodes, edges]);

  // Space-held pan mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable || target.closest('[role="dialog"]')) return;
      }
      e.preventDefault();
      setGhost(null);
      setIsSpaceDown(true);
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === "Space") setIsSpaceDown(false);
      if (!e.altKey) setGhost(null);
    }
    function onBlur(): void {
      setIsSpaceDown(false);
      setGhost(null);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ─── "add task" button ───────────────────────────────────────────────
  const onAddTask = useCallback(async () => {
    const title = window.prompt("New task title:");
    if (title == null) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    try {
      const task = await mutate(() => createTask({
        title: trimmed,

      }, projectId));
      toast.success(`Added "${task.title}"`);
    } catch (err) {
      toast.error(formatError("Add failed", err));
    }
  }, []);

  const onAddBacklog = useCallback(async (title: string) => {
    await mutate(() => createTask({ title, progress: "backlog" }, projectId));
  }, [mutate, projectId]);
  const canDropBacklog = (event: React.DragEvent) => !busyRef.current && !serverDown && status === "connected" && !selectedTask && event.dataTransfer.types.includes(BACKLOG_DRAG_TYPE) && !(event.target instanceof Element && event.target.closest(".react-flow__controls, .react-flow__minimap, .react-flow__panel"));
  const onBacklogDrop = async (event: React.DragEvent) => {
    if (!canDropBacklog(event)) return;
    event.preventDefault();
    const flow = flowRef.current;
    if (!flow) return;
    let item: { projectId: string; taskId: string };
    try { item = JSON.parse(event.dataTransfer.getData(BACKLOG_DRAG_TYPE)); } catch { return; }
    if (!item || item.projectId !== projectId || !backlogTasks.some(t => t.id === item.taskId && t.doneAt == null)) return;
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    try { await mutate(() => updateTask(item.taskId, { progress: "ready", placement: { mode: layoutMode, x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 } }, projectId)); }
    catch (err) { toast.error(formatError("Move from Backlog failed", err)); }
  };

  const readyTasks = useMemo(() => graph.tasks
    .filter(t => { const state = taskStates.get(t.id); return state === "ready" || state === "in_progress"; })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [graph, taskStates]);

  const handleFocusNode = useCallback((id: string) => {
    const node = nodes.find((n) => n.id === id);
    const flow = flowRef.current;
    if (!node || !flow) return;
    setNodes(current => current.map(n => ({ ...n, selected: n.id === id })));
    flow.setCenter(node.position.x + (node.measured?.width ?? NODE_WIDTH) / 2, node.position.y + (node.measured?.height ?? NODE_HEIGHT) / 2, {
      zoom: 1.2,
      duration: 400,
    });
  }, [nodes]);

  const allNodes = useMemo<FlowNode<TaskNodeData | DraftNodeData>[]>(() => {
    if (!draft) return nodes;
    const draftId = draft.id;
    const draftNode: FlowNode<DraftNodeData> = {
      id: draftNodeId(draftId),
      type: "draft",
      position: draft.position,
      draggable: false,
      selectable: false,
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      data: {
        onCommit: (title: string) => void handleDraftCommit(draftId, draft.position, title),
        onCancel: () => handleDraftCancel(draftId),
      },
    };
    return [...nodes, draftNode];
  }, [nodes, draft, handleDraftCommit, handleDraftCancel]);


  function cycleTheme(): void { setTheme(resolved === "dark" ? "light" : "dark"); }

  async function onShutdown(): Promise<void> {
    if (shutdownRef.current || !window.confirm("Shut down dagdo? Other tabs connected to this app will also stop working.")) return;
    shutdownRef.current = true;
    setShutdownState("pending");
    try {
      await shutdownServer();
      shutdownDoneRef.current = true;
      eventsRef.current?.close();
      setShutdownState("done");
    } catch (err) {
      if (!shutdownDoneRef.current) {
        shutdownRef.current = false;
        setShutdownState("idle");
        toast.error(formatError("Shutdown failed", err));
      }
    }
  }

  if (shutdownState !== "idle") return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground" role="status">
      <p>{shutdownState === "done" ? "dagdo has shut down. Close this tab and use the start shortcut to reopen the app." : "Shutting down..."}</p>
      <Toaster position="top-center" />
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        {picker}
        <Button size="sm" onClick={onAddTask}>
          <Plus className="h-4 w-4" />
          New task
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={cycleTheme} aria-label="Toggle theme">
            {resolved === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onShutdown()}>Shut down</Button>
          <span className={`text-xs font-medium ${status === "connected" ? "text-green-500" : "text-muted-foreground"}`}>
            {status === "connected" ? "● Connected" : status === "loading" ? "○ loading" : "○ offline"}
          </span>
        </div>
      </header>

      <Toaster
        position="top-center"
        toastOptions={{
          className: "!bg-card !text-card-foreground !border-border",
        }}
      />
      <ServerDownDialog open={serverDown} />



      <div className="flex-1 min-h-0 flex">
        <FocusPanel
          backlog={backlogTasks}
          projectId={projectId}
          disabled={busy || serverDown || status !== "connected"}
          onAddBacklog={onAddBacklog}
          onWorkspace={id => { setWorkspaceCreateId(id); setDetailId(id); }}
          onOpenWorkspace={id => openWorkspace(projectId, id).catch(err => { toast.error(formatError("Could not open workspace", err)); })}
          tasks={readyTasks}
          onFocus={handleFocusNode}
          onOpenDetails={setDetailId}
        />
        <div className="flex-1 min-w-0 relative flex">
          {/* Outside ReactFlow so the controls stay reachable when the map is not rendered. */}
          <div role="group" aria-label="Map controls" className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-card/95 px-1 py-0.5 shadow-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history?.canUndo || busy || serverDown || status !== "connected"} onClick={() => void runMapAction("history/undo", "POST")}><Undo2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!history?.canRedo || busy || serverDown || status !== "connected"} onClick={() => void runMapAction("history/redo", "POST")}><Redo2 className="h-4 w-4" /></Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLayoutMode(layoutMode === "tree" ? "mindmap" : "tree")}
              aria-label="Toggle layout"
              title={layoutMode === "tree" ? "Switch to mindmap layout" : "Switch to tree layout"}
            >
              {layoutMode === "tree" ? <Network className="h-4 w-4" /> : <Workflow className="h-4 w-4" />}
            </Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <div className="flex items-center gap-1.5 pl-1 pr-2">
              <Checkbox
                id="hide-completed"
                checked={hideCompleted}
                onCheckedChange={(v) => setHideCompleted(v === true)}
              />
              <Label htmlFor="hide-completed" className="text-xs font-normal text-muted-foreground cursor-pointer">
                Hide completed tasks
              </Label>
            </div>
          </div>
            <div
              className={`flex-1 min-w-0 h-full relative${isSpaceDown ? " dagdo-canvas is-space-down" : " dagdo-canvas"}`}
              onPointerMoveCapture={onCanvasPointerMove}
              onPointerDownCapture={clearGhost}
              onPointerLeave={clearGhost}
              onDragOver={e => { if (canDropBacklog(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
              onDrop={e => void onBacklogDrop(e)}
            >
              {displayedTasks.length === 0 && !draft && <div className="absolute inset-0 z-[1] pointer-events-none flex flex-col items-center justify-center gap-3 text-muted-foreground"><p>{visibleTasks.length > 0 ? "All completed tasks are hidden." : backlogTasks.length ? "No tasks on the map. Drag a backlog task here or add a task." : "No tasks in this project."}</p><Button className="pointer-events-auto" onClick={onAddTask}>Add a task</Button></div>}
              <ReactFlow
                nodes={allNodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onInit={onInit}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onBeforeDelete={onBeforeDelete}
                onSelectionDragStart={onNodeDragStart}
                onSelectionDrag={onNodeDrag}
                onSelectionDragStop={onNodeDragStop}
                onNodeDoubleClick={onNodeDoubleClick}
                nodesDraggable={!busy && !serverDown}
                deleteKeyCode={null}
                onPaneClick={onPaneClick}
                panOnDrag={isSpaceDown ? PAN_BUTTONS_SPACE : PAN_BUTTONS_DEFAULT}
                selectionOnDrag={!isSpaceDown}
                selectionMode={SelectionMode.Partial}
                colorMode={resolved}
                fitView={initialFitRef.current ?? false}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
                {minimapExpanded && <MiniMap pannable zoomable style={{ bottom: 44 }} nodeColor={node => ({ backlog: "#a1a1aa", ready: "#fbbf24", in_progress: "#22c55e", blocked: "#a1a1aa", done: "#a1a1aa" }[taskStates.get(node.id) ?? "blocked"])} />}
                {/* Clicks pass through so Alt + click also works underneath the hint. */}
                <Panel position="top-left" className="!m-2 !pointer-events-none">
                  <p className="flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-2 py-1.5 text-xs text-muted-foreground shadow-sm">
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] leading-none font-medium text-foreground">Alt</kbd>
                    +
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] leading-none font-medium text-foreground">click</kbd>
                    the map to add a task
                  </p>
                </Panel>
                <Panel position="bottom-right">
                  <Button variant="outline" size="icon" aria-label={minimapExpanded ? "Collapse minimap" : "Expand minimap"} title={minimapExpanded ? "Collapse minimap" : "Expand minimap"} onClick={() => setMinimapExpanded(v => !v)}>{minimapExpanded ? <Minimize2 /> : <MapIcon />}</Button>
                </Panel>
              </ReactFlow>
              {ghost && !draft && (
                <div
                  className="dagdo-create-ghost"
                  style={{ left: ghost.clientX, top: ghost.clientY }}
                  aria-hidden="true"
                />
              )}
            </div>
        </div>
        {selectedTask && (
          <TaskPanel
            dependencyCount={graph.edges.filter(e => e.from === selectedTask.id || e.to === selectedTask.id).length}
            createWorkspace={workspaceCreateId === selectedTask.id}
            projectId={projectId}
            key={selectedTask.id}
            task={selectedTask}
            state={taskStates.get(selectedTask.id) ?? "blocked"}
            onChange={(patch) => handlePatch(selectedTask.id, patch)}
            onDelete={() => handleDelete(selectedTask.id)}
            onClose={() => { setWorkspaceCreateId(null); handleClosePanel(); }}
          />
        )}
      </div>
    </div>
  );
}

function formatError(prefix: string, err: unknown): string {
  if (isConnectionError(err)) return `${prefix}: could not reach the dagdo server.`;
  if (err instanceof ApiError) {
    switch (err.kind) {
      case "cycle":
        return `${prefix}: that would create a dependency cycle.`;
      case "already_exists":
        return `${prefix}: that dependency already exists.`;
      case "self_loop":
        return `${prefix}: a task can't depend on itself.`;
      case "task_not_found":
        return `${prefix}: task not found (maybe it was just deleted).`;
      case "note_too_long":
        return `${prefix}: note is too long (max 2000 characters).`;
      default:
        return `${prefix}: ${err.message}`;
    }
  }
  if (err instanceof Error) return `${prefix}: ${err.message}`;
  return `${prefix}.`;
}

export function App() {
  const [projects,setProjects] = useState<ProjectInfo[]>([]);
  const [active,setActive] = useState(() => sessionStorage.getItem("dagdo-active-project") ?? "");
  const refresh = useCallback(() => {
    fetch("/api/projects").then(r => {if(!r.ok) throw new Error("Cannot load projects"); return r.json();}).then(({projects:list}:{projects:ProjectInfo[]}) => {
      setProjects(list); setActive(id => list.some(p => p.id === id) ? id : list[0]?.id ?? "");
    }).catch(e=>toast.error(formatError("Could not load projects",e)));
  },[]);
  useEffect(refresh,[refresh]);
  useEffect(()=>{if(active) sessionStorage.setItem("dagdo-active-project",active);},[active]);
  const selected = projects.find(p=>p.id===active);
  async function manage(method:string,id?:string) {
    let body: {name:string} | undefined;
    if(method === "DELETE") {
      const p=projects.find(p=>p.id===id)!;
      if(!window.confirm('Delete project "'+p.name+'" and its '+p.taskCount+' tasks and dependencies?')) return;
    } else {
      const name=window.prompt(method==="POST"?"New project name:":"Project name:",id?selected?.name:"");
      if(!name?.trim()) return; body={name:name.trim()};
    }
    try {
      const r=await fetch("/api/projects"+(id?"/"+id:""),{method,headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
      if(!r.ok) throw new Error((await r.json()).error);
      const result=await r.json(); if(method==="POST") setActive(result.project.id);
      refresh();
    } catch(e) {toast.error(formatError("Project operation failed",e));}
  }
  if(!selected) return <div className="p-4">Loading projects…</div>;
  setApiProject(active);
  const picker=<ProjectPicker
    projects={projects}
    active={selected}
    onOpen={refresh}
    onSelect={setActive}
    onCreate={()=>void manage("POST")}
    onRename={()=>void manage("PATCH",active)}
    onDelete={()=>void manage("DELETE",active)}
  />;
  return <ProjectCanvas key={active} projectId={active} picker={picker} onProjects={refresh}/>;
}

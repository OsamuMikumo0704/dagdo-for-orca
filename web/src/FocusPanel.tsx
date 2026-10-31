import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { OrcaIcon } from "./OrcaIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROGRESS_VALUES, STATE_LABELS } from "../../src/task-state";
import { STATE_STYLE } from "./task-style";
import type { Task } from "./types";

const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const STORAGE_KEY = "dagdo-focus-width";

function useResizableWidth() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
    return 260;
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { width, onPointerDown, onPointerMove, onPointerUp, isDragging: dragging };
}


export const BACKLOG_DRAG_TYPE = "application/x-dagdo-backlog";

export function FocusPanel({ backlog, projectId, disabled, onAddBacklog, tasks, onFocus, onOpenDetails, onWorkspace, onOpenWorkspace }: {
  backlog: Task[];
  projectId: string;
  disabled: boolean;
  onAddBacklog: (title: string) => Promise<void>;
  tasks: Task[];
  onFocus: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onWorkspace: (id: string) => void;
  onOpenWorkspace: (id: string) => Promise<void>;
}) {
  const { width, onPointerDown, onPointerMove, onPointerUp } = useResizableWidth();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [addingBacklog, setAddingBacklog] = useState(false);
  const [backlogTitle, setBacklogTitle] = useState("");
  const [backlogSaving, setBacklogSaving] = useState(false);
  const [backlogError, setBacklogError] = useState("");
  const backlogSavingRef = useRef(false);
  function cancelBacklog() {
    if (backlogSavingRef.current) return;
    setAddingBacklog(false); setBacklogTitle(""); setBacklogError("");
  }
  async function submitBacklog(event: React.FormEvent) {
    event.preventDefault();
    const title = backlogTitle.trim();
    if (!title || disabled || backlogSavingRef.current) return;
    backlogSavingRef.current = true; setBacklogSaving(true); setBacklogError("");
    try {
      await onAddBacklog(title);
      setAddingBacklog(false); setBacklogTitle("");
    } catch {
      setBacklogError("Could not add the backlog task. Please try again.");
    } finally { backlogSavingRef.current = false; setBacklogSaving(false); }
  }
  async function openWorkspace(id: string) {
    setOpeningId(id);
    try { await onOpenWorkspace(id); } finally { setOpeningId(null); }
  }
  return (
    <aside aria-label="Actionable tasks" className="@container relative shrink-0 min-h-0 border-r border-border bg-background flex flex-col" style={{ width }}>
      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 && <p className="text-xs text-muted-foreground p-2">There's no actionable tasks now. Please check your graph.</p>}
        {PROGRESS_VALUES.filter(p => p !== "backlog").map(progress => {
          const items = tasks.filter(t => t.progress === progress);
          if (!items.length) return null;
          return <section key={progress} aria-label={STATE_LABELS[progress]} className="mb-3">
            <h2 className="text-xs font-semibold px-2 py-1">{STATE_LABELS[progress]}</h2>
            {items.map(task => <div key={task.id} className={"border rounded-md p-2 mb-2 cursor-pointer " + STATE_STYLE[progress]} onClick={() => onFocus(task.id)} onDoubleClick={() => onOpenDetails(task.id)}>
              <div className="flex flex-col items-start gap-1 @[240px]:flex-row @[240px]:gap-2">
                <button className="min-w-0 w-full flex-1 text-left text-sm leading-snug break-words cursor-pointer" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onOpenDetails(task.id); } }}>{task.title}</button>
                {task.orcaWorkspace && <button type="button" className="flex min-w-0 max-w-full @[240px]:max-w-[50%] items-center gap-1 rounded text-xs cursor-pointer hover:underline disabled:cursor-wait disabled:opacity-60" title={`Open in Orca: ${task.orcaWorkspace.path}`} aria-label={`Open ${task.orcaWorkspace.displayName} in Orca`} disabled={openingId === task.id} onClick={e => { e.stopPropagation(); void openWorkspace(task.id); }} onDoubleClick={e => e.stopPropagation()}><OrcaIcon /><span className="truncate">{task.orcaWorkspace.displayName}</span></button>}
                {progress === "ready" && !task.orcaWorkspace && !task.orcaCreation && <Button variant="outline" size="sm" className="h-6 shrink-0 gap-1 px-1.5 [&_svg]:size-3" aria-label="Create workspace" title="Create workspace" onClick={e => { e.stopPropagation(); onWorkspace(task.id); }} onDoubleClick={e => e.stopPropagation()}><Plus aria-hidden="true" />Workspace</Button>}
              </div>
            </div>)}
          </section>;
        })}
        <section aria-label="Backlog" className="mt-3 border-t border-border pt-2">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="text-xs font-semibold">Backlog</h2>
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Add backlog task" title="Add backlog task" disabled={disabled || addingBacklog} onClick={() => { setAddingBacklog(true); setBacklogError(""); }}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {addingBacklog && <form aria-label="New backlog task" className="space-y-1.5 px-2 py-1" onSubmit={submitBacklog} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelBacklog(); } }}>
            <Input autoFocus className="h-7 px-2 text-xs" aria-label="Backlog task title" placeholder="Task title" value={backlogTitle} disabled={backlogSaving} onChange={e => setBacklogTitle(e.target.value)} />
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" className="h-6 px-1.5" disabled={disabled || backlogSaving || !backlogTitle.trim()}>{backlogSaving ? "Adding..." : "Add"}</Button>
              <Button type="button" size="sm" variant="outline" className="h-6 px-1.5" disabled={backlogSaving} onClick={cancelBacklog}>Cancel</Button>
            </div>
            {backlogError && <p role="alert" className="text-xs text-destructive">{backlogError}</p>}
          </form>}
          {!backlog.length && <p className="px-2 py-1 text-xs text-muted-foreground">No backlog tasks.</p>}
          {backlog.map(task => <button key={task.id} type="button" disabled={disabled} draggable={!disabled} onDragStart={e => { e.dataTransfer.setData(BACKLOG_DRAG_TYPE, JSON.stringify({ projectId, taskId: task.id })); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpenDetails(task.id)} className="mb-2 block w-full min-w-0 rounded-md border border-zinc-300 bg-zinc-50 p-2 text-left text-sm leading-snug text-foreground break-words shadow-sm transition-colors cursor-grab hover:border-zinc-400 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 disabled:cursor-default disabled:opacity-50">{task.title}</button>)}
          {backlog.length > 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Drag a task onto the map to move it to Ready.</p>}
        </section>
      </div>
      <div role="separator" aria-label="Resize task list" aria-orientation="vertical" aria-valuemin={140} aria-valuemax={400} aria-valuenow={width} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize touch-none hover:bg-primary/20 active:bg-primary/30" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
    </aside>
  );
}

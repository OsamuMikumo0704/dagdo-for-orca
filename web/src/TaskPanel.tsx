import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Dialog } from "radix-ui";
import { WorkspaceControls, WorkspaceCreateForm } from "./WorkspaceControls";
import { STATE_LABELS, PROGRESS_VALUES } from "../../src/task-state";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NodeState, TaskProgress, Task } from "./types";

interface TaskPanelProps {
  projectId: string;
  createWorkspace?: boolean;
  dependencyCount: number;
  task: Task;
  state: NodeState;
  onChange: (patch: {
    title?: string;
    progress?: TaskProgress;
    doneAt?: string | null;
    notes?: string | null;
    clearDependencies?: boolean;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

const NOTES_MAX_CHARS = 2000;

export function TaskPanel({ task, state, projectId, dependencyCount, createWorkspace, onChange, onDelete, onClose }: TaskPanelProps) {
  const opener = useRef(document.activeElement as HTMLElement | null);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [view, setView] = useState<"details" | "create">(createWorkspace ? "create" : "details");
  const [createBusy, setCreateBusy] = useState(false);
  const [openError, setOpenError] = useState("");

  useEffect(() => setTitleDraft(task.title), [task.title]);
  useEffect(() => setNotesDraft(task.notes ?? ""), [task.notes]);

  function close(): void {
    const title = titleDraft.trim();
    const patch: Parameters<TaskPanelProps["onChange"]>[0] = {};
    if (title && title !== task.title) patch.title = title;
    if (notesDraft !== (task.notes ?? "")) patch.notes = notesDraft || null;
    if (Object.keys(patch).length) onChange(patch);
    onClose();
  }

  function dismiss(): void {
    if (view === "details") close();
    else if (!createBusy) setView("details");
  }

  function commitTitle(): void {
    const next = titleDraft.trim();
    if (next.length === 0 || next === task.title) {
      setTitleDraft(task.title);
      return;
    }
    onChange({ title: next });
  }

  function commitNotes(): void {
    const next = notesDraft;
    const current = task.notes ?? "";
    if (next === current) return;
    onChange({ notes: next.length === 0 ? null : next });
  }

  function onTitleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setTitleDraft(task.title);
      e.currentTarget.blur();
    }
  }

  const done = task.doneAt != null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) dismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content onKeyDownCapture={e => { if (e.key === "Escape" && !e.defaultPrevented && (e.target as HTMLElement).closest('[role="dialog"]') === e.currentTarget) { e.preventDefault(); e.stopPropagation(); dismiss(); } }} aria-describedby={view === "details" ? undefined : "workspace-description"} onCloseAutoFocus={e => { e.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }} className={`fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background text-foreground shadow-xl outline-none ${view === "details" ? "overflow-y-auto p-5" : "flex flex-col overflow-hidden"}`} onClick={stop} onMouseDown={stop} onPointerDown={stop}>
      {view === "details" ? <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Dialog.Title className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Task</Dialog.Title>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={close} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Title */}
      <div className="space-y-1.5 mb-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Title
        </label>
        <Input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={onTitleKeyDown}
          onBlur={commitTitle}
          aria-label="Task title"
          className="h-8 text-sm font-medium"
        />
      </div>

      <div className="space-y-1.5 mb-3">
        <label htmlFor="task-progress" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status: {STATE_LABELS[state]}</label>
        <select id="task-progress" aria-label="Task progress" disabled={done || !!task.orcaCreation} value={task.progress} onChange={e => {
          const progress = e.target.value as TaskProgress;
          if (progress === "backlog" && dependencyCount > 0 && !window.confirm("Move this task to Backlog and remove all its dependencies?")) return;
          onChange({ progress, ...(progress === "backlog" && dependencyCount > 0 ? { clearDependencies: true } : {}) });
        }} className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-50">
          {PROGRESS_VALUES.map(p => <option key={p} value={p} disabled={state === "blocked" && p !== "backlog"}>{STATE_LABELS[p]}</option>)}
        </select>
        {state === "blocked" && <p className="text-xs text-muted-foreground">Waiting for prerequisite tasks to finish.</p>}
      </div>
      {state === "backlog" && <p className="text-xs text-muted-foreground mb-3">Move this task out of Backlog before completing it or adding dependencies.</p>}
      {/* Notes */}
      <div className="space-y-1.5 mb-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notes
        </label>
        <Textarea
          placeholder="Plain text — acceptance criteria, a link, why this task exists…"
          value={notesDraft}
          maxLength={NOTES_MAX_CHARS}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          aria-label="Task notes"
          className="text-xs max-h-[18em]"
        />
      </div>

      <WorkspaceControls task={task} state={state} projectId={projectId} notice={openError} onCreate={() => setView("create")} />
      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground" title={task.id}>
          Created on {formatDate(task.createdAt)}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDelete}>
            Delete
          </Button>
          <Button
            size="sm"
            variant={done ? "secondary" : "default"}
            disabled={state === "blocked" || state === "backlog"}
            onClick={() => onChange({ doneAt: done ? null : new Date().toISOString() })}
          >
            {done ? "Undo" : "Done"}
          </Button>
        </div>
      </div>
      </> : <WorkspaceCreateForm task={task} title={titleDraft.trim() || task.title} projectId={projectId} onBack={dismiss} onClose={close} onBusyChange={setCreateBusy} onCreated={message => {
        if (!message) return close();
        setOpenError(message); setView("details");
      }} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

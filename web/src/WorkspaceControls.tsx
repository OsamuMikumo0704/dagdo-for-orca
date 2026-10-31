import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isConnectionError } from "./api";
import type { Task, NodeState } from "./types";

const ORCA_DOWN_CODES = ["orca_unavailable", "runtime_not_running"];
const SEARCH_THRESHOLD = 5;
const SETUP_OPTIONS = [["inherit", "Inherit from repository"], ["run", "Run hooks"], ["skip", "Skip hooks"]] as const;
const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:[color-scheme:dark]";
async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}`), { code: data.error });
  return data;
}
type Project = { id: string; repoId: string; displayName: string; path: string; baseRef: string };
function useWorkspaceAction() {
  const [error, setError] = useState(""); const [orcaDown, setOrcaDown] = useState(false); const [busy, setBusy] = useState(false);
  // The server-down dialog covers connection errors, so they are not shown here.
  const showError = (e: unknown) => {
    if (isConnectionError(e)) return;
    setError(e instanceof Error ? e.message : String(e)); setOrcaDown(ORCA_DOWN_CODES.includes((e as { code?: string }).code ?? ""));
  };
  const clearError = () => { setError(""); setOrcaDown(false); };
  async function run(action: () => Promise<void>) {
    setBusy(true); clearError(); try { await action(); } catch (e) { showError(e); } finally { setBusy(false); }
  }
  return { error, orcaDown, busy, showError, clearError, run };
}
export function WorkspaceControls({ task, state, projectId, notice, onCreate }: { task: Task; state: NodeState; projectId: string; notice?: string; onCreate: () => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/tasks/${task.id}/workspace`;
  const [status, setStatus] = useState<any>(null);
  const { error, orcaDown, busy, showError, clearError, run } = useWorkspaceAction();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { setStatus(await request(base)); } finally { setRefreshing(false); }
  };
  useEffect(() => { setStatus(null); clearError(); void refresh().catch(showError); }, [base, task.orcaWorkspace, task.orcaCreation]);
  const current = status?.task || task;
  const workspace = status?.worktree || current.orcaWorkspace;
  return <section className="space-y-2 my-3 border-t border-border pt-3" aria-label="Orca workspace">
    <div className="flex items-center gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Orca workspace</h3>
      {(current.orcaWorkspace || current.orcaCreation) && <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label="Refresh workspace" title="Refresh workspace" aria-busy={refreshing} disabled={busy || refreshing} onClick={() => run(refresh)}>
        <RefreshCw aria-hidden="true" className={refreshing ? "motion-safe:animate-spin" : undefined} />
      </Button>}
    </div>
    {!current.orcaWorkspace && !current.orcaCreation && state === "ready" && <Button size="sm" disabled={busy} onClick={onCreate}>Create workspace</Button>}
    {current.orcaWorkspace && <>
      <div className="text-sm break-words">{workspace?.displayName}</div>
      <div className="text-xs text-muted-foreground break-all">{current.orcaWorkspace.projectId}<br />{workspace?.branch}<br />{workspace?.path}</div>
      {status && status.status !== "available" && <p className="text-sm">Workspace: {status.status}</p>}
      {status?.message && <p role="alert" className="text-sm text-destructive">{status.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || status?.status !== "available"} onClick={() => run(async () => { await request(base + "/open", {}); })}>Open in Orca</Button>
        {status?.status === "unavailable" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { await request("/api/orca/start", {}); await refresh(); })}>Start Orca</Button>}
        {["missing", "archived"].includes(status?.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          if (confirm("Unlink this workspace and return the task to Ready? This also reopens a completed task.")) void run(async () => { await request(base, undefined, "DELETE"); await refresh(); });
        }}>Unlink and return to Ready</Button>}
      </div>
    </>}
    {current.orcaCreation && <div className="space-y-2 text-sm">
      <p>Workspace creation is pending. Check for an existing workspace before retrying.</p>
      <Button size="sm" disabled={busy} onClick={() => run(async () => { await request(base + "/reconcile", {}); await refresh(); })}>Check creation</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
        const workspace = prompt("Existing Orca workspace selector (identity:<key> or id:<full ID>)");
        if (workspace) void run(async () => { await request(base + "/reconcile", { workspace }); await refresh(); });
      }}>Link existing workspace</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
        if (confirm("Only reset after confirming the original operation has stopped and no workspace was created. Resetting an unknown operation can create duplicates.")) void run(async () => { await request(base + "/reconcile", { reset: true }); await refresh(); });
      }}>Reset failed creation</Button>
    </div>}
    {notice && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">Workspace created, but it could not be opened: {notice}</p>}
    {error && <div role="alert" className="text-sm text-destructive space-y-2"><p>{error}</p>{orcaDown && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await request("/api/orca/start", {}); await refresh(); })}>Start Orca</Button>}</div>}
  </section>;
}
export function WorkspaceCreateForm({ task, title, projectId, onBack, onClose, onBusyChange, onCreated }: { task: Task; title: string; projectId: string; onBack: () => void; onClose: () => void; onBusyChange: (busy: boolean) => void; onCreated: (openError: string) => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/tasks/${task.id}/workspace`;
  const { error, orcaDown, busy, showError, run } = useWorkspaceAction();
  const [loadingProjects, setLoadingProjects] = useState(true); const [loadFailed, setLoadFailed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]); const [query, setQuery] = useState("");
  const [setupId, setSetupId] = useState(""); const [name, setName] = useState(title);
  const [baseBranch, setBaseBranch] = useState(""); const [branch, setBranch] = useState(""); const [setup, setSetup] = useState("inherit");
  const [refs, setRefs] = useState<string[]>([]);
  const nameInput = useRef<HTMLInputElement>(null); const projectSelect = useRef<HTMLSelectElement>(null);
  const selected = projects.find(p => p.id === setupId);
  const search = query.trim().toLowerCase();
  const visibleProjects = projects.filter(p => p.id === setupId || p.displayName.toLowerCase().includes(search) || p.path.toLowerCase().includes(search));
  useEffect(() => {
    let cancelled = false;
    if (selected) {
      const timer = setTimeout(() => { void request(`/api/orca/refs?repo=${encodeURIComponent(selected.repoId)}&q=${encodeURIComponent(baseBranch)}`).then(data => {
        if (!cancelled) setRefs((data.refs || []).map((r: any) => typeof r === "string" ? r : r.ref || r.name).filter(Boolean));
      }).catch(() => { if (!cancelled) setRefs([]); }); }, 250);
      return () => { cancelled = true; clearTimeout(timer); };
    }
  }, [selected, baseBranch]);
  async function loadProjects() {
    setLoadingProjects(true); setLoadFailed(false);
    try {
      const data = await request("/api/orca/projects"); setProjects(data.projects);
      const last = localStorage.getItem(`dagdo-orca-project-${projectId}`);
      const initial = data.projects.find((p: Project) => p.id === last) || (data.projects.length === 1 ? data.projects[0] : undefined);
      setSetupId(initial?.id || ""); setBaseBranch(initial?.baseRef || "");
    } catch (e) { setLoadFailed(true); showError(e); } finally { setLoadingProjects(false); }
  }
  useEffect(() => { nameInput.current?.focus(); void loadProjects(); }, []);
  useEffect(() => { if (!loadingProjects && !loadFailed && !setupId) projectSelect.current?.focus(); }, [loadingProjects]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy]);
  return <>
    <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0 space-y-1">
        <Dialog.Title className="text-base font-semibold">Create workspace</Dialog.Title>
        <p id="workspace-description" className="text-sm text-muted-foreground break-words">For task: <span className="text-foreground">{title}</span></p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label="Close" disabled={busy} onClick={onClose}><X aria-hidden="true" /></Button>
    </div>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); void run(async () => {
      await request(base, { setupId, name, baseBranch, branch, setup }); localStorage.setItem(`dagdo-orca-project-${projectId}`, setupId);
      // The workspace exists from here on, so a failed open must not leave this form up for a duplicate retry.
      let openError = "";
      try { await request(base + "/open", {}); } catch (e) { if (!isConnectionError(e)) openError = e instanceof Error ? e.message : String(e); }
      onCreated(openError);
    }); }}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          <Label htmlFor="orca-project">Project</Label>
          {projects.length > SEARCH_THRESHOLD && <Input aria-label="Search projects" placeholder="Search projects" value={query} onChange={e => setQuery(e.target.value)} />}
          <select id="orca-project" ref={projectSelect} required value={setupId} disabled={busy || loadingProjects} className={SELECT_CLASS} onChange={e => { setSetupId(e.target.value); setBaseBranch(projects.find(p => p.id === e.target.value)?.baseRef || ""); }}>
            <option value="">{loadingProjects ? "Loading projects…" : "Choose a project"}</option>{visibleProjects.map(p => <option key={p.id} value={p.id}>{p.displayName} — {p.path}</option>)}
          </select>
          {!loadingProjects && !loadFailed && !projects.length && <p className="text-sm text-muted-foreground">No ready local Git projects. Add a project in Orca first.</p>}
          {projects.length > 0 && !visibleProjects.length && <p className="text-sm text-muted-foreground">No projects match this search.</p>}
        </div>
        <div className="space-y-2"><Label htmlFor="orca-name">Workspace name</Label><Input id="orca-name" ref={nameInput} required value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="orca-base">Branch from</Label><Input id="orca-base" list="orca-refs" value={baseBranch} onChange={e => setBaseBranch(e.target.value)} placeholder="Project default" /><datalist id="orca-refs">{refs.map(ref => <option key={ref} value={ref} />)}</datalist></div>
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />Advanced settings</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="orca-branch">Branch name (optional)</Label><Input id="orca-branch" value={branch} onChange={e => setBranch(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="orca-setup">Setup hooks</Label><select id="orca-setup" value={setup} onChange={e => setSetup(e.target.value)} className={SELECT_CLASS}>{SETUP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          </div>
        </details>
      </div>
      {error && <div role="alert" className="space-y-2 border-t border-border px-5 py-3 text-sm text-red-600 dark:text-red-400 break-words"><p>{error}</p>{orcaDown && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await request("/api/orca/start", {}); await loadProjects(); })}>Start Orca</Button>}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
        <span className="text-xs text-muted-foreground">Runs on Local Windows</span>
        <div className="flex gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" />Back to task</Button><Button type="submit" disabled={busy || loadingProjects || !setupId || !name.trim()}>{busy && setupId ? "Creating…" : "Create workspace"}</Button></div>
      </div>
    </form>
  </>;
}

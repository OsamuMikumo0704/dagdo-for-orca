import { memo } from "react";
import { OrcaIcon } from "./OrcaIcon";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { STATE_LABELS } from "../../src/task-state";
import { STATE_STYLE } from "./task-style";
import type { NodeState, Task } from "./types";
import type { LayoutMode } from "./layout";
export interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  state: NodeState;
  layoutMode: LayoutMode;
}
function TaskNodeImpl(props: NodeProps) {
  const { task, state, layoutMode } = props.data as TaskNodeData;
  return <>
    <Handle type="target" position={layoutMode === "mindmap" ? Position.Left : Position.Top} />
    <div className={cn("rounded-lg px-4 py-3 min-w-[160px] max-w-[280px] shadow-sm border cursor-pointer transition-colors", STATE_STYLE[state], props.selected && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
      <div className={cn("text-sm font-medium leading-snug break-words", state === "done" && "line-through")}>{task.title}</div>
      <div className="text-[10px] mt-1 opacity-80">{STATE_LABELS[state]}</div>
      {task.orcaWorkspace && <div className="text-xs mt-1 flex items-center gap-1" title={task.orcaWorkspace.path}><OrcaIcon /><span className="truncate">{task.orcaWorkspace.displayName}</span></div>}
    </div>
    <Handle type="source" position={layoutMode === "mindmap" ? Position.Right : Position.Bottom} />
  </>;
}
export const TaskNode = memo(TaskNodeImpl);

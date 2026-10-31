import { DropdownMenu } from "radix-ui";
import { Check, ChevronsUpDown, FolderKanban, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ProjectInfo {
  id: string;
  name: string;
  taskCount: number;
}

interface Props {
  projects: ProjectInfo[];
  active: ProjectInfo;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const ITEM_CLASS =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const taskLabel = (count: number): string => `${count} ${count === 1 ? "task" : "tasks"}`;

// Native prompt and confirm dialogs block rendering, so let the menu close first.
const afterClose = (action: () => void) => () => {
  window.setTimeout(action, 0);
};

export function ProjectPicker({ projects, active, onOpen, onSelect, onCreate, onRename, onDelete }: Props) {
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(open) => open && onOpen()}>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="sm" className="max-w-64 text-sm" aria-label={`Project: ${active.name}`} title={active.name}>
          <FolderKanban className="text-muted-foreground" />
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Projects
          </DropdownMenu.Label>
          <div className="max-h-72 overflow-y-auto">
            <DropdownMenu.RadioGroup value={active.id} onValueChange={onSelect}>
              {projects.map((project) => (
                <DropdownMenu.RadioItem
                  key={project.id}
                  value={project.id}
                  className={`${ITEM_CLASS} data-[state=checked]:font-medium`}
                  aria-label={`${project.name}, ${taskLabel(project.taskCount)}`}
                  title={project.name}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <DropdownMenu.ItemIndicator>
                      <Check />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                    {project.taskCount}
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </div>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <DropdownMenu.Item className={ITEM_CLASS} onSelect={afterClose(onCreate)}>
            <Plus />
            New project
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM_CLASS} onSelect={afterClose(onRename)}>
            <Pencil />
            Rename current project
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={`${ITEM_CLASS} text-red-600 data-[highlighted]:text-red-600 dark:text-red-400 dark:data-[highlighted]:text-red-400`}
            disabled={projects.length === 1}
            title={projects.length === 1 ? "The last project cannot be deleted" : undefined}
            onSelect={afterClose(onDelete)}
          >
            <Trash2 />
            Delete current project
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

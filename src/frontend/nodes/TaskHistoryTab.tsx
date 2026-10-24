import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button } from "@termix-ssh/plugin-sdk/ui";
import { RefreshCw } from "lucide-react";
import { pve, toCallError } from "../api";
import { CheckField, TextInput } from "../components/forms";
import { TaskLogDialog } from "../components/TasksPanel";
import { State, type NodeTabProps } from "./NodeTabs";
import {
  TASK_PAGE,
  taskParams,
  taskState,
  type NodeTask,
  type TaskFilter,
} from "./system";

const BADGE = {
  running: "outline",
  ok: "secondary",
  error: "destructive",
} as const;

/** Every task the node ran, newest first, with filters and the log of each. */
export function TaskHistoryTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TaskFilter>({
    errorsOnly: false,
    type: "",
    vmid: "",
    user: "",
  });
  const [tasks, setTasks] = useState<NodeTask[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<NodeTask | null>(null);

  const load = useCallback(
    async (start = 0) => {
      try {
        const page = await pve<NodeTask[]>(
          hostId,
          "GET",
          ["nodes", node, "tasks"],
          taskParams(filter, start),
        );
        setTasks((prev) => (start ? [...(prev ?? []), ...page] : page));
        setMore(page.length === TASK_PAGE);
        setError(null);
      } catch (err) {
        setError(toCallError(err).message);
      }
    },
    [hostId, node, filter],
  );

  // Typing in a filter waits a moment before asking the node again.
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => void load(0), 300);
    return () => clearTimeout(timer);
  }, [isVisible, load]);

  const set = (patch: Partial<TaskFilter>) =>
    setFilter((f) => ({ ...f, ...patch }));
  const when = (s?: number) =>
    s
      ? new Date(s * 1000).toLocaleString(undefined, {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_6rem_1fr_auto] items-center gap-2">
        <TextInput
          value={filter.type}
          onChange={(type) => set({ type })}
          placeholder={t("nodes.taskHistory.type")}
        />
        <TextInput
          value={filter.vmid}
          onChange={(vmid) => set({ vmid })}
          placeholder={t("nodes.taskHistory.vmid")}
        />
        <TextInput
          value={filter.user}
          onChange={(user) => set({ user })}
          placeholder={t("nodes.taskHistory.user")}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("app.refresh")}
          onClick={() => void load(0)}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <CheckField
        label={t("nodes.taskHistory.errorsOnly")}
        checked={filter.errorsOnly}
        onChange={(errorsOnly) => set({ errorsOnly })}
      />
      <State error={error} loading={!tasks && !error} />
      {tasks?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("nodes.taskHistory.none")}
        </p>
      )}
      <div className="flex flex-col">
        {tasks?.map((task) => {
          const state = taskState(task);
          return (
            <button
              key={task.upid}
              type="button"
              onClick={() => setOpen(task)}
              className="flex items-center gap-2 border-b border-border/60 py-1.5 text-left text-xs hover:bg-accent/40"
            >
              <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                {when(task.starttime)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{task.type}</span>
                {task.id ? ` ${task.id}` : ""}
                <span className="text-muted-foreground"> · {task.user}</span>
              </span>
              <Badge
                variant={BADGE[state]}
                className="max-w-[40%] shrink overflow-hidden"
                title={task.status}
              >
                <span className="truncate">
                  {state === "error"
                    ? task.status
                    : t(`nodes.taskHistory.state.${state}`)}
                </span>
              </Badge>
            </button>
          );
        })}
      </div>
      {more && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => void load(tasks?.length ?? 0)}
        >
          {t("nodes.taskHistory.more")}
        </Button>
      )}
      {open && (
        <TaskLogDialog
          hostId={hostId}
          task={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

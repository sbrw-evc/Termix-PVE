import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  cn,
} from "@termix-ssh/plugin-sdk/ui";
import { ListChecks } from "lucide-react";
import { pve, taskOk, toCallError, type PveClusterTask } from "../api";
import { useTasks } from "../tasks";

const REFRESH_MS = 15000;

function TaskLogDialog({
  hostId,
  task,
  onClose,
}: {
  hostId: number;
  task: PveClusterTask;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pve<Array<{ n: number; t: string }>>(
      hostId,
      "GET",
      ["nodes", task.node, "tasks", task.upid, "log"],
      { start: 0, limit: 1000 },
    ).then(
      (log) => {
        if (!cancelled) setLines((log ?? []).map((line) => line.t));
      },
      (err) => {
        if (!cancelled) setError(toCallError(err).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hostId, task.node, task.upid]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* sm: so it replaces the dialog's own sm:max-w-lg. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("tasks.logTitle", {
              type: task.type,
              id: task.id ?? "",
              node: task.node,
            })}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-96 border border-border bg-muted/30">
          <pre className="p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {error ?? (lines ? lines.join("\n") : t("app.loading"))}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function TasksPanel({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const { tasks: tracked } = useTasks();
  const [tasks, setTasks] = useState<PveClusterTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PveClusterTask | null>(null);

  const load = useCallback(async () => {
    try {
      const list =
        (await pve<PveClusterTask[]>(hostId, "GET", ["cluster", "tasks"])) ??
        [];
      setTasks(
        [...list].sort((a, b) => b.starttime - a.starttime).slice(0, 50),
      );
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
  }, [hostId]);

  useEffect(() => {
    if (!isVisible) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [isVisible, load]);

  // A tracked task that just ended shows its result straight away.
  const trackedKey = tracked
    .map((task) => `${task.upid}:${task.status}`)
    .join();
  useEffect(() => {
    if (isVisible && trackedKey) void load();
  }, [trackedKey, isVisible, load]);

  return (
    <div className="flex h-44 shrink-0 flex-col border-t border-border">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
        <ListChecks className="size-3.5" />
        {t("tasks.title")}
        {error && (
          <span className="ml-2 truncate font-normal text-destructive">
            {error}
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-1 font-normal">{t("tasks.started")}</th>
              <th className="px-2 py-1 font-normal">{t("tasks.node")}</th>
              <th className="px-2 py-1 font-normal">{t("tasks.user")}</th>
              <th className="px-2 py-1 font-normal">{t("tasks.task")}</th>
              <th className="px-3 py-1 font-normal">{t("tasks.status")}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const done = !!task.endtime;
              const ok = done && taskOk(task);
              return (
                <tr
                  key={task.upid}
                  onClick={() => setOpen(task)}
                  className="cursor-pointer border-t border-border/50 hover:bg-accent"
                >
                  <td className="px-3 py-1 tabular-nums whitespace-nowrap">
                    {new Date(task.starttime * 1000).toLocaleString()}
                  </td>
                  <td className="px-2 py-1">{task.node}</td>
                  <td className="px-2 py-1">{task.user}</td>
                  <td className="px-2 py-1">
                    {task.id ? `${task.type} ${task.id}` : task.type}
                  </td>
                  <td
                    className={cn(
                      "max-w-64 truncate px-3 py-1",
                      done && !ok && "text-destructive",
                    )}
                    title={task.status}
                  >
                    {!done
                      ? t("tasks.running")
                      : ok
                        ? t("tasks.ok")
                        : task.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
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

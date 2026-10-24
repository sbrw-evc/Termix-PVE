import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { isUpid, pve, taskOk, upidNode, type PveTaskStatus } from "./api";

export interface TrackedTask {
  upid: string;
  label: string;
  status: "running" | "ok" | "failed";
  exitstatus?: string;
}

interface TaskTracker {
  tasks: TrackedTask[];
  /**
   * Follows a call's result: a task id is polled until it stops, anything
   * else counts as done at once. Resolves when it ends.
   */
  track: (result: unknown, label: string) => Promise<boolean>;
}

const TaskContext = createContext<TaskTracker | null>(null);

const POLL_MS = 1500;

export function TaskProvider({
  hostId,
  onFinished,
  children,
}: {
  hostId: number;
  /** Runs after any tracked task ends, to reload what it changed. */
  onFinished: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [tasks, setTasks] = useState<TrackedTask[]>([]);
  const alive = useRef(true);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const update = (upid: string, patch: Partial<TrackedTask>) =>
    setTasks((list) =>
      list.map((task) => (task.upid === upid ? { ...task, ...patch } : task)),
    );

  const track = useCallback(
    async (result: unknown, label: string): Promise<boolean> => {
      if (!isUpid(result)) {
        toast.success(t("tasks.done", { label }));
        finished.current();
        return true;
      }
      const upid = result;
      const node = upidNode(upid)!;
      setTasks((list) => [
        { upid, label, status: "running" },
        ...list.filter((task) => task.upid !== upid).slice(0, 19),
      ]);
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return false;
        let status: PveTaskStatus;
        try {
          status = await pve<PveTaskStatus>(hostId, "GET", [
            "nodes",
            node,
            "tasks",
            upid,
            "status",
          ]);
        } catch {
          continue;
        }
        if (status.status !== "stopped") continue;
        const ok = taskOk(status);
        update(upid, {
          status: ok ? "ok" : "failed",
          exitstatus: status.exitstatus,
        });
        if (ok) toast.success(t("tasks.done", { label }));
        else
          toast.error(
            t("tasks.failed", { label, reason: status.exitstatus ?? "" }),
          );
        finished.current();
        return ok;
      }
    },
    // update and setTasks are stable; t changes only with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, t, toast],
  );

  const value = useMemo(() => ({ tasks, track }), [tasks, track]);
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks(): TaskTracker {
  const tracker = useContext(TaskContext);
  if (!tracker) throw new Error("useTasks needs a TaskProvider");
  return tracker;
}

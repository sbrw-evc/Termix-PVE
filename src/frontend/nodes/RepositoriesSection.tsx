import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button } from "@termix-ssh/plugin-sdk/ui";
import { Plus } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";
import {
  addableRepos,
  repoRows,
  type AptRepositories,
  type RepoRow,
} from "./system";

/** APT repositories of a node: turn them on and off, add Proxmox's own. */
export function RepositoriesSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<AptRepositories>(
    hostId,
    ["nodes", node, "apt", "repositories"],
    undefined,
    isVisible,
  );
  const [busy, setBusy] = useState(false);
  const rows = repoRows(data);
  const addable = addableRepos(data);

  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await call();
      toast.success(done);
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const toggle = async (row: RepoRow) => {
    if (!row.enabled) {
      const ok = await app().confirm({
        title: t("nodes.repos.enableTitle"),
        description: row.line,
        confirmLabel: t("nodes.repos.enable"),
      });
      if (!ok) return;
    }
    // The digest makes PVE refuse files someone changed since we read them.
    await run(
      () =>
        pve(hostId, "POST", ["nodes", node, "apt", "repositories"], {
          path: row.path,
          index: row.index,
          enabled: !row.enabled,
          digest: data?.digest,
        }),
      t(row.enabled ? "nodes.repos.disabled" : "nodes.repos.enabled"),
    );
  };

  const add = async (handle: string, name: string) =>
    run(
      () =>
        pve(hostId, "PUT", ["nodes", node, "apt", "repositories"], {
          handle,
          digest: data?.digest,
        }),
      t("nodes.repos.added", { name }),
    );

  return (
    <div className="flex flex-col gap-2">
      <State error={error} loading={!data && !error} />
      {data?.errors?.map((e) => (
        <p key={e.path} role="alert" className="text-xs text-destructive">
          {e.path}: {e.error}
        </p>
      ))}
      {rows.map((row) => (
        <div
          key={`${row.path}#${row.index}`}
          className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div
              className={`truncate font-mono text-[11px] ${row.enabled ? "" : "text-muted-foreground line-through"}`}
            >
              {row.line}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {[row.path, row.origin].filter(Boolean).join(" · ")}
            </div>
            {row.warnings.map((w) => (
              <div key={w} className="text-[11px] text-amber-500">
                {w}
              </div>
            ))}
          </div>
          <Badge variant={row.enabled ? "secondary" : "outline"}>
            {t(row.enabled ? "nodes.repos.on" : "nodes.repos.off")}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            disabled={busy}
            onClick={() => void toggle(row)}
          >
            {t(row.enabled ? "nodes.repos.disable" : "nodes.repos.enable")}
          </Button>
        </div>
      ))}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <span className="text-[11px] text-muted-foreground">
            {t("nodes.repos.add")}
          </span>
          {addable.map((repo) => (
            <Button
              key={repo.handle}
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy}
              title={repo.description}
              onClick={() => void add(repo.handle, repo.name)}
            >
              <Plus className="mr-1 size-3" />
              {repo.name}
            </Button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t("nodes.repos.hint")}
      </p>
    </div>
  );
}

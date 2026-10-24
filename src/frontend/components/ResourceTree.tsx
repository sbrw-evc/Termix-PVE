import { useState, type ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { cn } from "@termix-ssh/plugin-sdk/ui";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Database,
  Monitor,
  Server,
} from "lucide-react";
import type { PveResource } from "../api";
import { guestLabel, type NodeBranch } from "../tree";

export function statusColor(status: string | undefined): string {
  switch (status) {
    case "running":
    case "online":
    case "available":
      return "bg-emerald-500";
    case "paused":
    case "suspended":
      return "bg-amber-500";
    case "stopped":
      return "bg-muted-foreground/50";
    default:
      return "bg-destructive";
  }
}

function Row({
  resource,
  label,
  icon,
  depth,
  selected,
  onSelect,
  toggle,
}: {
  resource: PveResource;
  label: string;
  icon: ReactNode;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
  toggle?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(resource.id)}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-accent",
        selected && "bg-accent text-accent-foreground",
        resource.template ? "opacity-70" : "",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={resource.lock ? `${label} (${resource.lock})` : label}
    >
      {toggle ?? <span className="size-3.5 shrink-0" />}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          statusColor(resource.status),
        )}
      />
    </button>
  );
}

export function ResourceTree({
  tree,
  selectedId,
  onSelect,
}: {
  tree: NodeBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (!tree.length) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        {t("tree.nothingFound")}
      </p>
    );
  }

  const toggleNode = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="py-1" role="tree">
      {tree.map(({ node, guests, storage }) => {
        const open = !collapsed.has(node.id);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <div key={node.id} role="treeitem" aria-expanded={open}>
            <Row
              resource={node}
              label={node.node ?? node.id}
              icon={<Server className="size-3.5 shrink-0" />}
              depth={0}
              selected={selectedId === node.id}
              onSelect={onSelect}
              toggle={
                <span
                  role="button"
                  aria-label={t(open ? "tree.collapse" : "tree.expand")}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleNode(node.id);
                  }}
                >
                  <Chevron className="size-3.5 shrink-0" />
                </span>
              }
            />
            {open && (
              <>
                {guests.map((guest) => (
                  <Row
                    key={guest.id}
                    resource={guest}
                    label={guestLabel(guest)}
                    icon={
                      guest.type === "lxc" ? (
                        <Box className="size-3.5 shrink-0" />
                      ) : (
                        <Monitor className="size-3.5 shrink-0" />
                      )
                    }
                    depth={1}
                    selected={selectedId === guest.id}
                    onSelect={onSelect}
                  />
                ))}
                {storage.map((pool) => (
                  <Row
                    key={pool.id}
                    resource={pool}
                    label={pool.storage ?? pool.id}
                    icon={<Database className="size-3.5 shrink-0" />}
                    depth={1}
                    selected={selectedId === pool.id}
                    onSelect={onSelect}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

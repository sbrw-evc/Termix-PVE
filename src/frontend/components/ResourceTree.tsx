import { useState, type ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { cn } from "@termix-ssh/plugin-sdk/ui";
import {
  Box,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Monitor,
  Network,
  Server,
  type LucideIcon,
} from "lucide-react";
import type { TreeItem, TreeKind } from "../tree";

/** The tree item that opens the datacenter panels; not a /cluster/resources id. */
export const DATACENTER_ID = "datacenter";

export function statusColor(status: string | undefined): string {
  switch (status) {
    case "running":
    case "online":
    case "available":
    case "ok":
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

const ICONS: Record<TreeKind, LucideIcon> = {
  datacenter: Building2,
  folder: Folder,
  node: Server,
  qemu: Monitor,
  lxc: Box,
  storage: Database,
  pool: Boxes,
  sdn: Network,
};

function Row({
  item,
  depth,
  selected,
  open,
  onSelect,
  onToggle,
}: {
  item: TreeItem;
  depth: number;
  selected: boolean;
  open: boolean;
  onSelect: (id: string) => void;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[item.kind];
  const resource = item.resource;
  // Folders and the datacenter carry translation keys.
  const label = resource
    ? item.label
    : item.title !== undefined
      ? t("tree.datacenterOf", { name: item.title })
      : t(item.label);
  const hasChildren = !!item.children?.length;
  const Chevron = open ? ChevronDown : ChevronRight;
  let toggle: ReactNode = <span className="size-3.5 shrink-0" />;
  if (hasChildren) {
    toggle = (
      <span
        role="button"
        aria-label={t(open ? "tree.collapse" : "tree.expand")}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(item.key);
        }}
      >
        <Chevron className="size-3.5 shrink-0" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        item.selectId
          ? onSelect(item.selectId)
          : resource
            ? onSelect(resource.id)
            : item.kind === "datacenter"
              ? onSelect(DATACENTER_ID)
              : onToggle(item.key)
      }
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-accent",
        selected && "bg-accent text-accent-foreground",
        resource?.template ? "opacity-70" : "",
        !resource && "font-medium",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={resource?.lock ? `${label} (${resource.lock})` : label}
    >
      {toggle}
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {resource?.status && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            statusColor(resource.status),
          )}
        />
      )}
    </button>
  );
}

export function ResourceTree({
  tree,
  selectedId,
  onSelect,
}: {
  tree: TreeItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const empty = tree.every((i) => !i.resource && !i.children?.length);
  if (empty) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        {t("tree.nothingFound")}
      </p>
    );
  }

  const render = (items: TreeItem[], depth: number): ReactNode =>
    items.map((item) => {
      const open = !collapsed.has(item.key);
      return (
        <div
          key={item.key}
          role="treeitem"
          aria-expanded={item.children ? open : undefined}
        >
          <Row
            item={item}
            depth={depth}
            selected={
              item.selectId
                ? item.selectId === selectedId
                : item.resource
                  ? item.resource.id === selectedId
                  : item.kind === "datacenter" && selectedId === DATACENTER_ID
            }
            open={open}
            onSelect={onSelect}
            onToggle={toggle}
          />
          {open && item.children && render(item.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="py-1" role="tree">
      {render(tree, 0)}
    </div>
  );
}

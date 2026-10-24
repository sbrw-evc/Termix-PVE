import { useMemo, useState } from "react";
import { useHosts, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@termix-ssh/plugin-sdk/ui";
import { ChevronsUpDown, Folder, FolderPlus, Server } from "lucide-react";
import { existingFolders, matchFolders } from "./folders";

/**
 * Picks one of the user's Termix folders or names a new one, "/" for a
 * subfolder. Empty means the default the caller describes in `emptyLabel`.
 */
export function FolderPicker({
  value,
  onChange,
  emptyLabel,
}: {
  value: string;
  onChange: (folder: string) => void;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const folders = useMemo(() => existingFolders(hosts), [hosts]);
  const { matches, create } = matchFolders(folders, query);

  const pick = (folder: string) => {
    onChange(folder);
    setOpen(false);
    setQuery("");
  };

  const item = "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs";
  const hover = "hover:bg-accent hover:text-accent-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 border border-border bg-background px-2 text-left text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !value && "text-muted-foreground",
            )}
          >
            {value || emptyLabel}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (create) pick(create);
            else if (matches.length) pick(matches[0]);
          }}
          placeholder={t("import.folderSearch")}
          className="h-8 rounded-none border-0 border-b text-xs focus-visible:ring-0"
        />
        <div className="max-h-56 overflow-y-auto py-1">
          {!query && (
            <button
              type="button"
              className={cn(item, hover, !value && "text-primary")}
              onClick={() => pick("")}
            >
              <Server className="size-3.5 shrink-0" />
              <span className="truncate">{emptyLabel}</span>
            </button>
          )}
          {matches.map((folder) => (
            <button
              key={folder}
              type="button"
              className={cn(item, hover, folder === value && "text-primary")}
              onClick={() => pick(folder)}
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{folder}</span>
            </button>
          ))}
          {create && (
            <button
              type="button"
              className={cn(item, hover)}
              onClick={() => pick(create)}
            >
              <FolderPlus className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("import.folderCreate", { folder: create })}
              </span>
            </button>
          )}
          {!matches.length && !create && (
            <p className={cn(item, "text-muted-foreground")}>
              {t("import.folderNone")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

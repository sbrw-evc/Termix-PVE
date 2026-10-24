import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  GroupHeading,
  PanelSearch,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import { Download, LibraryBig, Trash2 } from "lucide-react";
import { app, pve, toCallError, type PveResource } from "../api";
import { formatBytes, percent } from "../format";
import { useTasks } from "../tasks";
import { Fact, Usage } from "../components/Usage";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import { volumeName, type PveStorage, type PveVolume } from "../guests/lookups";
import {
  backupInfo,
  contentFilter,
  contentTabs,
  downloadParams,
  downloadProblem,
  filenameFromUrl,
  type ContentKind,
  type DownloadForm,
} from "./params";

type Tab = "summary" | ContentKind;

interface ContentItem extends PveVolume {
  content: string;
  vmid?: number;
  ctime?: number;
  notes?: string;
  protected?: number;
}

function DownloadDialog({
  hostId,
  node,
  storage,
  kind,
  onClose,
}: {
  hostId: number;
  node: string;
  storage: string;
  kind: "iso" | "vztmpl";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [form, setForm] = useState<DownloadForm>({
    url: "",
    filename: "",
    checksum: "",
    algorithm: "",
    verify: true,
  });
  const set = (patch: Partial<DownloadForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const problem = downloadProblem(kind, form);

  return (
    <FormDialog
      title={t(`storage.download.title.${kind}`, { storage })}
      submitLabel={t("storage.download.submit")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", node, "storage", storage, "download-url"],
          downloadParams(kind, form),
        );
        void track(upid, t("storage.download.label", { name: form.filename }));
      }}
    >
      {(fieldError) => (
        <>
          <Field label={t("storage.download.url")} error={fieldError("url")}>
            <TextInput
              value={form.url}
              onChange={(url) =>
                set({
                  url,
                  filename:
                    form.filename && form.filename !== filenameFromUrl(form.url)
                      ? form.filename
                      : filenameFromUrl(url),
                })
              }
              placeholder="https://cdimage.debian.org/.../debian-13-amd64-netinst.iso"
            />
          </Field>
          <Field
            label={t("storage.download.filename")}
            error={fieldError("filename")}
          >
            <TextInput
              value={form.filename}
              onChange={(filename) => set({ filename })}
            />
          </Field>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label={t("storage.download.algorithm")}>
              <SelectInput
                value={form.algorithm}
                onChange={(v) =>
                  set({ algorithm: v as DownloadForm["algorithm"] })
                }
                placeholder={t("storage.download.noChecksum")}
                options={[
                  "md5",
                  "sha1",
                  "sha224",
                  "sha256",
                  "sha384",
                  "sha512",
                ].map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <Field
              label={t("storage.download.checksum")}
              error={fieldError("checksum")}
            >
              <TextInput
                value={form.checksum}
                onChange={(checksum) => set({ checksum })}
              />
            </Field>
          </div>
          <CheckField
            label={t("storage.download.verify")}
            checked={form.verify}
            onChange={(verify) => set({ verify })}
          />
          {problem && form.url && (
            <p className="text-[11px] text-muted-foreground">
              {t(`storage.download.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

interface Appliance {
  template: string;
  package: string;
  headline?: string;
  os?: string;
  version?: string;
  section?: string;
}

function CatalogDialog({
  hostId,
  node,
  storage,
  have,
  onClose,
}: {
  hostId: number;
  node: string;
  storage: string;
  have: Set<string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const toast = useToast();
  const [list, setList] = useState<Appliance[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pve<Appliance[]>(hostId, "GET", ["nodes", node, "aplinfo"]).then(
      (data) =>
        setList(
          (data ?? []).sort((a, b) => a.template.localeCompare(b.template)),
        ),
      (err) => setError(toCallError(err).message),
    );
  }, [hostId, node]);

  const shown = (list ?? []).filter((a) =>
    `${a.template} ${a.headline ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const download = async (template: string) => {
    try {
      const upid = await pve(hostId, "POST", ["nodes", node, "aplinfo"], {
        storage,
        template,
      });
      void track(upid, t("storage.catalog.label", { name: template }));
      onClose();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <FormDialog
      title={t("storage.catalog.title", { storage })}
      submitLabel={t("app.close")}
      wide
      hideCancel
      onClose={onClose}
      onSubmit={async () => {}}
    >
      {() => (
        <>
          <PanelSearch
            value={query}
            onChange={setQuery}
            placeholder={t("storage.catalog.search")}
            fill
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!list && !error && (
            <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
          )}
          <div className="flex flex-col">
            {shown.map((a) => (
              <div
                key={a.template}
                className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px]">
                    {a.template}
                  </div>
                  {a.headline && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {a.headline}
                    </div>
                  )}
                </div>
                {have.has(a.template) ? (
                  <Badge variant="secondary">{t("storage.catalog.have")}</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void download(a.template)}
                  >
                    <Download className="mr-1 size-3.5" />
                    {t("storage.download.submit")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </FormDialog>
  );
}

function ContentList({
  hostId,
  node,
  storage,
  kind,
  isVisible,
}: {
  hostId: number;
  node: string;
  storage: string;
  kind: ContentKind;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { tasks } = useTasks();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"download" | "catalog" | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await pve<ContentItem[]>(
        hostId,
        "GET",
        ["nodes", node, "storage", storage, "content"],
        {
          content: contentFilter(kind),
        },
      );
      setItems(
        (data ?? [])
          .filter(
            (i) =>
              kind !== "images" ||
              i.content === "images" ||
              i.content === "rootdir",
          )
          .sort(
            (a, b) =>
              (b.ctime ?? 0) - (a.ctime ?? 0) || a.volid.localeCompare(b.volid),
          ),
      );
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
  }, [hostId, node, storage, kind]);

  // Reload when a tracked task (a download, a delete) ends.
  const finished = tasks.filter((task) => task.status !== "running").length;
  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load, finished]);

  const remove = async (item: ContentItem) => {
    const ok = await app().confirm({
      title: t("storage.delete.title", { name: volumeName(item.volid) }),
      description: t("storage.delete.description"),
      confirmLabel: t("storage.delete.submit"),
    });
    if (!ok) return;
    try {
      const result = await pve(hostId, "DELETE", [
        "nodes",
        node,
        "storage",
        storage,
        "content",
        item.volid,
      ]);
      if (typeof result !== "string")
        toast.success(
          t("storage.delete.done", { name: volumeName(item.volid) }),
        );
    } catch (err) {
      toast.error(toCallError(err).message);
    }
    void load();
  };

  const downloadable = kind === "iso" || kind === "vztmpl";
  const deletable = kind !== "images";

  return (
    <div className="flex flex-col gap-2">
      {downloadable && (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog("download")}
          >
            <Download className="mr-1 size-3.5" />
            {t("storage.download.button")}
          </Button>
          {kind === "vztmpl" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog("catalog")}
            >
              <LibraryBig className="mr-1 size-3.5" />
              {t("storage.catalog.button")}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!items && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {items?.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("storage.empty")}</p>
      )}
      {items?.map((item) => {
        const backup = kind === "backup" ? backupInfo(item.volid) : null;
        return (
          <div
            key={item.volid}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div
                className="truncate font-mono text-[11px]"
                title={item.volid}
              >
                {volumeName(item.volid)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {[
                  formatBytes(item.size),
                  item.format,
                  item.vmid ? t("storage.owner", { vmid: item.vmid }) : null,
                  backup
                    ? backup.time.toLocaleString()
                    : item.ctime
                      ? new Date(item.ctime * 1000).toLocaleString()
                      : null,
                  item.notes,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {item.protected ? (
              <Badge variant="outline">{t("storage.protected")}</Badge>
            ) : null}
            {deletable && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-destructive"
                disabled={!!item.protected}
                onClick={() => void remove(item)}
                aria-label={t("storage.delete.submit")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        );
      })}
      {dialog === "download" && downloadable && (
        <DownloadDialog
          hostId={hostId}
          node={node}
          storage={storage}
          kind={kind}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "catalog" && (
        <CatalogDialog
          hostId={hostId}
          node={node}
          storage={storage}
          have={new Set((items ?? []).map((i) => volumeName(i.volid)))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export function StorageView({
  hostId,
  storage,
  isVisible,
}: {
  hostId: number;
  storage: PveResource;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<PveStorage | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const node = storage.node ?? "";
  const name = storage.storage ?? "";

  useEffect(() => {
    setTab("summary");
    pve<PveStorage[]>(hostId, "GET", ["nodes", node, "storage"]).then(
      (list) => setInfo((list ?? []).find((s) => s.storage === name) ?? null),
      () => setInfo(null),
    );
  }, [hostId, node, name]);

  const tabs = useMemo<Tab[]>(
    () => ["summary", ...contentTabs(info?.content ?? "")],
    [info],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        <Badge variant="outline">{t("types.storage")}</Badge>
        {info?.type && <Badge variant="outline">{info.type}</Badge>}
        {storage.status && (
          <Badge variant="secondary">
            {t(`states.${storage.status}`, { defaultValue: storage.status })}
          </Badge>
        )}
      </div>
      {tabs.length > 1 && (
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={tabs.map((v) => ({
            value: v,
            label: t(`storage.tabs.${v}`),
          }))}
        />
      )}
      {tab === "summary" ? (
        <>
          <Usage
            label={t("usage.usage")}
            value={percent(storage.disk, storage.maxdisk)}
            detail={`${formatBytes(storage.disk)} / ${formatBytes(storage.maxdisk)}`}
          />
          <div>
            <GroupHeading title={t("summary.title")} />
            <Fact label={t("summary.node")}>{node}</Fact>
            {info?.content && (
              <Fact label={t("storage.content")}>
                {info.content
                  .split(",")
                  .map((c) =>
                    t(`storage.contentTypes.${c.trim()}`, {
                      defaultValue: c.trim(),
                    }),
                  )
                  .join(", ")}
              </Fact>
            )}
            {info?.shared !== undefined && (
              <Fact label={t("storage.shared")}>
                {t(info.shared ? "app.yes" : "app.no")}
              </Fact>
            )}
          </div>
        </>
      ) : (
        <ContentList
          hostId={hostId}
          node={node}
          storage={name}
          kind={tab}
          isVisible={isVisible}
        />
      )}
    </div>
  );
}

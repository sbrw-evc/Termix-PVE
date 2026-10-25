import { useEffect, useState } from "react";
import {
  useHosts,
  useToast,
  useTranslation,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  GroupHeading,
} from "@termix-ssh/plugin-sdk/ui";
import { Download, Plus, RotateCcw } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { formatBytes } from "../format";
import { useTasks } from "../tasks";
import { Fact } from "../components/Usage";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import {
  CrudSection,
  paramsFrom,
  useApiList,
  type FieldSpec,
} from "../datacenter/crud";
import { GuestConsole } from "../guests/console/GuestConsole";
import { unusedDisks, type ListedDisk } from "./diskCreate";
import {
  openExternal,
  proxmoxBaseUrl,
  usesDirectApi,
  webConsoleUrl,
} from "../proxmoxWeb";
import type { NodeTabProps } from "./NodeTabs";
import {
  cephInitParams,
  cephInitProblem,
  cephSetupState,
  flattenOsds,
  osdParams,
  osdProblem,
  type CephInitForm,
  type OsdForm,
  type OsdRow,
} from "./ceph";

interface CephStatus {
  health?: {
    status?: string;
    checks?: Record<string, { summary?: { message?: string } }>;
  };
  pgmap?: { bytes_used?: number; bytes_total?: number; num_pgs?: number };
  osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number };
  monmap?: { mons?: unknown[] };
}

/** Whether an answer means Ceph is simply not set up on this node. */
export function cephMissing(error: string | null): boolean {
  const state = cephSetupState(error);
  return state === "install" || state === "init";
}

const HEALTH: Record<string, "secondary" | "outline" | "destructive"> = {
  HEALTH_OK: "secondary",
  HEALTH_WARN: "outline",
  HEALTH_ERR: "destructive",
};

/** Ceph on a node: install and initialize it, then monitors, managers, OSDs, pools and CephFS. */
export function CephTab(props: NodeTabProps) {
  const { hostId, node, isVisible } = props;
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const { data, error, load } = useApiList<CephStatus>(
    hostId,
    ["nodes", node, "ceph", "status"],
    undefined,
    isVisible,
  );
  const state = cephSetupState(error);

  if (state === "install") return <InstallSection {...props} onDone={load} />;
  if (state === "init") return <InitSection {...props} onDone={load} />;

  const health = data?.health?.status;
  const checks = Object.values(data?.health?.checks ?? {})
    .map((c) => c.summary?.message)
    .filter(Boolean);
  const ready = !!data && isVisible;

  const restart = async () => {
    const ok = await app().confirm({
      title: t("ceph.restartTitle", { node }),
      description: t("ceph.restartDescription"),
      confirmLabel: t("ceph.restart"),
    });
    if (!ok) return;
    try {
      const upid = await pve(hostId, "POST", [
        "nodes",
        node,
        "ceph",
        "restart",
      ]);
      await track(upid, t("ceph.restartLabel", { node }));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      void load();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("ceph.title")}
          action={
            <div className="flex items-center gap-1">
              {health ? (
                <Badge variant={HEALTH[health] ?? "outline"}>{health}</Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => void restart()}
              >
                <RotateCcw className="mr-1 size-3" />
                {t("ceph.restart")}
              </Button>
            </div>
          }
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {data && (
          <>
            <Fact label={t("ceph.usage")}>
              {formatBytes(data.pgmap?.bytes_used)} /{" "}
              {formatBytes(data.pgmap?.bytes_total)}
            </Fact>
            <Fact label={t("ceph.osds")}>
              {t("ceph.osdCount", {
                total: data.osdmap?.num_osds ?? 0,
                up: data.osdmap?.num_up_osds ?? 0,
                in: data.osdmap?.num_in_osds ?? 0,
              })}
            </Fact>
            <Fact label={t("ceph.monitors")}>
              {data.monmap?.mons?.length ?? 0}
            </Fact>
            <Fact label={t("ceph.pgs")}>{data.pgmap?.num_pgs ?? 0}</Fact>
            {checks.map((message) => (
              <p key={message} className="text-[11px] text-destructive">
                {message}
              </p>
            ))}
          </>
        )}
      </section>
      <MonitorsSection hostId={hostId} node={node} isVisible={ready} />
      <ManagersSection hostId={hostId} node={node} isVisible={ready} />
      <OsdSection
        hostId={hostId}
        node={node}
        isVisible={ready}
        onChange={load}
      />
      <PoolsSection hostId={hostId} node={node} isVisible={ready} />
      <CephFsSection hostId={hostId} node={node} isVisible={ready} />
    </div>
  );
}

function InstallSection({
  hostId,
  node,
  onDone,
}: NodeTabProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const host = useHosts().hosts.find((h) => Number(h.id) === hostId);
  // Without SSH the install runs in Proxmox's own shell page, its installer.
  const base = usesDirectApi(host) ? proxmoxBaseUrl(host) : null;
  const [version, setVersion] = useState("squid");
  const [repository, setRepository] = useState("no-subscription");
  const [running, setRunning] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading title={t("ceph.title")} />
      <p className="text-xs text-muted-foreground">{t("ceph.installIntro")}</p>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <Field label={t("ceph.version")}>
          <SelectInput
            value={version}
            onChange={setVersion}
            options={[
              { value: "squid", label: "Squid (19)" },
              { value: "tentacle", label: "Tentacle (20)" },
            ]}
          />
        </Field>
        <Field label={t("ceph.repository")}>
          <SelectInput
            value={repository}
            onChange={setRepository}
            options={[
              { value: "no-subscription", label: "No-Subscription" },
              { value: "enterprise", label: "Enterprise" },
              { value: "test", label: "Test" },
            ]}
          />
        </Field>
      </div>
      <Button
        size="sm"
        className="self-start"
        onClick={() =>
          base
            ? openExternal(
                webConsoleUrl(base, {
                  kind: "shell",
                  node,
                  cmd: "ceph_install",
                }),
              )
            : setRunning(true)
        }
      >
        <Download className="mr-1 size-3.5" />
        {t("ceph.install")}
      </Button>
      {running && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setRunning(false);
              onDone();
            }
          }}
        >
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t("ceph.installTitle", { node })}</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground">
              {t("ceph.installHint")}
            </p>
            <div className="h-[60vh]">
              <GuestConsole
                hostId={hostId}
                node={node}
                type="ceph-install"
                vmid={0}
                extra={{ version, repository }}
                fill
                autoConnect
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function InitSection({
  hostId,
  node,
  onDone,
}: NodeTabProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<CephInitForm>({
    network: "",
    clusterNetwork: "",
    size: "3",
    minSize: "2",
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CephInitForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const problem = cephInitProblem(form);
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading title={t("ceph.title")} />
      <p className="text-xs text-muted-foreground">{t("ceph.initIntro")}</p>
      <div className="grid max-w-xl grid-cols-2 gap-3">
        <Field label={t("ceph.network")} hint={t("ceph.networkHint")}>
          <TextInput
            value={form.network}
            onChange={(network) => set({ network })}
            placeholder="10.10.10.0/24"
          />
        </Field>
        <Field
          label={t("ceph.clusterNetwork")}
          hint={t("ceph.clusterNetworkHint")}
        >
          <TextInput
            value={form.clusterNetwork}
            onChange={(clusterNetwork) => set({ clusterNetwork })}
          />
        </Field>
        <Field label={t("ceph.size")}>
          <TextInput
            type="number"
            min={1}
            max={7}
            value={form.size}
            onChange={(size) => set({ size })}
          />
        </Field>
        <Field label={t("ceph.minSize")}>
          <TextInput
            type="number"
            min={1}
            max={7}
            value={form.minSize}
            onChange={(minSize) => set({ minSize })}
          />
        </Field>
      </div>
      {problem && (
        <p className="text-[11px] text-destructive">
          {t(`ceph.problem.${problem}`)}
        </p>
      )}
      <Button
        size="sm"
        className="self-start"
        disabled={!!problem || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await pve(
              hostId,
              "POST",
              ["nodes", node, "ceph", "init"],
              cephInitParams(form),
            );
            // The first monitor and manager live on this node, as Proxmox's wizard does.
            await pve(hostId, "POST", [
              "nodes",
              node,
              "ceph",
              "mon",
              node,
            ]).catch(() => null);
            await pve(hostId, "POST", [
              "nodes",
              node,
              "ceph",
              "mgr",
              node,
            ]).catch(() => null);
            toast.success(t("ceph.initialized"));
            onDone();
          } catch (err) {
            toast.error(toCallError(err).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("ceph.init")}
      </Button>
    </section>
  );
}

interface SectionProps {
  hostId: number;
  node: string;
  isVisible: boolean;
}

function MonitorsSection({ hostId, node, isVisible }: SectionProps) {
  const { t } = useTranslation();
  const fields: FieldSpec[] = [
    {
      key: "mon-address",
      labelKey: "ceph.monAddress",
      hintKey: "ceph.monAddressHint",
    },
  ];
  return (
    <CrudSection<{
      name: string;
      host?: string;
      addr?: string;
      quorum?: number;
    }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="ceph.monitors"
      emptyKey="ceph.none"
      listPath={["nodes", node, "ceph", "mon"]}
      rowId={(m) => m.name}
      view={(m) => ({
        title: m.name,
        badges: m.quorum ? (
          <Badge variant="secondary">{t("ceph.inQuorum")}</Badge>
        ) : null,
        detail: [m.host, m.addr].filter(Boolean).join(" · "),
      })}
      fields={fields}
      createPath={["nodes", node, "ceph", "mon", node]}
      toParams={(v, c) => paramsFrom(fields, v, c)}
      createLabelKey="ceph.addMonitor"
      dialogTitle={() => t("ceph.addMonitorOn", { node })}
      canEdit={() => false}
      itemPath={(m) => ["nodes", m.host ?? node, "ceph", "mon", m.name]}
      deleteText={(m) => ({
        title: t("ceph.removeMonitor", { name: m.name }),
        description: t("ceph.removeMonitorDescription"),
      })}
    />
  );
}

function ManagersSection({ hostId, node, isVisible }: SectionProps) {
  const { t } = useTranslation();
  return (
    <CrudSection<{ name: string; host?: string; state?: string; addr?: string }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="ceph.managers"
      emptyKey="ceph.none"
      listPath={["nodes", node, "ceph", "mgr"]}
      rowId={(m) => m.name}
      view={(m) => ({
        title: m.name,
        badges: m.state ? <Badge variant="outline">{m.state}</Badge> : null,
        detail: [m.host, m.addr].filter(Boolean).join(" · "),
      })}
      fields={[]}
      createPath={["nodes", node, "ceph", "mgr", node]}
      toParams={() => ({})}
      createLabelKey="ceph.addManager"
      dialogTitle={() => t("ceph.addManagerOn", { node })}
      canEdit={() => false}
      itemPath={(m) => ["nodes", m.host ?? node, "ceph", "mgr", m.name]}
      deleteText={(m) => ({
        title: t("ceph.removeManager", { name: m.name }),
        description: t("ceph.removeManagerDescription"),
      })}
    />
  );
}

function OsdSection({
  hostId,
  node,
  isVisible,
  onChange,
}: SectionProps & { onChange: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const { data, error, load } = useApiList<unknown>(
    hostId,
    ["nodes", node, "ceph", "osd"],
    undefined,
    isVisible,
  );
  const [creating, setCreating] = useState(false);
  const [destroying, setDestroying] = useState<OsdRow | null>(null);
  const osds = flattenOsds(data);

  const act = async (osd: OsdRow, action: "in" | "out" | "scrub" | "deep") => {
    try {
      await pve(
        hostId,
        "POST",
        [
          "nodes",
          osd.host || node,
          "ceph",
          "osd",
          osd.id,
          action === "deep" ? "scrub" : action,
        ],
        action === "deep" ? { deep: true } : undefined,
      );
      toast.success(t(`ceph.osdDone.${action}`, { name: osd.name }));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      void load();
      onChange();
    }
  };

  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("ceph.osds")}
        count={osds.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1 size-3" />
            {t("ceph.addOsd")}
          </Button>
        }
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {data !== null && osds.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("ceph.noOsds")}</p>
      )}
      {osds.map((osd) => (
        <div
          key={osd.id}
          className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {osd.name}{" "}
              <span className="text-muted-foreground">· {osd.host}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {[
                osd.deviceClass,
                osd.size ? formatBytes(osd.size) : null,
                osd.used !== undefined ? `${osd.used.toFixed(1)}%` : null,
                osd.weight !== undefined
                  ? t("ceph.weight", { weight: osd.weight.toFixed(3) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Badge variant={osd.up ? "secondary" : "destructive"}>
            {osd.up ? "up" : "down"}
          </Badge>
          <Badge variant={osd.in ? "secondary" : "outline"}>
            {osd.in ? "in" : "out"}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => void act(osd, osd.in ? "out" : "in")}
          >
            {osd.in ? "Out" : "In"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => void act(osd, "scrub")}
          >
            {t("ceph.scrub")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => void act(osd, "deep")}
          >
            {t("ceph.deepScrub")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-destructive"
            disabled={osd.in || osd.up}
            title={osd.in || osd.up ? t("ceph.destroyFirst") : undefined}
            onClick={() => setDestroying(osd)}
          >
            {t("ceph.destroy")}
          </Button>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">{t("ceph.osdHint")}</p>
      {creating && (
        <CreateOsdDialog
          hostId={hostId}
          node={node}
          onClose={() => setCreating(false)}
          onDone={() => {
            void load();
            onChange();
          }}
        />
      )}
      {destroying && (
        <DestroyOsdDialog
          hostId={hostId}
          node={destroying.host || node}
          osd={destroying}
          onClose={() => setDestroying(null)}
          onDone={() => {
            void load();
            onChange();
          }}
          track={track}
        />
      )}
    </section>
  );
}

function CreateOsdDialog({
  hostId,
  node,
  onClose,
  onDone,
}: {
  hostId: number;
  node: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [disks, setDisks] = useState<ListedDisk[] | null>(null);
  const [form, setForm] = useState<OsdForm>({
    dev: "",
    dbDev: "",
    dbSize: "",
    walDev: "",
    walSize: "",
    encrypted: false,
    deviceClass: "",
  });
  const set = (patch: Partial<OsdForm>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => {
    pve<ListedDisk[]>(hostId, "GET", ["nodes", node, "disks", "list"]).then(
      (list) => setDisks(list ?? []),
      () => setDisks([]),
    );
  }, [hostId, node]);
  const unused = unusedDisks(disks);
  const label = (d: ListedDisk) =>
    [d.devpath, d.model, formatBytes(d.size)].filter(Boolean).join(" · ");
  const problem = osdProblem(form);
  const optional = [
    { value: "", label: t("ceph.sameDisk") },
    ...(disks ?? []).map((d) => ({ value: d.devpath, label: label(d) })),
  ];
  return (
    <FormDialog
      title={t("ceph.addOsdOn", { node })}
      submitLabel={t("ceph.addOsd")}
      destructive
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", node, "ceph", "osd"],
          osdParams(form),
        );
        void track(upid, t("ceph.addOsdLabel", { dev: form.dev, node })).then(
          onDone,
        );
      }}
    >
      {() => (
        <>
          <p className="text-[11px] text-destructive">{t("ceph.osdWipe")}</p>
          {disks !== null && unused.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("nodes.disks.storage.noUnused")}
            </p>
          ) : (
            <Field label={t("ceph.disk")}>
              <SelectInput
                value={form.dev}
                placeholder={t("nodes.disks.storage.pickDisk")}
                onChange={(dev) => set({ dev })}
                options={unused.map((d) => ({
                  value: d.devpath,
                  label: label(d),
                }))}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("ceph.dbDisk")}>
              <SelectInput
                value={form.dbDev}
                onChange={(dbDev) => set({ dbDev })}
                options={optional}
              />
            </Field>
            <Field label={t("ceph.dbSize")}>
              <TextInput
                type="number"
                value={form.dbSize}
                onChange={(dbSize) => set({ dbSize })}
              />
            </Field>
            <Field label={t("ceph.walDisk")}>
              <SelectInput
                value={form.walDev}
                onChange={(walDev) => set({ walDev })}
                options={optional}
              />
            </Field>
            <Field label={t("ceph.walSize")}>
              <TextInput
                type="number"
                value={form.walSize}
                onChange={(walSize) => set({ walSize })}
              />
            </Field>
          </div>
          <Field label={t("ceph.deviceClass")} hint={t("ceph.deviceClassHint")}>
            <TextInput
              value={form.deviceClass}
              onChange={(deviceClass) => set({ deviceClass })}
              placeholder="ssd"
            />
          </Field>
          <CheckField
            label={t("ceph.encrypt")}
            checked={form.encrypted}
            onChange={(encrypted) => set({ encrypted })}
          />
          {problem && form.dev && (
            <p className="text-[11px] text-destructive">
              {t(`ceph.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

function DestroyOsdDialog({
  hostId,
  node,
  osd,
  onClose,
  onDone,
  track,
}: {
  hostId: number;
  node: string;
  osd: OsdRow;
  onClose: () => void;
  onDone: () => void;
  track: (result: unknown, label: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [cleanup, setCleanup] = useState(true);
  const [typed, setTyped] = useState("");
  return (
    <FormDialog
      title={t("ceph.destroyTitle", { name: osd.name })}
      submitLabel={t("ceph.destroy")}
      destructive
      canSubmit={typed === osd.name}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "DELETE",
          ["nodes", node, "ceph", "osd", osd.id],
          { cleanup },
        );
        void track(upid, t("ceph.destroyLabel", { name: osd.name })).then(
          onDone,
        );
      }}
    >
      {() => (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("ceph.destroyDescription")}
          </p>
          <CheckField
            label={t("ceph.cleanup")}
            checked={cleanup}
            onChange={setCleanup}
          />
          <Field label={t("nodes.power.typeName", { node: osd.name })}>
            <TextInput
              value={typed}
              onChange={setTyped}
              placeholder={osd.name}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

interface CephPool extends Record<string, unknown> {
  pool_name: string;
  size?: number;
  min_size?: number;
  pg_num?: number;
  pg_autoscale_mode?: string;
  crush_rule_name?: string;
  application_metadata?: Record<string, unknown>;
  bytes_used?: number;
  percent_used?: number;
}

function PoolsSection({ hostId, node, isVisible }: SectionProps) {
  const { t } = useTranslation();
  const rules = useApiList<Array<{ name: string }>>(
    hostId,
    ["nodes", node, "ceph", "rules"],
    undefined,
    isVisible,
  );
  const fields: FieldSpec[] = [
    {
      key: "name",
      labelKey: "ceph.poolName",
      required: true,
      createOnly: true,
      pattern: /^[^:/\s]+$/,
    },
    { key: "size", labelKey: "ceph.size", kind: "number", default: "3" },
    { key: "min_size", labelKey: "ceph.minSize", kind: "number", default: "2" },
    { key: "pg_num", labelKey: "ceph.pgNum", kind: "number", default: "128" },
    {
      key: "pg_autoscale_mode",
      labelKey: "ceph.autoscale",
      kind: "select",
      default: "on",
      options: [{ value: "on" }, { value: "warn" }, { value: "off" }],
    },
    {
      key: "application",
      labelKey: "ceph.application",
      kind: "select",
      default: "rbd",
      options: [{ value: "rbd" }, { value: "cephfs" }, { value: "rgw" }],
    },
    {
      key: "crush_rule",
      labelKey: "ceph.crushRule",
      kind: "select",
      options: (rules.data ?? []).map((r) => ({ value: r.name })),
    },
    {
      key: "target_size",
      labelKey: "ceph.targetSize",
      hintKey: "ceph.targetSizeHint",
    },
    {
      key: "add_storages",
      labelKey: "ceph.addStorage",
      kind: "check",
      default: true,
      hideOnEdit: true,
    },
  ];
  return (
    <CrudSection<CephPool>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="ceph.pools"
      emptyKey="ceph.none"
      listPath={["nodes", node, "ceph", "pool"]}
      rowId={(p) => p.pool_name}
      view={(p) => ({
        title: p.pool_name,
        detail: [
          t("ceph.replicas", { size: p.size ?? "-", min: p.min_size ?? "-" }),
          `PG ${p.pg_num ?? "-"}`,
          p.crush_rule_name,
          p.bytes_used !== undefined ? formatBytes(p.bytes_used) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        badges: p.pg_autoscale_mode ? (
          <Badge variant="outline">{p.pg_autoscale_mode}</Badge>
        ) : null,
      })}
      fields={fields}
      prepare={(row) => ({
        ...row,
        name: row.pool_name,
        crush_rule: row.crush_rule_name,
        application:
          Object.keys(
            (row.application_metadata as Record<string, unknown>) ?? {},
          )[0] ?? "",
      })}
      createPath={["nodes", node, "ceph", "pool"]}
      itemPath={(p) => ["nodes", node, "ceph", "pool", p.pool_name]}
      toParams={(v, creating) => {
        const params = paramsFrom(fields, v, creating);
        // Proxmox refuses clearing these; leave blank ones unchanged instead.
        delete params.delete;
        return params;
      }}
      onDelete={async (p) => {
        await pve(
          hostId,
          "DELETE",
          ["nodes", node, "ceph", "pool", p.pool_name],
          {
            remove_storages: true,
          },
        );
      }}
      createLabelKey="ceph.addPool"
      deleteText={(p) => ({
        title: t("ceph.removePool", { name: p.pool_name }),
        description: t("ceph.removePoolDescription"),
      })}
    />
  );
}

function CephFsSection({ hostId, node, isVisible }: SectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const fsFields: FieldSpec[] = [
    {
      key: "name",
      labelKey: "ceph.fsName",
      required: true,
      createOnly: true,
      local: true,
      default: "cephfs",
      pattern: /^[A-Za-z0-9_-]+$/,
    },
    { key: "pg_num", labelKey: "ceph.pgNum", kind: "number", default: "128" },
    {
      key: "add-storage",
      labelKey: "ceph.addStorage",
      kind: "check",
      default: true,
    },
  ];
  return (
    <>
      <CrudSection<{
        name: string;
        state?: string;
        host?: string;
        addr?: string;
      }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="ceph.mds"
        hintKey="ceph.mdsHint"
        emptyKey="ceph.none"
        listPath={["nodes", node, "ceph", "mds"]}
        rowId={(m) => m.name}
        view={(m) => ({
          title: m.name,
          badges: m.state ? <Badge variant="outline">{m.state}</Badge> : null,
          detail: [m.host, m.addr].filter(Boolean).join(" · "),
        })}
        fields={[]}
        createPath={["nodes", node, "ceph", "mds", node]}
        toParams={() => ({})}
        createLabelKey="ceph.addMds"
        dialogTitle={() => t("ceph.addMdsOn", { node })}
        canEdit={() => false}
        itemPath={(m) => ["nodes", m.host ?? node, "ceph", "mds", m.name]}
        deleteText={(m) => ({
          title: t("ceph.removeMds", { name: m.name }),
          description: t("ceph.removeMdsDescription"),
        })}
      />
      <CrudSection<{ name: string; metadata_pool?: string; data_pool?: string }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="ceph.cephfs"
        emptyKey="ceph.noFs"
        listPath={["nodes", node, "ceph", "fs"]}
        rowId={(f) => f.name}
        view={(f) => ({
          title: f.name,
          detail: [f.data_pool, f.metadata_pool].filter(Boolean).join(" · "),
        })}
        fields={fsFields}
        createPathFor={(v) => ["nodes", node, "ceph", "fs", String(v.name)]}
        toParams={(v, c) => paramsFrom(fsFields, v, c)}
        afterCreate={(upid, v) => {
          void track(
            upid,
            t("ceph.addFsLabel", { name: String(v.name) }),
          ).catch((err) => toast.error(toCallError(err).message));
        }}
        createLabelKey="ceph.addFs"
        canEdit={() => false}
        canDelete={() => false}
        menu={() => (
          <DropdownMenuItem disabled>{t("ceph.fsRemoveHint")}</DropdownMenuItem>
        )}
      />
    </>
  );
}

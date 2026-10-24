import { useCallback, useEffect, useState } from "react";
import {
  useHosts,
  useToast,
  useTranslation,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@termix-ssh/plugin-sdk/ui";
import { Check, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { useTasks } from "../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import {
  BOND_MODES,
  carriesAddress,
  ifaceForm,
  ifaceParams,
  ifaceProblem,
  type IfaceForm,
  type IfaceType,
  type NodeIface,
} from "./network";

function IfaceDialog({
  hostId,
  node,
  iface,
  warnAddress,
  onDone,
  onClose,
}: {
  hostId: number;
  node: string;
  iface?: NodeIface;
  warnAddress: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const creating = !iface;
  const [form, setForm] = useState<IfaceForm>(() => ifaceForm(iface));
  const set = (patch: Partial<IfaceForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const problem = ifaceProblem(form, creating);

  return (
    <FormDialog
      title={t(creating ? "network.createTitle" : "network.editTitle", {
        iface: form.iface,
      })}
      submitLabel={t(creating ? "network.create" : "app.save")}
      canSubmit={!problem}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const path = creating
          ? ["nodes", node, "network"]
          : ["nodes", node, "network", form.iface];
        await pve(
          hostId,
          creating ? "POST" : "PUT",
          path,
          ifaceParams(form, creating),
        );
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          {warnAddress && (
            <p className="text-xs text-destructive">
              {t("network.addressWarning")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("network.type")}>
              <SelectInput
                value={form.type}
                onChange={(v) => set({ type: v as IfaceType })}
                disabled={!creating}
                options={(["bridge", "bond", "vlan"] as const).map((v) => ({
                  value: v,
                  label: t(`network.types.${v}`),
                }))}
              />
            </Field>
            <Field
              label={t("network.name")}
              hint={creating ? t(`network.nameHint.${form.type}`) : undefined}
              error={fieldError("iface")}
            >
              <TextInput
                value={form.iface}
                onChange={(iface) => set({ iface })}
                disabled={!creating}
                placeholder={
                  form.type === "bridge"
                    ? "vmbr1"
                    : form.type === "bond"
                      ? "bond0"
                      : "vmbr0.10"
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("network.cidr")} error={fieldError("cidr")}>
              <TextInput
                value={form.cidr}
                onChange={(cidr) => set({ cidr })}
                placeholder="10.10.0.1/24"
              />
            </Field>
            <Field label={t("network.gateway")} error={fieldError("gateway")}>
              <TextInput
                value={form.gateway}
                onChange={(gateway) => set({ gateway })}
              />
            </Field>
            <Field label={t("network.cidr6")} error={fieldError("cidr6")}>
              <TextInput
                value={form.cidr6}
                onChange={(cidr6) => set({ cidr6 })}
              />
            </Field>
            <Field label={t("network.gateway6")} error={fieldError("gateway6")}>
              <TextInput
                value={form.gateway6}
                onChange={(gateway6) => set({ gateway6 })}
              />
            </Field>
          </div>
          {form.type !== "vlan" && (
            <Field
              label={t(
                form.type === "bond" ? "network.slaves" : "network.ports",
              )}
              hint={t("network.portsHint")}
              error={fieldError(
                form.type === "bond" ? "slaves" : "bridge_ports",
              )}
            >
              <TextInput
                value={form.ports}
                onChange={(ports) => set({ ports })}
                placeholder="nic1"
              />
            </Field>
          )}
          {form.type === "bond" && (
            <Field label={t("network.bondMode")}>
              <SelectInput
                value={form.bondMode}
                onChange={(bondMode) => set({ bondMode })}
                options={BOND_MODES.map((v) => ({ value: v, label: v }))}
              />
            </Field>
          )}
          {form.type === "vlan" && /^vlan\d/.test(form.iface) && (
            <Field
              label={t("network.vlanDevice")}
              error={fieldError("vlan-raw-device")}
            >
              <TextInput
                value={form.vlanDevice}
                onChange={(vlanDevice) => set({ vlanDevice })}
                placeholder="vmbr0"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("network.mtu")} error={fieldError("mtu")}>
              <TextInput
                type="number"
                value={form.mtu}
                onChange={(mtu) => set({ mtu })}
                placeholder="1500"
              />
            </Field>
            <Field label={t("network.comments")}>
              <TextInput
                value={form.comments}
                onChange={(comments) => set({ comments })}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <CheckField
              label={t("network.autostart")}
              checked={form.autostart}
              onChange={(autostart) => set({ autostart })}
            />
            {form.type === "bridge" && (
              <CheckField
                label={t("network.vlanAware")}
                hint={t("network.vlanAwareHint")}
                checked={form.vlanAware}
                onChange={(vlanAware) => set({ vlanAware })}
              />
            )}
          </div>
          {problem && (
            <p className="text-[11px] text-muted-foreground">
              {t(`network.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

export function NetworkTab({
  hostId,
  node,
  isVisible,
}: {
  hostId: number;
  node: string;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const hostAddress = String(
    useHosts().hosts.find((h) => Number(h.id) === hostId)?.ip ?? "",
  );
  const [list, setList] = useState<NodeIface[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ iface?: NodeIface } | null>(null);
  // PVE reports pending changes only beside its API answer, which pvesh
  // drops, so this tracks what was changed from here.
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const data =
        (await pve<NodeIface[]>(hostId, "GET", ["nodes", node, "network"])) ??
        [];
      setList(
        data.sort(
          (a, b) =>
            a.type.localeCompare(b.type) ||
            a.iface.localeCompare(b.iface, undefined, { numeric: true }),
        ),
      );
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
  }, [hostId, node]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const changed = () => {
    setDirty(true);
    void load();
  };

  const remove = async (iface: NodeIface) => {
    const ok = await app().confirm({
      title: t("network.removeTitle", { iface: iface.iface }),
      description: t(
        carriesAddress(iface, hostAddress)
          ? "network.addressWarning"
          : "network.removeDescription",
      ),
      confirmLabel: t("hardware.remove"),
    });
    if (!ok) return;
    try {
      await pve(hostId, "DELETE", ["nodes", node, "network", iface.iface]);
      changed();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  const apply = async () => {
    const ok = await app().confirm({
      title: t("network.applyTitle", { node }),
      description: t("network.applyDescription"),
      confirmLabel: t("network.apply"),
    });
    if (!ok) return;
    try {
      const upid = await pve(hostId, "PUT", ["nodes", node, "network"]);
      await track(upid, t("network.applyLabel", { node }));
      setDirty(false);
      void load();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  const revert = async () => {
    try {
      await pve(hostId, "DELETE", ["nodes", node, "network"]);
      toast.success(t("network.reverted"));
      setDirty(false);
      void load();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => setDialog({})}>
          <Plus className="mr-1 size-3.5" />
          {t("network.add")}
        </Button>
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          onClick={() => void apply()}
        >
          <Check className="mr-1 size-3.5" />
          {t("network.apply")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void revert()}>
          <Undo2 className="mr-1 size-3.5" />
          {t("network.revert")}
        </Button>
        {dirty && <Badge variant="outline">{t("network.pending")}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("network.hint")}</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {list?.map((iface) => {
        const editable = ["bridge", "bond", "vlan"].includes(iface.type);
        return (
          <div
            key={iface.iface}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <span className="w-20 shrink-0 font-medium">{iface.iface}</span>
            <span className="w-16 shrink-0 text-muted-foreground">
              {t(`network.types.${iface.type}`, { defaultValue: iface.type })}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {[
                iface.cidr,
                iface.gateway && `gw ${iface.gateway}`,
                iface.cidr6,
                iface.bridge_ports &&
                  `${t("network.ports")}: ${iface.bridge_ports}`,
                iface.slaves && `${t("network.slaves")}: ${iface.slaves}`,
                iface.comments,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {iface.active ? null : (
              <Badge variant="outline">{t("network.inactive")}</Badge>
            )}
            {editable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    aria-label={t("guests.more")}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setDialog({ iface })}>
                    {t("hardware.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => void remove(iface)}
                  >
                    {t("hardware.remove")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      {dialog && (
        <IfaceDialog
          hostId={hostId}
          node={node}
          iface={dialog.iface}
          warnAddress={
            !!dialog.iface && carriesAddress(dialog.iface, hostAddress)
          }
          onDone={changed}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

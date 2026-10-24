import { useState, type ReactNode } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GroupHeading,
} from "@termix-ssh/plugin-sdk/ui";
import { MoreHorizontal, Plus } from "lucide-react";
import { app, toCallError } from "../../api";
import {
  lxcVolumes,
  nics,
  qemuCdDrives,
  qemuDisks,
  qemuNicModel,
  unusedVolumes,
  type GuestDisk,
  type GuestNic,
} from "../config";
import { setConfig, useGuestConfig, type GuestRef } from "../useGuestConfig";
import {
  AddDiskDialog,
  CdDialog,
  CpuMemoryDialog,
  MoveDialog,
  NicDialog,
  ResizeDialog,
} from "./HardwareDialogs";
import { volumeName } from "../lookups";

type Dialog =
  | { kind: "cpu" }
  | { kind: "addDisk" }
  | { kind: "resize"; disk: GuestDisk }
  | { kind: "move"; disk: GuestDisk }
  | { kind: "nic"; nic?: GuestNic }
  | { kind: "cd"; drive: string };

function Row({
  label,
  value,
  pending,
  actions,
}: {
  label: string;
  value: ReactNode;
  pending?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-1.5 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px]"
        title={String(value)}
      >
        {value}
      </span>
      {pending && <Badge variant="outline">{t("hardware.pending")}</Badge>}
      {actions}
    </div>
  );
}

function RowMenu({
  items,
}: {
  items: Array<{
    label: string;
    run: () => void;
    danger?: boolean;
    disabled?: boolean;
  }>;
}) {
  const { t } = useTranslation();
  return (
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
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={item.disabled}
            className={item.danger ? "text-destructive" : undefined}
            onClick={item.run}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HardwareTab({
  guest,
  isVisible,
}: {
  guest: GuestRef;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, pending, error, reload } = useGuestConfig(guest, isVisible);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const qemu = guest.type === "qemu";

  if (error) return <p className="py-2 text-xs text-destructive">{error}</p>;
  if (!config)
    return (
      <p className="py-2 text-xs text-muted-foreground">{t("app.loading")}</p>
    );

  /** Removes config keys after asking. */
  const remove = async (
    key: string,
    title: string,
    description: string,
    done = "hardware.removed",
  ) => {
    const ok = await app().confirm({
      title,
      description,
      confirmLabel: t("hardware.remove"),
    });
    if (!ok) return;
    try {
      await setConfig(guest, { [key]: null }, config.digest);
      toast.success(t(done, { key }));
    } catch (err) {
      toast.error(toCallError(err).message);
    }
    void reload();
  };

  const disks = qemu ? qemuDisks(config) : lxcVolumes(config);
  const unused = unusedVolumes(config);
  const adapters = nics(config);
  const close = () => setDialog(null);
  const done = () => void reload();
  const dialogProps = { guest, config, onDone: done, onClose: close };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <GroupHeading
          title={t("hardware.cpuMemory.heading")}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "cpu" })}
            >
              {t("hardware.edit")}
            </Button>
          }
        />
        {qemu ? (
          <>
            <Row
              label={t("hardware.processors")}
              value={t("hardware.processorsValue", {
                sockets: config.sockets ?? 1,
                cores: config.cores ?? 1,
                cpu: String(config.cpu ?? "kvm64"),
              })}
              pending={
                pending.has("cores") ||
                pending.has("sockets") ||
                pending.has("cpu")
              }
            />
            <Row
              label={t("usage.memory")}
              value={`${config.memory ?? 512} MiB${config.balloon !== undefined ? ` (${t("hardware.balloonShort")} ${config.balloon})` : ""}`}
              pending={pending.has("memory") || pending.has("balloon")}
            />
          </>
        ) : (
          <>
            <Row
              label={t("guests.fields.cores")}
              value={`${config.cores ?? t("hardware.allCores")}${config.cpulimit ? ` (${t("hardware.cpulimit")} ${config.cpulimit})` : ""}`}
              pending={pending.has("cores") || pending.has("cpulimit")}
            />
            <Row
              label={t("usage.memory")}
              value={`${config.memory ?? 512} MiB`}
              pending={pending.has("memory")}
            />
            <Row
              label={t("hardware.swap")}
              value={`${config.swap ?? 512} MiB`}
              pending={pending.has("swap")}
            />
          </>
        )}
      </div>

      <div>
        <GroupHeading
          title={t(qemu ? "hardware.disks" : "hardware.volumes")}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "addDisk" })}
            >
              <Plus className="mr-1 size-3.5" />
              {t(qemu ? "hardware.addDisk.button" : "hardware.addMount.button")}
            </Button>
          }
        />
        {disks.map((disk) => {
          const special = disk.key === "efidisk0" || disk.key === "tpmstate0";
          return (
            <Row
              key={disk.key}
              label={
                disk.mountPath ? `${disk.key} ${disk.mountPath}` : disk.key
              }
              value={`${disk.volume}${disk.size ? `, ${disk.size}` : ""}`}
              pending={pending.has(disk.key)}
              actions={
                <RowMenu
                  items={[
                    {
                      label: t("hardware.resize.menu"),
                      run: () => setDialog({ kind: "resize", disk }),
                      disabled: special,
                    },
                    {
                      label: t("hardware.move.menu"),
                      run: () => setDialog({ kind: "move", disk }),
                    },
                    ...(disk.key === "rootfs"
                      ? []
                      : [
                          {
                            label: t("hardware.detach.menu"),
                            danger: true,
                            run: () =>
                              void remove(
                                disk.key,
                                t("hardware.detach.title", { key: disk.key }),
                                t("hardware.detach.description"),
                                "hardware.detached",
                              ),
                          },
                        ]),
                  ]}
                />
              }
            />
          );
        })}
        {unused.map((disk) => (
          <Row
            key={disk.key}
            label={disk.key}
            value={disk.volume}
            actions={
              <RowMenu
                items={[
                  {
                    label: t("hardware.unused.delete"),
                    danger: true,
                    run: () =>
                      void remove(
                        disk.key,
                        t("hardware.unused.title", { volume: disk.volume }),
                        t("hardware.unused.description"),
                      ),
                  },
                ]}
              />
            }
          />
        ))}
      </div>

      {qemu && (
        <div>
          <GroupHeading title={t("hardware.cd.heading")} />
          {qemuCdDrives(config).map((cd) => (
            <Row
              key={cd.key}
              label={cd.key}
              value={
                cd.media === "none"
                  ? t("hardware.cd.empty")
                  : volumeName(cd.media)
              }
              pending={pending.has(cd.key)}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6"
                  onClick={() => setDialog({ kind: "cd", drive: cd.key })}
                >
                  {t("hardware.edit")}
                </Button>
              }
            />
          ))}
        </div>
      )}

      <div>
        <GroupHeading
          title={t("hardware.nic.heading")}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "nic" })}
            >
              <Plus className="mr-1 size-3.5" />
              {t("hardware.nic.add")}
            </Button>
          }
        />
        {adapters.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            {t("hardware.nic.none")}
          </p>
        )}
        {adapters.map((nic) => {
          const v = nic.props.values;
          const summary = qemu
            ? `${qemuNicModel(nic).model} ${qemuNicModel(nic).mac}, ${v.bridge ?? "-"}`
            : `${v.name ?? "-"}, ${v.bridge ?? "-"}, ${v.ip ?? t("hardware.nic.ip.none")}`;
          return (
            <Row
              key={nic.key}
              label={nic.key}
              value={`${summary}${v.tag ? `, VLAN ${v.tag}` : ""}${v.firewall === "1" ? `, ${t("hardware.nic.firewallShort")}` : ""}`}
              pending={pending.has(nic.key)}
              actions={
                <RowMenu
                  items={[
                    {
                      label: t("hardware.edit"),
                      run: () => setDialog({ kind: "nic", nic }),
                    },
                    {
                      label: t("hardware.remove"),
                      danger: true,
                      run: () =>
                        void remove(
                          nic.key,
                          t("hardware.nic.removeTitle", { key: nic.key }),
                          t("hardware.nic.removeDescription"),
                        ),
                    },
                  ]}
                />
              }
            />
          );
        })}
      </div>

      {pending.size > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("hardware.pendingHint")}
        </p>
      )}

      {dialog?.kind === "cpu" && <CpuMemoryDialog {...dialogProps} />}
      {dialog?.kind === "addDisk" && <AddDiskDialog {...dialogProps} />}
      {dialog?.kind === "resize" && (
        <ResizeDialog
          guest={guest}
          disk={dialog.disk}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          guest={guest}
          disk={dialog.disk}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "nic" && (
        <NicDialog {...dialogProps} nic={dialog.nic} />
      )}
      {dialog?.kind === "cd" && (
        <CdDialog {...dialogProps} drive={dialog.drive} />
      )}
    </div>
  );
}

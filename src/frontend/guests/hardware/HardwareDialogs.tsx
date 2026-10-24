import { useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { pve } from "../../api";
import { useTasks } from "../../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../../components/forms";
import { BridgePicker, StoragePicker } from "../../components/pickers";
import { listVolumes, useLoad, volumeName } from "../lookups";
import {
  nextFreeKey,
  nextQemuDiskKey,
  parseProps,
  qemuNicModel,
  sizeToGiB,
  type GuestConfig,
  type GuestDisk,
  type GuestNic,
  type QemuBus,
} from "../config";
import { guestPath, setConfig, type GuestRef } from "../useGuestConfig";
import {
  lxcCpuMemChanges,
  lxcCpuMemProblem,
  lxcMountProblem,
  lxcMountValue,
  lxcNicForm,
  lxcNicProblem,
  lxcNicValue,
  moveParams,
  qemuCpuMemChanges,
  qemuCpuMemProblem,
  qemuDiskValue,
  qemuNicProblem,
  qemuNicValue,
  resizeParams,
  type LxcNicForm,
} from "./params";

const num = (value: string) => (value.trim() === "" ? NaN : Number(value));

interface DialogProps {
  guest: GuestRef;
  config: GuestConfig;
  onDone: () => void;
  onClose: () => void;
}

function Problem({ problem }: { problem: string | null }) {
  const { t } = useTranslation();
  if (!problem) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {t(`hardware.problem.${problem}`)}
    </p>
  );
}

const CPU_TYPES = ["host", "x86-64-v2-AES", "x86-64-v3", "kvm64", "qemu64"];

export function CpuMemoryDialog({
  guest,
  config,
  onDone,
  onClose,
}: DialogProps) {
  const { t } = useTranslation();
  const qemu = guest.type === "qemu";
  const memory = Number(config.memory ?? 512);
  const [sockets, setSockets] = useState(String(config.sockets ?? 1));
  // A container without cores uses every core; an empty field keeps that.
  const [cores, setCores] = useState(
    config.cores !== undefined ? String(config.cores) : qemu ? "1" : "",
  );
  const [cpu, setCpu] = useState(String(config.cpu ?? "kvm64").split(",")[0]);
  const [mem, setMem] = useState(String(memory));
  const [balloon, setBalloon] = useState(String(config.balloon ?? memory));
  const [cpulimit, setCpulimit] = useState(String(config.cpulimit ?? 0));
  const [swap, setSwap] = useState(String(config.swap ?? 512));

  const qemuForm = {
    sockets: num(sockets),
    cores: num(cores),
    cpu,
    memoryMiB: num(mem),
    balloonMiB: num(balloon),
  };
  const lxcForm = {
    cores: cores.trim() === "" ? null : num(cores),
    cpulimit: num(cpulimit),
    memoryMiB: num(mem),
    swapMiB: num(swap),
  };
  const problem = qemu
    ? qemuCpuMemProblem(qemuForm)
    : lxcCpuMemProblem(lxcForm);
  const cpuTypes = CPU_TYPES.includes(cpu) ? CPU_TYPES : [cpu, ...CPU_TYPES];

  return (
    <FormDialog
      title={t("hardware.cpuMemory.title")}
      submitLabel={t("app.save")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        await setConfig(
          guest,
          qemu ? qemuCpuMemChanges(qemuForm) : lxcCpuMemChanges(lxcForm),
          config.digest,
        );
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            {qemu && (
              <Field
                label={t("guests.fields.sockets")}
                error={fieldError("sockets")}
              >
                <TextInput
                  type="number"
                  value={sockets}
                  onChange={setSockets}
                  min={1}
                />
              </Field>
            )}
            <Field
              label={t("guests.fields.cores")}
              hint={qemu ? undefined : t("hardware.coresHint")}
              error={fieldError("cores")}
            >
              <TextInput
                type="number"
                value={cores}
                onChange={setCores}
                min={1}
              />
            </Field>
            {qemu ? (
              <Field label={t("hardware.cpuType")} error={fieldError("cpu")}>
                <SelectInput
                  value={cpu}
                  onChange={setCpu}
                  options={cpuTypes.map((v) => ({ value: v, label: v }))}
                />
              </Field>
            ) : (
              <Field
                label={t("hardware.cpulimit")}
                hint={t("hardware.cpulimitHint")}
                error={fieldError("cpulimit")}
              >
                <TextInput
                  type="number"
                  value={cpulimit}
                  onChange={setCpulimit}
                  min={0}
                />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("guests.fields.memoryMiB")}
              error={fieldError("memory")}
            >
              <TextInput type="number" value={mem} onChange={setMem} min={16} />
            </Field>
            {qemu ? (
              <Field
                label={t("hardware.balloon")}
                hint={t("hardware.balloonHint")}
                error={fieldError("balloon")}
              >
                <TextInput
                  type="number"
                  value={balloon}
                  onChange={setBalloon}
                  min={0}
                />
              </Field>
            ) : (
              <Field
                label={t("guests.fields.swapMiB")}
                error={fieldError("swap")}
              >
                <TextInput
                  type="number"
                  value={swap}
                  onChange={setSwap}
                  min={0}
                />
              </Field>
            )}
          </div>
          <Problem problem={problem} />
        </>
      )}
    </FormDialog>
  );
}

const BUSES: QemuBus[] = ["scsi", "virtio", "sata", "ide"];

export function AddDiskDialog({ guest, config, onDone, onClose }: DialogProps) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const qemu = guest.type === "qemu";
  const [bus, setBus] = useState<QemuBus>("scsi");
  const [storage, setStorage] = useState("");
  const [size, setSize] = useState("8");
  const [path, setPath] = useState("/data");
  const [iothread, setIothread] = useState(true);
  const [discard, setDiscard] = useState(true);
  const [ssd, setSsd] = useState(false);
  const [backup, setBackup] = useState(true);

  const key = qemu
    ? nextQemuDiskKey(config, bus)
    : nextFreeKey(config, "mp", 255);
  const mount = { storage, sizeGiB: num(size), path, backup };
  const problem = !key
    ? "noSlot"
    : !storage
      ? "storage"
      : !(Number.isInteger(num(size)) && num(size) > 0)
        ? "size"
        : qemu
          ? null
          : lxcMountProblem(mount);

  return (
    <FormDialog
      title={t(qemu ? "hardware.addDisk.title" : "hardware.addMount.title")}
      submitLabel={t("hardware.add")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const value = qemu
          ? qemuDiskValue({
              bus,
              storage,
              sizeGiB: num(size),
              iothread,
              discard,
              ssd,
            })
          : lxcMountValue(mount);
        const result = await setConfig(guest, { [key!]: value }, config.digest);
        // The task list follows it; the dialog doesn't wait for it.
        void track(result, t("hardware.addDisk.label", { key })).then(onDone);
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          {qemu && (
            <Field
              label={t("hardware.bus")}
              hint={key ? t("hardware.slot", { key }) : undefined}
            >
              <SelectInput
                value={bus}
                onChange={(v) => setBus(v as QemuBus)}
                options={BUSES.map((b) => ({
                  value: b,
                  label: b.toUpperCase(),
                }))}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <StoragePicker
              hostId={guest.hostId}
              node={guest.node}
              content={qemu ? "images" : "rootdir"}
              value={storage}
              onChange={setStorage}
              error={key ? fieldError(key) : undefined}
            />
            <Field label={t("guests.fields.diskGiB")}>
              <TextInput
                type="number"
                value={size}
                onChange={setSize}
                min={1}
              />
            </Field>
          </div>
          {qemu ? (
            <div className="flex flex-col gap-2">
              <CheckField
                label={t("hardware.iothread")}
                checked={iothread}
                onChange={setIothread}
              />
              <CheckField
                label={t("hardware.discard")}
                hint={t("hardware.discardHint")}
                checked={discard}
                onChange={setDiscard}
              />
              <CheckField
                label={t("hardware.ssd")}
                checked={ssd}
                onChange={setSsd}
              />
            </div>
          ) : (
            <>
              <Field label={t("hardware.mountPath")}>
                <TextInput
                  value={path}
                  onChange={setPath}
                  placeholder="/data"
                />
              </Field>
              <CheckField
                label={t("hardware.backup")}
                checked={backup}
                onChange={setBackup}
              />
            </>
          )}
          <Problem problem={problem} />
        </>
      )}
    </FormDialog>
  );
}

export function ResizeDialog({
  guest,
  disk,
  onDone,
  onClose,
}: Omit<DialogProps, "config"> & { disk: GuestDisk }) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [grow, setGrow] = useState("8");
  const current = sizeToGiB(disk.size ?? undefined);
  const amount = num(grow);
  const ok = Number.isInteger(amount) && amount > 0;
  return (
    <FormDialog
      title={t("hardware.resize.title", { key: disk.key })}
      submitLabel={t("hardware.resize.submit")}
      canSubmit={ok}
      onClose={onClose}
      onSubmit={async () => {
        const result = await pve(
          guest.hostId,
          "PUT",
          guestPath(guest, "resize"),
          resizeParams(disk.key, amount),
        );
        // The task list follows it; the dialog doesn't wait for it.
        void track(
          result,
          t("hardware.resize.label", { key: disk.key, size: amount }),
        ).then(onDone);
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          <Field
            label={t("hardware.resize.grow")}
            hint={
              current !== null && ok
                ? t("hardware.resize.result", {
                    from: current,
                    to: +(current + amount).toFixed(2),
                  })
                : undefined
            }
            error={fieldError("size")}
          >
            <TextInput type="number" value={grow} onChange={setGrow} min={1} />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            {t("hardware.resize.noShrink")}
          </p>
        </>
      )}
    </FormDialog>
  );
}

export function MoveDialog({
  guest,
  disk,
  onDone,
  onClose,
}: Omit<DialogProps, "config"> & { disk: GuestDisk }) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const qemu = guest.type === "qemu";
  const [storage, setStorage] = useState("");
  const [deleteSource, setDeleteSource] = useState(true);
  return (
    <FormDialog
      title={t("hardware.move.title", { key: disk.key })}
      submitLabel={t("hardware.move.submit")}
      canSubmit={!!storage && storage !== disk.volume.split(":")[0]}
      onClose={onClose}
      onSubmit={async () => {
        const result = await pve(
          guest.hostId,
          "POST",
          guestPath(guest, qemu ? "move_disk" : "move_volume"),
          moveParams(guest.type, disk.key, storage, deleteSource),
        );
        // The task list follows it; the dialog doesn't wait for it.
        void track(
          result,
          t("hardware.move.label", { key: disk.key, storage }),
        ).then(onDone);
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          <StoragePicker
            hostId={guest.hostId}
            node={guest.node}
            content={qemu ? "images" : "rootdir"}
            value={storage}
            onChange={setStorage}
            error={fieldError("storage")}
            label={t("guests.fields.targetStorage")}
          />
          <CheckField
            label={t("hardware.move.deleteSource")}
            hint={t("hardware.move.deleteSourceHint")}
            checked={deleteSource}
            onChange={setDeleteSource}
          />
        </>
      )}
    </FormDialog>
  );
}

const MODELS = ["virtio", "e1000", "e1000e", "vmxnet3", "rtl8139"];

export function NicDialog({
  guest,
  config,
  nic,
  onDone,
  onClose,
}: DialogProps & { nic?: GuestNic }) {
  const { t } = useTranslation();
  const qemu = guest.type === "qemu";
  const key = nic?.key ?? nextFreeKey(config, "net", 31);
  const keep = nic?.props.values ?? {};
  const current = nic && qemu ? qemuNicModel(nic) : null;

  const [model, setModel] = useState(current?.model ?? "virtio");
  const [bridge, setBridge] = useState(keep.bridge ?? "");
  const [tag, setTag] = useState(keep.tag ?? "");
  const [firewall, setFirewall] = useState(keep.firewall === "1");
  const [rate, setRate] = useState(keep.rate ?? "");
  const [lxc, setLxc] = useState<LxcNicForm>(() =>
    lxcNicForm({
      name: `eth${key?.replace("net", "") ?? 0}`,
      ip: "dhcp",
      ...keep,
    }),
  );

  const qemuForm = {
    model,
    mac: current?.mac ?? "",
    bridge,
    tag,
    firewall,
    rate,
  };
  const lxcForm = { ...lxc, bridge, tag, firewall };
  const problem = !key
    ? "noSlot"
    : qemu
      ? qemuNicProblem(qemuForm)
      : lxcNicProblem(lxcForm);
  const set = (patch: Partial<LxcNicForm>) =>
    setLxc((f) => ({ ...f, ...patch }));

  return (
    <FormDialog
      title={t(nic ? "hardware.nic.editTitle" : "hardware.nic.addTitle", {
        key,
      })}
      submitLabel={t(nic ? "app.save" : "hardware.add")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        await setConfig(
          guest,
          {
            [key!]: qemu
              ? qemuNicValue(qemuForm, keep)
              : lxcNicValue(lxcForm, keep),
          },
          config.digest,
        );
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          {qemu ? (
            <Field label={t("hardware.nic.model")}>
              <SelectInput
                value={model}
                onChange={setModel}
                options={MODELS.map((m) => ({ value: m, label: m }))}
              />
            </Field>
          ) : (
            <Field label={t("hardware.nic.name")}>
              <TextInput
                value={lxc.name}
                onChange={(name) => set({ name })}
                placeholder="eth0"
              />
            </Field>
          )}
          <BridgePicker
            hostId={guest.hostId}
            node={guest.node}
            value={bridge}
            onChange={setBridge}
            error={key ? fieldError(key) : undefined}
          />
          {!qemu && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label={t("guests.fields.ipv4")}>
                  <SelectInput
                    value={lxc.ip4}
                    onChange={(v) => set({ ip4: v as LxcNicForm["ip4"] })}
                    options={["dhcp", "static", "none"].map((v) => ({
                      value: v,
                      label: t(`hardware.nic.ip.${v}`),
                    }))}
                  />
                </Field>
                {lxc.ip4 === "static" && (
                  <>
                    <Field label={t("guests.fields.cidr")}>
                      <TextInput
                        value={lxc.cidr4}
                        onChange={(cidr4) => set({ cidr4 })}
                        placeholder="192.168.0.60/24"
                      />
                    </Field>
                    <Field label={t("guests.fields.gateway")}>
                      <TextInput
                        value={lxc.gw4}
                        onChange={(gw4) => set({ gw4 })}
                        placeholder="192.168.0.1"
                      />
                    </Field>
                  </>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label={t("hardware.nic.ipv6")}>
                  <SelectInput
                    value={lxc.ip6}
                    onChange={(v) => set({ ip6: v as LxcNicForm["ip6"] })}
                    options={["none", "dhcp", "auto", "static"].map((v) => ({
                      value: v,
                      label: t(`hardware.nic.ip.${v}`),
                    }))}
                  />
                </Field>
                {lxc.ip6 === "static" && (
                  <>
                    <Field label={t("guests.fields.cidr")}>
                      <TextInput
                        value={lxc.cidr6}
                        onChange={(cidr6) => set({ cidr6 })}
                        placeholder="fd00::10/64"
                      />
                    </Field>
                    <Field label={t("guests.fields.gateway")}>
                      <TextInput
                        value={lxc.gw6}
                        onChange={(gw6) => set({ gw6 })}
                      />
                    </Field>
                  </>
                )}
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("hardware.nic.tag")}
              hint={t("hardware.nic.tagHint")}
            >
              <TextInput
                type="number"
                value={tag}
                onChange={setTag}
                min={1}
                max={4094}
              />
            </Field>
            {qemu && (
              <Field
                label={t("hardware.nic.rate")}
                hint={t("hardware.nic.rateHint")}
              >
                <TextInput
                  type="number"
                  value={rate}
                  onChange={setRate}
                  min={0}
                />
              </Field>
            )}
          </div>
          <CheckField
            label={t("hardware.nic.firewall")}
            checked={firewall}
            onChange={setFirewall}
          />
          <Problem problem={problem} />
        </>
      )}
    </FormDialog>
  );
}

export function CdDialog({
  guest,
  config,
  drive,
  onDone,
  onClose,
}: DialogProps & { drive: string }) {
  const { t } = useTranslation();
  const isos = useLoad(
    () => listVolumes(guest.hostId, guest.node, "iso"),
    [guest.hostId, guest.node],
  );
  const current = parseProps(config[drive]);
  const [media, setMedia] = useState(
    current.head && current.head !== "none" ? current.head : "",
  );
  return (
    <FormDialog
      title={t("hardware.cd.title", { key: drive })}
      submitLabel={t("app.save")}
      onClose={onClose}
      onSubmit={async () => {
        await setConfig(
          guest,
          { [drive]: `${media || "none"},media=cdrom` },
          config.digest,
        );
        onDone();
      }}
    >
      {(fieldError) => (
        <Field label={t("guests.fields.iso")} error={fieldError(drive)}>
          <SelectInput
            value={media}
            onChange={setMedia}
            placeholder={t("hardware.cd.empty")}
            options={(isos.data ?? []).map((v) => ({
              value: v.volid,
              label: volumeName(v.volid),
            }))}
          />
        </Field>
      )}
    </FormDialog>
  );
}

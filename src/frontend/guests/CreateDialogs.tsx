import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { PasswordInput, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { pve } from "../api";
import { useTasks } from "../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import {
  listBridges,
  listNodes,
  listStorages,
  listVolumes,
  nextVmid,
  useLoad,
  volumeName,
} from "./lookups";
import {
  ctCreateParams,
  ctFormProblem,
  vmCreateParams,
  vmFormProblem,
  type NetworkForm,
  type VmOsType,
} from "./params";

const num = (value: string) => (value.trim() === "" ? NaN : Number(value));

function useNodeAndId(hostId: number, defaultNode: string) {
  const nodes = useLoad(() => listNodes(hostId), [hostId]);
  const suggested = useLoad(() => nextVmid(hostId), [hostId]);
  const [node, setNode] = useState(defaultNode);
  const [vmid, setVmid] = useState("");
  return {
    nodes: nodes.data ?? [defaultNode],
    node,
    setNode,
    vmidText: vmid || String(suggested.data ?? ""),
    setVmid,
    vmid: num(vmid || String(suggested.data ?? "")),
  };
}

function NodeAndId({
  ids,
  fieldError,
}: {
  ids: ReturnType<typeof useNodeAndId>;
  fieldError: (key: string) => string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t("guests.fields.node")}>
        <SelectInput
          value={ids.node}
          onChange={ids.setNode}
          options={ids.nodes.map((n) => ({ value: n, label: n }))}
        />
      </Field>
      <Field label={t("guests.fields.vmid")} error={fieldError("vmid")}>
        <TextInput
          type="number"
          value={ids.vmidText}
          onChange={ids.setVmid}
          min={100}
        />
      </Field>
    </div>
  );
}

function NetworkFields({
  hostId,
  node,
  net,
  onChange,
  withIp,
  fieldError,
}: {
  hostId: number;
  node: string;
  net: NetworkForm;
  onChange: (net: NetworkForm) => void;
  withIp: boolean;
  fieldError: (key: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const bridges = useLoad(() => listBridges(hostId, node), [hostId, node]);
  const bridge = net.bridge || bridges.data?.[0] || "";
  // Fill the first bridge in once the list arrives.
  useEffect(() => {
    if (!net.bridge && bridges.data?.[0])
      onChange({ ...net, bridge: bridges.data[0] });
    // Only when the list changes; net and onChange are the caller's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridges.data]);
  return (
    <>
      <Field label={t("guests.fields.bridge")} error={fieldError("net0")}>
        <SelectInput
          value={bridge}
          onChange={(value) => onChange({ ...net, bridge: value })}
          options={(bridges.data ?? []).map((b) => ({ value: b, label: b }))}
        />
      </Field>
      {withIp && (
        <>
          <Field label={t("guests.fields.ipv4")}>
            <SelectInput
              value={net.mode}
              onChange={(value) =>
                onChange({ ...net, mode: value as NetworkForm["mode"] })
              }
              options={[
                { value: "dhcp", label: t("guests.fields.dhcp") },
                { value: "static", label: t("guests.fields.static") },
              ]}
            />
          </Field>
          {net.mode === "static" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("guests.fields.cidr")}>
                <TextInput
                  value={net.cidr}
                  onChange={(cidr) => onChange({ ...net, cidr })}
                  placeholder="192.168.0.60/24"
                />
              </Field>
              <Field label={t("guests.fields.gateway")}>
                <TextInput
                  value={net.gateway}
                  onChange={(gateway) => onChange({ ...net, gateway })}
                  placeholder="192.168.0.1"
                />
              </Field>
            </div>
          )}
        </>
      )}
    </>
  );
}

function StorageField({
  hostId,
  node,
  content,
  value,
  onChange,
  error,
}: {
  hostId: number;
  node: string;
  content: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const storages = useLoad(
    () => listStorages(hostId, node, content),
    [hostId, node, content],
  );
  return (
    <Field label={t("guests.fields.storage")} error={error}>
      <SelectInput
        value={value}
        onChange={onChange}
        placeholder={t("guests.fields.pick")}
        options={(storages.data ?? []).map((s) => ({
          value: s.storage,
          label: s.storage,
        }))}
      />
    </Field>
  );
}

export function CreateCtDialog({
  hostId,
  node,
  onClose,
}: {
  hostId: number;
  node: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const ids = useNodeAndId(hostId, node);
  const templates = useLoad(
    () => listVolumes(hostId, ids.node, "vztmpl"),
    [hostId, ids.node],
  );
  const [hostname, setHostname] = useState("");
  const [template, setTemplate] = useState("");
  const [password, setPassword] = useState("");
  const [sshKeys, setSshKeys] = useState("");
  const [unprivileged, setUnprivileged] = useState(true);
  const [storage, setStorage] = useState("");
  const [disk, setDisk] = useState("8");
  const [cores, setCores] = useState("1");
  const [memory, setMemory] = useState("512");
  const [swap, setSwap] = useState("512");
  const [net, setNet] = useState<NetworkForm>({
    bridge: "",
    mode: "dhcp",
    cidr: "",
    gateway: "",
  });
  const [start, setStart] = useState(true);

  const form = {
    vmid: ids.vmid,
    hostname,
    template,
    password,
    sshKeys,
    unprivileged,
    storage,
    diskGiB: num(disk),
    cores: num(cores),
    memoryMiB: num(memory),
    swapMiB: num(swap),
    net,
    start,
  };
  const problem = ctFormProblem(form);

  return (
    <FormDialog
      title={t("guests.create.ctTitle")}
      submitLabel={t("guests.create.submit")}
      canSubmit={!problem}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", ids.node, "lxc"],
          ctCreateParams(form),
        );
        void track(
          upid,
          t("guests.create.ctLabel", { id: form.vmid, name: hostname }),
        );
      }}
    >
      {(fieldError) => (
        <>
          <NodeAndId ids={ids} fieldError={fieldError} />
          <Field
            label={t("guests.fields.hostname")}
            error={fieldError("hostname")}
          >
            <TextInput
              value={hostname}
              onChange={setHostname}
              placeholder="web-01"
            />
          </Field>
          <Field
            label={t("guests.fields.template")}
            error={fieldError("ostemplate")}
            hint={
              templates.data?.length === 0
                ? t("guests.create.noTemplates")
                : undefined
            }
          >
            <SelectInput
              value={template}
              onChange={setTemplate}
              placeholder={t("guests.fields.pick")}
              options={(templates.data ?? []).map((v) => ({
                value: v.volid,
                label: volumeName(v.volid),
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("guests.fields.rootPassword")}
              error={fieldError("password")}
            >
              <PasswordInput
                className="h-8 text-xs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <CheckField
              label={t("guests.fields.unprivileged")}
              hint={t("guests.create.unprivilegedHint")}
              checked={unprivileged}
              onChange={setUnprivileged}
            />
          </div>
          <Field
            label={t("guests.fields.sshKeys")}
            hint={t("guests.create.loginHint")}
            error={fieldError("ssh-public-keys")}
          >
            <Textarea
              className="h-16 font-mono text-[11px]"
              value={sshKeys}
              onChange={(e) => setSshKeys(e.target.value)}
              placeholder="ssh-ed25519 AAAA..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <StorageField
              hostId={hostId}
              node={ids.node}
              content="rootdir"
              value={storage}
              onChange={setStorage}
              error={fieldError("rootfs")}
            />
            <Field label={t("guests.fields.diskGiB")}>
              <TextInput
                type="number"
                value={disk}
                onChange={setDisk}
                min={1}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("guests.fields.cores")} error={fieldError("cores")}>
              <TextInput
                type="number"
                value={cores}
                onChange={setCores}
                min={1}
              />
            </Field>
            <Field
              label={t("guests.fields.memoryMiB")}
              error={fieldError("memory")}
            >
              <TextInput
                type="number"
                value={memory}
                onChange={setMemory}
                min={16}
              />
            </Field>
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
          </div>
          <NetworkFields
            hostId={hostId}
            node={ids.node}
            net={net}
            onChange={setNet}
            withIp
            fieldError={fieldError}
          />
          <CheckField
            label={t("guests.fields.startAfter")}
            checked={start}
            onChange={setStart}
          />
          {problem && (
            <p className="text-[11px] text-muted-foreground">
              {t(`guests.create.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

const OS_TYPES: VmOsType[] = ["l26", "win11", "win10", "other"];

export function CreateVmDialog({
  hostId,
  node,
  onClose,
}: {
  hostId: number;
  node: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const ids = useNodeAndId(hostId, node);
  const isos = useLoad(
    () => listVolumes(hostId, ids.node, "iso"),
    [hostId, ids.node],
  );
  const [name, setName] = useState("");
  const [ostype, setOstype] = useState<VmOsType>("l26");
  const [iso, setIso] = useState("");
  const [storage, setStorage] = useState("");
  const [disk, setDisk] = useState("32");
  const [sockets, setSockets] = useState("1");
  const [cores, setCores] = useState("2");
  const [memory, setMemory] = useState("2048");
  const [net, setNet] = useState<NetworkForm>({
    bridge: "",
    mode: "dhcp",
    cidr: "",
    gateway: "",
  });
  const [start, setStart] = useState(false);

  const form = {
    vmid: ids.vmid,
    name,
    ostype,
    iso,
    storage,
    diskGiB: num(disk),
    sockets: num(sockets),
    cores: num(cores),
    memoryMiB: num(memory),
    bridge: net.bridge,
    start,
  };
  const problem = vmFormProblem(form);

  return (
    <FormDialog
      title={t("guests.create.vmTitle")}
      submitLabel={t("guests.create.submit")}
      canSubmit={!problem}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", ids.node, "qemu"],
          vmCreateParams(form),
        );
        void track(upid, t("guests.create.vmLabel", { id: form.vmid, name }));
      }}
    >
      {(fieldError) => (
        <>
          <NodeAndId ids={ids} fieldError={fieldError} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("guests.fields.name")} error={fieldError("name")}>
              <TextInput value={name} onChange={setName} placeholder="vm-01" />
            </Field>
            <Field
              label={t("guests.fields.ostype")}
              error={fieldError("ostype")}
            >
              <SelectInput
                value={ostype}
                onChange={(value) => setOstype(value as VmOsType)}
                options={OS_TYPES.map((value) => ({
                  value,
                  label: t(`guests.ostype.${value}`),
                }))}
              />
            </Field>
          </div>
          <Field label={t("guests.fields.iso")} error={fieldError("ide2")}>
            <SelectInput
              value={iso}
              onChange={setIso}
              placeholder={t("guests.create.noIso")}
              options={(isos.data ?? []).map((v) => ({
                value: v.volid,
                label: volumeName(v.volid),
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <StorageField
              hostId={hostId}
              node={ids.node}
              content="images"
              value={storage}
              onChange={setStorage}
              error={fieldError("scsi0")}
            />
            <Field label={t("guests.fields.diskGiB")}>
              <TextInput
                type="number"
                value={disk}
                onChange={setDisk}
                min={1}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
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
            <Field label={t("guests.fields.cores")} error={fieldError("cores")}>
              <TextInput
                type="number"
                value={cores}
                onChange={setCores}
                min={1}
              />
            </Field>
            <Field
              label={t("guests.fields.memoryMiB")}
              error={fieldError("memory")}
            >
              <TextInput
                type="number"
                value={memory}
                onChange={setMemory}
                min={16}
              />
            </Field>
          </div>
          <NetworkFields
            hostId={hostId}
            node={ids.node}
            net={net}
            onChange={setNet}
            withIp={false}
            fieldError={fieldError}
          />
          <CheckField
            label={t("guests.fields.startAfter")}
            checked={start}
            onChange={setStart}
          />
          {problem && (
            <p className="text-[11px] text-muted-foreground">
              {t(`guests.create.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

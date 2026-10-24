import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, GroupHeading, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { Pencil } from "lucide-react";
import { pve } from "../api";
import { Fact } from "../components/Usage";
import { Field, FormDialog, SelectInput, TextInput } from "../components/forms";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";
import { CertificatesSection } from "./Certificates";
import {
  dnsForm,
  dnsParams,
  dnsProblem,
  nodeClock,
  timeZones,
  type DnsForm,
  type NodeDns,
  type NodeTime,
} from "./system";

/** DNS, /etc/hosts, time zone and certificates of a node, as Proxmox's System menu. */
export function SystemTab(props: NodeTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <DnsSection {...props} />
      <TimeSection {...props} />
      <HostsSection {...props} />
      <CertificatesSection {...props} />
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button size="sm" variant="outline" className="h-7" onClick={onClick}>
      <Pencil className="mr-1 size-3" />
      {t("app.edit")}
    </Button>
  );
}

function DnsSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error, load } = useNodeData<NodeDns>(
    hostId,
    ["nodes", node, "dns"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.system.dns.title")}
        action={data ? <EditButton onClick={() => setEditing(true)} /> : null}
      />
      <State error={error} loading={!data && !error} />
      {data && (
        <>
          <Fact label={t("nodes.system.dns.search")}>{data.search || "-"}</Fact>
          {(["dns1", "dns2", "dns3"] as const).map((key, i) => (
            <Fact key={key} label={t("nodes.system.dns.server", { n: i + 1 })}>
              {data[key] || "-"}
            </Fact>
          ))}
        </>
      )}
      {editing && data && (
        <DnsDialog
          hostId={hostId}
          node={node}
          dns={data}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </section>
  );
}

function DnsDialog({
  hostId,
  node,
  dns,
  onClose,
  onSaved,
}: {
  hostId: number;
  node: string;
  dns: NodeDns;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<DnsForm>(() => dnsForm(dns));
  const problem = dnsProblem(form);
  const setServer = (i: number, value: string) =>
    setForm((f) => {
      const servers = [...f.servers] as DnsForm["servers"];
      servers[i] = value;
      return { ...f, servers };
    });
  return (
    <FormDialog
      title={t("nodes.system.dns.editTitle", { node })}
      submitLabel={t("app.save")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "PUT", ["nodes", node, "dns"], dnsParams(form));
        toast.success(t("nodes.system.dns.saved"));
        onSaved();
      }}
    >
      {(fieldError) => (
        <>
          <Field
            label={t("nodes.system.dns.search")}
            error={fieldError("search")}
          >
            <TextInput
              value={form.search}
              onChange={(search) => setForm((f) => ({ ...f, search }))}
              placeholder="example.com"
            />
          </Field>
          {form.servers.map((value, i) => (
            <Field
              key={i}
              label={t("nodes.system.dns.server", { n: i + 1 })}
              error={fieldError(`dns${i + 1}`)}
            >
              <TextInput
                value={value}
                onChange={(v) => setServer(i, v)}
                placeholder={i === 0 ? "1.1.1.1" : ""}
              />
            </Field>
          ))}
          {problem && (
            <p className="text-[11px] text-destructive">
              {t(`nodes.system.dns.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

function TimeSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error, load } = useNodeData<NodeTime>(
    hostId,
    ["nodes", node, "time"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.system.time.title")}
        action={data ? <EditButton onClick={() => setEditing(true)} /> : null}
      />
      <State error={error} loading={!data && !error} />
      {data && (
        <>
          <Fact label={t("nodes.system.time.zone")}>{data.timezone}</Fact>
          <Fact label={t("nodes.system.time.local")}>{nodeClock(data)}</Fact>
        </>
      )}
      {editing && data && (
        <TimeDialog
          hostId={hostId}
          node={node}
          current={data.timezone}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </section>
  );
}

function TimeDialog({
  hostId,
  node,
  current,
  onClose,
  onSaved,
}: {
  hostId: number;
  node: string;
  current: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [zone, setZone] = useState(current);
  return (
    <FormDialog
      title={t("nodes.system.time.editTitle", { node })}
      submitLabel={t("app.save")}
      canSubmit={!!zone && zone !== current}
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "PUT", ["nodes", node, "time"], { timezone: zone });
        toast.success(t("nodes.system.time.saved", { zone }));
        onSaved();
      }}
    >
      {() => (
        <Field
          label={t("nodes.system.time.zone")}
          hint={t("nodes.system.time.hint")}
        >
          <SelectInput
            value={zone}
            onChange={setZone}
            options={timeZones(current).map((z) => ({ value: z, label: z }))}
          />
        </Field>
      )}
    </FormDialog>
  );
}

function HostsSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error, load } = useNodeData<{ data: string; digest: string }>(
    hostId,
    ["nodes", node, "hosts"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.system.hosts.title")}
        action={data ? <EditButton onClick={() => setEditing(true)} /> : null}
      />
      <State error={error} loading={!data && !error} />
      {data && (
        <pre className="max-h-64 overflow-auto border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
          {data.data}
        </pre>
      )}
      {editing && data && (
        <HostsDialog
          hostId={hostId}
          node={node}
          hosts={data}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </section>
  );
}

function HostsDialog({
  hostId,
  node,
  hosts,
  onClose,
  onSaved,
}: {
  hostId: number;
  node: string;
  hosts: { data: string; digest: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState(hosts.data);
  return (
    <FormDialog
      title={t("nodes.system.hosts.editTitle", { node })}
      submitLabel={t("app.save")}
      canSubmit={text.trim().length > 0 && text !== hosts.data}
      wide
      onClose={onClose}
      onSubmit={async () => {
        // The digest makes PVE refuse a file someone changed meanwhile.
        await pve(hostId, "POST", ["nodes", node, "hosts"], {
          data: text.endsWith("\n") ? text : `${text}\n`,
          digest: hosts.digest,
        });
        toast.success(t("nodes.system.hosts.saved"));
        onSaved();
      }}
    >
      {() => (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("nodes.system.hosts.warning")}
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-72 font-mono text-[11px]"
          />
        </>
      )}
    </FormDialog>
  );
}

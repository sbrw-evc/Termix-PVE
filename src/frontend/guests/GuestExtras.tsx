import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button, Input } from "@termix-ssh/plugin-sdk/ui";
import { Send } from "lucide-react";
import { pve, toCallError, type PveParams } from "../api";
import { CrudSection, paramsFrom, type FieldSpec } from "../datacenter/crud";
import { nextReplicationId } from "../datacenter/ReplicationPanel";
import { AclSection } from "../datacenter/AccessPanel";

export interface GuestRef {
  hostId: number;
  node: string;
  type: "qemu" | "lxc";
  vmid: number;
}

interface ReplicationJob extends Record<string, unknown> {
  id: string;
  guest: number;
  target: string;
  schedule?: string;
  rate?: number;
  comment?: string;
  disable?: number;
}

/** This guest's replication jobs, as Proxmox's guest > Replication. */
export function GuestReplicationTab({
  guest,
  isVisible,
}: {
  guest: GuestRef;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<string[]>([]);
  const [jobs, setJobs] = useState<ReplicationJob[]>([]);

  useEffect(() => {
    if (!isVisible) return;
    pve<Array<{ node: string; status?: string }>>(guest.hostId, "GET", [
      "nodes",
    ]).then(
      (list) =>
        setNodes(
          (list ?? [])
            .filter((n) => n.node !== guest.node && n.status === "online")
            .map((n) => n.node),
        ),
      () => setNodes([]),
    );
  }, [guest.hostId, guest.node, isVisible]);

  const fields: FieldSpec[] = [
    {
      key: "target",
      labelKey: "replication.target",
      kind: "select",
      required: true,
      createOnly: true,
      options: nodes.map((value) => ({ value })),
    },
    {
      key: "schedule",
      labelKey: "replication.schedule",
      hintKey: "replication.scheduleHint",
      default: "*/15",
    },
    {
      key: "rate",
      labelKey: "replication.rate",
      hintKey: "replication.rateHint",
      kind: "number",
    },
    { key: "comment", labelKey: "replication.comment" },
    { key: "disable", labelKey: "replication.disable", kind: "check" },
  ];

  return (
    <CrudSection<ReplicationJob>
      hostId={guest.hostId}
      isVisible={isVisible}
      titleKey="replication.title"
      hintKey={nodes.length ? "replication.hint" : "replication.singleNode"}
      emptyKey="replication.none"
      listPath={["cluster", "replication"]}
      rows={(data) =>
        ((data as ReplicationJob[]) ?? []).filter(
          (j) => Number(j.guest) === guest.vmid,
        )
      }
      onLoaded={setJobs}
      rowId={(j) => j.id}
      view={(j) => ({
        title: `${j.id} → ${j.target}`,
        detail: j.comment,
        badges: (
          <>
            <Badge variant="outline">{j.schedule ?? "*/15"}</Badge>
            {j.disable ? (
              <Badge variant="secondary">{t("replication.disabled")}</Badge>
            ) : null}
          </>
        ),
      })}
      fields={fields}
      toParams={(values, creating): PveParams => {
        const params = paramsFrom(fields, values, creating);
        if (creating) {
          params.id = nextReplicationId(String(guest.vmid), jobs);
          params.type = "local";
        }
        return params;
      }}
      createPath={["cluster", "replication"]}
      itemPath={(j) => ["cluster", "replication", j.id]}
      createLabelKey="replication.add"
      deleteText={(j) => ({
        title: t("replication.deleteTitle", { id: j.id }),
        description: t("replication.deleteDescription", { target: j.target }),
      })}
    />
  );
}

/** Who may do what with this guest: the ACL entries on /vms/<id>. */
export function GuestPermissionsTab({
  guest,
  isVisible,
}: {
  guest: GuestRef;
  isVisible: boolean;
}) {
  return (
    <AclSection
      hostId={guest.hostId}
      isVisible={isVisible}
      fixedPath={`/vms/${guest.vmid}`}
    />
  );
}

interface MonitorLine {
  command: string;
  output: string;
  failed?: boolean;
}

/** The QEMU human monitor of a VM: one command at a time, its answer below. */
export function MonitorTab({ guest }: { guest: GuestRef }) {
  const { t } = useTranslation();
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<MonitorLine[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    try {
      const output = await pve<string>(
        guest.hostId,
        "POST",
        ["nodes", guest.node, "qemu", guest.vmid, "monitor"],
        { command: cmd },
      );
      setLines((prev) => [
        ...prev,
        { command: cmd, output: String(output ?? "") },
      ]);
      setCommand("");
    } catch (err) {
      setLines((prev) => [
        ...prev,
        { command: cmd, output: toCallError(err).message, failed: true },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">{t("monitor.hint")}</p>
      <pre className="h-80 overflow-auto border border-border bg-black p-2 font-mono text-[11px] leading-relaxed text-white">
        {lines.length === 0
          ? t("monitor.empty")
          : lines.map((l, i) => (
              <span key={i} className="block">
                <span className="text-emerald-400"># {l.command}</span>
                {"\n"}
                <span className={l.failed ? "text-red-400" : undefined}>
                  {l.output}
                </span>
                {"\n"}
              </span>
            ))}
      </pre>
      <form onSubmit={(e) => void run(e)} className="flex gap-2">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="info status"
          className="h-8 font-mono text-xs"
          spellCheck={false}
        />
        <Button type="submit" size="sm" disabled={busy || !command.trim()}>
          <Send className="mr-1 size-3.5" />
          {t("monitor.run")}
        </Button>
      </form>
    </div>
  );
}

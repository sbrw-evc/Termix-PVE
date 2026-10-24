import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, DropdownMenuItem } from "@termix-ssh/plugin-sdk/ui";
import { pve, toCallError } from "../api";
import { CrudSection, paramsFrom, type FieldSpec } from "./crud";
import {
  guestOptions,
  nodeNames,
  type DatacenterProps,
} from "./DatacenterView";

interface HaResource extends Record<string, unknown> {
  sid: string;
  state?: string;
  max_restart?: number;
  max_relocate?: number;
  comment?: string;
}

interface HaRule extends Record<string, unknown> {
  rule: string;
  type: "node-affinity" | "resource-affinity";
  resources: string;
  nodes?: string;
  strict?: number;
  affinity?: "positive" | "negative";
  disable?: number;
  comment?: string;
}

interface HaStatus extends Record<string, unknown> {
  id: string;
  type: string;
  status?: string;
  node?: string;
  state?: string;
  quorate?: number;
}

/** "vm:100" for a VM, "ct:101" for a container, as HA names resources. */
export function haSid(type: "qemu" | "lxc", vmid: string | number): string {
  return `${type === "qemu" ? "vm" : "ct"}:${vmid}`;
}

const SIDS_RE = /^(vm|ct):\d+(,(vm|ct):\d+)*$/;
const NODES_RE = /^[A-Za-z0-9.-]+(:\d+)?(,[A-Za-z0-9.-]+(:\d+)?)*$/;

export function HaPanel({ hostId, resources, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const nodes = nodeNames(resources);
  const guests = guestOptions(resources);

  const resourceFields: FieldSpec[] = [
    {
      key: "sid",
      labelKey: "ha.resource",
      kind: "select",
      required: true,
      createOnly: true,
      options: guests.map((g) => ({
        value: haSid(g.type, g.value),
        label: g.label,
      })),
    },
    {
      key: "state",
      labelKey: "ha.state",
      hintKey: "ha.stateHint",
      kind: "select",
      required: true,
      default: "started",
      options: ["started", "stopped", "ignored", "disabled"].map((value) => ({
        value,
        labelKey: `ha.states.${value}`,
      })),
    },
    {
      key: "max_restart",
      labelKey: "ha.maxRestart",
      kind: "number",
      placeholder: "1",
    },
    {
      key: "max_relocate",
      labelKey: "ha.maxRelocate",
      kind: "number",
      placeholder: "1",
    },
    { key: "comment", labelKey: "ha.comment" },
  ];

  const ruleFields: FieldSpec[] = [
    {
      key: "rule",
      labelKey: "ha.ruleId",
      required: true,
      createOnly: true,
      pattern: /^[A-Za-z][A-Za-z0-9_-]{1,127}$/,
      patternKey: "ha.ruleIdFormat",
    },
    {
      key: "type",
      labelKey: "ha.ruleType",
      kind: "select",
      required: true,
      createOnly: true,
      default: "node-affinity",
      options: ["node-affinity", "resource-affinity"].map((value) => ({
        value,
        labelKey: `ha.ruleTypes.${value}`,
      })),
    },
    {
      key: "resources",
      labelKey: "ha.resources",
      hintKey: "ha.resourcesHint",
      required: true,
      placeholder: "vm:100,ct:101",
      pattern: SIDS_RE,
      patternKey: "ha.resourcesFormat",
    },
    {
      key: "nodes",
      labelKey: "ha.nodes",
      hintKey: "ha.nodesHint",
      required: true,
      placeholder:
        nodes
          .slice(0, 2)
          .map((n, i) => `${n}:${2 - i}`)
          .join(",") || "pve1:2,pve2:1",
      pattern: NODES_RE,
      patternKey: "ha.nodesFormat",
      showIf: (v) => v.type === "node-affinity",
    },
    {
      key: "strict",
      labelKey: "ha.strict",
      hintKey: "ha.strictHint",
      kind: "check",
      showIf: (v) => v.type === "node-affinity",
    },
    {
      key: "affinity",
      labelKey: "ha.affinity",
      kind: "select",
      required: true,
      default: "negative",
      options: ["positive", "negative"].map((value) => ({
        value,
        labelKey: `ha.affinities.${value}`,
      })),
      showIf: (v) => v.type === "resource-affinity",
    },
    { key: "comment", labelKey: "ha.comment" },
    { key: "disable", labelKey: "ha.disable", kind: "check" },
  ];

  const migrate = async (resource: HaResource, target: string) => {
    try {
      await pve(
        hostId,
        "POST",
        ["cluster", "ha", "resources", resource.sid, "migrate"],
        { node: target },
      );
      toast.success(t("ha.migrateQueued", { sid: resource.sid, node: target }));
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <CrudSection<HaStatus>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="ha.status"
        emptyKey="ha.noStatus"
        listPath={["cluster", "ha", "status", "current"]}
        rowId={(s) => s.id}
        view={(s) => ({
          title: s.type === "service" ? s.id.replace(/^service:/, "") : s.id,
          badges: s.status ? <Badge variant="outline">{s.status}</Badge> : null,
          detail: [s.node, s.state].filter(Boolean).join(" · "),
        })}
        readOnly
      />
      <CrudSection<HaResource>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="ha.resourcesTitle"
        hintKey="ha.resourcesSectionHint"
        emptyKey="ha.noResources"
        listPath={["cluster", "ha", "resources"]}
        rowId={(r) => r.sid}
        view={(r) => ({
          title: r.sid,
          badges: (
            <Badge variant="outline">
              {t(`ha.states.${r.state ?? "started"}`, {
                defaultValue: r.state,
              })}
            </Badge>
          ),
          detail: [
            t("ha.limits", {
              restart: r.max_restart ?? 1,
              relocate: r.max_relocate ?? 1,
            }),
            r.comment,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
        fields={resourceFields}
        createLabelKey="ha.addResource"
        itemPath={(r) => ["cluster", "ha", "resources", r.sid]}
        menu={(r) =>
          nodes.length > 1
            ? nodes.map((node) => (
                <DropdownMenuItem
                  key={node}
                  onClick={() => void migrate(r, node)}
                >
                  {t("ha.migrateTo", { node })}
                </DropdownMenuItem>
              ))
            : null
        }
        deleteText={(r) => ({
          title: t("ha.removeTitle", { sid: r.sid }),
          description: t("ha.removeDescription"),
        })}
      />
      <CrudSection<HaRule>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="ha.rules"
        hintKey="ha.rulesHint"
        emptyKey="ha.noRules"
        listPath={["cluster", "ha", "rules"]}
        rowId={(r) => r.rule}
        view={(r) => ({
          title: r.rule,
          badges: (
            <>
              <Badge variant="outline">
                {t(`ha.ruleTypes.${r.type}`, { defaultValue: r.type })}
              </Badge>
              {r.disable ? (
                <Badge variant="secondary">{t("ha.disabled")}</Badge>
              ) : null}
            </>
          ),
          detail: [
            r.resources,
            r.type === "node-affinity"
              ? `${r.nodes}${r.strict ? ` (${t("ha.strict")})` : ""}`
              : t(`ha.affinities.${r.affinity ?? "negative"}`),
            r.comment,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
        fields={ruleFields}
        toParams={(values, creating) => ({
          ...paramsFrom(ruleFields, values, creating),
          // Proxmox wants the rule's type on every change, not just create.
          type: String(values.type),
        })}
        createLabelKey="ha.addRule"
        itemPath={(r) => ["cluster", "ha", "rules", r.rule]}
      />
    </div>
  );
}

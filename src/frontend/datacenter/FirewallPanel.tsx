import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenuItem,
  GroupHeading,
} from "@termix-ssh/plugin-sdk/ui";
import { Pencil } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { Fact } from "../components/Usage";
import {
  CrudSection,
  PanelDialog,
  RecordDialog,
  paramsFrom,
  useApiList,
  valuesFrom,
  type FieldSpec,
} from "./crud";
import {
  ACTIONS,
  LOG_LEVELS,
  PROTOCOLS,
  moveTarget,
  ruleParams,
  ruleSummary,
  ruleToForm,
  type FirewallRule,
  type FirewallScope,
} from "./firewall";

type Path = Array<string | number>;

const select = (values: string[], prefix?: string) =>
  values.map((value) => ({
    value,
    labelKey: prefix ? `${prefix}.${value}` : undefined,
    label: value,
  }));

function optionFields(scope: FirewallScope): FieldSpec[] {
  const enable: FieldSpec = {
    key: "enable",
    labelKey: "firewall.options.enable",
    kind: "check",
    default: scope === "node",
  };
  const policies: FieldSpec[] = [
    {
      key: "policy_in",
      labelKey: "firewall.options.policyIn",
      kind: "select",
      options: select(ACTIONS),
    },
    {
      key: "policy_out",
      labelKey: "firewall.options.policyOut",
      kind: "select",
      options: select(ACTIONS),
    },
  ];
  const logs: FieldSpec[] = [
    {
      key: "log_level_in",
      labelKey: "firewall.options.logIn",
      kind: "select",
      options: select(LOG_LEVELS),
    },
    {
      key: "log_level_out",
      labelKey: "firewall.options.logOut",
      kind: "select",
      options: select(LOG_LEVELS),
    },
  ];
  if (scope === "cluster") {
    return [
      enable,
      ...policies,
      {
        key: "ebtables",
        labelKey: "firewall.options.ebtables",
        kind: "check",
        default: true,
      },
    ];
  }
  if (scope === "node") {
    return [
      enable,
      ...logs,
      {
        key: "nosmurfs",
        labelKey: "firewall.options.nosmurfs",
        kind: "check",
        default: true,
      },
      { key: "tcpflags", labelKey: "firewall.options.tcpflags", kind: "check" },
      {
        key: "ndp",
        labelKey: "firewall.options.ndp",
        kind: "check",
        default: true,
      },
    ];
  }
  return [
    enable,
    ...policies,
    ...logs,
    {
      key: "dhcp",
      labelKey: "firewall.options.dhcp",
      kind: "check",
      default: true,
    },
    {
      key: "ndp",
      labelKey: "firewall.options.ndp",
      kind: "check",
      default: true,
    },
    { key: "radv", labelKey: "firewall.options.radv", kind: "check" },
    {
      key: "macfilter",
      labelKey: "firewall.options.macfilter",
      kind: "check",
      default: true,
    },
    { key: "ipfilter", labelKey: "firewall.options.ipfilter", kind: "check" },
  ];
}

function OptionsSection({
  hostId,
  base,
  scope,
  isVisible,
}: {
  hostId: number;
  base: Path;
  scope: FirewallScope;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const { data, error, load } = useApiList<Record<string, unknown>>(
    hostId,
    [...base, "options"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  const fields = optionFields(scope);
  const values = data ? valuesFrom(fields, data) : null;
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("firewall.options.title")}
        action={
          values ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setEditing(true)}
            >
              <Pencil className="mr-1 size-3" />
              {t("app.edit")}
            </Button>
          ) : null
        }
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {values &&
        fields.map((field) => (
          <Fact key={field.key} label={t(field.labelKey)}>
            {field.kind === "check"
              ? t(values[field.key] ? "firewall.yes" : "firewall.no")
              : String(values[field.key] || t("firewall.default"))}
          </Fact>
        ))}
      {editing && values && (
        <RecordDialog
          title={t(`firewall.options.editTitle.${scope}`)}
          fields={fields}
          initial={values}
          creating={false}
          intro={
            <p className="text-[11px] text-muted-foreground">
              {t(`firewall.options.warning.${scope}`)}
            </p>
          }
          onClose={() => setEditing(false)}
          onSubmit={async (next) => {
            // Turning the datacenter firewall on can lock every node.
            if (
              scope === "cluster" &&
              next.enable === true &&
              values.enable !== true
            ) {
              const ok = await app().confirm({
                title: t("firewall.enableTitle"),
                description: t("firewall.enableDescription"),
                confirmLabel: t("firewall.enable"),
              });
              if (!ok) throw new Error(t("firewall.notEnabled"));
            }
            await pve(
              hostId,
              "PUT",
              [...base, "options"],
              paramsFrom(fields, next, false),
            );
            void load();
          }}
        />
      )}
    </section>
  );
}

/** Rules of a firewall or of a security group. */
export function RulesSection({
  hostId,
  path,
  scope,
  isVisible,
  groups,
}: {
  hostId: number;
  path: Path;
  scope: FirewallScope | "group";
  isVisible: boolean;
  groups: string[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const fields: FieldSpec[] = [
    {
      key: "type",
      labelKey: "firewall.rule.direction",
      kind: "select",
      required: true,
      default: "in",
      options: ["in", "out", ...(scope === "group" ? [] : ["group"])].map(
        (value) => ({
          value,
          labelKey: `firewall.rule.directions.${value}`,
        }),
      ),
    },
    {
      key: "action",
      labelKey: "firewall.rule.action",
      kind: "select",
      required: true,
      default: "ACCEPT",
      options: select(ACTIONS),
      showIf: (v) => v.type !== "group",
    },
    {
      key: "group",
      labelKey: "firewall.rule.group",
      kind: "select",
      required: true,
      local: true,
      options: groups.map((value) => ({ value })),
      showIf: (v) => v.type === "group",
    },
    {
      key: "macro",
      labelKey: "firewall.rule.macro",
      hintKey: "firewall.rule.macroHint",
      placeholder: "SSH",
      showIf: (v) => v.type !== "group",
    },
    {
      key: "proto",
      labelKey: "firewall.rule.proto",
      kind: "select",
      options: select(PROTOCOLS),
      showIf: (v) => v.type !== "group" && !v.macro,
    },
    {
      key: "source",
      labelKey: "firewall.rule.source",
      hintKey: "firewall.rule.addressHint",
      showIf: (v) => v.type !== "group",
    },
    {
      key: "dest",
      labelKey: "firewall.rule.dest",
      hintKey: "firewall.rule.addressHint",
      showIf: (v) => v.type !== "group",
    },
    {
      key: "dport",
      labelKey: "firewall.rule.dport",
      placeholder: "22,80:90",
      showIf: (v) => v.type !== "group" && !v.macro,
    },
    {
      key: "sport",
      labelKey: "firewall.rule.sport",
      showIf: (v) => v.type !== "group" && !v.macro,
    },
    {
      key: "iface",
      labelKey: "firewall.rule.iface",
      placeholder: scope === "guest" ? "net0" : "vmbr0",
    },
    {
      key: "log",
      labelKey: "firewall.rule.log",
      kind: "select",
      options: select(LOG_LEVELS),
      showIf: (v) => v.type !== "group",
    },
    { key: "comment", labelKey: "firewall.rule.comment" },
    {
      key: "enable",
      labelKey: "firewall.rule.enable",
      kind: "check",
      default: true,
    },
  ];

  const move = async (
    rule: FirewallRule,
    direction: "up" | "down",
    reload: () => void,
  ) => {
    try {
      await pve(hostId, "PUT", [...path, rule.pos], {
        moveto: moveTarget(rule.pos, direction),
      });
      reload();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <CrudSection<FirewallRule>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="firewall.rules"
      hintKey="firewall.rulesHint"
      emptyKey="firewall.noRules"
      listPath={path}
      rowId={(rule) => String(rule.pos)}
      view={(rule) => ({
        title: (
          <span
            className={
              rule.enable ? undefined : "text-muted-foreground line-through"
            }
          >
            {rule.pos}. {ruleSummary(rule)}
          </span>
        ),
        badges:
          rule.log && rule.log !== "nolog" ? (
            <Badge variant="outline">log {rule.log}</Badge>
          ) : null,
        detail: rule.comment,
      })}
      fields={fields}
      prepare={ruleToForm}
      toParams={(values, creating) => ruleParams(fields, values, creating)}
      createLabelKey="firewall.addRule"
      dialogTitle={(creating, rule) =>
        creating
          ? t("firewall.addRuleTitle")
          : t("firewall.editRuleTitle", { pos: rule?.pos })
      }
      itemPath={(rule) => [...path, rule.pos]}
      menu={(rule, reload) => (
        <>
          <DropdownMenuItem
            disabled={rule.pos === 0}
            onClick={() => void move(rule, "up", reload)}
          >
            {t("firewall.moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void move(rule, "down", reload)}>
            {t("firewall.moveDown")}
          </DropdownMenuItem>
        </>
      )}
      deleteText={(rule) => ({
        title: t("firewall.deleteRuleTitle", { pos: rule.pos }),
        description: ruleSummary(rule),
      })}
    />
  );
}

function AliasesSection({
  hostId,
  base,
  isVisible,
}: {
  hostId: number;
  base: Path;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const fields: FieldSpec[] = [
    {
      key: "name",
      labelKey: "firewall.alias.name",
      required: true,
      createOnly: true,
      pattern: /^[A-Za-z][A-Za-z0-9_-]+$/,
      patternKey: "firewall.nameFormat",
    },
    {
      key: "cidr",
      labelKey: "firewall.alias.cidr",
      required: true,
      placeholder: "10.0.0.0/24",
    },
    { key: "comment", labelKey: "firewall.rule.comment" },
  ];
  return (
    <CrudSection<{ name: string; cidr: string; comment?: string }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="firewall.aliases"
      hintKey="firewall.aliasesHint"
      emptyKey="firewall.noAliases"
      listPath={[...base, "aliases"]}
      rowId={(a) => a.name}
      view={(a) => ({
        title: a.name,
        detail: [a.cidr, a.comment].filter(Boolean).join(" · "),
      })}
      fields={fields}
      createLabelKey="firewall.addAlias"
      itemPath={(a) => [...base, "aliases", a.name]}
      toParams={(values, creating) =>
        paramsFrom(fields, values, creating, { deleteParam: false })
      }
      deleteText={(a) => ({
        title: t("firewall.deleteAliasTitle", { name: a.name }),
        description: t("firewall.deleteAliasDescription"),
      })}
    />
  );
}

function IpSetsSection({
  hostId,
  base,
  isVisible,
}: {
  hostId: number;
  base: Path;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const entryFields: FieldSpec[] = [
    {
      key: "cidr",
      labelKey: "firewall.ipset.cidr",
      required: true,
      createOnly: true,
      placeholder: "10.0.0.0/24",
    },
    {
      key: "nomatch",
      labelKey: "firewall.ipset.nomatch",
      hintKey: "firewall.ipset.nomatchHint",
      kind: "check",
    },
    { key: "comment", labelKey: "firewall.rule.comment" },
  ];
  return (
    <>
      <CrudSection<{ name: string; comment?: string }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="firewall.ipsets"
        hintKey="firewall.ipsetsHint"
        emptyKey="firewall.noIpsets"
        listPath={[...base, "ipset"]}
        rowId={(s) => s.name}
        view={(s) => ({ title: s.name, detail: s.comment })}
        fields={[
          {
            key: "name",
            labelKey: "firewall.ipset.name",
            required: true,
            createOnly: true,
            pattern: /^[A-Za-z][A-Za-z0-9_-]+$/,
            patternKey: "firewall.nameFormat",
          },
          { key: "comment", labelKey: "firewall.rule.comment" },
        ]}
        createLabelKey="firewall.addIpset"
        itemPath={(s) => [...base, "ipset", s.name]}
        canEdit={() => false}
        menu={(s) => (
          <DropdownMenuItem onClick={() => setOpen(s.name)}>
            {t("firewall.ipset.entries")}
          </DropdownMenuItem>
        )}
        deleteText={(s) => ({
          title: t("firewall.deleteIpsetTitle", { name: s.name }),
          description: t("firewall.deleteIpsetDescription"),
        })}
      />
      {open && (
        <PanelDialog
          title={t("firewall.ipset.entriesTitle", { name: open })}
          onClose={() => setOpen(null)}
        >
          <CrudSection<{ cidr: string; nomatch?: number; comment?: string }>
            hostId={hostId}
            isVisible
            titleKey="firewall.ipset.entries"
            emptyKey="firewall.ipset.noEntries"
            listPath={[...base, "ipset", open]}
            rowId={(e) => e.cidr}
            view={(e) => ({
              title: e.cidr,
              badges: e.nomatch ? (
                <Badge variant="secondary">{t("firewall.ipset.nomatch")}</Badge>
              ) : null,
              detail: e.comment,
            })}
            fields={entryFields}
            createLabelKey="firewall.ipset.addEntry"
            itemPath={(e) => [...base, "ipset", open, e.cidr]}
            toParams={(values, creating) =>
              paramsFrom(entryFields, values, creating, { deleteParam: false })
            }
          />
        </PanelDialog>
      )}
    </>
  );
}

function GroupsSection({
  hostId,
  isVisible,
  onGroups,
}: {
  hostId: number;
  isVisible: boolean;
  onGroups: (names: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const base = ["cluster", "firewall", "groups"];
  return (
    <>
      <CrudSection<{ group: string; comment?: string }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="firewall.groups"
        hintKey="firewall.groupsHint"
        emptyKey="firewall.noGroups"
        listPath={base}
        rowId={(g) => g.group}
        view={(g) => ({ title: g.group, detail: g.comment })}
        fields={[
          {
            key: "group",
            labelKey: "firewall.groupName",
            required: true,
            createOnly: true,
            pattern: /^[A-Za-z][A-Za-z0-9_-]+$/,
            patternKey: "firewall.nameFormat",
          },
          { key: "comment", labelKey: "firewall.rule.comment" },
        ]}
        createLabelKey="firewall.addGroup"
        itemPath={(g) => [...base, g.group]}
        canEdit={() => false}
        onLoaded={(rows) => onGroups(rows.map((g) => g.group))}
        menu={(g) => (
          <DropdownMenuItem onClick={() => setOpen(g.group)}>
            {t("firewall.rules")}
          </DropdownMenuItem>
        )}
        deleteText={(g) => ({
          title: t("firewall.deleteGroupTitle", { name: g.group }),
          description: t("firewall.deleteGroupDescription"),
        })}
      />
      {open && (
        <PanelDialog
          title={t("firewall.groupRulesTitle", { name: open })}
          onClose={() => setOpen(null)}
        >
          <RulesSection
            hostId={hostId}
            path={[...base, open]}
            scope="group"
            isVisible
            groups={[]}
          />
        </PanelDialog>
      )}
    </>
  );
}

function LogSection({
  hostId,
  base,
  isVisible,
}: {
  hostId: number;
  base: Path;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const { data, error, load } = useApiList<Array<{ n: number; t: string }>>(
    hostId,
    [...base, "log"],
    { limit: 200 },
    isVisible,
  );
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("firewall.log")}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void load()}
          >
            {t("app.refresh")}
          </Button>
        }
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <pre className="max-h-72 overflow-auto border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">
        {data
          ? data.length
            ? [...data]
                .reverse()
                .map((line) => line.t)
                .join("\n")
            : t("firewall.noLog")
          : t("app.loading")}
      </pre>
    </section>
  );
}

/** A firewall as Proxmox's Firewall panel: options, rules, and the names rules can use. */
export function FirewallPanel({
  hostId,
  base,
  scope,
  isVisible,
}: {
  hostId: number;
  base: Path;
  scope: FirewallScope;
  isVisible: boolean;
}) {
  const [groups, setGroups] = useState<string[]>([]);
  // Node and guest rules can use the datacenter's security groups too.
  const groupList = useApiList<Array<{ group: string }>>(
    hostId,
    ["cluster", "firewall", "groups"],
    undefined,
    isVisible && scope !== "cluster",
  );
  const names =
    scope === "cluster" ? groups : (groupList.data ?? []).map((g) => g.group);
  return (
    <div className="flex flex-col gap-5">
      <OptionsSection
        hostId={hostId}
        base={base}
        scope={scope}
        isVisible={isVisible}
      />
      <RulesSection
        hostId={hostId}
        path={[...base, "rules"]}
        scope={scope}
        isVisible={isVisible}
        groups={names}
      />
      {scope === "cluster" && (
        <GroupsSection
          hostId={hostId}
          isVisible={isVisible}
          onGroups={setGroups}
        />
      )}
      {scope !== "node" && (
        <AliasesSection hostId={hostId} base={base} isVisible={isVisible} />
      )}
      {scope !== "node" && (
        <IpSetsSection hostId={hostId} base={base} isVisible={isVisible} />
      )}
      {scope !== "cluster" && (
        <LogSection hostId={hostId} base={base} isVisible={isVisible} />
      )}
    </div>
  );
}

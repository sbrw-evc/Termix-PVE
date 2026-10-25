import { useMemo, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenuItem,
  Segmented,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import { Copy } from "lucide-react";
import { pve, toCallError, type PveResource } from "../api";
import { CheckField, Field, FormDialog, TextInput } from "../components/forms";
import {
  CrudSection,
  PanelDialog,
  RecordDialog,
  paramsFrom,
  useApiList,
  type FieldSpec,
} from "./crud";
import {
  aclParams,
  memberChanges,
  tokensOf,
  totpSecret,
  totpUri,
  type AccessToken,
  type AccessUser,
  type AclEntry,
} from "./access";
import type { DatacenterProps } from "./DatacenterView";

type AccessTab =
  "users" | "tokens" | "tfa" | "groups" | "pools" | "roles" | "realms" | "acl";
/** In the order of Proxmox's Permissions menu, with the permissions themselves last. */
const TABS: AccessTab[] = [
  "users",
  "tokens",
  "tfa",
  "groups",
  "pools",
  "roles",
  "realms",
  "acl",
];

const USERID_RE = /^[^\s:/@]+@[A-Za-z][A-Za-z0-9.-]*$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/;

function SecretDialog({
  title,
  lines,
  onClose,
}: {
  title: string;
  lines: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const text = lines.join("\n");
  return (
    <PanelDialog title={title} onClose={onClose}>
      <p className="text-xs text-destructive">{t("access.secretOnce")}</p>
      <Textarea
        readOnly
        value={text}
        rows={Math.min(10, lines.length + 1)}
        className="font-mono text-[11px]"
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast.success(t("datacenter.summary.copied")),
              () => toast.error(t("datacenter.summary.copyFailed")),
            )
          }
        >
          <Copy className="mr-1 size-3" />
          {t("datacenter.summary.copy")}
        </Button>
      </div>
    </PanelDialog>
  );
}

function UsersSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const fields: FieldSpec[] = [
    {
      key: "userid",
      labelKey: "access.user.id",
      hintKey: "access.user.idHint",
      required: true,
      createOnly: true,
      pattern: USERID_RE,
      patternKey: "access.user.idFormat",
      placeholder: "alice@pve",
    },
    {
      key: "password",
      labelKey: "access.user.password",
      hintKey: "access.user.passwordHint",
      kind: "password",
      hideOnEdit: true,
      local: true,
    },
    { key: "firstname", labelKey: "access.user.firstname" },
    { key: "lastname", labelKey: "access.user.lastname" },
    { key: "email", labelKey: "access.user.email" },
    {
      key: "groups",
      labelKey: "access.user.groups",
      hintKey: "access.user.groupsHint",
    },
    { key: "comment", labelKey: "access.comment" },
    {
      key: "enable",
      labelKey: "access.user.enable",
      kind: "check",
      default: true,
    },
  ];
  return (
    <>
      <CrudSection<AccessUser>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="access.tabs.users"
        hintKey="access.user.hint"
        emptyKey="access.user.none"
        listPath={["access", "users"]}
        rowId={(u) => u.userid}
        view={(u) => ({
          title: u.userid,
          badges: (
            <>
              {!u.enable ? (
                <Badge variant="secondary">{t("access.disabled")}</Badge>
              ) : null}
              {u["tfa-locked-until"] ? (
                <Badge variant="destructive">
                  {t("access.user.tfaLocked")}
                </Badge>
              ) : null}
            </>
          ),
          detail: [
            [u.firstname, u.lastname].filter(Boolean).join(" "),
            u.email,
            Array.isArray(u.groups) ? u.groups.join(",") : u.groups,
            u.comment,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
        fields={fields}
        loadItem
        toParams={(values, creating) => {
          const params = paramsFrom(fields, values, creating, {
            deleteParam: false,
          });
          const password = String(values.password ?? "");
          if (creating && password) params.password = password;
          return params;
        }}
        createLabelKey="access.user.add"
        itemPath={(u) => ["access", "users", u.userid]}
        // root@pam is Proxmox's own way back in.
        canDelete={(u) => u.userid !== "root@pam"}
        menu={(u) =>
          u.userid.endsWith("@pve") || u.userid.endsWith("@pam") ? (
            <DropdownMenuItem onClick={() => setPasswordFor(u.userid)}>
              {t("access.user.changePassword")}
            </DropdownMenuItem>
          ) : null
        }
        deleteText={(u) => ({
          title: t("access.user.deleteTitle", { id: u.userid }),
          description: t("access.user.deleteDescription"),
        })}
      />
      {passwordFor && (
        <RecordDialog
          title={t("access.user.passwordTitle", { id: passwordFor })}
          fields={[
            {
              key: "password",
              labelKey: "access.user.newPassword",
              kind: "password",
              required: true,
              pattern: /^.{8,}$/,
              patternKey: "access.user.passwordLength",
            },
          ]}
          initial={{ password: "" }}
          creating
          submitLabel={t("app.save")}
          intro={
            passwordFor.endsWith("@pam") ? (
              <p className="text-[11px] text-destructive">
                {t("access.user.pamWarning")}
              </p>
            ) : null
          }
          onClose={() => setPasswordFor(null)}
          onSubmit={async (values) => {
            await pve(hostId, "PUT", ["access", "password"], {
              userid: passwordFor,
              password: String(values.password),
            });
          }}
        />
      )}
    </>
  );
}

function TokensSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const users = useApiList<AccessUser[]>(
    hostId,
    ["access", "users"],
    undefined,
    isVisible,
  );
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(
    null,
  );
  const fields: FieldSpec[] = [
    {
      key: "userid",
      labelKey: "access.token.user",
      kind: "select",
      required: true,
      createOnly: true,
      local: true,
      options: (users.data ?? []).map((u) => ({ value: u.userid })),
    },
    {
      key: "tokenid",
      labelKey: "access.token.id",
      required: true,
      createOnly: true,
      local: true,
      pattern: NAME_RE,
      patternKey: "access.nameFormat",
    },
    {
      key: "privsep",
      labelKey: "access.token.privsep",
      hintKey: "access.token.privsepHint",
      kind: "check",
      default: true,
    },
    { key: "comment", labelKey: "access.comment" },
  ];
  return (
    <>
      <CrudSection<AccessToken>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="access.tabs.tokens"
        hintKey="access.token.hint"
        emptyKey="access.token.none"
        listPath={["access", "users"]}
        listParams={{ full: 1 }}
        rows={(data) => tokensOf(data as AccessUser[])}
        rowId={(tok) => `${tok.userid}!${tok.tokenid}`}
        view={(tok) => ({
          title: `${tok.userid}!${tok.tokenid}`,
          badges: tok.privsep ? (
            <Badge variant="outline">{t("access.token.separated")}</Badge>
          ) : (
            <Badge variant="secondary">{t("access.token.fullRights")}</Badge>
          ),
          detail: tok.comment,
        })}
        fields={fields}
        createPathFor={(values) => [
          "access",
          "users",
          String(values.userid),
          "token",
          String(values.tokenid),
        ]}
        afterCreate={(answer, values) => {
          const value = (answer as { value?: string })?.value;
          if (value)
            setSecret({ id: `${values.userid}!${values.tokenid}`, value });
        }}
        createLabelKey="access.token.add"
        itemPath={(tok) => [
          "access",
          "users",
          tok.userid,
          "token",
          tok.tokenid,
        ]}
        deleteText={(tok) => ({
          title: t("access.token.deleteTitle", {
            id: `${tok.userid}!${tok.tokenid}`,
          }),
          description: t("access.token.deleteDescription"),
        })}
      />
      {secret && (
        <SecretDialog
          title={t("access.token.secretTitle", { id: secret.id })}
          lines={[
            `${t("access.token.idLabel")}: ${secret.id}`,
            `${t("access.token.secretLabel")}: ${secret.value}`,
          ]}
          onClose={() => setSecret(null)}
        />
      )}
    </>
  );
}

interface TfaUser {
  userid: string;
  entries: Array<{
    id: string;
    type: string;
    description?: string;
    created?: number;
    enable?: number;
  }>;
}

function TotpDialog({
  hostId,
  users,
  onClose,
  onDone,
}: {
  hostId: number;
  users: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [userid, setUserid] = useState(users[0] ?? "");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const secret = useMemo(() => totpSecret(), []);
  const uri = totpUri(userid, secret);
  return (
    <FormDialog
      title={t("access.tfa.addTotp")}
      submitLabel={t("access.tfa.verify")}
      canSubmit={!!userid && /^\d{6}$/.test(code)}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "POST", ["access", "tfa", userid], {
          type: "totp",
          description: description || undefined,
          totp: uri,
          value: code,
          password: password || undefined,
        });
        onDone();
      }}
    >
      {() => (
        <>
          <Field label={t("access.tfa.user")}>
            <select
              className="h-8 w-full border border-border bg-background px-2 text-xs"
              value={userid}
              onChange={(e) => setUserid(e.target.value)}
            >
              {users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("access.tfa.description")}>
            <TextInput value={description} onChange={setDescription} />
          </Field>
          <Field
            label={t("access.tfa.secret")}
            hint={t("access.tfa.secretHint")}
          >
            <Textarea
              readOnly
              value={`${secret}\n${uri}`}
              rows={3}
              className="font-mono text-[11px]"
            />
          </Field>
          <Field label={t("access.tfa.code")} hint={t("access.tfa.codeHint")}>
            <TextInput
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
            />
          </Field>
          <Field
            label={t("access.tfa.password")}
            hint={t("access.tfa.passwordHint")}
          >
            <TextInput
              type="password"
              value={password}
              onChange={setPassword}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function TfaSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const users = useApiList<AccessUser[]>(
    hostId,
    ["access", "users"],
    undefined,
    isVisible,
  );
  const [adding, setAdding] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  type Row = TfaUser["entries"][number] & { userid: string };
  const toggle = async (row: Row, reload: () => void) => {
    try {
      await pve(hostId, "PUT", ["access", "tfa", row.userid, row.id], {
        enable: row.enable === 0 ? 1 : 0,
      });
      reload();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };
  const [askRecovery, setAskRecovery] = useState(false);
  return (
    <>
      <CrudSection<Row>
        key={reloadKey}
        hostId={hostId}
        isVisible={isVisible}
        titleKey="access.tabs.tfa"
        hintKey="access.tfa.hint"
        emptyKey="access.tfa.none"
        listPath={["access", "tfa"]}
        rows={(data) =>
          (data as TfaUser[]).flatMap((u) =>
            u.entries.map((e) => ({ ...e, userid: u.userid })),
          )
        }
        rowId={(row) => `${row.userid}/${row.id}`}
        view={(row) => ({
          title: `${row.userid} · ${row.description || row.type}`,
          badges: (
            <>
              <Badge variant="outline">{row.type}</Badge>
              {row.enable === 0 ? (
                <Badge variant="secondary">{t("access.disabled")}</Badge>
              ) : null}
            </>
          ),
          detail: row.created
            ? new Date(row.created * 1000).toLocaleString(language, {
                dateStyle: "short",
              })
            : undefined,
        })}
        toolbar={() => (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setAdding(true)}
            >
              {t("access.tfa.addTotp")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!users.data?.length}
              onClick={() => setAskRecovery(true)}
            >
              {t("access.tfa.recoveryKeys")}
            </Button>
          </>
        )}
        itemPath={(row) => ["access", "tfa", row.userid, row.id]}
        menu={(row, reload) => (
          <DropdownMenuItem onClick={() => void toggle(row, reload)}>
            {t(row.enable === 0 ? "access.tfa.enable" : "access.tfa.disable")}
          </DropdownMenuItem>
        )}
        deleteText={(row) => ({
          title: t("access.tfa.deleteTitle", { id: row.userid }),
          description: t("access.tfa.deleteDescription"),
        })}
      />
      {adding && (
        <TotpDialog
          hostId={hostId}
          users={(users.data ?? []).map((u) => u.userid)}
          onClose={() => setAdding(false)}
          onDone={() => setReloadKey((k) => k + 1)}
        />
      )}
      {askRecovery && (
        // Recovery keys replace any the user had, so this asks first.
        <RecordDialog
          title={t("access.tfa.recoveryKeys")}
          submitLabel={t("access.tfa.makeRecovery")}
          fields={[
            {
              key: "userid",
              labelKey: "access.tfa.user",
              kind: "select",
              required: true,
              options: (users.data ?? []).map((u) => ({ value: u.userid })),
            },
          ]}
          initial={{ userid: users.data?.[0]?.userid ?? "" }}
          creating
          intro={
            <p className="text-[11px] text-muted-foreground">
              {t("access.tfa.recoveryHint")}
            </p>
          }
          onClose={() => setAskRecovery(false)}
          onSubmit={async (values) => {
            const answer = await pve<{ recovery?: string[] }>(
              hostId,
              "POST",
              ["access", "tfa", String(values.userid)],
              { type: "recovery" },
            );
            if (answer?.recovery?.length) setRecovery(answer.recovery);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {recovery && (
        <SecretDialog
          title={t("access.tfa.recoveryTitle")}
          lines={recovery}
          onClose={() => setRecovery(null)}
        />
      )}
    </>
  );
}

function GroupsSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  return (
    <CrudSection<{ groupid: string; comment?: string; users?: string }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="access.tabs.groups"
      hintKey="access.group.hint"
      emptyKey="access.group.none"
      listPath={["access", "groups"]}
      rowId={(g) => g.groupid}
      view={(g) => ({
        title: g.groupid,
        detail: [g.users, g.comment].filter(Boolean).join(" · "),
      })}
      fields={[
        {
          key: "groupid",
          labelKey: "access.group.id",
          required: true,
          createOnly: true,
          pattern: NAME_RE,
          patternKey: "access.nameFormat",
        },
        { key: "comment", labelKey: "access.comment" },
      ]}
      createLabelKey="access.group.add"
      itemPath={(g) => ["access", "groups", g.groupid]}
      deleteText={(g) => ({
        title: t("access.group.deleteTitle", { id: g.groupid }),
        description: t("access.group.deleteDescription"),
      })}
    />
  );
}

function PoolMembersDialog({
  hostId,
  poolid,
  resources,
  onClose,
}: {
  hostId: number;
  poolid: string;
  resources: PveResource[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pool = useApiList<{
    members: Array<{ type: string; vmid?: number; storage?: string }>;
  }>(hostId, ["pools", poolid], undefined, true);
  const before = useMemo(
    () => ({
      vms: (pool.data?.members ?? [])
        .filter((m) => m.vmid !== undefined)
        .map((m) => String(m.vmid)),
      storage: (pool.data?.members ?? [])
        .filter((m) => m.type === "storage" && m.storage)
        .map((m) => m.storage!),
    }),
    [pool.data],
  );
  const [chosen, setChosen] = useState<{
    vms: string[];
    storage: string[];
  } | null>(null);
  const current = chosen ?? before;
  const guests = resources.filter(
    (r) => r.vmid !== undefined && (r.type === "qemu" || r.type === "lxc"),
  );
  const storages = [
    ...new Set(
      resources
        .filter((r) => r.type === "storage" && r.storage)
        .map((r) => r.storage!),
    ),
  ].sort();
  const flip = (kind: "vms" | "storage", id: string, on: boolean) =>
    setChosen({
      ...current,
      [kind]: on
        ? [...current[kind], id]
        : current[kind].filter((x) => x !== id),
    });
  return (
    <FormDialog
      title={t("access.pool.membersTitle", { id: poolid })}
      submitLabel={t("app.save")}
      canSubmit={!!pool.data}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const vms = memberChanges(before.vms, current.vms);
        const storage = memberChanges(before.storage, current.storage);
        if (vms.add.length || storage.add.length) {
          await pve(hostId, "PUT", ["pools", poolid], {
            vms: vms.add.join(",") || undefined,
            storage: storage.add.join(",") || undefined,
          });
        }
        if (vms.remove.length || storage.remove.length) {
          await pve(hostId, "PUT", ["pools", poolid], {
            vms: vms.remove.join(",") || undefined,
            storage: storage.remove.join(",") || undefined,
            delete: 1,
          });
        }
      }}
    >
      {() => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">
              {t("access.pool.guests")}
            </span>
            {guests.map((g) => (
              <CheckField
                key={g.vmid}
                label={`${g.vmid} ${g.name ?? ""}`}
                checked={current.vms.includes(String(g.vmid))}
                onChange={(on) => flip("vms", String(g.vmid), on)}
              />
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">
              {t("access.pool.storage")}
            </span>
            {storages.map((s) => (
              <CheckField
                key={s}
                label={s}
                checked={current.storage.includes(s)}
                onChange={(on) => flip("storage", s, on)}
              />
            ))}
          </div>
        </div>
      )}
    </FormDialog>
  );
}

function PoolsSection({
  hostId,
  resources,
  isVisible,
}: {
  hostId: number;
  resources: PveResource[];
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<string | null>(null);
  return (
    <>
      <CrudSection<{ poolid: string; comment?: string }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="access.tabs.pools"
        hintKey="access.pool.hint"
        emptyKey="access.pool.none"
        listPath={["pools"]}
        rowId={(p) => p.poolid}
        view={(p) => ({ title: p.poolid, detail: p.comment })}
        fields={[
          {
            key: "poolid",
            labelKey: "access.pool.id",
            required: true,
            createOnly: true,
            pattern: NAME_RE,
            patternKey: "access.nameFormat",
          },
          { key: "comment", labelKey: "access.comment" },
        ]}
        createLabelKey="access.pool.add"
        itemPath={(p) => ["pools", p.poolid]}
        menu={(p) => (
          <DropdownMenuItem onClick={() => setMembers(p.poolid)}>
            {t("access.pool.members")}
          </DropdownMenuItem>
        )}
        deleteText={(p) => ({
          title: t("access.pool.deleteTitle", { id: p.poolid }),
          description: t("access.pool.deleteDescription"),
        })}
      />
      {members && (
        <PoolMembersDialog
          hostId={hostId}
          poolid={members}
          resources={resources}
          onClose={() => setMembers(null)}
        />
      )}
    </>
  );
}

function RolesSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  return (
    <CrudSection<{ roleid: string; privs?: string; special?: number }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="access.tabs.roles"
      hintKey="access.role.hint"
      emptyKey="access.role.none"
      listPath={["access", "roles"]}
      rows={(data) =>
        [...(data as Array<{ roleid: string; special?: number }>)].sort(
          (a, b) =>
            (a.special ?? 0) - (b.special ?? 0) ||
            a.roleid.localeCompare(b.roleid),
        )
      }
      rowId={(r) => r.roleid}
      view={(r) => ({
        title: r.roleid,
        badges: r.special ? (
          <Badge variant="outline">{t("access.role.builtIn")}</Badge>
        ) : null,
        detail: r.privs?.split(",").join(", "),
      })}
      fields={[
        {
          key: "roleid",
          labelKey: "access.role.id",
          required: true,
          createOnly: true,
          pattern: NAME_RE,
          patternKey: "access.nameFormat",
        },
        {
          key: "privs",
          labelKey: "access.role.privs",
          hintKey: "access.role.privsHint",
          kind: "textarea",
          placeholder: "VM.Audit,VM.PowerMgmt",
        },
      ]}
      toParams={(values) => ({
        privs: String(values.privs ?? "").replace(/\s+/g, ""),
      })}
      createLabelKey="access.role.add"
      itemPath={(r) => ["access", "roles", r.roleid]}
      // Built-in roles belong to Proxmox.
      canEdit={(r) => !r.special}
      canDelete={(r) => !r.special}
      deleteText={(r) => ({
        title: t("access.role.deleteTitle", { id: r.roleid }),
        description: t("access.role.deleteDescription"),
      })}
    />
  );
}

function RealmsSection({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const is =
    (...types: string[]) =>
    (v: Record<string, unknown>) =>
      types.includes(String(v.type));
  const fields: FieldSpec[] = [
    {
      key: "realm",
      labelKey: "access.realm.id",
      required: true,
      createOnly: true,
      pattern: /^[A-Za-z][A-Za-z0-9.-]{1,31}$/,
      patternKey: "access.nameFormat",
    },
    {
      key: "type",
      labelKey: "access.realm.type",
      kind: "select",
      required: true,
      createOnly: true,
      default: "ldap",
      options: ["ldap", "ad", "openid"].map((value) => ({
        value,
        labelKey: `access.realm.types.${value}`,
      })),
    },
    {
      key: "domain",
      labelKey: "access.realm.domain",
      required: true,
      placeholder: "corp.example.com",
      showIf: is("ad"),
    },
    {
      key: "server1",
      labelKey: "access.realm.server",
      required: true,
      showIf: is("ldap", "ad"),
    },
    {
      key: "server2",
      labelKey: "access.realm.server2",
      showIf: is("ldap", "ad"),
    },
    {
      key: "port",
      labelKey: "access.realm.port",
      kind: "number",
      showIf: is("ldap", "ad"),
    },
    {
      key: "mode",
      labelKey: "access.realm.mode",
      kind: "select",
      options: ["ldap", "ldaps", "ldap+starttls"].map((value) => ({ value })),
      showIf: is("ldap", "ad"),
    },
    {
      key: "base_dn",
      labelKey: "access.realm.baseDn",
      required: true,
      placeholder: "dc=example,dc=com",
      showIf: is("ldap"),
    },
    {
      key: "user_attr",
      labelKey: "access.realm.userAttr",
      required: true,
      default: "uid",
      showIf: is("ldap"),
    },
    {
      key: "bind_dn",
      labelKey: "access.realm.bindDn",
      showIf: is("ldap", "ad"),
    },
    {
      key: "password",
      labelKey: "access.realm.bindPassword",
      hintKey: "access.realm.bindPasswordHint",
      kind: "password",
      local: true,
      showIf: is("ldap", "ad"),
    },
    {
      key: "issuer-url",
      labelKey: "access.realm.issuer",
      required: true,
      placeholder: "https://login.example.com",
      showIf: is("openid"),
    },
    {
      key: "client-id",
      labelKey: "access.realm.clientId",
      required: true,
      showIf: is("openid"),
    },
    {
      key: "client-key",
      labelKey: "access.realm.clientKey",
      hintKey: "access.realm.bindPasswordHint",
      kind: "password",
      local: true,
      showIf: is("openid"),
    },
    {
      key: "username-claim",
      labelKey: "access.realm.usernameClaim",
      showIf: is("openid"),
    },
    {
      key: "autocreate",
      labelKey: "access.realm.autocreate",
      kind: "check",
      showIf: is("openid"),
    },
    { key: "comment", labelKey: "access.comment" },
    { key: "default", labelKey: "access.realm.default", kind: "check" },
  ];
  const sync = async (realm: string) => {
    try {
      await pve(hostId, "POST", ["access", "domains", realm, "sync"], {
        scope: "both",
      });
      toast.success(t("access.realm.synced", { id: realm }));
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };
  return (
    <CrudSection<{
      realm: string;
      type: string;
      comment?: string;
      default?: number;
    }>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="access.tabs.realms"
      hintKey="access.realm.hint"
      emptyKey="access.realm.none"
      listPath={["access", "domains"]}
      rowId={(r) => r.realm}
      view={(r) => ({
        title: r.realm,
        badges: (
          <>
            <Badge variant="outline">{r.type}</Badge>
            {r.default ? (
              <Badge variant="secondary">{t("access.realm.isDefault")}</Badge>
            ) : null}
          </>
        ),
        detail: r.comment,
      })}
      fields={fields}
      loadItem
      toParams={(values, creating) => {
        const params = paramsFrom(fields, values, creating, {
          deleteParam: false,
        });
        for (const key of ["password", "client-key"]) {
          const secret = String(values[key] ?? "");
          if (secret && fields.find((f) => f.key === key)?.showIf?.(values))
            params[key] = secret;
        }
        if (creating) params.type = String(values.type);
        return params;
      }}
      createLabelKey="access.realm.add"
      itemPath={(r) => ["access", "domains", r.realm]}
      // pam and pve are Proxmox's own realms.
      canDelete={(r) => r.type !== "pam" && r.type !== "pve"}
      menu={(r) =>
        r.type === "ldap" || r.type === "ad" ? (
          <DropdownMenuItem onClick={() => void sync(r.realm)}>
            {t("access.realm.sync")}
          </DropdownMenuItem>
        ) : null
      }
      deleteText={(r) => ({
        title: t("access.realm.deleteTitle", { id: r.realm }),
        description: t("access.realm.deleteDescription"),
      })}
    />
  );
}

/**
 * Permissions. With `fixedPath` (a guest's /vms/<id>), only the entries on
 * that path, and new ones go there.
 */
export function AclSection({
  hostId,
  isVisible,
  fixedPath,
}: {
  hostId: number;
  isVisible: boolean;
  fixedPath?: string;
}) {
  const { t } = useTranslation();
  const roles = useApiList<Array<{ roleid: string }>>(
    hostId,
    ["access", "roles"],
    undefined,
    isVisible,
  );
  const allFields: FieldSpec[] = [
    {
      key: "path",
      labelKey: "access.acl.path",
      hintKey: "access.acl.pathHint",
      required: true,
      default: "/",
      pattern: /^\/[A-Za-z0-9_./:-]*$/,
      patternKey: "access.acl.pathFormat",
    },
    {
      key: "type",
      labelKey: "access.acl.type",
      kind: "select",
      required: true,
      default: "user",
      options: ["user", "group", "token"].map((value) => ({
        value,
        labelKey: `access.acl.types.${value}`,
      })),
    },
    {
      key: "ugid",
      labelKey: "access.acl.who",
      hintKey: "access.acl.whoHint",
      required: true,
    },
    {
      key: "roleid",
      labelKey: "access.acl.role",
      kind: "select",
      required: true,
      options: (roles.data ?? [])
        .map((r) => ({ value: r.roleid }))
        .sort((a, b) => a.value.localeCompare(b.value)),
    },
    {
      key: "propagate",
      labelKey: "access.acl.propagate",
      kind: "check",
      default: true,
    },
  ];
  const fields = fixedPath
    ? allFields.filter((f) => f.key !== "path")
    : allFields;
  return (
    <CrudSection<AclEntry>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="access.tabs.acl"
      hintKey="access.acl.hint"
      emptyKey="access.acl.none"
      listPath={["access", "acl"]}
      rows={(data) =>
        [...(data as AclEntry[])]
          .filter((a) => !fixedPath || a.path === fixedPath)
          .sort(
            (a, b) =>
              a.path.localeCompare(b.path) || a.ugid.localeCompare(b.ugid),
          )
      }
      rowId={(a) => `${a.path}|${a.type}|${a.ugid}|${a.roleid}`}
      view={(a) => ({
        title: `${a.path} · ${a.ugid}`,
        badges: (
          <>
            <Badge variant="outline">{a.roleid}</Badge>
            {a.propagate ? (
              <Badge variant="secondary">{t("access.acl.propagates")}</Badge>
            ) : null}
          </>
        ),
        detail: t(`access.acl.types.${a.type}`),
      })}
      fields={fields}
      createMethod="PUT"
      toParams={(values) =>
        aclParams({
          path: fixedPath ?? String(values.path),
          type: String(values.type),
          ugid: String(values.ugid),
          roleid: String(values.roleid),
          propagate: values.propagate === true,
        })
      }
      createLabelKey="access.acl.add"
      canEdit={() => false}
      onDelete={async (a) => {
        await pve(hostId, "PUT", ["access", "acl"], aclParams(a, true));
      }}
      deleteText={(a) => ({
        title: t("access.acl.deleteTitle", { who: a.ugid, path: a.path }),
        description: t("access.acl.deleteDescription", { role: a.roleid }),
      })}
    />
  );
}

/** Proxmox's Permissions menu: who may sign in, how, and what they may do. */
export function AccessPanel({ hostId, resources, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AccessTab>("users");
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        className="max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
        value={tab}
        onChange={(v) => setTab(v as AccessTab)}
        options={TABS.map((value) => ({
          value,
          label: t(`access.tabs.${value}`),
        }))}
      />
      <p className="text-[11px] text-muted-foreground">
        {t("access.needsAdminister")}
      </p>
      {tab === "users" && (
        <UsersSection hostId={hostId} isVisible={isVisible} />
      )}
      {tab === "tokens" && (
        <TokensSection hostId={hostId} isVisible={isVisible} />
      )}
      {tab === "tfa" && <TfaSection hostId={hostId} isVisible={isVisible} />}
      {tab === "groups" && (
        <GroupsSection hostId={hostId} isVisible={isVisible} />
      )}
      {tab === "pools" && (
        <PoolsSection
          hostId={hostId}
          resources={resources}
          isVisible={isVisible}
        />
      )}
      {tab === "roles" && (
        <RolesSection hostId={hostId} isVisible={isVisible} />
      )}
      {tab === "realms" && (
        <RealmsSection hostId={hostId} isVisible={isVisible} />
      )}
      {tab === "acl" && <AclSection hostId={hostId} isVisible={isVisible} />}
    </div>
  );
}

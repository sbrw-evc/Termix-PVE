import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  GroupHeading,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import {
  FileUp,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { app, pve, toCallError } from "../api";
import { useTasks } from "../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";
import { certState, commonName, type NodeCertificate } from "./system";
import {
  MAX_ACME_DOMAINS,
  accountParams,
  accountProblem,
  acmeConfigParams,
  acmeConfigProblem,
  encodePluginData,
  parseAcmeConfig,
  pluginIdProblem,
  type AccountForm,
  type AcmeNodeConfig,
  type AcmePlugin,
  type ChallengeSchema,
} from "./acme";

const CERT_BADGE: Record<
  ReturnType<typeof certState>,
  "secondary" | "outline" | "destructive"
> = {
  valid: "secondary",
  expiring: "outline",
  expired: "destructive",
  notYet: "outline",
};

/** The file pveproxy serves a custom or ACME certificate from. */
const CUSTOM_FILE = "pveproxy-ssl.pem";

/** The node's certificates, a custom one to upload, and ACME. */
export function CertificatesSection(props: NodeTabProps) {
  const { hostId, node, isVisible } = props;
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<NodeCertificate[]>(
    hostId,
    ["nodes", node, "certificates", "info"],
    undefined,
    isVisible,
  );
  const [uploading, setUploading] = useState(false);
  const hasCustom = !!data?.some((c) => c.filename === CUSTOM_FILE);
  const date = (s?: number) =>
    s ? new Date(s * 1000).toLocaleDateString() : "-";

  const removeCustom = async () => {
    const ok = await app().confirm({
      title: t("nodes.system.certs.removeTitle"),
      description: t("nodes.system.certs.removeDescription"),
      confirmLabel: t("nodes.system.certs.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await pve(hostId, "DELETE", ["nodes", node, "certificates", "custom"], {
        restart: true,
      });
      toast.success(t("nodes.system.certs.removed"));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      void load();
    }
  };

  return (
    <>
      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("nodes.system.certs.title")}
          action={
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setUploading(true)}
              >
                <Upload className="mr-1 size-3" />
                {t("nodes.system.certs.upload")}
              </Button>
              {hasCustom && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-destructive"
                  onClick={() => void removeCustom()}
                >
                  <Trash2 className="mr-1 size-3" />
                  {t("nodes.system.certs.remove")}
                </Button>
              )}
            </div>
          }
        />
        <State error={error} loading={!data && !error} />
        {data?.map((cert) => {
          const state = certState(cert);
          return (
            <div
              key={cert.filename}
              className="flex flex-col gap-0.5 border-b border-border/60 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{cert.filename}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {commonName(cert.subject)}
                </span>
                <Badge variant={CERT_BADGE[state]}>
                  {t(`nodes.system.certs.state.${state}`, {
                    date: date(cert.notafter),
                  })}
                </Badge>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {[
                  t("nodes.system.certs.issuer", {
                    issuer: commonName(cert.issuer),
                  }),
                  t("nodes.system.certs.validFrom", {
                    from: date(cert.notbefore),
                    to: date(cert.notafter),
                  }),
                  cert["public-key-type"] &&
                    `${cert["public-key-type"]} ${cert["public-key-bits"] ?? ""}`.trim(),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {!!cert.san?.length && (
                <div className="truncate text-[11px] text-muted-foreground">
                  SAN: {cert.san.join(", ")}
                </div>
              )}
              {cert.fingerprint && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {cert.fingerprint}
                </div>
              )}
            </div>
          );
        })}
        {uploading && (
          <UploadCertificateDialog
            hostId={hostId}
            node={node}
            replacing={hasCustom}
            onClose={() => setUploading(false)}
            onDone={load}
          />
        )}
      </section>
      <AcmeSection {...props} onCertificate={load} />
    </>
  );
}

/** Reads a picked file into a textarea, for PEM files people have on disk. */
function PemField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={hint}>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        className="h-32 font-mono text-[10px]"
      />
      <label className="flex cursor-pointer items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground">
        <FileUp className="size-3" />
        {t("nodes.system.certs.fromFile")}
        <input
          type="file"
          accept=".pem,.crt,.cer,.key,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(onChange);
            e.target.value = "";
          }}
        />
      </label>
    </Field>
  );
}

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
const PEM_KEY =
  /-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----[\s\S]+?-----END ([A-Z ]+ )?PRIVATE KEY-----/;

function UploadCertificateDialog({
  hostId,
  node,
  replacing,
  onClose,
  onDone,
}: {
  hostId: number;
  node: string;
  replacing: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [certificates, setCertificates] = useState("");
  const [key, setKey] = useState("");
  const [restart, setRestart] = useState(true);
  const certOk = PEM_CERT.test(certificates);
  const keyOk = !key.trim() || PEM_KEY.test(key);
  return (
    <FormDialog
      title={t("nodes.system.certs.uploadTitle", { node })}
      submitLabel={t("nodes.system.certs.upload")}
      canSubmit={certOk && keyOk}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "POST", ["nodes", node, "certificates", "custom"], {
          certificates: certificates.trim(),
          key: key.trim() || undefined,
          // Replacing an existing custom certificate needs force.
          force: replacing || undefined,
          restart,
        });
        toast.success(t("nodes.system.certs.uploaded"));
        onDone();
      }}
    >
      {() => (
        <>
          <PemField
            label={t("nodes.system.certs.chain")}
            hint={t("nodes.system.certs.chainHint")}
            value={certificates}
            onChange={setCertificates}
            placeholder="-----BEGIN CERTIFICATE-----"
          />
          <PemField
            label={t("nodes.system.certs.key")}
            hint={t("nodes.system.certs.keyHint")}
            value={key}
            onChange={setKey}
            placeholder="-----BEGIN PRIVATE KEY-----"
          />
          {!certOk && certificates && (
            <p className="text-[11px] text-destructive">
              {t("nodes.system.certs.badCert")}
            </p>
          )}
          {!keyOk && (
            <p className="text-[11px] text-destructive">
              {t("nodes.system.certs.badKey")}
            </p>
          )}
          <CheckField
            label={t("nodes.system.certs.restart")}
            hint={t("nodes.system.certs.restartHint")}
            checked={restart}
            onChange={setRestart}
          />
        </>
      )}
    </FormDialog>
  );
}

// ACME

interface AcmeAccountInfo {
  account?: { contact?: string[]; status?: string };
  directory?: string;
  location?: string;
  tos?: string;
}

function AcmeSection({
  hostId,
  node,
  isVisible,
  onCertificate,
}: NodeTabProps & { onCertificate: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const accounts = useNodeData<Array<{ name: string }>>(
    hostId,
    ["cluster", "acme", "account"],
    undefined,
    isVisible,
  );
  const plugins = useNodeData<AcmePlugin[]>(
    hostId,
    ["cluster", "acme", "plugins"],
    undefined,
    isVisible,
  );
  const config = useNodeData<Record<string, unknown>>(
    hostId,
    ["nodes", node, "config"],
    undefined,
    isVisible,
  );
  const [dialog, setDialog] = useState<"account" | "plugin" | "domains" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const acme = parseAcmeConfig(config.data);
  const dnsPlugins = (plugins.data ?? []).filter((p) => p.type === "dns");

  const order = async (renew: boolean) => {
    setBusy(true);
    try {
      const upid = await pve(
        hostId,
        renew ? "PUT" : "POST",
        ["nodes", node, "certificates", "acme", "certificate"],
        { force: renew || undefined },
      );
      await track(
        upid,
        t(renew ? "nodes.acme.renewLabel" : "nodes.acme.orderLabel", { node }),
      );
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(false);
      onCertificate();
    }
  };

  const remove = async (kind: "account" | "plugin", name: string) => {
    const ok = await app().confirm({
      title: t(`nodes.acme.${kind}.removeTitle`, { name }),
      description: t(`nodes.acme.${kind}.removeDescription`),
      confirmLabel: t("nodes.acme.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const upid = await pve(hostId, "DELETE", [
        "cluster",
        "acme",
        kind === "account" ? "account" : "plugins",
        name,
      ]);
      if (kind === "account")
        await track(upid, t("nodes.acme.account.removeLabel", { name }));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      void (kind === "account" ? accounts.load() : plugins.load());
    }
  };

  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.acme.title")}
        action={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy || !acme.account || !acme.domains.length}
              onClick={() => void order(false)}
            >
              <ShieldCheck className="mr-1 size-3" />
              {t("nodes.acme.order")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy || !acme.account || !acme.domains.length}
              onClick={() => void order(true)}
            >
              <RefreshCw className="mr-1 size-3" />
              {t("nodes.acme.renew")}
            </Button>
          </div>
        }
      />
      <State error={config.error} loading={!config.data && !config.error} />
      {config.data && (
        <div className="flex items-start gap-2 border-b border-border/60 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <div>
              {t("nodes.acme.usesAccount", {
                account: acme.account || t("nodes.acme.none"),
              })}
            </div>
            {acme.domains.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                {t("nodes.acme.noDomains")}
              </div>
            ) : (
              acme.domains.map((d) => (
                <div
                  key={d.domain}
                  className="text-[11px] text-muted-foreground"
                >
                  {d.domain} ·{" "}
                  {d.plugin
                    ? t("nodes.acme.viaDns", { plugin: d.plugin })
                    : t("nodes.acme.viaHttp")}
                  {d.alias ? ` · alias ${d.alias}` : ""}
                </div>
              ))
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => setDialog("domains")}
          >
            {t("app.edit")}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 text-xs font-medium">
        {t("nodes.acme.accounts")}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => setDialog("account")}
        >
          <Plus className="mr-1 size-3" />
          {t("nodes.acme.account.add")}
        </Button>
      </div>
      <State
        error={accounts.error}
        loading={!accounts.data && !accounts.error}
      />
      {accounts.data?.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("nodes.acme.account.none")}
        </p>
      )}
      {accounts.data?.map((a) => (
        <AccountRow
          key={a.name}
          hostId={hostId}
          name={a.name}
          onRemove={() => void remove("account", a.name)}
        />
      ))}

      <div className="flex items-center gap-2 pt-2 text-xs font-medium">
        {t("nodes.acme.plugins")}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => setDialog("plugin")}
        >
          <Plus className="mr-1 size-3" />
          {t("nodes.acme.plugin.add")}
        </Button>
      </div>
      <State error={plugins.error} loading={!plugins.data && !plugins.error} />
      {dnsPlugins.length === 0 && plugins.data && (
        <p className="text-[11px] text-muted-foreground">
          {t("nodes.acme.plugin.none")}
        </p>
      )}
      {dnsPlugins.map((p) => (
        <div
          key={p.plugin}
          className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
        >
          <span className="font-medium">{p.plugin}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {p.api}
          </span>
          {p.disable ? (
            <Badge variant="outline">{t("nodes.acme.plugin.disabled")}</Badge>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-destructive"
            onClick={() => void remove("plugin", p.plugin)}
          >
            {t("nodes.acme.remove")}
          </Button>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {t("nodes.acme.hint")}
      </p>

      {dialog === "account" && (
        <AccountDialog
          hostId={hostId}
          onClose={() => setDialog(null)}
          onDone={accounts.load}
        />
      )}
      {dialog === "plugin" && (
        <PluginDialog
          hostId={hostId}
          onClose={() => setDialog(null)}
          onDone={plugins.load}
        />
      )}
      {dialog === "domains" && config.data && (
        <DomainsDialog
          hostId={hostId}
          node={node}
          config={config.data}
          accounts={(accounts.data ?? []).map((a) => a.name)}
          plugins={dnsPlugins.map((p) => p.plugin)}
          onClose={() => setDialog(null)}
          onDone={config.load}
        />
      )}
    </section>
  );
}

function AccountRow({
  hostId,
  name,
  onRemove,
}: {
  hostId: number;
  name: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AcmeAccountInfo | null>(null);
  useEffect(() => {
    pve<AcmeAccountInfo>(hostId, "GET", [
      "cluster",
      "acme",
      "account",
      name,
    ]).then(setInfo, () => setInfo({}));
  }, [hostId, name]);
  return (
    <div className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {[
            info?.account?.contact
              ?.map((c) => c.replace(/^mailto:/, ""))
              .join(", "),
            info?.directory,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {info?.account?.status && (
        <Badge
          variant={info.account.status === "valid" ? "secondary" : "outline"}
        >
          {info.account.status}
        </Badge>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-destructive"
        onClick={onRemove}
      >
        {t("nodes.acme.remove")}
      </Button>
    </div>
  );
}

function AccountDialog({
  hostId,
  onClose,
  onDone,
}: {
  hostId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [directories, setDirectories] = useState<
    Array<{ name: string; url: string }>
  >([]);
  const [form, setForm] = useState<AccountForm>({
    name: "default",
    email: "",
    directory: "",
    acceptTos: false,
    eabKid: "",
    eabHmac: "",
  });
  const [tos, setTos] = useState<string | null>(null);
  const set = (patch: Partial<AccountForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    pve<Array<{ name: string; url: string }>>(hostId, "GET", [
      "cluster",
      "acme",
      "directories",
    ]).then((list) => {
      setDirectories(list ?? []);
      if (list?.[0]) set({ directory: list[0].url });
    });
  }, [hostId]);

  // Each directory has its own terms of service, which must be accepted.
  useEffect(() => {
    if (!/^https?:\/\//.test(form.directory)) return;
    setTos(null);
    pve<string | null>(hostId, "GET", ["cluster", "acme", "tos"], {
      directory: form.directory,
    }).then(
      (url) => setTos(url || null),
      () => setTos(null),
    );
  }, [hostId, form.directory]);

  const problem = accountProblem(form, tos);
  const custom = !directories.some((d) => d.url === form.directory);

  return (
    <FormDialog
      title={t("nodes.acme.account.addTitle")}
      submitLabel={t("nodes.acme.account.register")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["cluster", "acme", "account"],
          accountParams(form, tos),
        );
        await track(
          upid,
          t("nodes.acme.account.registerLabel", { name: form.name }),
        );
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("nodes.acme.account.name")}
              error={fieldError("name")}
            >
              <TextInput value={form.name} onChange={(name) => set({ name })} />
            </Field>
            <Field
              label={t("nodes.acme.account.email")}
              error={fieldError("contact")}
            >
              <TextInput
                value={form.email}
                onChange={(email) => set({ email })}
                placeholder="admin@example.com"
              />
            </Field>
          </div>
          <Field label={t("nodes.acme.account.directory")}>
            <SelectInput
              value={custom ? "" : form.directory}
              onChange={(directory) => set({ directory })}
              options={[
                ...directories.map((d) => ({ value: d.url, label: d.name })),
                { value: "", label: t("nodes.acme.account.customDirectory") },
              ]}
            />
          </Field>
          {custom && (
            <Field label={t("nodes.acme.account.directoryUrl")}>
              <TextInput
                value={form.directory}
                onChange={(directory) => set({ directory })}
                placeholder="https://acme.example.com/directory"
              />
            </Field>
          )}
          {tos && (
            <CheckField
              label={t("nodes.acme.account.acceptTos")}
              hint={tos}
              checked={form.acceptTos}
              onChange={(acceptTos) => set({ acceptTos })}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("nodes.acme.account.eabKid")}
              hint={t("nodes.acme.account.eabHint")}
            >
              <TextInput
                value={form.eabKid}
                onChange={(eabKid) => set({ eabKid })}
              />
            </Field>
            <Field label={t("nodes.acme.account.eabHmac")}>
              <TextInput
                type="password"
                value={form.eabHmac}
                onChange={(eabHmac) => set({ eabHmac })}
              />
            </Field>
          </div>
          {problem && form.email && (
            <p className="text-[11px] text-destructive">
              {t(`nodes.acme.account.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

function PluginDialog({
  hostId,
  onClose,
  onDone,
}: {
  hostId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [schemas, setSchemas] = useState<ChallengeSchema[]>([]);
  const [id, setId] = useState("");
  const [api, setApi] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [delay, setDelay] = useState("30");

  useEffect(() => {
    pve<ChallengeSchema[]>(hostId, "GET", [
      "cluster",
      "acme",
      "challenge-schema",
    ]).then((list) => setSchemas((list ?? []).filter((s) => s.type === "dns")));
  }, [hostId]);

  const schema = schemas.find((s) => s.id === api);
  const schemaFields = Object.entries(schema?.schema?.fields ?? {});
  const delayN = Number(delay);
  const problem =
    pluginIdProblem(id) ??
    (!api ? "api" : null) ??
    (!Number.isInteger(delayN) || delayN < 0 || delayN > 172800
      ? "delay"
      : null);

  return (
    <FormDialog
      title={t("nodes.acme.plugin.addTitle")}
      submitLabel={t("nodes.acme.plugin.add")}
      canSubmit={!problem}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "POST", ["cluster", "acme", "plugins"], {
          id,
          type: "dns",
          api,
          data: encodePluginData(fields),
          "validation-delay": delayN,
        });
        onDone();
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("nodes.acme.plugin.id")} error={fieldError("id")}>
              <TextInput value={id} onChange={setId} placeholder="cloudflare" />
            </Field>
            <Field label={t("nodes.acme.plugin.api")}>
              <SelectInput
                value={api}
                placeholder={t("nodes.acme.plugin.pickApi")}
                onChange={(v) => {
                  setApi(v);
                  setFields({});
                }}
                options={schemas.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field
              label={t("nodes.acme.plugin.delay")}
              hint={t("nodes.acme.plugin.delayHint")}
            >
              <TextInput
                type="number"
                min={0}
                value={delay}
                onChange={setDelay}
              />
            </Field>
          </div>
          {schemaFields.map(([key, f]) => (
            <Field key={key} label={key} hint={f.description}>
              <TextInput
                type={/PASS|TOKEN|SECRET|KEY/i.test(key) ? "password" : "text"}
                value={fields[key] ?? ""}
                onChange={(v) => setFields((prev) => ({ ...prev, [key]: v }))}
              />
            </Field>
          ))}
          {api && schemaFields.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("nodes.acme.plugin.noFields")}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

function DomainsDialog({
  hostId,
  node,
  config,
  accounts,
  plugins,
  onClose,
  onDone,
}: {
  hostId: number;
  node: string;
  config: Record<string, unknown>;
  accounts: string[];
  plugins: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<AcmeNodeConfig>(() => {
    const parsed = parseAcmeConfig(config);
    return {
      account: parsed.account || accounts[0] || "",
      domains: parsed.domains.length
        ? parsed.domains
        : [{ domain: "", plugin: "", alias: "" }],
    };
  });
  const problem = acmeConfigProblem(form);
  const setDomain = (i: number, patch: Partial<AcmeNodeConfig["domains"][0]>) =>
    setForm((f) => ({
      ...f,
      domains: f.domains.map((d, j) => (j === i ? { ...d, ...patch } : d)),
    }));

  return (
    <FormDialog
      title={t("nodes.acme.domainsTitle", { node })}
      submitLabel={t("app.save")}
      canSubmit={!problem && !!form.account}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "PUT", ["nodes", node, "config"], {
          ...acmeConfigParams(form, config),
          digest: config.digest as string,
        });
        toast.success(t("nodes.acme.domainsSaved"));
        onDone();
      }}
    >
      {() => (
        <>
          <Field label={t("nodes.acme.account.title")}>
            <SelectInput
              value={form.account}
              placeholder={t("nodes.acme.account.pick")}
              onChange={(account) => setForm((f) => ({ ...f, account }))}
              options={accounts.map((a) => ({ value: a, label: a }))}
            />
          </Field>
          {form.domains.map((d, i) => (
            <div
              key={i}
              className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2"
            >
              <Field label={i === 0 ? t("nodes.acme.domain") : ""}>
                <TextInput
                  value={d.domain}
                  onChange={(domain) => setDomain(i, { domain })}
                  placeholder="pve.example.com"
                />
              </Field>
              <Field label={i === 0 ? t("nodes.acme.challenge") : ""}>
                <SelectInput
                  value={d.plugin}
                  onChange={(plugin) => setDomain(i, { plugin })}
                  options={[
                    { value: "", label: "HTTP" },
                    ...plugins.map((p) => ({ value: p, label: `DNS: ${p}` })),
                  ]}
                />
              </Field>
              <Field label={i === 0 ? t("nodes.acme.alias") : ""}>
                <TextInput
                  value={d.alias}
                  onChange={(alias) => setDomain(i, { alias })}
                  placeholder={d.plugin ? "_acme.example.org" : ""}
                />
              </Field>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                aria-label={t("nodes.acme.remove")}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    domains: f.domains.filter((_, j) => j !== i),
                  }))
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {form.domains.length < MAX_ACME_DOMAINS && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  domains: [
                    ...f.domains,
                    { domain: "", plugin: "", alias: "" },
                  ],
                }))
              }
            >
              <Plus className="mr-1 size-3" />
              {t("nodes.acme.addDomain")}
            </Button>
          )}
          {accounts.length === 0 && (
            <p className="text-[11px] text-destructive">
              {t("nodes.acme.account.needOne")}
            </p>
          )}
          {problem && form.domains.some((d) => d.domain) && (
            <p className="text-[11px] text-destructive">
              {t(`nodes.acme.problem.${problem}`)}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t("nodes.acme.httpHint")}
          </p>
        </>
      )}
    </FormDialog>
  );
}

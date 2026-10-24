import { useEffect, useMemo, useState } from "react";
import {
  listCredentials,
  notifyHostsChanged,
  useToast,
  useTranslation,
  type PluginCredentialSummary,
} from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button, Select2 } from "@termix-ssh/plugin-sdk/ui";
import { app, toCallError, type GuestType } from "../api";
import { FolderPicker } from "./FolderPicker";
import { CheckField, Field, FormDialog, SelectInput, TextInput } from "./forms";
import {
  defaultConnection,
  loginOption,
  parseLoginOption,
  suggestedRuntime,
  type Connection,
  type ImportLogin,
  type Runtime,
} from "./importChoices";

interface ImportGuest {
  type: GuestType;
  vmid: number;
  name: string;
  node: string;
  status: string;
  ip: string | null;
  os: { family: "windows" | "linux" | "other"; label: string | null };
  runtimes: { docker: boolean; podman: boolean } | null;
  /** The Termix host it was imported as, if it was. */
  hostId: number | null;
}

interface ImportDefaults {
  folder: string;
  ssh: ImportLogin;
  desktop: ImportLogin;
}

interface ImportInfo {
  guests: ImportGuest[];
  defaults: ImportDefaults;
  nodeHasCredential: boolean;
  nodeName: string;
  state: { lastSyncAt?: string; status?: string; error?: string } | null;
}

interface SyncResult {
  created: number;
  updated: number;
  markedMissing: number;
  errors: string[];
  /** The Termix hosts created now, by guest key. */
  hosts: Record<string, number>;
}

interface Choice {
  connection: Connection;
  runtime: Runtime | null;
}

const key = (g: { type: string; vmid: number }) => `${g.type}:${g.vmid}`;
const CONNECTIONS: Connection[] = ["ssh", "rdp", "vnc"];
const compact =
  "h-7 w-auto shrink-0 border border-border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring";

/**
 * Picks guests to add as Termix hosts. Importing also refreshes the ones added
 * before. With `only`, it offers that one guest, as the Console button does.
 */
export function ImportDialog({
  hostId,
  only,
  onImported,
  onClose,
}: {
  hostId: number;
  only?: { type: GuestType; vmid: number; name: string };
  onImported?: (hosts: Record<string, number>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [info, setInfo] = useState<ImportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [credentials, setCredentials] = useState<PluginCredentialSummary[]>([]);
  const [defaults, setDefaults] = useState<ImportDefaults | null>(null);

  const onlyKey = only ? key(only) : null;

  useEffect(() => {
    let cancelled = false;
    app()
      .api.get<ImportInfo>(
        `/hosts/${hostId}/import${onlyKey ? `?only=${encodeURIComponent(onlyKey)}` : ""}`,
      )
      .then(({ data }) => {
        if (cancelled) return;
        setInfo(data);
        setDefaults(data.defaults);
        setChoices(
          Object.fromEntries(
            data.guests.map((g) => [
              key(g),
              {
                connection: defaultConnection(g.os.family),
                runtime: suggestedRuntime(g.runtimes),
              },
            ]),
          ),
        );
        // New guests with an address are what people import most; the one
        // guest asked for is picked either way.
        setSelected(
          new Set(
            data.guests.filter((g) => !g.hostId && (g.ip || onlyKey)).map(key),
          ),
        );
      })
      .catch((err) => !cancelled && setError(toCallError(err).message));
    // Without credentials.view the list is empty: username and none still work.
    listCredentials()
      .then((list) => !cancelled && setCredentials(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hostId, onlyKey]);

  const fresh = useMemo(
    () => info?.guests.filter((g) => !g.hostId) ?? [],
    [info],
  );
  const importedCount = (info?.guests.length ?? 0) - fresh.length;
  const toggle = (k: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  const choose = (k: string, patch: Partial<Choice>) =>
    setChoices((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  const picked = [...selected].map((k) => choices[k]?.connection);
  const needsSsh = picked.includes("ssh");
  const needsDesktop = picked.some((c) => c === "rdp" || c === "vnc");

  return (
    <FormDialog
      title={
        only ? t("import.addTitle", { name: only.name }) : t("import.title")
      }
      submitLabel={
        only
          ? t("import.addSubmit")
          : selected.size
            ? t("import.submit", { count: selected.size })
            : t("import.refresh")
      }
      canSubmit={!!info && (selected.size > 0 || (!only && importedCount > 0))}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const { data } = await app().api.post<SyncResult>(
          `/hosts/${hostId}/import`,
          {
            guests: info!.guests
              .filter((g) => selected.has(key(g)))
              .map((g) => {
                const c = choices[key(g)];
                return {
                  type: g.type,
                  vmid: g.vmid,
                  connection: c.connection,
                  runtime: c.connection === "ssh" ? c.runtime : null,
                };
              }),
            defaults,
          },
        );
        notifyHostsChanged();
        if (!only) toast.success(t("import.done", { ...data }));
        for (const line of data.errors) toast.error(line);
        onImported?.(data.hosts ?? {});
      }}
    >
      {() => (
        <>
          <p className="text-xs text-muted-foreground">
            {t(only ? "import.addHint" : "import.hint")}
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {!info && !error && (
            <p className="text-xs text-muted-foreground">
              {t("import.loading")}
            </p>
          )}
          {info && defaults && (
            <>
              <div
                className={`flex items-center gap-2 text-xs ${only ? "hidden" : ""}`}
              >
                <span className="text-muted-foreground">
                  {t("import.counts", {
                    total: info.guests.length,
                    imported: importedCount,
                  })}
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6"
                  onClick={() => setSelected(new Set(fresh.map(key)))}
                >
                  {t("import.selectAll")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6"
                  onClick={() => setSelected(new Set())}
                >
                  {t("import.selectNone")}
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto border border-border/60 p-2">
                {info.guests.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(only ? "import.gone" : "import.none")}
                  </p>
                )}
                {info.guests.map((g) => {
                  const k = key(g);
                  const choice = choices[k];
                  return (
                    <div
                      key={k}
                      className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        {g.hostId ? (
                          <span className="flex flex-col pl-6 text-xs">
                            {g.vmid} {g.name}
                            <span className="text-[11px] text-muted-foreground">
                              {describe(t, g)}
                            </span>
                          </span>
                        ) : (
                          <CheckField
                            label={`${g.vmid} ${g.name}`}
                            hint={describe(t, g)}
                            checked={selected.has(k)}
                            onChange={(on) => toggle(k, on)}
                          />
                        )}
                      </div>
                      {g.hostId ? (
                        <Badge variant="secondary">
                          {t("import.imported")}
                        </Badge>
                      ) : (
                        choice && (
                          <>
                            {choice.connection === "ssh" &&
                              g.runtimes &&
                              (g.runtimes.docker || g.runtimes.podman) && (
                                <Select2
                                  aria-label={t("import.runtime")}
                                  value={choice.runtime ?? ""}
                                  onChange={(e) =>
                                    choose(k, {
                                      runtime:
                                        (e.target.value as Runtime) || null,
                                    })
                                  }
                                  className={compact}
                                >
                                  <option value="">
                                    {t("import.runtimeOff")}
                                  </option>
                                  {g.runtimes.docker && (
                                    <option value="docker">Docker</option>
                                  )}
                                  {g.runtimes.podman && (
                                    <option value="podman">Podman</option>
                                  )}
                                </Select2>
                              )}
                            <Select2
                              aria-label={t("import.connection")}
                              value={choice.connection}
                              onChange={(e) =>
                                choose(k, {
                                  connection: e.target.value as Connection,
                                })
                              }
                              className={compact}
                            >
                              {CONNECTIONS.map((c) => (
                                <option key={c} value={c}>
                                  {t(`import.connections.${c}`)}
                                </option>
                              ))}
                            </Select2>
                          </>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              <Field label={t("import.folder")}>
                <FolderPicker
                  value={defaults.folder}
                  onChange={(folder) =>
                    setDefaults((d) => d && { ...d, folder })
                  }
                  emptyLabel={t("import.folderDefault", {
                    node: info.nodeName,
                  })}
                />
              </Field>
              {(needsSsh || !needsDesktop) && (
                <LoginField
                  label={t("import.sshLogin")}
                  login={defaults.ssh}
                  credentials={credentials}
                  nodeOption={
                    info.nodeHasCredential
                      ? t("import.login.nodeCredential")
                      : t("import.login.nodeUser")
                  }
                  onChange={(ssh) => setDefaults((d) => d && { ...d, ssh })}
                />
              )}
              {needsDesktop && (
                <LoginField
                  label={t("import.desktopLogin")}
                  login={defaults.desktop}
                  credentials={credentials}
                  onChange={(desktop) =>
                    setDefaults((d) => d && { ...d, desktop })
                  }
                  hint={t("import.desktopHint")}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                {info.state?.lastSyncAt
                  ? t(
                      info.state.status === "error"
                        ? "import.lastSyncFailed"
                        : "import.lastSync",
                      {
                        when: new Date(info.state.lastSyncAt).toLocaleString(),
                        error: info.state.error ?? "",
                      },
                    )
                  : t("import.syncHint")}
              </p>
            </>
          )}
        </>
      )}
    </FormDialog>
  );
}

/** How new guests sign in: a saved credential, a username, or nothing. */
function LoginField({
  label,
  login,
  credentials,
  nodeOption,
  hint,
  onChange,
}: {
  label: string;
  login: ImportLogin;
  credentials: PluginCredentialSummary[];
  /** Offered for SSH: sign in like the node does. */
  nodeOption?: string;
  hint?: string;
  onChange: (login: ImportLogin) => void;
}) {
  const { t } = useTranslation();
  const options = [
    ...(nodeOption ? [{ value: "node", label: nodeOption }] : []),
    ...credentials.map((c) => ({
      value: `credential:${c.id}`,
      label: c.username ? `${c.name} (${c.username})` : c.name,
    })),
    { value: "username", label: t("import.login.username") },
    { value: "none", label: t("import.login.none") },
  ];
  return (
    <div
      className={`grid gap-3 ${login.mode === "username" ? "grid-cols-2" : "grid-cols-1"}`}
    >
      <Field label={label} hint={hint}>
        <SelectInput
          value={loginOption(login)}
          options={options}
          onChange={(value) => onChange(parseLoginOption(value, login))}
        />
      </Field>
      {login.mode === "username" && (
        <Field label={t("import.username")}>
          <TextInput
            value={login.username}
            onChange={(username) => onChange({ ...login, username })}
            placeholder="root"
          />
        </Field>
      )}
    </div>
  );
}

function describe(
  t: ReturnType<typeof useTranslation>["t"],
  g: ImportGuest,
): string {
  return [
    t(`types.${g.type}`),
    g.os.label ?? t(`import.os.${g.os.family}`),
    g.node,
    t(`states.${g.status}`, { defaultValue: g.status }),
    g.ip ?? t("import.noAddress"),
  ].join(" · ");
}

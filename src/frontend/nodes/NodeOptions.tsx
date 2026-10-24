import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, GroupHeading, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { Pencil } from "lucide-react";
import { pve } from "../api";
import { Fact } from "../components/Usage";
import { Field, FormDialog, TextInput } from "../components/forms";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";

/** The parts of GET /nodes/{node}/config the Notes and Options sections show. */
export interface NodeConfig {
  description?: string;
  "startall-onboot-delay"?: number;
  wakeonlan?: string;
}

const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

export function optionsProblem(delay: string, mac: string): string | null {
  if (delay && !(/^\d+$/.test(delay) && Number(delay) <= 300)) return "delay";
  if (mac && !MAC_RE.test(mac)) return "mac";
  return null;
}

/**
 * PUT params: emptied fields are deleted rather than saved blank. No digest:
 * Notes and Options load the config apart, and a save in one would make the
 * other's digest stale though they touch different keys.
 */
export function optionsParams(
  delay: string,
  mac: string,
): Record<string, string | number | undefined> {
  const cleared = [
    !delay && "startall-onboot-delay",
    !mac && "wakeonlan",
  ].filter(Boolean);
  return {
    "startall-onboot-delay": delay ? Number(delay) : undefined,
    wakeonlan: mac ? mac.toLowerCase().replace(/-/g, ":") : undefined,
    delete: cleared.length ? cleared.join(",") : undefined,
  };
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

/** Proxmox's node Notes, kept in the node config's description. */
export function NotesSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<NodeConfig>(
    hostId,
    ["nodes", node, "config"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.notes.title")}
        action={
          data ? (
            <EditButton
              onClick={() => {
                setText(data.description ?? "");
                setEditing(true);
              }}
            />
          ) : null
        }
      />
      <State error={error} loading={!data && !error} />
      {data &&
        (data.description?.trim() ? (
          <p className="text-xs whitespace-pre-wrap">{data.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("nodes.notes.empty")}
          </p>
        ))}
      {editing && data && (
        <FormDialog
          title={t("nodes.notes.editTitle", { node })}
          submitLabel={t("app.save")}
          wide
          onClose={() => setEditing(false)}
          onSubmit={async () => {
            await pve(
              hostId,
              "PUT",
              ["nodes", node, "config"],
              text.trim() ? { description: text } : { delete: "description" },
            );
            toast.success(t("nodes.notes.saved"));
            void load();
          }}
        >
          {() => (
            <Field label={t("nodes.notes.title")} hint={t("nodes.notes.hint")}>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </Field>
          )}
        </FormDialog>
      )}
    </section>
  );
}

/** Proxmox's node Options: the delay before guests start on boot, and Wake-on-LAN. */
export function OptionsSection({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<NodeConfig>(
    hostId,
    ["nodes", node, "config"],
    undefined,
    isVisible,
  );
  const [editing, setEditing] = useState(false);
  const [delay, setDelay] = useState("");
  const [mac, setMac] = useState("");
  const problem = optionsProblem(delay, mac);
  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("nodes.options.title")}
        action={
          data ? (
            <EditButton
              onClick={() => {
                setDelay(
                  data["startall-onboot-delay"] !== undefined
                    ? String(data["startall-onboot-delay"])
                    : "",
                );
                setMac(data.wakeonlan ?? "");
                setEditing(true);
              }}
            />
          ) : null
        }
      />
      <State error={error} loading={!data && !error} />
      {data && (
        <>
          <Fact label={t("nodes.options.delay")}>
            {data["startall-onboot-delay"] !== undefined
              ? t("nodes.options.seconds", {
                  count: data["startall-onboot-delay"],
                })
              : t("nodes.options.none")}
          </Fact>
          <Fact label={t("nodes.options.wakeonlan")}>
            {data.wakeonlan || t("nodes.options.none")}
          </Fact>
        </>
      )}
      {editing && data && (
        <FormDialog
          title={t("nodes.options.editTitle", { node })}
          submitLabel={t("app.save")}
          canSubmit={!problem}
          onClose={() => setEditing(false)}
          onSubmit={async () => {
            await pve(
              hostId,
              "PUT",
              ["nodes", node, "config"],
              optionsParams(delay, mac),
            );
            toast.success(t("nodes.options.saved"));
            void load();
          }}
        >
          {(fieldError) => (
            <>
              <Field
                label={t("nodes.options.delay")}
                hint={t("nodes.options.delayHint")}
                error={
                  fieldError("startall-onboot-delay") ??
                  (problem === "delay"
                    ? t("nodes.options.problem.delay")
                    : undefined)
                }
              >
                <TextInput
                  type="number"
                  value={delay}
                  onChange={setDelay}
                  placeholder="0"
                />
              </Field>
              <Field
                label={t("nodes.options.wakeonlan")}
                hint={t("nodes.options.wakeonlanHint")}
                error={
                  fieldError("wakeonlan") ??
                  (problem === "mac"
                    ? t("nodes.options.problem.mac")
                    : undefined)
                }
              >
                <TextInput
                  value={mac}
                  onChange={setMac}
                  placeholder="aa:bb:cc:dd:ee:ff"
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </section>
  );
}

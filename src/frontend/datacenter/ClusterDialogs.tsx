import { useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { PasswordInput, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { pve } from "../api";
import { useTasks } from "../tasks";
import { Field, FormDialog, TextInput } from "../components/forms";
import {
  createClusterParams,
  createClusterProblem,
  joinClusterParams,
  parseJoinInformation,
} from "./cluster";

/** Makes this standalone node the first node of a new cluster. */
export function CreateClusterDialog({
  hostId,
  nodeIp,
  onClose,
  onDone,
}: {
  hostId: number;
  nodeIp: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [form, setForm] = useState({ name: "", link0: nodeIp, link1: "" });
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  const problem = createClusterProblem(form);
  return (
    <FormDialog
      title={t("cluster.createTitle")}
      submitLabel={t("cluster.create")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["cluster", "config"],
          createClusterParams(form),
        );
        void track(upid, t("cluster.createLabel", { name: form.name })).then(
          onDone,
        );
      }}
    >
      {(fieldError) => (
        <>
          <Field
            label={t("cluster.name")}
            hint={t("cluster.nameHint")}
            error={fieldError("clustername")}
          >
            <TextInput
              value={form.name}
              onChange={(name) => set({ name })}
              placeholder="pve-cluster"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("cluster.link0")} hint={t("cluster.linkHint")}>
              <TextInput
                value={form.link0}
                onChange={(link0) => set({ link0 })}
              />
            </Field>
            <Field label={t("cluster.link1")}>
              <TextInput
                value={form.link1}
                onChange={(link1) => set({ link1 })}
              />
            </Field>
          </div>
          {problem && form.name && (
            <p className="text-[11px] text-destructive">
              {t(`cluster.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

/**
 * Joins this node to an existing cluster with the Join Information copied
 * there and the root password of the cluster node it names.
 */
export function JoinClusterDialog({
  hostId,
  nodeIp,
  hasGuests,
  onClose,
  onDone,
}: {
  hostId: number;
  nodeIp: string;
  hasGuests: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [form, setForm] = useState({ info: "", password: "", link0: nodeIp });
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  const parsed = form.info.trim() ? parseJoinInformation(form.info) : null;
  return (
    <FormDialog
      title={t("cluster.joinTitle")}
      submitLabel={t("cluster.join")}
      destructive
      canSubmit={!!parsed && !!form.password}
      wide
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["cluster", "config", "join"],
          joinClusterParams(form),
        );
        void track(
          upid,
          t("cluster.joinLabel", { peer: parsed?.ipAddress ?? "" }),
        ).then(onDone);
      }}
    >
      {() => (
        <>
          {hasGuests && (
            <p className="text-[11px] text-destructive">
              {t("cluster.hasGuests")}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t("cluster.joinWarning")}
          </p>
          <Field label={t("cluster.joinInfo")} hint={t("cluster.joinInfoHint")}>
            <Textarea
              value={form.info}
              onChange={(e) => set({ info: e.target.value })}
              rows={4}
              className="font-mono text-[11px]"
            />
          </Field>
          {form.info.trim() && !parsed && (
            <p className="text-[11px] text-destructive">
              {t("cluster.badInfo")}
            </p>
          )}
          {parsed && (
            <p className="text-[11px] text-muted-foreground">
              {t("cluster.peer", { peer: parsed.ipAddress })}
              <br />
              <span className="font-mono">{parsed.fingerprint}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("cluster.password")}
              hint={t("cluster.passwordHint")}
            >
              <PasswordInput
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                className="h-8 text-xs"
                autoComplete="off"
              />
            </Field>
            <Field label={t("cluster.link0")} hint={t("cluster.linkHint")}>
              <TextInput
                value={form.link0}
                onChange={(link0) => set({ link0 })}
              />
            </Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}

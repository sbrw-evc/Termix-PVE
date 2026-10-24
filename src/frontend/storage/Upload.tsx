import { useRef, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, getBasePath } from "@termix-ssh/plugin-sdk/ui";
import { Upload as UploadIcon, X } from "lucide-react";
import { PLUGIN_ID } from "../api";
import { formatBytes } from "../format";

const EXTENSIONS: Record<"iso" | "vztmpl", string> = {
  iso: ".iso,.img",
  vztmpl: ".tar.gz,.tar.xz,.tar.zst,.tgz",
};

export function uploadUrl(
  hostId: number,
  node: string,
  storage: string,
  content: "iso" | "vztmpl",
  filename: string,
): string {
  const query = new URLSearchParams({ node, storage, content, filename });
  return `${getBasePath()}/plugin-api/${PLUGIN_ID}/hosts/${hostId}/upload?${query}`;
}

/** A file name the server takes: no spaces or odd characters. */
export function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._+-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
}

/**
 * Uploads one file with progress. XHR rather than fetch, because fetch can't
 * report upload progress. The session cookie authenticates it like app.api.
 */
export function UploadButton({
  hostId,
  node,
  storage,
  content,
  onDone,
}: {
  hostId: number;
  node: string;
  storage: string;
  content: "iso" | "vztmpl";
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [progress, setProgress] = useState<{
    name: string;
    sent: number;
    total: number;
  } | null>(null);

  const start = (file: File) => {
    const name = safeFilename(file.name);
    const request = new XMLHttpRequest();
    xhr.current = request;
    request.open("POST", uploadUrl(hostId, node, storage, content, name));
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (e) =>
      setProgress({
        name,
        sent: e.loaded,
        total: e.lengthComputable ? e.total : file.size,
      });
    request.onloadend = () => {
      xhr.current = null;
      setProgress(null);
      if (request.status === 200) {
        toast.success(t("storage.upload.done", { name }));
        onDone();
        return;
      }
      if (request.status === 0) return; // cancelled or the connection dropped
      let error = request.statusText;
      try {
        error =
          (JSON.parse(request.responseText) as { error?: string }).error ??
          error;
      } catch {
        // keep the status text
      }
      toast.error(t("storage.upload.failed", { name, error }));
    };
    setProgress({ name, sent: 0, total: file.size });
    request.send(file);
  };

  if (progress) {
    const pct = progress.total
      ? Math.floor((progress.sent / progress.total) * 100)
      : 0;
    return (
      <div className="flex min-w-60 flex-1 items-center gap-2 text-xs">
        <span className="truncate">{progress.name}</span>
        <div className="h-1.5 min-w-20 flex-1 bg-muted">
          <div
            className="h-full bg-accent-brand transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular-nums text-muted-foreground">
          {pct}% · {formatBytes(progress.sent)} / {formatBytes(progress.total)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          aria-label={t("storage.upload.cancel")}
          onClick={() => xhr.current?.abort()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => input.current?.click()}
      >
        <UploadIcon className="mr-1 size-3.5" />
        {t("storage.upload.button")}
      </Button>
      <input
        ref={input}
        type="file"
        accept={EXTENSIONS[content]}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) start(file);
        }}
      />
    </>
  );
}

import { useRef, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, getBasePath } from "@termix-ssh/plugin-sdk/ui";
import { Upload as UploadIcon, X } from "lucide-react";
import { PLUGIN_ID } from "../api";
import { formatBytes } from "../format";
import {
  CHUNK_TIMEOUT_MS,
  uploadId,
  uploadInChunks,
  type ChunkAnswer,
} from "./chunks";

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
  chunk?: { offset: number; total: number; id: string },
): string {
  const query = new URLSearchParams({ node, storage, content, filename });
  if (chunk) {
    query.set("offset", String(chunk.offset));
    query.set("total", String(chunk.total));
    query.set("upload", chunk.id);
  }
  return `${getBasePath()}/plugin-api/${PLUGIN_ID}/hosts/${hostId}/upload?${query}`;
}

/** One chunk over XHR, the only way to get upload progress in a browser. */
function sendChunk(
  url: string,
  body: Blob,
  onProgress: (sent: number) => void,
  current: { xhr: XMLHttpRequest | null },
): Promise<ChunkAnswer> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    current.xhr = request;
    request.open("POST", url);
    request.withCredentials = true;
    // A connection that hangs gives no error of its own; this turns it into one.
    request.timeout = CHUNK_TIMEOUT_MS;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (e) => onProgress(e.loaded);
    request.onloadend = () => {
      current.xhr = null;
      let parsed: ChunkAnswer["body"] = {};
      try {
        parsed = JSON.parse(request.responseText) as ChunkAnswer["body"];
      } catch {
        parsed = { error: request.statusText || undefined };
      }
      resolve({ status: request.status, body: parsed });
    };
    request.send(body);
  });
}

/** A file name the server takes: no spaces or odd characters. */
export function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._+-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
}

/**
 * Uploads one file in chunks, with progress counted by what the node has.
 * The session cookie authenticates it like app.api.
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
  const current = useRef<{ xhr: XMLHttpRequest | null; cancelled: boolean }>({
    xhr: null,
    cancelled: false,
  });
  const [progress, setProgress] = useState<{
    name: string;
    sent: number;
    total: number;
  } | null>(null);

  const start = async (file: File) => {
    const name = safeFilename(file.name);
    const id = uploadId();
    const state = { xhr: null as XMLHttpRequest | null, cancelled: false };
    current.current = state;
    const url = (offset: number) =>
      uploadUrl(hostId, node, storage, content, name, {
        offset,
        total: file.size,
        id,
      });
    setProgress({ name, sent: 0, total: file.size });
    try {
      await uploadInChunks({
        total: file.size,
        send: (offset, end, onChunk) =>
          sendChunk(url(offset), file.slice(offset, end), onChunk, state),
        onProgress: (sent) =>
          setProgress({
            name,
            sent: Math.min(sent, file.size),
            total: file.size,
          }),
        cancelled: () => state.cancelled,
      });
      toast.success(t("storage.upload.done", { name }));
      onDone();
    } catch (err) {
      // Leave nothing half-written on the node.
      void fetch(url(0), { method: "DELETE", credentials: "include" }).catch(
        () => undefined,
      );
      if (!state.cancelled) {
        toast.error(
          t("storage.upload.failed", {
            name,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } finally {
      setProgress(null);
    }
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
          onClick={() => {
            current.current.cancelled = true;
            current.current.xhr?.abort();
          }}
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
          if (file) void start(file);
        }}
      />
    </>
  );
}

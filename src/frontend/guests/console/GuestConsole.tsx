import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@termix-ssh/plugin-sdk/ui";
import { Maximize2, Plug, PlugZap, Unplug } from "lucide-react";
import RFB from "@novnc/novnc";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { app, type GuestType } from "../../api";

type Status = "idle" | "connecting" | "connected" | "closed" | "error";

interface ReadyMessage {
  t: "ready";
  kind: "vnc" | "term";
  password?: string;
}

interface ErrorMessage {
  t: "error";
  message: string;
}

/** The first frame the server sends, or null for anything else. */
export function readControl(data: unknown): ReadyMessage | ErrorMessage | null {
  if (typeof data !== "string") return null;
  try {
    const message = JSON.parse(data) as { t?: string };
    return message.t === "ready" || message.t === "error"
      ? (message as ReadyMessage | ErrorMessage)
      : null;
  } catch {
    return null;
  }
}

/** VNC asks only for a password; the type wants the other fields too. */
function vncCredentials(password: string) {
  return { username: "", target: "", password };
}

/** A guest's console, or a node-wide terminal session such as the Ceph install. */
export type ConsoleKind = GuestType | "ceph-install";

export function consolePath(
  hostId: number,
  node: string,
  type: ConsoleKind,
  vmid: number,
  size?: { cols: number; rows: number },
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({
    hostId: String(hostId),
    node,
    type,
    vmid: String(vmid),
    ...(size ? { cols: String(size.cols), rows: String(size.rows) } : {}),
    ...(extra ?? {}),
  });
  return `/console?${params}`;
}

async function openSocket(path: string): Promise<WebSocket> {
  const target = await app().wsUrl(path);
  if (!target) throw new Error("No socket address");
  const ws = new WebSocket(target.url, target.protocols);
  ws.binaryType = "arraybuffer";
  return ws;
}

export function GuestConsole({
  hostId,
  node,
  type,
  vmid,
  running = true,
  fill,
  autoConnect,
  isVisible = true,
  extra,
  fallbackUrl,
}: {
  hostId: number;
  node: string;
  type: ConsoleKind;
  vmid: number;
  /** More query params, such as the Ceph version to install. */
  extra?: Record<string, string>;
  /** Proxmox's own console page, offered when this one can't connect. */
  fallbackUrl?: string;
  /** Unknown in a tab of its own: the node says so if the guest is off. */
  running?: boolean;
  /** Take the whole height of the parent, as in a console tab. */
  fill?: boolean;
  /** Connect on open, like Proxmox's console window. */
  autoConnect?: boolean;
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const screen = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);

  // Closing the tab or picking another guest ends the session.
  useEffect(() => disconnect, [disconnect, hostId, node, type, vmid]);

  const connectVnc = async (target: HTMLDivElement) => {
    const ws = await openSocket(consolePath(hostId, node, type, vmid));
    ws.onmessage = (event) => {
      const control = readControl(event.data);
      if (control?.t === "error") {
        setStatus("error");
        setMessage(control.message);
        return;
      }
      if (control?.t !== "ready" || !control.password) return;
      ws.onmessage = null;
      // noVNC takes the open socket over from here; VNC flows as binary.
      const viewer = new RFB(target, ws, {
        credentials: vncCredentials(control.password),
      });
      viewer.scaleViewport = true;
      viewer.background = "#000";
      viewer.addEventListener("connect", () => setStatus("connected"));
      viewer.addEventListener("credentialsrequired", () =>
        viewer.sendCredentials(vncCredentials(control.password!)),
      );
      viewer.addEventListener("disconnect", (e: Event) => {
        const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
        setStatus(clean ? "closed" : "error");
        if (!clean) setMessage(t("console.lost"));
      });
      rfb.current = viewer;
    };
    ws.onclose = () => setStatus((s) => (s === "connecting" ? "error" : s));
    cleanup.current = () => {
      rfb.current?.disconnect();
      rfb.current = null;
      ws.close();
      target.replaceChildren();
    };
  };

  const connectTerminal = async (target: HTMLDivElement) => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      cursorBlink: true,
      theme: { background: "#000000" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(target);
    fit.fit();
    const ws = await openSocket(
      consolePath(
        hostId,
        node,
        type,
        vmid,
        { cols: term.cols, rows: term.rows },
        extra,
      ),
    );
    const decoder = new TextDecoder();
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const control = readControl(event.data);
        if (control?.t === "ready") {
          setStatus("connected");
          term.focus();
        } else if (control?.t === "error") {
          setStatus("error");
          setMessage(control.message);
        }
        return;
      }
      term.write(new Uint8Array(event.data as ArrayBuffer));
    };
    ws.onclose = () => {
      setStatus((s) =>
        s === "connected" ? "closed" : s === "connecting" ? "error" : s,
      );
      term.write(
        `\r\n${decoder.decode()}\x1b[90m${t("console.ended")}\x1b[0m\r\n`,
      );
    };
    const input = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: "d", d }));
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: "r", c: cols, r: rows }));
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(target);
    cleanup.current = () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      ws.close();
      term.dispose();
      target.replaceChildren();
    };
  };

  const connect = async () => {
    const target = screen.current;
    if (!target) return;
    disconnect();
    setMessage(null);
    setStatus("connecting");
    try {
      if (type === "qemu") await connectVnc(target);
      else await connectTerminal(target);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Once, on open: later the buttons decide.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoConnect || opened.current || !isVisible) return;
    opened.current = true;
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, isVisible]);

  const live = status === "connecting" || status === "connected";

  return (
    <div className={`flex flex-col gap-2 ${fill ? "h-full" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {live ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              disconnect();
              setStatus("closed");
            }}
          >
            <Unplug className="mr-1 size-3.5" />
            {t("console.disconnect")}
          </Button>
        ) : (
          <Button size="sm" disabled={!running} onClick={() => void connect()}>
            <Plug className="mr-1 size-3.5" />
            {t(status === "idle" ? "console.connect" : "console.reconnect")}
          </Button>
        )}
        {type === "qemu" && status === "connected" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => rfb.current?.sendCtrlAltDel()}
          >
            <PlugZap className="mr-1 size-3.5" />
            {t("console.ctrlAltDel")}
          </Button>
        )}
        {status === "connected" && (
          <Button
            size="sm"
            variant="ghost"
            title={t("console.fullscreen")}
            onClick={() => void screen.current?.requestFullscreen?.()}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {!running ? t("console.notRunning") : t(`console.status.${status}`)}
        </span>
      </div>
      {status === "error" && fallbackUrl && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            window.open(fallbackUrl, "_blank", "noopener,noreferrer")
          }
        >
          {t("console.openInProxmox")}
        </Button>
      )}
      {message && (
        <p
          role="alert"
          className="text-xs text-destructive whitespace-pre-wrap"
        >
          {message}
        </p>
      )}
      <div
        ref={screen}
        className={`w-full overflow-hidden border border-border bg-black p-1 ${
          fill ? "min-h-0 flex-1" : "h-[60vh] min-h-80"
        }`}
      />
    </div>
  );
}

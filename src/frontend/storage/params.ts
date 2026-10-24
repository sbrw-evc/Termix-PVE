import type { PveParams } from "../api";

export type ContentKind = "iso" | "vztmpl" | "backup" | "images" | "rootdir";

/** Content tabs a storage shows, in this order, for what it holds. */
export function contentTabs(content: string): ContentKind[] {
  const has = new Set(content.split(",").map((c) => c.trim()));
  const tabs: ContentKind[] = [];
  if (has.has("iso")) tabs.push("iso");
  if (has.has("vztmpl")) tabs.push("vztmpl");
  if (has.has("backup")) tabs.push("backup");
  // Container and VM disks list together under disk images.
  if (has.has("images") || has.has("rootdir")) tabs.push("images");
  return tabs;
}

/** What /content takes as its content filter for a tab. */
export function contentFilter(kind: ContentKind): string | undefined {
  return kind === "images" ? undefined : kind;
}

export interface DownloadForm {
  url: string;
  filename: string;
  checksum: string;
  algorithm: "" | "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";
  verify: boolean;
}

const FILE_EXT: Record<"iso" | "vztmpl", RegExp> = {
  iso: /\.(iso|img)$/i,
  vztmpl: /\.(tar\.(gz|xz|zst)|tgz)$/i,
};

/** The file name from a URL's last path segment, without query. */
export function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  } catch {
    return "";
  }
}

export function downloadProblem(
  kind: "iso" | "vztmpl",
  f: DownloadForm,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(f.url);
  } catch {
    return "url";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "url";
  if (!/^[A-Za-z0-9._+-]+$/.test(f.filename)) return "filename";
  if (!FILE_EXT[kind].test(f.filename)) return "extension";
  if ((f.checksum && !f.algorithm) || (!f.checksum && f.algorithm))
    return "checksum";
  if (f.checksum && !/^[0-9a-fA-F]+$/.test(f.checksum.trim()))
    return "checksum";
  return null;
}

export function downloadParams(
  kind: "iso" | "vztmpl",
  f: DownloadForm,
): PveParams {
  return {
    content: kind,
    url: f.url.trim(),
    filename: f.filename,
    checksum: f.checksum.trim() || undefined,
    "checksum-algorithm": f.checksum.trim() ? f.algorithm : undefined,
    "verify-certificates": f.verify,
  };
}

/** A backup's guest and time from its name: vzdump-lxc-400-2026_10_24-01_00_00.tar.zst. */
export function backupInfo(
  volid: string,
): { type: string; vmid: number; time: Date } | null {
  const m =
    /vzdump-(qemu|lxc)-(\d+)-(\d{4})_(\d\d)_(\d\d)-(\d\d)_(\d\d)_(\d\d)/.exec(
      volid,
    );
  if (!m) return null;
  return {
    type: m[1],
    vmid: Number(m[2]),
    time: new Date(
      Number(m[3]),
      Number(m[4]) - 1,
      Number(m[5]),
      Number(m[6]),
      Number(m[7]),
      Number(m[8]),
    ),
  };
}

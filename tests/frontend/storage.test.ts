import { describe, expect, it } from "vitest";
import {
  backupInfo,
  contentFilter,
  contentTabs,
  downloadParams,
  downloadProblem,
  filenameFromUrl,
} from "../../src/frontend/storage/params";
import {
  journalLines,
  serviceActions,
} from "../../src/frontend/nodes/NodeTabs";

const form = {
  url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.1.0-amd64-netinst.iso",
  filename: "debian-13.1.0-amd64-netinst.iso",
  checksum: "",
  algorithm: "" as const,
  verify: true,
};

describe("storage content", () => {
  it("shows a tab per kind of content", () => {
    expect(contentTabs("iso,vztmpl,backup,snippets")).toEqual([
      "iso",
      "vztmpl",
      "backup",
    ]);
    expect(contentTabs("rootdir,images")).toEqual(["images"]);
    expect(contentTabs("")).toEqual([]);
    expect(contentFilter("images")).toBeUndefined();
    expect(contentFilter("iso")).toBe("iso");
  });

  it("reads backup names", () => {
    const info = backupInfo(
      "local:backup/vzdump-lxc-400-2026_10_24-01_30_05.tar.zst",
    );
    expect(info).toMatchObject({ type: "lxc", vmid: 400 });
    expect(info?.time.getHours()).toBe(1);
    expect(backupInfo("local:backup/other.tar")).toBeNull();
  });
});

describe("download from URL", () => {
  it("takes the file name from the URL", () => {
    expect(filenameFromUrl(form.url)).toBe("debian-13.1.0-amd64-netinst.iso");
    expect(filenameFromUrl("https://x.org/a%20b.iso?x=1")).toBe("a b.iso");
    expect(filenameFromUrl("not a url")).toBe("");
  });

  it("checks the form", () => {
    expect(downloadProblem("iso", form)).toBeNull();
    expect(downloadProblem("iso", { ...form, url: "ftp://x/y.iso" })).toBe(
      "url",
    );
    expect(downloadProblem("iso", { ...form, filename: "a b.iso" })).toBe(
      "filename",
    );
    expect(downloadProblem("vztmpl", form)).toBe("extension");
    expect(
      downloadProblem("vztmpl", { ...form, filename: "debian.tar.zst" }),
    ).toBeNull();
    expect(downloadProblem("iso", { ...form, checksum: "abc" })).toBe(
      "checksum",
    );
    expect(
      downloadProblem("iso", { ...form, checksum: "xyz", algorithm: "sha256" }),
    ).toBe("checksum");
  });

  it("builds the params", () => {
    expect(
      downloadParams("iso", {
        ...form,
        checksum: " AB12 ",
        algorithm: "sha256",
      }),
    ).toEqual({
      content: "iso",
      url: form.url,
      filename: form.filename,
      checksum: "AB12",
      "checksum-algorithm": "sha256",
      "verify-certificates": true,
    });
    expect(downloadParams("iso", form)).toMatchObject({
      checksum: undefined,
      "checksum-algorithm": undefined,
    });
  });
});

describe("node services", () => {
  it("offers what fits the service's state", () => {
    expect(
      serviceActions({ service: "pveproxy", "active-state": "active" }),
    ).toEqual(["reload", "restart", "stop"]);
    expect(
      serviceActions({ service: "postfix", "active-state": "inactive" }),
    ).toEqual(["start"]);
    expect(serviceActions({ service: "x", "unit-state": "masked" })).toEqual(
      [],
    );
  });
});

describe("node log", () => {
  it("drops the journal's cursors and puts the newest first", () => {
    expect(
      journalLines([
        "s=8755e885;i=463822;b=61ec;m=108c;t=65e8;x=36ce",
        "Oct 24 05:32:11 proxmox systemd[1]: Started session-15017.scope",
        "Oct 24 05:32:12 proxmox sshd[2]: Accepted publickey",
        "s=8755e885;i=463824;b=61ec;m=108d;t=65e9;x=36cf",
      ]),
    ).toEqual([
      "Oct 24 05:32:12 proxmox sshd[2]: Accepted publickey",
      "Oct 24 05:32:11 proxmox systemd[1]: Started session-15017.scope",
    ]);
    expect(journalLines(null)).toEqual([]);
  });
});

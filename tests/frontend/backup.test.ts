import { describe, expect, it } from "vitest";
import {
  backupLabel,
  formatPrune,
  jobParams,
  jobToForm,
  parsePrune,
  vzdumpFromJob,
} from "../../src/frontend/datacenter/backup";
import {
  paramsFrom,
  valuesFrom,
  fieldProblem,
} from "../../src/frontend/datacenter/crud";
import { joinInformation } from "../../src/frontend/datacenter/cluster";

describe("backup jobs", () => {
  it("reads and writes retention", () => {
    expect(parsePrune("keep-last=3,keep-daily=7")).toEqual({
      "keep-last": "3",
      "keep-daily": "7",
    });
    expect(parsePrune("keep-all=1")).toEqual({});
    expect(
      formatPrune({ "keep-last": "3", "keep-weekly": "0", "keep-daily": "" }),
    ).toBe("keep-last=3");
    expect(formatPrune({})).toBeUndefined();
  });

  it("turns a job into form values", () => {
    expect(jobToForm({ id: "a", all: 1, exclude: "100" })).toMatchObject({
      selection: "exclude",
    });
    expect(jobToForm({ id: "a", pool: "web" })).toMatchObject({
      selection: "pool",
    });
    expect(
      jobToForm({ id: "a", vmid: "100,101", "prune-backups": "keep-last=2" }),
    ).toMatchObject({
      selection: "vmid",
      "keep-last": "2",
    });
  });

  it("sends one way of picking guests and clears the rest", () => {
    const update = jobParams(
      {
        schedule: "21:00",
        storage: "pbs",
        selection: "pool",
        pool: "web",
        vmid: "100",
        enabled: true,
        "keep-daily": "7",
      },
      false,
    );
    expect(update).toMatchObject({
      schedule: "21:00",
      storage: "pbs",
      all: 0,
      pool: "web",
      enabled: 1,
      "prune-backups": "keep-daily=7",
    });
    expect(update.vmid).toBeUndefined();
    expect(String(update.delete).split(",")).toEqual(
      expect.arrayContaining(["exclude", "vmid", "node", "comment"]),
    );
    const create = jobParams(
      {
        schedule: "sun 01:00",
        storage: "local",
        selection: "all",
        enabled: true,
      },
      true,
    );
    expect(create).toMatchObject({
      all: 1,
      mode: "snapshot",
      compress: "zstd",
    });
    expect(create.delete).toBeUndefined();
  });

  it("runs a job as a vzdump", () => {
    expect(
      vzdumpFromJob({
        id: "j",
        all: 1,
        exclude: "100",
        storage: "pbs",
        mode: "stop",
      }),
    ).toEqual({
      all: 1,
      exclude: "100",
      storage: "pbs",
      mode: "stop",
      compress: "zstd",
    });
    expect(
      vzdumpFromJob({ id: "j", vmid: "101", storage: "local" }),
    ).toMatchObject({
      vmid: "101",
    });
  });

  it("shortens backup names", () => {
    expect(
      backupLabel("local:backup/vzdump-lxc-100-2026_10_24-10_00_00.tar.zst"),
    ).toBe("vzdump-lxc-100-2026_10_24-10_00_00");
    expect(backupLabel("pbs:backup/ct/100/2026-10-24T10:00:00Z")).toBe(
      "2026-10-24T10:00:00Z",
    );
  });
});

describe("record forms", () => {
  const fields = [
    {
      key: "name",
      labelKey: "n",
      required: true,
      createOnly: true,
      pattern: /^[a-z]+$/,
    },
    { key: "port", labelKey: "p", kind: "number" as const },
    { key: "on", labelKey: "o", kind: "check" as const, default: true },
    { key: "note", labelKey: "c" },
  ];

  it("fills values from a record or defaults", () => {
    expect(valuesFrom(fields, null)).toEqual({
      name: "",
      port: "",
      on: true,
      note: "",
    });
    expect(
      valuesFrom(fields, { name: "a", port: 8007, on: 0, note: "x" }),
    ).toEqual({
      name: "a",
      port: "8007",
      on: false,
      note: "x",
    });
  });

  it("checks fields", () => {
    expect(fieldProblem(fields, { name: "", on: true }, true)?.messageKey).toBe(
      "crud.required",
    );
    expect(
      fieldProblem(fields, { name: "A1", on: true }, true)?.messageKey,
    ).toBe("crud.format");
    expect(
      fieldProblem(fields, { name: "a", port: "x", on: true }, true)
        ?.messageKey,
    ).toBe("crud.number");
    // The id can't change, so it is not checked on edit.
    expect(fieldProblem(fields, { name: "", on: true }, false)).toBeNull();
  });

  it("deletes blanks on update and leaves them out of a create", () => {
    expect(
      paramsFrom(fields, { name: "a", port: "", on: true, note: "" }, true),
    ).toEqual({
      name: "a",
      on: 1,
    });
    expect(
      paramsFrom(
        fields,
        { name: "a", port: "8007", on: false, note: "" },
        false,
      ),
    ).toEqual({
      port: 8007,
      on: 0,
      delete: "note",
    });
  });
});

describe("cluster join", () => {
  it("builds Proxmox's join information", () => {
    const info = joinInformation({
      preferred_node: "pve1",
      nodelist: [
        {
          name: "pve1",
          pve_addr: "10.0.0.1",
          pve_fp: "AA:BB",
          ring0_addr: "10.0.0.1",
        },
      ],
      totem: { cluster_name: "lab" },
    })!;
    expect(JSON.parse(atob(info))).toEqual({
      ipAddress: "10.0.0.1",
      fingerprint: "AA:BB",
      peerLinks: { "0": "10.0.0.1" },
      ring_addr: ["10.0.0.1"],
      totem: { cluster_name: "lab" },
    });
  });
});

describe("restore", () => {
  it("restores a container with a storage, and a VM from its archive", async () => {
    const { restoreParams } =
      await import("../../src/frontend/guests/BackupTab");
    expect(
      restoreParams("lxc", "local:backup/ct.tar.zst", 100, {
        storage: "local-lvm",
        overwrite: false,
        unique: true,
        start: false,
      }),
    ).toEqual({
      vmid: 100,
      ostemplate: "local:backup/ct.tar.zst",
      restore: 1,
      storage: "local-lvm",
      force: undefined,
      unique: 1,
      start: undefined,
    });
    expect(
      restoreParams("qemu", "pbs:backup/vm/101/x", 101, {
        storage: "",
        overwrite: true,
        unique: false,
        start: true,
      }),
    ).toMatchObject({
      vmid: 101,
      archive: "pbs:backup/vm/101/x",
      force: 1,
      start: 1,
      storage: undefined,
    });
  });
});

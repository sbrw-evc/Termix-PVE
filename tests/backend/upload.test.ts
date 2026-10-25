import { describe, expect, it } from "vitest";
import {
  checkVolumePath,
  parseUploadQuery,
  tempPath,
  writeCommand,
} from "../../src/backend/upload.js";

const base = {
  node: "pve1",
  storage: "local",
  content: "iso",
  filename: "debian.iso",
};

describe("upload query", () => {
  it("takes a whole-file upload", () => {
    expect(parseUploadQuery("1", base)).toMatchObject({
      hostId: 1,
      offset: 0,
      total: null,
      id: null,
    });
  });

  it("takes a chunk with its offset, total and upload id", () => {
    expect(
      parseUploadQuery("1", {
        ...base,
        offset: "16777216",
        total: "1800000000",
        upload: "a1b2c3d4e5f60718",
      }),
    ).toMatchObject({
      offset: 16777216,
      total: 1800000000,
      id: "a1b2c3d4e5f60718",
    });
  });

  it("refuses chunks that make no sense", () => {
    expect(parseUploadQuery("1", { ...base, offset: "-1", total: "10" })).toBe(
      "offset and total must be whole numbers",
    );
    expect(parseUploadQuery("1", { ...base, offset: "10", total: "10" })).toBe(
      "offset must be inside the file",
    );
    expect(parseUploadQuery("1", { ...base, offset: "5" })).toBe(
      "A chunk needs the file's total",
    );
    expect(
      parseUploadQuery("1", { ...base, total: "10", upload: "../x" }),
    ).toBe("Invalid upload id");
    expect(parseUploadQuery("1", { ...base, filename: "../etc.iso" })).toBe(
      "Invalid file name",
    );
    expect(parseUploadQuery("1", { ...base, filename: "x.exe" })).toBe(
      "Wrong file type for this content",
    );
  });

  it("names the temporary file per upload", () => {
    expect(tempPath("/var/lib/vz/template/iso/a.iso", null)).toBe(
      "/var/lib/vz/template/iso/a.iso.termix-upload",
    );
    expect(tempPath("/var/lib/vz/template/iso/a.iso", "abcd1234")).toBe(
      "/var/lib/vz/template/iso/a.iso.termix-upload-abcd1234",
    );
  });

  it("writes each chunk at its offset without cutting what follows", () => {
    expect(writeCommand(true, "/x/a.iso.termix-upload", 16777216)).toBe(
      "dd of='/x/a.iso.termix-upload' bs=1M oflag=seek_bytes seek=16777216 conv=notrunc status=none",
    );
    expect(writeCommand(false, "/x/a", 0)).toMatch(/^sudo -n dd /);
  });

  it("only writes under the storage's own path", () => {
    expect(checkVolumePath("/var/lib/vz/template/iso/a.iso", "a.iso")).toBe(
      true,
    );
    expect(checkVolumePath("/var/lib/../etc/a.iso", "a.iso")).toBe(false);
    expect(checkVolumePath("relative/a.iso", "a.iso")).toBe(false);
  });
});

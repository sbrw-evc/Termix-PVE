import { describe, expect, it } from "vitest";
import {
  existingFolders,
  matchFolders,
  normalizeFolder,
} from "../../src/frontend/components/folders";

describe("import folders", () => {
  it("lists the folders hosts sit in, parents included", () => {
    expect(
      existingFolders([
        { folder: "SBRW" },
        { folder: "Lab / Proxmox" },
        { folder: null },
        { folder: "" },
        { folder: "SBRW" },
      ]),
    ).toEqual(["Lab", "Lab/Proxmox", "SBRW"]);
  });

  it("matches the search and offers to create a new folder", () => {
    const folders = ["Lab", "Lab/Proxmox", "SBRW"];
    expect(matchFolders(folders, "")).toEqual({
      matches: folders,
      create: null,
    });
    expect(matchFolders(folders, "lab")).toEqual({
      matches: ["Lab", "Lab/Proxmox"],
      create: null,
    });
    expect(matchFolders(folders, "SBRW / guests ")).toEqual({
      matches: [],
      create: "SBRW/guests",
    });
  });

  it("cleans up slashes and spaces", () => {
    expect(normalizeFolder(" a / b/ ")).toBe("a/b");
    expect(normalizeFolder("/")).toBe("");
  });
});

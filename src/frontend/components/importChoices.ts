export type Connection = "ssh" | "rdp" | "vnc";
export type Runtime = "docker" | "podman";

/** Matches ImportLogin in src/backend/import.ts. */
export interface ImportLogin {
  mode: "node" | "credential" | "username" | "none";
  credentialId: number | null;
  username: string;
}

/** Windows over RDP, everything else over SSH, as the backend picks. */
export function defaultConnection(
  family: "windows" | "linux" | "other",
): Connection {
  return family === "windows" ? "rdp" : "ssh";
}

/** Docker when both are there. */
export function suggestedRuntime(
  runtimes: { docker: boolean; podman: boolean } | null,
): Runtime | null {
  return runtimes?.docker ? "docker" : runtimes?.podman ? "podman" : null;
}

/** The login as one select value: "node", "credential:7", "username", "none". */
export function loginOption(login: ImportLogin): string {
  return login.mode === "credential"
    ? `credential:${login.credentialId}`
    : login.mode;
}

export function parseLoginOption(
  value: string,
  current: ImportLogin,
): ImportLogin {
  if (value.startsWith("credential:")) {
    return {
      mode: "credential",
      credentialId: Number(value.slice("credential:".length)),
      username: "",
    };
  }
  const mode = value as ImportLogin["mode"];
  return {
    mode,
    credentialId: null,
    // Keep what was typed when switching back to a username.
    username: mode === "username" ? current.username || "root" : "",
  };
}

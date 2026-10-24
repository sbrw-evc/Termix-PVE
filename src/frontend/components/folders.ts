/** "a / b/" → "a/b": core keeps nested folders as one path joined by "/". */
export function normalizeFolder(value: string): string {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

/** Every folder hosts sit in, parents of nested ones included, sorted. */
export function existingFolders(
  hosts: Array<{ folder?: string | null }>,
): string[] {
  const all = new Set<string>();
  for (const host of hosts) {
    const parts = normalizeFolder(host.folder ?? "").split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      if (path) all.add(path);
    }
  }
  return [...all].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Folders matching the search, and whether it names a new one to create. */
export function matchFolders(
  folders: string[],
  query: string,
): { matches: string[]; create: string | null } {
  const wanted = normalizeFolder(query);
  const needle = wanted.toLowerCase();
  const matches = needle
    ? folders.filter((f) => f.toLowerCase().includes(needle))
    : folders;
  const exists = folders.some((f) => f.toLowerCase() === needle);
  return { matches, create: wanted && !exists ? wanted : null };
}

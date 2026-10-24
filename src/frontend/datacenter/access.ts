/** One entry of GET /access/users?full=1. */
export interface AccessUser extends Record<string, unknown> {
  userid: string;
  enable?: number;
  expire?: number;
  firstname?: string;
  lastname?: string;
  email?: string;
  comment?: string;
  groups?: string | string[];
  "realm-type"?: string;
  tokens?: Array<{
    tokenid: string;
    expire?: number;
    privsep?: number;
    comment?: string;
  }>;
  "tfa-locked-until"?: number;
}

export interface AccessToken extends Record<string, unknown> {
  userid: string;
  tokenid: string;
  expire?: number;
  privsep?: number;
  comment?: string;
}

/** One entry of GET /access/acl. */
export interface AclEntry extends Record<string, unknown> {
  path: string;
  type: "user" | "group" | "token";
  ugid: string;
  roleid: string;
  propagate?: number;
}

/** Every user's tokens as rows of their own. */
export function tokensOf(users: AccessUser[]): AccessToken[] {
  return users.flatMap((user) =>
    (user.tokens ?? []).map((token) => ({ ...token, userid: user.userid })),
  );
}

/** What PUT /access/acl takes to add or remove one entry. */
export function aclParams(
  entry: {
    path: string;
    type: string;
    ugid: string;
    roleid: string;
    propagate?: boolean | number;
  },
  remove = false,
) {
  const target =
    entry.type === "group"
      ? "groups"
      : entry.type === "token"
        ? "tokens"
        : "users";
  return {
    path: entry.path,
    roles: entry.roleid,
    [target]: entry.ugid,
    propagate: entry.propagate === false || entry.propagate === 0 ? 0 : 1,
    ...(remove ? { delete: 1 } : {}),
  };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A random TOTP secret in base32, 160 bits like Proxmox's own. */
export function totpSecret(
  random: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = random(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The otpauth:// URI an authenticator app reads, as Proxmox expects it. */
export function totpUri(
  userid: string,
  secret: string,
  issuer = "Proxmox VE",
): string {
  const label = encodeURIComponent(`${issuer}:${userid}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Pool members as Proxmox wants them changed: what to add and what to take out. */
export function memberChanges(before: string[], after: string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    add: after.filter((id) => !was.has(id)),
    remove: before.filter((id) => !now.has(id)),
  };
}

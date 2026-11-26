import { isIP } from "node:net";
import type { Client, ClientOptions } from "ldapts";

export const UAC_ACCOUNT_DISABLED = 0x0002;

type LdapTlsConfig = { url: string; ssl?: boolean; sslInsecure?: boolean; sslCa?: string };

const isLdaps = (url: string) => url.trim().toLowerCase().startsWith("ldaps:");

function tlsOptions(config: LdapTlsConfig) {
  if (config.sslInsecure) return { rejectUnauthorized: false };
  return config.sslCa ? { ca: config.sslCa } : {};
}

// ldapts opens TLS at connect whenever tlsOptions is set, which only an ldaps:// port accepts.
// An ldap:// port starts in clear text and is upgraded by startTlsIfNeeded.
export function ldapClientOptions(config: LdapTlsConfig, connectTimeout: number): ClientOptions {
  const opts: ClientOptions = { url: config.url, connectTimeout };
  if (config.ssl && isLdaps(config.url)) opts.tlsOptions = tlsOptions(config);
  return opts;
}

/** Upgrades an ldap:// connection before anything is sent on it. It throws when the server refuses, so a bind never falls back to clear text. */
export async function startTlsIfNeeded(client: Client, config: LdapTlsConfig): Promise<void> {
  if (!config.ssl || isLdaps(config.url)) return;
  const host = new URL(config.url).hostname.replace(/^\[|\]$/g, "");
  await client.startTLS({ host, ...(isIP(host) ? {} : { servername: host }), ...tlsOptions(config) });
}

/**
 * The address for an entry with no mail attribute. example.com and its subdomains are reserved,
 * so it is never someone's mailbox, and the provider's identifier keeps two directories apart.
 */
export function fallbackEmail(
  username: string,
  config: { id: string; uid?: string; fallbackEmailDomain?: string },
): string {
  return `${username}@${config.fallbackEmailDomain || `${config.uid ?? config.id}.example.com`}`;
}

// RFC 4515 -- escape special characters in LDAP filter values
export function escapeFilter(value: string): string {
  return value
    .replaceAll("\\", String.raw`\5c`)
    .replaceAll("\0", String.raw`\00`)
    .replaceAll("(", String.raw`\28`)
    .replaceAll(")", String.raw`\29`)
    .replaceAll("*", String.raw`\2a`);
}

export function firstAttr(val: unknown, fallback = ""): string {
  if (Array.isArray(val)) return (val[0] as string) || fallback;
  return (val as string) || fallback;
}

export function allAttrs(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  return val ? [val as string] : [];
}

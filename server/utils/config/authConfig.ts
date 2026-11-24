import { randomUUID } from "node:crypto";
import {
  getRawConfigValue,
  setRawConfigValue,
  deleteRawConfigValue,
} from "~/server/utils/config/tirConfig";
import {
  type AuthConfig,
  type LocalAuthConfig,
  type LDAPProviderConfig,
  type OIDCProviderConfig,
  type OAuthProviderConfig,
  LOCAL_SCHEMA,
  LDAP_PROVIDER_SCHEMA,
  OIDC_PROVIDER_SCHEMA,
  OAUTH_PROVIDER_SCHEMA,
} from "~/types/auth";

const OIDC_INDEX_KEY = "auth:oidc:index";
const LDAP_INDEX_KEY = "auth:ldap:index";
const OAUTH_INDEX_KEY = "auth:oauth:index";

const localKey = (field: string) => `auth:local:${field}`;
const oidcKey = (id: string, field: string) => `auth:oidc:${id}:${field}`;
const ldapKey = (id: string, field: string) => `auth:ldap:${id}:${field}`;
const oauthKey = (id: string, field: string) => `auth:oauth:${id}:${field}`;

// Stored beside the schema fields and never read from a request, so an edit cannot change it
// and a provider added later under a deleted provider's id gets a new one.
const UID_FIELD = "uid";

async function ensureProviderUid(keyFn: (f: string) => string, isNew: boolean): Promise<void> {
  if (!isNew && (await getRawConfigValue(keyFn(UID_FIELD)))) return;
  await setRawConfigValue(keyFn(UID_FIELD), randomUUID());
}

async function getIndex(indexKey: string): Promise<string[]> {
  const raw = await getRawConfigValue(indexKey);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function setIndex(indexKey: string, ids: string[]): Promise<void> {
  await setRawConfigValue(indexKey, JSON.stringify(ids));
}

function coerce(raw: string | undefined, type: string, dflt: any): any {
  if (raw === undefined) return dflt;
  switch (type) {
    case "bool": return raw === "true" || raw === "1";
    case "num": { const n = Number(raw); return Number.isFinite(n) ? n : dflt; }
    default: return raw;
  }
}

async function loadLocalConfig(): Promise<LocalAuthConfig> {
  const out: any = {};
  for (const [field, spec] of Object.entries(LOCAL_SCHEMA)) {
    const raw = await getRawConfigValue(localKey(field));
    out[field] = coerce(raw, spec.type, spec.default);
  }
  return out as LocalAuthConfig;
}

async function saveLocalConfig(input: Partial<LocalAuthConfig>): Promise<void> {
  await Promise.all(
    Object.keys(LOCAL_SCHEMA).map((field) => {
      const value = input[field as keyof LocalAuthConfig];
      return value === undefined ? Promise.resolve() : setRawConfigValue(localKey(field), value);
    }),
  );
}

async function loadProvider<T>(
  keyFn: (f: string) => string,
  schema: Record<string, any>,
  id: string,
): Promise<T> {
  const out: any = { id };
  const uid = await getRawConfigValue(keyFn(UID_FIELD));
  if (uid) out.uid = uid;
  for (const [field, spec] of Object.entries(schema)) {
    const raw = await getRawConfigValue(keyFn(field));
    if (spec.omit) {
      const flag = spec.setFlag ?? `${field}Set`;
      out[flag] = raw !== undefined && raw !== "" && raw !== "null";
    } else {
      out[field] = coerce(raw, spec.type, spec.default);
    }
  }
  return out as T;
}

const loadOIDCProvider = (id: string) => loadProvider<OIDCProviderConfig>((f) => oidcKey(id, f), OIDC_PROVIDER_SCHEMA, id);
const loadLDAPProvider = (id: string) => loadProvider<LDAPProviderConfig>((f) => ldapKey(id, f), LDAP_PROVIDER_SCHEMA, id);
const loadOAuthProvider = (id: string) => loadProvider<OAuthProviderConfig>((f) => oauthKey(id, f), OAUTH_PROVIDER_SCHEMA, id);

async function saveProvider(
  keyFn: (f: string) => string,
  schema: Record<string, any>,
  data: Record<string, any>,
  isNew: boolean,
): Promise<void> {
  const ops: Promise<void>[] = [];
  for (const [field, spec] of Object.entries(schema)) {
    const value = data[field];
    if (spec.omit) {
      // A stored secret only survives when the client asserts it is set. A provider
      // added in the UI sends the flag as false, so a reused id cannot inherit one.
      const stillSet = data[spec.setFlag ?? `${field}Set`] === true;
      if (value) ops.push(setRawConfigValue(keyFn(field), value));
      else if (!stillSet) ops.push(deleteRawConfigValue(keyFn(field)));
      continue;
    }
    if (value === undefined) continue;
    ops.push(setRawConfigValue(keyFn(field), value));
  }
  await Promise.all(ops);
  await ensureProviderUid(keyFn, isNew);
}

async function deleteProvider(keyFn: (f: string) => string, schema: Record<string, any>): Promise<void> {
  await Promise.all([...Object.keys(schema), UID_FIELD].map((f) => deleteRawConfigValue(keyFn(f))));
}

type SecretRule = {
  indexKey: string;
  keyFn: (id: string, field: string) => string;
  schema: Record<string, any>;
  secretField: string;
  matchFields: string[];
};

// A stored secret is only reused while the fields that decide where it is sent, as whom, and
// how the server is verified still match the saved provider. Otherwise an admin could repoint
// a provider at a host they control, or switch certificate checks off, and collect a secret
// they cannot read.
const SECRET_RULES: Record<"ldap" | "oidc" | "oauth", SecretRule> = {
  ldap: { indexKey: LDAP_INDEX_KEY, keyFn: ldapKey, schema: LDAP_PROVIDER_SCHEMA, secretField: "password", matchFields: ["url", "bindDn", "ssl", "sslInsecure", "sslCa"] },
  oidc: { indexKey: OIDC_INDEX_KEY, keyFn: oidcKey, schema: OIDC_PROVIDER_SCHEMA, secretField: "secret", matchFields: ["url", "clientId", "sslInsecure"] },
  oauth: {
    indexKey: OAUTH_INDEX_KEY,
    keyFn: oauthKey,
    schema: OAUTH_PROVIDER_SCHEMA,
    secretField: "secret",
    matchFields: ["providerType", "baseUrl", "tokenUrl", "clientId"],
  },
};

async function storedSecretState(
  rule: SecretRule,
  submitted: Record<string, unknown>,
): Promise<{ secret: string | undefined; unchanged: boolean }> {
  const id = submitted.id;
  if (typeof id !== "string" || !id) return { secret: undefined, unchanged: false };

  const ids = await getIndex(rule.indexKey);
  if (!ids.includes(id)) return { secret: undefined, unchanged: false };

  const stored = await loadProvider<Record<string, unknown>>((f) => rule.keyFn(id, f), rule.schema, id);
  const unchanged = rule.matchFields.every((f) => stored[f] === submitted[f]);
  return { secret: await getRawConfigValue(rule.keyFn(id, rule.secretField)), unchanged };
}

async function storedSecretIfUnchanged(rule: SecretRule, submitted: Record<string, unknown>) {
  const { secret, unchanged } = await storedSecretState(rule, submitted);
  return unchanged ? secret : undefined;
}

/** The saved bind password, only while the submitted url, bindDn and TLS settings still match the saved provider. */
export function storedLDAPPassword(submitted: Record<string, unknown>): Promise<string | undefined> {
  return storedSecretIfUnchanged(SECRET_RULES.ldap, submitted);
}

/** The saved client secret, only while the submitted url, clientId and TLS setting still match the saved provider. */
export function storedOIDCSecret(submitted: Record<string, unknown>): Promise<string | undefined> {
  return storedSecretIfUnchanged(SECRET_RULES.oidc, submitted);
}

/** Labels of submitted providers that would keep a stored secret although the fields it is bound to changed. */
export async function providersNeedingSecretReentry(input: Partial<AuthConfig>): Promise<string[]> {
  const labels: string[] = [];
  for (const kind of ["ldap", "oidc", "oauth"] as const) {
    const rule = SECRET_RULES[kind];
    for (const submitted of (input[kind] ?? []) as Record<string, unknown>[]) {
      if (submitted[rule.secretField]) continue;
      const setFlag = rule.schema[rule.secretField].setFlag ?? `${rule.secretField}Set`;
      if (submitted[setFlag] !== true) continue;
      const { secret, unchanged } = await storedSecretState(rule, submitted);
      if (!secret || unchanged) continue;
      labels.push(String(submitted.label || submitted.id));
    }
  }
  return labels;
}

export function hasEnabledProvider(cfg: Partial<AuthConfig>): boolean {
  return (
    cfg.local?.enable === true ||
    (cfg.ldap ?? []).some((p) => p.enable) ||
    (cfg.oidc ?? []).some((p) => p.enable) ||
    (cfg.oauth ?? []).some((p) => p.enable)
  );
}

/** Which sign-in methods have somewhere to sign in. Local also counts when nothing is enabled, as the server falls back to it. */
export function availableMethods(cfg: Partial<AuthConfig>): Record<"local" | "ldap" | "oidc" | "oauth", boolean> {
  return {
    local: cfg.local?.enable === true || !hasEnabledProvider(cfg),
    ldap: (cfg.ldap ?? []).some((p) => p.enable),
    oidc: (cfg.oidc ?? []).some((p) => p.enable),
    oauth: (cfg.oauth ?? []).some((p) => p.enable),
  };
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  const [local, ldapIds, oidcIds, oauthIds, defaultLoginProvider] = await Promise.all([
    loadLocalConfig(),
    getIndex(LDAP_INDEX_KEY),
    getIndex(OIDC_INDEX_KEY),
    getIndex(OAUTH_INDEX_KEY),
    getRawConfigValue("auth:defaultLoginProvider"),
  ]);

  const [ldap, oidc, oauth] = await Promise.all([
    Promise.all(ldapIds.map(loadLDAPProvider)),
    Promise.all(oidcIds.map(loadOIDCProvider)),
    Promise.all(oauthIds.map(loadOAuthProvider)),
  ]);

  return { local, ldap: ldap ?? [], oidc: oidc ?? [], oauth: oauth ?? [], defaultLoginProvider: defaultLoginProvider ?? "local" };
}

export async function saveAuthConfig(input: Partial<AuthConfig>): Promise<void> {
  if (input.local) {
    await saveLocalConfig(input.local);
  }

  if (input.defaultLoginProvider !== undefined) {
    await setRawConfigValue("auth:defaultLoginProvider", input.defaultLoginProvider);
  }

  if (input.ldap !== undefined) {
    const storedIds = await getIndex(LDAP_INDEX_KEY);
    const submittedIds = input.ldap.map((p) => p.id);
    await Promise.all([
      ...storedIds.filter((id) => !submittedIds.includes(id))
        .map((id) => deleteProvider((f) => ldapKey(id, f), LDAP_PROVIDER_SCHEMA)),
      ...(input.ldap as (LDAPProviderConfig & { password?: string })[])
        .map((p) => saveProvider((f) => ldapKey(p.id, f), LDAP_PROVIDER_SCHEMA, p as any, !storedIds.includes(p.id))),
    ]);
    await setIndex(LDAP_INDEX_KEY, submittedIds);
  }

  if (input.oidc !== undefined) {
    const storedIds = await getIndex(OIDC_INDEX_KEY);
    const submittedIds = input.oidc.map((p) => p.id);
    await Promise.all([
      ...storedIds.filter((id) => !submittedIds.includes(id))
        .map((id) => deleteProvider((f) => oidcKey(id, f), OIDC_PROVIDER_SCHEMA)),
      ...(input.oidc as (OIDCProviderConfig & { secret?: string })[])
        .map((p) => saveProvider((f) => oidcKey(p.id, f), OIDC_PROVIDER_SCHEMA, p as any, !storedIds.includes(p.id))),
    ]);
    await setIndex(OIDC_INDEX_KEY, submittedIds);
  }

  if (input.oauth !== undefined) {
    const storedIds = await getIndex(OAUTH_INDEX_KEY);
    const submittedIds = input.oauth.map((p) => p.id);
    await Promise.all([
      ...storedIds.filter((id) => !submittedIds.includes(id))
        .map((id) => deleteProvider((f) => oauthKey(id, f), OAUTH_PROVIDER_SCHEMA)),
      ...(input.oauth as (OAuthProviderConfig & { secret?: string })[])
        .map((p) => saveProvider((f) => oauthKey(p.id, f), OAUTH_PROVIDER_SCHEMA, p as any, !storedIds.includes(p.id))),
    ]);
    await setIndex(OAUTH_INDEX_KEY, submittedIds);
  }
}

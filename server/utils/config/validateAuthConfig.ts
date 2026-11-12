import {
  type AuthConfig,
  LOCAL_SCHEMA,
  LDAP_PROVIDER_SCHEMA,
  OIDC_PROVIDER_SCHEMA,
  OAUTH_PROVIDER_SCHEMA,
} from "~/types/auth";

/** Provider ids are spliced into config keys and into the login state cookie, where "~" delimits. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/;

export class AuthConfigValidationError extends Error {}

type FieldSpec = { type: string; omit?: boolean; setFlag?: string };
type Schema = Record<string, FieldSpec>;

function fail(message: string): never {
  throw new AuthConfigValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectType(where: string, field: string, value: unknown, type: string) {
  if (type === "bool") {
    if (typeof value !== "boolean") fail(`${where}: ${field} must be a boolean.`);
    return;
  }
  if (type === "num") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      fail(`${where}: ${field} must be a non-negative number.`);
    }
    return;
  }
  if (typeof value !== "string") fail(`${where}: ${field} must be a string.`);
}

function pickBySchema(where: string, schema: Schema, item: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(schema)) {
    const value = item[field];
    if (value !== undefined) {
      expectType(where, field, value, spec.type);
      out[field] = value;
    }
    if (!spec.omit) continue;
    const flag = spec.setFlag ?? `${field}Set`;
    if (item[flag] === undefined) continue;
    expectType(where, flag, item[flag], "bool");
    out[flag] = item[flag];
  }
  return out;
}

function pickProviders(kind: string, schema: Schema, value: unknown) {
  if (!Array.isArray(value)) fail(`${kind} must be a list of providers.`);
  const seen = new Set<string>();
  return value.map((item, i) => {
    const where = `${kind}[${i}]`;
    if (!isRecord(item)) fail(`${where} must be an object.`);
    const id = item.id;
    if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id)) {
      fail(`${where}: id must contain only lowercase letters, digits and dashes.`);
    }
    if (seen.has(id)) fail(`${kind}: duplicate provider id "${id}".`);
    seen.add(id);
    return { id, ...pickBySchema(where, schema, item) };
  });
}

function isValidDefaultLoginProvider(value: unknown): boolean {
  if (value === "" || value === "local") return true;
  return typeof value === "string" && value.startsWith("ldap:") && PROVIDER_ID_PATTERN.test(value.slice(5));
}

/** Returns only the fields the schemas know, with their types checked, or throws AuthConfigValidationError. */
export function validateAuthConfigInput(body: unknown): Partial<AuthConfig> {
  if (!isRecord(body)) fail("Request body must be an object.");
  const out: Record<string, unknown> = {};

  if (body.local !== undefined) {
    if (!isRecord(body.local)) fail("local must be an object.");
    out.local = pickBySchema("local", LOCAL_SCHEMA, body.local);
  }
  if (body.defaultLoginProvider !== undefined) {
    if (!isValidDefaultLoginProvider(body.defaultLoginProvider)) {
      fail('defaultLoginProvider must be "local" or "ldap:<id>".');
    }
    out.defaultLoginProvider = body.defaultLoginProvider;
  }
  if (body.ldap !== undefined) out.ldap = pickProviders("ldap", LDAP_PROVIDER_SCHEMA, body.ldap);
  if (body.oidc !== undefined) out.oidc = pickProviders("oidc", OIDC_PROVIDER_SCHEMA, body.oidc);
  if (body.oauth !== undefined) out.oauth = pickProviders("oauth", OAUTH_PROVIDER_SCHEMA, body.oauth);

  return out as Partial<AuthConfig>;
}

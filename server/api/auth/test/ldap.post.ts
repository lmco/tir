import { Client } from "ldapts";
import { storedLDAPPassword } from "~/server/utils/config/authConfig";
import { ldapClientOptions, startTlsIfNeeded } from "~/server/auth/ldapUtils";

const CONNECT_TIMEOUT_MS = 8_000;

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  const { url, bindDn, password: providedPassword, baseDn, ssl, sslInsecure, sslCa } = body;

  if (!url) {
    return { ok: false, checks: [{ name: "Connect", ok: false, message: "URL is required" }] };
  }

  const password: string | undefined = providedPassword || (await storedLDAPPassword(body));

  const checks: CheckResult[] = [];

  const tlsConfig = { url, ssl, sslInsecure, sslCa };
  const client = new Client(ldapClientOptions(tlsConfig, CONNECT_TIMEOUT_MS));

  try {
    // A refused StartTLS must end the test here, or the binds below would go out in clear text.
    try {
      await startTlsIfNeeded(client, tlsConfig);
    } catch (err: any) {
      checks.push({ name: "Connect", ok: false, message: `StartTLS failed: ${err.message ?? "refused"}` });
      return { ok: false, checks };
    }

    try {
      await client.bind("", "");
      checks.push({ name: "Connect", ok: true, message: "Connected (anonymous bind allowed)" });
    } catch (err: any) {
      const isLdapError = typeof err.code === "number" || err.name?.includes("Ldap");
      if (isLdapError) {
        checks.push({ name: "Connect", ok: true, message: `Server reachable (${err.message})` });
      } else {
        checks.push({ name: "Connect", ok: false, message: err.message ?? "Cannot connect to server" });
        return { ok: false, checks };
      }
    }

    if (bindDn && password) {
      try {
        await client.bind(bindDn, password);
        checks.push({ name: "Bind", ok: true, message: `Authenticated as ${bindDn}` });

        if (baseDn) {
          try {
            const { searchEntries } = await client.search(baseDn, {
              scope: "base",
              filter: "(objectClass=*)",
              attributes: ["dn"],
            });
            checks.push({
              name: "Base DN",
              ok: true,
              message: `Found ${searchEntries.length} entr${searchEntries.length === 1 ? "y" : "ies"} at ${baseDn}`,
            });
          } catch (err: any) {
            checks.push({ name: "Base DN", ok: false, message: err.message ?? "Search failed" });
          }
        } else {
          checks.push({ name: "Base DN", ok: false, message: "Not configured" });
        }
      } catch (err: any) {
        checks.push({ name: "Bind", ok: false, message: err.message ?? "Bind failed" });
      }
    } else if (bindDn) {
      checks.push({
        name: "Bind",
        ok: false,
        message:
          "No password available - enter the password to test bind. The saved password only applies while the URL, bind DN and TLS settings are unchanged.",
      });
    } else {
      checks.push({ name: "Bind", ok: false, message: "Bind DN not configured" });
    }
  } finally {
    try {
      await client.unbind();
    } catch {}
  }

  return { ok: checks.every((c) => c.ok), checks };
});

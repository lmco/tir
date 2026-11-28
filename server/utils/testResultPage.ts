import type { TestLoginResult } from "~/server/auth/authProvider";

/** A page for the Test Login popup that hands the result to the admin page and closes itself. */
export function testResultPage(result: TestLoginResult | { error: string }): string {
  const b64 = Buffer.from(JSON.stringify({ type: "tir_test_login", ...result })).toString("base64");
  return `<!DOCTYPE html><html><head><title>TIR Login Test</title></head><body>
<script>
  try {
    const r = JSON.parse(atob("${b64}"));
    if (window.opener) window.opener.postMessage(r, window.location.origin);
  } finally { window.close(); }
</script>
</body></html>`;
}

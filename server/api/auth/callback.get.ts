import { defineEventHandler, getCookie, H3Error, sendRedirect, setResponseHeader } from "h3";
import { getAuthServiceManager } from "~/server/auth/authServiceManager";
import { AUTH_COOKIES, clearAuthCookie } from "~/server/utils/authCookies";
import { testResultPage } from "~/server/utils/testResultPage";

export default defineEventHandler(async (event) => {
  const isTestMode = getCookie(event, AUTH_COOKIES.TEST_MODE) === "1";

  try {
    const authService = getAuthServiceManager();

    const rawState = getCookie(event, AUTH_COOKIES.STATE);
    const nonce = getCookie(event, AUTH_COOKIES.NONCE);
    const codeVerifier = getCookie(event, AUTH_COOKIES.CODE_VERIFIER);

    if (!rawState) throw new H3Error("Missing state cookie.");

    // State is encoded as "<family>:<providerId>~<oauthState>"
    const tildeIdx = rawState.indexOf("~");
    if (tildeIdx === -1) throw new H3Error("Malformed state cookie.");
    const providerKey = rawState.slice(0, tildeIdx);

    const provider = authService.getProvider(providerKey);

    event.context.auth = { state: rawState, nonce, codeVerifier };

    clearAuthCookie(event, AUTH_COOKIES.STATE);
    clearAuthCookie(event, AUTH_COOKIES.NONCE);
    clearAuthCookie(event, AUTH_COOKIES.CODE_VERIFIER);

    if (isTestMode) {
      clearAuthCookie(event, AUTH_COOKIES.TEST_MODE);
      await requireAdmin(event);
      if (typeof provider.handleTestCallback !== "function") {
        throw new H3Error(`Provider '${providerKey}' does not support test login.`);
      }
      const result = await provider.handleTestCallback(event);
      logger.debug({ service: "auth", message: `Test login complete for '${providerKey}'` });
      setResponseHeader(event, "Content-Type", "text/html");
      return testResultPage(result);
    }

    if (typeof provider.handleCallback !== "function") {
      throw new H3Error(`Provider '${providerKey}' does not support callback authentication.`);
    }

    const result = await provider.handleCallback(event);

    if (!result?.sessionId) {
      throw new H3Error("Failed to handle callback or create session.");
    }

    logger.debug({ service: "auth", message: `Auth callback complete for '${providerKey}', redirecting to /home` });
    return sendRedirect(event, "/home");
  } catch (error) {
    const errorMessage =
      error instanceof H3Error || error instanceof Error
        ? error.message
        : "An unknown error occurred during authentication callback";
    logger.error({ service: "auth", message: `Auth callback error: ${errorMessage}` });

    if (isTestMode) {
      clearAuthCookie(event, AUTH_COOKIES.TEST_MODE);
      setResponseHeader(event, "Content-Type", "text/html");
      return testResultPage({ error: errorMessage });
    }

    return { success: false, message: errorMessage };
  }
});

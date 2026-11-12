import {
  saveAuthConfig,
  loadAuthConfig,
  hasEnabledProvider,
  providersNeedingSecretReentry,
} from "~/server/utils/config/authConfig";
import {
  validateAuthConfigInput,
  AuthConfigValidationError,
} from "~/server/utils/config/validateAuthConfig";
import { getAuthServiceManager } from "~/server/auth/authServiceManager";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  let input;
  try {
    input = validateAuthConfigInput(await readBody(event));
  } catch (error) {
    if (!(error instanceof AuthConfigValidationError)) throw error;
    throw createError({ statusCode: 400, message: error.message });
  }

  const current = await loadAuthConfig();
  if (!hasEnabledProvider({ ...current, ...input })) {
    throw createError({
      statusCode: 400,
      message: "At least one authentication provider must be enabled.",
    });
  }

  const reentry = await providersNeedingSecretReentry(input);
  if (reentry.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Re-enter the password or client secret for ${reentry.join(", ")}: the server address or client identity changed.`,
    });
  }

  await saveAuthConfig(input);

  const newConfig = await loadAuthConfig();

  const auth = getAuthServiceManager();
  await auth.reload(newConfig);

  return { success: true };
});

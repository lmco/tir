import {
  saveAuthConfig,
  loadAuthConfig,
  hasEnabledProvider,
  availableMethods,
  providersNeedingSecretReentry,
} from "~/server/utils/config/authConfig";
import {
  validateAuthConfigInput,
  AuthConfigValidationError,
} from "~/server/utils/config/validateAuthConfig";
import { getAuthServiceManager } from "~/server/auth/authServiceManager";
import { anyAdminCanSignIn, LOCKOUT_REFUSAL } from "~/server/auth/signInMethod";
import { User } from "~/db/models";

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

  // Only a change that takes the last way in away is refused, so a broken setup can still be repaired.
  const admins = await User.findAll({
    where: { UserRoleId: 1 },
    attributes: ["UserRoleId", "creationMethod", "password"],
  });
  const couldBefore = anyAdminCanSignIn(admins, availableMethods(current));
  if (couldBefore && !anyAdminCanSignIn(admins, availableMethods({ ...current, ...input }))) {
    throw createError({ statusCode: 400, message: LOCKOUT_REFUSAL });
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

import {
  saveAuthConfig,
  loadAuthConfig,
  hasEnabledProvider,
} from "~/server/utils/config/authConfig";
import { getAuthServiceManager } from "~/server/auth/authServiceManager";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  const current = await loadAuthConfig();
  if (!hasEnabledProvider({ ...current, ...body })) {
    throw createError({
      statusCode: 400,
      message: "At least one authentication provider must be enabled.",
    });
  }

  await saveAuthConfig(body);

  const newConfig = await loadAuthConfig();

  const auth = getAuthServiceManager();
  await auth.reload(newConfig);

  return { success: true };
});

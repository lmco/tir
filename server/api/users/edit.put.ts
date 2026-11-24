import { DateTime } from "luxon";
import { User, Timezone } from "../../../db/models";
import {
  accountMethod,
  anyAdminCanSignIn,
  isSignInMethod,
  methodChangeRefusal,
  LOCKOUT_REFUSAL,
} from "~/server/auth/signInMethod";
import { availableMethods, loadAuthConfig } from "~/server/utils/config/authConfig";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  if (checkResult.UserRoleId !== 1 && checkResult.user.id !== body.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Insufficient Permissions.",
    });
  }

  const user = await User.findByPk(body.id, { attributes: { exclude: ["password", "salt"] } });

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: "User not found.",
    });
  }

  const orginalUser = user.email;
  const methodBeforeEdit = accountMethod(user);

  if (body.email) {
    if (body.email !== user?.email) {
      const userExist = await User.findOne({ where: { email: body.email } });
      if (userExist) {
        logger.error(`Sorry, this email is taken ${body.email}`);
        throw createError({
          statusCode: 409,
          statusMessage: "Sorry, this email is taken",
        });
      }
      user.email = body.email;
    } else {
      delete body.email;
    }
  }

  if (body.firstName && user.firstName !== body.firstName) {
    user.firstName = body.firstName;
  } else {
    delete body.firstName;
  }

  if (body.lastName && user.lastName !== body.lastName) {
    user.lastName = body.lastName;
  } else {
    delete body.lastName;
  }

  if (body.UserRoleId && user.UserRoleId !== body.UserRoleId) {
    user.UserRoleId = body.UserRoleId;
  } else {
    delete body.UserRoleId;
  }

  if (body.signInMethod !== undefined && body.signInMethod !== accountMethod(user)) {
    if (!isSignInMethod(body.signInMethod)) {
      throw createError({ statusCode: 400, statusMessage: "Unknown sign-in method." });
    }
    const refusal = methodChangeRefusal(checkResult.user);
    if (refusal) throw createError({ statusCode: 403, statusMessage: refusal });
    user.creationMethod = body.signInMethod;
  } else {
    delete body.signInMethod;
  }

  if (body.ThemeId && user.ThemeId !== body.ThemeId) {
    user.ThemeId = body.ThemeId;
  } else {
    delete body.ThemeId;
  }

  if (body.timezone) {
    try {
      const timezone = await Timezone.findOne({ where: { name: body.timezone } });
      if (!timezone) {
        console.error(`Timezone with name ${body.timezone} not found.`);
        return;
      } else if (timezone.id !== user.TimezoneId) {
        user.TimezoneId = timezone.id;
      } else {
        delete body.timezone;
      }
    } catch (error) {
      console.error("Error editing user:", error);
    }
  }

  if (body.signInMethod !== undefined || body.UserRoleId !== undefined) {
    const others = await User.findAll({ attributes: ["id", "UserRoleId", "creationMethod", "password"] });
    const available = availableMethods(await loadAuthConfig());
    const after = others.map((u) =>
      u.id === user.id
        ? { UserRoleId: user.UserRoleId, creationMethod: user.creationMethod, password: u.password }
        : u,
    );
    if (anyAdminCanSignIn(others, available) && !anyAdminCanSignIn(after, available)) {
      throw createError({ statusCode: 400, statusMessage: LOCKOUT_REFUSAL });
    }
  }

  user.lastUpdate = DateTime.now().toISO();
  await user.save();

  if (body.signInMethod !== undefined) {
    logger.notice({
      service: "auth",
      message: `Sign-in method of ${user.email} changed from ${methodBeforeEdit} to ${body.signInMethod} by ${checkResult.user.email}`,
    });
  }

  const attributes = Object.keys(body).filter((key) => key !== "id");
  const attributesString = attributes.join(", ");

  logger.info({
    service: "auth",
    message: `Edited User ${orginalUser}: ${attributesString}`,
  });

  return user;
});

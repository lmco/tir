import { DateTime } from "luxon";
import { User, Timezone, UserRole } from "../../../db/models";

const DEFAULT_TIMEZONE_NAMES = ["Etc/UTC", "UTC"];

async function findDefaultTimezone() {
  const utc = await Timezone.findOne({
    where: { name: DEFAULT_TIMEZONE_NAMES },
    order: [["name", "ASC"]],
  });
  if (utc) {
    return utc;
  }
  return Timezone.findOne({ order: [["id", "ASC"]] });
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { firstName, lastName, email, UserRoleId, TimezoneName } = body;
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  if (checkResult.UserRoleId !== 1) {
    throw createError({
      statusCode: 401,
      statusMessage: "Insufficient Permissions.",
    });
  }

  if (!body.email) {
    throw createError({
      statusCode: 400,
      statusMessage: "Email required.",
    });
  }

  const userExist = await User.findOne({ where: { email } });
  if (userExist) {
    logger.error(`Sorry, this email is taken ${body.email}`);
    throw createError({
      statusCode: 409,
      statusMessage: "Sorry, this email is taken",
    });
  }
  const userRole = await UserRole.findByPk(UserRoleId);

  const timezone = TimezoneName
    ? await Timezone.findOne({ where: { name: TimezoneName } })
    : await findDefaultTimezone();

  if (TimezoneName && !timezone) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown timezone ${TimezoneName}.`,
    });
  }

  if (!timezone) {
    logger.error("No timezones are seeded, cannot create a user.");
    throw createError({
      statusCode: 500,
      statusMessage: "No timezones are available.",
    });
  }

  const violations = await getPasswordViolations(body.password);
  if (violations.length > 0) {
    logger.info({
      service: "Auth",
      message: `Password validation failed for creating new user ${body.email}: ${violations.join(
        "; ",
      )}`,
    });

    throw createError({
      statusCode: 400,
      statusMessage: violations.join(" "),
    });
  }

  const config = useRuntimeConfig();

  if (!config.secret_key) {
    throw new Error("secret_key is not set.");
  }

  const SECRET_KEY = config.secret_key as string;
  const salt = generateSalt();

  const password = hashPassword(body.password, salt, SECRET_KEY);

  const newUser = await User.create({
    firstName,
    lastName,
    email,
    UserRoleId,
    TimezoneId: timezone.id,
    salt,
    password,
    passwordChangedAt: DateTime.now().toISO(),
    creationMethod: "local",
  });

  logger.info({
    service: "auth",
    message: `User ${email} Successfully Created with Role: ${userRole?.name}`,
  });

  return User.findByPk(newUser.id, { attributes: { exclude: ["password", "salt"] } });
});

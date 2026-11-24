import { UserRole } from "../../../db/models";
import { User } from "../../../db/models/user";
import { accountMethod } from "~/server/auth/signInMethod";

const BASE_ATTRIBUTES = ["id", "firstName", "lastName", "email", "UserRoleId", "TimezoneId"];

export default defineEventHandler(async (event) => {
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  const isAdmin = checkResult.UserRoleId === 1;

  const users = await User.findAll({
    attributes: isAdmin ? [...BASE_ATTRIBUTES, "creationMethod", "password"] : BASE_ATTRIBUTES,
    include: [
      {
        model: UserRole,
      },
    ],
  });
  if (!isAdmin) return users;

  return users.map((user) => {
    const { password, creationMethod, ...rest } = user.toJSON() as Record<string, any>;
    const signInMethod = accountMethod({ creationMethod });
    return { ...rest, signInMethod, localPasswordActive: signInMethod !== "local" && Boolean(password) };
  });
});

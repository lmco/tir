import { Token } from "../../../../db/models";
import { requireSessionUser } from "../../../utils/permissionCheck";

export default defineEventHandler(async (event) => {
  const { user } = await requireSessionUser(event);

  return Token.findAll({
    where: { UserId: user.id },
    attributes: { exclude: ["tokenHash"] },
    order: [["creationDate", "DESC"]],
  });
});

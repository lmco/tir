import { CONTROL_DATA_IMPORT_SIGNAL, getSignalStatus } from "~/server/utils/startupSync";

export default defineEventHandler(async (event) => {
  await userCheck(event, undefined, undefined, undefined);
  return { status: getSignalStatus(CONTROL_DATA_IMPORT_SIGNAL) };
});

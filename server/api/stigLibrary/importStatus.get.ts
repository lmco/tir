import { CONTROL_DATA_IMPORT_SIGNAL, getSignal } from "~/server/utils/startupSync";

export default defineEventHandler(async (event) => {
  await userCheck(event, undefined, undefined, undefined);
  return { status: getSignal(CONTROL_DATA_IMPORT_SIGNAL) };
});

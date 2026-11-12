import { runDbRepairs } from "../utils/dbRepair";
import { waitForSignal } from "../utils/startupSync";

export default defineNitroPlugin(async () => {
  await waitForSignal("db");
  await runDbRepairs();
});

import * as fs from "fs/promises";
import { verifyControlData } from "../utils/importControl";
import { CONTROL_DATA_IMPORT_SIGNAL, signalFailed, signalReady, waitForSignal } from "../utils/startupSync";

export default defineNitroPlugin(async () => {
  try {
    await waitForSignal("db");
    console.info("[SCTM] Waiting 3 minutes before starting control data imports.");
    await new Promise((resolve) => setTimeout(resolve, 100_000));
    const files = await fs.readdir("./lib/data/800-53");
    for (const file of files) {
      const filePath = `./lib/data/800-53/${file}`;
      const result = await verifyControlData(filePath);
      if (result.result === true) {
        await parseControlData(file, filePath);
      }
    }
    logger.info({ service: "SCTM", message: "SCTM Imports Complete" });
    signalReady(CONTROL_DATA_IMPORT_SIGNAL);
  } catch (error) {
    signalFailed(CONTROL_DATA_IMPORT_SIGNAL, error);
    logSequelizeError(error);
    console.error(error);
  }
});

import * as fs from "fs/promises";
import { verifyControlData } from "../utils/importControl";
import { CONTROL_DATA_IMPORT_SIGNAL, signalReady, waitForSignal } from "../utils/startupSync";

export default defineNitroPlugin(async () => {
  try {
    await waitForSignal("db");
    const files = await fs.readdir("./lib/data/800-53");
    
    for (const file of files) {
      const filePath = `./lib/data/800-53/${file}`;
      const result = await verifyControlData(filePath);
      if (result.result === true) {
        await parseControlData(file, filePath);
      }
    }
    
    logger.info({ service: "SCTM", message: "SCTM Imports Complete" });
  } catch (error) {
    // Log once with appropriate context
    logger.error({ 
      service: "SCTM", 
      message: "SCTM import failed", 
      error 
    });
    logSequelizeError(error); // Only if this does something special beyond logging
  } finally {
    // Always signal ready, whether success or failure
    signalReady(CONTROL_DATA_IMPORT_SIGNAL);
  }
});
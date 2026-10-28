import * as fs from "fs/promises";
import { verifyControlData } from "../utils/importControl";
import { CONTROL_DATA_IMPORT_SIGNAL, signalReady, waitForSignal } from "../utils/startupSync";

export default defineNitroPlugin(async () => {
  try {
    await waitForSignal("db");
    // For testing, waiting 100 seconds
    await new Promise((resolve) => setTimeout(resolve, 100_000));
    const files = await fs.readdir("./lib/data/800-53");
    for (const file of files) {
      const filePath = `./lib/data/800-53/${file}`;
      const result = await verifyControlData(filePath);
      if (result.result === true) {
        await parseControlData(file, filePath);
      }
    }
    signalReady(CONTROL_DATA_IMPORT_SIGNAL); 
  } catch (error) {

    logSequelizeError(error);
    signalReady(CONTROL_DATA_IMPORT_SIGNAL); 
    console.error(error);
  }
});

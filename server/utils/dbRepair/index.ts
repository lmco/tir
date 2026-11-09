import { missingEvaluations } from "./missingEvaluations";

export type DbRepair = {
  name: string;
  run: () => Promise<number>;
};

export const dbRepairs: DbRepair[] = [missingEvaluations];

export async function runDbRepairs(repairs: DbRepair[] = dbRepairs): Promise<void> {
  for (const repair of repairs) {
    const started = Date.now();
    try {
      const repaired = await repair.run();
      logger.info({
        service: "dbRepair",
        message: `${repair.name}: repaired ${repaired} in ${Date.now() - started} ms`,
      });
    } catch (error) {
      logger.error({ service: "dbRepair", message: `${repair.name} failed: ${error}` });
    }
  }
}

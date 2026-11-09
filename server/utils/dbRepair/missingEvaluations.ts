import { Op } from "sequelize";
import { Assessment, Evaluation, Stig, System } from "../../../db/models";
import { createEvaluation } from "../evaluations";
import type { DbRepair } from ".";

type Pair = { BoundaryId: number; StigId: number };

const key = ({ BoundaryId, StigId }: Pair) => `${BoundaryId}:${StigId}`;

async function currentAssessmentPairs(): Promise<Pair[]> {
  const rows = (await Assessment.findAll({
    attributes: ["StigId"],
    where: { succeededByAssessmentId: { [Op.is]: null } },
    include: [
      {
        model: System,
        attributes: ["BoundaryId"],
        required: true,
        include: [
          {
            model: Stig,
            attributes: [],
            through: { attributes: [] },
            where: { id: { [Op.col]: "Assessment.StigId" } },
            required: true,
          },
        ],
      },
    ],
    raw: true,
  })) as unknown as { StigId: number; "System.BoundaryId": number }[];

  const pairs = new Map<string, Pair>();
  for (const row of rows) {
    const pair = { BoundaryId: row["System.BoundaryId"], StigId: row.StigId };
    if (pair.BoundaryId && pair.StigId) pairs.set(key(pair), pair);
  }
  return [...pairs.values()];
}

async function pairsWithoutEvaluation(pairs: Pair[]): Promise<Pair[]> {
  if (pairs.length === 0) return [];
  const existing = await Evaluation.findAll({ attributes: ["BoundaryId", "StigId"], raw: true });
  const have = new Set(existing.map(key));
  return pairs.filter((pair) => !have.has(key(pair)));
}

export const missingEvaluations: DbRepair = {
  name: "missingEvaluations",
  async run() {
    const missing = await pairsWithoutEvaluation(await currentAssessmentPairs());
    for (const { BoundaryId, StigId } of missing) {
      await createEvaluation(BoundaryId, StigId);
    }
    return missing.length;
  },
};

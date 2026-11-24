import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import { DateTime } from "luxon";
import { Op, UniqueConstraintError } from "sequelize";
import {
  Assessment,
  AssessmentItem,
  StigData,
  StigLibrary,
  System,
  Stig,
  StigAlias,
  Evaluation,
  EvaluationItem,
  Boundary,
} from "../../db/models";
import { hashFile } from "./hash";
import { createBlankAssessment } from "./assessments";
import { createEvaluation } from "./evaluations";
import { recomputeAndSummarize, type RevisionSummary } from "./libraryRevisions";
import { importJobWorkDir } from "./importJobFiles";

import type { ParseStigResults } from "./importStig";
import type { ProgressStreamer } from "~/server/utils/progressBar";

export type Classification = "U" | "FOUO" | "CUI";

export type ProcessLibraryResults = {
  stigProcessed: number;
  newStigCount: number;
  updatedStigCount: number;
  unchangedStigCount: number;
  xmlsExtracted: number;
  classification: Classification;
  libraryDate: string;
  skippedPackages: string[];
  failedStigs: string[];
  revision: RevisionSummary | null;
};

type AssessmentMigration = {
  system: System;
  assessment: Assessment;
  oldStig: Stig | null;
  newStig: Stig | null;
};

type EvaluationMigration = {
  system: System;
  evaluation: Evaluation;
  oldStig: Stig | null;
  newStig: Stig | null;
};

type StigMapping = {
  system: System;
  oldStig: Stig;
  newStig: Stig | null;
};

async function resolveBoundaryStigMappings(
  boundaryId: number,
  newStigLibraryId: number,
): Promise<StigMapping[]> {
  const systems = await System.findAll({ where: { BoundaryId: boundaryId } });
  const mappings: StigMapping[] = [];

  for (const system of systems) {
    // Reads active Stig_Systems links before any mutations happen
    const activeStigs = await system.getStigs();
    for (const oldStig of activeStigs) {
      const newStig = await findStigByStigId(oldStig.stigid, newStigLibraryId);
      mappings.push({ system, oldStig, newStig });
    }
  }

  return mappings;
}

async function* currentAssessments(
  boundaryId: number,
  newStigLibraryId: number,
): AsyncGenerator<AssessmentMigration> {
  const boundarySystems = await System.findAll({ where: { BoundaryId: boundaryId } });
  for (const system of boundarySystems) {
    const assessments = await Assessment.findAll({
      where: { SystemId: system.id, succeededByAssessmentId: { [Op.is]: null } },
      include: [
        {
          model: System,
          attributes: [],
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
    });
    for (const assessment of assessments) {
      const oldStig = await Stig.findOne({ where: { id: assessment.StigId } });
      const newStig = oldStig ? await findStigByStigId(oldStig.stigid, newStigLibraryId) : null;
      yield { system, assessment, oldStig, newStig };
    }
  }
}

async function* currentEvaluations(
  boundaryId: number,
  newStigLibraryId: number,
): AsyncGenerator<EvaluationMigration> {
  const boundarySystems = await System.findAll({ where: { BoundaryId: boundaryId } });
  for (const system of boundarySystems) {
    const evaluations = await Evaluation.findAll({
      where: {
        BoundaryId: boundaryId,
      },
      include: [
        {
          model: Boundary,
          attributes: [],
          required: true,
          include: [
          {
            model: System,
            attributes: [],
            required: true,
            where: { id: system.id },
            include: [
            {
              model: Stig,
              attributes: [],
              through: { attributes: [] },
              where: { id: { [Op.col]: "Evaluation.StigId" } },
              required: true,
            },
            ]
          }
          ],
        },
      ],
    });
    console.log("Found evaluations for system", system.id, "and boundary ID", boundaryId, "evaluations", evaluations.map(e => e.id));
    for (const evaluation of evaluations) {
      const currentStig = await Stig.findOne({ where: { id: evaluation.StigId } });
      // console.log("Found current stig for evaluation", evaluation.id, "currentStig", currentStig?.id);
      // console.log("Trying to find stig by current Stig ID in the new library")
      console.log("Trying to find current stig where evaluation.StigId", evaluation.StigId, currentStig?.stigid, "with evaluation id", evaluation.id, "for system", system.id);
      const newStig = await findStigByStigId(currentStig.stigid, newStigLibraryId);
      console.log("Yielding evaluation migration for system", system.id, "evaluation", evaluation.id, "currentStig", currentStig?.id, "newStig", newStig?.id);
      yield { system, evaluation, currentStig, newStig };
    }
  }
}

const isUntouched = (check: AssessmentItem) =>
  check.status === "Not_Reviewed" &&
  !check.comments &&
  !check.finding_details &&
  !check.statusOverride &&
  !check.severityOverride;

const isUntouchedEval = (check: EvaluationItem) =>
  check.Office_Org === null &&
  check.Resources_Required === "" &&
  check.Scheduled_Completion_Date === null &&
  check.Milestone_Changes === null &&
  check.Poam_Comments === null &&
  check.Mitigations === null &&
  !check.Severity &&
  !check.Relevance_of_Threat &&
  !check.Likelihood &&
  !check.Impact &&
  check.Impact_Description === "" &&
  !check.Residual_Risk_Level &&
  check.Recommendations === "";

async function copyCheckResults(oldAssessmentId: number, newAssessmentId: number): Promise<void> {
  const include = [{ model: StigData, attributes: ["vuln_num", "rule_id"] }];
  const oldChecks = await AssessmentItem.findAll({
    where: { AssessmentId: oldAssessmentId },
    include,
  });
  const newChecks = await AssessmentItem.findAll({
    where: { AssessmentId: newAssessmentId },
    include,
  });

  for (const check of newChecks) {
    const matchingCheck = findMatch(check, oldChecks);
    if (!matchingCheck || !isUntouched(check)) continue;
    check.status = matchingCheck.status;
    check.comments = matchingCheck.comments;
    check.finding_details = matchingCheck.finding_details;
    check.severityOverride = matchingCheck.severityOverride;
    check.severityOverrideJustification = matchingCheck.severityOverrideJustification;
    check.AssessmentId = newAssessmentId;
    await check.save();
  }
}

async function copyCheckResultsEvaluation(oldEvaluationId: number, newEvaluationId: number): Promise<void> {
  const include = [{ model: StigData, attributes: ["vuln_num", "rule_id"] }];
  console.log("Finding eval items for old evaluation", oldEvaluationId, "and new evaluation", newEvaluationId);
  const oldChecks = await EvaluationItem.findAll({
    where: { EvaluationId: oldEvaluationId },
    include,
  });
  const newChecks = await EvaluationItem.findAll({
    where: { EvaluationId: newEvaluationId },
    include,
  });

  for (const check of newChecks) {
    const matchingCheck = findMatchEval(check, oldChecks);
    // console.log("Matching check for", check, "is", matchingCheck);
    if (!matchingCheck || !isUntouchedEval(check)) continue;
    check.Office_Org = matchingCheck.Office_Org;
    check.Resources_Required = matchingCheck.Resources_Required;
    check.Scheduled_Completion_Date = matchingCheck.Scheduled_Completion_Date;
    check.Milestone_Changes = matchingCheck.Milestone_Changes;
    check.Poam_Comments = matchingCheck.Poam_Comments;
    check.Mitigations = matchingCheck.Mitigations;
    check.Severity = matchingCheck.Severity;
    check.Relevance_of_Threat = matchingCheck.Relevance_of_Threat;
    check.Likelihood = matchingCheck.Likelihood;
    check.Impact = matchingCheck.Impact;
    check.Impact_Description = matchingCheck.Impact_Description;
    check.Residual_Risk_Level = matchingCheck.Residual_Risk_Level;
    check.Recommendations = matchingCheck.Recommendations;
    check.EvaluationId = newEvaluationId;
    await check.save();
  }
}

async function migrateAssessment(
  system: System,
  oldStig: Stig,
  newStig: Stig | null,
): Promise<void> {
  if (newStig && oldStig.id === newStig.id) return;

  if (!newStig) {
    await Assessment.destroy({ where: { SystemId: system.id, StigId: oldStig.id } });
    return;
  }

  const oldAssessment = await Assessment.findOne({
    where: {
      SystemId: system.id,
      StigId: oldStig.id,
      succeededByAssessmentId: { [Op.is]: null },
    },
  });
  if (!oldAssessment) return;

  const newAssessment =
    (await Assessment.findOne({
      where: {
        SystemId: system.id,
        StigId: newStig.id,
        succeededByAssessmentId: { [Op.is]: null },
      },
    })) ?? (await createBlankAssessment(system.id, newStig.id));

  await copyCheckResults(oldAssessment.id, newAssessment.id);
  oldAssessment.succeededByAssessmentId = newAssessment.id;
  await oldAssessment.save();
}

export const migrateBoundary = async (
  boundaryId: number,
  newStigLibraryId: number,
): Promise<{ results: string }> => {
  try {
    // Snapshot all active (system, oldStig -> newStig) mappings upfront
    const mappings = await resolveBoundaryStigMappings(boundaryId, newStigLibraryId);

    // 2. Migrate per-system Assessments
    for (const { system, oldStig, newStig } of mappings) {
      if (newStig && oldStig.id === newStig.id) continue;
      await migrateAssessment(system, oldStig, newStig);
    }

    // 3. Migrate per-boundary Evaluations (deduplicated by oldStig.id)
    const uniqueBoundaryStigs = new Map<number, { oldStig: Stig; newStig: Stig | null }>();
    for (const { oldStig, newStig } of mappings) {
      uniqueBoundaryStigs.set(oldStig.id, { oldStig, newStig });
    }

    for (const { oldStig, newStig } of uniqueBoundaryStigs.values()) {
      if (newStig && oldStig.id === newStig.id) continue;
      await migrateEvaluation(boundaryId, oldStig, newStig);
    }

    // 4. Wipe old Stig_Systems links and attach new ones once migrations succeed
    for (const { system, oldStig, newStig } of mappings) {
      if (newStig && oldStig.id === newStig.id) continue;
      if (newStig) await system.addStig(newStig);
      await system.removeStig(oldStig);
    }

    return { results: "Success" };
  } catch (error) {
    logger.error(error);
    throw createError({
      statusCode: 400,
      statusMessage: "Error with Migration",
    });
  }
};

async function migrateEvaluation(
  boundaryId: number,
  oldStig: Stig,
  newStig: Stig | null,
): Promise<void> {
  if (newStig && oldStig.id === newStig.id) return;

  if (!newStig) {
    await Evaluation.destroy({ where: { BoundaryId: boundaryId, StigId: oldStig.id } });
    return;
  }

  const oldEvaluation = await Evaluation.findOne({
    where: {
      BoundaryId: boundaryId,
      StigId: oldStig.id,
    },
  });
  if (!oldEvaluation) return;

  const newEvaluation =
    (await Evaluation.findOne({
      where: {
        BoundaryId: boundaryId,
        StigId: newStig.id,
      },
    })) ?? (await createEvaluation(boundaryId, newStig.id));

  await copyCheckResultsEvaluation(oldEvaluation.id, newEvaluation.id);
}

export const checkBoundary = async (
  boundaryId: number,
  newStigLibraryId: number,
): Promise<{ results: { stigid: string; version: string }[] }> => {
  try {
    const reviewStigs = new Map<number, { stigid: string; version: string }>();
    for await (const { oldStig, newStig } of currentAssessments(boundaryId, newStigLibraryId)) {
      if (!oldStig || newStig) continue;
      reviewStigs.set(oldStig.id, {
        stigid: oldStig.stigid,
        version: `v${oldStig.version}r${oldStig.stigRelease}`,
      });
    }
    return { results: [...reviewStigs.values()] };
  } catch (error) {
    logger.error(error);
    throw createError({
      statusCode: 400,
      statusMessage: "Error with Migration Check",
    });
  }
};

export const findMatch = (check: AssessmentItem, array: AssessmentItem[]) => {
  return array.find((item) => item.StigDatum?.rule_id === check.StigDatum?.rule_id);
};

export const findMatchEval = (check: EvaluationItem, array: EvaluationItem[]) => {
  // console.log("Whats in my array", array)
  return array.find((item) => item.StigDatumId === check.StigDatumId);
};

const CLASSIFICATION_RANK: Record<Classification, number> = { U: 0, FOUO: 1, CUI: 2 };

export const classificationFromPackageName = (name: string): Classification | null => {
  const match = /^(CUI|FOUO|U)_/.exec(name);
  return match ? (match[1] as Classification) : null;
};

const highestClassification = (values: Classification[]): Classification =>
  values.reduce(
    (max, value) => (CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[max] ? value : max),
    "U",
  );

const readBenchmarkDate = (xmlFilePath: string): string | null => {
  const fd = fs.openSync(xmlFilePath, "r");
  try {
    const buffer = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const header = buffer.toString("utf8", 0, bytesRead);
    const match = header.match(/<status\b[^>]*\bdate="([^"]+)"/);
    return match ? match[1] : null;
  } finally {
    fs.closeSync(fd);
  }
};

const deriveLibraryDate = (xmlFiles: string[]): string => {
  let newest: DateTime | null = null;
  for (const xmlFile of xmlFiles) {
    const raw = readBenchmarkDate(xmlFile);
    if (!raw) continue;
    const parsed = DateTime.fromISO(raw);
    if (!parsed.isValid) continue;
    if (!newest || parsed > newest) {
      newest = parsed;
    }
  }
  if (!newest) {
    throw new Error("Unable to determine library date from benchmark status dates.");
  }
  return newest.toISODate() as string;
};

async function librarySaveError(
  error: unknown,
  originalName: string,
  hash: string,
): Promise<Error> {
  if (!(error instanceof UniqueConstraintError)) {
    logger.error("Error saving Library Entry.", { cause: error });
    return new Error("Error saving Library Entry.");
  }
  for (const element of error.errors) {
    logger.error(`[ERROR] ${originalName} ${element.message}`);
  }
  const existing = await StigLibrary.findOne({ where: { hash } });
  return new Error(
    `This exact file was already imported as library ${existing?.id} (${existing?.filename}).`,
    { cause: error },
  );
}

async function saveLibraryRow(
  originalName: string,
  hash: string,
  classification: Classification,
  libraryDate: string,
  streamer: ProgressStreamer,
): Promise<StigLibrary> {
  const newLibrary = StigLibrary.build({
    filename: originalName,
    hash,
    classification,
    libraryDate,
  });
  try {
    await newLibrary.save();
  } catch (error) {
    throw await librarySaveError(error, originalName, hash);
  }
  streamer.status(`STIG Library Saved: ${newLibrary.dataValues.id}`);
  streamer.saved(newLibrary.dataValues.id);

  const saved = await StigLibrary.findOne({ where: { hash } });
  if (!saved) {
    throw new Error("Unable to load saved STIG Library.");
  }
  return saved;
}

function tallyParseResult(results: ProcessLibraryResults, parseResults: ParseStigResults): void {
  if (parseResults.newStig) {
    results.newStigCount++;
  } else if (parseResults.newCheckCount === 0) {
    results.unchangedStigCount++;
  } else {
    results.updatedStigCount++;
  }
}

async function importXmlFile(
  xmlFile: string,
  library: StigLibrary,
  results: ProcessLibraryResults,
  streamer: ProgressStreamer,
): Promise<void> {
  const name = path.basename(xmlFile);
  let parseResults: ParseStigResults | null = null;
  try {
    parseResults = await parseXmlStig(xmlFile, library);
  } catch {
    logger.error(`Error Parsing STIG: ${name}`);
  }
  if (!parseResults || parseResults.errorCheckCount > 0) {
    results.failedStigs.push(name);
    streamer.status(`Failed to import ${name} - see the server log.`);
    return;
  }
  tallyParseResult(results, parseResults);
}

function reportRevision(
  revision: RevisionSummary | null,
  classification: Classification,
  libraryDate: string,
  streamer: ProgressStreamer,
): void {
  if (!revision || revision.groupSize <= 1) return;
  streamer.status(
    `Same-date group (${classification} ${libraryDate}) now holds ${revision.groupSize} libraries; ` +
      `this one is "${revision.label ?? "unlabelled"}".`,
  );
  if (!revision.diff) return;

  const { againstLibraryId, changed, added, removed } = revision.diff;
  if (changed.length + added.length + removed.length === 0) {
    streamer.status(
      `Identical benchmark set to library ${againstLibraryId} - likely a duplicate upload; delete one.`,
    );
    return;
  }
  streamer.status(
    `Differs from library ${againstLibraryId}: ` +
      `${changed.length} updated, ${added.length} added, ${removed.length} removed.`,
  );
}

export const processLibrary = async (
  sourceZip: string,
  jobUid: string,
  originalName: string,
  streamer: ProgressStreamer,
): Promise<ProcessLibraryResults> => {
  const outputDirPath = importJobWorkDir(jobUid);
  if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true });
  }

  const hash = await hashFile(sourceZip);
  const { xmlFiles, importedPackages, skippedPackages } = extractLibrary(sourceZip, outputDirPath);

  if (importedPackages.length === 0) {
    throw new Error("No marked STIG packages ({U,CUI,FOUO}_) found; nothing imported.");
  }
  if (skippedPackages.length > 0) {
    streamer.status(
      `Skipped ${skippedPackages.length} unmarked package(s): ${skippedPackages.join(", ")}`,
    );
  }

  const classification = highestClassification(importedPackages.map((pkg) => pkg.classification));
  const libraryDate = deriveLibraryDate(xmlFiles);
  const newStigLibrary = await saveLibraryRow(
    originalName,
    hash,
    classification,
    libraryDate,
    streamer,
  );

  fs.renameSync(sourceZip, path.join(outputDirPath, path.basename(sourceZip)));

  const results: ProcessLibraryResults = {
    stigProcessed: 0,
    newStigCount: 0,
    updatedStigCount: 0,
    unchangedStigCount: 0,
    xmlsExtracted: xmlFiles.length,
    classification,
    libraryDate,
    skippedPackages,
    failedStigs: [],
    revision: null,
  };

  streamer.status(`Extracted ${xmlFiles.length} XML files.`);
  streamer.progress(0);
  for (const [i, xmlFile] of xmlFiles.entries()) {
    await importXmlFile(xmlFile, newStigLibrary, results, streamer);
    streamer.status(`Processed file ${i + 1}/${xmlFiles.length}: ${path.basename(xmlFile)}`);
    streamer.progress(Math.round(((i + 1) / xmlFiles.length) * 100));
  }
  streamer.progress(100);
  if (results.failedStigs.length > 0) {
    streamer.status(
      `${results.failedStigs.length} STIG(s) failed to import: ${results.failedStigs.join(", ")}`,
    );
  }

  newStigLibrary.importedDate = DateTime.now().toISO();
  await newStigLibrary.save();

  results.revision = await recomputeAndSummarize(newStigLibrary);
  reportRevision(results.revision, classification, libraryDate, streamer);

  return results;
};

type ExtractedLibrary = {
  xmlFiles: string[];
  importedPackages: { name: string; classification: Classification }[];
  skippedPackages: string[];
};

const extractLibrary = (sourceZip: string, outputDirectory: string): ExtractedLibrary => {
  const temporaryExtraction = path.join(outputDirectory, "tempExtraction");
  const mainZip = new AdmZip(sourceZip);
  const xmlFiles: string[] = [];
  const importedPackages: { name: string; classification: Classification }[] = [];
  const skippedPackages: string[] = [];
  fs.mkdirSync(temporaryExtraction);
  mainZip.extractAllTo(temporaryExtraction, true);

  fs.readdirSync(temporaryExtraction).forEach((nestedFile) => {
    if (path.extname(nestedFile) !== ".zip") return;

    const classification = classificationFromPackageName(nestedFile);
    if (!classification) {
      skippedPackages.push(nestedFile);
      return;
    }

    const nestedZip = new AdmZip(path.join(temporaryExtraction, nestedFile));
    nestedZip.getEntries().forEach((entry) => {
      if (path.extname(entry.name) !== ".xml") return;
      nestedZip.extractEntryTo(entry, outputDirectory, false, true);
      xmlFiles.push(path.join(outputDirectory, path.basename(entry.entryName)));
    });
    importedPackages.push({ name: nestedFile, classification });
  });

  fs.rmSync(temporaryExtraction, { recursive: true });

  return { xmlFiles, importedPackages, skippedPackages };
};

export const findStigByStigId = async (
  stigid: string,
  stigLibraryId: number,
): Promise<Stig | null> => {
  // console.log("We in here looking for stigid", stigid, "in library", stigLibraryId)
  const stigAliases = await StigAlias.findAll({
    where: {
      alias: stigid,
    },
  });

  const aliasTocheck: string[] = [stigid];

  for (const stigAlias of stigAliases) {
    aliasTocheck.push(stigAlias.identifier);
  }

  for (const alias of aliasTocheck) {
    const stigMatch = await Stig.findOne({
      where: {
        stigid: alias,
      },
      include: [
        {
          model: StigLibrary,
          attributes: [],
          where: {
            id: stigLibraryId,
          },
        },
      ],
    });
    if (stigMatch) {
      return stigMatch;
    }
  }

  return null;
};

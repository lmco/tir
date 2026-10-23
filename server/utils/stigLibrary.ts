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
} from "../../db/models";
import { hashFile } from "./hash";
import { createBlankAssessment } from "./assessments";
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

export const migrateBoundary = async (
  boundaryId: number,
  newStigLibraryId: number,
): Promise<{ results: string }> => {
  try {
    const boundarySystems = await System.findAll({ where: { BoundaryId: boundaryId } });
    for (const system of boundarySystems) {
      const currentAssessments = await Assessment.findAll({
        where: {
          SystemId: system.id,
          succeededByAssessmentId: { [Op.is]: null },
        },
      });
      for (const assessment of currentAssessments) {
        const oldStig = await Stig.findOne({ where: { id: assessment.StigId } });
        const newStig = await Stig.findOne({
          where: { stigid: oldStig.stigid },
          include: [
            {
              model: StigLibrary,
              where: { id: newStigLibraryId },
              required: true,
            },
          ],
        });

        await system.removeStig(oldStig);
        await system.addStig(newStig);

        const newAssessment = await createBlankAssessment(assessment.SystemId, newStig.id);

        assessment.succeededByAssessmentId = newAssessment.id;
        await assessment.save();

        const oldChecks = await AssessmentItem.findAll({
          where: { AssessmentId: assessment.id },
          include: [{ model: StigData, attributes: ["vuln_num", "rule_id"] }],
        });
        const newChecks = await AssessmentItem.findAll({
          where: { AssessmentId: newAssessment.id },
          include: [{ model: StigData, attributes: ["vuln_num", "rule_id"] }],
        });

        for (const check of newChecks) {
          const matchingCheck = findMatch(check, oldChecks);

          if (matchingCheck) {
            check.status = matchingCheck?.status;
            check.comments = matchingCheck?.comments;
            check.finding_details = matchingCheck?.finding_details;
            check.severityOverride = matchingCheck?.severityOverride;
            check.severityOverrideJustification = matchingCheck?.severityOverrideJustification;
            check.AssessmentId = newAssessment.id;
            await check.save();
          }
        }
      }
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

export const findMatch = (check: AssessmentItem, array: AssessmentItem[]) => {
  // return array.find((item) => item.StigDatum?.vuln_num === check.StigDatum?.vuln_num);
  return array.find((item) => item.StigDatum?.rule_id === check.StigDatum?.rule_id);
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
  } else if (parseResults.newCheckCount === 0 && parseResults.updatedCheckCount === 0) {
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

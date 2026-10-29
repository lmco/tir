import { DateTime } from "luxon";
import { Stig, StigLibrary } from "../../db/models";
import {
  diffBenchmarks,
  sortOldestFirst,
  type BenchmarkTuple,
  type GroupMember,
  type LibraryDiff,
} from "./revisionMath";

export type RevisionGroup = { classification: string; libraryDate: string };

export function revisionGroupOf(library: StigLibrary): RevisionGroup {
  return { classification: library.classification, libraryDate: library.libraryDate };
}

export function revisionGroupKey(group: RevisionGroup): string {
  return `revision-labels:${group.classification}:${group.libraryDate}`;
}

export type RevisionSummary = {
  label: string | null;
  groupSize: number;
  diff: (LibraryDiff & { againstLibraryId: number }) | null;
};

function toBenchmarkTuples(stigs: Stig[]): BenchmarkTuple[] {
  return stigs.map((stig) => ({
    stigid: stig.stigid,
    version: Number(stig.version) || 0,
    release: Number(stig.stigRelease) || 0,
    date: stig.status__date ?? "",
  }));
}

async function loadSameDateGroup(group: RevisionGroup): Promise<GroupMember<StigLibrary>[]> {
  const libraries = await StigLibrary.findAll({
    where: { ...group },
    include: [
      {
        model: Stig,
        attributes: ["stigid", "version", "stigRelease", "status__date"],
        through: { attributes: [] },
      },
    ],
  });
  return libraries.map((library) => ({
    ref: library,
    benchmarks: toBenchmarkTuples(library.Stigs ?? []),
    id: library.id,
  }));
}

export async function recomputeRevisionLabels(
  group: RevisionGroup,
): Promise<RevisionSummary | null> {
  if (!group.classification || !group.libraryDate) return null;

  const ordered = sortOldestFirst(await loadSameDateGroup(group));
  if (ordered.length === 0) return null;

  const pinned = new Set(
    ordered.filter((m) => m.ref.labelSource !== "auto").map((m) => m.ref.revisionLabel),
  );
  let next = 1;
  for (const { ref: library } of ordered) {
    if (library.labelSource !== "auto") continue;
    let label = `rev ${next++}`;
    while (pinned.has(label)) label = `rev ${next++}`;
    if (library.revisionLabel === label) continue;
    library.revisionLabel = label;
    library.lastUpdate = DateTime.now().toISO();
    await library.save();
  }

  const newest = ordered.at(-1);
  const previous = ordered.length > 1 ? ordered.at(-2) : null;
  return {
    label: newest.ref.revisionLabel,
    groupSize: ordered.length,
    diff: previous
      ? {
          againstLibraryId: previous.id,
          ...diffBenchmarks(newest.benchmarks, previous.benchmarks),
        }
      : null,
  };
}

export async function recomputeAndSummarize(library: StigLibrary): Promise<RevisionSummary | null> {
  const group = revisionGroupOf(library);
  const recomputed = await recomputeRevisionLabels(group);
  if (!recomputed) return null;

  const ordered = sortOldestFirst(await loadSameDateGroup(group));
  const index = ordered.findIndex((member) => member.id === library.id);
  if (index === -1) return recomputed;

  const previous = index > 0 ? ordered[index - 1] : null;
  return {
    label: ordered[index].ref.revisionLabel,
    groupSize: ordered.length,
    diff: previous
      ? {
          againstLibraryId: previous.id,
          ...diffBenchmarks(ordered[index].benchmarks, previous.benchmarks),
        }
      : null,
  };
}

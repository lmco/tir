import { DateTime } from "luxon";
import { Stig, StigLibrary } from "../../db/models";
import { withQueue } from "./queue";
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

async function assignAutoLabels(ordered: GroupMember<StigLibrary>[]): Promise<void> {
  const pinned = new Set(
    ordered.filter((m) => m.ref.labelSource !== "auto").map((m) => m.ref.revisionLabel),
  );
  let next = 1;
  for (const { ref: library } of ordered) {
    if (library.labelSource !== "auto") continue;
    let label = `rev ${next++}`;
    while (pinned.has(label)) label = `rev ${next++}`;
    if (library.revisionLabel === label) continue;
    // Guarded on labelSource so a pin that landed after this group was read
    // is never overwritten with an automatic label.
    const [updated] = await StigLibrary.update(
      { revisionLabel: label, lastUpdate: DateTime.now().toISO() },
      { where: { id: library.id, labelSource: "auto" } },
    );
    if (updated === 1) library.revisionLabel = label;
  }
}

function recomputeGroup(group: RevisionGroup): Promise<GroupMember<StigLibrary>[]> {
  if (!group.classification || !group.libraryDate) return Promise.resolve([]);
  return withQueue(revisionGroupKey(group), async () => {
    const ordered = sortOldestFirst(await loadSameDateGroup(group));
    await assignAutoLabels(ordered);
    return ordered;
  });
}

function summarize(ordered: GroupMember<StigLibrary>[], index: number): RevisionSummary {
  const member = ordered[index];
  const previous = index > 0 ? ordered[index - 1] : null;
  return {
    label: member.ref.revisionLabel,
    groupSize: ordered.length,
    diff: previous
      ? { againstLibraryId: previous.id, ...diffBenchmarks(member.benchmarks, previous.benchmarks) }
      : null,
  };
}

export async function recomputeRevisionLabels(group: RevisionGroup): Promise<void> {
  await recomputeGroup(group);
}

export async function recomputeAndSummarize(library: StigLibrary): Promise<RevisionSummary | null> {
  const ordered = await recomputeGroup(revisionGroupOf(library));
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((member) => member.id === library.id);
  return summarize(ordered, index === -1 ? ordered.length - 1 : index);
}

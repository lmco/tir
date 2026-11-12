export function catSeverityToStig(catSeverity) {
  const severityMap = {
    "CAT I": "high",
    "CAT II": "medium",
    "CAT III": "low",
  };

  return severityMap[catSeverity] || null;
}

export function stigSeverityToCat(stigSeverity) {
  const severityMap = {
    high: "CAT I",
    medium: "CAT II",
    low: "CAT III",
  };

  return severityMap[stigSeverity] || null;
}

export function getHighestStigSeverity(severities: string[], defaultSeverity: string): string {
  const severityPriority: Record<string, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  let highestSeverity: string | null = null;

  for (const severity of severities) {
    if (!(severity in severityPriority)) {
      continue;
    }

    if (
      highestSeverity === null ||
      severityPriority[severity] > severityPriority[highestSeverity]
    ) {
      highestSeverity = severity;
    }
  }

  return highestSeverity ?? defaultSeverity;
}

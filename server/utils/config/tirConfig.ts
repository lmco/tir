import { DateTime } from "luxon";
import { Op } from "sequelize";
import { TirConfig } from "~/db/models/tirConfig";

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const decapitalize = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : "");
const composeKey = (section: string, baseKey: string) => `${section}${capitalize(baseKey)}`;
const serialize = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value ?? null);

// upsert skips the create and update hooks, so the timestamps are written here.
async function writeConfig(key: string, value: unknown): Promise<void> {
  const now = DateTime.now().toISO();
  const row = await TirConfig.findOne({ where: { key } });
  if (row) {
    await row.update({ value: serialize(value), lastUpdate: now });
    return;
  }
  await TirConfig.create({ key, value: serialize(value), lastUpdate: now, creationDate: now });
}

export async function setConfigValue(
  section: string,
  baseKey: string,
  value: unknown,
): Promise<void> {
  if (value === undefined) return;
  const key = composeKey(section, baseKey);
  await writeConfig(key, value);
}

export async function getConfigValue(
  section: string,
  baseKey: string,
): Promise<string | undefined> {
  const key = composeKey(section, baseKey);
  const row = await TirConfig.findOne({ where: { key } });
  return row?.value;
}

export async function getConfigValues(
  section: string,
  subsection?: string,
): Promise<Record<string, string>> {
  const prefix = subsection ? `${section}${capitalize(subsection)}` : section;
  const rows = await TirConfig.findAll({ where: { key: { [Op.like]: `${prefix}%` } } });
  const out: Record<string, string> = {};
  for (const r of rows) {
    const field = r.key.startsWith(prefix) ? r.key.slice(prefix.length) : r.key;
    out[decapitalize(field)] = r.value;
  }
  return out;
}

export async function getRawConfigValue(key: string): Promise<string | undefined> {
  const row = await TirConfig.findOne({ where: { key } });
  return row?.value;
}

export async function setRawConfigValue(key: string, value: unknown): Promise<void> {
  if (value === undefined) return;
  await writeConfig(key, value);
}

export async function deleteRawConfigValue(key: string): Promise<void> {
  await TirConfig.destroy({ where: { key } });
}


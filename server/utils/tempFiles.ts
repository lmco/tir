import * as fs from "node:fs";
import * as path from "node:path";

export function tempRoot(): string {
  return path.resolve(useRuntimeConfig().temp_folder);
}

export function tempPath(...segments: string[]): string {
  const root = tempRoot();
  const target = path.resolve(root, ...segments);
  if (target === root || !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing temp path outside ${root}: ${segments.join("/")}`);
  }
  return target;
}

export async function removeTempPaths(targets: string[], context: string): Promise<void> {
  for (const target of targets) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch (error) {
      logger.warning({
        service: "tempFiles",
        message: `${context}: could not remove ${target}: ${error}`,
      });
    }
  }
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.promises.mkdtemp(tempPath(`${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await removeTempPaths([dir], prefix);
  }
}

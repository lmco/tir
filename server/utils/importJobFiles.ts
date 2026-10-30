import { removeTempPaths, tempPath } from "./tempFiles";

export function importJobWorkDir(uid: string): string {
  return tempPath(`${uid}-work`);
}

export function removeImportJobFiles(uid: string, context: string): Promise<void> {
  return removeTempPaths([tempPath(uid), tempPath(`${uid}.json`), importJobWorkDir(uid)], context);
}

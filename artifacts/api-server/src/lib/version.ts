import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export interface ServiceVersionInfo {
  version: string;
  name?: string;
  releaseDate?: string;
  releaseNotes?: string;
}

const VERSION_FILE_CANDIDATES = [
  resolve(process.cwd(), "version.json"),
  resolve(process.cwd(), "../../version.json"),
];

export function readLocalVersionInfo(): ServiceVersionInfo {
  for (const file of VERSION_FILE_CANDIDATES) {
    try {
      if (existsSync(file)) {
        return JSON.parse(readFileSync(file, "utf8")) as ServiceVersionInfo;
      }
    } catch {}
  }

  return { version: "unknown" };
}

export function readLocalVersion(): string {
  return readLocalVersionInfo().version ?? "unknown";
}

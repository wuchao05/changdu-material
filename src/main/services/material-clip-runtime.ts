import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import extract from "extract-zip";

export type MaterialClipRuntimeSource = "managed" | "dev-fallback" | "missing";

export interface MaterialClipRuntimeState {
  runtimeRoot: string;
  sourcePath: string;
  importedAt: string;
}

export interface MaterialClipResolvedRuntime {
  source: MaterialClipRuntimeSource;
  runtimeRoot: string | null;
}

export interface MaterialClipRuntimeValidationResult {
  valid: boolean;
  runtimeRoot: string | null;
  error?: string;
}

function hasRuntimeMarkers(candidate: string): boolean {
  const markers = [
    path.join(candidate, "src", "drama_processor"),
    path.join(candidate, "requirements.txt"),
    path.join(candidate, "pyproject.toml"),
  ];

  return markers.every((marker) => fs.existsSync(marker));
}

export function isValidRuntimeRoot(candidate: string): boolean {
  return hasRuntimeMarkers(candidate);
}

async function findRuntimeRoot(
  baseDir: string,
  depth = 0,
): Promise<string | null> {
  if (hasRuntimeMarkers(baseDir)) {
    return baseDir;
  }

  if (depth >= 3) {
    return null;
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childPath = path.join(baseDir, entry.name);
    const nested = await findRuntimeRoot(childPath, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export async function validateRuntimeCandidate(
  candidatePath: string,
): Promise<MaterialClipRuntimeValidationResult> {
  if (!fs.existsSync(candidatePath)) {
    return {
      valid: false,
      runtimeRoot: null,
      error: "运行时路径不存在",
    };
  }

  const runtimeRoot = await findRuntimeRoot(candidatePath);
  if (!runtimeRoot) {
    return {
      valid: false,
      runtimeRoot: null,
      error:
        "未找到包含 src/drama_processor、requirements.txt、pyproject.toml 的运行时目录",
    };
  }

  return {
    valid: true,
    runtimeRoot,
  };
}

export async function readRuntimeState(
  statePath: string,
): Promise<MaterialClipRuntimeState | null> {
  try {
    const raw = await fsp.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as MaterialClipRuntimeState;
    if (
      !parsed.runtimeRoot ||
      !fs.existsSync(parsed.runtimeRoot) ||
      !hasRuntimeMarkers(parsed.runtimeRoot)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeRuntimeState(
  statePath: string,
  state: MaterialClipRuntimeState,
): Promise<void> {
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function resolveRuntime(options: {
  appPath: string;
  cwd: string;
  userDataPath: string;
  isPackaged: boolean;
  statePath: string;
}): Promise<MaterialClipResolvedRuntime> {
  const managedState = await readRuntimeState(options.statePath);
  if (managedState) {
    return {
      source: "managed",
      runtimeRoot: managedState.runtimeRoot,
    };
  }

  if (!options.isPackaged) {
    const candidates = [
      path.join(options.cwd, "dramas_processor"),
      path.join(options.appPath, "dramas_processor"),
      path.join(options.appPath, "..", "dramas_processor"),
      path.join(options.appPath, "..", "..", "dramas_processor"),
    ];

    for (const candidate of candidates) {
      if (hasRuntimeMarkers(candidate)) {
        return {
          source: "dev-fallback",
          runtimeRoot: candidate,
        };
      }
    }
  }

  return {
    source: "missing",
    runtimeRoot: null,
  };
}

export async function importRuntimeCandidate(options: {
  sourcePath: string;
  managedRootDir: string;
  statePath: string;
}): Promise<MaterialClipRuntimeState> {
  await fsp.mkdir(options.managedRootDir, { recursive: true });

  const stagingDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "material-clip-runtime-"),
  );

  try {
    const sourceStats = await fsp.stat(options.sourcePath);
    if (sourceStats.isDirectory()) {
      await fsp.cp(options.sourcePath, stagingDir, { recursive: true });
    } else {
      const lowerName = options.sourcePath.toLowerCase();
      if (!lowerName.endsWith(".zip")) {
        throw new Error("仅支持导入目录或 zip 运行时包");
      }
      await extract(options.sourcePath, { dir: stagingDir });
    }

    const validation = await validateRuntimeCandidate(stagingDir);
    if (!validation.valid || !validation.runtimeRoot) {
      throw new Error(validation.error || "运行时包校验失败");
    }

    const nextRoot = path.join(options.managedRootDir, "current");
    const backupRoot = path.join(options.managedRootDir, "backup");

    await fsp.rm(backupRoot, { recursive: true, force: true });
    if (fs.existsSync(nextRoot)) {
      await fsp.rename(nextRoot, backupRoot);
    }

    try {
      await fsp.cp(validation.runtimeRoot, nextRoot, { recursive: true });

      const state: MaterialClipRuntimeState = {
        runtimeRoot: nextRoot,
        sourcePath: options.sourcePath,
        importedAt: new Date().toISOString(),
      };
      await writeRuntimeState(options.statePath, state);
      await fsp.rm(backupRoot, { recursive: true, force: true });
      return state;
    } catch (error) {
      await fsp.rm(nextRoot, { recursive: true, force: true });
      if (fs.existsSync(backupRoot)) {
        await fsp.rename(backupRoot, nextRoot);
      }
      throw error;
    }
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}

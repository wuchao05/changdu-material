import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, ".tmp-material-allocation-tests");
const tscPath = path.join(
  projectRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true, force: true });
}

try {
  execFileSync(
    process.execPath,
    [
      tscPath,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--lib",
      "es2020",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--outDir",
      outputDir,
      path.join(projectRoot, "src/shared/material-allocation.ts"),
      path.join(projectRoot, "src/shared/material-allocation.test.ts"),
    ],
    {
      stdio: "inherit",
      cwd: projectRoot,
    },
  );

  execFileSync(
    process.execPath,
    [path.join(outputDir, "material-allocation.test.js")],
    {
      stdio: "inherit",
      cwd: projectRoot,
    },
  );
} finally {
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

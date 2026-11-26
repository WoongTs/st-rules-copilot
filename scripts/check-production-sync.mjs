import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const privateGuard = fileURLToPath(new URL("./check-public.mjs", import.meta.url));
const privateManifest = new URL("./public-export-files.txt", import.meta.url);

// Public copies use their own deployment configuration. The private checkout also checks its public export.
if (existsSync(privateGuard) || existsSync(privateManifest)) {
  const result = spawnSync(process.execPath, [privateGuard, "production"], { stdio: "inherit" });
  if (result.error) console.error("Could not start the production sync check.");
  process.exitCode = result.status ?? 1;
}

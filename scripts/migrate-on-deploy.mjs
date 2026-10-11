// Runs pending Drizzle migrations at the start of a Vercel build, so the schema is
// ready before the new deployment can receive traffic. If this exits non-zero the
// build fails and Vercel keeps serving the previous deployment.
//
// Runs only on Vercel, and only for:
//   - Production deployments (branch `main`), against the production database
//   - Preview deployments of the `development` branch, against the development database
// Every other preview (feature branches) and every local build is skipped.
//
// Optional guard: set MIGRATE_EXPECTED_HOST (per Vercel environment) to the database
// host that environment must use. A mismatch aborts before anything is changed.
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;
const branch = process.env.VERCEL_GIT_COMMIT_REF;

if (!process.env.VERCEL) {
  console.log("[migrate] Not running on Vercel - skipping.");
  process.exit(0);
}

const isProduction = vercelEnv === "production";
const isDevelopmentBranch = vercelEnv === "preview" && branch === "development";

if (!isProduction && !isDevelopmentBranch) {
  console.log(`[migrate] ${vercelEnv} / ${branch}: not a migrating deployment - skipping.`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set.");
  process.exit(1);
}

const host = new URL(url).host;
console.log(`[migrate] ${vercelEnv} (${branch}) -> database host ${host}`);

const expected = process.env.MIGRATE_EXPECTED_HOST;
if (expected && expected !== host) {
  console.error(`[migrate] Expected host ${expected} but DATABASE_URL points at ${host}. Aborting.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["./node_modules/drizzle-kit/bin.cjs", "migrate"], {
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  console.error("[migrate] Migration failed - aborting the build.");
  process.exit(result.status ?? 1);
}
console.log("[migrate] Done.");

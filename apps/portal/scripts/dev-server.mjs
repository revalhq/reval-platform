// Detects a running `next dev` for this app via the lock file Next writes (.next/dev/lock).
//
//   node scripts/dev-server.mjs check [build|dev]   exit 1 with an explanation if one is running
//   node scripts/dev-server.mjs stop                stop it (no-op if none)
//
// Why: `next build` and `next dev` share .next/. Building while the dev server runs leaves the
// dev server recompiling and reloading the browser in a loop (UI flashes, /auth/me spam).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lockPath = fileURLToPath(new URL("../.next/dev/lock", import.meta.url));

function running() {
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch { return null; }
  if (!Number.isInteger(lock?.pid)) return null;
  try { process.kill(lock.pid, 0); } catch (e) { if (e.code !== "EPERM") return null; } // stale lock
  return lock;
}

const [action = "check", reason = "build"] = process.argv.slice(2);
const server = running();

if (action === "stop") {
  if (!server) process.exit(0);
  process.kill(server.pid, "SIGTERM");
  console.log(`Stopped the portal dev server (PID ${server.pid}, ${server.appUrl ?? `port ${server.port}`}).`);
  process.exit(0);
}

if (server) {
  const where = `PID ${server.pid}, ${server.appUrl ?? `port ${server.port}`}`;
  console.error(reason === "dev"
    ? `A portal dev server is already running (${where}).\nOpen it, or stop it first with: make stop`
    : `A portal dev server is running (${where}).\n` +
      "Building now would overwrite its .next/ output and send it into a reload loop.\n" +
      "Stop it first (Ctrl-C in its terminal, or: make stop), then build.");
  process.exit(1);
}

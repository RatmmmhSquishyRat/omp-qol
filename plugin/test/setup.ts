/**
 * bun test preload (wired in bunfig.toml): runs before ANY test file import.
 *
 * Why this exists: the host's pi-utils DirResolver freezes the config root
 * (from PI_CONFIG_DIR) the moment its module first loads. Test files that
 * statically import host packages (advisor-integration, integration-real-
 * session) freeze it before the kill-switch tests (goal D2, mode N12a,
 * advisor A17) can redirect it — so in a single-process `bun test` run their
 * lockfile writes landed in a directory the host loader never reads, and the
 * tests failed.
 *
 * Freezing an isolated root here, before any import, makes single-process
 * (`bun test`) and per-file (`bun test <file>`) runs equivalent and keeps
 * every test read/write out of the developer's real ~/.omp.
 *
 * The root is PID-SCOPED (.omp-qol-test-root-<pid>): two concurrent bun test
 * processes would otherwise share one root and race each other's lockfile
 * writes/sweeps. Kill-switch tests read process.env.PI_CONFIG_DIR in
 * beforeAll — the env value is stable for the whole process once set here.
 *
 * Stale-root sweep: roots whose pid is no longer alive (crashed/killed runs)
 * are removed on the next preload so they cannot accumulate in the home
 * directory. A reused pid keeps a stale root alive until that pid exits —
 * acceptable: the sweep is best-effort hygiene, isolation comes from the
 * pid-scoping itself.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TEST_CONFIG_DIR_PREFIX = ".omp-qol-test-root-";
const TEST_CONFIG_DIR_NAME = `${TEST_CONFIG_DIR_PREFIX}${process.pid}`;

function pidAlive(pid: number): boolean {
	try {
		// Signal 0 probes liveness without sending anything.
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Sweep stale roots from previous runs (best-effort; never fail the preload).
try {
	for (const entry of fs.readdirSync(os.homedir(), { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(TEST_CONFIG_DIR_PREFIX)) continue;
		const pidText = entry.name.slice(TEST_CONFIG_DIR_PREFIX.length);
		const pid = Number.parseInt(pidText, 10);
		const stale = !Number.isInteger(pid) || pid === process.pid || !pidAlive(pid);
		if (stale) {
			try {
				fs.rmSync(path.join(os.homedir(), entry.name), { recursive: true, force: true });
			} catch {
				/* another process may be sweeping concurrently */
			}
		}
	}
} catch {
	/* homedir listing failed — skip the sweep */
}

// Fresh root for THIS run (pid-scoped, so no other live run can collide).
fs.rmSync(path.join(os.homedir(), TEST_CONFIG_DIR_NAME), { recursive: true, force: true });
process.env.PI_CONFIG_DIR = TEST_CONFIG_DIR_NAME;

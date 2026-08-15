/**
 * bun test preload (wired in bunfig.toml): runs before ANY test file import.
 *
 * Why this exists: the host's pi-utils DirResolver freezes the config root
 * (from PI_CONFIG_DIR) the moment its module first loads. Test files that
 * statically import host packages (advisor-integration, integration-real-
 * session) freeze it before the kill-switch tests (goal D2, mode N12a) can
 * redirect it — so in a single-process `bun test` run their lockfile writes
 * landed in a directory the host loader never reads, and the tests failed.
 *
 * Freezing an isolated root here, before any import, makes single-process
 * (`bun test`) and per-file (`bun test <file>`) runs equivalent and keeps
 * every test read/write out of the developer's real ~/.omp.
 *
 * Kill-switch tests hardcode the same directory name instead of reading
 * process.env at module scope: earlier test files may shift PI_CONFIG_DIR
 * at runtime, but the host resolver stays frozen on this value.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TEST_CONFIG_DIR_NAME = ".omp-qol-test-root";

// Wipe leftovers from a previous run so stale lockfiles cannot leak settings.
fs.rmSync(path.join(os.homedir(), TEST_CONFIG_DIR_NAME), { recursive: true, force: true });
process.env.PI_CONFIG_DIR = TEST_CONFIG_DIR_NAME;

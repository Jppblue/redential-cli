import { buildBundleInteractively, type BuildBundleOptions } from "./build-bundle.js";

export type ScanCommandOptions = BuildBundleOptions & {
  log?: (message: string) => void;
};

/**
 * The `scan` command's actual behavior, independent of commander wiring —
 * exists mainly so the public-host warning ("warn, never block") is
 * testable without spawning the built CLI.
 */
export async function executeScanCommand(opts: ScanCommandOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const bundle = await buildBundleInteractively(opts);
  log(JSON.stringify(bundle, null, 2));
}

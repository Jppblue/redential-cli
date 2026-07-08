import { deleteCredentials } from "./credentials.js";

export interface LogoutOptions {
  configDir?: string;
  log?: (message: string) => void;
}

export function runLogout(opts: LogoutOptions = {}): void {
  const log = opts.log ?? console.log;
  const deleted = deleteCredentials(opts.configDir);
  log(deleted ? "Logged out." : "Not logged in — nothing to do.");
}

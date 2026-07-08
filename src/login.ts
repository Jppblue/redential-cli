import { AuthError } from "./errors.js";
import { getSiteUrl } from "./config.js";
import { saveCredentials } from "./credentials.js";
import { postJson, pollJson } from "./http-client.js";

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token?: string;
  error?: "authorization_pending" | "slow_down" | "expired_token" | "access_denied";
}

function requestDeviceAuthorization(siteUrl: string): Promise<DeviceAuthorization> {
  return postJson<DeviceAuthorization>(`${siteUrl}/api/cli/device/authorize`, {});
}

function pollDeviceToken(siteUrl: string, deviceCode: string): Promise<DeviceTokenResponse> {
  // Not postJson: this endpoint returns HTTP 400 for authorization_pending/
  // slow_down too (RFC 8628 shape), which postJson would treat as a fatal
  // NetworkError before ever reading the body.
  return pollJson<DeviceTokenResponse>(`${siteUrl}/api/cli/device/token`, { device_code: deviceCode });
}

export interface LoginOptions {
  configDir?: string;
  log?: (message: string) => void;
  // Injectable so tests don't have to wait out real polling intervals.
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * RFC 8628-shaped device authorization grant. Nothing on the server side of
 * this exists yet (redence has no /api/cli/* routes at the time of writing —
 * this repo defines the contract; redence implements to match, see
 * docs/login-submit.md). Never sends anything except the device code itself.
 */
export async function runLogin(opts: LoginOptions = {}): Promise<void> {
  const log = opts.log ?? console.log;
  const sleep = opts.sleepFn ?? defaultSleep;
  const siteUrl = getSiteUrl();

  const auth = await requestDeviceAuthorization(siteUrl);
  log(`First, go to: ${auth.verification_uri}`);
  log(`Then enter this code: ${auth.user_code}`);
  log("Waiting for confirmation...");

  let intervalMs = Math.max(auth.interval, 1) * 1000;
  const deadline = Date.now() + auth.expires_in * 1000;

  for (;;) {
    if (Date.now() > deadline) {
      throw new AuthError("Login timed out before the code was confirmed. Run `redential login` again.");
    }
    await sleep(intervalMs);

    const result = await pollDeviceToken(siteUrl, auth.device_code);
    if (result.access_token) {
      saveCredentials(
        { access_token: result.access_token, site_url: siteUrl, obtained_at: new Date().toISOString() },
        opts.configDir
      );
      log("Logged in.");
      return;
    }
    switch (result.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        intervalMs += 5000;
        continue;
      case "access_denied":
        throw new AuthError("Login was denied.");
      case "expired_token":
        throw new AuthError("The login code expired before it was confirmed. Run `redential login` again.");
      default:
        throw new AuthError("Unexpected response from the login server.");
    }
  }
}

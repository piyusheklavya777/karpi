// src/utils/keychain.ts

import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

async function getPassword(
  service: string,
  account: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    const pw = stdout.toString().trim();
    return pw.length ? pw : null;
  } catch (err) {
    logger.debug(`Keychain getPassword not found for ${account}@${service}`);
    return null;
  }
}

async function setPassword(
  service: string,
  account: string,
  password: string
): Promise<void> {
  try {
    // -U to update existing, -w for password value
    await execFileAsync("/usr/bin/security", [
      "add-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
      password,
      "-U",
    ]);
  } catch (err) {
    logger.error("Keychain setPassword failed", err);
    throw err;
  }
}

async function deletePassword(
  service: string,
  account: string
): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/security", [
      "delete-generic-password",
      "-s",
      service,
      "-a",
      account,
    ]);
    return true;
  } catch (err) {
    // If not found, consider it removed
    logger.debug(`Keychain deletePassword not found for ${account}@${service}`);
    return false;
  }
}

export const keychain = { getPassword, setPassword, deletePassword };

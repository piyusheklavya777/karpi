import { invoke } from "@tauri-apps/api/core";

export async function runKarpi<T = unknown>(args: string[]): Promise<T> {
  const raw = await invoke<string>("run_karpi", { args });
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

// ── Typed helpers ────────────────────────────────────────────────────────────

export interface ProfileInfo {
  id: string;
  username: string;
  email: string;
  created_at?: string;
  last_login?: string;
  biometric_enabled: boolean;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  username?: string;
  profile_id?: string;
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  return runKarpi<ProfileInfo[]>(["profiles", "list"]);
}

export async function login(
  username: string,
  password: string
): Promise<AuthResult> {
  return runKarpi<AuthResult>([
    "auth",
    "login",
    "-u",
    username,
    "-p",
    password,
  ]);
}

export async function register(
  username: string,
  password: string,
  email?: string
): Promise<AuthResult> {
  const args = ["auth", "register", "-u", username, "-p", password];
  if (email) {
    args.push("-e", email);
  }
  return runKarpi<AuthResult>(args);
}

export async function logout(): Promise<{ success: boolean }> {
  return runKarpi<{ success: boolean }>(["auth", "logout"]);
}

// ── Biometric (Touch ID) helpers ─────────────────────────────────────────────

export interface BiometricStatusResult {
  available: boolean;
}

export async function biometricStatus(): Promise<BiometricStatusResult> {
  return runKarpi<BiometricStatusResult>(["auth", "biometric-status"]);
}

export async function biometricLogin(username: string): Promise<AuthResult> {
  return runKarpi<AuthResult>(["auth", "biometric-login", "-u", username]);
}

export async function biometricEnable(
  username: string,
  password: string
): Promise<AuthResult> {
  return runKarpi<AuthResult>([
    "auth",
    "biometric-enable",
    "-u",
    username,
    "-p",
    password,
  ]);
}

export async function biometricDisable(username: string): Promise<AuthResult> {
  return runKarpi<AuthResult>(["auth", "biometric-disable", "-u", username]);
}

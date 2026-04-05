// src/commands/cli/auth.cmd.ts

import type { Command } from "commander";
import { authService } from "../../services/auth.service";
import { biometricService } from "../../services/biometric.service";
import { profileService } from "../../services/profile.service";
import { output, outputError } from "../../utils/cli-helpers";

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Non-interactive authentication commands");

  auth
    .command("login")
    .description("Login with username and password (non-interactive)")
    .requiredOption("-u, --username <username>", "Username")
    .requiredOption("-p, --password <password>", "Password")
    .action(async (options: { username: string; password: string }) => {
      const result = await authService.login({
        username: options.username,
        password: options.password,
      });

      if (result.success) {
        output({
          success: true,
          username: result.profile?.username,
          profile_id: result.profile?.id,
        });
      } else {
        output({
          success: false,
          error: result.error,
        });
      }
    });

  auth
    .command("register")
    .description("Register a new profile (non-interactive)")
    .requiredOption("-u, --username <username>", "Username")
    .requiredOption("-p, --password <password>", "Password")
    .option("-e, --email <email>", "Email address")
    .action(
      async (options: {
        username: string;
        password: string;
        email?: string;
      }) => {
        const result = await authService.register(
          {
            username: options.username,
            password: options.password,
          },
          options.email
        );

        if (result.success) {
          output({
            success: true,
            username: result.profile?.username,
            profile_id: result.profile?.id,
          });
        } else {
          output({
            success: false,
            error: result.error,
          });
        }
      }
    );

  auth
    .command("status")
    .description("Check authentication status")
    .action(() => {
      const current = authService.getCurrentUser();

      if (current) {
        output({
          authenticated: true,
          username: current.profile.username,
          profile_id: current.profile.id,
          session_expires: current.session.expires_at,
        });
      } else {
        output({
          authenticated: false,
        });
      }
    });

  auth
    .command("logout")
    .description("Logout current session")
    .action(() => {
      const success = authService.logout();
      output({ success });
    });

  // ── Biometric (Touch ID) commands ──────────────────────────────────────

  auth
    .command("biometric-status")
    .description("Check if Touch ID is available on this device")
    .action(async () => {
      const available = await biometricService.isAvailable();
      output({ available });
    });

  auth
    .command("biometric-login")
    .description("Login using Touch ID (biometric must be enabled for profile)")
    .requiredOption("-u, --username <username>", "Username")
    .action(async (options: { username: string }) => {
      // Verify Touch ID is available
      const available = await biometricService.isAvailable();
      if (!available) {
        output({ success: false, error: "Touch ID is not available on this device" });
        return;
      }

      // Prompt Touch ID
      const authenticated = await biometricService.authenticate(
        `sign in as ${options.username}`
      );
      if (!authenticated) {
        output({ success: false, error: "Touch ID authentication failed" });
        return;
      }

      // Create session via biometric login
      const result = await authService.loginWithBiometric(options.username);
      if (result.success) {
        output({
          success: true,
          username: result.profile?.username,
          profile_id: result.profile?.id,
        });
      } else {
        output({ success: false, error: result.error });
      }
    });

  auth
    .command("biometric-enable")
    .description("Enable Touch ID for a profile (requires password verification)")
    .requiredOption("-u, --username <username>", "Username")
    .requiredOption("-p, --password <password>", "Password")
    .action(async (options: { username: string; password: string }) => {
      // Verify password first as security gate
      const loginResult = await authService.login({
        username: options.username,
        password: options.password,
      });

      if (!loginResult.success) {
        output({ success: false, error: loginResult.error || "Invalid credentials" });
        return;
      }

      // Check Touch ID availability
      const available = await biometricService.isAvailable();
      if (!available) {
        output({ success: false, error: "Touch ID is not available on this device" });
        return;
      }

      // Enable biometric on profile
      const profile = profileService.getProfileByUsername(options.username);
      if (!profile) {
        output({ success: false, error: "Profile not found" });
        return;
      }

      profileService.updateProfile(profile.id, { biometric_enabled: true });
      output({ success: true, biometric_enabled: true });
    });

  auth
    .command("biometric-disable")
    .description("Disable Touch ID for a profile")
    .requiredOption("-u, --username <username>", "Username")
    .action(async (options: { username: string }) => {
      const profile = profileService.getProfileByUsername(options.username);
      if (!profile) {
        output({ success: false, error: "Profile not found" });
        return;
      }

      profileService.updateProfile(profile.id, { biometric_enabled: false });
      output({ success: true, biometric_enabled: false });
    });
}

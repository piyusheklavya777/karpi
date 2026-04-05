// src/commands/cli/profiles.cmd.ts

import type { Command } from "commander";
import { profileService } from "../../services/profile.service";
import { output, outputTable } from "../../utils/cli-helpers";

export function registerProfilesCommand(program: Command): void {
  const profiles = program
    .command("profiles")
    .description("Manage user profiles");

  profiles
    .command("list")
    .description("List all profiles")
    .action(() => {
      const allProfiles = profileService.listProfiles();

      output(
        allProfiles.map((p) => ({
          id: p.id,
          username: p.username,
          email: p.email || "",
          created_at: p.created_at,
          last_login: p.last_login,
          biometric_enabled: p.biometric_enabled || false,
        })),
        () => {
          outputTable(
            allProfiles.map((p) => ({
              username: p.username,
              email: p.email || "-",
              last_login: p.last_login || "-",
            })),
            [
              { key: "username", header: "Username" },
              { key: "email", header: "Email" },
              { key: "last_login", header: "Last Login" },
            ]
          );
        }
      );
    });
}

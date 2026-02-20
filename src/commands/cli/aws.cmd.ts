// src/commands/cli/aws.cmd.ts

import { Command } from "commander";
import { nanoid } from "nanoid";
import {
  requireAuth,
  resolveAWSProfile,
  output,
  outputError,
  outputSuccess,
  outputTable,
} from "../../utils/cli-helpers";
import { storageService } from "../../services/storage.service";
import { awsService } from "../../services/aws.service";
import type { IAWSProfile } from "../../types";

export function registerAWSCommand(program: Command): void {
  const aws = program
    .command("aws")
    .description("Manage AWS credential profiles");

  // ── aws list ──────────────────────────────────────────────────────────────
  aws
    .command("list")
    .description("List all AWS profiles")
    .action(() => {
      requireAuth();
      const profiles = storageService.getAllAWSProfiles();
      output(
        profiles.map((p) => ({
          name: p.name,
          auth_type: p.auth_type,
          region: p.default_region,
          cli_profile: p.cli_profile_name || "-",
          last_used: p.last_used || "never",
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "auth_type", header: "Auth Type" },
            { key: "region", header: "Region" },
            { key: "cli_profile", header: "CLI Profile" },
            { key: "last_used", header: "Last Used" },
          ]);
        }
      );
    });

  // ── aws show <name> ───────────────────────────────────────────────────────
  aws
    .command("show <name>")
    .description("Show profile details")
    .action((name: string) => {
      requireAuth();
      const profile = resolveAWSProfile(name);

      // Don't expose secret in output
      const safeProfile = {
        ...profile,
        secret_access_key: profile.secret_access_key ? "****" : undefined,
      };

      output(safeProfile, (data) => {
        const p = data as typeof safeProfile;
        console.log(`\nAWS Profile: ${p.name}`);
        console.log(`  Auth Type: ${p.auth_type}`);
        console.log(`  Region:    ${p.default_region}`);
        if (p.cli_profile_name)
          console.log(`  CLI Prof:  ${p.cli_profile_name}`);
        if (p.access_key_id)
          console.log(`  Key ID:    ${p.access_key_id}`);
        if (p.secret_access_key)
          console.log(`  Secret:    ****`);
        console.log(`  Created:   ${p.created_at}`);
        if (p.last_used) console.log(`  Last Used: ${p.last_used}`);
      });
    });

  // ── aws add <name> ────────────────────────────────────────────────────────
  aws
    .command("add <name>")
    .description("Add an AWS profile")
    .requiredOption("--type <type>", "Auth type: cli_profile or access_keys")
    .option("--cli-profile <profile>", "AWS CLI profile name (for cli_profile type)")
    .requiredOption("--region <region>", "Default AWS region")
    .option("--key-id <id>", "Access key ID (for access_keys type)")
    .option("--secret <secret>", "Secret access key (for access_keys type)")
    .action(
      (
        name: string,
        opts: {
          type: string;
          cliProfile?: string;
          region: string;
          keyId?: string;
          secret?: string;
        }
      ) => {
        requireAuth();

        // Validate type
        if (opts.type !== "cli_profile" && opts.type !== "access_keys") {
          outputError('Invalid --type. Must be "cli_profile" or "access_keys"');
          process.exit(1);
        }

        // Validate required fields per type
        if (opts.type === "cli_profile" && !opts.cliProfile) {
          outputError("--cli-profile is required when --type is cli_profile");
          process.exit(1);
        }
        if (opts.type === "access_keys" && (!opts.keyId || !opts.secret)) {
          outputError(
            "--key-id and --secret are required when --type is access_keys"
          );
          process.exit(1);
        }

        // Check if name already exists
        const existing = storageService.getAWSProfileByName(name);
        if (existing) {
          outputError(`AWS profile "${name}" already exists`);
          process.exit(1);
        }

        const profile: IAWSProfile = {
          id: nanoid(),
          name,
          auth_type: opts.type as "cli_profile" | "access_keys",
          cli_profile_name: opts.cliProfile,
          access_key_id: opts.keyId,
          secret_access_key: opts.secret,
          default_region: opts.region,
          created_at: new Date().toISOString(),
        };

        storageService.saveAWSProfile(profile);
        outputSuccess(`AWS profile "${name}" added`, {
          profile: { ...profile, secret_access_key: undefined },
        });
      }
    );

  // ── aws edit <name> ───────────────────────────────────────────────────────
  aws
    .command("edit <name>")
    .description("Edit AWS profile")
    .option("--name <new-name>", "New name")
    .option("--region <region>", "New default region")
    .action(
      (name: string, opts: { name?: string; region?: string }) => {
        requireAuth();
        const profile = resolveAWSProfile(name);

        const updates: Partial<IAWSProfile> = {};
        if (opts.name) updates.name = opts.name;
        if (opts.region) updates.default_region = opts.region;

        if (Object.keys(updates).length === 0) {
          outputError("No updates specified. Use --name or --region.");
          process.exit(1);
        }

        const updated = storageService.updateAWSProfile(profile.id, updates);
        if (updated) {
          outputSuccess(`AWS profile "${name}" updated`);
        } else {
          outputError("Failed to update AWS profile");
          process.exit(1);
        }
      }
    );

  // ── aws remove <name> ─────────────────────────────────────────────────────
  aws
    .command("remove <name>")
    .description("Delete AWS profile")
    .action((name: string) => {
      requireAuth();
      const profile = resolveAWSProfile(name);
      const deleted = storageService.deleteAWSProfile(profile.id);
      if (deleted) {
        outputSuccess(`AWS profile "${name}" deleted`);
      } else {
        outputError("Failed to delete AWS profile");
        process.exit(1);
      }
    });

  // ── aws test <name> ───────────────────────────────────────────────────────
  aws
    .command("test <name>")
    .description("Test AWS credentials")
    .action(async (name: string) => {
      requireAuth();
      const profile = resolveAWSProfile(name);
      const result = await awsService.testCredentials(profile);

      if (result.success) {
        outputSuccess(`AWS credentials for "${name}" are valid`);
      } else {
        outputError(`AWS credentials test failed: ${result.error}`);
        process.exit(1);
      }
    });
}

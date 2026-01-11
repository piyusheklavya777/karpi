// src/commands/dashboard/aws-profiles.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { nanoid } from "nanoid";
import { storageService } from "../../services/storage.service";
import { awsService, AWS_REGIONS } from "../../services/aws.service";
import { COLORS } from "../../config/constants";
import type { IAWSProfile } from "../../types";

// ═══════════════════════════════════════════════════════════════════════════════
// UI Constants
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
  AWS: "☁️",
  PROFILE: "👤",
  KEY: "🔑",
  CHECK: "✓",
  CROSS: "✗",
  PLUS: "➕",
  TRASH: "🗑️",
  BACK: "◀",
  ACTIVE: "🟢",
  INACTIVE: "⚫",
  EDIT: "✏️",
  TEST: "🔍",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main AWS Profiles Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function awsProfilesMenu(): Promise<void> {
  let running = true;

  while (running) {
    console.clear();
    displayHeader();

    const profiles = storageService.getAllAWSProfiles();

    if (profiles.length === 0) {
      displayEmptyState();
    }

    const choices = buildMainMenuChoices(profiles);

    const { action } = await inquirer.prompt({
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Select an option:"),
      choices,
      pageSize: 15,
    });

    if (action === "back") {
      running = false;
    } else if (action === "add_profile") {
      await addAWSProfileFlow();
    } else if (action.startsWith("profile:")) {
      const profileId = action.replace("profile:", "");
      await awsProfileActionsMenu(profileId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AWS Profile Actions Menu
// ═══════════════════════════════════════════════════════════════════════════════

async function awsProfileActionsMenu(profileId: string): Promise<void> {
  const profile = storageService.getAWSProfile(profileId);
  if (!profile) return;

  let running = true;

  while (running) {
    console.clear();
    displayProfileHeader(profile);

    const choices = buildProfileActionsChoices(profile);

    const { action } = await inquirer.prompt({
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Select an action:"),
      choices,
      pageSize: 12,
    });

    switch (action) {
      case "test":
        await testCredentialsFlow(profile);
        break;
      case "edit":
        await editProfileFlow(profile);
        break;
      case "delete":
        const deleted = await deleteProfileFlow(profile);
        if (deleted) running = false;
        break;
      case "back":
        running = false;
        break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flow Handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function addAWSProfileFlow(): Promise<void> {
  console.clear();
  console.log(
    boxen(
      chalk.hex(COLORS.PRIMARY).bold(`${ICONS.PLUS} Add AWS Profile`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "green",
      }
    )
  );
  console.log();

  // Get profile name
  const { name } = await inquirer.prompt({
    type: "input",
    name: "name",
    message: "Profile name (friendly alias):",
    validate: (input: string) => {
      if (!input.trim()) return "Profile name is required";
      if (storageService.getAWSProfileByName(input.trim())) {
        return "A profile with this name already exists";
      }
      return true;
    },
  });

  // Choose authentication type
  const { authType } = await inquirer.prompt({
    type: "list",
    name: "authType",
    message: "Authentication method:",
    choices: [
      {
        name: `${ICONS.PROFILE}  Use existing AWS CLI profile`,
        value: "cli_profile",
      },
      {
        name: `${ICONS.KEY}  Enter AWS Access Keys`,
        value: "access_keys",
      },
    ],
  });

  let cliProfileName: string | undefined;
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;

  if (authType === "cli_profile") {
    const { profileName } = await inquirer.prompt({
      type: "input",
      name: "profileName",
      message: "AWS CLI profile name:",
      default: "default",
      validate: (input: string) =>
        input.trim() ? true : "Profile name is required",
    });
    cliProfileName = profileName.trim();
  } else {
    const { accessKey, secretKey } = await inquirer.prompt([
      {
        type: "input",
        name: "accessKey",
        message: "AWS Access Key ID:",
        validate: (input: string) => {
          if (!input.trim()) return "Access Key ID is required";
          if (!/^[A-Z0-9]{16,128}$/i.test(input.trim())) {
            return "Invalid Access Key ID format";
          }
          return true;
        },
      },
      {
        type: "password",
        name: "secretKey",
        message: "AWS Secret Access Key:",
        mask: "*",
        validate: (input: string) =>
          input.trim() ? true : "Secret Access Key is required",
      },
    ]);
    accessKeyId = accessKey.trim();
    secretAccessKey = secretKey.trim();
  }

  // Choose default region
  const { region } = await inquirer.prompt({
    type: "list",
    name: "region",
    message: "Default AWS Region:",
    choices: AWS_REGIONS.map((r) => ({
      name: `${r.value} - ${r.name}`,
      value: r.value,
    })),
    default: "us-east-1",
    pageSize: 12,
  });

  // Create the profile object
  const newProfile: IAWSProfile = {
    id: nanoid(),
    name: name.trim(),
    auth_type: authType,
    cli_profile_name: cliProfileName,
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    default_region: region,
    created_at: new Date().toISOString(),
  };

  // Test credentials before saving
  const { testNow } = await inquirer.prompt({
    type: "confirm",
    name: "testNow",
    message: "Test credentials before saving?",
    default: true,
  });

  if (testNow) {
    const spinner = ora("Testing AWS credentials...").start();
    const result = await awsService.testCredentials(newProfile);

    if (result.success) {
      spinner.succeed(chalk.green("Credentials verified successfully!"));
    } else {
      spinner.fail(chalk.red(`Failed to verify: ${result.error}`));

      const { saveAnyway } = await inquirer.prompt({
        type: "confirm",
        name: "saveAnyway",
        message: "Save profile anyway?",
        default: false,
      });

      if (!saveAnyway) {
        console.log(chalk.yellow("\nProfile not saved."));
        await pressEnterToContinue();
        return;
      }
    }
  }

  // Save the profile
  storageService.saveAWSProfile(newProfile);

  console.log();
  console.log(
    boxen(
      chalk.green(`${ICONS.CHECK} AWS Profile "${name}" created successfully!`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "green",
      }
    )
  );

  await pressEnterToContinue();
}

async function testCredentialsFlow(profile: IAWSProfile): Promise<void> {
  const spinner = ora("Testing AWS credentials...").start();
  const result = await awsService.testCredentials(profile);

  if (result.success) {
    spinner.succeed(chalk.green("Credentials are valid!"));
  } else {
    spinner.fail(chalk.red(`Failed: ${result.error}`));
  }

  await pressEnterToContinue();
}

async function editProfileFlow(profile: IAWSProfile): Promise<void> {
  console.clear();
  console.log(
    boxen(
      chalk.hex(COLORS.SECONDARY).bold(`${ICONS.EDIT} Edit AWS Profile`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "blue",
      }
    )
  );
  console.log();

  const { field } = await inquirer.prompt({
    type: "list",
    name: "field",
    message: "What would you like to edit?",
    choices: [
      { name: "Profile Name", value: "name" },
      { name: "Default Region", value: "region" },
      ...(profile.auth_type === "cli_profile"
        ? [{ name: "AWS CLI Profile Name", value: "cli_profile_name" }]
        : [
          { name: "Access Key ID", value: "access_key_id" },
          { name: "Secret Access Key", value: "secret_access_key" },
        ]),
      new inquirer.Separator(),
      { name: `${ICONS.BACK} Cancel`, value: "cancel" },
    ],
  });

  if (field === "cancel") return;

  let updates: Partial<IAWSProfile> = {};

  switch (field) {
    case "name":
      const { newName } = await inquirer.prompt({
        type: "input",
        name: "newName",
        message: "New profile name:",
        default: profile.name,
        validate: (input: string) => {
          if (!input.trim()) return "Profile name is required";
          const existing = storageService.getAWSProfileByName(input.trim());
          if (existing && existing.id !== profile.id) {
            return "A profile with this name already exists";
          }
          return true;
        },
      });
      updates.name = newName.trim();
      break;

    case "region":
      const { newRegion } = await inquirer.prompt({
        type: "list",
        name: "newRegion",
        message: "New default region:",
        choices: AWS_REGIONS.map((r) => ({
          name: `${r.value} - ${r.name}`,
          value: r.value,
        })),
        default: profile.default_region,
        pageSize: 12,
      });
      updates.default_region = newRegion;
      break;

    case "cli_profile_name":
      const { newCliProfile } = await inquirer.prompt({
        type: "input",
        name: "newCliProfile",
        message: "New AWS CLI profile name:",
        default: profile.cli_profile_name,
        validate: (input: string) =>
          input.trim() ? true : "Profile name is required",
      });
      updates.cli_profile_name = newCliProfile.trim();
      break;

    case "access_key_id":
      const { newAccessKey } = await inquirer.prompt({
        type: "input",
        name: "newAccessKey",
        message: "New Access Key ID:",
        default: profile.access_key_id,
        validate: (input: string) => {
          if (!input.trim()) return "Access Key ID is required";
          if (!/^[A-Z0-9]{16,128}$/i.test(input.trim())) {
            return "Invalid Access Key ID format";
          }
          return true;
        },
      });
      updates.access_key_id = newAccessKey.trim();
      break;

    case "secret_access_key":
      const { newSecretKey } = await inquirer.prompt({
        type: "password",
        name: "newSecretKey",
        message: "New Secret Access Key:",
        mask: "*",
        validate: (input: string) =>
          input.trim() ? true : "Secret Access Key is required",
      });
      updates.secret_access_key = newSecretKey.trim();
      break;
  }

  storageService.updateAWSProfile(profile.id, updates);
  console.log(chalk.green(`\n${ICONS.CHECK} Profile updated successfully!`));
  await pressEnterToContinue();
}

async function deleteProfileFlow(profile: IAWSProfile): Promise<boolean> {
  // Check if any servers are using this profile
  const servers = storageService.getAllServers();
  const linkedServers = servers.filter((s) => s.aws_profile_id === profile.id);

  if (linkedServers.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠️  This profile is linked to ${linkedServers.length} server(s):`
      )
    );
    linkedServers.forEach((s) => console.log(`   - ${s.name}`));
    console.log();
  }

  const { confirm } = await inquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: chalk.red(`Delete AWS profile "${profile.name}"?`),
    default: false,
  });

  if (confirm) {
    // Unlink servers if any
    linkedServers.forEach((server) => {
      storageService.saveServer({ ...server, aws_profile_id: undefined });
    });

    storageService.deleteAWSProfile(profile.id);
    console.log(chalk.green(`\n${ICONS.CHECK} Profile deleted.`));
    await pressEnterToContinue();
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Functions
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader(): void {
  const header = boxen(
    chalk.hex(COLORS.PRIMARY).bold(`${ICONS.AWS} AWS Profiles`),
    {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
    }
  );
  console.log(header);
  console.log();
}

function displayEmptyState(): void {
  console.log(
    boxen(
      chalk.dim("No AWS profiles configured.\n") +
      chalk.hex(COLORS.SECONDARY)(
        "Add a profile to fetch EC2 instances from AWS."
      ),
      {
        padding: 1,
        borderStyle: "round",
        borderColor: "gray",
      }
    )
  );
  console.log();
}

function displayProfileHeader(profile: IAWSProfile): void {
  const authInfo =
    profile.auth_type === "cli_profile"
      ? `CLI Profile: ${profile.cli_profile_name}`
      : `Access Key: ${profile.access_key_id?.slice(0, 8)}...`;

  const content = [
    chalk.hex(COLORS.PRIMARY).bold(`${ICONS.AWS} ${profile.name}`),
    "",
    chalk.dim("Authentication: ") + chalk.white(authInfo),
    chalk.dim("Region: ") + chalk.white(profile.default_region),
    chalk.dim("Created: ") +
    chalk.white(new Date(profile.created_at).toLocaleDateString()),
    ...(profile.last_used
      ? [
        chalk.dim("Last used: ") +
        chalk.white(new Date(profile.last_used).toLocaleDateString()),
      ]
      : []),
  ].join("\n");

  console.log(
    boxen(content, {
      padding: 1,
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Menu Builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildMainMenuChoices(
  profiles: IAWSProfile[]
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  if (profiles.length > 0) {
    choices.push(
      new inquirer.Separator(chalk.dim("─── AWS Profiles ──────────────────"))
    );

    profiles.forEach((profile) => {
      const authType = profile.auth_type === "cli_profile" ? "CLI" : "Keys";
      const region = profile.default_region;

      // Note: Using chalk.bold without colors so inquirer selection highlighting works
      choices.push({
        name: `${ICONS.AWS}  ${chalk.bold(profile.name)} (${authType}: ${region})`,
        value: `profile:${profile.id}`,
      });
    });
  }

  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────"))
  );
  choices.push({
    name: `${ICONS.PLUS}  Add AWS Profile`,
    value: "add_profile",
  });

  choices.push(
    new inquirer.Separator(chalk.dim("───────────────────────────────────"))
  );
  choices.push({
    name: `${ICONS.BACK}  Back to Dashboard`,
    value: "back",
  });

  return choices;
}

function buildProfileActionsChoices(
  _profile: IAWSProfile
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  choices.push({
    name: `${ICONS.TEST}  Test Credentials`,
    value: "test",
  });

  choices.push({
    name: `${ICONS.EDIT}  Edit Profile`,
    value: "edit",
  });

  choices.push(
    new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────"))
  );
  choices.push({
    name: `${ICONS.TRASH}  Delete Profile`,
    value: "delete",
  });

  choices.push(
    new inquirer.Separator(chalk.dim("───────────────────────────────────"))
  );
  choices.push({
    name: `${ICONS.BACK}  Back`,
    value: "back",
  });

  return choices;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

async function pressEnterToContinue(): Promise<void> {
  await inquirer.prompt({
    type: "input",
    name: "continue",
    message: chalk.dim("Press Enter to continue..."),
  });
}

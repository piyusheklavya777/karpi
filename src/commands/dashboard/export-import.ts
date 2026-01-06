// src/commands/dashboard/export-import.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join } from "path";
import { nanoid } from "nanoid";
import { COLORS } from "../../config/constants";
import { exportService } from "../../services/export.service";
import { storageService } from "../../services/storage.service";
import { APP_VERSION } from "../../config/constants";
import type { IExportSelection, IImportDiff } from "../../services/export.service";

const ICONS = {
    EXPORT: "📦",
    IMPORT: "📥",
    SERVER: "🖥️",
    AWS: "☁️",
    RDS: "🗄️",
    CHECK: "✓",
    NEW: "✨",
    MODIFIED: "📝",
    UNCHANGED: "⏸️",
    BACK: "←",
    SAVE: "💾",
    PROFILE: "📋",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Export Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function exportConfigMenu(): Promise<void> {
    console.clear();
    displayExportHeader();

    const savedProfiles = storageService.getAllExportProfiles();
    const choices: any[] = [];

    // Option to use saved profile
    if (savedProfiles.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Saved Profiles ───────────────"))
        );
        savedProfiles.forEach((profile) => {
            const itemCount =
                profile.server_ids.length +
                profile.aws_profile_ids.length +
                profile.rds_instance_ids.length;
            choices.push({
                name: `${ICONS.PROFILE}  ${chalk.hex(COLORS.PRIMARY)(profile.name)} ${chalk.dim(`(${itemCount} items)`)}`,
                value: { type: "profile", id: profile.id },
            });
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("─── Actions ──────────────────────"))
    );
    choices.push({
        name: `${ICONS.CHECK}  ${chalk.bold("Select items to export")}`,
        value: { type: "select" },
    });
    choices.push(
        new inquirer.Separator(chalk.dim("───────────────────────────────────"))
    );
    choices.push({
        name: `${ICONS.BACK}  ${chalk.dim("Back to Dashboard")}`,
        value: { type: "back" },
    });

    const { selection } = await inquirer.prompt({
        type: "list",
        name: "selection",
        message: chalk.hex(COLORS.SECONDARY)("Export option:"),
        choices,
        pageSize: 15,
    });

    if (selection.type === "back") return;

    if (selection.type === "profile") {
        // Use saved profile
        const profile = storageService.getExportProfile(selection.id);
        if (profile) {
            await performExport({
                server_ids: profile.server_ids,
                aws_profile_ids: profile.aws_profile_ids,
                rds_instance_ids: profile.rds_instance_ids,
            });
        }
    } else if (selection.type === "select") {
        // Show selection UI
        await selectAndExport();
    }
}

async function selectAndExport(): Promise<void> {
    const items = exportService.getExportableItems();

    if (
        items.servers.length === 0 &&
        items.aws_profiles.length === 0 &&
        items.rds_instances.length === 0
    ) {
        console.log(chalk.yellow("\n⚠️  No items to export."));
        await waitForEnter();
        return;
    }

    // Build checkbox choices
    const choices: any[] = [];

    if (items.servers.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.hex(COLORS.PRIMARY).bold("─── Servers ───"))
        );
        items.servers.forEach((server) => {
            choices.push({
                name: `${ICONS.SERVER}  ${server.name} ${chalk.dim(`(${server.host})`)}`,
                value: { type: "server", id: server.id },
                checked: true,
            });
        });
    }

    if (items.aws_profiles.length > 0) {
        choices.push(
            new inquirer.Separator(
                chalk.hex(COLORS.PRIMARY).bold("─── AWS Profiles ───")
            )
        );
        items.aws_profiles.forEach((profile) => {
            choices.push({
                name: `${ICONS.AWS}  ${profile.name} ${chalk.dim(`(${profile.auth_type})`)}`,
                value: { type: "aws", id: profile.id },
                checked: true,
            });
        });
    }

    if (items.rds_instances.length > 0) {
        choices.push(
            new inquirer.Separator(
                chalk.hex(COLORS.PRIMARY).bold("─── RDS Instances ───")
            )
        );
        items.rds_instances.forEach((rds) => {
            choices.push({
                name: `${ICONS.RDS}  ${rds.name} ${chalk.dim(`(${rds.endpoint.substring(0, 30)}...)`)}`,
                value: { type: "rds", id: rds.id },
                checked: true,
            });
        });
    }

    const { selectedItems } = await inquirer.prompt({
        type: "checkbox",
        name: "selectedItems",
        message: chalk.hex(COLORS.SECONDARY)("Select items to export:"),
        choices,
        pageSize: 20,
    });

    if (selectedItems.length === 0) {
        console.log(chalk.yellow("\n⚠️  No items selected."));
        await waitForEnter();
        return;
    }

    // Build selection object
    const selection: IExportSelection = {
        server_ids: selectedItems
            .filter((i: any) => i.type === "server")
            .map((i: any) => i.id),
        aws_profile_ids: selectedItems
            .filter((i: any) => i.type === "aws")
            .map((i: any) => i.id),
        rds_instance_ids: selectedItems
            .filter((i: any) => i.type === "rds")
            .map((i: any) => i.id),
    };

    // Ask to save as profile
    const { saveProfile } = await inquirer.prompt({
        type: "confirm",
        name: "saveProfile",
        message: chalk.hex(COLORS.SECONDARY)(
            "Save this selection as a reusable profile?"
        ),
        default: false,
    });

    if (saveProfile) {
        const { profileName } = await inquirer.prompt({
            type: "input",
            name: "profileName",
            message: chalk.hex(COLORS.SECONDARY)("Profile name:"),
            validate: (input: string) =>
                input.length > 0 ? true : "Name is required",
        });

        storageService.saveExportProfile({
            id: nanoid(),
            name: profileName,
            server_ids: selection.server_ids,
            aws_profile_ids: selection.aws_profile_ids,
            rds_instance_ids: selection.rds_instance_ids,
            created_at: new Date().toISOString(),
        });

        console.log(
            chalk.green(`\n${ICONS.SAVE} Profile "${profileName}" saved!`)
        );
    }

    await performExport(selection);
}

async function performExport(selection: IExportSelection): Promise<void> {
    // Version-based filename
    const defaultPath = join(
        homedir(),
        "Desktop",
        `karpi-config-v${APP_VERSION}.yaml`
    );

    const { outputPath, embedKeys } = await inquirer.prompt([
        {
            type: "input",
            name: "outputPath",
            message: chalk.hex(COLORS.SECONDARY)("Output file path:"),
            default: defaultPath,
        },
        {
            type: "confirm",
            name: "embedKeys",
            message: chalk.hex(COLORS.SECONDARY)("Embed PEM file contents inline?"),
            default: false,
        },
    ]);

    console.log();
    const spinner = ora("Exporting configuration...").start();

    const result = await exportService.exportSelectedConfig(selection, outputPath, {
        includePemContent: embedKeys,
    });

    if (result.success) {
        spinner.succeed(chalk.green(`${ICONS.CHECK} Configuration exported!`));
        console.log(chalk.dim(`\nSaved to: ${result.path}`));
    } else {
        spinner.fail(chalk.red(`Export failed: ${result.error}`));
    }

    await waitForEnter();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Import Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function importConfigMenu(): Promise<void> {
    console.clear();
    displayImportHeader();

    const { inputPath } = await inquirer.prompt({
        type: "input",
        name: "inputPath",
        message: chalk.hex(COLORS.SECONDARY)("Path to config file:"),
        validate: (input: string) =>
            input.length > 0 ? true : "Please enter a file path",
    });

    // Get diff
    console.log(chalk.hex(COLORS.SECONDARY)("\nAnalyzing config file...\n"));
    const diff = await exportService.getImportDiff(inputPath);

    // Display diff
    displayImportDiff(diff);

    // Check if there's anything to import
    const hasNewItems =
        diff.new_items.servers.length > 0 ||
        diff.new_items.aws_profiles.length > 0 ||
        diff.new_items.rds_instances.length > 0;
    const hasModifiedItems =
        diff.modified_items.servers.length > 0 ||
        diff.modified_items.aws_profiles.length > 0 ||
        diff.modified_items.rds_instances.length > 0;

    if (!hasNewItems && !hasModifiedItems) {
        console.log(
            chalk.yellow("\n⚠️  No new or modified items to import. All unchanged.")
        );
        await waitForEnter();
        return;
    }

    // Ask for confirmation
    const confirmChoices = [];
    if (hasNewItems) {
        confirmChoices.push({
            name: `${ICONS.NEW}  Import new items only`,
            value: "new_only",
        });
    }
    if (hasNewItems && hasModifiedItems) {
        confirmChoices.push({
            name: `${ICONS.MODIFIED}  Import new and update modified items`,
            value: "all",
        });
    }
    confirmChoices.push({
        name: `${ICONS.BACK}  Cancel`,
        value: "cancel",
    });

    const { importChoice } = await inquirer.prompt({
        type: "list",
        name: "importChoice",
        message: chalk.hex(COLORS.SECONDARY)("What would you like to do?"),
        choices: confirmChoices,
    });

    if (importChoice === "cancel") {
        console.log(chalk.dim("\nCancelled."));
        await waitForEnter();
        return;
    }

    // Perform import
    console.log();
    const spinner = ora("Importing configuration...").start();

    const result = await exportService.importConfig(inputPath, {
        overwrite: importChoice === "all",
    });

    if (result.success) {
        spinner.succeed(chalk.green(`${ICONS.CHECK} Configuration imported!`));
        console.log(chalk.white("\nImported:"));
        console.log(chalk.green(`  ✓ ${result.imported.servers} servers`));
        console.log(chalk.green(`  ✓ ${result.imported.aws_profiles} AWS profiles`));
        console.log(chalk.green(`  ✓ ${result.imported.rds_instances} RDS instances`));
    } else {
        spinner.fail(chalk.red("Import completed with errors"));
        result.errors.forEach((e) => console.log(chalk.red(`  • ${e}`)));
    }

    await waitForEnter();
}

function displayImportDiff(diff: IImportDiff): void {
    // NEW items
    const hasNew =
        diff.new_items.servers.length > 0 ||
        diff.new_items.aws_profiles.length > 0 ||
        diff.new_items.rds_instances.length > 0;

    if (hasNew) {
        console.log(
            chalk.green.bold(`${ICONS.NEW}  NEW (will be created)`)
        );
        console.log(chalk.dim("─".repeat(40)));

        diff.new_items.servers.forEach((s) => {
            console.log(
                chalk.green(`  • Server: ${s.name} (${s.username}@${s.host})`)
            );
        });
        diff.new_items.aws_profiles.forEach((p) => {
            console.log(chalk.green(`  • AWS Profile: ${p.name}`));
        });
        diff.new_items.rds_instances.forEach((r) => {
            console.log(chalk.green(`  • RDS: ${r.name}`));
        });
        console.log();
    }

    // MODIFIED items
    const hasModified =
        diff.modified_items.servers.length > 0 ||
        diff.modified_items.aws_profiles.length > 0 ||
        diff.modified_items.rds_instances.length > 0;

    if (hasModified) {
        console.log(
            chalk.yellow.bold(`${ICONS.MODIFIED}  MODIFIED (will be updated)`)
        );
        console.log(chalk.dim("─".repeat(40)));

        diff.modified_items.servers.forEach((s) => {
            console.log(chalk.yellow(`  • Server: ${s.name}`));
            s.changes.forEach((c) => {
                console.log(
                    chalk.dim(`      ${c.field}: `) +
                    chalk.red(c.from) +
                    chalk.dim(" → ") +
                    chalk.green(c.to)
                );
            });
        });
        diff.modified_items.aws_profiles.forEach((p) => {
            console.log(chalk.yellow(`  • AWS Profile: ${p.name}`));
            p.changes.forEach((c) => {
                console.log(
                    chalk.dim(`      ${c.field}: `) +
                    chalk.red(c.from) +
                    chalk.dim(" → ") +
                    chalk.green(c.to)
                );
            });
        });
        diff.modified_items.rds_instances.forEach((r) => {
            console.log(chalk.yellow(`  • RDS: ${r.name}`));
            r.changes.forEach((c) => {
                console.log(
                    chalk.dim(`      ${c.field}: `) +
                    chalk.red(c.from) +
                    chalk.dim(" → ") +
                    chalk.green(c.to)
                );
            });
        });
        console.log();
    }

    // UNCHANGED items
    const hasUnchanged =
        diff.unchanged.servers.length > 0 ||
        diff.unchanged.aws_profiles.length > 0 ||
        diff.unchanged.rds_instances.length > 0;

    if (hasUnchanged) {
        console.log(
            chalk.gray.bold(`${ICONS.UNCHANGED}  UNCHANGED (will be skipped)`)
        );
        console.log(chalk.dim("─".repeat(40)));

        if (diff.unchanged.servers.length > 0) {
            console.log(
                chalk.gray(`  • Servers: ${diff.unchanged.servers.join(", ")}`)
            );
        }
        if (diff.unchanged.aws_profiles.length > 0) {
            console.log(
                chalk.gray(`  • AWS Profiles: ${diff.unchanged.aws_profiles.join(", ")}`)
            );
        }
        if (diff.unchanged.rds_instances.length > 0) {
            console.log(
                chalk.gray(`  • RDS: ${diff.unchanged.rds_instances.join(", ")}`)
            );
        }
        console.log();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function displayExportHeader(): void {
    console.log(
        boxen(chalk.hex(COLORS.PRIMARY).bold(`${ICONS.EXPORT} Export Configuration`), {
            padding: { left: 2, right: 2, top: 0, bottom: 0 },
            borderStyle: "round",
            borderColor: COLORS.PRIMARY,
        })
    );
    console.log();
}

function displayImportHeader(): void {
    console.log(
        boxen(chalk.hex(COLORS.PRIMARY).bold(`${ICONS.IMPORT} Import Configuration`), {
            padding: { left: 2, right: 2, top: 0, bottom: 0 },
            borderStyle: "round",
            borderColor: COLORS.PRIMARY,
        })
    );
    console.log();
}

async function waitForEnter(): Promise<void> {
    await inquirer.prompt({
        type: "input",
        name: "continue",
        message: chalk.dim("Press Enter to continue..."),
    });
}

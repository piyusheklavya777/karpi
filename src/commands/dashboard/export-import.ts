// src/commands/dashboard/export-import.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join, basename } from "path";
import { nanoid } from "nanoid";
import { COLORS } from "../../config/constants";
import { exportService } from "../../services/export.service";
import { storageService } from "../../services/storage.service";
import { profileService } from "../../services/profile.service";
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
    SHAREABLE: "🔗",
    EDIT: "✏️",
    DELETE: "🗑️",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Export Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function exportConfigMenu(): Promise<void> {
    console.clear();
    displayExportHeader();

    const savedShareables = storageService.getAllShareables();
    const choices: any[] = [];

    // Option to use saved shareable
    if (savedShareables.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Saved Shareables ─────────────"))
        );
        savedShareables.forEach((shareable) => {
            const itemCount =
                shareable.server_ids.length +
                shareable.rds_instance_ids.length;
            // Note: Using chalk.bold without colors so inquirer selection highlighting works
            choices.push({
                name: `${ICONS.SHAREABLE}  ${chalk.bold(shareable.name)} (v${shareable.version}, ${itemCount} items)`,
                value: { type: "shareable", id: shareable.id },
            });
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("─── Actions ──────────────────────"))
    );
    choices.push({
        name: `${ICONS.NEW}  ${chalk.bold("Create new shareable")}`,
        value: { type: "create" },
    });

    if (savedShareables.length > 0) {
        choices.push({
            name: `${ICONS.EDIT}  ${chalk.bold("Edit shareable")}`,
            value: { type: "edit" },
        });
        choices.push({
            name: `${ICONS.DELETE}  ${chalk.bold("Delete shareable")}`,
            value: { type: "delete" },
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("───────────────────────────────────"))
    );
    choices.push({
        name: `${ICONS.BACK}  Back to Dashboard`,
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

    if (selection.type === "shareable") {
        // Export using saved shareable
        const shareable = storageService.getShareable(selection.id);
        if (shareable) {
            // Increment version
            shareable.version += 1;
            shareable.last_used = new Date().toISOString();
            storageService.saveShareable(shareable);

            await performExport({
                server_ids: shareable.server_ids,
                aws_profile_ids: [], // AWS profiles not exported
                rds_instance_ids: shareable.rds_instance_ids,
                shareable_name: shareable.name,
                shareable_version: shareable.version,
            });
        }
    } else if (selection.type === "create") {
        await createNewShareable();
    } else if (selection.type === "edit") {
        await editShareable();
    } else if (selection.type === "delete") {
        await deleteShareable();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create New Shareable
// ─────────────────────────────────────────────────────────────────────────────

async function createNewShareable(): Promise<void> {
    // First ask for name
    const { shareableName } = await inquirer.prompt({
        type: "input",
        name: "shareableName",
        message: chalk.hex(COLORS.SECONDARY)("Name this export:"),
        validate: (input: string) => {
            if (input.length === 0) return "Name is required";
            if (storageService.getShareableByName(input)) {
                return "A shareable with this name already exists";
            }
            return true;
        },
    });

    const items = exportService.getExportableItems();

    if (
        items.servers.length === 0 &&
        items.rds_instances.length === 0
    ) {
        console.log(chalk.yellow("\n⚠️  No items to export."));
        await waitForEnter();
        return;
    }

    // Build checkbox choices - NOT pre-selected
    const choices: any[] = [];

    if (items.servers.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.hex(COLORS.PRIMARY).bold("─── Servers ───"))
        );
        items.servers.forEach((server) => {
            choices.push({
                name: `${ICONS.SERVER}  ${server.name} ${chalk.dim(`(${server.host})`)}`,
                value: { type: "server", id: server.id },
                checked: false, // NOT pre-selected
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
                checked: false,
            });
        });
    }

    const { selectedItems } = await inquirer.prompt({
        type: "checkbox",
        name: "selectedItems",
        message: chalk.hex(COLORS.SECONDARY)("Select items to include:"),
        choices,
        pageSize: 20,
    });

    if (selectedItems.length === 0) {
        console.log(chalk.yellow("\n⚠️  No items selected."));
        await waitForEnter();
        return;
    }

    // Build selection object (AWS profiles not exported - teammates set up their own)
    const selection: IExportSelection = {
        server_ids: selectedItems
            .filter((i: any) => i.type === "server")
            .map((i: any) => i.id),
        aws_profile_ids: [], // Not exported
        rds_instance_ids: selectedItems
            .filter((i: any) => i.type === "rds")
            .map((i: any) => i.id),
        shareable_name: shareableName,
        shareable_version: 1,
    };

    // Save shareable
    storageService.saveShareable({
        id: nanoid(),
        name: shareableName,
        version: 1,
        server_ids: selection.server_ids,
        rds_instance_ids: selection.rds_instance_ids,
        created_at: new Date().toISOString(),
    });

    console.log(chalk.green(`\n${ICONS.SAVE} Shareable "${shareableName}" created!`));

    await performExport(selection);
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Shareable
// ─────────────────────────────────────────────────────────────────────────────

async function editShareable(): Promise<void> {
    const savedShareables = storageService.getAllShareables();

    if (savedShareables.length === 0) {
        console.log(chalk.yellow("\n⚠️  No shareables to edit."));
        await waitForEnter();
        return;
    }

    // Select which shareable to edit
    const { shareableId } = await inquirer.prompt({
        type: "list",
        name: "shareableId",
        message: chalk.hex(COLORS.SECONDARY)("Select shareable to edit:"),
        choices: savedShareables.map((s) => ({
            name: `${ICONS.SHAREABLE}  ${s.name} (v${s.version})`,
            value: s.id,
        })),
    });

    const shareable = storageService.getShareable(shareableId);
    if (!shareable) return;

    // What to edit
    const { editAction } = await inquirer.prompt({
        type: "list",
        name: "editAction",
        message: chalk.hex(COLORS.SECONDARY)("What would you like to edit?"),
        choices: [
            { name: `${ICONS.EDIT}  Rename`, value: "rename" },
            { name: `${ICONS.CHECK}  Change items`, value: "items" },
            { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
        ],
    });

    if (editAction === "cancel") return;

    if (editAction === "rename") {
        const { newName } = await inquirer.prompt({
            type: "input",
            name: "newName",
            message: chalk.hex(COLORS.SECONDARY)("New name:"),
            default: shareable.name,
            validate: (input: string) => {
                if (input.length === 0) return "Name is required";
                const existing = storageService.getShareableByName(input);
                if (existing && existing.id !== shareable.id) {
                    return "A shareable with this name already exists";
                }
                return true;
            },
        });

        shareable.name = newName;
        storageService.saveShareable(shareable);
        console.log(chalk.green(`\n${ICONS.CHECK} Shareable renamed to "${newName}"`));
    } else if (editAction === "items") {
        const items = exportService.getExportableItems();
        const choices: any[] = [];

        if (items.servers.length > 0) {
            choices.push(
                new inquirer.Separator(chalk.hex(COLORS.PRIMARY).bold("─── Servers ───"))
            );
            items.servers.forEach((server) => {
                choices.push({
                    name: `${ICONS.SERVER}  ${server.name} ${chalk.dim(`(${server.host})`)}`,
                    value: { type: "server", id: server.id },
                    checked: shareable.server_ids.includes(server.id),
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
                    name: `${ICONS.RDS}  ${rds.name}`,
                    value: { type: "rds", id: rds.id },
                    checked: shareable.rds_instance_ids.includes(rds.id),
                });
            });
        }

        const { selectedItems } = await inquirer.prompt({
            type: "checkbox",
            name: "selectedItems",
            message: chalk.hex(COLORS.SECONDARY)("Select items to include:"),
            choices,
            pageSize: 20,
        });

        shareable.server_ids = selectedItems
            .filter((i: any) => i.type === "server")
            .map((i: any) => i.id);
        shareable.rds_instance_ids = selectedItems
            .filter((i: any) => i.type === "rds")
            .map((i: any) => i.id);

        storageService.saveShareable(shareable);
        console.log(chalk.green(`\n${ICONS.CHECK} Shareable items updated!`));
    }

    await waitForEnter();
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Shareable
// ─────────────────────────────────────────────────────────────────────────────

async function deleteShareable(): Promise<void> {
    const savedShareables = storageService.getAllShareables();

    if (savedShareables.length === 0) {
        console.log(chalk.yellow("\n⚠️  No shareables to delete."));
        await waitForEnter();
        return;
    }

    const { shareableId } = await inquirer.prompt({
        type: "list",
        name: "shareableId",
        message: chalk.hex(COLORS.SECONDARY)("Select shareable to delete:"),
        choices: savedShareables.map((s) => ({
            name: `${ICONS.SHAREABLE}  ${s.name} (v${s.version})`,
            value: s.id,
        })),
    });

    const shareable = storageService.getShareable(shareableId);
    if (!shareable) return;

    const { confirmDelete } = await inquirer.prompt({
        type: "confirm",
        name: "confirmDelete",
        message: chalk.red(`Delete "${shareable.name}"? This cannot be undone.`),
        default: false,
    });

    if (confirmDelete) {
        storageService.deleteShareable(shareableId);
        console.log(chalk.green(`\n${ICONS.CHECK} Shareable deleted.`));
    } else {
        console.log(chalk.dim("\nCancelled."));
    }

    await waitForEnter();
}

// ─────────────────────────────────────────────────────────────────────────────
// Perform Export
// ─────────────────────────────────────────────────────────────────────────────

async function performExport(selection: IExportSelection): Promise<void> {
    // Version-based filename using shareable name
    const safeName = (selection.shareable_name || "export")
        .replace(/[^a-zA-Z0-9-_]/g, "-")
        .toLowerCase();
    const defaultPath = join(
        homedir(),
        "Desktop",
        `${safeName}-v${selection.shareable_version || 1}.yaml`
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

        // Log the export
        const activeProfile = profileService.getActiveProfile();
        if (activeProfile && selection.shareable_name) {
            await exportService.logExport({
                username: activeProfile.username,
                shareable_name: selection.shareable_name,
                shareable_version: selection.shareable_version || 1,
                filename: basename(outputPath),
                items_count:
                    selection.server_ids.length +
                    selection.aws_profile_ids.length +
                    selection.rds_instance_ids.length,
            });
        }
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

    // ─────────────────────────────────────────────────────────────────────────────
    // AWS Profile Mapping
    // Servers and RDS may reference AWS profiles by name - prompt user to map them
    // ─────────────────────────────────────────────────────────────────────────────

    // Collect all AWS profile references from servers and RDS instances
    const awsProfileRefs = new Set<string>();

    // From new items
    diff.new_items.servers.forEach((s) => {
        if (s.aws_profile) awsProfileRefs.add(s.aws_profile);
    });
    diff.new_items.rds_instances.forEach((r) => {
        if (r.aws_profile) awsProfileRefs.add(r.aws_profile);
    });

    // From modified items (if overwriting)
    if (importChoice === "all") {
        diff.modified_items.servers.forEach((s) => {
            // s.name exists, check if any changes involve aws_profile
            const awsChange = s.changes.find((c) => c.field === "aws_profile");
            if (awsChange && awsChange.to) awsProfileRefs.add(awsChange.to);
        });
    }

    // Build profile mapping
    const profileMapping: Record<string, string> = {};

    if (awsProfileRefs.size > 0) {
        console.log(chalk.hex(COLORS.PRIMARY).bold("\n☁️  AWS Profile Setup\n"));
        console.log(chalk.dim("This config references AWS profiles. Map them to your local AWS CLI profiles.\n"));

        const existingProfiles = storageService.getAllAWSProfiles();

        for (const profileRef of awsProfileRefs) {
            // Build choices: existing profiles + create new option
            const profileChoices: { name: string; value: string }[] = existingProfiles.map((p) => ({
                name: `${ICONS.AWS}  ${p.name} (CLI: ${p.cli_profile_name || "N/A"})`,
                value: p.name,
            }));
            profileChoices.push({
                name: `${ICONS.NEW}  Enter AWS CLI profile name manually`,
                value: "__manual__",
            });

            const { mappedProfile } = await inquirer.prompt({
                type: "list",
                name: "mappedProfile",
                message: chalk.hex(COLORS.SECONDARY)(`Map "${chalk.bold(profileRef)}" to:`),
                choices: profileChoices,
            });

            if (mappedProfile === "__manual__") {
                const { cliProfileName } = await inquirer.prompt({
                    type: "input",
                    name: "cliProfileName",
                    message: chalk.hex(COLORS.SECONDARY)("Your AWS CLI profile name (from ~/.aws/credentials):"),
                    default: profileRef,
                });

                // Create or update the AWS profile
                const { nanoid } = await import("nanoid");
                const existingByRef = existingProfiles.find((p) => p.name === profileRef);

                if (!existingByRef) {
                    storageService.saveAWSProfile({
                        id: nanoid(),
                        name: profileRef,
                        auth_type: "cli_profile",
                        cli_profile_name: cliProfileName,
                        default_region: "us-east-1", // Default
                        created_at: new Date().toISOString(),
                    });
                    console.log(chalk.green(`  ✓ Created AWS profile "${profileRef}" → CLI: ${cliProfileName}`));
                }

                profileMapping[profileRef] = profileRef;
            } else {
                profileMapping[profileRef] = mappedProfile;
            }
        }

        console.log();
    }

    // Perform import
    console.log();
    const spinner = ora("Importing configuration...").start();

    const result = await exportService.importConfig(inputPath, {
        overwrite: importChoice === "all",
        profileMapping, // Pass the mapping
    });

    if (result.success) {
        spinner.succeed(chalk.green(`${ICONS.CHECK} Configuration imported!`));
        console.log(chalk.white("\nImported:"));
        console.log(chalk.green(`  ✓ ${result.imported.servers} servers`));
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

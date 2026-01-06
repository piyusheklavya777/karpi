// src/commands/dashboard/utilities.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import { exec } from "child_process";
import { promisify } from "util";
import { COLORS, UI } from "../../config/constants";

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════════════════════
// Icons
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
  TOOLS: "🔧",
  SEARCH: "🔍",
  KILL: "💀",
  PORT: "🔌",
  BACK: "←",
  SUCCESS: "✓",
  ERROR: "✗",
  EXPORT: "📦",
  IMPORT: "📥",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Main Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function utilitiesMenu(): Promise<void> {
  let running = true;

  while (running) {
    console.clear();
    displayHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.hex(COLORS.SECONDARY)("Select utility:"),
        choices: [
          {
            name: `${ICONS.SEARCH}  ${chalk.bold(
              "Check Port"
            )}        ${chalk.dim("See what's running on a port")}`,
            value: "check_port",
          },
          {
            name: `${ICONS.KILL}  ${chalk.bold(
              "Kill Port"
            )}         ${chalk.dim("Stop process on a port")}`,
            value: "kill_port",
          },
          new inquirer.Separator(chalk.dim("─── Configuration ────────────")),
          {
            name: `${ICONS.EXPORT}  ${chalk.bold(
              "Export Config"
            )}      ${chalk.dim("Save config to YAML file")}`,
            value: "export_config",
          },
          {
            name: `${ICONS.IMPORT}  ${chalk.bold(
              "Import Config"
            )}      ${chalk.dim("Load config from file")}`,
            value: "import_config",
          },
          new inquirer.Separator(chalk.dim("─────────────────────────────")),
          {
            name: `${ICONS.BACK}  ${chalk.dim("Back to Dashboard")}`,
            value: "back",
          },
        ],
        pageSize: 12,
      },
    ]);

    switch (action) {
      case "check_port":
        await checkPortFlow();
        break;
      case "kill_port":
        await killPortFlow();
        break;
      case "export_config":
        await exportConfigFlow();
        break;
      case "import_config":
        await importConfigFlow();
        break;
      case "back":
        running = false;
        break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader(): void {
  console.log(
    boxen(chalk.hex(COLORS.PRIMARY).bold(`${ICONS.TOOLS} General Utilities`), {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: COLORS.PRIMARY,
    })
  );
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Check Port
// ═══════════════════════════════════════════════════════════════════════════════

async function checkPortFlow(): Promise<void> {
  const { port } = await inquirer.prompt([
    {
      type: "number",
      name: "port",
      message: chalk.hex(COLORS.SECONDARY)("Enter port number:"),
      validate: (input: number) =>
        input > 0 && input < 65536 ? true : "Invalid port (1-65535)",
    },
  ]);

  console.log();
  console.log(chalk.hex(COLORS.SECONDARY)(`Checking port ${port}...`));

  try {
    const { stdout } = await execAsync(`lsof -i :${port} -P -n`);

    if (stdout.trim()) {
      const lines = stdout.trim().split("\n");
      const header = lines[0];
      const processes = lines.slice(1);

      console.log();
      console.log(
        boxen(
          chalk
            .hex(COLORS.PRIMARY)
            .bold(`${ICONS.PORT} Port ${port} is in use\n\n`) +
          chalk.dim(header) +
          "\n" +
          processes.map((p) => chalk.white(p)).join("\n"),
          {
            padding: 1,
            borderStyle: "round",
            borderColor: COLORS.PRIMARY,
          }
        )
      );
    } else {
      console.log(
        chalk.hex(COLORS.SUCCESS)(`\n${ICONS.SUCCESS} Port ${port} is free`)
      );
    }
  } catch (error: unknown) {
    const err = error as { code?: number; stderr?: string };
    if (err.code === 1) {
      console.log(
        chalk.hex(COLORS.SUCCESS)(
          `\n${ICONS.SUCCESS} Port ${port} is free (nothing running)`
        )
      );
    } else {
      console.log(
        chalk.hex(COLORS.ERROR)(
          `\n${ICONS.ERROR} Error checking port: ${err.stderr || "Unknown error"
          }`
        )
      );
    }
  }

  await pressEnterToContinue();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Kill Port
// ═══════════════════════════════════════════════════════════════════════════════

async function killPortFlow(): Promise<void> {
  const { port } = await inquirer.prompt([
    {
      type: "number",
      name: "port",
      message: chalk.hex(COLORS.SECONDARY)("Enter port number to kill:"),
      validate: (input: number) =>
        input > 0 && input < 65536 ? true : "Invalid port (1-65535)",
    },
  ]);

  console.log();
  console.log(chalk.hex(COLORS.SECONDARY)(`Checking port ${port}...`));

  try {
    // First check what's running
    const { stdout } = await execAsync(`lsof -i :${port} -P -n -t`);
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length === 0) {
      console.log(
        chalk.hex(COLORS.SUCCESS)(
          `\n${ICONS.SUCCESS} Port ${port} is already free`
        )
      );
      await pressEnterToContinue();
      return;
    }

    // Get process info for display
    const { stdout: processInfo } = await execAsync(`lsof -i :${port} -P -n`);
    console.log();
    console.log(
      boxen(
        chalk.hex(COLORS.PRIMARY).bold(`Processes on port ${port}:\n\n`) +
        chalk.white(processInfo.trim()),
        {
          padding: 1,
          borderStyle: "round",
          borderColor: COLORS.WARNING,
        }
      )
    );

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.hex(COLORS.WARNING)(
          `Kill ${pids.length} process(es) on port ${port}?`
        ),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.dim("\nCancelled."));
      await pressEnterToContinue();
      return;
    }

    // Kill all processes on the port
    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(
          chalk.hex(COLORS.SUCCESS)(`${ICONS.SUCCESS} Killed PID ${pid}`)
        );
      } catch {
        console.log(
          chalk.hex(COLORS.ERROR)(`${ICONS.ERROR} Failed to kill PID ${pid}`)
        );
      }
    }

    console.log(
      chalk.hex(COLORS.SUCCESS)(
        `\n${UI.ICONS.SUCCESS} Port ${port} is now free!`
      )
    );
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 1) {
      console.log(
        chalk.hex(COLORS.SUCCESS)(
          `\n${ICONS.SUCCESS} Port ${port} is already free`
        )
      );
    } else {
      console.log(
        chalk.hex(COLORS.ERROR)(`\n${ICONS.ERROR} Error: Could not check port`)
      );
    }
  }

  await pressEnterToContinue();
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

// ═══════════════════════════════════════════════════════════════════════════════
// Export Config
// ═══════════════════════════════════════════════════════════════════════════════

async function exportConfigFlow(): Promise<void> {
  const ora = (await import("ora")).default;
  const { exportService } = await import("../../services/export.service");
  const { homedir } = await import("os");
  const { join } = await import("path");

  const defaultPath = join(
    homedir(),
    "Desktop",
    `karpi-config-${new Date().toISOString().split("T")[0]}.yaml`
  );

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "outputPath",
      message: chalk.hex(COLORS.SECONDARY)("Output file path:"),
      default: defaultPath,
    },
    {
      type: "confirm",
      name: "embedKeys",
      message: chalk.hex(COLORS.SECONDARY)(
        "Embed PEM file contents inline? (No = copy files to keys/ folder)"
      ),
      default: false,
    },
  ]);

  console.log();
  const spinner = ora("Exporting configuration...").start();

  const result = await exportService.exportConfig(answers.outputPath, {
    includePemContent: answers.embedKeys,
  });

  if (result.success) {
    spinner.succeed(
      chalk.hex(COLORS.SUCCESS)(`${ICONS.SUCCESS} Configuration exported!`)
    );
    console.log(chalk.dim(`\nSaved to: ${result.path}`));
    if (!answers.embedKeys) {
      console.log(
        chalk.dim(
          "Note: PEM files copied to keys/ folder next to the YAML file"
        )
      );
    }
  } else {
    spinner.fail(chalk.hex(COLORS.ERROR)(`${ICONS.ERROR} Export failed`));
    console.log(chalk.hex(COLORS.ERROR)(result.error));
  }

  await pressEnterToContinue();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Import Config
// ═══════════════════════════════════════════════════════════════════════════════

async function importConfigFlow(): Promise<void> {
  const ora = (await import("ora")).default;
  const { exportService } = await import("../../services/export.service");

  const { inputPath } = await inquirer.prompt({
    type: "input",
    name: "inputPath",
    message: chalk.hex(COLORS.SECONDARY)("Path to config file:"),
    validate: (input: string) =>
      input.length > 0 ? true : "Please enter a file path",
  });

  // Preview first
  console.log(chalk.hex(COLORS.SECONDARY)("\nPreviewing config file...\n"));
  const preview = await exportService.previewImport(inputPath);

  if (preview.errors.length > 0) {
    console.log(chalk.hex(COLORS.ERROR)("Errors reading file:"));
    preview.errors.forEach((e) =>
      console.log(chalk.hex(COLORS.ERROR)(`  • ${e}`))
    );
    await pressEnterToContinue();
    return;
  }

  console.log(chalk.white("This file contains:"));
  console.log(
    chalk.hex(COLORS.PRIMARY)(
      `  • ${preview.servers.length} servers: ${preview.servers.join(", ") || "none"}`
    )
  );
  console.log(
    chalk.hex(COLORS.PRIMARY)(
      `  • ${preview.aws_profiles.length} AWS profiles: ${preview.aws_profiles.join(", ") || "none"}`
    )
  );
  console.log(
    chalk.hex(COLORS.PRIMARY)(
      `  • ${preview.rds_instances.length} RDS instances: ${preview.rds_instances.join(", ") || "none"}`
    )
  );
  console.log();

  const { confirmImport, overwrite } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmImport",
      message: chalk.hex(COLORS.SECONDARY)("Proceed with import?"),
      default: true,
    },
    {
      type: "confirm",
      name: "overwrite",
      message: chalk.hex(COLORS.WARNING)(
        "Overwrite existing configs with same name?"
      ),
      default: false,
      when: (answers) => answers.confirmImport,
    },
  ]);

  if (!confirmImport) {
    console.log(chalk.dim("\nCancelled."));
    await pressEnterToContinue();
    return;
  }

  console.log();
  const spinner = ora("Importing configuration...").start();

  const result = await exportService.importConfig(inputPath, {
    overwrite: overwrite,
  });

  if (result.success) {
    spinner.succeed(
      chalk.hex(COLORS.SUCCESS)(`${ICONS.SUCCESS} Configuration imported!`)
    );
    console.log(chalk.white("\nImported:"));
    console.log(
      chalk.hex(COLORS.SUCCESS)(`  ✓ ${result.imported.servers} servers`)
    );
    console.log(
      chalk.hex(COLORS.SUCCESS)(
        `  ✓ ${result.imported.aws_profiles} AWS profiles`
      )
    );
    console.log(
      chalk.hex(COLORS.SUCCESS)(
        `  ✓ ${result.imported.rds_instances} RDS instances`
      )
    );

    if (
      result.skipped.servers.length > 0 ||
      result.skipped.aws_profiles.length > 0
    ) {
      console.log(chalk.hex(COLORS.WARNING)("\nSkipped (already exist):"));
      if (result.skipped.servers.length) {
        console.log(
          chalk.hex(COLORS.WARNING)(
            `  • Servers: ${result.skipped.servers.join(", ")}`
          )
        );
      }
      if (result.skipped.aws_profiles.length) {
        console.log(
          chalk.hex(COLORS.WARNING)(
            `  • AWS Profiles: ${result.skipped.aws_profiles.join(", ")}`
          )
        );
      }
    }
  } else {
    spinner.fail(
      chalk.hex(COLORS.ERROR)(`${ICONS.ERROR} Import completed with errors`)
    );
    result.errors.forEach((e) =>
      console.log(chalk.hex(COLORS.ERROR)(`  • ${e}`))
    );
  }

  await pressEnterToContinue();
}

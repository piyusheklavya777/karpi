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
          new inquirer.Separator(chalk.dim("─────────────────────────────")),
          {
            name: `${ICONS.BACK}  ${chalk.dim("Back to Dashboard")}`,
            value: "back",
          },
        ],
        pageSize: 10,
      },
    ]);

    switch (action) {
      case "check_port":
        await checkPortFlow();
        break;
      case "kill_port":
        await killPortFlow();
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
          `\n${ICONS.ERROR} Error checking port: ${
            err.stderr || "Unknown error"
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

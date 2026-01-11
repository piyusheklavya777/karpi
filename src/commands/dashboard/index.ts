// src/commands/dashboard/index.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import { format } from "date-fns";
import { authService } from "../../services/auth.service";
import { styled, UI, COLORS } from "../../config/constants";
import { logger } from "../../utils/logger";
import { storageService } from "../../services/storage.service";

import { serversMenu } from "./servers";
import { awsProfilesMenu } from "./aws-profiles";
import { rdsMenu } from "./rds";
import { utilitiesMenu } from "./utilities";
import { exportConfigMenu, importConfigMenu } from "./export-import";
import { serverService } from "../../services/server.service";
import type {
  IRecentAction,
  IBackgroundProcess,
  IUserProfile,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════════
// ASCII Art Logo
// ═══════════════════════════════════════════════════════════════════════════════

const LOGO = `
██╗  ██╗ █████╗ ██████╗ ██████╗ ██╗
██║ ██╔╝██╔══██╗██╔══██╗██╔══██╗██║
█████╔╝ ███████║██████╔╝██████╔╝██║
██╔═██╗ ██╔══██║██╔══██╗██╔═══╝ ██║
██║  ██╗██║  ██║██║  ██║██║     ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝`;

// ═══════════════════════════════════════════════════════════════════════════════
// Menu Icons (larger, more visible)
// ═══════════════════════════════════════════════════════════════════════════════

const MENU_ICONS = {
  SERVERS: "🖥️ ",
  AWS: "☁️ ",
  RDS: "🗄️ ",
  UTILITIES: "🔧",
  PROFILE: "👤",
  LOGOUT: "🚪",
  EXIT: "👋",
  SSH: "🔐",
  TUNNEL: "🚇",
  KILL: "⛔",
  ONLINE: "🟢",
  OFFLINE: "🔴",
} as const;

export async function dashboardCommand(): Promise<void> {
  // Check authentication
  if (!authService.isAuthenticated()) {
    console.log(
      boxen(styled.error(`${UI.ICONS.ERROR} Please login first`), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: COLORS.ERROR,
      })
    );
    process.exit(1);
  }

  const current = authService.getCurrentUser();
  if (!current) {
    logger.error("No active user found");
    process.exit(1);
  }

  console.clear();
  displayDashboard(current.profile);

  // Main menu loop
  let running = true;
  while (running) {
    const processes = serverService.listProcesses();
    const recentActions = current.profile.recent_actions || [];

    const choices: any[] = [];

    // ═══════════════════════════════════════════════════════════
    // MAIN MENU SECTION
    // ═══════════════════════════════════════════════════════════

    choices.push(
      new inquirer.Separator(chalk.hex(COLORS.SECONDARY).bold("  ▸ MAIN MENU"))
    );
    choices.push(new inquirer.Separator(chalk.dim("  ")));

    choices.push({
      name: `  ${MENU_ICONS.SERVERS} ${chalk.bold(
        "Servers & Tunnels"
      )}      Manage SSH connections`,
      value: { type: "standard", data: "servers" },
    });
    choices.push({
      name: `  ${MENU_ICONS.RDS} ${chalk.bold(
        "RDS Databases"
      )}          Manage database tunnels`,
      value: { type: "standard", data: "rds" },
    });
    choices.push({
      name: `  ${MENU_ICONS.AWS} ${chalk.bold(
        "AWS Profiles"
      )}           Manage AWS credentials`,
      value: { type: "standard", data: "aws" },
    });
    choices.push({
      name: `  ${MENU_ICONS.UTILITIES} ${chalk.bold(
        "Utilities"
      )}              Port tools & more`,
      value: { type: "standard", data: "utilities" },
    });
    choices.push(
      new inquirer.Separator(chalk.dim("  "))
    );
    choices.push({
      name: `  📦  ${chalk.bold("Export Config")}         Save config to YAML`,
      value: { type: "standard", data: "export" },
    });
    choices.push({
      name: `  📥  ${chalk.bold("Import Config")}         Load config from file`,
      value: { type: "standard", data: "import" },
    });

    // ═══════════════════════════════════════════════════════════
    // QUICK ACTIONS SECTION (if any)
    // ═══════════════════════════════════════════════════════════

    if (recentActions.length > 0 || processes.length > 0) {
      choices.push(new inquirer.Separator(chalk.dim("  ")));
      choices.push(
        new inquirer.Separator(
          chalk.hex(COLORS.SECONDARY).bold("  ▸ QUICK ACTIONS")
        )
      );
      choices.push(new inquirer.Separator(chalk.dim("  ")));

      // Recent actions
      recentActions.slice(0, 4).forEach((action) => {
        const icon = action.type === "ssh" ? MENU_ICONS.SSH : MENU_ICONS.TUNNEL;
        const actionName = action.name
          .replace("SSH ", "")
          .replace("Tunnel ", "");
        const typeLabel = action.type === "ssh" ? "SSH" : "Tunnel";

        choices.push({
          name: `  ${icon} ${actionName}  → ${typeLabel}`,
          value: { type: "recent", data: action },
        });
      });

      // Active processes (with kill option)
      processes.forEach((proc) => {
        choices.push({
          name: `  ${MENU_ICONS.KILL} Stop: ${proc.name} PID ${proc.pid}`,
          value: { type: "process", data: proc },
        });
      });
    }

    // ═══════════════════════════════════════════════════════════
    // SETTINGS SECTION
    // ═══════════════════════════════════════════════════════════

    choices.push(new inquirer.Separator(chalk.dim("  ")));
    choices.push(new inquirer.Separator(chalk.gray.bold("  ▸ SETTINGS")));
    choices.push(new inquirer.Separator(chalk.dim("  ")));

    choices.push({
      name: `  ${MENU_ICONS.PROFILE} Profile Settings`,
      value: { type: "standard", data: "profile" },
    });

    // ═══════════════════════════════════════════════════════════
    // EXIT SECTION
    // ═══════════════════════════════════════════════════════════

    choices.push(new inquirer.Separator(chalk.dim("  ")));
    choices.push({
      name: `  ${MENU_ICONS.LOGOUT} Logout`,
      value: { type: "standard", data: "logout" },
    });
    choices.push({
      name: `  ${MENU_ICONS.EXIT} Exit`,
      value: { type: "standard", data: "exit" },
    });

    const { selection } = await inquirer.prompt([
      {
        type: "list",
        name: "selection",
        message: chalk.hex(COLORS.SECONDARY)("Select an option:"),
        pageSize: 20,
        choices: choices,
      },
    ]);

    if (selection.type === "recent") {
      const action = selection.data as IRecentAction;
      if (action.type === "ssh") {
        await serverService.connectToServer(action.serverId);
      } else if (action.type === "tunnel" && action.tunnelId) {
        await serverService.startTunnel(action.serverId, action.tunnelId);
      }
      await waitForEnter();
    } else if (selection.type === "process") {
      const proc = selection.data as IBackgroundProcess;
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: styled.warning(`Kill process ${proc.pid}?`),
          default: true,
        },
      ]);
      if (confirm) {
        await serverService.killProcess(proc.pid);
        await waitForEnter("Process killed. Press Enter to refresh...");
      }
    } else if (selection.type === "standard") {
      switch (selection.data) {
        case "servers":
          await serversMenu();
          break;
        case "aws":
          await awsProfilesMenu();
          break;
        case "rds":
          await rdsMenu();
          break;
        case "utilities":
          await utilitiesMenu();
          break;
        case "export":
          await exportConfigMenu();
          break;
        case "import":
          await importConfigMenu();
          break;
        case "profile":
          displayProfileInfo(current.profile);
          await waitForEnter();
          break;
        case "logout":
          authService.logout();
          console.log(
            boxen(
              styled.success(`${UI.ICONS.SUCCESS} Logged out successfully`),
              {
                padding: 1,
                margin: 1,
                borderStyle: "round",
                borderColor: COLORS.SUCCESS,
              }
            )
          );
          running = false;
          break;
        case "exit":
          console.log("\n" + styled.accent("Goodbye! 👋\n"));
          running = false;
          break;
      }
    }

    if (running) {
      console.clear();
      displayDashboard(current.profile);
    }
  }
}

async function waitForEnter(
  message = "Press Enter to continue..."
): Promise<void> {
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: styled.dimmed(message),
    },
  ]);
}

function displayDashboard(profile: IUserProfile): void {
  // Display gradient logo
  const logoLines = LOGO.split("\n");
  const gradientColors = [
    chalk.hex("#FFFFFF"), // White
    chalk.hex("#FFF0F5"), // Lavender blush
    chalk.hex("#FFD9E8"), // Very pale pink
    chalk.hex("#FFC0CB"), // Soft pink
    chalk.hex("#FFB6C1"), // Light pink
    chalk.hex("#FF69B4"), // Hot pink (primary)
  ];

  console.log();
  logoLines.forEach((line, i) => {
    const colorIndex = Math.min(i, gradientColors.length - 1);
    console.log("  " + gradientColors[colorIndex](line));
  });

  // Tagline
  console.log();
  console.log(chalk.dim("  ─────────────────────────────────────────"));
  console.log(
    chalk.hex(COLORS.SECONDARY)("  ✨ Developer Productivity Unleashed")
  );
  console.log(chalk.dim("  ─────────────────────────────────────────"));
  console.log();

  // Welcome box
  const servers = serverService.listServers();
  const rdsInstances = storageService.getAllRDSInstances();
  const processes = serverService.listProcesses();

  const welcomeContent = [
    chalk.white.bold(
      `👋 Welcome back, ${chalk.hex(COLORS.PRIMARY)(profile.username)}`
    ),
    "",
    chalk.dim("Last login: ") +
    chalk.white(format(new Date(profile.last_login), "PPpp")),
    "",
    chalk.dim("────────────────────────────────────────"),
    "",
    `${MENU_ICONS.SERVERS} ${chalk.white(servers.length)} servers   ` +
    `${MENU_ICONS.RDS} ${chalk.white(rdsInstances.length)} databases   ` +
    `${processes.length > 0 ? MENU_ICONS.ONLINE : MENU_ICONS.OFFLINE
    } ${chalk.white(processes.length)} active`,
  ].join("\n");

  console.log(
    boxen(welcomeContent, {
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "#FF69B4",
      dimBorder: false,
    })
  );
  console.log();
}

function displayProfileInfo(profile: any): void {
  const info = `
${styled.title("👤 Profile Information")}

${styled.label("Username:")} ${styled.value(profile.username)}
${styled.label("Email:")} ${styled.value(profile.email || "Not set")}
${styled.label("Profile ID:")} ${styled.dimmed(profile.id)}
${styled.label("Created:")} ${styled.value(
    format(new Date(profile.created_at), "PPP")
  )}

${styled.subtitle("Preferences")}
${styled.label("Theme:")} ${styled.value(profile.preferences.theme)}
${styled.label("Editor:")} ${styled.value(profile.preferences.editor)}
${styled.label("Auto Logout:")} ${styled.value(
    `${profile.preferences.auto_logout_minutes} minutes`
  )}
`;

  console.log(
    boxen(info, {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: COLORS.PRIMARY,
    })
  );
}

// src/commands/dashboard/servers.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import clipboard from "clipboardy";
import { format } from "date-fns";
import ora from "ora";
import { serverService } from "../../services/server.service";
import { storageService } from "../../services/storage.service";
import { awsService, AWS_REGIONS } from "../../services/aws.service";
import { UI, COLORS } from "../../config/constants";
import type {
  IServerConfig,
  ITunnelConfig,
  IBackgroundProcess,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════════
// UI Constants
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
  SERVER: "🖥️",
  SSH: "🚀",
  TUNNEL: "🚇",
  TUNNEL_ACTIVE: "🟢",
  TUNNEL_INACTIVE: "⚫",
  ADD: "➕",
  DELETE: "🗑️",
  BACK: "◀",
  COPY: "📋",
  PLAY: "▶",
  STOP: "⏹",
  ARROW_RIGHT: "→",
  SEPARATOR: "─",
  AWS: "☁️",
  LINK: "🔗",
  CHECK: "✓",
  IMPORTED: "✅",
} as const;

const BOX_CHARS = {
  TOP_LEFT: "╭",
  TOP_RIGHT: "╮",
  BOTTOM_LEFT: "╰",
  BOTTOM_RIGHT: "╯",
  HORIZONTAL: "─",
  VERTICAL: "│",
  T_DOWN: "┬",
  T_UP: "┴",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Main Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function serversMenu(): Promise<void> {
  let running = true;

  while (running) {
    console.clear();
    displayHeader();

    const servers = serverService.listServers();
    const processes = storageService.getAllProcesses();

    if (servers.length === 0) {
      displayEmptyState();
    }

    const choices = buildMainMenuChoices(servers, processes);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.hex(COLORS.BRIGHT_BLUE)("Select an option:"),
        choices,
        pageSize: 15,
      },
    ]);

    if (action === "back") {
      running = false;
    } else if (action === "add_server") {
      await addServerFlow();
    } else if (action.startsWith("server:")) {
      const serverId = action.replace("server:", "");
      await serverActionsMenu(serverId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Actions Menu (Inline)
// ═══════════════════════════════════════════════════════════════════════════════

async function serverActionsMenu(serverId: string): Promise<void> {
  let running = true;

  while (running) {
    console.clear();

    const server = serverService.getServer(serverId);
    if (!server) {
      running = false;
      continue;
    }

    const processes = storageService.getAllProcesses();
    const serverProcesses = processes.filter((p) => p.serverId === serverId);

    displayServerHeader(server, serverProcesses);
    displayServerDetails(server, serverProcesses);

    const choices = buildServerActionsChoices(server, serverProcesses);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.hex(COLORS.BRIGHT_BLUE)("Action:"),
        choices,
        pageSize: 15,
      },
    ]);

    switch (action) {
      case "ssh":
        await connectToServer(serverId);
        break;
      case "add_tunnel":
        await addTunnelFlow(serverId);
        break;
      case "link_aws":
        await linkAWSProfileFlow(serverId);
        break;
      case "unlink_aws":
        await unlinkAWSProfileFlow(serverId);
        break;
      case "delete_server":
        const deleted = await deleteServerFlow(serverId);
        if (deleted) running = false;
        break;
      case "back":
        running = false;
        break;
      default:
        if (action.startsWith("tunnel:")) {
          const tunnelId = action.replace("tunnel:", "");
          await tunnelActionsMenu(serverId, tunnelId);
        }
        break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tunnel Actions Menu (Inline)
// ═══════════════════════════════════════════════════════════════════════════════

async function tunnelActionsMenu(
  serverId: string,
  tunnelId: string
): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  const tunnel = server.tunnels?.find((t) => t.id === tunnelId);
  if (!tunnel) return;

  const processes = storageService.getAllProcesses();
  const tunnelProcess = processes.find((p) => p.tunnelId === tunnelId);
  const isActive = !!tunnelProcess;

  console.clear();
  displayTunnelHeader(server, tunnel, isActive);

  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  if (isActive) {
    choices.push({
      name: `${ICONS.STOP}  ${chalk.red("Stop Tunnel")}`,
      value: "stop",
    });
  } else {
    choices.push({
      name: `${ICONS.PLAY}  ${chalk.green("Start Tunnel")}`,
      value: "start",
    });
  }

  choices.push(
    { name: `${ICONS.COPY}  Copy SSH Command`, value: "copy" },
    new inquirer.Separator(chalk.dim("─────────────────────")),
    { name: `${ICONS.DELETE}  ${chalk.red("Delete Tunnel")}`, value: "delete" },
    new inquirer.Separator(chalk.dim("─────────────────────")),
    { name: `${ICONS.BACK}  Back to Server`, value: "back" }
  );

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.BRIGHT_BLUE)("Tunnel Action:"),
      choices,
    },
  ]);

  switch (action) {
    case "start":
      await startTunnel(serverId, tunnelId);
      break;
    case "stop":
      await stopTunnel(tunnelProcess!.pid);
      break;
    case "copy":
      await copyTunnelCommand(serverId, tunnelId);
      break;
    case "delete":
      await deleteTunnel(serverId, tunnelId);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Functions
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader(): void {
  const title = chalk.bold.hex(COLORS.BOTTLE_GREEN)(
    `${ICONS.SERVER}  Remote Server Management`
  );
  const border = chalk.hex(COLORS.BRIGHT_BLUE)(BOX_CHARS.HORIZONTAL.repeat(50));

  console.log("\n" + border);
  console.log(title);
  console.log(border + "\n");
}

function displayEmptyState(): void {
  console.log(
    boxen(
      chalk.hex(COLORS.BRIGHT_BLUE)("No servers configured yet.\n\n") +
        chalk.dim("Press ") +
        chalk.white("↓") +
        chalk.dim(" to select ") +
        chalk.hex(COLORS.BOTTLE_GREEN)('"Add New Server"') +
        chalk.dim(" to get started."),
      {
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "gray",
      }
    )
  );
}

function displayServerHeader(
  server: IServerConfig,
  processes: IBackgroundProcess[]
): void {
  const activeCount = processes.length;
  const statusBadge =
    activeCount > 0
      ? chalk.bgGreen.black(` ${activeCount} ACTIVE `)
      : chalk.bgGray.white(" IDLE ");

  const title = `${ICONS.SERVER}  ${chalk.bold.hex(COLORS.BOTTLE_GREEN)(
    server.name
  )}  ${statusBadge}`;
  const subtitle = chalk.dim(`${server.username}@${server.host}`);
  const border = chalk.hex(COLORS.BRIGHT_BLUE)(BOX_CHARS.HORIZONTAL.repeat(50));

  console.log("\n" + border);
  console.log(title);
  console.log(subtitle);
  console.log(border + "\n");
}

function displayServerDetails(
  server: IServerConfig,
  processes: IBackgroundProcess[]
): void {
  const tunnels = server.tunnels || [];
  const lastConnected = server.last_connected
    ? format(new Date(server.last_connected), "PP p")
    : "Never";

  // Server info box
  const infoLines = [
    `${chalk.dim("Host:")}         ${chalk.white(server.host)}`,
    `${chalk.dim("User:")}         ${chalk.white(server.username)}`,
    `${chalk.dim("Last SSH:")}     ${chalk.white(lastConnected)}`,
    `${chalk.dim("Tunnels:")}      ${chalk.white(tunnels.length.toString())}`,
  ];

  console.log(
    boxen(infoLines.join("\n"), {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "gray",
      title: chalk.dim("Server Info"),
      titleAlignment: "left",
    })
  );

  // Tunnels box (if any)
  if (tunnels.length > 0) {
    const tunnelLines = tunnels.map((t) => {
      const proc = processes.find((p) => p.tunnelId === t.id);
      const status = proc ? ICONS.TUNNEL_ACTIVE : ICONS.TUNNEL_INACTIVE;
      const portMap = `localhost:${t.localPort} ${ICONS.ARROW_RIGHT} ${t.remoteHost}:${t.remotePort}`;
      return `${status}  ${chalk.hex(COLORS.BRIGHT_BLUE)(t.name)} ${chalk.dim(
        `(${t.type})`
      )}\n    ${chalk.dim(portMap)}`;
    });

    console.log(
      boxen(tunnelLines.join("\n\n"), {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 0, bottom: 1, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "gray",
        title: chalk.dim(`Tunnels (${tunnels.length})`),
        titleAlignment: "left",
      })
    );
  }
}

function displayTunnelHeader(
  server: IServerConfig,
  tunnel: ITunnelConfig,
  isActive: boolean
): void {
  const statusBadge = isActive
    ? chalk.bgGreen.black(" RUNNING ")
    : chalk.bgGray.white(" STOPPED ");

  const title = `${ICONS.TUNNEL}  ${chalk.bold.hex(COLORS.BRIGHT_BLUE)(
    tunnel.name
  )}  ${statusBadge}`;
  const subtitle = chalk.dim(`${server.name} • ${tunnel.type}`);
  const portMap = `localhost:${tunnel.localPort} ${ICONS.ARROW_RIGHT} ${tunnel.remoteHost}:${tunnel.remotePort}`;
  const border = chalk.hex(COLORS.BRIGHT_BLUE)(BOX_CHARS.HORIZONTAL.repeat(50));

  console.log("\n" + border);
  console.log(title);
  console.log(subtitle);
  console.log(chalk.hex(COLORS.BOTTLE_GREEN)(portMap));
  console.log(border + "\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Menu Builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildMainMenuChoices(
  servers: IServerConfig[],
  processes: IBackgroundProcess[]
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  // Server list
  if (servers.length > 0) {
    choices.push(
      new inquirer.Separator(chalk.dim("─── Servers ───────────────────────"))
    );

    servers.forEach((server) => {
      const tunnels = server.tunnels || [];
      const activeCount = processes.filter(
        (p) => p.serverId === server.id
      ).length;

      // Build server display line
      let displayName = `${ICONS.SERVER}  ${chalk.bold.hex(COLORS.BOTTLE_GREEN)(
        server.name
      )}`;

      // Show linked AWS profile if exists
      if (server.aws_profile_id) {
        const awsProfile = storageService.getAWSProfile(server.aws_profile_id);
        if (awsProfile) {
          displayName += chalk.cyan(` [${ICONS.AWS} ${awsProfile.name}]`);
        }
      }

      displayName += chalk.dim(` (${server.username}@${server.host})`);

      // Show tunnel status indicators
      if (tunnels.length > 0) {
        const activeIndicators = tunnels
          .map((t) => {
            const isActive = processes.some((p) => p.tunnelId === t.id);
            return isActive ? ICONS.TUNNEL_ACTIVE : ICONS.TUNNEL_INACTIVE;
          })
          .join("");
        displayName += `  ${activeIndicators}`;
      }

      if (activeCount > 0) {
        displayName += chalk.green(` ${activeCount} active`);
      }

      choices.push({
        name: displayName,
        value: `server:${server.id}`,
      });
    });
  }

  // Actions
  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
    {
      name: `${ICONS.ADD}  ${chalk.hex(COLORS.BRIGHT_BLUE)("Add New Server")}`,
      value: "add_server",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  ${chalk.dim("Back to Dashboard")}`,
      value: "back",
    }
  );

  return choices;
}

function buildServerActionsChoices(
  server: IServerConfig,
  processes: IBackgroundProcess[]
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];
  const tunnels = server.tunnels || [];

  // Primary action
  choices.push({
    name: `${ICONS.SSH}  ${chalk.bold.hex(COLORS.BOTTLE_GREEN)("SSH Connect")}`,
    value: "ssh",
  });

  // Tunnels section
  if (tunnels.length > 0) {
    choices.push(
      new inquirer.Separator(chalk.dim("─── Tunnels ───────────────────────"))
    );

    tunnels.forEach((tunnel) => {
      const proc = processes.find((p) => p.tunnelId === tunnel.id);
      const status = proc ? ICONS.TUNNEL_ACTIVE : ICONS.TUNNEL_INACTIVE;
      const statusText = proc ? chalk.green("running") : chalk.dim("stopped");

      choices.push({
        name: `${status}  ${chalk.hex(COLORS.BRIGHT_BLUE)(
          tunnel.name
        )} ${chalk.dim(`(${tunnel.type})`)} ${statusText}`,
        value: `tunnel:${tunnel.id}`,
      });
    });
  }

  // Add tunnel action
  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
    {
      name: `${ICONS.ADD}  ${chalk.hex(COLORS.BRIGHT_BLUE)("Add Tunnel")}`,
      value: "add_tunnel",
    }
  );

  // AWS Profile linking
  const awsProfiles = storageService.getAllAWSProfiles();
  if (server.aws_profile_id) {
    const linkedProfile = storageService.getAWSProfile(server.aws_profile_id);
    choices.push({
      name: `${ICONS.LINK}  ${chalk.cyan(`Unlink AWS Profile`)} ${chalk.dim(`(${linkedProfile?.name || "unknown"})`)}`,
      value: "unlink_aws",
    });
  } else if (awsProfiles.length > 0) {
    choices.push({
      name: `${ICONS.AWS}  ${chalk.cyan("Link AWS Profile")}`,
      value: "link_aws",
    });
  }

  // Danger zone
  choices.push(
    new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────")),
    {
      name: `${ICONS.DELETE}  ${chalk.red("Delete Server")}`,
      value: "delete_server",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  ${chalk.dim("Back to Server List")}`,
      value: "back",
    }
  );

  return choices;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function addServerFlow(): Promise<void> {
  console.clear();
  console.log(
    chalk.bold.hex(COLORS.BOTTLE_GREEN)("\n" + ICONS.ADD + "  Add New Server\n")
  );
  console.log(
    chalk.hex(COLORS.BRIGHT_BLUE)(BOX_CHARS.HORIZONTAL.repeat(50)) + "\n"
  );

  const awsProfiles = storageService.getAllAWSProfiles();

  // Check if we have AWS profiles to offer fetch option
  const { method } = await inquirer.prompt({
    type: "list",
    name: "method",
    message: "How would you like to add a server?",
    choices: [
      { name: `${ICONS.ADD}  Manual Entry`, value: "manual" },
      ...(awsProfiles.length > 0
        ? [{ name: `${ICONS.AWS}  Fetch from AWS`, value: "aws" }]
        : [
            {
              name: chalk.dim(`${ICONS.AWS}  Fetch from AWS (no AWS profiles configured)`),
              value: "aws_disabled",
              disabled: true,
            },
          ]),
      new inquirer.Separator(),
      { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
    ],
  });

  if (method === "cancel") return;

  if (method === "aws") {
    await fetchFromAWSFlow();
    return;
  }

  // Manual entry flow
  await addServerManualFlow();
}

async function addServerManualFlow(prefill?: {
  name?: string;
  host?: string;
  username?: string;
  pemPath?: string;
  awsProfileId?: string;
  awsInstanceId?: string;
  awsRegion?: string;
  privateIp?: string;
}): Promise<void> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Server Name (alias):",
      default: prefill?.name,
      validate: (input: string) => input.length > 0 || "Name is required",
    },
    {
      type: "input",
      name: "host",
      message: "IP Address / Hostname:",
      default: prefill?.host,
      validate: (input: string) => input.length > 0 || "Host is required",
    },
    {
      type: "input",
      name: "username",
      message: "SSH Username:",
      default: prefill?.username || "ec2-user",
      validate: (input: string) => input.length > 0 || "Username is required",
    },
    {
      type: "input",
      name: "pemPath",
      message: "Path to PEM file:",
      default: prefill?.pemPath,
      validate: (input: string) => input.length > 0 || "PEM path is required",
    },
  ]);

  const result = await serverService.addServer(
    answers.name,
    answers.host,
    answers.username,
    answers.pemPath.trim()
  );

  if (result && prefill?.awsProfileId) {
    // Update the server with AWS metadata
    const servers = storageService.getAllServers();
    const newServer = servers.find(
      (s) => s.name === answers.name && s.host === answers.host
    );
    if (newServer) {
      storageService.saveServer({
        ...newServer,
        aws_profile_id: prefill.awsProfileId,
        aws_instance_id: prefill.awsInstanceId,
        aws_region: prefill.awsRegion,
        private_ip: prefill.privateIp,
      });
    }
  }

  if (result) {
    console.log(
      "\n" + chalk.green(UI.ICONS.SUCCESS + " Server added successfully!")
    );
  } else {
    console.log("\n" + chalk.red(UI.ICONS.ERROR + " Failed to add server."));
  }

  await waitForEnter();
}

async function fetchFromAWSFlow(): Promise<void> {
  const awsProfiles = storageService.getAllAWSProfiles();

  if (awsProfiles.length === 0) {
    console.log(
      chalk.yellow("\n⚠️  No AWS profiles configured. Please add one first.")
    );
    await waitForEnter();
    return;
  }

  // Select AWS profile
  const { profileId } = await inquirer.prompt({
    type: "list",
    name: "profileId",
    message: "Select AWS Profile:",
    choices: [
      ...awsProfiles.map((p) => ({
        name: `${ICONS.AWS}  ${p.name} ${chalk.dim(`(${p.default_region})`)}`,
        value: p.id,
      })),
      new inquirer.Separator(),
      { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
    ],
  });

  if (profileId === "cancel") return;

  const profile = storageService.getAWSProfile(profileId);
  if (!profile) return;

  // Optionally change region
  const { changeRegion } = await inquirer.prompt({
    type: "confirm",
    name: "changeRegion",
    message: `Fetch from ${profile.default_region}? (No to select different region)`,
    default: true,
  });

  let targetRegion = profile.default_region;

  if (!changeRegion) {
    const { region } = await inquirer.prompt({
      type: "list",
      name: "region",
      message: "Select AWS Region:",
      choices: AWS_REGIONS.map((r) => ({
        name: `${r.value} - ${r.name}`,
        value: r.value,
      })),
      default: profile.default_region,
      pageSize: 12,
    });
    targetRegion = region;
  }

  // Fetch EC2 instances
  const spinner = ora(`Fetching EC2 instances from ${targetRegion}...`).start();
  const result = await awsService.fetchEC2Instances(profileId, targetRegion);

  if (!result.success) {
    spinner.fail(chalk.red(`Failed to fetch: ${result.error}`));
    await waitForEnter();
    return;
  }

  // Filter to only running instances with public IPs
  const runningInstances = result.instances.filter(
    (i) => i.state === "running" && i.public_ip
  );

  if (runningInstances.length === 0) {
    spinner.warn(
      chalk.yellow("No running EC2 instances with public IPs found.")
    );
    await waitForEnter();
    return;
  }

  spinner.succeed(
    chalk.green(`Found ${runningInstances.length} EC2 instance(s)`)
  );
  console.log();

  // Display instances for selection
  const instanceChoices = runningInstances.map((instance) => {
    const status = instance.is_imported
      ? chalk.dim(`[${ICONS.IMPORTED} Already added]`)
      : chalk.green("[NEW]");

    return {
      name: `${ICONS.SERVER}  ${instance.name} ${chalk.dim(`(${instance.instance_id})`)} - ${instance.public_ip} ${status}`,
      value: instance.instance_id,
      disabled: instance.is_imported,
    };
  });

  instanceChoices.push(new inquirer.Separator() as any);
  instanceChoices.push({
    name: `${ICONS.BACK}  Cancel`,
    value: "cancel",
    disabled: false,
  });

  const { selectedInstance } = await inquirer.prompt({
    type: "list",
    name: "selectedInstance",
    message: "Select an EC2 instance to import:",
    choices: instanceChoices,
    pageSize: 15,
  });

  if (selectedInstance === "cancel") return;

  const instance = runningInstances.find(
    (i) => i.instance_id === selectedInstance
  );
  if (!instance) return;

  // Show instance details
  console.log();
  console.log(
    boxen(
      [
        chalk.hex(COLORS.BOTTLE_GREEN).bold(`${ICONS.SERVER} ${instance.name}`),
        "",
        chalk.dim("Instance ID: ") + chalk.white(instance.instance_id),
        chalk.dim("Public IP: ") + chalk.white(instance.public_ip),
        chalk.dim("Private IP: ") + chalk.white(instance.private_ip || "N/A"),
        chalk.dim("Type: ") + chalk.white(instance.instance_type),
        chalk.dim("Key Name: ") + chalk.white(instance.key_name || "N/A"),
        chalk.dim("VPC: ") + chalk.white(instance.vpc_id || "N/A"),
      ].join("\n"),
      {
        padding: 1,
        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );
  console.log();

  // Get suggested values
  const suggestedUsername = awsService.getSuggestedUsername(instance);
  const suggestedPemPath = awsService.getSuggestedPemPath(instance);

  // Import the instance
  await addServerManualFlow({
    name: instance.name,
    host: instance.public_ip!,
    username: suggestedUsername,
    pemPath: suggestedPemPath,
    awsProfileId: profileId,
    awsInstanceId: instance.instance_id,
    awsRegion: targetRegion,
    privateIp: instance.private_ip,
  });
}

async function connectToServer(serverId: string): Promise<void> {
  try {
    await serverService.connectToServer(serverId);
    await waitForEnter("SSH session ended. Press Enter to continue...");
  } catch (error) {
    console.log(chalk.red("\nConnection failed."));
    await waitForEnter();
  }
}

async function linkAWSProfileFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  const awsProfiles = storageService.getAllAWSProfiles();
  if (awsProfiles.length === 0) {
    console.log(
      chalk.yellow("\n⚠️  No AWS profiles configured. Please add one first.")
    );
    await waitForEnter();
    return;
  }

  const { profileId } = await inquirer.prompt({
    type: "list",
    name: "profileId",
    message: "Select AWS Profile to link:",
    choices: [
      ...awsProfiles.map((p) => ({
        name: `${ICONS.AWS}  ${p.name} ${chalk.dim(`(${p.default_region})`)}`,
        value: p.id,
      })),
      new inquirer.Separator(),
      { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
    ],
  });

  if (profileId === "cancel") return;

  storageService.saveServer({
    ...server,
    aws_profile_id: profileId,
  });

  const profile = storageService.getAWSProfile(profileId);
  console.log(
    chalk.green(`\n${UI.ICONS.SUCCESS} Linked to AWS profile "${profile?.name}"`)
  );
  await waitForEnter();
}

async function unlinkAWSProfileFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  const profile = server.aws_profile_id
    ? storageService.getAWSProfile(server.aws_profile_id)
    : null;

  const { confirm } = await inquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: `Unlink AWS profile "${profile?.name || "unknown"}" from this server?`,
    default: true,
  });

  if (confirm) {
    storageService.saveServer({
      ...server,
      aws_profile_id: undefined,
      aws_instance_id: undefined,
      aws_region: undefined,
    });
    console.log(chalk.green(`\n${UI.ICONS.SUCCESS} AWS profile unlinked`));
    await waitForEnter();
  }
}

async function addTunnelFlow(serverId: string): Promise<void> {
  console.clear();
  console.log(
    chalk.bold.hex(COLORS.BRIGHT_BLUE)("\n" + ICONS.ADD + "  Add New Tunnel\n")
  );
  console.log(
    chalk.hex(COLORS.BRIGHT_BLUE)(BOX_CHARS.HORIZONTAL.repeat(50)) + "\n"
  );

  const { type } = await inquirer.prompt([
    {
      type: "list",
      name: "type",
      message: "Tunnel Template:",
      choices: [
        { name: "🔧 Custom Tunnel", value: "custom" },
        { name: "🐘 AWS RDS (PostgreSQL/MySQL)", value: "rds" },
        { name: "🔴 Redis Cache", value: "redis" },
      ],
    },
  ]);

  let tunnelConfig: Partial<ITunnelConfig>;

  if (type === "rds") {
    tunnelConfig = await promptRDSTunnel();
  } else if (type === "redis") {
    tunnelConfig = await promptRedisTunnel();
  } else {
    tunnelConfig = await promptCustomTunnel();
  }

  await serverService.addTunnel(
    serverId,
    tunnelConfig as Omit<ITunnelConfig, "id">
  );
  console.log(
    "\n" + chalk.green(UI.ICONS.SUCCESS + " Tunnel added successfully!")
  );
  await waitForEnter();
}

async function promptCustomTunnel(): Promise<Partial<ITunnelConfig>> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Tunnel Name:",
      validate: (i: string) => i.length > 0 || "Required",
    },
    {
      type: "number",
      name: "localPort",
      message: "Local Port:",
      validate: (i: number) => (i > 0 && i < 65536) || "Invalid port",
    },
    {
      type: "input",
      name: "remoteHost",
      message: "Remote Host:",
      default: "localhost",
    },
    {
      type: "number",
      name: "remotePort",
      message: "Remote Port:",
      validate: (i: number) => (i > 0 && i < 65536) || "Invalid port",
    },
  ]);

  return { ...answers, type: "custom" };
}

async function promptRDSTunnel(): Promise<Partial<ITunnelConfig>> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Tunnel Name:",
      default: "RDS Database",
    },
    {
      type: "input",
      name: "remoteHost",
      message: "RDS Endpoint:",
      validate: (i: string) => i.length > 0 || "Required",
    },
    { type: "number", name: "remotePort", message: "RDS Port:", default: 5432 },
    {
      type: "number",
      name: "localPort",
      message: "Local Port:",
      default: 5432,
    },
  ]);

  return { ...answers, type: "rds" };
}

async function promptRedisTunnel(): Promise<Partial<ITunnelConfig>> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Tunnel Name:",
      default: "Redis Cache",
    },
    {
      type: "input",
      name: "remoteHost",
      message: "Redis Host:",
      default: "localhost",
    },
    {
      type: "number",
      name: "remotePort",
      message: "Redis Port:",
      default: 6379,
    },
    {
      type: "number",
      name: "localPort",
      message: "Local Port:",
      default: 6379,
    },
  ]);

  return { ...answers, type: "redis" };
}

async function startTunnel(serverId: string, tunnelId: string): Promise<void> {
  console.log(chalk.hex(COLORS.BRIGHT_BLUE)("\nStarting tunnel..."));
  console.log(
    boxen(chalk.yellow("Press Ctrl+C to stop the tunnel"), {
      padding: 1,
      borderStyle: "round",
      borderColor: "yellow",
    })
  );

  await serverService.startTunnel(serverId, tunnelId);
  await waitForEnter("Tunnel stopped. Press Enter to continue...");
}

async function stopTunnel(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
    storageService.deleteProcess(pid);
    console.log(chalk.green("\n" + UI.ICONS.SUCCESS + " Tunnel stopped."));
  } catch (error) {
    storageService.deleteProcess(pid);
    console.log(chalk.yellow("\nTunnel process already stopped."));
  }
  await waitForEnter();
}

async function copyTunnelCommand(
  serverId: string,
  tunnelId: string
): Promise<void> {
  const command = serverService.getTunnelCommand(serverId, tunnelId);
  if (command) {
    try {
      await clipboard.write(command);
      console.log(
        chalk.green("\n" + UI.ICONS.SUCCESS + " Command copied to clipboard!")
      );
      console.log(chalk.dim(command));
    } catch {
      console.log(chalk.yellow("\nCould not copy. Here is the command:"));
      console.log(command);
    }
  }
  await waitForEnter();
}

async function deleteTunnel(serverId: string, tunnelId: string): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.red("Are you sure you want to delete this tunnel?"),
      default: false,
    },
  ]);

  if (confirm) {
    await serverService.deleteTunnel(serverId, tunnelId);
    console.log(chalk.green("\n" + UI.ICONS.SUCCESS + " Tunnel deleted."));
    await waitForEnter();
  }
}

async function deleteServerFlow(serverId: string): Promise<boolean> {
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.red(
        "Are you sure you want to delete this server and all its tunnels?"
      ),
      default: false,
    },
  ]);

  if (confirm) {
    await serverService.deleteServer(serverId);
    console.log(chalk.green("\n" + UI.ICONS.SUCCESS + " Server deleted."));
    await waitForEnter();
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

async function waitForEnter(
  message = "Press Enter to continue..."
): Promise<void> {
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: chalk.dim(message),
    },
  ]);
}

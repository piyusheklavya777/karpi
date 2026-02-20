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
  ISyncedFile,
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
  SYNC: "🔄",
  FILE: "📄",
  FOLDER: "📁",
  VIEW: "👁️",
  EDIT: "✏️",
  ENV: "🔐",
  BROWSE: "🔍",
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
        message: chalk.hex(COLORS.SECONDARY)("Select an option:"),
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
        message: chalk.hex(COLORS.SECONDARY)("Action:"),
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
      case "edit_server":
        await editServerFlow(serverId);
        break;
      case "delete_server":
        const deleted = await deleteServerFlow(serverId);
        if (deleted) running = false;
        break;
      case "add_synced_file":
        await addSyncedFileFlow(serverId);
        break;
      case "back":
        running = false;
        break;
      default:
        if (action.startsWith("tunnel:")) {
          const tunnelId = action.replace("tunnel:", "");
          await tunnelActionsMenu(serverId, tunnelId);
        } else if (action.startsWith("syncedfile:")) {
          const syncedFileId = action.replace("syncedfile:", "");
          await syncedFileActionsMenu(serverId, syncedFileId);
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
    { name: `${ICONS.EDIT}  Edit Tunnel`, value: "edit" },
    new inquirer.Separator(chalk.dim("─────────────────────")),
    { name: `${ICONS.DELETE}  ${chalk.red("Delete Tunnel")}`, value: "delete" },
    new inquirer.Separator(chalk.dim("─────────────────────")),
    { name: `${ICONS.BACK}  Back to Server`, value: "back" }
  );

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Tunnel Action:"),
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
    case "edit":
      await editTunnelFlow(serverId, tunnelId);
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
  const title = chalk.bold.hex(COLORS.PRIMARY)(
    `${ICONS.SERVER}  Remote Server Management`
  );
  const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

  console.log("\n" + border);
  console.log(title);
  console.log(border + "\n");
}

function displayEmptyState(): void {
  console.log(
    boxen(
      chalk.hex(COLORS.SECONDARY)("No servers configured yet.\n\n") +
      chalk.dim("Press ") +
      chalk.white("↓") +
      chalk.dim(" to select ") +
      chalk.hex(COLORS.PRIMARY)('"Add New Server"') +
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

  const title = `${ICONS.SERVER}  ${chalk.bold.hex(COLORS.PRIMARY)(
    server.name
  )}  ${statusBadge}`;
  const subtitle = chalk.dim(`${server.username}@${server.host}`);
  const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

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
      return `${status}  ${chalk.hex(COLORS.SECONDARY)(t.name)} ${chalk.dim(
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

  const title = `${ICONS.TUNNEL}  ${chalk.bold.hex(COLORS.SECONDARY)(
    tunnel.name
  )}  ${statusBadge}`;
  const subtitle = chalk.dim(`${server.name} • ${tunnel.type}`);
  const portMap = `localhost:${tunnel.localPort} ${ICONS.ARROW_RIGHT} ${tunnel.remoteHost}:${tunnel.remotePort}`;
  const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

  console.log("\n" + border);
  console.log(title);
  console.log(subtitle);
  console.log(chalk.hex(COLORS.PRIMARY)(portMap));
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

      // Build server display line with better spacing
      // Note: Using chalk.bold without colors so inquirer selection highlighting works
      let displayName = `${ICONS.SERVER}  ${chalk.bold(server.name)}`;

      // Show linked AWS profile if exists
      if (server.aws_profile_id) {
        const awsProfile = storageService.getAWSProfile(server.aws_profile_id);
        if (awsProfile) {
          displayName += ` [${ICONS.AWS}${awsProfile.name}]`;
        }
      }

      displayName += ` (${server.username}@${server.host})`;

      // Show tunnel status indicators with spacing
      if (tunnels.length > 0) {
        const activeIndicators = tunnels
          .map((t) => {
            const isActive = processes.some((p) => p.tunnelId === t.id);
            return isActive ? ICONS.TUNNEL_ACTIVE : ICONS.TUNNEL_INACTIVE;
          })
          .join(" ");
        displayName += `  ${activeIndicators}`;
      }

      if (activeCount > 0) {
        displayName += ` ${activeCount} active`;
      }

      choices.push({
        name: displayName,
        value: `server:${server.id}`,
      });
      choices.push(new inquirer.Separator(" "));
    });
  }

  // Actions
  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
    {
      name: `${ICONS.ADD}  Add New Server`,
      value: "add_server",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  Back to Dashboard`,
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
    name: `${ICONS.SSH}  ${chalk.bold("SSH Connect")}`,
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
      const statusText = proc ? "running" : "stopped";

      choices.push({
        name: `${status}  ${chalk.bold(tunnel.name)} (${tunnel.type}) ${statusText}`,
        value: `tunnel:${tunnel.id}`,
      });
      choices.push(new inquirer.Separator(" "));
    });
  }

  // Add tunnel action
  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
    {
      name: `${ICONS.ADD}  Add Tunnel`,
      value: "add_tunnel",
    },
    {
      name: `${ICONS.EDIT}  Edit Server`,
      value: "edit_server",
    }
  );

  // Synced Files section
  const syncedFiles = server.synced_files || [];
  choices.push(
    new inquirer.Separator(chalk.dim("─── Synced Files ──────────────────"))
  );

  if (syncedFiles.length > 0) {
    syncedFiles.forEach((sf) => {
      const lastSync = sf.last_synced
        ? `synced ${format(new Date(sf.last_synced), "MMM d, HH:mm")}`
        : "never synced";
      const icon = sf.name.toLowerCase().includes("env")
        ? ICONS.ENV
        : ICONS.FILE;

      choices.push({
        name: `${icon}  ${chalk.bold(sf.name)} ${lastSync}`,
        value: `syncedfile:${sf.id}`,
      });
      choices.push(new inquirer.Separator(" "));
    });
  }

  choices.push({
    name: `${ICONS.ADD}  Add Synced File`,
    value: "add_synced_file",
  });

  // AWS Profile linking
  const awsProfiles = storageService.getAllAWSProfiles();
  if (server.aws_profile_id) {
    const linkedProfile = storageService.getAWSProfile(server.aws_profile_id);
    choices.push({
      name: `${ICONS.LINK}  Unlink AWS Profile (${linkedProfile?.name || "unknown"})`,
      value: "unlink_aws",
    });
  } else if (awsProfiles.length > 0) {
    choices.push({
      name: `${ICONS.AWS}  Link AWS Profile`,
      value: "link_aws",
    });
  }

  // Danger zone
  choices.push(
    new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────")),
    {
      name: `${ICONS.DELETE}  Delete Server`,
      value: "delete_server",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  Back to Server List`,
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
    chalk.bold.hex(COLORS.PRIMARY)("\n" + ICONS.ADD + "  Add New Server\n")
  );
  console.log(
    chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50)) + "\n"
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
            name: chalk.dim(
              `${ICONS.AWS}  Fetch from AWS (no AWS profiles configured)`
            ),
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
      name: `${ICONS.SERVER}  ${instance.name} ${chalk.dim(
        `(${instance.instance_id})`
      )} - ${instance.public_ip} ${status}`,
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
        chalk.hex(COLORS.PRIMARY).bold(`${ICONS.SERVER} ${instance.name}`),
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
    chalk.green(
      `\n${UI.ICONS.SUCCESS} Linked to AWS profile "${profile?.name}"`
    )
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
    message: `Unlink AWS profile "${profile?.name || "unknown"
      }" from this server?`,
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
    chalk.bold.hex(COLORS.SECONDARY)("\n" + ICONS.ADD + "  Add New Tunnel\n")
  );
  console.log(
    chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50)) + "\n"
  );

  const tunnelConfig = await promptCustomTunnel();

  await serverService.addTunnel(
    serverId,
    tunnelConfig as Omit<ITunnelConfig, "id">
  );
  console.log(
    "\n" + chalk.green(UI.ICONS.SUCCESS + " Tunnel added successfully!")
  );
  await waitForEnter();
}

async function promptCustomTunnel(
  defaults?: Partial<ITunnelConfig>
): Promise<Partial<ITunnelConfig>> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Tunnel Name:",
      default: defaults?.name,
      validate: (i: string) => i.length > 0 || "Required",
    },
    {
      type: "number",
      name: "localPort",
      message: "Local Port:",
      default: defaults?.localPort,
      validate: (i: number) => (i > 0 && i < 65536) || "Invalid port",
    },
    {
      type: "input",
      name: "remoteHost",
      message: "Remote Host:",
      default: defaults?.remoteHost || "localhost",
    },
    {
      type: "number",
      name: "remotePort",
      message: "Remote Port:",
      default: defaults?.remotePort,
      validate: (i: number) => (i > 0 && i < 65536) || "Invalid port",
    },
  ]);

  return { ...answers, type: defaults?.type || "custom" };
}

async function editTunnelFlow(
  serverId: string,
  tunnelId: string
): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  const tunnel = server.tunnels?.find((t) => t.id === tunnelId);
  if (!tunnel) return;

  console.clear();
  console.log(
    boxen(chalk.hex(COLORS.PRIMARY).bold(`${ICONS.EDIT} Edit Tunnel`), {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
  console.log();

  const updates = await promptCustomTunnel(tunnel);

  await serverService.updateTunnel(serverId, tunnelId, updates);
  console.log(
    "\n" + chalk.green(UI.ICONS.SUCCESS + " Tunnel updated successfully!")
  );
  await waitForEnter();
}

async function editServerFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  console.clear();
  console.log(
    boxen(chalk.hex(COLORS.PRIMARY).bold(`${ICONS.EDIT} Edit Server`), {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
  console.log();

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: chalk.hex(COLORS.SECONDARY)("Server Name (alias):"),
      default: server.name,
      validate: (input: string) => input.length > 0 || "Name is required",
    },
    {
      type: "input",
      name: "host",
      message: chalk.hex(COLORS.SECONDARY)("IP Address / Hostname:"),
      default: server.host,
      validate: (input: string) => input.length > 0 || "Host is required",
    },
    {
      type: "input",
      name: "username",
      message: chalk.hex(COLORS.SECONDARY)("SSH Username:"),
      default: server.username,
      validate: (input: string) => input.length > 0 || "Username is required",
    },
  ]);

  await serverService.updateServer(serverId, {
    name: answers.name,
    host: answers.host,
    username: answers.username,
  });

  console.log(
    "\n" + chalk.green(UI.ICONS.SUCCESS + " Server updated successfully!")
  );
  await waitForEnter();
}

async function startTunnel(serverId: string, tunnelId: string): Promise<void> {
  console.log(chalk.hex(COLORS.SECONDARY)("\nStarting tunnel..."));
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
// Synced Files UI
// ═══════════════════════════════════════════════════════════════════════════════

async function syncedFileActionsMenu(
  serverId: string,
  syncedFileId: string
): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  const syncedFile = serverService.getSyncedFile(serverId, syncedFileId);
  if (!syncedFile) return;

  console.clear();
  displaySyncedFileHeader(server, syncedFile);

  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  choices.push({
    name: `${ICONS.SYNC}  ${chalk.green("Sync to Remote")} ${chalk.dim(
      "(Replace remote file)"
    )}`,
    value: "sync",
  });
  choices.push({
    name: `${ICONS.VIEW}  ${chalk.cyan("View Remote File")}`,
    value: "view",
  });
  choices.push(
    new inquirer.Separator(chalk.dim("───────────────────────────────────"))
  );
  choices.push({
    name: `${ICONS.EDIT}  ${chalk.white("Edit Configuration")}`,
    value: "edit",
  });
  choices.push({
    name: `${ICONS.DELETE}  ${chalk.red("Delete")}`,
    value: "delete",
  });
  choices.push(
    new inquirer.Separator(chalk.dim("───────────────────────────────────"))
  );
  choices.push({
    name: `${ICONS.BACK}  ${chalk.dim("Back")}`,
    value: "back",
  });

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Action:"),
      choices,
      pageSize: 10,
    },
  ]);

  switch (action) {
    case "sync":
      await syncFileToRemote(serverId, syncedFileId);
      break;
    case "view":
      await viewRemoteFile(serverId, syncedFile.remote_path);
      break;
    case "edit":
      await editSyncedFileFlow(serverId, syncedFileId);
      break;
    case "delete":
      await deleteSyncedFile(serverId, syncedFileId);
      break;
  }
}

function displaySyncedFileHeader(
  server: IServerConfig,
  syncedFile: ISyncedFile
): void {
  const icon = syncedFile.name.toLowerCase().includes("env")
    ? ICONS.ENV
    : ICONS.FILE;

  const header = boxen(
    chalk.hex(COLORS.PRIMARY).bold(`${icon} ${syncedFile.name}`) +
    "\n" +
    chalk.dim(`on ${server.name}`),
    {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
    }
  );
  console.log(header);
  console.log();

  // File details
  const details = [
    chalk.dim("Local:  ") + chalk.white(syncedFile.local_path),
    chalk.dim("Remote: ") + chalk.white(syncedFile.remote_path),
    syncedFile.last_synced
      ? chalk.dim("Last Synced: ") +
      chalk.green(format(new Date(syncedFile.last_synced), "PPpp"))
      : chalk.dim("Last Synced: ") + chalk.yellow("Never"),
  ].join("\n");

  console.log(
    boxen(details, {
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "gray",
      dimBorder: true,
    })
  );
  console.log();
}

async function addSyncedFileFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) return;

  console.clear();
  console.log(
    boxen(
      chalk.hex(COLORS.PRIMARY).bold(`${ICONS.ADD} Add Synced File`) +
      "\n" +
      chalk.dim(`to ${server.name}`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );
  console.log();

  // Step 1: Name
  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: chalk.hex(COLORS.SECONDARY)("Name (e.g., 'Dev ENV File'):"),
      validate: (input: string) =>
        input.trim().length > 0 || "Name is required",
    },
  ]);

  // Step 2: Local file path
  const { localPath } = await inquirer.prompt([
    {
      type: "input",
      name: "localPath",
      message: chalk.hex(COLORS.SECONDARY)("Local file path (absolute):"),
      validate: (input: string) =>
        input.trim().length > 0 || "Path is required",
    },
  ]);

  // Step 3: Remote path (with options)
  const remotePath = await getRemotePathWithOptions(
    serverId,
    server,
    localPath.trim()
  );
  if (!remotePath) return;

  // Create the synced file
  const spinner = ora("Adding synced file...").start();
  const result = await serverService.addSyncedFile(serverId, {
    name: name.trim(),
    local_path: localPath.trim(),
    remote_path: remotePath,
  });

  if (result) {
    spinner.succeed(chalk.green("Synced file added!"));
  } else {
    spinner.fail(chalk.red("Failed to add synced file"));
  }

  await waitForEnter();
}

async function getRemotePathWithOptions(
  serverId: string,
  server: IServerConfig,
  localFilePath?: string
): Promise<string | null> {
  const existingSyncedFiles = server.synced_files || [];
  const localFileName = localFilePath
    ? localFilePath.split("/").pop() || ""
    : "";

  const choices: Array<{ name: string; value: string } | inquirer.Separator> = [
    {
      name: `${ICONS.EDIT}  Type path manually`,
      value: "manual",
    },
    {
      name: `${ICONS.BROWSE}  Browse remote server`,
      value: "browse",
    },
  ];

  if (existingSyncedFiles.length > 0) {
    choices.push(
      new inquirer.Separator(chalk.dim("─── Copy from existing ────────────"))
    );
    existingSyncedFiles.forEach((sf) => {
      choices.push({
        name: `${ICONS.COPY}  ${sf.name}: ${chalk.dim(sf.remote_path)}`,
        value: `copy:${sf.id}`,
      });
    });
  }

  choices.push(
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  Cancel`,
      value: "cancel",
    }
  );

  const { method } = await inquirer.prompt([
    {
      type: "list",
      name: "method",
      message: chalk.hex(COLORS.SECONDARY)(
        "How would you like to specify the remote path?"
      ),
      choices,
      pageSize: 12,
    },
  ]);

  if (method === "cancel") return null;

  if (method === "manual") {
    const { remotePath } = await inquirer.prompt([
      {
        type: "input",
        name: "remotePath",
        message: chalk.hex(COLORS.SECONDARY)(
          "Remote path (absolute on server):"
        ),
        validate: (input: string) =>
          input.trim().length > 0 || "Path is required",
      },
    ]);
    return remotePath.trim();
  }

  if (method === "browse") {
    return await browseRemoteFileSystem(serverId, localFileName);
  }

  if (method.startsWith("copy:")) {
    const sfId = method.replace("copy:", "");
    const sf = existingSyncedFiles.find((s) => s.id === sfId);
    if (sf) {
      // Pre-fill with the copied path, allow editing
      const { remotePath } = await inquirer.prompt([
        {
          type: "input",
          name: "remotePath",
          message: chalk.hex(COLORS.SECONDARY)(
            "Remote path (edit as needed):"
          ),
          default: sf.remote_path,
          validate: (input: string) =>
            input.trim().length > 0 || "Path is required",
        },
      ]);
      return remotePath.trim();
    }
  }

  return null;
}

async function browseRemoteFileSystem(
  serverId: string,
  localFileName?: string
): Promise<string | null> {
  let currentPath = "/home";

  // Try to detect home directory
  const server = serverService.getServer(serverId);
  if (server) {
    currentPath = `/home/${server.username}`;
  }

  console.log();
  console.log(
    chalk.hex(COLORS.PRIMARY).bold(`${ICONS.BROWSE} Remote File Browser`)
  );
  console.log(chalk.dim("Navigate and select a file, or create a new one."));
  if (localFileName) {
    console.log(chalk.dim(`Local file: ${chalk.white(localFileName)}`));
  }
  console.log();

  while (true) {
    const spinner = ora(`Loading ${currentPath}...`).start();
    const result = await serverService.listRemoteDirectory(
      serverId,
      currentPath
    );
    spinner.stop();

    if (!result.success || !result.files) {
      console.log(
        chalk.red(`Error: ${result.error || "Could not list directory"}`)
      );
      // Try parent directory
      const { retry } = await inquirer.prompt([
        {
          type: "confirm",
          name: "retry",
          message: "Try parent directory?",
          default: true,
        },
      ]);
      if (retry) {
        currentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
        continue;
      }
      return null;
    }

    const files = result.files;
    const choices: Array<{ name: string; value: string } | inquirer.Separator> =
      [];

    // Current path display
    choices.push(new inquirer.Separator(chalk.cyan(`📍 ${currentPath}`)));
    choices.push(
      new inquirer.Separator(chalk.dim("───────────────────────────────────"))
    );

    // Go up option
    if (currentPath !== "/") {
      choices.push({
        name: `${ICONS.FOLDER}  ${chalk.yellow("..")} ${chalk.dim(
          "(parent directory)"
        )}`,
        value: "..parent",
      });
    }

    // Files and directories
    files.forEach((file) => {
      if (file.isDirectory) {
        choices.push({
          name: `${ICONS.FOLDER}  ${chalk.blue(file.name)}/`,
          value: `dir:${file.path}`,
        });
      } else {
        // Highlight env files
        const isEnv =
          file.name.includes(".env") ||
          file.name.endsWith(".conf") ||
          file.name.endsWith(".config");
        const icon = isEnv ? ICONS.ENV : ICONS.FILE;
        const color = isEnv
          ? chalk.green
          : file.isHidden
            ? chalk.dim
            : chalk.white;
        const sizeStr = chalk.dim(`(${formatFileSize(file.size)})`);

        choices.push({
          name: `${icon}  ${color(file.name)} ${sizeStr}`,
          value: `file:${file.path}`,
        });
      }
    });

    choices.push(
      new inquirer.Separator(chalk.dim("───────────────────────────────────"))
    );

    // Create new file option
    choices.push({
      name: `${ICONS.ADD}  ${chalk.green("Create new file here")}`,
      value: "create_new",
    });

    choices.push({
      name: `${ICONS.EDIT}  ${chalk.cyan("Enter path manually")}`,
      value: "manual",
    });
    choices.push({
      name: `${ICONS.BACK}  ${chalk.dim("Cancel")}`,
      value: "cancel",
    });

    const { selection } = await inquirer.prompt([
      {
        type: "list",
        name: "selection",
        message: chalk.hex(COLORS.SECONDARY)("Select file or navigate:"),
        choices,
        pageSize: 20,
      },
    ]);

    if (selection === "cancel") return null;

    if (selection === "create_new") {
      // Ask for filename options
      return await createNewFilePrompt(currentPath, localFileName);
    }

    if (selection === "manual") {
      const { path: manualPath } = await inquirer.prompt([
        {
          type: "input",
          name: "path",
          message: "Enter path:",
          default: currentPath + "/",
        },
      ]);
      return manualPath.trim();
    }

    if (selection === "..parent") {
      currentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
      continue;
    }

    if (selection.startsWith("dir:")) {
      currentPath = selection.replace("dir:", "");
      continue;
    }

    if (selection.startsWith("file:")) {
      return selection.replace("file:", "");
    }
  }
}

async function createNewFilePrompt(
  currentPath: string,
  localFileName?: string
): Promise<string | null> {
  const choices: Array<{ name: string; value: string }> = [];

  if (localFileName) {
    choices.push({
      name: `${ICONS.FILE}  Use original name: ${chalk.green(localFileName)}`,
      value: "original",
    });
  }

  choices.push({
    name: `${ICONS.EDIT}  Enter custom filename`,
    value: "custom",
  });

  const { method } = await inquirer.prompt([
    {
      type: "list",
      name: "method",
      message: chalk.hex(COLORS.SECONDARY)(
        "How would you like to name the remote file?"
      ),
      choices,
    },
  ]);

  let fileName: string;

  if (method === "original" && localFileName) {
    fileName = localFileName;
  } else {
    const { customName } = await inquirer.prompt([
      {
        type: "input",
        name: "customName",
        message: chalk.hex(COLORS.SECONDARY)("Enter filename:"),
        default: localFileName || "",
        validate: (input: string) => {
          if (!input.trim()) return "Filename is required";
          if (input.includes("/")) return "Filename cannot contain /";
          return true;
        },
      },
    ]);
    fileName = customName.trim();
  }

  const fullPath =
    currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;

  console.log(chalk.dim(`\nRemote path will be: ${chalk.white(fullPath)}`));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Use this path?",
      default: true,
    },
  ]);

  return confirm ? fullPath : null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function syncFileToRemote(
  serverId: string,
  syncedFileId: string
): Promise<void> {
  const syncedFile = serverService.getSyncedFile(serverId, syncedFileId);
  if (!syncedFile) return;

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow(
        `Replace remote file ${chalk.white(
          syncedFile.remote_path
        )} with local file?`
      ),
      default: true,
    },
  ]);

  if (!confirm) return;

  const spinner = ora("Syncing file to remote...").start();
  const result = await serverService.syncFileToRemote(serverId, syncedFileId);

  if (result.success) {
    spinner.succeed(chalk.green("File synced successfully!"));
  } else {
    spinner.fail(chalk.red(`Sync failed: ${result.error}`));
  }

  await waitForEnter();
}

async function viewRemoteFile(
  serverId: string,
  remotePath: string
): Promise<void> {
  const spinner = ora("Fetching remote file...").start();
  const result = await serverService.viewRemoteFile(serverId, remotePath);

  if (result.success && result.content) {
    spinner.stop();
    console.clear();

    console.log(
      boxen(
        chalk
          .hex(COLORS.PRIMARY)
          .bold(`${ICONS.VIEW} Remote File Contents`) +
        "\n" +
        chalk.dim(remotePath),
        {
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
          borderStyle: "round",
          borderColor: "cyan",
        }
      )
    );
    console.log();

    // Display file contents with line numbers
    const lines = result.content.split("\n");
    const maxLineNum = String(lines.length).length;

    lines.forEach((line, i) => {
      const lineNum = chalk.dim(
        String(i + 1).padStart(maxLineNum, " ") + " │ "
      );
      console.log(lineNum + line);
    });

    console.log();
  } else {
    spinner.fail(chalk.red(`Failed to read file: ${result.error}`));
  }

  await waitForEnter();
}

async function editSyncedFileFlow(
  serverId: string,
  syncedFileId: string
): Promise<void> {
  const server = serverService.getServer(serverId);
  const syncedFile = serverService.getSyncedFile(serverId, syncedFileId);
  if (!server || !syncedFile) return;

  console.clear();
  console.log(
    boxen(
      chalk.hex(COLORS.PRIMARY).bold(`${ICONS.EDIT} Edit Synced File`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );
  console.log();

  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: chalk.hex(COLORS.SECONDARY)("Name:"),
      default: syncedFile.name,
    },
  ]);

  const { localPath } = await inquirer.prompt([
    {
      type: "input",
      name: "localPath",
      message: chalk.hex(COLORS.SECONDARY)("Local path:"),
      default: syncedFile.local_path,
    },
  ]);

  // Remote path with copy option
  const existingFiles = (server.synced_files || []).filter(
    (sf) => sf.id !== syncedFileId
  );

  const remoteChoices: Array<
    { name: string; value: string } | inquirer.Separator
  > = [
      {
        name: `${ICONS.EDIT}  Keep current: ${chalk.dim(syncedFile.remote_path)}`,
        value: "keep",
      },
      {
        name: `${ICONS.EDIT}  Edit manually`,
        value: "edit",
      },
      {
        name: `${ICONS.BROWSE}  Browse remote server`,
        value: "browse",
      },
    ];

  if (existingFiles.length > 0) {
    remoteChoices.push(
      new inquirer.Separator(chalk.dim("─── Copy from other synced file ───"))
    );
    existingFiles.forEach((sf) => {
      remoteChoices.push({
        name: `${ICONS.COPY}  ${sf.name}: ${chalk.dim(sf.remote_path)}`,
        value: `copy:${sf.remote_path}`,
      });
    });
  }

  const { remoteMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "remoteMethod",
      message: chalk.hex(COLORS.SECONDARY)("Remote path:"),
      choices: remoteChoices,
      pageSize: 10,
    },
  ]);

  let remotePath = syncedFile.remote_path;

  if (remoteMethod === "edit") {
    const { newPath } = await inquirer.prompt([
      {
        type: "input",
        name: "newPath",
        message: "New remote path:",
        default: syncedFile.remote_path,
      },
    ]);
    remotePath = newPath.trim();
  } else if (remoteMethod === "browse") {
    const browsedPath = await browseRemoteFileSystem(serverId);
    if (browsedPath) remotePath = browsedPath;
  } else if (remoteMethod.startsWith("copy:")) {
    const copiedPath = remoteMethod.replace("copy:", "");
    const { editedPath } = await inquirer.prompt([
      {
        type: "input",
        name: "editedPath",
        message: "Edit path as needed:",
        default: copiedPath,
      },
    ]);
    remotePath = editedPath.trim();
  }

  const spinner = ora("Updating...").start();
  await serverService.updateSyncedFile(serverId, syncedFileId, {
    name: name.trim(),
    local_path: localPath.trim(),
    remote_path: remotePath,
  });
  spinner.succeed(chalk.green("Synced file updated!"));

  await waitForEnter();
}

async function deleteSyncedFile(
  serverId: string,
  syncedFileId: string
): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.red(
        "Are you sure you want to delete this synced file config?"
      ),
      default: false,
    },
  ]);

  if (confirm) {
    await serverService.deleteSyncedFile(serverId, syncedFileId);
    console.log(chalk.green("\n" + UI.ICONS.SUCCESS + " Synced file deleted."));
    await waitForEnter();
  }
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

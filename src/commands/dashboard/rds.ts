// src/commands/dashboard/rds.ts

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import clipboard from "clipboardy";
import { nanoid } from "nanoid";
import { storageService } from "../../services/storage.service";
import { serverService } from "../../services/server.service";
import { awsService, AWS_REGIONS } from "../../services/aws.service";
import { profileService } from "../../services/profile.service";
import { UI, COLORS } from "../../config/constants";
import type { IRDSInstance, TRDSEngine } from "../../types";

// ═══════════════════════════════════════════════════════════════════════════════
// UI Constants
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
  DATABASE: "🗄️",
  POSTGRES: "🐘",
  MYSQL: "🐬",
  SQLSERVER: "🪟",
  ORACLE: "🔶",
  SERVER: "🖥️",
  LINK: "🔗",
  UNLINK: "⛓️‍💥",
  TUNNEL: "🚇",
  COPY: "📋",
  ADD: "➕",
  DELETE: "🗑️",
  BACK: "◀",
  AWS: "☁️",
  ACTIVE: "🟢",
  INACTIVE: "⚫",
  CHECK: "✓",
  CROSS: "✗",
  IMPORTED: "✅",
  CONNECT: "🔌",
} as const;

const STATUS_COLORS: Record<string, string> = {
  available: "#00ff00",
  creating: "#ffff00",
  deleting: "#ff0000",
  stopped: "#808080",
  starting: "#ffff00",
  stopping: "#ffff00",
  modifying: "#ffff00",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main RDS Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function rdsMenu(): Promise<void> {
  let running = true;

  while (running) {
    console.clear();
    displayHeader();

    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) {
      console.log(chalk.red("No active profile. Please login first."));
      await pressEnterToContinue();
      return;
    }

    const rdsInstances = storageService.getRDSByProfileId(activeProfile.id);
    const processes = storageService.getAllProcesses();

    if (rdsInstances.length === 0) {
      displayEmptyState();
    }

    const choices = buildMainMenuChoices(rdsInstances, processes);

    const { action } = await inquirer.prompt({
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Select an option:"),
      choices,
      pageSize: 15,
    });

    if (action === "back") {
      running = false;
    } else if (action === "add_rds") {
      await addRDSFlow();
    } else if (action.startsWith("rds:")) {
      const rdsId = action.replace("rds:", "");
      await rdsActionsMenu(rdsId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RDS Actions Menu
// ═══════════════════════════════════════════════════════════════════════════════

async function rdsActionsMenu(rdsId: string): Promise<void> {
  let running = true;

  while (running) {
    console.clear();

    const rds = storageService.getRDSInstance(rdsId);
    if (!rds) {
      running = false;
      continue;
    }

    const processes = storageService.getAllProcesses();
    const tunnelProcess = rds.linked_tunnel_id
      ? processes.find((p) => p.tunnelId === rds.linked_tunnel_id)
      : null;

    displayRDSHeader(rds);
    displayRDSDetails(rds, tunnelProcess || null);

    const choices = buildRDSActionsChoices(rds, !!tunnelProcess);

    const { action } = await inquirer.prompt({
      type: "list",
      name: "action",
      message: chalk.hex(COLORS.SECONDARY)("Action:"),
      choices,
      pageSize: 15,
    });

    switch (action) {
      case "connect":
        await connectToRDS(rds);
        break;
      case "start_tunnel":
        await startTunnel(rds);
        break;
      case "stop_tunnel":
        await stopTunnel(rds);
        break;
      case "link_server":
        await linkServerFlow(rds);
        break;
      case "unlink_server":
        await unlinkServerFlow(rds);
        break;
      case "copy_connection":
        await copyConnectionString(rds);
        break;
      case "edit":
        await editRDSFlow(rds);
        break;
      case "delete":
        const deleted = await deleteRDSFlow(rds);
        if (deleted) running = false;
        break;
      case "back":
        running = false;
        break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Functions
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader(): void {
  const header = boxen(
    chalk.hex(COLORS.PRIMARY).bold(`${ICONS.DATABASE} RDS Databases`),
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
      chalk.dim("No RDS databases configured.\n\n") +
      chalk.hex(COLORS.SECONDARY)(
        "Add a database to manage connections and tunnels."
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

function displayRDSHeader(rds: IRDSInstance): void {
  const engineIcon = awsService.getEngineIcon(rds.engine);
  const engineName = awsService.getEngineDisplayName(rds.engine);

  const header = boxen(
    chalk.hex(COLORS.PRIMARY).bold(`${engineIcon} ${rds.name}`) +
    "\n" +
    chalk.dim(`${engineName} ${rds.engine_version}`),
    {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
    }
  );
  console.log(header);
  console.log();
}

function displayRDSDetails(
  rds: IRDSInstance,
  tunnelProcess: { pid: number } | null
): void {
  const linkedServer = rds.linked_server_id
    ? serverService.getServer(rds.linked_server_id)
    : null;

  const lines: string[] = [];

  // Status badge
  const statusColor = STATUS_COLORS[rds.status] || "#808080";
  const statusBadge = chalk
    .hex(statusColor)
    .bold(` ${rds.status.toUpperCase()} `);
  lines.push(chalk.dim("Status: ") + statusBadge);

  // Connection info
  lines.push("");
  lines.push(chalk.dim("Endpoint: ") + chalk.white(rds.endpoint));
  lines.push(chalk.dim("Port: ") + chalk.white(rds.port.toString()));
  if (rds.db_name) {
    lines.push(chalk.dim("Database: ") + chalk.white(rds.db_name));
  }
  if (rds.master_username) {
    lines.push(chalk.dim("Username: ") + chalk.white(rds.master_username));
  }

  // Linked server
  lines.push("");
  if (linkedServer) {
    lines.push(
      chalk.dim("Linked Server: ") +
      chalk.cyan(`${ICONS.SERVER} ${linkedServer.name}`)
    );
    if (tunnelProcess) {
      lines.push(
        chalk.dim("Tunnel: ") +
        chalk.green(`${ICONS.ACTIVE} Active (localhost:${rds.local_port})`)
      );
    } else {
      lines.push(
        chalk.dim("Tunnel: ") + chalk.gray(`${ICONS.INACTIVE} Not running`)
      );
    }
  } else {
    lines.push(
      chalk.dim("Linked Server: ") + chalk.yellow("Not linked (no tunnel)")
    );
  }

  // AWS info
  lines.push("");
  lines.push(
    chalk.dim("Instance ID: ") + chalk.gray(rds.db_instance_identifier)
  );
  lines.push(chalk.dim("Region: ") + chalk.gray(rds.aws_region));

  console.log(
    boxen(lines.join("\n"), {
      padding: 1,
      borderStyle: "round",
      borderColor: "gray",
    })
  );
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Menu Builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildMainMenuChoices(
  rdsInstances: IRDSInstance[],
  processes: { tunnelId: string }[]
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];

  if (rdsInstances.length > 0) {
    choices.push(
      new inquirer.Separator(chalk.dim("─── Databases ─────────────────────"))
    );

    rdsInstances.forEach((rds) => {
      const engineIcon = awsService.getEngineIcon(rds.engine);
      const linkedServer = rds.linked_server_id
        ? serverService.getServer(rds.linked_server_id)
        : null;

      const tunnelActive =
        rds.linked_tunnel_id &&
        processes.some((p) => p.tunnelId === rds.linked_tunnel_id);

      // Note: Using chalk.bold without colors so inquirer selection highlighting works
      let displayName = `${engineIcon}  ${chalk.bold(rds.name)}`;

      // Show linked server
      if (linkedServer) {
        displayName += ` → ${linkedServer.name}`;
      }

      // Show tunnel status
      if (tunnelActive) {
        displayName += ` ${ICONS.ACTIVE}`;
      } else if (linkedServer) {
        displayName += ` ${ICONS.INACTIVE}`;
      }

      // Show engine type
      displayName += ` (${rds.engine})`;

      choices.push({
        name: displayName,
        value: `rds:${rds.id}`,
      });
      choices.push(new inquirer.Separator(" "));
    });
  }

  // Actions
  choices.push(
    new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
    {
      name: `${ICONS.ADD}  Add RDS Database`,
      value: "add_rds",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  Back to Dashboard`,
      value: "back",
    }
  );

  return choices;
}

function buildRDSActionsChoices(
  rds: IRDSInstance,
  tunnelActive: boolean
): Array<{ name: string; value: string } | inquirer.Separator> {
  const choices: Array<{ name: string; value: string } | inquirer.Separator> =
    [];
  const linkedServer = rds.linked_server_id
    ? serverService.getServer(rds.linked_server_id)
    : null;

  // Tunnel controls (if linked to server)
  if (linkedServer) {
    if (tunnelActive) {
      choices.push({
        name: `${ICONS.INACTIVE}  ${chalk.red("Stop Tunnel")}`,
        value: "stop_tunnel",
      });
      choices.push({
        name: `${ICONS.CONNECT}  ${chalk.green(
          `Connect (localhost:${rds.local_port})`
        )}`,
        value: "connect",
      });
    } else {
      choices.push({
        name: `${ICONS.ACTIVE}  ${chalk.green("Start Tunnel")}`,
        value: "start_tunnel",
      });
    }
  }

  // Copy connection string
  choices.push({
    name: `${ICONS.COPY}  Copy Connection String`,
    value: "copy_connection",
  });

  // Server linking
  choices.push(
    new inquirer.Separator(chalk.dim("─── Server Link ───────────────────"))
  );

  if (linkedServer) {
    choices.push({
      name: `${ICONS.UNLINK}  Unlink from ${linkedServer.name}`,
      value: "unlink_server",
    });
  } else {
    choices.push({
      name: `${ICONS.LINK}  Link to Server (for tunneling)`,
      value: "link_server",
    });
  }

  // Edit option
  choices.push(
    new inquirer.Separator(chalk.dim("─── Settings ──────────────────────")),
    {
      name: `✏️  Edit Database`,
      value: "edit",
    }
  );

  // Danger zone
  choices.push(
    new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────")),
    {
      name: `${ICONS.DELETE}  Delete Database`,
      value: "delete",
    },
    new inquirer.Separator(chalk.dim("───────────────────────────────────")),
    {
      name: `${ICONS.BACK}  Back`,
      value: "back",
    }
  );

  return choices;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function addRDSFlow(): Promise<void> {
  console.clear();
  console.log(
    boxen(
      chalk.hex(COLORS.PRIMARY).bold(`${ICONS.ADD} Add RDS Database`),
      {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "green",
      }
    )
  );
  console.log();

  const awsProfiles = storageService.getAllAWSProfiles();

  const { method } = await inquirer.prompt({
    type: "list",
    name: "method",
    message: "How would you like to add a database?",
    choices: [
      ...(awsProfiles.length > 0
        ? [{ name: `${ICONS.AWS}  Fetch from AWS`, value: "aws" }]
        : []),
      { name: `${ICONS.ADD}  Manual Entry`, value: "manual" },
      new inquirer.Separator(),
      { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
    ],
  });

  if (method === "cancel") return;

  if (method === "aws") {
    await fetchRDSFromAWS();
  } else {
    await addRDSManually();
  }
}

async function fetchRDSFromAWS(): Promise<void> {
  const awsProfiles = storageService.getAllAWSProfiles();

  if (awsProfiles.length === 0) {
    console.log(
      chalk.yellow("\n⚠️  No AWS profiles configured. Please add one first.")
    );
    await pressEnterToContinue();
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

  // Region selection
  const { changeRegion } = await inquirer.prompt({
    type: "confirm",
    name: "changeRegion",
    message: `Fetch from ${profile.default_region}?`,
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

  // Fetch RDS instances
  const spinner = ora(`Fetching RDS instances from ${targetRegion}...`).start();
  const result = await awsService.fetchRDSInstances(profileId, targetRegion);

  if (!result.success) {
    spinner.fail(chalk.red(`Failed to fetch: ${result.error}`));
    await pressEnterToContinue();
    return;
  }

  // Filter available instances
  const availableInstances = result.instances.filter(
    (i) => i.status === "available" && i.endpoint
  );

  if (availableInstances.length === 0) {
    spinner.warn(chalk.yellow("No available RDS instances found."));
    await pressEnterToContinue();
    return;
  }

  spinner.succeed(
    chalk.green(`Found ${availableInstances.length} RDS instance(s)`)
  );
  console.log();

  // Display instances for selection
  const instanceChoices = availableInstances.map((instance) => {
    const icon = awsService.getEngineIcon(instance.engine);
    const status = instance.is_imported
      ? chalk.dim(`[${ICONS.IMPORTED} Already added]`)
      : chalk.green("[NEW]");

    return {
      name: `${icon}  ${instance.db_instance_identifier} ${chalk.dim(
        `(${instance.engine})`
      )} ${status}`,
      value: instance.db_instance_identifier,
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
    message: "Select an RDS instance to import:",
    choices: instanceChoices,
    pageSize: 15,
  });

  if (selectedInstance === "cancel") return;

  const instance = availableInstances.find(
    (i) => i.db_instance_identifier === selectedInstance
  );
  if (!instance) return;

  // Show instance details
  const engineIcon = awsService.getEngineIcon(instance.engine);
  const engineName = awsService.getEngineDisplayName(instance.engine);

  console.log();
  console.log(
    boxen(
      [
        chalk
          .hex(COLORS.PRIMARY)
          .bold(`${engineIcon} ${instance.db_instance_identifier}`),
        "",
        chalk.dim("Engine: ") +
        chalk.white(`${engineName} ${instance.engine_version}`),
        chalk.dim("Endpoint: ") + chalk.white(instance.endpoint || "N/A"),
        chalk.dim("Port: ") + chalk.white(instance.port.toString()),
        chalk.dim("Database: ") + chalk.white(instance.db_name || "N/A"),
        chalk.dim("Username: ") +
        chalk.white(instance.master_username || "N/A"),
        chalk.dim("Class: ") + chalk.white(instance.db_instance_class),
        chalk.dim("Storage: ") +
        chalk.white(`${instance.allocated_storage} GB`),
        chalk.dim("Multi-AZ: ") + chalk.white(instance.multi_az ? "Yes" : "No"),
      ].join("\n"),
      {
        padding: 1,
        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );
  console.log();

  // Get alias name
  const { name } = await inquirer.prompt({
    type: "input",
    name: "name",
    message: "Database alias (friendly name):",
    default: instance.db_instance_identifier,
    validate: (input: string) => (input.trim() ? true : "Name is required"),
  });

  // Get local port for tunneling
  const defaultPort = awsService.getDefaultPort(instance.engine);
  const { localPort } = await inquirer.prompt({
    type: "input",
    name: "localPort",
    message: "Local port for tunnel:",
    default: defaultPort.toString(),
    validate: (input: string) => {
      const port = parseInt(input);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return "Enter a valid port (1024-65535)";
      }
      return true;
    },
  });

  // Save the RDS instance
  const activeProfile = profileService.getActiveProfile();
  if (!activeProfile) return;

  const newRDS: IRDSInstance = {
    id: nanoid(),
    name: name.trim(),
    profile_id: activeProfile.id,
    aws_profile_id: profileId,
    db_instance_identifier: instance.db_instance_identifier,
    endpoint: instance.endpoint || "",
    port: instance.port,
    engine: instance.engine,
    engine_version: instance.engine_version,
    db_name: instance.db_name,
    master_username: instance.master_username,
    status: instance.status,
    vpc_id: instance.vpc_id,
    aws_region: targetRegion,
    local_port: parseInt(localPort),
    created_at: new Date().toISOString(),
  };

  storageService.saveRDSInstance(newRDS);

  console.log(
    chalk.green(`\n${UI.ICONS.SUCCESS} Database "${name}" added successfully!`)
  );

  // Ask if they want to link to a server
  const servers = serverService.listServers();
  if (servers.length > 0) {
    const { linkNow } = await inquirer.prompt({
      type: "confirm",
      name: "linkNow",
      message: "Link to a server for tunneling?",
      default: true,
    });

    if (linkNow) {
      await linkServerFlow(newRDS);
    }
  }

  await pressEnterToContinue();
}

async function addRDSManually(): Promise<void> {
  const awsProfiles = storageService.getAllAWSProfiles();

  if (awsProfiles.length === 0) {
    console.log(
      chalk.yellow("\n⚠️  No AWS profiles configured. Please add one first.")
    );
    await pressEnterToContinue();
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Database alias (friendly name):",
      validate: (i: string) => (i.trim() ? true : "Required"),
    },
    {
      type: "list",
      name: "awsProfileId",
      message: "AWS Profile:",
      choices: awsProfiles.map((p) => ({
        name: `${ICONS.AWS} ${p.name}`,
        value: p.id,
      })),
    },
    {
      type: "list",
      name: "engine",
      message: "Database Engine:",
      choices: [
        { name: `${ICONS.POSTGRES} PostgreSQL`, value: "postgres" },
        { name: `${ICONS.MYSQL} MySQL`, value: "mysql" },
        { name: `${ICONS.MYSQL} MariaDB`, value: "mariadb" },
        {
          name: `${ICONS.POSTGRES} Aurora PostgreSQL`,
          value: "aurora-postgresql",
        },
        { name: `${ICONS.MYSQL} Aurora MySQL`, value: "aurora-mysql" },
      ],
    },
    {
      type: "input",
      name: "endpoint",
      message: "RDS Endpoint:",
      validate: (i: string) => (i.trim() ? true : "Required"),
    },
    {
      type: "input",
      name: "port",
      message: "Port:",
      default: (answers: { engine: string }) =>
        awsService.getDefaultPort(answers.engine).toString(),
      validate: (i: string) => (!isNaN(parseInt(i)) ? true : "Invalid port"),
    },
    {
      type: "input",
      name: "dbName",
      message: "Database Name (optional):",
    },
    {
      type: "input",
      name: "username",
      message: "Master Username (optional):",
    },
    {
      type: "input",
      name: "identifier",
      message: "Instance Identifier:",
      validate: (i: string) => (i.trim() ? true : "Required"),
    },
    {
      type: "list",
      name: "region",
      message: "AWS Region:",
      choices: AWS_REGIONS.map((r) => ({
        name: `${r.value} - ${r.name}`,
        value: r.value,
      })),
      pageSize: 12,
    },
    {
      type: "input",
      name: "localPort",
      message: "Local port for tunnel:",
      default: (answers: { engine: string }) =>
        awsService.getDefaultPort(answers.engine).toString(),
      validate: (i: string) => {
        const port = parseInt(i);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return "Enter a valid port (1024-65535)";
        }
        return true;
      },
    },
  ]);

  const activeProfile = profileService.getActiveProfile();
  if (!activeProfile) return;

  const newRDS: IRDSInstance = {
    id: nanoid(),
    name: answers.name.trim(),
    profile_id: activeProfile.id,
    aws_profile_id: answers.awsProfileId,
    db_instance_identifier: answers.identifier.trim(),
    endpoint: answers.endpoint.trim(),
    port: parseInt(answers.port),
    engine: answers.engine as TRDSEngine,
    engine_version: "",
    db_name: answers.dbName.trim() || undefined,
    master_username: answers.username.trim() || undefined,
    status: "available",
    aws_region: answers.region,
    local_port: parseInt(answers.localPort),
    created_at: new Date().toISOString(),
  };

  storageService.saveRDSInstance(newRDS);

  console.log(
    chalk.green(
      `\n${UI.ICONS.SUCCESS} Database "${answers.name}" added successfully!`
    )
  );
  await pressEnterToContinue();
}

async function linkServerFlow(rds: IRDSInstance): Promise<void> {
  const servers = serverService.listServers();

  if (servers.length === 0) {
    console.log(
      chalk.yellow("\n⚠️  No servers configured. Add a server first.")
    );
    await pressEnterToContinue();
    return;
  }

  const { serverId } = await inquirer.prompt({
    type: "list",
    name: "serverId",
    message: "Select a server to link (for SSH tunneling):",
    choices: [
      ...servers.map((s) => ({
        name: `${ICONS.SERVER}  ${s.name} ${chalk.dim(
          `(${s.username}@${s.host})`
        )}`,
        value: s.id,
      })),
      new inquirer.Separator(),
      { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
    ],
  });

  if (serverId === "cancel") return;

  const server = serverService.getServer(serverId);
  if (!server) return;

  // Create a tunnel configuration for this server
  const tunnelName = `${rds.name}-tunnel`;

  await serverService.addTunnel(serverId, {
    name: tunnelName,
    type: "rds",
    localPort: rds.local_port || rds.port,
    remoteHost: rds.endpoint,
    remotePort: rds.port,
    metadata: {
      dbUsername: rds.master_username,
      dbName: rds.db_name,
    },
  });

  // Get the created tunnel
  const updatedServer = serverService.getServer(serverId);
  const createdTunnel = updatedServer?.tunnels?.find(
    (t) => t.name === tunnelName
  );

  // Update RDS with linked server and tunnel
  storageService.updateRDSInstance(rds.id, {
    linked_server_id: serverId,
    linked_tunnel_id: createdTunnel?.id,
    local_port: rds.local_port || rds.port,
  });

  console.log(
    chalk.green(
      `\n${UI.ICONS.SUCCESS} Linked to ${server.name}. Tunnel "${tunnelName}" created.`
    )
  );
  await pressEnterToContinue();
}

async function unlinkServerFlow(rds: IRDSInstance): Promise<void> {
  const server = rds.linked_server_id
    ? serverService.getServer(rds.linked_server_id)
    : null;

  if (!server) {
    console.log(chalk.yellow("\nServer not found."));
    await pressEnterToContinue();
    return;
  }

  const { confirm } = await inquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: `Unlink from ${server.name} and remove the tunnel?`,
    default: false,
  });

  if (!confirm) return;

  // Stop tunnel if running
  if (rds.linked_tunnel_id) {
    const processes = storageService.getAllProcesses();
    const tunnelProcess = processes.find(
      (p) => p.tunnelId === rds.linked_tunnel_id
    );
    if (tunnelProcess) {
      await serverService.killProcess(tunnelProcess.pid);
    }

    // Remove tunnel from server
    await serverService.deleteTunnel(
      rds.linked_server_id!,
      rds.linked_tunnel_id!
    );
  }

  // Update RDS
  storageService.updateRDSInstance(rds.id, {
    linked_server_id: undefined,
    linked_tunnel_id: undefined,
  });

  console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Server unlinked.`));
  await pressEnterToContinue();
}

async function startTunnel(rds: IRDSInstance): Promise<void> {
  if (!rds.linked_server_id || !rds.linked_tunnel_id) {
    console.log(chalk.yellow("\nNo server linked. Link a server first."));
    await pressEnterToContinue();
    return;
  }

  const spinner = ora("Starting tunnel...").start();

  try {
    await serverService.startTunnel(rds.linked_server_id, rds.linked_tunnel_id);
    spinner.succeed(
      chalk.green(`Tunnel started! Connect to localhost:${rds.local_port}`)
    );

    // Update last connected
    storageService.updateRDSInstance(rds.id, {
      last_connected: new Date().toISOString(),
    });
  } catch (error) {
    spinner.fail(chalk.red("Failed to start tunnel"));
  }

  await pressEnterToContinue();
}

async function stopTunnel(rds: IRDSInstance): Promise<void> {
  if (!rds.linked_tunnel_id) return;

  const processes = storageService.getAllProcesses();
  const tunnelProcess = processes.find(
    (p) => p.tunnelId === rds.linked_tunnel_id
  );

  if (!tunnelProcess) {
    console.log(chalk.yellow("\nTunnel is not running."));
    await pressEnterToContinue();
    return;
  }

  await serverService.killProcess(tunnelProcess.pid);
  console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Tunnel stopped.`));
  await pressEnterToContinue();
}

async function connectToRDS(rds: IRDSInstance): Promise<void> {
  const host = rds.linked_server_id
    ? `localhost:${rds.local_port}`
    : rds.endpoint;

  console.log(
    boxen(
      [
        chalk.hex(COLORS.PRIMARY).bold("Connection Info"),
        "",
        chalk.dim("Host: ") + chalk.white(host),
        chalk.dim("Port: ") +
        chalk.white(rds.local_port?.toString() || rds.port.toString()),
        chalk.dim("Database: ") + chalk.white(rds.db_name || "N/A"),
        chalk.dim("Username: ") + chalk.white(rds.master_username || "N/A"),
      ].join("\n"),
      {
        padding: 1,
        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );

  await pressEnterToContinue();
}

async function copyConnectionString(rds: IRDSInstance): Promise<void> {
  const host = rds.linked_server_id ? "localhost" : rds.endpoint;
  const port = rds.linked_server_id ? rds.local_port : rds.port;

  let connectionString = "";

  if (rds.engine.includes("postgres") || rds.engine === "aurora-postgresql") {
    connectionString = `postgresql://${rds.master_username || "user"
      }@${host}:${port}/${rds.db_name || "database"}`;
  } else if (
    rds.engine.includes("mysql") ||
    rds.engine === "aurora-mysql" ||
    rds.engine === "mariadb"
  ) {
    connectionString = `mysql://${rds.master_username || "user"
      }@${host}:${port}/${rds.db_name || "database"}`;
  } else {
    connectionString = `${host}:${port}`;
  }

  await clipboard.write(connectionString);
  console.log(chalk.green(`\n${ICONS.COPY} Connection string copied!`));
  console.log(chalk.dim(connectionString));
  await pressEnterToContinue();
}

async function editRDSFlow(rds: IRDSInstance): Promise<void> {
  console.clear();
  console.log(
    boxen(chalk.hex(COLORS.PRIMARY).bold(`✏️ Edit Database`), {
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
      message: chalk.hex(COLORS.SECONDARY)("Database Alias:"),
      default: rds.name,
      validate: (input: string) =>
        input.trim().length > 0 || "Name is required",
    },
    {
      type: "input",
      name: "endpoint",
      message: chalk.hex(COLORS.SECONDARY)("RDS Endpoint:"),
      default: rds.endpoint,
      validate: (input: string) =>
        input.trim().length > 0 || "Endpoint is required",
    },
    {
      type: "number",
      name: "port",
      message: chalk.hex(COLORS.SECONDARY)("Port:"),
      default: rds.port,
      validate: (input: number) =>
        (input > 0 && input < 65536) || "Invalid port",
    },
    {
      type: "input",
      name: "db_name",
      message: chalk.hex(COLORS.SECONDARY)("Database Name (optional):"),
      default: rds.db_name || "",
    },
    {
      type: "input",
      name: "master_username",
      message: chalk.hex(COLORS.SECONDARY)("Master Username (optional):"),
      default: rds.master_username || "",
    },
    {
      type: "number",
      name: "local_port",
      message: chalk.hex(COLORS.SECONDARY)("Local Tunnel Port:"),
      default: rds.local_port || rds.port,
      validate: (input: number) =>
        (input > 0 && input < 65536) || "Invalid port",
    },
  ]);

  storageService.updateRDSInstance(rds.id, {
    name: answers.name.trim(),
    endpoint: answers.endpoint.trim(),
    port: answers.port,
    db_name: answers.db_name.trim() || undefined,
    master_username: answers.master_username.trim() || undefined,
    local_port: answers.local_port,
  });

  // If linked to a server, update the tunnel as well
  if (rds.linked_server_id && rds.linked_tunnel_id) {
    await serverService.updateTunnel(
      rds.linked_server_id,
      rds.linked_tunnel_id,
      {
        remoteHost: answers.endpoint.trim(),
        remotePort: answers.port,
        localPort: answers.local_port,
      }
    );
  }

  console.log(
    chalk.green(`\n${UI.ICONS.SUCCESS} Database updated successfully!`)
  );
  await pressEnterToContinue();
}

async function deleteRDSFlow(rds: IRDSInstance): Promise<boolean> {
  // Stop tunnel if running
  if (rds.linked_tunnel_id) {
    const processes = storageService.getAllProcesses();
    const tunnelProcess = processes.find(
      (p) => p.tunnelId === rds.linked_tunnel_id
    );
    if (tunnelProcess) {
      console.log(chalk.yellow("\n⚠️  This database has an active tunnel."));
    }
  }

  const { confirm } = await inquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: chalk.red(`Delete database "${rds.name}"?`),
    default: false,
  });

  if (!confirm) return false;

  // Stop tunnel if running
  if (rds.linked_tunnel_id) {
    const processes = storageService.getAllProcesses();
    const tunnelProcess = processes.find(
      (p) => p.tunnelId === rds.linked_tunnel_id
    );
    if (tunnelProcess) {
      await serverService.killProcess(tunnelProcess.pid);
    }

    // Remove tunnel from server
    if (rds.linked_server_id && rds.linked_tunnel_id) {
      await serverService.deleteTunnel(
        rds.linked_server_id,
        rds.linked_tunnel_id
      );
    }
  }

  storageService.deleteRDSInstance(rds.id);
  console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Database deleted.`));
  await pressEnterToContinue();
  return true;
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

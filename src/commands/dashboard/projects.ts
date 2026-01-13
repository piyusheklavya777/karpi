// src/commands/dashboard/projects.ts
// Projects Dashboard Module for Karpi CLI

import inquirer from "inquirer";
import boxen from "boxen";
import chalk from "chalk";
import path from "path";
import { format } from "date-fns";
import { projectService } from "../../services/project.service";
import { processService } from "../../services/process.service";
import { serverService } from "../../services/server.service";
import { storageService } from "../../services/storage.service";
import { UI, COLORS } from "../../config/constants";
import type {
    IProject,
    IApp,
    ICommand,
    IDetectedApp,
    TAppType,
    IBackgroundProcess,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════════
// UI Constants
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
    PROJECT: "📁",
    APP: "📦",
    NEXTJS: "▲",
    EXPRESS: "⚡",
    TUNNEL: "🚇",
    CUSTOM: "🔧",
    COMMAND: "⚙️",
    RUNNING: "🟢",
    STOPPED: "⚫",
    ADD: "➕",
    DELETE: "🗑️",
    BACK: "◀",
    PLAY: "▶",
    STOP: "⏹",
    LINK: "🔗",
    SEQUENCE: "📋",
    DELAY: "⏱️",
} as const;

const BOX_CHARS = {
    HORIZONTAL: "─",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Main Projects Menu
// ═══════════════════════════════════════════════════════════════════════════════

export async function projectsMenu(): Promise<void> {
    let running = true;

    while (running) {
        console.clear();
        displayHeader();

        const projects = projectService.listProjects();

        if (projects.length === 0) {
            displayEmptyState();
        }

        const choices = buildMainMenuChoices(projects);

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
        } else if (action === "add_project") {
            await addProjectFlow();
        } else if (action.startsWith("project:")) {
            const projectId = action.replace("project:", "");
            await projectActionsMenu(projectId);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Project Actions Menu
// ═══════════════════════════════════════════════════════════════════════════════

async function projectActionsMenu(projectId: string): Promise<void> {
    let running = true;

    while (running) {
        console.clear();

        const project = projectService.getProject(projectId);
        if (!project) {
            running = false;
            continue;
        }

        displayProjectHeader(project);
        displayProjectDetails(project);

        const choices = buildProjectActionsChoices(project);

        const { action } = await inquirer.prompt([
            {
                type: "list",
                name: "action",
                message: chalk.hex(COLORS.SECONDARY)("Action:"),
                choices,
                pageSize: 18,
            },
        ]);

        switch (action) {
            case "add_app":
                await addAppFlow(projectId);
                break;
            case "add_command":
                await addProjectCommandFlow(projectId);
                break;
            case "delete_project":
                const deleted = await deleteProjectFlow(projectId);
                if (deleted) running = false;
                break;
            case "back":
                running = false;
                break;
            default:
                if (action.startsWith("app:")) {
                    const appId = action.replace("app:", "");
                    await appActionsMenu(projectId, appId);
                } else if (action.startsWith("cmd:")) {
                    const commandId = action.replace("cmd:", "");
                    await projectCommandActionsMenu(projectId, commandId);
                }
                break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// App Actions Menu
// ═══════════════════════════════════════════════════════════════════════════════

async function appActionsMenu(projectId: string, appId: string): Promise<void> {
    let running = true;

    while (running) {
        console.clear();

        const project = projectService.getProject(projectId);
        const app = project?.apps.find((a) => a.id === appId);
        if (!project || !app) {
            running = false;
            continue;
        }

        displayAppHeader(project, app);

        const choices = buildAppActionsChoices(project, app);

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
            case "add_command":
                await addAppCommandFlow(projectId, appId);
                break;
            case "delete_app":
                const deleted = await deleteAppFlow(projectId, appId);
                if (deleted) running = false;
                break;
            case "back":
                running = false;
                break;
            default:
                if (action.startsWith("cmd:")) {
                    const commandId = action.replace("cmd:", "");
                    await appCommandActionsMenu(projectId, appId, commandId);
                }
                break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command Actions Menus
// ═══════════════════════════════════════════════════════════════════════════════

async function appCommandActionsMenu(
    projectId: string,
    appId: string,
    commandId: string
): Promise<void> {
    const project = projectService.getProject(projectId);
    const app = project?.apps.find((a) => a.id === appId);
    const command = app?.commands.find((c) => c.id === commandId);
    if (!project || !app || !command) return;

    const proc = processService.getCommandProcess(commandId);
    const isRunning = !!proc;

    console.clear();
    displayCommandHeader(command, isRunning, proc);

    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    if (isRunning) {
        choices.push(
            {
                name: `${ICONS.STOP}  ${chalk.red("Stop Command")}`,
                value: "stop",
            },
            {
                name: `${ICONS.PLAY}  ${chalk.yellow("Restart Command")}`,
                value: "restart",
            }
        );
    } else {
        choices.push({
            name: `${ICONS.PLAY}  ${chalk.green("Run Command")}`,
            value: "run",
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("─────────────────────")),
        { name: `${ICONS.DELETE}  ${chalk.red("Delete Command")}`, value: "delete" },
        new inquirer.Separator(chalk.dim("─────────────────────")),
        { name: `${ICONS.BACK}  Back`, value: "back" }
    );

    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: chalk.hex(COLORS.SECONDARY)("Command Action:"),
            choices,
        },
    ]);

    switch (action) {
        case "run":
            await runAppCommand(projectId, appId, commandId);
            break;
        case "restart":
            if (proc) await stopCommand(proc.pid);
            await runAppCommand(projectId, appId, commandId);
            break;
        case "stop":
            if (proc) await stopCommand(proc.pid);
            break;
        case "delete":
            await deleteAppCommand(projectId, appId, commandId);
            break;
    }
}

async function projectCommandActionsMenu(
    projectId: string,
    commandId: string
): Promise<void> {
    const project = projectService.getProject(projectId);
    const command = project?.commands.find((c) => c.id === commandId);
    if (!project || !command) return;

    const proc = processService.getCommandProcess(commandId);
    const isRunning = !!proc;

    console.clear();
    displayCommandHeader(command, isRunning, proc);

    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    if (isRunning) {
        choices.push(
            {
                name: `${ICONS.STOP}  ${chalk.red("Stop Command")}`,
                value: "stop",
            },
            {
                name: `${ICONS.PLAY}  ${chalk.yellow("Restart Command")}`,
                value: "restart",
            }
        );
    } else {
        choices.push({
            name: `${ICONS.PLAY}  ${chalk.green("Run Command")}`,
            value: "run",
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("─────────────────────")),
        { name: `${ICONS.DELETE}  ${chalk.red("Delete Command")}`, value: "delete" },
        new inquirer.Separator(chalk.dim("─────────────────────")),
        { name: `${ICONS.BACK}  Back`, value: "back" }
    );

    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: chalk.hex(COLORS.SECONDARY)("Command Action:"),
            choices,
        },
    ]);

    switch (action) {
        case "run":
            await runProjectCommand(projectId, commandId);
            break;
        case "restart":
            if (proc) await stopCommand(proc.pid);
            await runProjectCommand(projectId, commandId);
            break;
        case "stop":
            if (proc) await stopCommand(proc.pid);
            break;
        case "delete":
            projectService.deleteProjectCommand(projectId, commandId);
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Functions
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader(): void {
    const title = chalk.bold.hex(COLORS.PRIMARY)(
        `${ICONS.PROJECT}  Project Management`
    );
    const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

    console.log("\n" + border);
    console.log(title);
    console.log(border + "\n");
}

function displayEmptyState(): void {
    console.log(
        boxen(
            chalk.hex(COLORS.SECONDARY)("No projects configured yet.\n\n") +
            chalk.dim("Press ") +
            chalk.white("↓") +
            chalk.dim(" to select ") +
            chalk.hex(COLORS.PRIMARY)('"Add New Project"') +
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

function displayProjectHeader(project: IProject): void {
    const runningCount = processService.getProjectProcesses(project.id).length;
    const statusBadge =
        runningCount > 0
            ? chalk.bgGreen.black(` ${runningCount} RUNNING `)
            : chalk.bgGray.white(" IDLE ");

    const title = `${ICONS.PROJECT}  ${chalk.bold.hex(COLORS.PRIMARY)(
        project.name
    )}  ${statusBadge}`;
    const subtitle = chalk.dim(project.base_path);
    const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

    console.log("\n" + border);
    console.log(title);
    console.log(subtitle);
    console.log(border + "\n");
}

function displayProjectDetails(project: IProject): void {
    const infoLines = [
        `${chalk.dim("Path:")}       ${chalk.white(project.base_path)}`,
        `${chalk.dim("Apps:")}       ${chalk.white(project.apps.length.toString())}`,
        `${chalk.dim("Commands:")}   ${chalk.white(project.commands.length.toString())}`,
        `${chalk.dim("Created:")}    ${chalk.white(
            format(new Date(project.created_at), "PP")
        )}`,
    ];

    console.log(
        boxen(infoLines.join("\n"), {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            margin: { top: 0, bottom: 1, left: 2, right: 2 },
            borderStyle: "round",
            borderColor: "gray",
            title: chalk.dim("Project Info"),
            titleAlignment: "left",
        })
    );
}

function displayAppHeader(project: IProject, app: IApp): void {
    const runningCount = processService.getAppProcesses(app.id).length;
    const statusBadge =
        runningCount > 0
            ? chalk.bgGreen.black(` ${runningCount} RUNNING `)
            : chalk.bgGray.white(" IDLE ");

    const typeIcon = getAppTypeIcon(app.type);
    const title = `${typeIcon}  ${chalk.bold.hex(COLORS.SECONDARY)(
        app.name
    )}  ${statusBadge}`;
    const subtitle = chalk.dim(`${project.name} > ${app.relative_path}`);
    const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

    console.log("\n" + border);
    console.log(title);
    console.log(subtitle);
    console.log(border + "\n");
}

function displayCommandHeader(
    command: ICommand,
    isRunning: boolean,
    proc?: IBackgroundProcess
): void {
    const statusBadge = isRunning
        ? chalk.bgGreen.black(" RUNNING ")
        : chalk.bgGray.white(" STOPPED ");

    const typeLabel = command.type === "sequence" ? "Sequence" : "Direct";
    const title = `${ICONS.COMMAND}  ${chalk.bold.hex(COLORS.PRIMARY)(
        command.name
    )}  ${statusBadge}`;
    const border = chalk.hex(COLORS.SECONDARY)(BOX_CHARS.HORIZONTAL.repeat(50));

    console.log("\n" + border);
    console.log(title);
    console.log(chalk.dim(`Type: ${typeLabel}`));
    if (command.command) {
        console.log(chalk.dim(`Command: ${command.command}`));
    }
    if (isRunning && proc) {
        console.log(chalk.dim(`PID: ${proc.pid}`));
    }
    console.log(border + "\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Menu Builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildMainMenuChoices(
    projects: IProject[]
): Array<{ name: string; value: string } | inquirer.Separator> {
    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    if (projects.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Projects ──────────────────────"))
        );

        projects.forEach((project) => {
            const runningCount = processService.getProjectProcesses(project.id).length;
            const statusIcon = runningCount > 0 ? ICONS.RUNNING : ICONS.STOPPED;
            const appsCount = project.apps.length;

            let displayName = `${ICONS.PROJECT}  ${chalk.bold(project.name)}`;
            displayName += chalk.dim(` (${appsCount} apps)`);
            displayName += `  ${statusIcon}`;
            if (runningCount > 0) {
                displayName += chalk.dim(` ${runningCount} running`);
            }

            choices.push({
                name: displayName,
                value: `project:${project.id}`,
            });
        });
    }

    choices.push(
        new inquirer.Separator(chalk.dim("─── Actions ───────────────────────")),
        {
            name: `${ICONS.ADD}  Add New Project`,
            value: "add_project",
        },
        new inquirer.Separator(chalk.dim("───────────────────────────────────")),
        {
            name: `${ICONS.BACK}  Back to Dashboard`,
            value: "back",
        }
    );

    return choices;
}

function buildProjectActionsChoices(
    project: IProject
): Array<{ name: string; value: string } | inquirer.Separator> {
    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    // Apps section
    if (project.apps.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Apps ──────────────────────────"))
        );

        project.apps.forEach((app) => {
            const runningCount = processService.getAppProcesses(app.id).length;
            const statusIcon = runningCount > 0 ? ICONS.RUNNING : ICONS.STOPPED;
            const typeIcon = getAppTypeIcon(app.type);

            let displayName = `${typeIcon}  ${chalk.bold(app.name)}`;
            displayName += chalk.dim(` (${app.type})`);
            displayName += `  ${statusIcon}`;

            choices.push({
                name: displayName,
                value: `app:${app.id}`,
            });
        });
    }

    choices.push({
        name: `${ICONS.ADD}  Add App`,
        value: "add_app",
    });

    // Project commands section
    if (project.commands.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Commands ──────────────────────"))
        );

        project.commands.forEach((cmd) => {
            const proc = processService.getCommandProcess(cmd.id);
            const isRunning = !!proc;
            const statusIcon = isRunning ? ICONS.RUNNING : ICONS.STOPPED;
            const typeIcon = cmd.type === "sequence" ? ICONS.SEQUENCE : ICONS.COMMAND;

            let displayName = `${typeIcon}  ${chalk.bold(cmd.name)}`;

            if (isRunning && proc) {
                displayName += `  ${chalk.green.bold("(running)")}`;
                if (proc.lastPolledAt) {
                    const polledAgo = Math.round((Date.now() - new Date(proc.lastPolledAt).getTime()) / 1000);
                    displayName += chalk.dim(` polled ${polledAgo}s ago`);
                }
            } else {
                displayName += `  ${statusIcon}`;
            }

            choices.push({
                name: displayName,
                value: `cmd:${cmd.id}`,
            });
        });
    }

    choices.push({
        name: `${ICONS.ADD}  Add Project Command`,
        value: "add_command",
    });

    // Actions
    choices.push(
        new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────")),
        {
            name: `${ICONS.DELETE}  Delete Project`,
            value: "delete_project",
        },
        new inquirer.Separator(chalk.dim("───────────────────────────────────")),
        {
            name: `${ICONS.BACK}  Back to Projects`,
            value: "back",
        }
    );

    return choices;
}

function buildAppActionsChoices(
    _project: IProject,
    app: IApp
): Array<{ name: string; value: string } | inquirer.Separator> {
    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    // Commands section
    if (app.commands.length > 0) {
        choices.push(
            new inquirer.Separator(chalk.dim("─── Commands ──────────────────────"))
        );

        app.commands.forEach((cmd) => {
            const proc = processService.getCommandProcess(cmd.id);
            const isRunning = !!proc;
            const statusIcon = isRunning ? ICONS.RUNNING : ICONS.STOPPED;
            const typeIcon = cmd.type === "sequence" ? ICONS.SEQUENCE : ICONS.COMMAND;

            let displayName = `${typeIcon}  ${chalk.bold(cmd.name)}`;
            if (cmd.command) {
                displayName += chalk.dim(` (${cmd.command})`);
            }

            if (isRunning && proc) {
                displayName += `  ${chalk.green.bold("(running)")}`;
                // Show polled time if available
                if (proc.lastPolledAt) {
                    const polledAgo = Math.round((Date.now() - new Date(proc.lastPolledAt).getTime()) / 1000);
                    displayName += chalk.dim(` polled ${polledAgo}s ago`);
                }
            } else {
                displayName += `  ${statusIcon}`;
            }

            choices.push({
                name: displayName,
                value: `cmd:${cmd.id}`,
            });
        });
    }

    choices.push({
        name: `${ICONS.ADD}  Add Command`,
        value: "add_command",
    });

    // Actions
    choices.push(
        new inquirer.Separator(chalk.dim("─── Danger Zone ───────────────────")),
        {
            name: `${ICONS.DELETE}  Delete App`,
            value: "delete_app",
        },
        new inquirer.Separator(chalk.dim("───────────────────────────────────")),
        {
            name: `${ICONS.BACK}  Back to Project`,
            value: "back",
        }
    );

    return choices;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flow Functions
// ═══════════════════════════════════════════════════════════════════════════════

async function addProjectFlow(): Promise<void> {
    console.clear();
    console.log(
        chalk.bold.hex(COLORS.PRIMARY)("\n" + ICONS.ADD + "  Add New Project\n")
    );

    const { basePath } = await inquirer.prompt([
        {
            type: "input",
            name: "basePath",
            message: "Project folder path:",
            validate: (input: string) => input.length > 0 || "Path is required",
        },
    ]);

    // Expand ~ to home directory
    const expandedPath = basePath.startsWith("~/")
        ? path.join(process.env.HOME || "", basePath.slice(2))
        : basePath;

    const absolutePath = path.resolve(expandedPath);
    const defaultName = path.basename(absolutePath);

    const { name } = await inquirer.prompt([
        {
            type: "input",
            name: "name",
            message: "Project name:",
            default: defaultName,
            validate: (input: string) => input.length > 0 || "Name is required",
        },
    ]);

    const project = projectService.createProject(name, absolutePath);

    if (project) {
        console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Project "${name}" created!`));

        // Ask if user wants to detect and add apps
        const { detectApps } = await inquirer.prompt([
            {
                type: "confirm",
                name: "detectApps",
                message: "Scan for apps in this project?",
                default: true,
            },
        ]);

        if (detectApps) {
            await scanAndAddApps(project.id, absolutePath);
        }
    }

    await waitForEnter();
}

async function scanAndAddApps(projectId: string, basePath: string): Promise<void> {
    console.log(chalk.dim("\nScanning for apps..."));

    const detected = await projectService.detectApps(basePath);

    if (detected.length === 0) {
        console.log(chalk.yellow("No apps detected."));
        return;
    }

    console.log(chalk.green(`Found ${detected.length} app(s):\n`));

    // Show detected apps and let user select which to import
    const choices = detected.map((app) => ({
        name: `${getAppTypeIcon(app.type)} ${app.name} (${app.relativePath}) - ${app.type}`,
        value: app,
        checked: false,
    }));

    const { selectedApps } = await inquirer.prompt([
        {
            type: "checkbox",
            name: "selectedApps",
            message: "Select apps to import:",
            choices,
        },
    ]);

    for (const app of selectedApps as IDetectedApp[]) {
        const addedApp = projectService.addApp(projectId, {
            name: app.name,
            type: app.type,
            relative_path: app.relativePath,
        });

        // Prompt user to add commands from detected scripts
        if (addedApp && app.scripts.length > 0) {
            await promptToAddCommands(projectId, addedApp.id, app.scripts);
        }
    }

    console.log(chalk.green(`\nImported ${selectedApps.length} app(s)`));
}

async function addAppFlow(projectId: string): Promise<void> {
    const project = projectService.getProject(projectId);
    if (!project) return;

    console.clear();
    console.log(
        chalk.bold.hex(COLORS.PRIMARY)("\n" + ICONS.ADD + "  Add App\n")
    );

    // Offer to detect or manual
    const { method } = await inquirer.prompt([
        {
            type: "list",
            name: "method",
            message: "How would you like to add an app?",
            choices: [
                { name: `${ICONS.ADD}  Detect from project`, value: "detect" },
                { name: `${ICONS.CUSTOM}  Manual entry`, value: "manual" },
                { name: `${ICONS.TUNNEL}  Database Tunnel`, value: "tunnel" },
                new inquirer.Separator(),
                { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
            ],
        },
    ]);

    if (method === "cancel") return;

    if (method === "detect") {
        const detected = await projectService.detectApps(project.base_path);

        if (detected.length === 0) {
            console.log(chalk.yellow("\nNo new apps detected."));
            await waitForEnter();
            return;
        }

        // Filter out already added apps
        const existingPaths = project.apps.map((a) => a.relative_path);
        const newApps = detected.filter((d) => !existingPaths.includes(d.relativePath));

        if (newApps.length === 0) {
            console.log(chalk.yellow("\nAll detected apps are already added."));
            await waitForEnter();
            return;
        }

        const { selectedApp } = await inquirer.prompt([
            {
                type: "list",
                name: "selectedApp",
                message: "Select an app to add:",
                choices: [
                    ...newApps.map((app) => ({
                        name: `${getAppTypeIcon(app.type)} ${app.name} (${app.relativePath})`,
                        value: app,
                    })),
                    new inquirer.Separator(),
                    { name: `${ICONS.BACK}  Cancel`, value: null },
                ],
            },
        ]);

        if (!selectedApp) return;

        const app = projectService.addApp(projectId, {
            name: selectedApp.name,
            type: selectedApp.type,
            relative_path: selectedApp.relativePath,
        });

        if (app) {
            console.log(chalk.green(`\n${UI.ICONS.SUCCESS} App "${app.name}" added!`));
            await promptToAddCommands(projectId, app.id, selectedApp.scripts);
        }
    } else if (method === "manual") {
        const answers = await inquirer.prompt([
            {
                type: "input",
                name: "relativePath",
                message: "Relative path (from project root):",
                default: ".",
            },
            {
                type: "input",
                name: "name",
                message: "App name:",
                validate: (input: string) => input.length > 0 || "Name is required",
            },
            {
                type: "list",
                name: "type",
                message: "App type:",
                choices: [
                    { name: `${ICONS.NEXTJS} Next.js`, value: "nextjs" },
                    { name: `${ICONS.EXPRESS} Express.js`, value: "expressjs" },
                    { name: `${ICONS.CUSTOM} Custom`, value: "custom" },
                ],
            },
        ]);

        projectService.addApp(projectId, {
            name: answers.name,
            type: answers.type,
            relative_path: answers.relativePath,
        });

        console.log(chalk.green(`\n${UI.ICONS.SUCCESS} App added!`));
    } else if (method === "tunnel") {
        await addTunnelAppFlow(projectId);
    }

    await waitForEnter();
}

async function addTunnelAppFlow(projectId: string): Promise<void> {
    const servers = serverService.listServers();

    if (servers.length === 0) {
        console.log(chalk.yellow("\nNo servers configured. Add a server first."));
        return;
    }

    const serversWithTunnels = servers.filter(
        (s) => s.tunnels && s.tunnels.length > 0
    );

    if (serversWithTunnels.length === 0) {
        console.log(chalk.yellow("\nNo servers with tunnels configured."));
        return;
    }

    const { serverId } = await inquirer.prompt([
        {
            type: "list",
            name: "serverId",
            message: "Select server:",
            choices: serversWithTunnels.map((s) => ({
                name: `${s.name} (${s.tunnels?.length} tunnels)`,
                value: s.id,
            })),
        },
    ]);

    const server = servers.find((s) => s.id === serverId);
    if (!server || !server.tunnels) return;

    const { tunnelId } = await inquirer.prompt([
        {
            type: "list",
            name: "tunnelId",
            message: "Select tunnel:",
            choices: server.tunnels.map((t) => ({
                name: `${t.name} (${t.localPort} -> ${t.remoteHost}:${t.remotePort})`,
                value: t.id,
            })),
        },
    ]);

    const tunnel = server.tunnels.find((t) => t.id === tunnelId);
    if (!tunnel) return;

    const { name } = await inquirer.prompt([
        {
            type: "input",
            name: "name",
            message: "App name:",
            default: `${tunnel.name} Tunnel`,
        },
    ]);

    projectService.addApp(projectId, {
        name,
        type: "database_tunnel",
        relative_path: ".",
        linked_server_id: serverId,
        linked_tunnel_id: tunnelId,
    });

    console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Tunnel app added!`));
}

/**
 * Prompt user to add commands from detected package.json scripts
 */
async function promptToAddCommands(
    projectId: string,
    appId: string,
    scripts: string[]
): Promise<void> {
    if (scripts.length === 0) return;

    const { wantToAdd } = await inquirer.prompt([
        {
            type: "confirm",
            name: "wantToAdd",
            message: "Add commands from package.json scripts?",
            default: true,
        },
    ]);

    if (!wantToAdd) return;

    const { selectedScripts } = await inquirer.prompt([
        {
            type: "checkbox",
            name: "selectedScripts",
            message: "Select scripts to add as commands:",
            choices: scripts.map((s) => ({ name: s, value: s, checked: false })),
        },
    ]);

    for (const script of selectedScripts as string[]) {
        projectService.addAppCommand(projectId, appId, {
            name: script,
            type: "direct",
            command: `npm run ${script}`,
        });
    }

    if (selectedScripts.length > 0) {
        console.log(chalk.dim(`Added ${selectedScripts.length} commands`));
    }

    // Offer custom command
    const { addCustom } = await inquirer.prompt([
        {
            type: "confirm",
            name: "addCustom",
            message: "Add a custom command?",
            default: false,
        },
    ]);

    if (addCustom) {
        const { name, command } = await inquirer.prompt([
            {
                type: "input",
                name: "name",
                message: "Command name:",
                validate: (input: string) => input.length > 0 || "Name is required",
            },
            {
                type: "input",
                name: "command",
                message: "Command to run:",
                validate: (input: string) => input.length > 0 || "Command is required",
            },
        ]);

        projectService.addAppCommand(projectId, appId, {
            name,
            type: "direct",
            command,
        });
        console.log(chalk.dim(`Added custom command: ${name}`));
    }
}

async function addAppCommandFlow(
    projectId: string,
    appId: string
): Promise<void> {
    const project = projectService.getProject(projectId);
    const app = project?.apps.find((a) => a.id === appId);
    if (!project || !app) return;

    console.clear();
    console.log(
        chalk.bold.hex(COLORS.PRIMARY)("\n" + ICONS.ADD + "  Add Command\n")
    );

    // Try to get package.json scripts
    const packageJsonPath = path.join(
        project.base_path,
        app.relative_path,
        "package.json"
    );
    const scripts = await projectService.getPackageJsonScripts(packageJsonPath);

    const { method } = await inquirer.prompt([
        {
            type: "list",
            name: "method",
            message: "Command type:",
            choices: [
                ...(scripts.length > 0
                    ? [{ name: `📦  From package.json scripts`, value: "package" }]
                    : []),
                { name: `${ICONS.COMMAND}  Custom command`, value: "custom" },
                new inquirer.Separator(),
                { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
            ],
        },
    ]);

    if (method === "cancel") return;

    if (method === "package") {
        const { script } = await inquirer.prompt([
            {
                type: "list",
                name: "script",
                message: "Select script:",
                choices: scripts.map((s) => ({ name: s, value: s })),
            },
        ]);

        const { autoRestart } = await inquirer.prompt([
            {
                type: "confirm",
                name: "autoRestart",
                message: "Enable auto-restart if process dies?",
                default: false,
            },
        ]);

        let pollInterval: number | undefined;
        if (autoRestart) {
            const { interval } = await inquirer.prompt([
                {
                    type: "number",
                    name: "interval",
                    message: "Poll interval (seconds):",
                    default: 10,
                },
            ]);
            pollInterval = interval * 1000;
        }

        projectService.addAppCommand(projectId, appId, {
            name: script,
            type: "direct",
            command: `npm run ${script}`,
            auto_restart: autoRestart,
            poll_interval_ms: pollInterval,
        });
    } else {
        const answers = await inquirer.prompt([
            {
                type: "input",
                name: "name",
                message: "Command name:",
                validate: (input: string) => input.length > 0 || "Name is required",
            },
            {
                type: "input",
                name: "command",
                message: "Command to run:",
                validate: (input: string) => input.length > 0 || "Command is required",
            },
            {
                type: "confirm",
                name: "autoRestart",
                message: "Enable auto-restart if process dies?",
                default: false,
            },
        ]);

        let pollInterval: number | undefined;
        if (answers.autoRestart) {
            const { interval } = await inquirer.prompt([
                {
                    type: "number",
                    name: "interval",
                    message: "Poll interval (seconds):",
                    default: 10,
                },
            ]);
            pollInterval = interval * 1000;
        }

        projectService.addAppCommand(projectId, appId, {
            name: answers.name,
            type: "direct",
            command: answers.command,
            auto_restart: answers.autoRestart,
            poll_interval_ms: pollInterval,
        });
    }

    console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Command added!`));
    await waitForEnter();
}

async function addProjectCommandFlow(projectId: string): Promise<void> {
    const project = projectService.getProject(projectId);
    if (!project) return;

    console.clear();
    console.log(
        chalk.bold.hex(COLORS.PRIMARY)(
            "\n" + ICONS.ADD + "  Add Project Command\n"
        )
    );

    const { type } = await inquirer.prompt([
        {
            type: "list",
            name: "type",
            message: "Command type:",
            choices: [
                { name: `${ICONS.COMMAND}  Direct command`, value: "direct" },
                { name: `${ICONS.SEQUENCE}  Sequence of steps`, value: "sequence" },
                new inquirer.Separator(),
                { name: `${ICONS.BACK}  Cancel`, value: "cancel" },
            ],
        },
    ]);

    if (type === "cancel") return;

    const { name } = await inquirer.prompt([
        {
            type: "input",
            name: "name",
            message: "Command name:",
            validate: (input: string) => input.length > 0 || "Name is required",
        },
    ]);

    if (type === "direct") {
        const { command } = await inquirer.prompt([
            {
                type: "input",
                name: "command",
                message: "Command to run:",
                validate: (input: string) => input.length > 0 || "Command is required",
            },
        ]);

        projectService.addProjectCommand(projectId, {
            name,
            type: "direct",
            command,
        });
    } else {
        // Sequence - let user add steps
        console.log(chalk.dim("\nAdd steps to the sequence (empty to finish):"));

        const steps: Array<{
            type: "app_command" | "tunnel" | "custom" | "delay";
            app_id?: string;
            command_id?: string;
            server_id?: string;
            tunnel_id?: string;
            custom_command?: string;
            delay_ms?: number;
        }> = [];

        let addingSteps = true;
        while (addingSteps) {
            // Show current steps summary
            if (steps.length > 0) {
                console.log(chalk.dim(`\nCurrent steps (${steps.length}):`));
                steps.forEach((s, i) => {
                    let stepDesc = "";
                    if (s.type === "delay") stepDesc = `Delay ${(s.delay_ms || 0) / 1000}s`;
                    else if (s.type === "tunnel") stepDesc = "Start tunnel";
                    else if (s.type === "app_command") stepDesc = "App command";
                    else if (s.type === "custom") stepDesc = s.custom_command || "Custom";
                    console.log(chalk.dim(`  ${i + 1}. ${stepDesc}`));
                });
                console.log("");
            }

            const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

            if (project.apps.length > 0) {
                choices.push({ name: `${ICONS.APP}  App command`, value: "app_command" });
            }
            choices.push(
                { name: `${ICONS.TUNNEL}  Start tunnel`, value: "tunnel" },
                { name: `${ICONS.COMMAND}  Custom command`, value: "custom" },
                { name: `${ICONS.DELAY}  Delay`, value: "delay" }
            );

            if (steps.length > 0) {
                choices.push(
                    new inquirer.Separator(),
                    { name: `${ICONS.DELETE}  Remove last step`, value: "remove_last" }
                );
            }

            choices.push(
                new inquirer.Separator(),
                { name: `✓  Done adding steps`, value: "done" },
                { name: `${ICONS.BACK}  Cancel`, value: "cancel" }
            );

            const { stepType } = await inquirer.prompt([
                {
                    type: "list",
                    name: "stepType",
                    message: `Step ${steps.length + 1}:`,
                    choices,
                },
            ]);

            if (stepType === "done") {
                addingSteps = false;
                continue;
            }

            if (stepType === "cancel") {
                return; // Exit without saving
            }

            if (stepType === "remove_last") {
                steps.pop();
                console.log(chalk.yellow("Last step removed"));
                continue;
            }

            if (stepType === "delay") {
                const { delay } = await inquirer.prompt([
                    {
                        type: "number",
                        name: "delay",
                        message: "Delay (seconds):",
                        default: 2,
                    },
                ]);
                steps.push({ type: "delay", delay_ms: delay * 1000 });
            } else if (stepType === "app_command") {
                // Select app and command
                const { appId } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "appId",
                        message: "Select app:",
                        choices: project.apps.map((a) => ({
                            name: `${getAppTypeIcon(a.type)} ${a.name}`,
                            value: a.id,
                        })),
                    },
                ]);

                const app = project.apps.find((a) => a.id === appId);
                if (app && app.commands.length > 0) {
                    const { commandId } = await inquirer.prompt([
                        {
                            type: "list",
                            name: "commandId",
                            message: "Select command:",
                            choices: app.commands.map((c) => ({
                                name: `${c.name}${c.command ? ` (${c.command})` : ""}`,
                                value: c.id,
                            })),
                        },
                    ]);
                    steps.push({ type: "app_command", app_id: appId, command_id: commandId });
                } else {
                    console.log(chalk.yellow("No commands in this app."));
                }
            } else if (stepType === "tunnel") {
                const servers = serverService.listServers();
                const serversWithTunnels = servers.filter(
                    (s) => s.tunnels && s.tunnels.length > 0
                );

                if (serversWithTunnels.length === 0) {
                    console.log(chalk.yellow("No tunnels available."));
                    continue;
                }

                const { serverId } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "serverId",
                        message: "Select server:",
                        choices: serversWithTunnels.map((s) => ({
                            name: s.name,
                            value: s.id,
                        })),
                    },
                ]);

                const server = servers.find((s) => s.id === serverId);
                if (server?.tunnels) {
                    const { tunnelId } = await inquirer.prompt([
                        {
                            type: "list",
                            name: "tunnelId",
                            message: "Select tunnel:",
                            choices: server.tunnels.map((t) => ({
                                name: t.name,
                                value: t.id,
                            })),
                        },
                    ]);
                    steps.push({ type: "tunnel", server_id: serverId, tunnel_id: tunnelId });
                }
            } else if (stepType === "custom") {
                const { customCommand } = await inquirer.prompt([
                    {
                        type: "input",
                        name: "customCommand",
                        message: "Command:",
                    },
                ]);
                if (customCommand) {
                    steps.push({ type: "custom", custom_command: customCommand });
                }
            }
        }

        if (steps.length > 0) {
            projectService.addProjectCommand(projectId, {
                name,
                type: "sequence",
                steps,
            });
        }
    }

    console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Project command added!`));
    await waitForEnter();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function runAppCommand(
    projectId: string,
    appId: string,
    commandId: string
): Promise<void> {
    const project = projectService.getProject(projectId);
    const app = project?.apps.find((a) => a.id === appId);
    const command = app?.commands.find((c) => c.id === commandId);

    const pid = await projectService.runAppCommand(projectId, appId, commandId);
    if (pid) {
        console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Command started (PID: ${pid})`));

        // Track recent command
        if (project && app && command) {
            storageService.saveRecentCommand({
                projectId: project.id,
                projectName: project.name,
                appId: app.id,
                appName: app.name,
                commandId: command.id,
                commandName: command.name,
                runAt: new Date().toISOString(),
            });
        }
    } else {
        console.log(chalk.red(`\n${UI.ICONS.ERROR} Failed to start command`));
    }
    await waitForEnter();
}

async function runProjectCommand(
    projectId: string,
    commandId: string
): Promise<void> {
    const project = projectService.getProject(projectId);
    const command = project?.commands.find((c) => c.id === commandId);

    const pid = await projectService.runProjectCommand(projectId, commandId);
    if (pid) {
        console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Command started (PID: ${pid})`));

        // Track recent command
        if (project && command) {
            storageService.saveRecentCommand({
                projectId: project.id,
                projectName: project.name,
                commandId: command.id,
                commandName: command.name,
                runAt: new Date().toISOString(),
            });
        }
    } else {
        console.log(chalk.red(`\n${UI.ICONS.ERROR} Failed to start command`));
    }
    await waitForEnter();
}

async function stopCommand(pid: number): Promise<void> {
    await projectService.stopCommand(pid);
    console.log(chalk.green(`\n${UI.ICONS.SUCCESS} Command stopped`));
    await waitForEnter();
}

async function deleteProjectFlow(projectId: string): Promise<boolean> {
    const project = projectService.getProject(projectId);
    if (!project) return false;

    const { confirm } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirm",
            message: chalk.red(`Delete project "${project.name}"? This cannot be undone.`),
            default: false,
        },
    ]);

    if (confirm) {
        return projectService.deleteProject(projectId);
    }

    return false;
}

async function deleteAppFlow(
    projectId: string,
    appId: string
): Promise<boolean> {
    const { confirm } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirm",
            message: chalk.red("Delete this app?"),
            default: false,
        },
    ]);

    if (confirm) {
        return projectService.deleteApp(projectId, appId);
    }

    return false;
}

async function deleteAppCommand(
    projectId: string,
    appId: string,
    commandId: string
): Promise<void> {
    projectService.deleteAppCommand(projectId, appId, commandId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function getAppTypeIcon(type: TAppType): string {
    switch (type) {
        case "nextjs":
            return ICONS.NEXTJS;
        case "expressjs":
            return ICONS.EXPRESS;
        case "database_tunnel":
            return ICONS.TUNNEL;
        default:
            return ICONS.CUSTOM;
    }
}

async function waitForEnter(message = "Press Enter to continue..."): Promise<void> {
    await inquirer.prompt([
        {
            type: "input",
            name: "continue",
            message: chalk.dim(message),
        },
    ]);
}

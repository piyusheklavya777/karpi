// src/services/project.service.ts
// Project Management Service for Karpi CLI

import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { storageService } from "./storage.service";
import { profileService } from "./profile.service";
import { processService } from "./process.service";
import { serverService } from "./server.service";
import { logger } from "../utils/logger";
import type {
    IProject,
    IApp,
    ICommand,
    ICommandStep,
    IDetectedApp,
    TAppType,
    IBackgroundProcess,
} from "../types";

/**
 * ProjectService - Manages code projects, apps, and commands
 */
export class ProjectService {
    // ═══════════════════════════════════════════════════════════════════════════════
    // Project CRUD
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Create a new project
     */
    createProject(name: string, basePath: string): IProject | null {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) {
            logger.error("No active profile found");
            return null;
        }

        const project: IProject = {
            id: nanoid(),
            profile_id: activeProfile.id,
            name,
            base_path: basePath,
            apps: [],
            commands: [],
            created_at: new Date().toISOString(),
        };

        storageService.saveProject(project);
        logger.success(`Project "${name}" created`);
        return project;
    }

    /**
     * Get a project by ID
     */
    getProject(id: string): IProject | undefined {
        return storageService.getProject(id);
    }

    /**
     * List all projects for the active profile
     */
    listProjects(): IProject[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];
        return storageService.getProjectsByProfileId(activeProfile.id);
    }

    /**
     * Update a project
     */
    updateProject(
        projectId: string,
        updates: Partial<Pick<IProject, "name" | "base_path" | "linked_server_id">>
    ): IProject | null {
        const project = this.getProject(projectId);
        if (!project) {
            logger.error("Project not found");
            return null;
        }

        const updatedProject = { ...project, ...updates };
        storageService.saveProject(updatedProject);
        logger.success(`Project "${updatedProject.name}" updated`);
        return updatedProject;
    }

    /**
     * Delete a project
     */
    deleteProject(id: string): boolean {
        const project = this.getProject(id);
        if (!project) {
            logger.error("Project not found");
            return false;
        }

        // Kill all running processes for this project
        const processes = processService.getProjectProcesses(id);
        processes.forEach((p) => processService.killProcess(p.pid));

        const deleted = storageService.deleteProject(id);
        if (deleted) {
            logger.success(`Project "${project.name}" deleted`);
        }
        return deleted;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // App Detection & Management
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Detect apps in a project directory by scanning for package.json files
     */
    async detectApps(basePath: string): Promise<IDetectedApp[]> {
        const detectedApps: IDetectedApp[] = [];

        try {
            await this.scanDirectoryForApps(basePath, basePath, detectedApps);
        } catch (error) {
            logger.error("Failed to scan directory for apps", error);
        }

        return detectedApps;
    }

    private async scanDirectoryForApps(
        basePath: string,
        currentPath: string,
        detectedApps: IDetectedApp[],
        depth: number = 0
    ): Promise<void> {
        // Limit scan depth to avoid scanning too deep
        if (depth > 3) return;

        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        // Check for package.json in current directory
        const hasPackageJson = entries.some(
            (e) => e.isFile() && e.name === "package.json"
        );

        if (hasPackageJson) {
            const packageJsonPath = path.join(currentPath, "package.json");
            const appInfo = await this.parsePackageJson(packageJsonPath, basePath);
            if (appInfo) {
                detectedApps.push(appInfo);
            }
        }

        // Skip node_modules and hidden directories
        const skipDirs = ["node_modules", ".git", ".next", "dist", "build", ".cache"];

        for (const entry of entries) {
            if (
                entry.isDirectory() &&
                !skipDirs.includes(entry.name) &&
                !entry.name.startsWith(".")
            ) {
                await this.scanDirectoryForApps(
                    basePath,
                    path.join(currentPath, entry.name),
                    detectedApps,
                    depth + 1
                );
            }
        }
    }

    private async parsePackageJson(
        packageJsonPath: string,
        basePath: string
    ): Promise<IDetectedApp | null> {
        try {
            const content = await fs.readFile(packageJsonPath, "utf-8");
            const pkg = JSON.parse(content);

            const dependencies = {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {}),
            };

            // Detect app type
            let type: TAppType = "custom";
            if (dependencies["next"]) {
                type = "nextjs";
            } else if (dependencies["express"]) {
                type = "expressjs";
            }

            // Get scripts
            const scripts = Object.keys(pkg.scripts || {});

            // Get relative path
            const dir = path.dirname(packageJsonPath);
            const relativePath = path.relative(basePath, dir) || ".";

            // Use directory name as app name, or package name
            const name = pkg.name || path.basename(dir);

            return {
                name,
                relativePath,
                type,
                scripts,
                packageJsonPath,
            };
        } catch {
            return null;
        }
    }

    /**
     * Add an app to a project
     */
    addApp(
        projectId: string,
        appData: Omit<IApp, "id" | "created_at" | "commands">
    ): IApp | null {
        const project = this.getProject(projectId);
        if (!project) {
            logger.error("Project not found");
            return null;
        }

        const app: IApp = {
            ...appData,
            id: nanoid(),
            commands: [],
            created_at: new Date().toISOString(),
        };

        project.apps.push(app);
        storageService.saveProject(project);
        logger.success(`App "${app.name}" added to project "${project.name}"`);
        return app;
    }

    /**
     * Get an app from a project
     */
    getApp(projectId: string, appId: string): IApp | undefined {
        const project = this.getProject(projectId);
        if (!project) return undefined;
        return project.apps.find((a) => a.id === appId);
    }

    /**
     * Delete an app from a project
     */
    deleteApp(projectId: string, appId: string): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;

        // Kill any running processes for this app
        const processes = processService.getAppProcesses(appId);
        processes.forEach((p) => processService.killProcess(p.pid));

        const initialLength = project.apps.length;
        project.apps = project.apps.filter((a) => a.id !== appId);

        if (project.apps.length !== initialLength) {
            storageService.saveProject(project);
            logger.success("App deleted");
            return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Command Management
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Get scripts from a package.json file
     */
    async getPackageJsonScripts(packageJsonPath: string): Promise<string[]> {
        try {
            const content = await fs.readFile(packageJsonPath, "utf-8");
            const pkg = JSON.parse(content);
            return Object.keys(pkg.scripts || {});
        } catch {
            return [];
        }
    }

    /**
     * Add a command to an app
     */
    addAppCommand(
        projectId: string,
        appId: string,
        commandData: Omit<ICommand, "id">
    ): ICommand | null {
        const project = this.getProject(projectId);
        if (!project) return null;

        const appIndex = project.apps.findIndex((a) => a.id === appId);
        if (appIndex === -1) return null;

        const command: ICommand = {
            ...commandData,
            id: nanoid(),
        };

        project.apps[appIndex].commands.push(command);
        storageService.saveProject(project);
        logger.success(`Command "${command.name}" added`);
        return command;
    }

    /**
     * Add a command to a project (project-level)
     */
    addProjectCommand(
        projectId: string,
        commandData: Omit<ICommand, "id">
    ): ICommand | null {
        const project = this.getProject(projectId);
        if (!project) return null;

        const command: ICommand = {
            ...commandData,
            id: nanoid(),
        };

        project.commands.push(command);
        storageService.saveProject(project);
        logger.success(`Project command "${command.name}" added`);
        return command;
    }

    /**
     * Delete a command from an app
     */
    deleteAppCommand(
        projectId: string,
        appId: string,
        commandId: string
    ): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;

        const appIndex = project.apps.findIndex((a) => a.id === appId);
        if (appIndex === -1) return false;

        const initialLength = project.apps[appIndex].commands.length;
        project.apps[appIndex].commands = project.apps[appIndex].commands.filter(
            (c) => c.id !== commandId
        );

        if (project.apps[appIndex].commands.length !== initialLength) {
            storageService.saveProject(project);
            logger.success("Command deleted");
            return true;
        }

        return false;
    }

    /**
     * Delete a project-level command
     */
    deleteProjectCommand(projectId: string, commandId: string): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;

        const initialLength = project.commands.length;
        project.commands = project.commands.filter((c) => c.id !== commandId);

        if (project.commands.length !== initialLength) {
            storageService.saveProject(project);
            logger.success("Project command deleted");
            return true;
        }

        return false;
    }

    /**
     * Update a command in an app
     */
    updateAppCommand(
        projectId: string,
        appId: string,
        commandId: string,
        updates: Partial<Omit<ICommand, "id">>
    ): ICommand | null {
        const project = this.getProject(projectId);
        if (!project) {
            logger.error("Project not found");
            return null;
        }

        const appIndex = project.apps.findIndex((a) => a.id === appId);
        if (appIndex === -1) {
            logger.error("App not found");
            return null;
        }

        const commandIndex = project.apps[appIndex].commands.findIndex(
            (c) => c.id === commandId
        );
        if (commandIndex === -1) {
            logger.error("Command not found");
            return null;
        }

        const updatedCommand = {
            ...project.apps[appIndex].commands[commandIndex],
            ...updates,
        };

        project.apps[appIndex].commands[commandIndex] = updatedCommand;
        storageService.saveProject(project);
        logger.success(`Command "${updatedCommand.name}" updated`);
        return updatedCommand;
    }

    /**
     * Update a project-level command
     */
    updateProjectCommand(
        projectId: string,
        commandId: string,
        updates: Partial<Omit<ICommand, "id">>
    ): ICommand | null {
        const project = this.getProject(projectId);
        if (!project) {
            logger.error("Project not found");
            return null;
        }

        const commandIndex = project.commands.findIndex((c) => c.id === commandId);
        if (commandIndex === -1) {
            logger.error("Command not found");
            return null;
        }

        const updatedCommand = {
            ...project.commands[commandIndex],
            ...updates,
        };

        project.commands[commandIndex] = updatedCommand;
        storageService.saveProject(project);
        logger.success(`Project command "${updatedCommand.name}" updated`);
        return updatedCommand;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Command Execution
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Run a command from an app
     */
    async runAppCommand(
        projectId: string,
        appId: string,
        commandId: string
    ): Promise<number | null> {
        const project = this.getProject(projectId);
        if (!project) return null;

        const app = project.apps.find((a) => a.id === appId);
        if (!app) return null;

        const command = app.commands.find((c) => c.id === commandId);
        if (!command) return null;

        if (command.type === "sequence") {
            return this.runSequenceCommand(project, command, app);
        }

        return this.runDirectCommand(project, app, command);
    }

    /**
     * Run a project-level command
     */
    async runProjectCommand(
        projectId: string,
        commandId: string
    ): Promise<number | null> {
        const project = this.getProject(projectId);
        if (!project) return null;

        const command = project.commands.find((c) => c.id === commandId);
        if (!command) return null;

        if (command.type === "sequence") {
            return this.runSequenceCommand(project, command);
        }

        return this.runDirectCommand(project, undefined, command);
    }

    private async runDirectCommand(
        project: IProject,
        app: IApp | undefined,
        command: ICommand
    ): Promise<number | null> {
        if (!command.command) {
            logger.error("No command specified");
            return null;
        }

        // Determine working directory
        let cwd = project.base_path;
        if (app) {
            cwd = path.join(project.base_path, app.relative_path);
        }
        if (command.working_dir) {
            cwd = path.isAbsolute(command.working_dir)
                ? command.working_dir
                : path.join(cwd, command.working_dir);
        }

        // Parse command into command and args
        const parts = command.command.split(" ");
        const cmd = parts[0];
        const args = parts.slice(1);

        const processInfo: Omit<IBackgroundProcess, "pid" | "startTime"> = {
            type: "command",
            serverId: "", // Not applicable for commands
            tunnelId: "", // Not applicable for commands
            projectId: project.id,
            appId: app?.id,
            commandId: command.id,
            name: `${project.name}${app ? ` > ${app.name}` : ""} > ${command.name}`,
        };

        const pid = await processService.startProcess({
            command: cmd,
            args,
            cwd,
            processInfo,
        });

        // Setup polling if auto_restart is enabled
        if (pid && command.auto_restart) {
            const pollInterval = command.poll_interval_ms || 10000;
            processService.setupPollingForProcess(pid, pollInterval, async () => {
                return this.runDirectCommand(project, app, command);
            });
        }

        return pid;
    }

    private async runSequenceCommand(
        project: IProject,
        command: ICommand,
        contextApp?: IApp
    ): Promise<number | null> {
        if (!command.steps || command.steps.length === 0) {
            logger.error("No steps in sequence");
            return null;
        }

        const pids: number[] = [];

        for (const step of command.steps) {
            const pid = await this.executeStep(project, step, contextApp);
            if (pid) pids.push(pid);
        }

        // Return the first PID (or last?) - sequences are fire-and-forget
        return pids[0] || null;
    }

    private async executeStep(
        project: IProject,
        step: ICommandStep,
        contextApp?: IApp
    ): Promise<number | null> {
        switch (step.type) {
            case "delay":
                if (step.delay_ms) {
                    await new Promise((resolve) => setTimeout(resolve, step.delay_ms));
                }
                return null;

            case "tunnel":
                if (step.server_id && step.tunnel_id) {
                    return serverService.startTunnel(step.server_id, step.tunnel_id);
                }
                return null;

            case "app_command":
                if (step.app_id && step.command_id) {
                    const app = project.apps.find((a) => a.id === step.app_id);
                    const cmd = app?.commands.find((c) => c.id === step.command_id);
                    if (app && cmd) {
                        return this.runDirectCommand(project, app, cmd);
                    }
                }
                return null;

            case "custom":
                if (step.custom_command) {
                    const customCmd: ICommand = {
                        id: nanoid(),
                        name: "custom",
                        type: "direct",
                        command: step.custom_command,
                        working_dir: step.custom_working_dir,
                    };
                    return this.runDirectCommand(project, contextApp, customCmd);
                }
                return null;

            default:
                return null;
        }
    }

    /**
     * Stop a running command
     */
    async stopCommand(pid: number): Promise<boolean> {
        return processService.killProcess(pid);
    }

    /**
     * Check if a command is running
     */
    isCommandRunning(commandId: string): boolean {
        const proc = processService.getCommandProcess(commandId);
        return !!proc;
    }

    /**
     * Get the running process for a command
     */
    getCommandProcess(commandId: string): IBackgroundProcess | undefined {
        return processService.getCommandProcess(commandId);
    }
}

// Singleton instance
export const projectService = new ProjectService();

// src/services/process.service.ts
// Unified Process Management Service for Karpi CLI

import { spawn } from "child_process";
import { storageService } from "./storage.service";
import { logger } from "../utils/logger";
import type { IBackgroundProcess, ICommand, IProject } from "../types";

/**
 * ProcessService - Unified process management for tunnels and commands
 * Handles spawning, tracking, and killing background processes
 * Includes polling and auto-restart functionality
 */
export class ProcessService {
    private pollingIntervals: Map<number, NodeJS.Timeout> = new Map();
    private isPollingActive: boolean = false;

    /**
     * Start a background process with detached stdio
     */
    async startProcess(config: {
        command: string;
        args: string[];
        cwd: string;
        processInfo: Omit<IBackgroundProcess, "pid" | "startTime">;
    }): Promise<number | null> {
        try {
            const subprocess = spawn(config.command, config.args, {
                detached: true,
                stdio: "ignore",
                cwd: config.cwd,
            });

            subprocess.unref();

            if (subprocess.pid) {
                const processInfo: IBackgroundProcess = {
                    ...config.processInfo,
                    pid: subprocess.pid,
                    startTime: new Date().toISOString(),
                };

                storageService.saveProcess(processInfo);
                logger.success(`Process started (PID: ${subprocess.pid})`);

                return subprocess.pid;
            } else {
                logger.error("Failed to get process PID");
                return null;
            }
        } catch (error) {
            logger.error("Failed to start process", error);
            return null;
        }
    }

    /**
     * Check if a process is currently running
     */
    isProcessRunning(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * List all active processes (filters out dead ones)
     */
    listActiveProcesses(): IBackgroundProcess[] {
        const processes = storageService.getAllProcesses();
        const activeProcesses = processes.filter((p) => this.isProcessRunning(p.pid));

        // Clean up dead processes from storage
        if (activeProcesses.length !== processes.length) {
            const deadPids = processes
                .filter((p) => !this.isProcessRunning(p.pid))
                .map((p) => p.pid);

            deadPids.forEach((pid) => storageService.deleteProcess(pid));
        }

        return activeProcesses;
    }

    /**
     * Kill a process by PID (recursively kills child processes first)
     */
    async killProcess(pid: number): Promise<boolean> {
        try {
            // First, kill all child processes
            const proc = this.getProcess(pid);
            if (proc?.childPids && proc.childPids.length > 0) {
                logger.info(`Stopping ${proc.childPids.length} child processes...`);
                for (const childPid of proc.childPids) {
                    await this.killProcess(childPid); // Recursive call
                }
            }

            // Stop any polling for this process
            this.stopPollingForProcess(pid);

            // Kill the process itself
            process.kill(pid);
            storageService.deleteProcess(pid);
            logger.success(`Process ${pid} killed`);
            return true;
        } catch {
            // Process might already be dead
            storageService.deleteProcess(pid);
            logger.warn(`Process ${pid} not found (removed from registry)`);
            return false;
        }
    }

    /**
     * Get processes by type (tunnel or command)
     */
    getProcessesByType(type: "tunnel" | "command"): IBackgroundProcess[] {
        return this.listActiveProcesses().filter((p) => p.type === type);
    }

    /**
     * Get all command processes for a specific project
     */
    getProjectProcesses(projectId: string): IBackgroundProcess[] {
        return this.listActiveProcesses().filter(
            (p) => p.type === "command" && p.projectId === projectId
        );
    }

    /**
     * Get all command processes for a specific app
     */
    getAppProcesses(appId: string): IBackgroundProcess[] {
        return this.listActiveProcesses().filter(
            (p) => p.type === "command" && p.appId === appId
        );
    }

    /**
     * Get process for a specific command if running
     */
    getCommandProcess(commandId: string): IBackgroundProcess | undefined {
        return this.listActiveProcesses().find(
            (p) => p.type === "command" && p.commandId === commandId
        );
    }

    /**
     * Get a specific process by PID
     */
    getProcess(pid: number): IBackgroundProcess | undefined {
        return storageService.getAllProcesses().find((p) => p.pid === pid);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Polling & Auto-Restart
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Start polling for all commands with auto_restart enabled
     * Called when CLI starts
     */
    startPolling(): void {
        if (this.isPollingActive) return;
        this.isPollingActive = true;

        logger.debug("Process polling started");
        this.checkAndRestartDeadProcesses();
    }

    /**
     * Stop all polling (called on CLI exit)
     */
    stopPolling(): void {
        this.isPollingActive = false;

        // Clear all polling intervals
        this.pollingIntervals.forEach((interval) => clearInterval(interval));
        this.pollingIntervals.clear();

        logger.debug("Process polling stopped");
    }

    /**
     * Setup polling for a specific process
     */
    setupPollingForProcess(
        pid: number,
        pollIntervalMs: number,
        restartFn: () => Promise<number | null>
    ): void {
        if (!this.isPollingActive) return;

        const interval = setInterval(async () => {
            // Update lastPolledAt timestamp
            this.updateProcessPolledTime(pid);

            if (!this.isProcessRunning(pid)) {
                logger.warn(`Process ${pid} died, attempting restart...`);

                // Clear this interval
                this.stopPollingForProcess(pid);

                // Attempt restart
                const newPid = await restartFn();
                if (newPid) {
                    // Setup polling for new process
                    this.setupPollingForProcess(newPid, pollIntervalMs, restartFn);
                }
            }
        }, pollIntervalMs);

        this.pollingIntervals.set(pid, interval);
    }

    /**
     * Update the lastPolledAt timestamp for a process
     */
    private updateProcessPolledTime(pid: number): void {
        const processes = storageService.getAllProcesses();
        const processIndex = processes.findIndex((p) => p.pid === pid);
        if (processIndex >= 0) {
            processes[processIndex].lastPolledAt = new Date().toISOString();
            // Update the process in storage
            storageService.deleteProcess(pid);
            storageService.saveProcess(processes[processIndex]);
        }
    }

    /**
     * Stop polling for a specific process
     */
    private stopPollingForProcess(pid: number): void {
        const interval = this.pollingIntervals.get(pid);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(pid);
        }
    }

    /**
     * Check all registered processes and restart dead ones that have auto_restart
     */
    private async checkAndRestartDeadProcesses(): Promise<void> {
        const projects = storageService.getAllProjects();
        const processes = storageService.getAllProcesses();

        for (const proc of processes) {
            if (proc.type === "command" && proc.projectId && proc.commandId) {
                const project = projects.find((p) => p.id === proc.projectId);
                if (!project) continue;

                // Find the command configuration
                const command = this.findCommandInProject(project, proc.commandId);
                if (!command || !command.auto_restart) continue;

                // Check if process is dead
                if (!this.isProcessRunning(proc.pid)) {
                    logger.warn(`Process ${proc.pid} for "${command.name}" was found dead, restarting...`);
                    // Note: Actual restart logic will be implemented in project.service.ts
                    // as it needs context about the command and working directory
                }
            }
        }
    }

    /**
     * Find a command in a project (checks both project-level and app-level)
     */
    private findCommandInProject(project: IProject, commandId: string): ICommand | undefined {
        // Check project-level commands
        const projectCmd = project.commands.find((c) => c.id === commandId);
        if (projectCmd) return projectCmd;

        // Check app-level commands
        for (const app of project.apps) {
            const appCmd = app.commands.find((c) => c.id === commandId);
            if (appCmd) return appCmd;
        }

        return undefined;
    }
}

// Singleton instance
export const processService = new ProcessService();

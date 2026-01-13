// src/types/projects.ts
// Project Management Types for Karpi CLI

/**
 * Project - represents a code project folder containing multiple apps
 */
export interface IProject {
    id: string;
    profile_id: string;
    name: string;
    base_path: string; // Absolute path to project folder
    linked_server_id?: string; // Optional link to a server
    apps: IApp[];
    commands: ICommand[]; // Project-level commands
    created_at: string;
}

/**
 * App - a runnable service within a project
 */
export interface IApp {
    id: string;
    name: string;
    type: TAppType;
    relative_path: string; // Relative to project base_path
    linked_server_id?: string; // For DB tunnels
    linked_tunnel_id?: string; // For DB tunnels
    commands: ICommand[];
    created_at: string;
}

/**
 * Supported app types
 */
export type TAppType = "nextjs" | "expressjs" | "database_tunnel" | "custom";

/**
 * Unified Command entity - used at both project and app level
 */
export interface ICommand {
    id: string;
    name: string; // e.g., "start", "build", "dev", "Start All"
    type: TCommandType;
    // For direct commands:
    command?: string; // e.g., "npm run dev"
    working_dir?: string; // Override working directory
    // For sequences:
    steps?: ICommandStep[];
    // Auto-restart configuration (optional)
    auto_restart?: boolean; // Enable polling & auto-restart if process dies
    poll_interval_ms?: number; // Polling interval: min 100ms, max 300000ms (300s)
}

/**
 * Command type - direct command or sequence of steps
 */
export type TCommandType = "direct" | "sequence";

/**
 * Step in a command sequence
 */
export interface ICommandStep {
    type: TStepType;
    // For app_command:
    app_id?: string;
    command_id?: string;
    // For tunnel:
    tunnel_id?: string;
    server_id?: string;
    // For custom:
    custom_command?: string;
    custom_working_dir?: string;
    // For delay:
    delay_ms?: number; // Delay in milliseconds before next step
}

/**
 * Step types for command sequences
 */
export type TStepType = "app_command" | "tunnel" | "custom" | "delay";

/**
 * Detected app during project scanning
 */
export interface IDetectedApp {
    name: string;
    relativePath: string;
    type: TAppType;
    scripts: string[];
    packageJsonPath: string;
}

/**
 * Recent command - tracks last run commands for quick actions
 */
export interface IRecentCommand {
    projectId: string;
    projectName: string;
    appId?: string;
    appName?: string;
    commandId: string;
    commandName: string;
    runAt: string; // ISO timestamp
}

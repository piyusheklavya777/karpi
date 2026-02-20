// src/utils/cli-helpers.ts
// Foundation utilities for non-interactive CLI commands

import chalk from "chalk";
import type {
  IServerConfig,
  ITunnelConfig,
  ISyncedFile,
  IProject,
  IApp,
  ICommand,
  IRDSInstance,
  IAWSProfile,
} from "../types";
import { authService } from "../services/auth.service";
import { serverService } from "../services/server.service";
import { projectService } from "../services/project.service";
import { storageService } from "../services/storage.service";

// ═══════════════════════════════════════════════════════════════════════════════
// JSON mode global flag
// ═══════════════════════════════════════════════════════════════════════════════

let jsonMode = false;

export function setJsonMode(value: boolean): void {
  jsonMode = value;
}

export function getJsonMode(): boolean {
  return jsonMode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth guard
// ═══════════════════════════════════════════════════════════════════════════════

export function requireAuth(): void {
  if (!authService.isAuthenticated()) {
    outputError("Not authenticated. Please login first: karpi login");
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Name resolvers (case-insensitive, error+exit on 0 or >1 matches)
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveServer(name: string): IServerConfig {
  const servers = serverService.listServers();
  const matches = servers.filter(
    (s) => s.name.toLowerCase() === name.toLowerCase()
  );

  if (matches.length === 0) {
    const available = servers.map((s) => s.name).join(", ") || "none";
    outputError(`Server "${name}" not found. Available: ${available}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple servers match "${name}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveTunnel(
  server: IServerConfig,
  tunnelName: string
): ITunnelConfig {
  const tunnels = server.tunnels || [];
  const matches = tunnels.filter(
    (t) => t.name.toLowerCase() === tunnelName.toLowerCase()
  );

  if (matches.length === 0) {
    const available = tunnels.map((t) => t.name).join(", ") || "none";
    outputError(
      `Tunnel "${tunnelName}" not found on server "${server.name}". Available: ${available}`
    );
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple tunnels match "${tunnelName}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveSyncedFile(
  server: IServerConfig,
  fileName: string
): ISyncedFile {
  const files = server.synced_files || [];
  const matches = files.filter(
    (f) => f.name.toLowerCase() === fileName.toLowerCase()
  );

  if (matches.length === 0) {
    const available = files.map((f) => f.name).join(", ") || "none";
    outputError(
      `Synced file "${fileName}" not found on server "${server.name}". Available: ${available}`
    );
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple synced files match "${fileName}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveProject(name: string): IProject {
  const projects = projectService.listProjects();
  const matches = projects.filter(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );

  if (matches.length === 0) {
    const available = projects.map((p) => p.name).join(", ") || "none";
    outputError(`Project "${name}" not found. Available: ${available}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple projects match "${name}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveApp(project: IProject, appName: string): IApp {
  const matches = project.apps.filter(
    (a) => a.name.toLowerCase() === appName.toLowerCase()
  );

  if (matches.length === 0) {
    const available = project.apps.map((a) => a.name).join(", ") || "none";
    outputError(
      `App "${appName}" not found in project "${project.name}". Available: ${available}`
    );
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple apps match "${appName}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveCommand(
  project: IProject,
  cmdName: string,
  appName?: string
): { command: ICommand; app?: IApp; isProjectLevel: boolean } {
  // If app specified, only search that app
  if (appName) {
    const app = resolveApp(project, appName);
    const matches = app.commands.filter(
      (c) => c.name.toLowerCase() === cmdName.toLowerCase()
    );
    if (matches.length === 0) {
      const available = app.commands.map((c) => c.name).join(", ") || "none";
      outputError(
        `Command "${cmdName}" not found in app "${app.name}". Available: ${available}`
      );
      process.exit(1);
    }
    return { command: matches[0], app, isProjectLevel: false };
  }

  // Search project-level commands first
  const projectMatches = project.commands.filter(
    (c) => c.name.toLowerCase() === cmdName.toLowerCase()
  );
  if (projectMatches.length > 0) {
    return { command: projectMatches[0], isProjectLevel: true };
  }

  // Search all app commands
  for (const app of project.apps) {
    const appMatches = app.commands.filter(
      (c) => c.name.toLowerCase() === cmdName.toLowerCase()
    );
    if (appMatches.length > 0) {
      return { command: appMatches[0], app, isProjectLevel: false };
    }
  }

  // Nothing found - list all available
  const allCmds: string[] = [
    ...project.commands.map((c) => c.name),
    ...project.apps.flatMap((a) => a.commands.map((c) => `${a.name}/${c.name}`)),
  ];
  const available = allCmds.join(", ") || "none";
  outputError(
    `Command "${cmdName}" not found in project "${project.name}". Available: ${available}`
  );
  process.exit(1);
}

export function resolveRDS(name: string): IRDSInstance {
  const profileId = storageService.getActiveProfileId();
  const instances = profileId
    ? storageService.getRDSByProfileId(profileId)
    : storageService.getAllRDSInstances();
  const matches = instances.filter(
    (r) => r.name.toLowerCase() === name.toLowerCase()
  );

  if (matches.length === 0) {
    const available = instances.map((r) => r.name).join(", ") || "none";
    outputError(`RDS instance "${name}" not found. Available: ${available}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple RDS instances match "${name}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

export function resolveAWSProfile(name: string): IAWSProfile {
  const profiles = storageService.getAllAWSProfiles();
  const matches = profiles.filter(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );

  if (matches.length === 0) {
    const available = profiles.map((p) => p.name).join(", ") || "none";
    outputError(`AWS profile "${name}" not found. Available: ${available}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    outputError(
      `Multiple AWS profiles match "${name}". Please use an exact name.`
    );
    process.exit(1);
  }

  return matches[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Output helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function output(data: unknown, humanFormatter?: (data: unknown) => void): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else if (humanFormatter) {
    humanFormatter(data);
  } else {
    console.log(data);
  }
}

export function outputError(message: string): void {
  if (jsonMode) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(chalk.red("Error: " + message));
  }
}

export function outputSuccess(message: string, data?: Record<string, unknown>): void {
  if (jsonMode) {
    console.log(JSON.stringify({ success: true, message, ...data }));
  } else {
    console.log(chalk.green("\u2713 " + message));
  }
}

export function outputTable(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string; width?: number }[]
): void {
  if (jsonMode) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(chalk.dim("  No items found."));
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxData = Math.max(
      ...rows.map((r) => String(r[col.key] ?? "").length)
    );
    return col.width || Math.max(col.header.length, maxData);
  });

  // Header
  const header = columns
    .map((col, i) => chalk.bold(col.header.padEnd(widths[i])))
    .join("  ");
  console.log(header);
  console.log(chalk.dim("-".repeat(header.length)));

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => String(row[col.key] ?? "").padEnd(widths[i]))
      .join("  ");
    console.log(line);
  }
}

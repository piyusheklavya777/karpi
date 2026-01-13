// src/services/server.service.ts

import boxen from "boxen";
import { styled } from "../config/constants";
import fs from "fs/promises";
import { constants } from "fs";
import path from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { nanoid } from "nanoid";
import { storageService } from "./storage.service";
import { profileService } from "./profile.service";
import { logger } from "../utils/logger";
import { CONFIG_DIR } from "../config/constants";
import type {
  IServerConfig,
  ITunnelConfig,
  IBackgroundProcess,
  ISyncedFile,
} from "../types";
import { exec } from "child_process";
import { processService } from "./process.service";

const KEYS_DIR = "keys";

export class ServerService {
  private keysPath: string;

  constructor() {
    this.keysPath = path.join(homedir(), CONFIG_DIR, KEYS_DIR);
    this.initKeysDir();
  }

  private async initKeysDir() {
    try {
      await fs.mkdir(this.keysPath, { recursive: true, mode: 0o700 });
    } catch (error) {
      logger.error("Failed to initialize keys directory", error);
    }
  }

  /**
   * Expand ~ to home directory in file paths
   */
  private expandPath(filePath: string): string {
    if (filePath.startsWith("~/")) {
      return path.join(homedir(), filePath.slice(2));
    }
    if (filePath.startsWith("~")) {
      return path.join(homedir(), filePath.slice(1));
    }
    return filePath;
  }

  async addServer(
    name: string,
    host: string,
    username: string,
    originalPemPath: string
  ): Promise<IServerConfig | null> {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) {
      logger.error("No active profile found");
      return null;
    }

    // Expand ~ to home directory
    const expandedPemPath = this.expandPath(originalPemPath);

    // Validate original PEM file with detailed error reporting
    try {
      // First check if file exists
      await fs.access(expandedPemPath, constants.F_OK);
    } catch {
      logger.error(`PEM file does not exist: ${expandedPemPath}`);
      return null;
    }

    // Check if file is readable
    try {
      await fs.access(expandedPemPath, constants.R_OK);
    } catch {
      // Try to fix permissions
      logger.warn(
        `PEM file exists but is not readable. Attempting to fix permissions...`
      );
      try {
        await fs.chmod(expandedPemPath, 0o600);
        logger.success(`Fixed PEM file permissions to 600`);
      } catch (chmodError) {
        logger.error(
          `Cannot read PEM file and failed to fix permissions: ${expandedPemPath}`
        );
        logger.error(`Please run: chmod 600 ${expandedPemPath}`);
        return null;
      }
    }

    const id = nanoid();
    const pemFileName = `${id}.pem`;
    const destPemPath = path.join(this.keysPath, pemFileName);

    try {
      // Read original file (use expanded path)
      const pemContent = await fs.readFile(expandedPemPath);

      // Write to secure location with 600 permissions
      await fs.writeFile(destPemPath, pemContent, { mode: 0o600 });

      logger.debug(`PEM file saved securely to ${destPemPath}`);
    } catch (error) {
      logger.error("Failed to save PEM file securely", error);
      return null;
    }

    const serverConfig: IServerConfig = {
      id,
      profile_id: activeProfile.id,
      name,
      host,
      username,
      pem_path: destPemPath,
      created_at: new Date().toISOString(),
    };

    storageService.saveServer(serverConfig);
    logger.success(`Server "${name}" added successfully`);

    return serverConfig;
  }

  listServers(): IServerConfig[] {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return [];
    return storageService.getServersByProfileId(activeProfile.id);
  }

  getServer(id: string): IServerConfig | undefined {
    const servers = this.listServers();
    return servers.find((s) => s.id === id);
  }

  async deleteServer(id: string): Promise<boolean> {
    const server = this.getServer(id);
    if (!server) {
      logger.error("Server not found");
      return false;
    }

    // Delete PEM file
    try {
      await fs.unlink(server.pem_path);
    } catch (error) {
      logger.warn(`Could not delete PEM file at ${server.pem_path}`, error);
      // Continue to delete config even if file delete fails (maybe file is already gone)
    }

    const deleted = storageService.deleteServer(id);
    if (deleted) {
      logger.success(`Server "${server.name}" deleted`);
    }
    return deleted;
  }

  async connectToServer(id: string): Promise<void> {
    const server = this.getServer(id);
    if (!server) {
      logger.error("Server not found");
      return;
    }

    logger.info(`Connecting to ${server.name} (${server.host})...`);

    // Update last connected
    server.last_connected = new Date().toISOString();
    storageService.saveServer(server);

    // Add to recent actions
    if (server.profile_id) {
      profileService.addRecentAction(server.profile_id, {
        id: nanoid(),
        type: "ssh",
        serverId: server.id,
        name: `SSH ${server.name}`,
        timestamp: new Date().toISOString(),
      });
    }

    return new Promise((resolve, reject) => {
      const ssh = spawn(
        "ssh",
        ["-i", server.pem_path, `${server.username}@${server.host}`],
        {
          stdio: "inherit",
        }
      );

      ssh.on("close", (code) => {
        if (code === 0) {
          logger.success("Connection closed successfully");
          resolve();
        } else {
          logger.error(`Connection closed with code ${code}`);
          resolve(); // Resolve anyway to not crash CLI
        }
      });

      ssh.on("error", (err) => {
        logger.error("Failed to start SSH process", err);
        reject(err);
      });
    });
  }

  async addTunnel(
    serverId: string,
    tunnelConfig: Omit<ITunnelConfig, "id">
  ): Promise<ITunnelConfig | null> {
    const server = this.getServer(serverId);
    if (!server) {
      logger.error("Server not found");
      return null;
    }

    const newTunnel: ITunnelConfig = {
      ...tunnelConfig,
      id: nanoid(),
    };

    if (!server.tunnels) {
      server.tunnels = [];
    }

    server.tunnels.push(newTunnel);
    storageService.saveServer(server);
    logger.success(
      `Tunnel "${newTunnel.name}" added to server "${server.name}"`
    );

    return newTunnel;
  }

  async deleteTunnel(serverId: string, tunnelId: string): Promise<boolean> {
    const server = this.getServer(serverId);
    if (!server || !server.tunnels) {
      return false;
    }

    const initialLength = server.tunnels.length;
    server.tunnels = server.tunnels.filter((t) => t.id !== tunnelId);

    if (server.tunnels.length !== initialLength) {
      storageService.saveServer(server);
      logger.success("Tunnel deleted");
      return true;
    }

    return false;
  }

  async updateServer(
    serverId: string,
    updates: Partial<Pick<IServerConfig, "name" | "host" | "username">>
  ): Promise<IServerConfig | null> {
    const server = this.getServer(serverId);
    if (!server) {
      logger.error("Server not found");
      return null;
    }

    const updatedServer: IServerConfig = {
      ...server,
      ...updates,
    };

    storageService.saveServer(updatedServer);
    logger.success(`Server "${updatedServer.name}" updated`);
    return updatedServer;
  }

  async updateTunnel(
    serverId: string,
    tunnelId: string,
    updates: Partial<Omit<ITunnelConfig, "id">>
  ): Promise<ITunnelConfig | null> {
    const server = this.getServer(serverId);
    if (!server || !server.tunnels) {
      logger.error("Server or tunnels not found");
      return null;
    }

    const tunnelIndex = server.tunnels.findIndex((t) => t.id === tunnelId);
    if (tunnelIndex === -1) {
      logger.error("Tunnel not found");
      return null;
    }

    server.tunnels[tunnelIndex] = {
      ...server.tunnels[tunnelIndex],
      ...updates,
    };

    storageService.saveServer(server);
    logger.success(`Tunnel "${server.tunnels[tunnelIndex].name}" updated`);
    return server.tunnels[tunnelIndex];
  }

  getTunnelCommand(serverId: string, tunnelId: string): string | null {
    const server = this.getServer(serverId);
    if (!server || !server.tunnels) return null;

    const tunnel = server.tunnels.find((t) => t.id === tunnelId);
    if (!tunnel) return null;

    return `ssh -i ${server.pem_path} -N -L ${tunnel.localPort}:${tunnel.remoteHost}:${tunnel.remotePort} ${server.username}@${server.host} -o ServerAliveInterval=60 -o ServerAliveCountMax=3600`;
  }

  async startTunnel(
    serverId: string,
    tunnelId: string
  ): Promise<number | null> {
    const server = this.getServer(serverId);
    if (!server || !server.tunnels) {
      logger.error("Server or tunnel not found");
      return null;
    }

    const tunnel = server.tunnels.find((t) => t.id === tunnelId);
    if (!tunnel) {
      logger.error("Tunnel not found");
      return null;
    }

    const commandArgs = [
      "-i",
      server.pem_path,
      "-N", // Do not execute a remote command
      "-L",
      `${tunnel.localPort}:${tunnel.remoteHost}:${tunnel.remotePort}`,
      `${server.username}@${server.host}`,
      "-o",
      "ServerAliveInterval=60",
      "-o",
      "ServerAliveCountMax=3600",
    ];

    const commandString = `ssh ${commandArgs.join(" ")}`;

    console.log(
      boxen(styled.dimmed(commandString), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "gray",
        title: "Starting Tunnel in Background",
      })
    );

    try {
      const subprocess = spawn("ssh", commandArgs, {
        detached: true,
        stdio: "ignore", // Ignore output for background process
      });

      subprocess.unref();

      if (subprocess.pid) {
        logger.success(`Tunnel started in background (PID: ${subprocess.pid})`);
        logger.info(
          `Mapping: localhost:${tunnel.localPort} -> ${tunnel.remoteHost}:${tunnel.remotePort}`
        );

        // Save process info
        const processInfo: IBackgroundProcess = {
          pid: subprocess.pid,
          type: "tunnel",
          serverId: server.id,
          tunnelId: tunnel.id,
          name: `Tunnel ${server.name} -> ${tunnel.name}`,
          startTime: new Date().toISOString(),
        };
        storageService.saveProcess(processInfo);

        // Add to recent actions
        if (server.profile_id) {
          profileService.addRecentAction(server.profile_id, {
            id: nanoid(),
            type: "tunnel",
            serverId: server.id,
            tunnelId: tunnel.id,
            name: `Tunnel ${server.name} -> ${tunnel.name}`,
            timestamp: new Date().toISOString(),
          });
        }

        return subprocess.pid;
      } else {
        logger.error("Failed to get process PID");
        return null;
      }
    } catch (error) {
      logger.error("Failed to start tunnel process", error);
      return null;
    }
  }

  listProcesses(): IBackgroundProcess[] {
    // Use processService for consistent process management
    return processService.getProcessesByType("tunnel");
  }

  async killProcess(pid: number): Promise<boolean> {
    // Use processService for consistent process management
    return processService.killProcess(pid);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Synced Files Management
  // ═══════════════════════════════════════════════════════════════════════════════

  async addSyncedFile(
    serverId: string,
    syncedFile: Omit<ISyncedFile, "id" | "created_at">
  ): Promise<ISyncedFile | null> {
    const server = this.getServer(serverId);
    if (!server) {
      logger.error("Server not found");
      return null;
    }

    const newSyncedFile: ISyncedFile = {
      ...syncedFile,
      id: nanoid(),
      created_at: new Date().toISOString(),
    };

    if (!server.synced_files) {
      server.synced_files = [];
    }

    server.synced_files.push(newSyncedFile);
    storageService.saveServer(server);
    logger.success(
      `Synced file "${newSyncedFile.name}" added to "${server.name}"`
    );

    return newSyncedFile;
  }

  async updateSyncedFile(
    serverId: string,
    syncedFileId: string,
    updates: Partial<Omit<ISyncedFile, "id" | "created_at">>
  ): Promise<ISyncedFile | null> {
    const server = this.getServer(serverId);
    if (!server || !server.synced_files) {
      return null;
    }

    const index = server.synced_files.findIndex((sf) => sf.id === syncedFileId);
    if (index === -1) {
      return null;
    }

    server.synced_files[index] = {
      ...server.synced_files[index],
      ...updates,
    };

    storageService.saveServer(server);
    return server.synced_files[index];
  }

  async deleteSyncedFile(
    serverId: string,
    syncedFileId: string
  ): Promise<boolean> {
    const server = this.getServer(serverId);
    if (!server || !server.synced_files) {
      return false;
    }

    const initialLength = server.synced_files.length;
    server.synced_files = server.synced_files.filter(
      (sf) => sf.id !== syncedFileId
    );

    if (server.synced_files.length !== initialLength) {
      storageService.saveServer(server);
      logger.success("Synced file deleted");
      return true;
    }

    return false;
  }

  getSyncedFile(serverId: string, syncedFileId: string): ISyncedFile | null {
    const server = this.getServer(serverId);
    if (!server || !server.synced_files) {
      return null;
    }
    return server.synced_files.find((sf) => sf.id === syncedFileId) || null;
  }

  /**
   * Sync a local file to the remote server using SCP
   */
  async syncFileToRemote(
    serverId: string,
    syncedFileId: string
  ): Promise<{ success: boolean; error?: string }> {
    const server = this.getServer(serverId);
    if (!server) {
      return { success: false, error: "Server not found" };
    }

    const syncedFile = this.getSyncedFile(serverId, syncedFileId);
    if (!syncedFile) {
      return { success: false, error: "Synced file not found" };
    }

    // Expand local path
    const localPath = this.expandPath(syncedFile.local_path);

    // Check if local file exists
    try {
      await fs.access(localPath, constants.R_OK);
    } catch {
      return { success: false, error: `Local file not found: ${localPath}` };
    }

    // Build SCP command
    const scpCommand = `scp -i "${server.pem_path}" "${localPath}" "${server.username}@${server.host}:${syncedFile.remote_path}"`;

    return new Promise((resolve) => {
      exec(scpCommand, (error, _stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          // Update last_synced timestamp
          this.updateSyncedFile(serverId, syncedFileId, {
            last_synced: new Date().toISOString(),
          });
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * View a remote file's contents using SSH
   */
  async viewRemoteFile(
    serverId: string,
    remotePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    const server = this.getServer(serverId);
    if (!server) {
      return { success: false, error: "Server not found" };
    }

    const sshCommand = `ssh -i "${server.pem_path}" "${server.username}@${server.host}" "cat '${remotePath}'"`;

    return new Promise((resolve) => {
      exec(sshCommand, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, content: stdout });
        }
      });
    });
  }

  /**
   * List files in a remote directory using SSH
   */
  async listRemoteDirectory(
    serverId: string,
    remotePath: string
  ): Promise<{ success: boolean; files?: IRemoteFile[]; error?: string }> {
    const server = this.getServer(serverId);
    if (!server) {
      return { success: false, error: "Server not found" };
    }

    // Use ls -la to get detailed file listing including hidden files
    // Format: permissions links owner group size month day time/year name
    const sshCommand = `ssh -i "${server.pem_path}" "${server.username}@${server.host}" "ls -laF '${remotePath}' 2>/dev/null || echo 'ERROR_DIR_NOT_FOUND'"`;

    return new Promise((resolve) => {
      exec(sshCommand, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }

        if (stdout.includes("ERROR_DIR_NOT_FOUND")) {
          resolve({ success: false, error: "Directory not found" });
          return;
        }

        const lines = stdout.trim().split("\n");
        const files: IRemoteFile[] = [];

        for (const line of lines) {
          // Skip total line
          if (line.startsWith("total ")) continue;

          // Parse ls -laF output
          const parts = line.split(/\s+/);
          if (parts.length < 9) continue;

          const permissions = parts[0];
          const name = parts
            .slice(8)
            .join(" ")
            .replace(/[@*\/=|]$/, ""); // Remove type indicators
          const isDirectory = permissions.startsWith("d");
          const isHidden = name.startsWith(".");
          const size = parseInt(parts[4], 10);

          // Skip . and .. but keep other hidden files
          if (name === "." || name === "..") continue;

          files.push({
            name,
            path: remotePath === "/" ? `/${name}` : `${remotePath}/${name}`,
            isDirectory,
            isHidden,
            size,
            permissions,
          });
        }

        // Sort: directories first, then by name
        files.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        resolve({ success: true, files });
      });
    });
  }

  /**
   * Get the SSH command string for a server
   */
  getSSHCommand(serverId: string): string | null {
    const server = this.getServer(serverId);
    if (!server) return null;
    return `ssh -i "${server.pem_path}" "${server.username}@${server.host}"`;
  }
}

/**
 * Remote file info from ls command
 */
interface IRemoteFile {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
  size: number;
  permissions: string;
}

export const serverService = new ServerService();

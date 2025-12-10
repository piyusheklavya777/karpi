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
} from "../types";

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
    const processes = storageService.getAllProcesses();
    // Filter out dead processes
    const activeProcesses = processes.filter((p) => {
      try {
        process.kill(p.pid, 0); // Check if process exists
        return true;
      } catch (e) {
        return false;
      }
    });

    // Update storage if some were removed
    if (activeProcesses.length !== processes.length) {
      // We can't easily bulk replace, but we can clear and re-add or just accept it updates on next modify
      // For now, let's just return active ones.
      // Ideally we should clean up dead ones from storage.
      // But StorageService doesn't expose bulk set.
    }

    return activeProcesses;
  }

  async killProcess(pid: number): Promise<boolean> {
    try {
      process.kill(pid);
      storageService.deleteProcess(pid);
      logger.success(`Process ${pid} killed`);
      return true;
    } catch (error) {
      // If process doesn't exist, remove it anyway
      storageService.deleteProcess(pid);
      logger.warn(`Process ${pid} not found (removed from registry)`);
      return false;
    }
  }
}

export const serverService = new ServerService();

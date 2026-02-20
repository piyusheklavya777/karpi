// src/commands/cli/servers.cmd.ts

import { Command } from "commander";
import {
  requireAuth,
  resolveServer,
  resolveTunnel,
  resolveSyncedFile,
  output,
  outputError,
  outputSuccess,
  outputTable,
} from "../../utils/cli-helpers";
import { serverService } from "../../services/server.service";
import { processService } from "../../services/process.service";

export function registerServersCommand(program: Command): void {
  const servers = program
    .command("servers")
    .description("Manage SSH servers and tunnels");

  // ── servers list ──────────────────────────────────────────────────────────
  servers
    .command("list")
    .description("List all servers")
    .action(() => {
      requireAuth();
      const list = serverService.listServers();
      output(
        list.map((s) => ({
          name: s.name,
          host: s.host,
          username: s.username,
          tunnels: (s.tunnels || []).length,
          synced_files: (s.synced_files || []).length,
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "host", header: "Host" },
            { key: "username", header: "User" },
            { key: "tunnels", header: "Tunnels" },
            { key: "synced_files", header: "Synced Files" },
          ]);
        }
      );
    });

  // ── servers show <name> ───────────────────────────────────────────────────
  servers
    .command("show <name>")
    .description("Show server details")
    .action((name: string) => {
      requireAuth();
      const server = resolveServer(name);
      output(server, (data) => {
        const s = data as typeof server;
        console.log(`\nServer: ${s.name}`);
        console.log(`  Host:     ${s.host}`);
        console.log(`  User:     ${s.username}`);
        console.log(`  PEM:      ${s.pem_path}`);
        console.log(`  Created:  ${s.created_at}`);
        if (s.last_connected) console.log(`  Last SSH: ${s.last_connected}`);

        if (s.tunnels && s.tunnels.length > 0) {
          console.log(`\n  Tunnels (${s.tunnels.length}):`);
          for (const t of s.tunnels) {
            const proc = processService
              .listActiveProcesses()
              .find((p) => p.tunnelId === t.id);
            const status = proc ? `running (PID ${proc.pid})` : "stopped";
            console.log(
              `    - ${t.name}: localhost:${t.localPort} -> ${t.remoteHost}:${t.remotePort} [${t.type}] (${status})`
            );
          }
        }

        if (s.synced_files && s.synced_files.length > 0) {
          console.log(`\n  Synced Files (${s.synced_files.length}):`);
          for (const f of s.synced_files) {
            console.log(`    - ${f.name}: ${f.local_path} -> ${f.remote_path}`);
            if (f.last_synced) console.log(`      Last synced: ${f.last_synced}`);
          }
        }
      });
    });

  // ── servers add <name> <host> <username> <pem-path> ───────────────────────
  servers
    .command("add <name> <host> <username> <pem-path>")
    .description("Add a new server")
    .action(async (name: string, host: string, username: string, pemPath: string) => {
      requireAuth();
      const server = await serverService.addServer(name, host, username, pemPath);
      if (server) {
        outputSuccess(`Server "${name}" added`, { server });
      } else {
        outputError("Failed to add server");
        process.exit(1);
      }
    });

  // ── servers edit <name> ───────────────────────────────────────────────────
  servers
    .command("edit <name>")
    .description("Edit server properties")
    .option("--name <new-name>", "New server name")
    .option("--host <host>", "New host")
    .option("--user <username>", "New username")
    .action(async (name: string, opts: { name?: string; host?: string; user?: string }) => {
      requireAuth();
      const server = resolveServer(name);
      const updates: Record<string, string> = {};
      if (opts.name) updates.name = opts.name;
      if (opts.host) updates.host = opts.host;
      if (opts.user) updates.username = opts.user;

      if (Object.keys(updates).length === 0) {
        outputError("No updates specified. Use --name, --host, or --user.");
        process.exit(1);
      }

      const updated = await serverService.updateServer(server.id, updates);
      if (updated) {
        outputSuccess(`Server "${name}" updated`, { server: updated });
      } else {
        outputError("Failed to update server");
        process.exit(1);
      }
    });

  // ── servers remove <name> ─────────────────────────────────────────────────
  servers
    .command("remove <name>")
    .description("Delete a server")
    .action(async (name: string) => {
      requireAuth();
      const server = resolveServer(name);
      const deleted = await serverService.deleteServer(server.id);
      if (deleted) {
        outputSuccess(`Server "${name}" deleted`);
      } else {
        outputError("Failed to delete server");
        process.exit(1);
      }
    });

  // ── servers ssh <name> ────────────────────────────────────────────────────
  servers
    .command("ssh <name>")
    .description("SSH connect to server (interactive)")
    .action(async (name: string) => {
      requireAuth();
      const server = resolveServer(name);
      await serverService.connectToServer(server.id);
    });

  // ── servers ssh-command <name> ────────────────────────────────────────────
  servers
    .command("ssh-command <name>")
    .description("Print SSH command string (for scripting)")
    .action((name: string) => {
      requireAuth();
      const server = resolveServer(name);
      const cmd = serverService.getSSHCommand(server.id);
      if (cmd) {
        output({ command: cmd }, () => console.log(cmd));
      } else {
        outputError("Failed to get SSH command");
        process.exit(1);
      }
    });

  // ── servers sync <server-name> <file-name> ────────────────────────────────
  servers
    .command("sync <server-name> <file-name>")
    .description("Sync a file to remote server")
    .action(async (serverName: string, fileName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const syncedFile = resolveSyncedFile(server, fileName);
      const result = await serverService.syncFileToRemote(server.id, syncedFile.id);
      if (result.success) {
        outputSuccess(`File "${fileName}" synced to ${server.name}`);
      } else {
        outputError(result.error || "Sync failed");
        process.exit(1);
      }
    });

  // ── servers tunnel ────────────────────────────────────────────────────────
  const tunnel = servers
    .command("tunnel")
    .description("Manage tunnels");

  // tunnel list <server-name>
  tunnel
    .command("list <server-name>")
    .description("List tunnels for a server")
    .action((serverName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tunnels = server.tunnels || [];
      const activeProcesses = processService.listActiveProcesses();

      output(
        tunnels.map((t) => {
          const proc = activeProcesses.find((p) => p.tunnelId === t.id);
          return {
            name: t.name,
            type: t.type,
            local_port: t.localPort,
            remote_host: t.remoteHost,
            remote_port: t.remotePort,
            status: proc ? "running" : "stopped",
            pid: proc?.pid ?? null,
          };
        }),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "type", header: "Type" },
            { key: "local_port", header: "Local Port" },
            { key: "remote_host", header: "Remote Host" },
            { key: "remote_port", header: "Remote Port" },
            { key: "status", header: "Status" },
            { key: "pid", header: "PID" },
          ]);
        }
      );
    });

  // tunnel add <srv> <tun-name> <local-port> <remote-host> <remote-port>
  tunnel
    .command("add <server-name> <tunnel-name> <local-port> <remote-host> <remote-port>")
    .description("Add a tunnel to a server")
    .option("--type <type>", "Tunnel type (custom, rds, redis, service)", "custom")
    .action(
      async (
        serverName: string,
        tunnelName: string,
        localPort: string,
        remoteHost: string,
        remotePort: string,
        opts: { type: string }
      ) => {
        requireAuth();
        const server = resolveServer(serverName);
        const result = await serverService.addTunnel(server.id, {
          name: tunnelName,
          type: opts.type as "custom" | "rds" | "redis" | "service",
          localPort: parseInt(localPort, 10),
          remoteHost,
          remotePort: parseInt(remotePort, 10),
        });
        if (result) {
          outputSuccess(`Tunnel "${tunnelName}" added to "${server.name}"`, {
            tunnel: result,
          });
        } else {
          outputError("Failed to add tunnel");
          process.exit(1);
        }
      }
    );

  // tunnel remove <server-name> <tunnel-name>
  tunnel
    .command("remove <server-name> <tunnel-name>")
    .description("Delete a tunnel")
    .action(async (serverName: string, tunnelName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tun = resolveTunnel(server, tunnelName);

      // Stop tunnel if running
      const proc = processService
        .listActiveProcesses()
        .find((p) => p.tunnelId === tun.id);
      if (proc) {
        await processService.killProcess(proc.pid);
      }

      const deleted = await serverService.deleteTunnel(server.id, tun.id);
      if (deleted) {
        outputSuccess(`Tunnel "${tunnelName}" deleted`);
      } else {
        outputError("Failed to delete tunnel");
        process.exit(1);
      }
    });

  // tunnel start <server-name> <tunnel-name>
  tunnel
    .command("start <server-name> <tunnel-name>")
    .description("Start tunnel in background")
    .action(async (serverName: string, tunnelName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tun = resolveTunnel(server, tunnelName);
      const pid = await serverService.startTunnel(server.id, tun.id);
      if (pid) {
        outputSuccess(
          `Tunnel "${tunnelName}" started (PID: ${pid})`,
          { pid, local_port: tun.localPort }
        );
      } else {
        outputError("Failed to start tunnel");
        process.exit(1);
      }
    });

  // tunnel stop <server-name> <tunnel-name>
  tunnel
    .command("stop <server-name> <tunnel-name>")
    .description("Stop running tunnel")
    .action(async (serverName: string, tunnelName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tun = resolveTunnel(server, tunnelName);
      const proc = processService
        .listActiveProcesses()
        .find((p) => p.tunnelId === tun.id);

      if (!proc) {
        outputError(`Tunnel "${tunnelName}" is not running`);
        process.exit(1);
      }

      const killed = await processService.killProcess(proc.pid);
      if (killed) {
        outputSuccess(`Tunnel "${tunnelName}" stopped`);
      } else {
        outputError("Failed to stop tunnel");
        process.exit(1);
      }
    });

  // tunnel status <server-name> <tunnel-name>
  tunnel
    .command("status <server-name> <tunnel-name>")
    .description("Show tunnel running status")
    .action((serverName: string, tunnelName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tun = resolveTunnel(server, tunnelName);
      const proc = processService
        .listActiveProcesses()
        .find((p) => p.tunnelId === tun.id);

      const statusData = {
        tunnel: tun.name,
        server: server.name,
        running: !!proc,
        pid: proc?.pid ?? null,
        local_port: tun.localPort,
        remote: `${tun.remoteHost}:${tun.remotePort}`,
        started_at: proc?.startTime ?? null,
      };

      output(statusData, (data) => {
        const d = data as typeof statusData;
        console.log(`Tunnel: ${d.tunnel} on ${d.server}`);
        console.log(`Status: ${d.running ? "running" : "stopped"}`);
        if (d.pid) console.log(`PID:    ${d.pid}`);
        console.log(`Local:  localhost:${d.local_port}`);
        console.log(`Remote: ${d.remote}`);
        if (d.started_at) console.log(`Started: ${d.started_at}`);
      });
    });

  // tunnel command <server-name> <tunnel-name>
  tunnel
    .command("command <server-name> <tunnel-name>")
    .description("Print SSH tunnel command")
    .action((serverName: string, tunnelName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const tun = resolveTunnel(server, tunnelName);
      const cmd = serverService.getTunnelCommand(server.id, tun.id);
      if (cmd) {
        output({ command: cmd }, () => console.log(cmd));
      } else {
        outputError("Failed to get tunnel command");
        process.exit(1);
      }
    });

  // ── servers sync-file ─────────────────────────────────────────────────────
  const syncFile = servers
    .command("sync-file")
    .description("Manage synced files");

  // sync-file list <server-name>
  syncFile
    .command("list <server-name>")
    .description("List synced files for a server")
    .action((serverName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const files = server.synced_files || [];

      output(
        files.map((f) => ({
          name: f.name,
          local_path: f.local_path,
          remote_path: f.remote_path,
          last_synced: f.last_synced || "never",
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "local_path", header: "Local Path" },
            { key: "remote_path", header: "Remote Path" },
            { key: "last_synced", header: "Last Synced" },
          ]);
        }
      );
    });

  // sync-file add <srv> <name> <local-path> <remote-path>
  syncFile
    .command("add <server-name> <file-name> <local-path> <remote-path>")
    .description("Add synced file config")
    .action(
      async (
        serverName: string,
        fileName: string,
        localPath: string,
        remotePath: string
      ) => {
        requireAuth();
        const server = resolveServer(serverName);
        const result = await serverService.addSyncedFile(server.id, {
          name: fileName,
          local_path: localPath,
          remote_path: remotePath,
        });
        if (result) {
          outputSuccess(`Synced file "${fileName}" added to "${server.name}"`, {
            synced_file: result,
          });
        } else {
          outputError("Failed to add synced file");
          process.exit(1);
        }
      }
    );

  // sync-file remove <server-name> <file-name>
  syncFile
    .command("remove <server-name> <file-name>")
    .description("Remove synced file config")
    .action(async (serverName: string, fileName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const sf = resolveSyncedFile(server, fileName);
      const deleted = await serverService.deleteSyncedFile(server.id, sf.id);
      if (deleted) {
        outputSuccess(`Synced file "${fileName}" removed`);
      } else {
        outputError("Failed to remove synced file");
        process.exit(1);
      }
    });

  // sync-file push <server-name> <file-name>
  syncFile
    .command("push <server-name> <file-name>")
    .description("Push/sync file to remote")
    .action(async (serverName: string, fileName: string) => {
      requireAuth();
      const server = resolveServer(serverName);
      const sf = resolveSyncedFile(server, fileName);
      const result = await serverService.syncFileToRemote(server.id, sf.id);
      if (result.success) {
        outputSuccess(`File "${fileName}" synced to ${server.name}`);
      } else {
        outputError(result.error || "Sync failed");
        process.exit(1);
      }
    });
}

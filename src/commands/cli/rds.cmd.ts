// src/commands/cli/rds.cmd.ts

import { Command } from "commander";
import { nanoid } from "nanoid";
import {
  requireAuth,
  resolveRDS,
  resolveServer,
  resolveAWSProfile,
  output,
  outputError,
  outputSuccess,
  outputTable,
} from "../../utils/cli-helpers";
import { storageService } from "../../services/storage.service";
import { serverService } from "../../services/server.service";
import { processService } from "../../services/process.service";
import { profileService } from "../../services/profile.service";
import { awsService } from "../../services/aws.service";
import type { IRDSInstance, TRDSEngine } from "../../types";

export function registerRDSCommand(program: Command): void {
  const rds = program.command("rds").description("Manage RDS databases");

  // ── rds list ──────────────────────────────────────────────────────────────
  rds
    .command("list")
    .description("List all RDS instances")
    .action(() => {
      requireAuth();
      const profileId = storageService.getActiveProfileId();
      const instances = profileId
        ? storageService.getRDSByProfileId(profileId)
        : [];

      output(
        instances.map((r) => {
          const tunnelRunning = r.linked_tunnel_id
            ? processService
                .listActiveProcesses()
                .some((p) => p.tunnelId === r.linked_tunnel_id)
            : false;
          return {
            name: r.name,
            engine: r.engine,
            endpoint: r.endpoint,
            port: r.port,
            linked_server: r.linked_server_id ? "yes" : "no",
            tunnel: tunnelRunning ? "running" : r.linked_tunnel_id ? "stopped" : "none",
            local_port: r.local_port || null,
          };
        }),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "engine", header: "Engine" },
            { key: "endpoint", header: "Endpoint" },
            { key: "port", header: "Port" },
            { key: "linked_server", header: "Server" },
            { key: "tunnel", header: "Tunnel" },
            { key: "local_port", header: "Local Port" },
          ]);
        }
      );
    });

  // ── rds show <name> ───────────────────────────────────────────────────────
  rds
    .command("show <name>")
    .description("Show RDS details + tunnel status")
    .action((name: string) => {
      requireAuth();
      const instance = resolveRDS(name);
      const tunnelRunning = instance.linked_tunnel_id
        ? processService
            .listActiveProcesses()
            .some((p) => p.tunnelId === instance.linked_tunnel_id)
        : false;

      output(
        { ...instance, tunnel_running: tunnelRunning },
        (data) => {
          const r = data as IRDSInstance & { tunnel_running: boolean };
          console.log(`\nRDS: ${r.name}`);
          console.log(`  Engine:     ${awsService.getEngineDisplayName(r.engine)} ${r.engine_version}`);
          console.log(`  Endpoint:   ${r.endpoint}:${r.port}`);
          if (r.db_name) console.log(`  Database:   ${r.db_name}`);
          if (r.master_username) console.log(`  Username:   ${r.master_username}`);
          console.log(`  Region:     ${r.aws_region}`);
          console.log(`  Status:     ${r.status}`);
          if (r.linked_server_id) {
            const server = serverService.getServer(r.linked_server_id);
            console.log(`  Server:     ${server?.name || r.linked_server_id}`);
          }
          if (r.local_port) console.log(`  Local Port: ${r.local_port}`);
          console.log(`  Tunnel:     ${r.tunnel_running ? "running" : "stopped"}`);
        }
      );
    });

  // ── rds add <name> <endpoint> <port> <engine> ─────────────────────────────
  rds
    .command("add <name> <endpoint> <port> <engine>")
    .description("Add an RDS instance")
    .requiredOption("--aws-profile <profile>", "AWS profile name")
    .option("--db-name <name>", "Database name")
    .option("--username <user>", "Master username")
    .option("--region <region>", "AWS region")
    .option("--local-port <port>", "Local port for tunneling")
    .action(
      (
        name: string,
        endpoint: string,
        port: string,
        engine: string,
        opts: {
          awsProfile: string;
          dbName?: string;
          username?: string;
          region?: string;
          localPort?: string;
        }
      ) => {
        requireAuth();
        const awsProfile = resolveAWSProfile(opts.awsProfile);
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) {
          outputError("No active profile");
          process.exit(1);
        }

        const instance: IRDSInstance = {
          id: nanoid(),
          name,
          profile_id: activeProfile.id,
          aws_profile_id: awsProfile.id,
          db_instance_identifier: name,
          endpoint,
          port: parseInt(port, 10),
          engine: engine as TRDSEngine,
          engine_version: "",
          db_name: opts.dbName,
          master_username: opts.username,
          status: "available",
          aws_region: opts.region || awsProfile.default_region,
          local_port: opts.localPort ? parseInt(opts.localPort, 10) : undefined,
          created_at: new Date().toISOString(),
        };

        storageService.saveRDSInstance(instance);
        outputSuccess(`RDS instance "${name}" added`, { rds: instance });
      }
    );

  // ── rds edit <name> ───────────────────────────────────────────────────────
  rds
    .command("edit <name>")
    .description("Edit RDS instance")
    .option("--name <new-name>", "New name")
    .option("--endpoint <endpoint>", "New endpoint")
    .option("--port <port>", "New port")
    .option("--local-port <port>", "New local port")
    .option("--db-name <name>", "New database name")
    .option("--username <user>", "New username")
    .action(
      (
        name: string,
        opts: {
          name?: string;
          endpoint?: string;
          port?: string;
          localPort?: string;
          dbName?: string;
          username?: string;
        }
      ) => {
        requireAuth();
        const instance = resolveRDS(name);

        const updates: Partial<IRDSInstance> = {};
        if (opts.name) updates.name = opts.name;
        if (opts.endpoint) updates.endpoint = opts.endpoint;
        if (opts.port) updates.port = parseInt(opts.port, 10);
        if (opts.localPort) updates.local_port = parseInt(opts.localPort, 10);
        if (opts.dbName) updates.db_name = opts.dbName;
        if (opts.username) updates.master_username = opts.username;

        if (Object.keys(updates).length === 0) {
          outputError("No updates specified.");
          process.exit(1);
        }

        const updated = storageService.updateRDSInstance(instance.id, updates);
        if (updated) {
          outputSuccess(`RDS instance "${name}" updated`);
        } else {
          outputError("Failed to update RDS instance");
          process.exit(1);
        }
      }
    );

  // ── rds remove <name> ─────────────────────────────────────────────────────
  rds
    .command("remove <name>")
    .description("Delete RDS instance")
    .action(async (name: string) => {
      requireAuth();
      const instance = resolveRDS(name);

      // Stop tunnel if running
      if (instance.linked_tunnel_id && instance.linked_server_id) {
        const proc = processService
          .listActiveProcesses()
          .find((p) => p.tunnelId === instance.linked_tunnel_id);
        if (proc) {
          await processService.killProcess(proc.pid);
        }
        // Remove the tunnel from the server
        await serverService.deleteTunnel(
          instance.linked_server_id,
          instance.linked_tunnel_id
        );
      }

      const deleted = storageService.deleteRDSInstance(instance.id);
      if (deleted) {
        outputSuccess(`RDS instance "${name}" deleted`);
      } else {
        outputError("Failed to delete RDS instance");
        process.exit(1);
      }
    });

  // ── rds link <rds-name> <server-name> ─────────────────────────────────────
  rds
    .command("link <rds-name> <server-name>")
    .description("Link RDS to server for tunneling")
    .action(async (rdsName: string, serverName: string) => {
      requireAuth();
      const instance = resolveRDS(rdsName);
      const server = resolveServer(serverName);

      // Create a tunnel on the server for this RDS
      const localPort = instance.local_port || awsService.getDefaultPort(instance.engine);
      const tunnel = await serverService.addTunnel(server.id, {
        name: `rds-${instance.name}`,
        type: "rds",
        localPort,
        remoteHost: instance.endpoint,
        remotePort: instance.port,
        metadata: {
          dbUsername: instance.master_username,
          dbName: instance.db_name,
        },
      });

      if (tunnel) {
        storageService.updateRDSInstance(instance.id, {
          linked_server_id: server.id,
          linked_tunnel_id: tunnel.id,
          local_port: localPort,
        });
        outputSuccess(
          `RDS "${rdsName}" linked to server "${serverName}" (local port: ${localPort})`,
          { tunnel_id: tunnel.id }
        );
      } else {
        outputError("Failed to create tunnel for RDS link");
        process.exit(1);
      }
    });

  // ── rds unlink <rds-name> ─────────────────────────────────────────────────
  rds
    .command("unlink <rds-name>")
    .description("Unlink server from RDS")
    .action(async (rdsName: string) => {
      requireAuth();
      const instance = resolveRDS(rdsName);

      if (!instance.linked_server_id || !instance.linked_tunnel_id) {
        outputError(`RDS "${rdsName}" is not linked to any server`);
        process.exit(1);
      }

      // Stop tunnel if running
      const proc = processService
        .listActiveProcesses()
        .find((p) => p.tunnelId === instance.linked_tunnel_id);
      if (proc) {
        await processService.killProcess(proc.pid);
      }

      // Delete the tunnel from the server
      await serverService.deleteTunnel(
        instance.linked_server_id,
        instance.linked_tunnel_id
      );

      // Clear the link
      storageService.updateRDSInstance(instance.id, {
        linked_server_id: undefined,
        linked_tunnel_id: undefined,
      });

      outputSuccess(`RDS "${rdsName}" unlinked`);
    });

  // ── rds tunnel ────────────────────────────────────────────────────────────
  const rdsTunnel = rds.command("tunnel").description("Manage RDS tunnels");

  // rds tunnel start <name>
  rdsTunnel
    .command("start <name>")
    .description("Start tunnel to RDS via linked server")
    .action(async (name: string) => {
      requireAuth();
      const instance = resolveRDS(name);

      if (!instance.linked_server_id || !instance.linked_tunnel_id) {
        outputError(
          `RDS "${name}" is not linked to a server. Use: karpi rds link ${name} <server-name>`
        );
        process.exit(1);
      }

      const pid = await serverService.startTunnel(
        instance.linked_server_id,
        instance.linked_tunnel_id
      );
      if (pid) {
        outputSuccess(
          `RDS tunnel started for "${name}" (PID: ${pid}, local port: ${instance.local_port})`,
          { pid, local_port: instance.local_port }
        );
      } else {
        outputError("Failed to start RDS tunnel");
        process.exit(1);
      }
    });

  // rds tunnel stop <name>
  rdsTunnel
    .command("stop <name>")
    .description("Stop RDS tunnel")
    .action(async (name: string) => {
      requireAuth();
      const instance = resolveRDS(name);

      if (!instance.linked_tunnel_id) {
        outputError(`RDS "${name}" has no tunnel configured`);
        process.exit(1);
      }

      const proc = processService
        .listActiveProcesses()
        .find((p) => p.tunnelId === instance.linked_tunnel_id);

      if (!proc) {
        outputError(`RDS tunnel for "${name}" is not running`);
        process.exit(1);
      }

      const killed = await processService.killProcess(proc.pid);
      if (killed) {
        outputSuccess(`RDS tunnel for "${name}" stopped`);
      } else {
        outputError("Failed to stop RDS tunnel");
        process.exit(1);
      }
    });

  // ── rds connect <name> ────────────────────────────────────────────────────
  rds
    .command("connect <name>")
    .description("Show connection info (host:port)")
    .action((name: string) => {
      requireAuth();
      const instance = resolveRDS(name);

      const tunnelRunning = instance.linked_tunnel_id
        ? processService
            .listActiveProcesses()
            .some((p) => p.tunnelId === instance.linked_tunnel_id)
        : false;

      const connInfo = {
        name: instance.name,
        engine: instance.engine,
        host: tunnelRunning ? "localhost" : instance.endpoint,
        port: tunnelRunning ? instance.local_port || instance.port : instance.port,
        db_name: instance.db_name || null,
        username: instance.master_username || null,
        tunnel_active: tunnelRunning,
      };

      output(connInfo, (data) => {
        const d = data as typeof connInfo;
        console.log(`\nConnection info for "${d.name}":`);
        console.log(`  Host:     ${d.host}`);
        console.log(`  Port:     ${d.port}`);
        if (d.db_name) console.log(`  Database: ${d.db_name}`);
        if (d.username) console.log(`  Username: ${d.username}`);
        console.log(`  Engine:   ${awsService.getEngineDisplayName(instance.engine)}`);
        console.log(`  Tunnel:   ${d.tunnel_active ? "active" : "inactive"}`);
        if (!d.tunnel_active && instance.linked_server_id) {
          console.log(`\n  Start tunnel: karpi rds tunnel start ${name}`);
        }
      });
    });
}

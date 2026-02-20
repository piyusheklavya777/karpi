// src/commands/cli/status.cmd.ts

import { Command } from "commander";
import {
  requireAuth,
  output,
  outputTable,
} from "../../utils/cli-helpers";
import { serverService } from "../../services/server.service";
import { projectService } from "../../services/project.service";
import { processService } from "../../services/process.service";
import { storageService } from "../../services/storage.service";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Global overview: servers, projects, processes, RDS")
    .action(() => {
      requireAuth();

      const servers = serverService.listServers();
      const projects = projectService.listProjects();
      const processes = processService.listActiveProcesses();
      const profileId = storageService.getActiveProfileId();
      const rdsInstances = profileId
        ? storageService.getRDSByProfileId(profileId)
        : [];
      const awsProfiles = storageService.getAllAWSProfiles();

      const tunnelProcesses = processes.filter((p) => p.type === "tunnel");
      const commandProcesses = processes.filter((p) => p.type === "command");

      const statusData = {
        servers: {
          total: servers.length,
          tunnels: servers.reduce(
            (sum, s) => sum + (s.tunnels?.length || 0),
            0
          ),
          active_tunnels: tunnelProcesses.length,
        },
        projects: {
          total: projects.length,
          apps: projects.reduce((sum, p) => sum + p.apps.length, 0),
          active_commands: commandProcesses.length,
        },
        processes: {
          total: processes.length,
          tunnels: tunnelProcesses.length,
          commands: commandProcesses.length,
        },
        rds: {
          total: rdsInstances.length,
          linked: rdsInstances.filter((r) => r.linked_server_id).length,
        },
        aws_profiles: awsProfiles.length,
      };

      output(statusData, () => {
        console.log("\nKarpi Status\n");

        console.log(`Servers: ${statusData.servers.total}`);
        console.log(
          `  Tunnels: ${statusData.servers.tunnels} total, ${statusData.servers.active_tunnels} running`
        );

        console.log(`\nProjects: ${statusData.projects.total}`);
        console.log(
          `  Apps: ${statusData.projects.apps}, Commands running: ${statusData.projects.active_commands}`
        );

        console.log(
          `\nProcesses: ${statusData.processes.total} active`
        );
        if (processes.length > 0) {
          console.log("");
          outputTable(
            processes.map((p) => ({
              pid: p.pid,
              type: p.type,
              name: p.name,
              started_at: p.startTime,
            })),
            [
              { key: "pid", header: "PID" },
              { key: "type", header: "Type" },
              { key: "name", header: "Name" },
              { key: "started_at", header: "Started" },
            ]
          );
        }

        console.log(
          `\nRDS: ${statusData.rds.total} instances, ${statusData.rds.linked} linked`
        );
        console.log(`AWS Profiles: ${statusData.aws_profiles}`);
      });
    });
}

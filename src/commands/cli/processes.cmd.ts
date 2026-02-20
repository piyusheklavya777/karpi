// src/commands/cli/processes.cmd.ts

import { Command } from "commander";
import {
  requireAuth,
  output,
  outputError,
  outputSuccess,
  outputTable,
} from "../../utils/cli-helpers";
import { processService } from "../../services/process.service";

export function registerProcessesCommand(program: Command): void {
  const ps = program
    .command("processes")
    .alias("ps")
    .description("Manage background processes");

  // ── ps list ───────────────────────────────────────────────────────────────
  ps.command("list")
    .description("List all active processes")
    .action(() => {
      requireAuth();
      const processes = processService.listActiveProcesses();

      output(
        processes.map((p) => ({
          pid: p.pid,
          type: p.type,
          name: p.name,
          started_at: p.startTime,
          project_id: p.projectId || null,
          server_id: p.serverId || null,
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "pid", header: "PID" },
            { key: "type", header: "Type" },
            { key: "name", header: "Name" },
            { key: "started_at", header: "Started" },
          ]);
        }
      );
    });

  // ── ps kill <pid> ─────────────────────────────────────────────────────────
  ps.command("kill <pid>")
    .description("Kill process by PID")
    .action(async (pidStr: string) => {
      requireAuth();
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        outputError("Invalid PID");
        process.exit(1);
      }

      const killed = await processService.killProcess(pid);
      if (killed) {
        outputSuccess(`Process ${pid} killed`);
      } else {
        outputError(`Failed to kill process ${pid} (may already be dead)`);
        process.exit(1);
      }
    });

  // ── ps kill-all ───────────────────────────────────────────────────────────
  ps.command("kill-all")
    .description("Kill all background processes")
    .action(async () => {
      requireAuth();
      const processes = processService.listActiveProcesses();
      let killed = 0;

      for (const proc of processes) {
        const success = await processService.killProcess(proc.pid);
        if (success) killed++;
      }

      outputSuccess(`Killed ${killed}/${processes.length} process(es)`);
    });
}

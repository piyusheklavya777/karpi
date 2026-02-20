// src/commands/cli/projects.cmd.ts

import { Command } from "commander";
import {
  requireAuth,
  resolveProject,
  resolveApp,
  resolveCommand,
  output,
  outputError,
  outputSuccess,
  outputTable,
} from "../../utils/cli-helpers";
import { projectService } from "../../services/project.service";
import { processService } from "../../services/process.service";

export function registerProjectsCommand(program: Command): void {
  const projects = program
    .command("projects")
    .description("Manage code projects and commands");

  // ── projects list ─────────────────────────────────────────────────────────
  projects
    .command("list")
    .description("List all projects")
    .action(() => {
      requireAuth();
      const list = projectService.listProjects();
      output(
        list.map((p) => ({
          name: p.name,
          base_path: p.base_path,
          apps: p.apps.length,
          commands: p.commands.length,
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "base_path", header: "Base Path" },
            { key: "apps", header: "Apps" },
            { key: "commands", header: "Commands" },
          ]);
        }
      );
    });

  // ── projects show <name> ──────────────────────────────────────────────────
  projects
    .command("show <name>")
    .description("Show project details")
    .action((name: string) => {
      requireAuth();
      const project = resolveProject(name);
      const processes = processService.getProjectProcesses(project.id);

      output(project, (data) => {
        const p = data as typeof project;
        console.log(`\nProject: ${p.name}`);
        console.log(`  Path:    ${p.base_path}`);
        console.log(`  Created: ${p.created_at}`);

        if (p.commands.length > 0) {
          console.log(`\n  Project Commands (${p.commands.length}):`);
          for (const cmd of p.commands) {
            const proc = processService.getCommandProcess(cmd.id);
            const status = proc ? ` [running PID ${proc.pid}]` : "";
            console.log(`    - ${cmd.name} (${cmd.type})${status}`);
            if (cmd.command) console.log(`      ${cmd.command}`);
          }
        }

        if (p.apps.length > 0) {
          console.log(`\n  Apps (${p.apps.length}):`);
          for (const app of p.apps) {
            console.log(`    ${app.name} (${app.type}) [${app.relative_path}]`);
            for (const cmd of app.commands) {
              const proc = processService.getCommandProcess(cmd.id);
              const status = proc ? ` [running PID ${proc.pid}]` : "";
              console.log(`      - ${cmd.name} (${cmd.type})${status}`);
              if (cmd.command) console.log(`        ${cmd.command}`);
            }
          }
        }

        if (processes.length > 0) {
          console.log(`\n  Running Processes (${processes.length}):`);
          for (const proc of processes) {
            console.log(`    PID ${proc.pid}: ${proc.name} (since ${proc.startTime})`);
          }
        }
      });
    });

  // ── projects add <name> <base-path> ───────────────────────────────────────
  projects
    .command("add <name> <base-path>")
    .description("Create a new project")
    .action((name: string, basePath: string) => {
      requireAuth();
      const project = projectService.createProject(name, basePath);
      if (project) {
        outputSuccess(`Project "${name}" created`, { project });
      } else {
        outputError("Failed to create project");
        process.exit(1);
      }
    });

  // ── projects remove <name> ────────────────────────────────────────────────
  projects
    .command("remove <name>")
    .description("Delete project (kills running processes)")
    .action((name: string) => {
      requireAuth();
      const project = resolveProject(name);
      const deleted = projectService.deleteProject(project.id);
      if (deleted) {
        outputSuccess(`Project "${name}" deleted`);
      } else {
        outputError("Failed to delete project");
        process.exit(1);
      }
    });

  // ── projects run <project> <command> ──────────────────────────────────────
  projects
    .command("run <project> <command>")
    .description("Run a project-level or app command")
    .action(async (projectName: string, cmdName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const resolved = resolveCommand(project, cmdName);

      let pid: number | null;
      if (resolved.isProjectLevel) {
        pid = await projectService.runProjectCommand(project.id, resolved.command.id);
      } else {
        pid = await projectService.runAppCommand(
          project.id,
          resolved.app!.id,
          resolved.command.id
        );
      }

      if (pid) {
        outputSuccess(`Command "${cmdName}" started (PID: ${pid})`, { pid });
      } else {
        outputError(`Failed to start command "${cmdName}"`);
        process.exit(1);
      }
    });

  // ── projects stop <project> [command] ─────────────────────────────────────
  projects
    .command("stop <project> [command]")
    .description("Stop command(s) (all if no name given)")
    .action(async (projectName: string, cmdName?: string) => {
      requireAuth();
      const project = resolveProject(projectName);

      if (!cmdName) {
        const count = await projectService.stopAllProjectCommands(project.id);
        outputSuccess(`Stopped ${count} process(es) for project "${project.name}"`);
        return;
      }

      const resolved = resolveCommand(project, cmdName);
      const proc = processService.getCommandProcess(resolved.command.id);
      if (!proc) {
        outputError(`Command "${cmdName}" is not running`);
        process.exit(1);
      }

      const killed = await processService.killProcess(proc.pid);
      if (killed) {
        outputSuccess(`Command "${cmdName}" stopped`);
      } else {
        outputError(`Failed to stop command "${cmdName}"`);
        process.exit(1);
      }
    });

  // ── projects restart <project> <command> ──────────────────────────────────
  projects
    .command("restart <project> <command>")
    .description("Restart a project command")
    .action(async (projectName: string, cmdName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const resolved = resolveCommand(project, cmdName);

      let pid: number | null;
      if (resolved.isProjectLevel) {
        pid = await projectService.restartProjectCommand(
          project.id,
          resolved.command.id
        );
      } else {
        pid = await projectService.restartAppCommand(
          project.id,
          resolved.app!.id,
          resolved.command.id
        );
      }

      if (pid) {
        outputSuccess(`Command "${cmdName}" restarted (PID: ${pid})`, { pid });
      } else {
        outputError(`Failed to restart command "${cmdName}"`);
        process.exit(1);
      }
    });

  // ── projects status <project> ─────────────────────────────────────────────
  projects
    .command("status <project>")
    .description("Show running processes for project")
    .action((projectName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const processes = processService.getProjectProcesses(project.id);

      output(
        processes.map((p) => ({
          pid: p.pid,
          name: p.name,
          command_id: p.commandId,
          app_id: p.appId || null,
          started_at: p.startTime,
        })),
        (data) => {
          const rows = data as Record<string, unknown>[];
          if (rows.length === 0) {
            console.log(`No running processes for project "${project.name}"`);
            return;
          }
          console.log(`\nRunning processes for "${project.name}":\n`);
          outputTable(rows, [
            { key: "pid", header: "PID" },
            { key: "name", header: "Name" },
            { key: "started_at", header: "Started" },
          ]);
        }
      );
    });

  // ── projects app ──────────────────────────────────────────────────────────
  const app = projects.command("app").description("Manage apps within projects");

  // app list <project>
  app
    .command("list <project>")
    .description("List apps in a project")
    .action((projectName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      output(
        project.apps.map((a) => ({
          name: a.name,
          type: a.type,
          relative_path: a.relative_path,
          commands: a.commands.length,
        })),
        (data) => {
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "type", header: "Type" },
            { key: "relative_path", header: "Path" },
            { key: "commands", header: "Commands" },
          ]);
        }
      );
    });

  // app add <project> <app-name> <type> <relative-path>
  app
    .command("add <project> <app-name> <type> <relative-path>")
    .description("Add an app to a project")
    .action(
      (projectName: string, appName: string, type: string, relativePath: string) => {
        requireAuth();
        const project = resolveProject(projectName);
        const result = projectService.addApp(project.id, {
          name: appName,
          type: type as "nextjs" | "expressjs" | "database_tunnel" | "custom",
          relative_path: relativePath,
        });
        if (result) {
          outputSuccess(`App "${appName}" added to "${project.name}"`, {
            app: result,
          });
        } else {
          outputError("Failed to add app");
          process.exit(1);
        }
      }
    );

  // app remove <project> <app-name>
  app
    .command("remove <project> <app-name>")
    .description("Delete an app")
    .action((projectName: string, appName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const appObj = resolveApp(project, appName);
      const deleted = projectService.deleteApp(project.id, appObj.id);
      if (deleted) {
        outputSuccess(`App "${appName}" deleted`);
      } else {
        outputError("Failed to delete app");
        process.exit(1);
      }
    });

  // app detect <project>
  app
    .command("detect <project>")
    .description("Auto-detect apps in project directory")
    .action(async (projectName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const detected = await projectService.detectApps(project.base_path);
      output(detected, (data) => {
        const apps = data as typeof detected;
        if (apps.length === 0) {
          console.log("No apps detected.");
          return;
        }
        console.log(`\nDetected ${apps.length} app(s):\n`);
        outputTable(
          apps.map((a) => ({
            name: a.name,
            type: a.type,
            path: a.relativePath,
            scripts: a.scripts.join(", "),
          })),
          [
            { key: "name", header: "Name" },
            { key: "type", header: "Type" },
            { key: "path", header: "Path" },
            { key: "scripts", header: "Scripts" },
          ]
        );
      });
    });

  // ── projects cmd ──────────────────────────────────────────────────────────
  const cmd = projects
    .command("cmd")
    .description("Manage commands (project & app level)");

  // cmd list <project> [app]
  cmd
    .command("list <project> [app]")
    .description("List commands (project-level or app-level)")
    .action((projectName: string, appName?: string) => {
      requireAuth();
      const project = resolveProject(projectName);

      if (appName) {
        const appObj = resolveApp(project, appName);
        output(
          appObj.commands.map((c) => ({
            name: c.name,
            type: c.type,
            command: c.command || (c.steps ? `${c.steps.length} steps` : ""),
            auto_restart: c.auto_restart || false,
          })),
          (data) => {
            console.log(`\nCommands for app "${appObj.name}":\n`);
            outputTable(data as Record<string, unknown>[], [
              { key: "name", header: "Name" },
              { key: "type", header: "Type" },
              { key: "command", header: "Command" },
              { key: "auto_restart", header: "Auto-Restart" },
            ]);
          }
        );
      } else {
        // Show all commands (project + apps)
        const allCmds: Record<string, unknown>[] = [];

        for (const c of project.commands) {
          allCmds.push({
            name: c.name,
            level: "project",
            type: c.type,
            command: c.command || (c.steps ? `${c.steps.length} steps` : ""),
            auto_restart: c.auto_restart || false,
          });
        }

        for (const a of project.apps) {
          for (const c of a.commands) {
            allCmds.push({
              name: c.name,
              level: `app:${a.name}`,
              type: c.type,
              command: c.command || (c.steps ? `${c.steps.length} steps` : ""),
              auto_restart: c.auto_restart || false,
            });
          }
        }

        output(allCmds, (data) => {
          console.log(`\nAll commands for "${project.name}":\n`);
          outputTable(data as Record<string, unknown>[], [
            { key: "name", header: "Name" },
            { key: "level", header: "Level" },
            { key: "type", header: "Type" },
            { key: "command", header: "Command" },
            { key: "auto_restart", header: "Auto-Restart" },
          ]);
        });
      }
    });

  // cmd add <project> <cmd-name> <command-string>
  cmd
    .command("add <project> <cmd-name> <command-string>")
    .description("Add a command")
    .option("--app <app-name>", "Add to a specific app (otherwise project-level)")
    .option("--auto-restart", "Enable auto-restart")
    .option("--poll-interval <ms>", "Poll interval in ms for auto-restart")
    .action(
      (
        projectName: string,
        cmdName: string,
        commandString: string,
        opts: { app?: string; autoRestart?: boolean; pollInterval?: string }
      ) => {
        requireAuth();
        const project = resolveProject(projectName);

        const commandData = {
          name: cmdName,
          type: "direct" as const,
          command: commandString,
          auto_restart: opts.autoRestart || false,
          poll_interval_ms: opts.pollInterval
            ? parseInt(opts.pollInterval, 10)
            : undefined,
        };

        if (opts.app) {
          const appObj = resolveApp(project, opts.app);
          const result = projectService.addAppCommand(
            project.id,
            appObj.id,
            commandData
          );
          if (result) {
            outputSuccess(`Command "${cmdName}" added to app "${appObj.name}"`, {
              command: result,
            });
          } else {
            outputError("Failed to add command");
            process.exit(1);
          }
        } else {
          const result = projectService.addProjectCommand(project.id, commandData);
          if (result) {
            outputSuccess(`Project command "${cmdName}" added`, {
              command: result,
            });
          } else {
            outputError("Failed to add command");
            process.exit(1);
          }
        }
      }
    );

  // cmd remove <project> <cmd-name>
  cmd
    .command("remove <project> <cmd-name>")
    .description("Delete a command")
    .option("--app <app-name>", "Remove from a specific app")
    .action(
      (projectName: string, cmdName: string, opts: { app?: string }) => {
        requireAuth();
        const project = resolveProject(projectName);
        const resolved = resolveCommand(project, cmdName, opts.app);

        let deleted: boolean;
        if (resolved.isProjectLevel) {
          deleted = projectService.deleteProjectCommand(
            project.id,
            resolved.command.id
          );
        } else {
          deleted = projectService.deleteAppCommand(
            project.id,
            resolved.app!.id,
            resolved.command.id
          );
        }

        if (deleted) {
          outputSuccess(`Command "${cmdName}" deleted`);
        } else {
          outputError("Failed to delete command");
          process.exit(1);
        }
      }
    );

  // cmd run <project> <cmd-name>
  cmd
    .command("run <project> <cmd-name>")
    .description("Run a command")
    .action(async (projectName: string, cmdName: string) => {
      requireAuth();
      const project = resolveProject(projectName);
      const resolved = resolveCommand(project, cmdName);

      let pid: number | null;
      if (resolved.isProjectLevel) {
        pid = await projectService.runProjectCommand(
          project.id,
          resolved.command.id
        );
      } else {
        pid = await projectService.runAppCommand(
          project.id,
          resolved.app!.id,
          resolved.command.id
        );
      }

      if (pid) {
        outputSuccess(`Command "${cmdName}" started (PID: ${pid})`, { pid });
      } else {
        outputError(`Failed to start command "${cmdName}"`);
        process.exit(1);
      }
    });

  // cmd stop <project> [cmd-name]
  cmd
    .command("stop <project> [cmd-name]")
    .description("Stop running command")
    .action(async (projectName: string, cmdName?: string) => {
      requireAuth();
      const project = resolveProject(projectName);

      if (!cmdName) {
        const count = await projectService.stopAllProjectCommands(project.id);
        outputSuccess(`Stopped ${count} process(es)`);
        return;
      }

      const resolved = resolveCommand(project, cmdName);
      const proc = processService.getCommandProcess(resolved.command.id);
      if (!proc) {
        outputError(`Command "${cmdName}" is not running`);
        process.exit(1);
      }

      const killed = await processService.killProcess(proc.pid);
      if (killed) {
        outputSuccess(`Command "${cmdName}" stopped`);
      } else {
        outputError(`Failed to stop command "${cmdName}"`);
        process.exit(1);
      }
    });

  // cmd status <project> [cmd-name]
  cmd
    .command("status <project> [cmd-name]")
    .description("Show command running status")
    .action((projectName: string, cmdName?: string) => {
      requireAuth();
      const project = resolveProject(projectName);

      if (cmdName) {
        const resolved = resolveCommand(project, cmdName);
        const proc = processService.getCommandProcess(resolved.command.id);
        output(
          {
            command: resolved.command.name,
            running: !!proc,
            pid: proc?.pid ?? null,
            started_at: proc?.startTime ?? null,
          },
          (data) => {
            const d = data as { command: string; running: boolean; pid: number | null; started_at: string | null };
            console.log(`Command: ${d.command}`);
            console.log(`Status:  ${d.running ? "running" : "stopped"}`);
            if (d.pid) console.log(`PID:     ${d.pid}`);
            if (d.started_at) console.log(`Started: ${d.started_at}`);
          }
        );
      } else {
        const processes = processService.getProjectProcesses(project.id);
        output(
          processes.map((p) => ({
            pid: p.pid,
            name: p.name,
            started_at: p.startTime,
          })),
          (data) => {
            const rows = data as Record<string, unknown>[];
            if (rows.length === 0) {
              console.log(`No running commands for "${project.name}"`);
              return;
            }
            outputTable(rows, [
              { key: "pid", header: "PID" },
              { key: "name", header: "Name" },
              { key: "started_at", header: "Started" },
            ]);
          }
        );
      }
    });
}

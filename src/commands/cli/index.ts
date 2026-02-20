// src/commands/cli/index.ts

import type { Command } from "commander";
import { registerServersCommand } from "./servers.cmd";
import { registerProjectsCommand } from "./projects.cmd";
import { registerProcessesCommand } from "./processes.cmd";
import { registerRDSCommand } from "./rds.cmd";
import { registerAWSCommand } from "./aws.cmd";
import { registerStatusCommand } from "./status.cmd";

export function registerCLICommands(program: Command): void {
  registerServersCommand(program);
  registerProjectsCommand(program);
  registerProcessesCommand(program);
  registerRDSCommand(program);
  registerAWSCommand(program);
  registerStatusCommand(program);
}

// src/commands/dashboard/tunnels.ts

import inquirer from 'inquirer';
import boxen from 'boxen';
import clipboard from 'clipboardy';
import { serverService } from '../../services/server.service';
import { styled, UI, COLORS } from '../../config/constants';
import { logger } from '../../utils/logger';

export async function tunnelsMenu(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server) {
    logger.error('Server not found');
    return;
  }

  let running = true;
  while (running) {
    console.clear();
    // Refresh server object
    const currentServer = serverService.getServer(serverId);
    if (!currentServer) return;

    const tunnels = currentServer.tunnels || [];

    console.log(styled.title(`\n🚇 Tunnel Management - ${currentServer.name} (${currentServer.host})\n`));

    if (tunnels.length === 0) {
      console.log(
        boxen(styled.info('No tunnels configured yet.'), {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: COLORS.BRIGHT_BLUE,
        })
      );
    } else {
      console.log(
        boxen(
          tunnels
            .map(
              (t) =>
                `${styled.accent(t.name)} ${styled.dimmed(`(${t.type})`)}\n` +
                `${styled.value(`localhost:${t.localPort}`)} ${UI.ICONS.ARROW} ${styled.value(`${t.remoteHost}:${t.remotePort}`)}`
            )
            .join('\n\n'),
          {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            borderColor: COLORS.BOTTLE_GREEN,
            title: `Configured Tunnels (${tunnels.length})`,
          }
        )
      );
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: styled.brand('Tunnel Actions:'),
        choices: [
          { name: `${UI.ICONS.ROCKET} Start Tunnel`, value: 'start', disabled: tunnels.length === 0 },
          { name: `${UI.ICONS.SUCCESS} Add New Tunnel`, value: 'add' },
          { name: `📋 Copy Command`, value: 'copy', disabled: tunnels.length === 0 },
          { name: `${UI.ICONS.ERROR} Delete Tunnel`, value: 'delete', disabled: tunnels.length === 0 },
          { name: styled.dimmed('Back to Server Menu'), value: 'back' },
        ],
      },
    ]);

    switch (action) {
      case 'add':
        await addTunnelFlow(serverId);
        break;
      case 'start':
        await startTunnelFlow(serverId);
        break;
      case 'copy':
        await copyTunnelCommandFlow(serverId);
        break;
      case 'delete':
        await deleteTunnelFlow(serverId);
        break;
      case 'back':
        running = false;
        break;
    }
  }
}

async function addTunnelFlow(serverId: string): Promise<void> {
  const { type } = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Select Tunnel Template:',
      choices: [
        { name: 'Custom Tunnel', value: 'custom' },
        { name: 'AWS RDS (Database)', value: 'rds' },
        { name: 'Redis', value: 'redis' },
      ],
    },
  ]);

  if (type === 'rds') {
    await addRDSTunnel(serverId);
  } else if (type === 'redis') {
    await addRedisTunnel(serverId);
  } else {
    await addCustomTunnel(serverId);
  }
}

async function addCustomTunnel(serverId: string): Promise<void> {
  console.log('\n' + styled.accent('Add Custom Tunnel') + '\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Tunnel Name:',
      validate: (input) => input.length > 0 || 'Name is required',
    },
    {
      type: 'number',
      name: 'localPort',
      message: 'Local Port (e.g., 8080):',
      validate: (input) => (input > 0 && input < 65536) || 'Invalid port',
    },
    {
      type: 'input',
      name: 'remoteHost',
      message: 'Remote Host (Internal IP/DNS):',
      default: 'localhost',
      validate: (input) => input.length > 0 || 'Remote host is required',
    },
    {
      type: 'number',
      name: 'remotePort',
      message: 'Remote Port:',
      validate: (input) => (input > 0 && input < 65536) || 'Invalid port',
    },
  ]);

  await serverService.addTunnel(serverId, {
    name: answers.name,
    type: 'custom',
    localPort: answers.localPort,
    remoteHost: answers.remoteHost,
    remotePort: answers.remotePort,
  });

  await waitForEnter();
}

async function addRDSTunnel(serverId: string): Promise<void> {
  console.log('\n' + styled.accent('Add RDS Tunnel') + '\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Tunnel Name:',
      default: 'RDS Connection',
    },
    {
      type: 'input',
      name: 'remoteHost',
      message: 'RDS Endpoint (Host):',
      validate: (input) => input.length > 0 || 'Endpoint is required',
    },
    {
      type: 'number',
      name: 'remotePort',
      message: 'RDS Port:',
      default: 5432,
    },
    {
      type: 'number',
      name: 'localPort',
      message: 'Local Port:',
      default: 5432,
    },
    // Optional metadata
    {
      type: 'input',
      name: 'dbUsername',
      message: 'DB Username (for reference only):',
    },
  ]);

  await serverService.addTunnel(serverId, {
    name: answers.name,
    type: 'rds',
    localPort: answers.localPort,
    remoteHost: answers.remoteHost,
    remotePort: answers.remotePort,
    metadata: {
      dbUsername: answers.dbUsername,
    },
  });

  await waitForEnter();
}

async function addRedisTunnel(serverId: string): Promise<void> {
  console.log('\n' + styled.accent('Add Redis Tunnel') + '\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Tunnel Name:',
      default: 'Redis Cache',
    },
    {
      type: 'input',
      name: 'remoteHost',
      message: 'Redis Host:',
      default: 'localhost',
    },
    {
      type: 'number',
      name: 'remotePort',
      message: 'Redis Port:',
      default: 6379,
    },
    {
      type: 'number',
      name: 'localPort',
      message: 'Local Port:',
      default: 6379,
    },
  ]);

  await serverService.addTunnel(serverId, {
    name: answers.name,
    type: 'redis',
    localPort: answers.localPort,
    remoteHost: answers.remoteHost,
    remotePort: answers.remotePort,
  });

  await waitForEnter();
}

async function startTunnelFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server || !server.tunnels) return;

  const { tunnelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tunnelId',
      message: 'Select tunnel to start:',
      choices: server.tunnels.map((t) => ({
        name: `${t.name} (L:${t.localPort} -> R:${t.remotePort})`,
        value: t.id,
      })),
    },
  ]);

  console.log(boxen(styled.info('Press Ctrl+C to stop the tunnel'), { padding: 1, borderStyle: 'round', borderColor: 'yellow' }));
  
  await serverService.startTunnel(serverId, tunnelId);
  
  await waitForEnter('Tunnel stopped. Press Enter to continue...');
}

async function copyTunnelCommandFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server || !server.tunnels) return;

  const { tunnelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tunnelId',
      message: 'Select tunnel to copy command:',
      choices: server.tunnels.map((t) => ({
        name: `${t.name}`,
        value: t.id,
      })),
    },
  ]);

  const command = serverService.getTunnelCommand(serverId, tunnelId);
  if (command) {
    try {
      await clipboard.write(command);
      console.log(styled.success('\nCommand copied to clipboard!'));
      console.log(styled.dimmed(command));
    } catch (error) {
      console.log(styled.error('Failed to copy to clipboard. Here is the command:'));
      console.log(command);
    }
  }

  await waitForEnter();
}

async function deleteTunnelFlow(serverId: string): Promise<void> {
  const server = serverService.getServer(serverId);
  if (!server || !server.tunnels) return;

  const { tunnelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tunnelId',
      message: 'Select tunnel to delete:',
      choices: server.tunnels.map((t) => ({
        name: `${t.name}`,
        value: t.id,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure?',
      default: false,
    },
  ]);

  if (confirm) {
    await serverService.deleteTunnel(serverId, tunnelId);
  }

  await waitForEnter();
}

async function waitForEnter(message = 'Press Enter to continue...'): Promise<void> {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: styled.dimmed(message),
    },
  ]);
}

// src/commands/dashboard/servers.ts

import inquirer from 'inquirer';
import boxen from 'boxen';
import { format } from 'date-fns';
import { serverService } from '../../services/server.service';
import { styled, UI, COLORS } from '../../config/constants';
import { logger } from '../../utils/logger';

import { tunnelsMenu } from './tunnels';

export async function serversMenu(): Promise<void> {
  let running = true;
  while (running) {
    console.clear();
    const servers = serverService.listServers();

    console.log(styled.title('\n🖥️  Remote Server Management\n'));

    if (servers.length === 0) {
      console.log(
        boxen(styled.info('No servers configured yet.'), {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: COLORS.BRIGHT_BLUE,
        })
      );
    } else {
      console.log(
        boxen(
          servers
            .map(
              (s) =>
                `${styled.accent(s.name)} (${s.username}@${s.host})\n` +
                `${styled.dimmed('Last connected:')} ${s.last_connected ? format(new Date(s.last_connected), 'PP p') : 'Never'}`
            )
            .join('\n\n'),
          {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            borderColor: COLORS.BOTTLE_GREEN,
            title: `Configured Servers (${servers.length})`,
          }
        )
      );
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: styled.brand('Server Actions:'),
        choices: [
          { name: `${UI.ICONS.ROCKET} Connect to Server`, value: 'connect', disabled: servers.length === 0 },
          { name: `🚇 Manage Tunnels`, value: 'tunnels', disabled: servers.length === 0 },
          { name: `${UI.ICONS.SUCCESS} Add New Server`, value: 'add' },
          { name: `${UI.ICONS.ERROR} Delete Server`, value: 'delete', disabled: servers.length === 0 },
          { name: styled.dimmed('Back to Dashboard'), value: 'back' },
        ],
      },
    ]);

    switch (action) {
      case 'add':
        await addServerFlow();
        break;
      case 'connect':
        await connectServerFlow();
        break;
      case 'tunnels':
        await manageTunnelsFlow();
        break;
      case 'delete':
        await deleteServerFlow();
        break;
      case 'back':
        running = false;
        break;
    }
  }
}

async function addServerFlow(): Promise<void> {
  console.log('\n' + styled.accent('Add New Server') + '\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Server Name (Alias):',
      validate: (input) => input.length > 0 || 'Name is required',
    },
    {
      type: 'input',
      name: 'host',
      message: 'IP Address / Hostname:',
      validate: (input) => input.length > 0 || 'Host is required',
    },
    {
      type: 'input',
      name: 'username',
      message: 'SSH Username:',
      default: 'root',
      validate: (input) => input.length > 0 || 'Username is required',
    },
    {
      type: 'input',
      name: 'pemPath',
      message: 'Path to PEM file:',
      validate: (input) => input.length > 0 || 'PEM path is required',
    },
  ]);

  const result = await serverService.addServer(
    answers.name,
    answers.host,
    answers.username,
    answers.pemPath.trim() // remove potential trailing spaces from drag-drop
  );

  if (result) {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: styled.success('Server added! Press Enter to continue...'),
      },
    ]);
  } else {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: styled.error('Failed to add server. Press Enter to continue...'),
      },
    ]);
  }
}

async function connectServerFlow(): Promise<void> {
  const servers = serverService.listServers();
  const { serverId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'serverId',
      message: 'Select server to connect:',
      choices: servers.map((s) => ({
        name: `${s.name} (${s.host})`,
        value: s.id,
      })),
    },
  ]);

  try {
    await serverService.connectToServer(serverId);
    
    // Pause after connection closes to let user see output
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: styled.dimmed('Press Enter to return to menu...'),
      },
    ]);
  } catch (error) {
    console.log(styled.error('Connection failed.'));
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: styled.dimmed('Press Enter to continue...'),
      },
    ]);
  }
}

async function manageTunnelsFlow(): Promise<void> {
  const servers = serverService.listServers();
  const { serverId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'serverId',
      message: 'Select server to manage tunnels:',
      choices: servers.map((s) => ({
        name: `${s.name} (${s.host})`,
        value: s.id,
      })),
    },
  ]);

  await tunnelsMenu(serverId);
}

async function deleteServerFlow(): Promise<void> {
  const servers = serverService.listServers();
  const { serverId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'serverId',
      message: 'Select server to delete:',
      choices: servers.map((s) => ({
        name: `${s.name} (${s.host})`,
        value: s.id,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: styled.warning('Are you sure you want to delete this server configuration?'),
      default: false,
    },
  ]);

  if (confirm) {
    await serverService.deleteServer(serverId);
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: styled.success('Server deleted. Press Enter to continue...'),
      },
    ]);
  }
}

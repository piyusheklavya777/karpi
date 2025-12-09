// src/commands/dashboard/index.ts

import inquirer from 'inquirer';
import boxen from 'boxen';
import { format } from 'date-fns';
import { authService } from '../../services/auth.service';
import { styled, UI, COLORS } from '../../config/constants';
import { logger } from '../../utils/logger';

import { serversMenu } from './servers';
import { serverService } from '../../services/server.service';
import type { IRecentAction, IBackgroundProcess } from '../../types';

export async function dashboardCommand(): Promise<void> {
  // Check authentication
  if (!authService.isAuthenticated()) {
    console.log(
      boxen(styled.error(`${UI.ICONS.ERROR} Please login first`), {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: COLORS.ERROR,
      })
    );
    process.exit(1);
  }

  const current = authService.getCurrentUser();
  if (!current) {
    logger.error('No active user found');
    process.exit(1);
  }

  console.clear();
  displayDashboard(current.profile);

  // Main menu loop
  let running = true;
  while (running) {
    const processes = serverService.listProcesses();
    const recentActions = current.profile.recent_actions || [];

    const choices: any[] = [];

    // Quick Actions Section
    if (recentActions.length > 0) {
      choices.push(new inquirer.Separator(styled.dimmed('--- Quick Actions (History) ---')));
      recentActions.forEach((action) => {
        const label = action.type === 'ssh' 
          ? `${UI.ICONS.USER} SSH: ${styled.accent(action.name.replace('SSH ', ''))}`
          : `🚇 Tunnel: ${styled.accent(action.name.replace('Tunnel ', ''))}`;
        
        choices.push({
          name: label,
          value: { type: 'recent', data: action }
        });
      });
    }

    // Active Processes Section
    if (processes.length > 0) {
      choices.push(new inquirer.Separator(styled.dimmed(`--- Active Processes (${processes.length}) ---`)));
      processes.forEach((proc) => {
        choices.push({
          name: `${styled.error('[KILL]')} ${proc.name} ${styled.dimmed(`(PID: ${proc.pid})`)}`,
          value: { type: 'process', data: proc }
        });
      });
    }

    // Standard Options Section
    choices.push(new inquirer.Separator(styled.dimmed('--- Standard Options ---')));
    choices.push({ name: `🖥️  Manage Servers & Tunnels`, value: { type: 'standard', data: 'servers' } });
    choices.push({ name: `${UI.ICONS.STATS} View Stats`, value: { type: 'standard', data: 'stats' } });
    choices.push({ name: `${UI.ICONS.USER} Profile Settings`, value: { type: 'standard', data: 'profile' } });
    choices.push({ name: styled.dimmed('Logout'), value: { type: 'standard', data: 'logout' } });
    choices.push({ name: styled.dimmed('Exit'), value: { type: 'standard', data: 'exit' } });

    const { selection } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: styled.brand('Main Menu'),
        pageSize: 15,
        choices: choices,
      },
    ]);

    if (selection.type === 'recent') {
      const action = selection.data as IRecentAction;
      if (action.type === 'ssh') {
        await serverService.connectToServer(action.serverId);
      } else if (action.type === 'tunnel' && action.tunnelId) {
        await serverService.startTunnel(action.serverId, action.tunnelId);
      }
      await waitForEnter();
    } else if (selection.type === 'process') {
      const proc = selection.data as IBackgroundProcess;
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: styled.warning(`Kill process ${proc.pid}?`),
          default: true,
        },
      ]);
      if (confirm) {
        await serverService.killProcess(proc.pid);
        await waitForEnter('Process killed. Press Enter to refresh...');
      }
    } else if (selection.type === 'standard') {
      switch (selection.data) {
        case 'servers':
          await serversMenu();
          break;
        case 'stats':
          displayStats(current.profile);
          await waitForEnter();
          break;
        case 'profile':
          displayProfileInfo(current.profile);
          await waitForEnter();
          break;
        case 'logout':
          authService.logout();
          console.log(
            boxen(styled.success(`${UI.ICONS.SUCCESS} Logged out successfully`), {
              padding: 1,
              margin: 1,
              borderStyle: 'round',
              borderColor: COLORS.SUCCESS,
            })
          );
          running = false;
          break;
        case 'exit':
          console.log('\n' + styled.accent('Goodbye! 👋\n'));
          running = false;
          break;
      }
    }
    
    if (running) {
      console.clear();
      displayDashboard(current.profile);
    }
  }
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

function displayDashboard(profile: any): void {
  const header = `
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  ${styled.brand('KARPI')} ${styled.subtitle('Developer Productivity Dashboard')}              ║
║                                                            ║
╠════════════════════════════════════════════════════════════╣
`;

  const welcome = `
║  ${styled.text('👋 Welcome back,')} ${styled.accent(profile.username.padEnd(30))} ${UI.ICONS.ONLINE}        ║
║  ${styled.dimmed('Last login:')} ${styled.value(format(new Date(profile.last_login), 'PPpp').padEnd(36))} ║
`;

  const footer = `
╚════════════════════════════════════════════════════════════╝
`;

  console.log(styled.box(header) + styled.box(welcome)); // + styled.box(footer));
}

function displayStats(profile: any): void {
  const stats = `
${styled.title('📊 Your Stats')}

${styled.label('Account Created:')} ${styled.value(format(new Date(profile.created_at), 'PPP'))}
${styled.label('Total Logins:')} ${styled.value('Coming soon')}
${styled.label('Productivity Score:')} ${styled.value('Coming soon')}
${styled.label('Active Projects:')} ${styled.value('0')}
${styled.label('Tasks Completed:')} ${styled.value('0')}
`;

  console.log(
    boxen(stats, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: COLORS.BRIGHT_BLUE,
    })
  );
}

// Removed displayQuickActions since it's now integrated

function displayProfileInfo(profile: any): void {
  const info = `
${styled.title('👤 Profile Information')}

${styled.label('Username:')} ${styled.value(profile.username)}
${styled.label('Email:')} ${styled.value(profile.email || 'Not set')}
${styled.label('Profile ID:')} ${styled.dimmed(profile.id)}
${styled.label('Created:')} ${styled.value(format(new Date(profile.created_at), 'PPP'))}

${styled.subtitle('Preferences')}
${styled.label('Theme:')} ${styled.value(profile.preferences.theme)}
${styled.label('Editor:')} ${styled.value(profile.preferences.editor)}
${styled.label('Auto Logout:')} ${styled.value(`${profile.preferences.auto_logout_minutes} minutes`)}
`;

  console.log(
    boxen(info, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: COLORS.BOTTLE_GREEN,
    })
  );
}

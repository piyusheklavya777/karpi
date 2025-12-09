// src/commands/auth/logout.ts

import inquirer from 'inquirer';
import boxen from 'boxen';
import { authService } from '../../services/auth.service';
import { styled, UI, COLORS } from '../../config/constants';

export async function logoutCommand(options: { all?: boolean }): Promise<void> {
  if (!authService.isAuthenticated()) {
    console.log(
      boxen(styled.warning(`${UI.ICONS.WARNING} No active session found`), {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: COLORS.WARNING,
      })
    );
    return;
  }

  const current = authService.getCurrentUser();

  if (options.all) {
    // Logout all sessions
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: styled.warning('Are you sure you want to logout all sessions?'),
        default: false,
      },
    ]);

    if (confirm) {
      authService.logoutAll();
      console.log(
        boxen(styled.success(`${UI.ICONS.SUCCESS} All sessions logged out successfully`), {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: COLORS.SUCCESS,
        })
      );
    }
  } else {
    // Logout current session
    authService.logout();
    console.log(
      boxen(
        styled.success(
          `${UI.ICONS.SUCCESS} Logged out successfully${current ? `\nGoodbye, ${styled.accent(current.profile.username)}!` : ''}`
        ),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: COLORS.SUCCESS,
        }
      )
    );
  }
}

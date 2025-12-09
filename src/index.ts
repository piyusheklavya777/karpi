#!/usr/bin/env bun
// src/index.ts

import { Command } from 'commander';
import { APP_NAME, APP_VERSION, APP_DESCRIPTION } from './config/constants';
import { loginCommand } from './commands/auth/login';
import { logoutCommand } from './commands/auth/logout';
import { dashboardCommand } from './commands/dashboard';

const program = new Command();

program
  .name(APP_NAME.toLowerCase())
  .description(APP_DESCRIPTION)
  .version(APP_VERSION);

// Login command
program
  .command('login')
  .description('Login to your profile or create a new one')
  .action(async () => {
    await loginCommand();
    // After successful login, go to dashboard
    await dashboardCommand();
  });

// Logout command
program
  .command('logout')
  .description('Logout from current session')
  .option('-a, --all', 'Logout from all sessions')
  .action(async (options) => {
    await logoutCommand(options);
  });

// Dashboard command (default)
program
  .command('dashboard')
  .alias('dash')
  .description('Open the main dashboard')
  .action(async () => {
    await dashboardCommand();
  });

// Default action (no command specified)
program.action(async () => {
  // Check if user is logged in
  const { authService } = await import('./services/auth.service');
  
  if (authService.isAuthenticated()) {
    await dashboardCommand();
  } else {
    await loginCommand();
    // After successful login, go to dashboard
    await dashboardCommand();
  }
});

// Parse command line arguments
program.parse(process.argv);

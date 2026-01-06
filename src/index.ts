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

// Export command
program
  .command('export [output-file]')
  .description('Export configuration to a YAML file')
  .option('--embed-keys', 'Embed PEM file contents inline instead of copying')
  .action(async (outputFile: string | undefined, options: { embedKeys?: boolean }) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const { exportService } = await import('./services/export.service');
    const { authService } = await import('./services/auth.service');

    if (!authService.isAuthenticated()) {
      console.log(chalk.red('❌ Please login first: karpi login'));
      process.exit(1);
    }

    const defaultPath = `./karpi-config-${new Date().toISOString().split('T')[0]}.yaml`;
    const targetPath = outputFile || defaultPath;

    const spinner = ora('Exporting configuration...').start();
    const result = await exportService.exportConfig(targetPath, {
      includePemContent: options.embedKeys,
    });

    if (result.success) {
      spinner.succeed(chalk.green(`Configuration exported to: ${result.path}`));
    } else {
      spinner.fail(chalk.red(`Export failed: ${result.error}`));
      process.exit(1);
    }
  });

// Import command
program
  .command('import <input-file>')
  .description('Import configuration from a YAML file')
  .option('--overwrite', 'Overwrite existing configurations with same name')
  .option('--dry-run', 'Preview what would be imported without making changes')
  .action(async (inputFile: string, options: { overwrite?: boolean; dryRun?: boolean }) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const { exportService } = await import('./services/export.service');
    const { authService } = await import('./services/auth.service');

    if (!authService.isAuthenticated()) {
      console.log(chalk.red('❌ Please login first: karpi login'));
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(chalk.cyan('\n📋 Dry run - previewing import...\n'));
      const preview = await exportService.previewImport(inputFile);

      if (preview.errors.length > 0) {
        console.log(chalk.red('Errors:'));
        preview.errors.forEach(e => console.log(chalk.red(`  • ${e}`)));
        process.exit(1);
      }

      console.log(chalk.white('Would import:'));
      console.log(chalk.cyan(`  • ${preview.servers.length} servers: ${preview.servers.join(', ') || 'none'}`));
      console.log(chalk.cyan(`  • ${preview.aws_profiles.length} AWS profiles: ${preview.aws_profiles.join(', ') || 'none'}`));
      console.log(chalk.cyan(`  • ${preview.rds_instances.length} RDS instances: ${preview.rds_instances.join(', ') || 'none'}`));
      return;
    }

    const spinner = ora('Importing configuration...').start();
    const result = await exportService.importConfig(inputFile, {
      overwrite: options.overwrite,
      dryRun: false,
    });

    if (result.success) {
      spinner.succeed(chalk.green('Configuration imported successfully!'));
      console.log(chalk.white('\nImported:'));
      console.log(chalk.green(`  ✓ ${result.imported.servers} servers`));
      console.log(chalk.green(`  ✓ ${result.imported.aws_profiles} AWS profiles`));
      console.log(chalk.green(`  ✓ ${result.imported.rds_instances} RDS instances`));

      if (result.skipped.servers.length > 0 || result.skipped.aws_profiles.length > 0) {
        console.log(chalk.yellow('\nSkipped (already exist):'));
        if (result.skipped.servers.length) console.log(chalk.yellow(`  • Servers: ${result.skipped.servers.join(', ')}`));
        if (result.skipped.aws_profiles.length) console.log(chalk.yellow(`  • AWS Profiles: ${result.skipped.aws_profiles.join(', ')}`));
        if (result.skipped.rds_instances.length) console.log(chalk.yellow(`  • RDS: ${result.skipped.rds_instances.join(', ')}`));
      }
    } else {
      spinner.fail(chalk.red('Import completed with errors'));
      result.errors.forEach(e => console.log(chalk.red(`  • ${e}`)));
      process.exit(1);
    }
  });

// Update command
program
  .command('update')
  .description('Check for and install Karpi updates via Homebrew')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    console.log();
    const spinner = ora('Checking for updates...').start();

    try {
      // Get latest version from Homebrew
      let latestVersion = 'unknown';
      try {
        const { stdout } = await execAsync('brew info karpi --json=v2');
        const info = JSON.parse(stdout);
        latestVersion = info.formulae?.[0]?.versions?.stable || info.casks?.[0]?.version || 'unknown';
      } catch {
        // Fallback: try brew list
        try {
          await execAsync('brew list karpi');
        } catch {
          spinner.fail(chalk.red('Karpi is not installed via Homebrew'));
          console.log(chalk.dim('\nInstall with: brew install karpi'));
          return;
        }
      }

      const currentVersion = APP_VERSION;
      spinner.stop();

      if (latestVersion === 'unknown') {
        console.log(chalk.yellow('⚠️  Could not determine latest version'));
        console.log(chalk.dim('Run manually: brew update && brew upgrade karpi'));
        return;
      }

      if (currentVersion === latestVersion) {
        console.log(chalk.green(`✓ Karpi is up to date (v${currentVersion})`));
        return;
      }

      // Check if update available (compare versions)
      const current = currentVersion.split('.').map(Number);
      const latest = latestVersion.split('.').map(Number);
      const needsUpdate = latest[0] > current[0] ||
        (latest[0] === current[0] && latest[1] > current[1]) ||
        (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2]);

      if (!needsUpdate) {
        console.log(chalk.green(`✓ Karpi is up to date (v${currentVersion})`));
        return;
      }

      console.log(chalk.cyan(`📦 Update available: ${chalk.dim(currentVersion)} → ${chalk.bold(latestVersion)}`));

      const inquirer = (await import('inquirer')).default;
      const { confirmUpdate } = await inquirer.prompt({
        type: 'confirm',
        name: 'confirmUpdate',
        message: 'Install update?',
        default: true,
      });

      if (!confirmUpdate) {
        console.log(chalk.dim('\nUpdate cancelled.'));
        return;
      }

      console.log();
      const updateSpinner = ora('Updating Karpi...').start();

      try {
        await execAsync('brew update');
        await execAsync('brew upgrade karpi');
        updateSpinner.succeed(chalk.green(`✓ Updated to v${latestVersion}`));
        console.log(chalk.dim('\nRestart your terminal to use the new version.'));
      } catch (updateError) {
        updateSpinner.fail(chalk.red('Update failed'));
        console.log(chalk.dim('\nTry manually: brew update && brew upgrade karpi'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to check for updates'));
      console.log(chalk.dim('\nTry manually: brew update && brew upgrade karpi'));
    }
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

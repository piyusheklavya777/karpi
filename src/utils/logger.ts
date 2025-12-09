// src/utils/logger.ts

import { styled, UI } from '../config/constants';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(styled.dimmed(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(styled.info(`${UI.ICONS.INFO} ${message}`), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.log(styled.warning(`${UI.ICONS.WARNING} ${message}`), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(styled.error(`${UI.ICONS.ERROR} ${message}`), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    console.log(styled.success(`${UI.ICONS.SUCCESS} ${message}`), ...args);
  }

  box(message: string): void {
    console.log(styled.box(`┌${'─'.repeat(message.length + 2)}┐`));
    console.log(styled.box(`│ ${styled.text(message)} │`));
    console.log(styled.box(`└${'─'.repeat(message.length + 2)}┘`));
  }
}

export const logger = new Logger();

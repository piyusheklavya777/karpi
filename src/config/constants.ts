// src/config/constants.ts

import chalk from "chalk";

// Color Palette - Bottle Green, Bright Blue, and Black
export const COLORS = {
  // Primary colors
  BOTTLE_GREEN: "#2d5016",
  BRIGHT_BLUE: "#00bfff",
  BLACK: "#000000",

  // Shades for variety
  DARK_GREEN: "#1a3009",
  LIGHT_GREEN: "#4a7c2c",
  SKY_BLUE: "#87ceeb",
  DARK_BLUE: "#0080bf",

  // Utility colors
  WHITE: "#ffffff",
  GRAY: "#808080",
  LIGHT_GRAY: "#d3d3d3",
  SUCCESS: "#4a7c2c",
  ERROR: "#ff0000",
  WARNING: "#ffa500",
} as const;

// Chalk styled functions with our color scheme
export const styled = {
  // Primary branding
  brand: chalk.hex(COLORS.BOTTLE_GREEN).bold,
  accent: chalk.hex(COLORS.BRIGHT_BLUE).bold,

  // Text styles
  primary: chalk.hex(COLORS.BOTTLE_GREEN),
  secondary: chalk.hex(COLORS.BRIGHT_BLUE),
  text: chalk.white,
  dimmed: chalk.hex(COLORS.GRAY),

  // Status colors
  success: chalk.hex(COLORS.SUCCESS),
  error: chalk.red,
  warning: chalk.hex(COLORS.WARNING),
  info: chalk.hex(COLORS.BRIGHT_BLUE),

  // Special effects
  highlight: chalk.bgHex(COLORS.BOTTLE_GREEN).hex(COLORS.WHITE),
  highlightBlue: chalk.bgHex(COLORS.BRIGHT_BLUE).hex(COLORS.BLACK),
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,

  // UI elements
  box: chalk.hex(COLORS.BRIGHT_BLUE),
  title: chalk.hex(COLORS.BOTTLE_GREEN).bold.underline,
  subtitle: chalk.hex(COLORS.BRIGHT_BLUE).italic,
  label: chalk.hex(COLORS.LIGHT_GREEN),
  value: chalk.hex(COLORS.SKY_BLUE),
} as const;

// Application constants
export const APP_NAME = "KARPI";
export const APP_VERSION = "1.2.1";
export const APP_DESCRIPTION = "Developer Productivity Unleashed";

// Storage
export const CONFIG_DIR = ".karpi";
export const CONFIG_FILE = "config.json";
export const KEYCHAIN_SERVICE = "karpi-cli";

// Session
export const SESSION_EXPIRY_HOURS = 24;
export const AUTO_LOGOUT_MINUTES = 30;

// Security
export const SALT_ROUNDS = 10;
export const JWT_SECRET = "karpi_dev_secret_change_in_production";

// API (for future web integration)
export const API_ENDPOINT = "https://api.karpi.dev";
export const API_TIMEOUT = 30000;

// ASCII Art for branding
export const ASCII_LOGO = `
██╗  ██╗ █████╗ ██████╗ ██████╗ ██╗
██║ ██╔╝██╔══██╗██╔══██╗██╔══██╗██║
█████╔╝ ███████║██████╔╝██████╔╝██║
██╔═██╗ ██╔══██║██╔══██╗██╔═══╝ ██║
██║  ██╗██║  ██║██║  ██║██║     ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
`;

// UI Elements
export const UI = {
  BOX_STYLE: {
    padding: 1,
    margin: 1,
    borderStyle: "round" as const,
    borderColor: COLORS.BRIGHT_BLUE,
  },
  ICONS: {
    SUCCESS: "✓",
    ERROR: "✗",
    WARNING: "⚠",
    INFO: "ℹ",
    USER: "👤",
    LOCK: "🔒",
    STATS: "📊",
    ROCKET: "🚀",
    ONLINE: "🟢",
    OFFLINE: "🔴",
    ARROW: "→",
    CHECK: "✔",
    CROSS: "✖",
  },
} as const;

// Default preferences
export const DEFAULT_PREFERENCES = {
  theme: "dark" as const,
  editor: "code",
  terminal_colors: [COLORS.BOTTLE_GREEN, COLORS.BRIGHT_BLUE, COLORS.BLACK],
  auto_logout_minutes: AUTO_LOGOUT_MINUTES,
  startup_command: "dashboard",
};

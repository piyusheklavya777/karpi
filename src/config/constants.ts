// src/config/constants.ts

import chalk from "chalk";

// Color Palette - Pink theme (white to pink gradient, no dark shades)
export const COLORS = {
  // Primary pink colors (bright, no dark shades)
  PRIMARY: "#FF69B4", // Hot pink - main accent
  SECONDARY: "#FF85C1", // Lighter hot pink
  ACCENT: "#FF1493", // Deep pink for emphasis

  // Lighter variations
  LIGHT: "#FFB6C1", // Light pink
  SOFT: "#FFC0CB", // Soft pink
  PALE: "#FFD9E8", // Very pale pink
  BLUSH: "#FFF0F5", // Lavender blush (almost white)

  // Utility colors
  WHITE: "#ffffff",
  GRAY: "#B0B0B0", // Light gray (not dark)
  LIGHT_GRAY: "#E0E0E0",
  SUCCESS: "#4CAF50", // Green for success
  ERROR: "#FF6B6B", // Soft red
  WARNING: "#FFB347", // Soft orange
} as const;

// Chalk styled functions with our color scheme
export const styled = {
  // Primary branding
  brand: chalk.hex(COLORS.PRIMARY).bold,
  accent: chalk.hex(COLORS.ACCENT).bold,

  // Text styles
  primary: chalk.hex(COLORS.PRIMARY),
  secondary: chalk.hex(COLORS.SECONDARY),
  text: chalk.white,
  dimmed: chalk.hex(COLORS.GRAY),

  // Status colors
  success: chalk.hex(COLORS.SUCCESS),
  error: chalk.hex(COLORS.ERROR),
  warning: chalk.hex(COLORS.WARNING),
  info: chalk.hex(COLORS.LIGHT),

  // Special effects
  highlight: chalk.bgHex(COLORS.PRIMARY).hex(COLORS.WHITE),
  highlightAlt: chalk.bgHex(COLORS.SECONDARY).hex(COLORS.WHITE),
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,

  // UI elements
  box: chalk.hex(COLORS.PRIMARY),
  title: chalk.hex(COLORS.PRIMARY).bold.underline,
  subtitle: chalk.hex(COLORS.SECONDARY).italic,
  label: chalk.hex(COLORS.LIGHT),
  value: chalk.hex(COLORS.SOFT),
} as const;

// Application constants
export const APP_NAME = "KARPI";
export const APP_VERSION = "1.4.0";
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
    borderColor: COLORS.PRIMARY,
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
  terminal_colors: [COLORS.PRIMARY, COLORS.SECONDARY, COLORS.ACCENT],
  auto_logout_minutes: AUTO_LOGOUT_MINUTES,
  startup_command: "dashboard",
};

// scripts/bump-version.ts

import fs from "fs";
import path from "path";

interface IVersionedPackageJson {
  version: string;
  [key: string]: unknown;
}

const NEW_VERSION = process.argv[2];

if (!NEW_VERSION) {
  console.error("Usage: bun scripts/bump-version.ts <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(NEW_VERSION)) {
  console.error(`Invalid version "${NEW_VERSION}". Expected format: x.y.z`);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const constantsPath = path.join(projectRoot, "src", "config", "constants.ts");

function updatePackageJson(newVersion: string): void {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as IVersionedPackageJson;

  parsed.version = newVersion;

  const updated = `${JSON.stringify(parsed, null, 2)}\n`;
  fs.writeFileSync(packageJsonPath, updated, "utf8");
}

function updateConstantsVersion(newVersion: string): void {
  const raw = fs.readFileSync(constantsPath, "utf8");

  const updated = raw.replace(
    /(export const APP_VERSION = ["'])[^"']+(["'];)/,
    `$1${newVersion}$2`
  );

  if (updated === raw) {
    console.error("Failed to update APP_VERSION in src/config/constants.ts");
    process.exit(1);
  }

  fs.writeFileSync(constantsPath, updated, "utf8");
}

updatePackageJson(NEW_VERSION);
updateConstantsVersion(NEW_VERSION);

console.log(
  `Version bumped to ${NEW_VERSION} in package.json and APP_VERSION.`
);

// src/utils/json-mode.ts
// Isolated module to avoid circular dependencies between logger and cli-helpers

let jsonMode = false;

export function setJsonMode(value: boolean): void {
  jsonMode = value;
}

export function getJsonMode(): boolean {
  return jsonMode;
}

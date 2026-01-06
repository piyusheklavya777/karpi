// src/services/storage.service.ts

import Conf from "conf";
import { homedir } from "os";
import { join } from "path";
import type {
  IStorageConfig,
  IUserProfile,
  ISession,
  IServerConfig,
  IBackgroundProcess,
  IAWSProfile,
  IRDSInstance,
  IExportProfile,
} from "../types";
import {
  APP_VERSION,
  CONFIG_DIR,
  DEFAULT_PREFERENCES,
} from "../config/constants";
import { logger } from "../utils/logger";

export class StorageService {
  private config: Conf<IStorageConfig>;
  private configPath: string;

  constructor() {
    this.configPath = join(homedir(), CONFIG_DIR);

    this.config = new Conf<IStorageConfig>({
      projectName: "karpi",
      cwd: this.configPath,
      defaults: {
        version: APP_VERSION,
        active_profile_id: null,
        profiles: [],
        sessions: [],
        servers: [],
        processes: [],
        aws_profiles: [],
        rds_instances: [],
        export_profiles: [],
        preferences: {
          theme: "dark",
          auto_logout_minutes: 30,
          startup_command: "dashboard",
        },
      },
    });

    logger.debug(`Storage initialized at: ${this.configPath}`);
  }

  // Profile management
  getAllProfiles(): IUserProfile[] {
    return this.config.get("profiles", []);
  }

  getProfileById(id: string): IUserProfile | undefined {
    const profiles = this.getAllProfiles();
    return profiles.find((p) => p.id === id);
  }

  getProfileByUsername(username: string): IUserProfile | undefined {
    const profiles = this.getAllProfiles();
    return profiles.find((p) => p.username === username);
  }

  saveProfile(profile: IUserProfile): void {
    const profiles = this.getAllProfiles();
    const existingIndex = profiles.findIndex((p) => p.id === profile.id);

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    this.config.set("profiles", profiles);
    logger.debug(`Profile saved: ${profile.username}`);
  }

  deleteProfile(id: string): boolean {
    const profiles = this.getAllProfiles();
    const filteredProfiles = profiles.filter((p) => p.id !== id);

    if (filteredProfiles.length === profiles.length) {
      return false; // Profile not found
    }

    this.config.set("profiles", filteredProfiles);

    // Also delete associated sessions
    this.deleteSessionsByProfileId(id);

    // Clear active profile if it was deleted
    if (this.getActiveProfileId() === id) {
      this.setActiveProfileId(null);
    }

    logger.debug(`Profile deleted: ${id}`);
    return true;
  }

  // Active profile management
  getActiveProfileId(): string | null {
    return this.config.get("active_profile_id", null);
  }

  setActiveProfileId(id: string | null): void {
    this.config.set("active_profile_id", id);
    logger.debug(`Active profile set: ${id}`);
  }

  getActiveProfile(): IUserProfile | undefined {
    const activeId = this.getActiveProfileId();
    if (!activeId) return undefined;
    return this.getProfileById(activeId);
  }

  // Session management
  getAllSessions(): ISession[] {
    return this.config.get("sessions", []);
  }

  getSessionByProfileId(profile_id: string): ISession | undefined {
    const sessions = this.getAllSessions();
    return sessions.find((s) => s.profile_id === profile_id);
  }

  saveSession(session: ISession): void {
    const sessions = this.getAllSessions();
    const existingIndex = sessions.findIndex(
      (s) => s.profile_id === session.profile_id
    );

    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }

    this.config.set("sessions", sessions);
    logger.debug(`Session saved for profile: ${session.profile_id}`);
  }

  deleteSession(profile_id: string): boolean {
    const sessions = this.getAllSessions();
    const filteredSessions = sessions.filter(
      (s) => s.profile_id !== profile_id
    );

    if (filteredSessions.length === sessions.length) {
      return false; // Session not found
    }

    this.config.set("sessions", filteredSessions);
    logger.debug(`Session deleted for profile: ${profile_id}`);
    return true;
  }

  deleteSessionsByProfileId(profile_id: string): void {
    this.deleteSession(profile_id);
  }

  deleteAllSessions(): void {
    this.config.set("sessions", []);
    logger.debug("All sessions deleted");
  }

  // Server management
  getAllServers(): IServerConfig[] {
    return this.config.get("servers", []);
  }

  getServersByProfileId(profile_id: string): IServerConfig[] {
    const servers = this.getAllServers();
    return servers.filter((s) => s.profile_id === profile_id);
  }

  saveServer(server: IServerConfig): void {
    const servers = this.getAllServers();
    const existingIndex = servers.findIndex((s) => s.id === server.id);

    if (existingIndex >= 0) {
      servers[existingIndex] = server;
    } else {
      servers.push(server);
    }

    this.config.set("servers", servers);
    logger.debug(`Server saved: ${server.name}`);
  }

  deleteServer(id: string): boolean {
    const servers = this.getAllServers();
    const filteredServers = servers.filter((s) => s.id !== id);

    if (filteredServers.length === servers.length) {
      return false; // Server not found
    }

    this.config.set("servers", filteredServers);
    logger.debug(`Server deleted: ${id}`);
    return true;
  }

  // Process management
  getAllProcesses(): IBackgroundProcess[] {
    return this.config.get("processes", []);
  }

  saveProcess(process: IBackgroundProcess): void {
    const processes = this.getAllProcesses();
    processes.push(process);
    this.config.set("processes", processes);
    logger.debug(`Process saved: ${process.pid}`);
  }

  deleteProcess(pid: number): void {
    const processes = this.getAllProcesses();
    const filtered = processes.filter((p) => p.pid !== pid);
    this.config.set("processes", filtered);
    logger.debug(`Process deleted: ${pid}`);
  }

  // AWS Profile management
  getAllAWSProfiles(): IAWSProfile[] {
    return this.config.get("aws_profiles", []);
  }

  getAWSProfile(id: string): IAWSProfile | undefined {
    const profiles = this.getAllAWSProfiles();
    return profiles.find((p) => p.id === id);
  }

  getAWSProfileByName(name: string): IAWSProfile | undefined {
    const profiles = this.getAllAWSProfiles();
    return profiles.find((p) => p.name === name);
  }

  saveAWSProfile(profile: IAWSProfile): void {
    const profiles = this.getAllAWSProfiles();
    const existingIndex = profiles.findIndex((p) => p.id === profile.id);

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    this.config.set("aws_profiles", profiles);
    logger.debug(`AWS Profile saved: ${profile.name}`);
  }

  updateAWSProfile(id: string, updates: Partial<IAWSProfile>): boolean {
    const profiles = this.getAllAWSProfiles();
    const index = profiles.findIndex((p) => p.id === id);

    if (index === -1) {
      return false;
    }

    profiles[index] = { ...profiles[index], ...updates };
    this.config.set("aws_profiles", profiles);
    logger.debug(`AWS Profile updated: ${id}`);
    return true;
  }

  deleteAWSProfile(id: string): boolean {
    const profiles = this.getAllAWSProfiles();
    const filtered = profiles.filter((p) => p.id !== id);

    if (filtered.length === profiles.length) {
      return false;
    }

    this.config.set("aws_profiles", filtered);
    logger.debug(`AWS Profile deleted: ${id}`);
    return true;
  }

  // RDS Instance management
  getAllRDSInstances(): IRDSInstance[] {
    return this.config.get("rds_instances", []);
  }

  getRDSInstance(id: string): IRDSInstance | undefined {
    const instances = this.getAllRDSInstances();
    return instances.find((r) => r.id === id);
  }

  getRDSByIdentifier(identifier: string): IRDSInstance | undefined {
    const instances = this.getAllRDSInstances();
    return instances.find((r) => r.db_instance_identifier === identifier);
  }

  getRDSByProfileId(profileId: string): IRDSInstance[] {
    const instances = this.getAllRDSInstances();
    return instances.filter((r) => r.profile_id === profileId);
  }

  saveRDSInstance(instance: IRDSInstance): void {
    const instances = this.getAllRDSInstances();
    const existingIndex = instances.findIndex((r) => r.id === instance.id);

    if (existingIndex >= 0) {
      instances[existingIndex] = instance;
    } else {
      instances.push(instance);
    }

    this.config.set("rds_instances", instances);
    logger.debug(`RDS Instance saved: ${instance.name}`);
  }

  updateRDSInstance(id: string, updates: Partial<IRDSInstance>): boolean {
    const instances = this.getAllRDSInstances();
    const index = instances.findIndex((r) => r.id === id);

    if (index === -1) {
      return false;
    }

    instances[index] = { ...instances[index], ...updates };
    this.config.set("rds_instances", instances);
    logger.debug(`RDS Instance updated: ${id}`);
    return true;
  }

  deleteRDSInstance(id: string): boolean {
    const instances = this.getAllRDSInstances();
    const filtered = instances.filter((r) => r.id !== id);

    if (filtered.length === instances.length) {
      return false;
    }

    this.config.set("rds_instances", filtered);
    logger.debug(`RDS Instance deleted: ${id}`);
    return true;
  }

  // Export Profile management
  getAllExportProfiles(): IExportProfile[] {
    return this.config.get("export_profiles", []);
  }

  getExportProfile(id: string): IExportProfile | undefined {
    const profiles = this.getAllExportProfiles();
    return profiles.find((p) => p.id === id);
  }

  getExportProfileByName(name: string): IExportProfile | undefined {
    const profiles = this.getAllExportProfiles();
    return profiles.find((p) => p.name === name);
  }

  saveExportProfile(profile: IExportProfile): void {
    const profiles = this.getAllExportProfiles();
    const existingIndex = profiles.findIndex((p) => p.id === profile.id);

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    this.config.set("export_profiles", profiles);
    logger.debug(`Export Profile saved: ${profile.name}`);
  }

  deleteExportProfile(id: string): boolean {
    const profiles = this.getAllExportProfiles();
    const filtered = profiles.filter((p) => p.id !== id);

    if (filtered.length === profiles.length) {
      return false;
    }

    this.config.set("export_profiles", filtered);
    logger.debug(`Export Profile deleted: ${id}`);
    return true;
  }

  // Preferences
  getPreferences() {
    return this.config.get("preferences", DEFAULT_PREFERENCES);
  }

  setPreferences(preferences: Partial<IStorageConfig["preferences"]>): void {
    const current = this.getPreferences();
    this.config.set("preferences", { ...current, ...preferences });
    logger.debug("Preferences updated");
  }

  // Utility
  clear(): void {
    this.config.clear();
    logger.debug("Storage cleared");
  }

  getConfigPath(): string {
    return this.configPath;
  }
}

// Singleton instance
export const storageService = new StorageService();

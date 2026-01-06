// src/services/export.service.ts

import YAML from "yaml";
import { readFile, writeFile, mkdir, access, copyFile } from "fs/promises";
import { join, dirname, basename, relative, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { nanoid } from "nanoid";
import { storageService } from "./storage.service";
import { logger } from "../utils/logger";
import { APP_VERSION, CONFIG_DIR } from "../config/constants";
import type {
    IServerConfig,
    IAWSProfile,
    IRDSInstance,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════════
// Export Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IExportConfig {
    $schema: string;
    version: string;
    exported_at: string;
    servers: IExportServer[];
    aws_profiles: IExportAWSProfile[];
    rds_instances: IExportRDSInstance[];
}

export interface IExportServer {
    name: string;
    host: string;
    username: string;
    pem_file: string | { $ref: string } | { $content: string };
    aws_profile?: string; // Reference by name
    aws_instance_id?: string;
    aws_region?: string;
    private_ip?: string;
    tunnels?: IExportTunnel[];
    synced_files?: IExportSyncedFile[];
}

export interface IExportTunnel {
    name: string;
    type: "custom" | "rds" | "redis" | "service";
    localPort: number;
    remoteHost: string;
    remotePort: number;
    metadata?: {
        dbUsername?: string;
        dbName?: string;
    };
}

export interface IExportSyncedFile {
    name: string;
    local_path: string;
    remote_path: string;
}

export interface IExportAWSProfile {
    name: string;
    auth_type: "cli_profile" | "access_keys";
    cli_profile_name?: string;
    // NOTE: access_key_id and secret_access_key are NOT exported for security
    default_region: string;
}

export interface IExportRDSInstance {
    name: string;
    db_instance_identifier: string;
    endpoint: string;
    port: number;
    engine: string;
    engine_version: string;
    db_name?: string;
    master_username?: string;
    aws_region: string;
    aws_profile: string; // Reference by name
    linked_server?: string; // Reference by name
    local_port?: number;
}

export interface IImportResult {
    success: boolean;
    imported: {
        servers: number;
        aws_profiles: number;
        rds_instances: number;
    };
    skipped: {
        servers: string[];
        aws_profiles: string[];
        rds_instances: string[];
    };
    errors: string[];
}

export interface IExportOptions {
    includePemContent?: boolean; // Embed PEM file contents inline
    outputDir?: string; // Directory to export keys to (relative to export file)
}

export interface IImportOptions {
    dryRun?: boolean; // Preview without making changes
    overwrite?: boolean; // Overwrite existing configs with same name
    keysDir?: string; // Directory to look for PEM files (relative to import file)
}

// Selection for export - specifies which items to include
export interface IExportSelection {
    server_ids: string[];
    aws_profile_ids: string[];
    rds_instance_ids: string[];
}

// Items that can be exported (returned by getExportableItems)
export interface IExportableItems {
    servers: Array<{ id: string; name: string; host: string }>;
    aws_profiles: Array<{ id: string; name: string; auth_type: string }>;
    rds_instances: Array<{ id: string; name: string; endpoint: string }>;
}

// Diff result for import preview
export interface IImportDiff {
    new_items: {
        servers: IExportServer[];
        aws_profiles: IExportAWSProfile[];
        rds_instances: IExportRDSInstance[];
    };
    modified_items: {
        servers: Array<{
            name: string;
            changes: Array<{ field: string; from: string; to: string }>;
        }>;
        aws_profiles: Array<{
            name: string;
            changes: Array<{ field: string; from: string; to: string }>;
        }>;
        rds_instances: Array<{
            name: string;
            changes: Array<{ field: string; from: string; to: string }>;
        }>;
    };
    unchanged: {
        servers: string[];
        aws_profiles: string[];
        rds_instances: string[];
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export Service Class
// ═══════════════════════════════════════════════════════════════════════════════

export class ExportService {
    private keysDir: string;

    constructor() {
        this.keysDir = join(homedir(), CONFIG_DIR, "keys");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Export Functions
    // ─────────────────────────────────────────────────────────────────────────────

    async exportConfig(
        outputPath: string,
        options: IExportOptions = {}
    ): Promise<{ success: boolean; path: string; error?: string }> {
        try {
            const activeProfile = storageService.getActiveProfile();
            if (!activeProfile) {
                return { success: false, path: outputPath, error: "No active profile" };
            }

            const servers = storageService.getServersByProfileId(activeProfile.id);
            const awsProfiles = storageService.getAllAWSProfiles();
            const rdsInstances = storageService.getRDSByProfileId(activeProfile.id);

            // Build export config
            const exportConfig: IExportConfig = {
                $schema: "https://karpi.dev/schemas/config-v1.yaml",
                version: APP_VERSION,
                exported_at: new Date().toISOString(),
                servers: [],
                aws_profiles: [],
                rds_instances: [],
            };

            // Export AWS profiles first (for reference lookups)
            const awsProfileNameMap = new Map<string, string>(); // id -> name
            for (const profile of awsProfiles) {
                awsProfileNameMap.set(profile.id, profile.name);
                exportConfig.aws_profiles.push(this.exportAWSProfile(profile));
            }

            // Export servers with key directory creation
            const outputDir = dirname(outputPath);
            const keysExportDir = join(outputDir, options.outputDir || "keys");

            for (const server of servers) {
                const exportedServer = await this.exportServer(
                    server,
                    awsProfileNameMap,
                    options,
                    keysExportDir,
                    outputDir
                );
                exportConfig.servers.push(exportedServer);
            }

            // Export RDS instances
            const serverNameMap = new Map<string, string>(); // id -> name
            for (const server of servers) {
                serverNameMap.set(server.id, server.name);
            }

            for (const rds of rdsInstances) {
                exportConfig.rds_instances.push(
                    this.exportRDSInstance(rds, awsProfileNameMap, serverNameMap)
                );
            }

            // Write YAML file
            const yamlContent = YAML.stringify(exportConfig, {
                indent: 2,
                lineWidth: 0, // No line wrapping
            });

            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, yamlContent, "utf-8");

            logger.info(`Config exported to: ${outputPath}`);
            return { success: true, path: outputPath };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Export failed: ${errorMsg}`);
            return { success: false, path: outputPath, error: errorMsg };
        }
    }

    private exportAWSProfile(profile: IAWSProfile): IExportAWSProfile {
        const exported: IExportAWSProfile = {
            name: profile.name,
            auth_type: profile.auth_type,
            default_region: profile.default_region,
        };

        if (profile.auth_type === "cli_profile" && profile.cli_profile_name) {
            exported.cli_profile_name = profile.cli_profile_name;
        }
        // NOTE: access_key_id and secret_access_key are intentionally NOT exported

        return exported;
    }

    private async exportServer(
        server: IServerConfig,
        awsProfileMap: Map<string, string>,
        options: IExportOptions,
        keysExportDir: string,
        outputDir: string
    ): Promise<IExportServer> {
        const exported: IExportServer = {
            name: server.name,
            host: server.host,
            username: server.username,
            pem_file: "", // Will be set below
        };

        // Handle PEM file
        if (options.includePemContent) {
            try {
                const pemContent = await readFile(server.pem_path, "utf-8");
                exported.pem_file = { $content: pemContent };
            } catch {
                // Fallback to reference if can't read
                exported.pem_file = { $ref: server.pem_path };
            }
        } else {
            // Copy PEM to keys directory and use relative reference
            try {
                await mkdir(keysExportDir, { recursive: true });
                const pemFilename = basename(server.pem_path);
                const destPath = join(keysExportDir, pemFilename);
                await copyFile(server.pem_path, destPath);
                const relativePath = "./" + relative(outputDir, destPath);
                exported.pem_file = { $ref: relativePath };
            } catch {
                // If copy fails, use absolute path
                exported.pem_file = { $ref: server.pem_path };
            }
        }

        // AWS profile reference
        if (server.aws_profile_id && awsProfileMap.has(server.aws_profile_id)) {
            exported.aws_profile = awsProfileMap.get(server.aws_profile_id);
        }

        // AWS metadata
        if (server.aws_instance_id) exported.aws_instance_id = server.aws_instance_id;
        if (server.aws_region) exported.aws_region = server.aws_region;
        if (server.private_ip) exported.private_ip = server.private_ip;

        // Tunnels
        if (server.tunnels && server.tunnels.length > 0) {
            exported.tunnels = server.tunnels.map((t) => ({
                name: t.name,
                type: t.type,
                localPort: t.localPort,
                remoteHost: t.remoteHost,
                remotePort: t.remotePort,
                ...(t.metadata && { metadata: t.metadata }),
            }));
        }

        // Synced files
        if (server.synced_files && server.synced_files.length > 0) {
            exported.synced_files = server.synced_files.map((sf) => ({
                name: sf.name,
                local_path: sf.local_path,
                remote_path: sf.remote_path,
            }));
        }

        return exported;
    }

    private exportRDSInstance(
        rds: IRDSInstance,
        awsProfileMap: Map<string, string>,
        serverMap: Map<string, string>
    ): IExportRDSInstance {
        const exported: IExportRDSInstance = {
            name: rds.name,
            db_instance_identifier: rds.db_instance_identifier,
            endpoint: rds.endpoint,
            port: rds.port,
            engine: rds.engine,
            engine_version: rds.engine_version,
            aws_region: rds.aws_region,
            aws_profile: awsProfileMap.get(rds.aws_profile_id) || rds.aws_profile_id,
        };

        if (rds.db_name) exported.db_name = rds.db_name;
        if (rds.master_username) exported.master_username = rds.master_username;
        if (rds.local_port) exported.local_port = rds.local_port;
        if (rds.linked_server_id && serverMap.has(rds.linked_server_id)) {
            exported.linked_server = serverMap.get(rds.linked_server_id);
        }

        return exported;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Import Functions
    // ─────────────────────────────────────────────────────────────────────────────

    async importConfig(
        inputPath: string,
        options: IImportOptions = {}
    ): Promise<IImportResult> {
        const result: IImportResult = {
            success: false,
            imported: { servers: 0, aws_profiles: 0, rds_instances: 0 },
            skipped: { servers: [], aws_profiles: [], rds_instances: [] },
            errors: [],
        };

        try {
            const content = await readFile(inputPath, "utf-8");
            const config = YAML.parse(content) as IExportConfig;

            if (!config || !config.version) {
                result.errors.push("Invalid config file format");
                return result;
            }

            const activeProfile = storageService.getActiveProfile();
            if (!activeProfile) {
                result.errors.push("No active profile - please login first");
                return result;
            }

            const inputDir = dirname(inputPath);

            // Import AWS profiles first
            const awsProfileIdMap = new Map<string, string>(); // name -> id
            for (const profile of config.aws_profiles || []) {
                const importResult = await this.importAWSProfile(profile, options);
                if (importResult.imported) {
                    result.imported.aws_profiles++;
                    awsProfileIdMap.set(profile.name, importResult.id);
                } else if (importResult.skipped) {
                    result.skipped.aws_profiles.push(profile.name);
                    // Still need the existing ID for references
                    const existing = storageService.getAWSProfileByName(profile.name);
                    if (existing) awsProfileIdMap.set(profile.name, existing.id);
                } else if (importResult.error) {
                    result.errors.push(`AWS Profile ${profile.name}: ${importResult.error}`);
                }
            }

            // Import servers
            const serverIdMap = new Map<string, string>(); // name -> id
            for (const server of config.servers || []) {
                const importResult = await this.importServer(
                    server,
                    activeProfile.id,
                    awsProfileIdMap,
                    inputDir,
                    options
                );
                if (importResult.imported) {
                    result.imported.servers++;
                    serverIdMap.set(server.name, importResult.id);
                } else if (importResult.skipped) {
                    result.skipped.servers.push(server.name);
                    // Get existing ID for references
                    const servers = storageService.getServersByProfileId(activeProfile.id);
                    const existing = servers.find((s) => s.name === server.name);
                    if (existing) serverIdMap.set(server.name, existing.id);
                } else if (importResult.error) {
                    result.errors.push(`Server ${server.name}: ${importResult.error}`);
                }
            }

            // Import RDS instances
            for (const rds of config.rds_instances || []) {
                const importResult = await this.importRDSInstance(
                    rds,
                    activeProfile.id,
                    awsProfileIdMap,
                    serverIdMap,
                    options
                );
                if (importResult.imported) {
                    result.imported.rds_instances++;
                } else if (importResult.skipped) {
                    result.skipped.rds_instances.push(rds.name);
                } else if (importResult.error) {
                    result.errors.push(`RDS ${rds.name}: ${importResult.error}`);
                }
            }

            result.success = result.errors.length === 0;
            logger.info(
                `Import complete: ${result.imported.servers} servers, ${result.imported.aws_profiles} AWS profiles, ${result.imported.rds_instances} RDS instances`
            );
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push(`Import failed: ${errorMsg}`);
            return result;
        }
    }

    private async importAWSProfile(
        profile: IExportAWSProfile,
        options: IImportOptions
    ): Promise<{ imported?: boolean; skipped?: boolean; id: string; error?: string }> {
        const existing = storageService.getAWSProfileByName(profile.name);

        if (existing && !options.overwrite) {
            return { skipped: true, id: existing.id };
        }

        if (options.dryRun) {
            return { imported: true, id: "dry-run-id" };
        }

        const id = existing?.id || nanoid();
        const newProfile: IAWSProfile = {
            id,
            name: profile.name,
            auth_type: profile.auth_type,
            cli_profile_name: profile.cli_profile_name,
            default_region: profile.default_region,
            created_at: new Date().toISOString(),
        };

        storageService.saveAWSProfile(newProfile);
        return { imported: true, id };
    }

    private async importServer(
        server: IExportServer,
        profileId: string,
        awsProfileMap: Map<string, string>,
        inputDir: string,
        options: IImportOptions
    ): Promise<{ imported?: boolean; skipped?: boolean; id: string; error?: string }> {
        const existingServers = storageService.getServersByProfileId(profileId);
        const existing = existingServers.find((s) => s.name === server.name);

        if (existing && !options.overwrite) {
            return { skipped: true, id: existing.id };
        }

        if (options.dryRun) {
            return { imported: true, id: "dry-run-id" };
        }

        // Resolve PEM file path
        let pemPath: string;
        try {
            pemPath = await this.resolvePemFile(server.pem_file, inputDir, server.name);
        } catch (error) {
            return {
                error: `Failed to resolve PEM file: ${error instanceof Error ? error.message : String(error)}`,
                id: "",
            };
        }

        const id = existing?.id || nanoid();
        const newServer: IServerConfig = {
            id,
            profile_id: profileId,
            name: server.name,
            host: server.host,
            username: server.username,
            pem_path: pemPath,
            created_at: new Date().toISOString(),
        };

        // AWS profile reference
        if (server.aws_profile && awsProfileMap.has(server.aws_profile)) {
            newServer.aws_profile_id = awsProfileMap.get(server.aws_profile);
        }

        // AWS metadata
        if (server.aws_instance_id) newServer.aws_instance_id = server.aws_instance_id;
        if (server.aws_region) newServer.aws_region = server.aws_region;
        if (server.private_ip) newServer.private_ip = server.private_ip;

        // Tunnels
        if (server.tunnels && server.tunnels.length > 0) {
            newServer.tunnels = server.tunnels.map((t) => ({
                id: nanoid(),
                name: t.name,
                type: t.type,
                localPort: t.localPort,
                remoteHost: t.remoteHost,
                remotePort: t.remotePort,
                ...(t.metadata && { metadata: t.metadata }),
            }));
        }

        // Synced files
        if (server.synced_files && server.synced_files.length > 0) {
            newServer.synced_files = server.synced_files.map((sf) => ({
                id: nanoid(),
                name: sf.name,
                local_path: sf.local_path,
                remote_path: sf.remote_path,
                created_at: new Date().toISOString(),
            }));
        }

        storageService.saveServer(newServer);
        return { imported: true, id };
    }

    private async resolvePemFile(
        pemFile: string | { $ref: string } | { $content: string },
        inputDir: string,
        serverName: string
    ): Promise<string> {
        // Ensure keys directory exists
        await mkdir(this.keysDir, { recursive: true });

        if (typeof pemFile === "string") {
            // Direct path string (legacy format)
            if (isAbsolute(pemFile)) {
                await access(pemFile); // Verify exists
                return pemFile;
            }
            const resolved = resolve(inputDir, pemFile);
            await access(resolved);
            return resolved;
        }

        if ("$content" in pemFile) {
            // Embedded content - write to keys directory
            const filename = `${serverName.replace(/[^a-zA-Z0-9-_]/g, "_")}.pem`;
            const destPath = join(this.keysDir, filename);
            await writeFile(destPath, pemFile.$content, { mode: 0o600 });
            return destPath;
        }

        if ("$ref" in pemFile) {
            // Reference path
            let sourcePath = pemFile.$ref;
            if (!isAbsolute(sourcePath)) {
                sourcePath = resolve(inputDir, sourcePath);
            }

            // Verify source exists
            await access(sourcePath);

            // Copy to keys directory
            const filename = basename(sourcePath);
            const destPath = join(this.keysDir, filename);
            await copyFile(sourcePath, destPath);

            // Set proper permissions
            const { chmod } = await import("fs/promises");
            await chmod(destPath, 0o600);

            return destPath;
        }

        throw new Error("Invalid PEM file format");
    }

    private async importRDSInstance(
        rds: IExportRDSInstance,
        profileId: string,
        awsProfileMap: Map<string, string>,
        serverMap: Map<string, string>,
        options: IImportOptions
    ): Promise<{ imported?: boolean; skipped?: boolean; id: string; error?: string }> {
        const existingInstances = storageService.getRDSByProfileId(profileId);
        const existing = existingInstances.find(
            (r) => r.db_instance_identifier === rds.db_instance_identifier
        );

        if (existing && !options.overwrite) {
            return { skipped: true, id: existing.id };
        }

        if (options.dryRun) {
            return { imported: true, id: "dry-run-id" };
        }

        const awsProfileId = awsProfileMap.get(rds.aws_profile);
        if (!awsProfileId) {
            return { error: `AWS profile '${rds.aws_profile}' not found`, id: "" };
        }

        const id = existing?.id || nanoid();
        const newRDS: IRDSInstance = {
            id,
            name: rds.name,
            profile_id: profileId,
            aws_profile_id: awsProfileId,
            db_instance_identifier: rds.db_instance_identifier,
            endpoint: rds.endpoint,
            port: rds.port,
            engine: rds.engine as any,
            engine_version: rds.engine_version,
            status: "available",
            aws_region: rds.aws_region,
            created_at: new Date().toISOString(),
        };

        if (rds.db_name) newRDS.db_name = rds.db_name;
        if (rds.master_username) newRDS.master_username = rds.master_username;
        if (rds.local_port) newRDS.local_port = rds.local_port;

        // Linked server reference
        if (rds.linked_server && serverMap.has(rds.linked_server)) {
            newRDS.linked_server_id = serverMap.get(rds.linked_server);
        }

        storageService.saveRDSInstance(newRDS);
        return { imported: true, id };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Utility Functions
    // ─────────────────────────────────────────────────────────────────────────────

    async previewImport(inputPath: string): Promise<{
        servers: string[];
        aws_profiles: string[];
        rds_instances: string[];
        errors: string[];
    }> {
        try {
            const content = await readFile(inputPath, "utf-8");
            const config = YAML.parse(content) as IExportConfig;

            return {
                servers: (config.servers || []).map((s) => s.name),
                aws_profiles: (config.aws_profiles || []).map((p) => p.name),
                rds_instances: (config.rds_instances || []).map((r) => r.name),
                errors: [],
            };
        } catch (error) {
            return {
                servers: [],
                aws_profiles: [],
                rds_instances: [],
                errors: [error instanceof Error ? error.message : String(error)],
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Selection-Based Export
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get all items that can be exported for selection UI
     */
    getExportableItems(): IExportableItems {
        const activeProfile = storageService.getActiveProfile();
        if (!activeProfile) {
            return { servers: [], aws_profiles: [], rds_instances: [] };
        }

        const servers = storageService.getServersByProfileId(activeProfile.id);
        const awsProfiles = storageService.getAllAWSProfiles();
        const rdsInstances = storageService.getRDSByProfileId(activeProfile.id);

        return {
            servers: servers.map((s) => ({ id: s.id, name: s.name, host: s.host })),
            aws_profiles: awsProfiles.map((p) => ({
                id: p.id,
                name: p.name,
                auth_type: p.auth_type,
            })),
            rds_instances: rdsInstances.map((r) => ({
                id: r.id,
                name: r.name,
                endpoint: r.endpoint,
            })),
        };
    }

    /**
     * Export only selected items
     */
    async exportSelectedConfig(
        selection: IExportSelection,
        outputPath: string,
        options: IExportOptions = {}
    ): Promise<{ success: boolean; path: string; error?: string }> {
        try {
            const activeProfile = storageService.getActiveProfile();
            if (!activeProfile) {
                return { success: false, path: outputPath, error: "No active profile" };
            }

            // Get only selected items
            const allServers = storageService.getServersByProfileId(activeProfile.id);
            const allAWSProfiles = storageService.getAllAWSProfiles();
            const allRDSInstances = storageService.getRDSByProfileId(activeProfile.id);

            const servers = allServers.filter((s) => selection.server_ids.includes(s.id));
            const awsProfiles = allAWSProfiles.filter((p) =>
                selection.aws_profile_ids.includes(p.id)
            );
            const rdsInstances = allRDSInstances.filter((r) =>
                selection.rds_instance_ids.includes(r.id)
            );

            // Build export config
            const exportConfig: IExportConfig = {
                $schema: "https://karpi.dev/schemas/config-v1.yaml",
                version: APP_VERSION,
                exported_at: new Date().toISOString(),
                servers: [],
                aws_profiles: [],
                rds_instances: [],
            };

            // Export AWS profiles first
            const awsProfileNameMap = new Map<string, string>();
            for (const profile of awsProfiles) {
                awsProfileNameMap.set(profile.id, profile.name);
                exportConfig.aws_profiles.push(this.exportAWSProfile(profile));
            }

            // Export servers
            const outputDir = dirname(outputPath);
            const keysExportDir = join(outputDir, options.outputDir || "keys");

            for (const server of servers) {
                const exportedServer = await this.exportServer(
                    server,
                    awsProfileNameMap,
                    options,
                    keysExportDir,
                    outputDir
                );
                exportConfig.servers.push(exportedServer);
            }

            // Export RDS instances
            const serverNameMap = new Map<string, string>();
            for (const server of servers) {
                serverNameMap.set(server.id, server.name);
            }

            for (const rds of rdsInstances) {
                exportConfig.rds_instances.push(
                    this.exportRDSInstance(rds, awsProfileNameMap, serverNameMap)
                );
            }

            // Write YAML file
            const yamlContent = YAML.stringify(exportConfig, {
                indent: 2,
                lineWidth: 0,
            });

            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, yamlContent, "utf-8");

            logger.info(`Selected config exported to: ${outputPath}`);
            return { success: true, path: outputPath };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Export failed: ${errorMsg}`);
            return { success: false, path: outputPath, error: errorMsg };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Import Diff Preview
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get detailed diff of what would be imported (new vs modified vs unchanged)
     */
    async getImportDiff(inputPath: string): Promise<IImportDiff> {
        const diff: IImportDiff = {
            new_items: { servers: [], aws_profiles: [], rds_instances: [] },
            modified_items: { servers: [], aws_profiles: [], rds_instances: [] },
            unchanged: { servers: [], aws_profiles: [], rds_instances: [] },
        };

        try {
            const content = await readFile(inputPath, "utf-8");
            const config = YAML.parse(content) as IExportConfig;

            const activeProfile = storageService.getActiveProfile();
            if (!activeProfile) return diff;

            // Check AWS profiles
            for (const importProfile of config.aws_profiles || []) {
                const existing = storageService.getAWSProfileByName(importProfile.name);
                if (!existing) {
                    diff.new_items.aws_profiles.push(importProfile);
                } else {
                    const changes = this.compareAWSProfile(existing, importProfile);
                    if (changes.length > 0) {
                        diff.modified_items.aws_profiles.push({
                            name: importProfile.name,
                            changes,
                        });
                    } else {
                        diff.unchanged.aws_profiles.push(importProfile.name);
                    }
                }
            }

            // Check servers
            const existingServers = storageService.getServersByProfileId(activeProfile.id);
            for (const importServer of config.servers || []) {
                const existing = existingServers.find((s) => s.name === importServer.name);
                if (!existing) {
                    diff.new_items.servers.push(importServer);
                } else {
                    const changes = this.compareServer(existing, importServer);
                    if (changes.length > 0) {
                        diff.modified_items.servers.push({
                            name: importServer.name,
                            changes,
                        });
                    } else {
                        diff.unchanged.servers.push(importServer.name);
                    }
                }
            }

            // Check RDS instances
            const existingRDS = storageService.getRDSByProfileId(activeProfile.id);
            for (const importRDS of config.rds_instances || []) {
                const existing = existingRDS.find(
                    (r) => r.db_instance_identifier === importRDS.db_instance_identifier
                );
                if (!existing) {
                    diff.new_items.rds_instances.push(importRDS);
                } else {
                    const changes = this.compareRDS(existing, importRDS);
                    if (changes.length > 0) {
                        diff.modified_items.rds_instances.push({
                            name: importRDS.name,
                            changes,
                        });
                    } else {
                        diff.unchanged.rds_instances.push(importRDS.name);
                    }
                }
            }

            return diff;
        } catch (error) {
            logger.error(`Diff failed: ${error}`);
            return diff;
        }
    }

    private compareAWSProfile(
        existing: IAWSProfile,
        imported: IExportAWSProfile
    ): Array<{ field: string; from: string; to: string }> {
        const changes: Array<{ field: string; from: string; to: string }> = [];

        if (existing.auth_type !== imported.auth_type) {
            changes.push({
                field: "auth_type",
                from: existing.auth_type,
                to: imported.auth_type,
            });
        }
        if (existing.default_region !== imported.default_region) {
            changes.push({
                field: "default_region",
                from: existing.default_region,
                to: imported.default_region,
            });
        }
        if (existing.cli_profile_name !== imported.cli_profile_name) {
            changes.push({
                field: "cli_profile_name",
                from: existing.cli_profile_name || "",
                to: imported.cli_profile_name || "",
            });
        }

        return changes;
    }

    private compareServer(
        existing: IServerConfig,
        imported: IExportServer
    ): Array<{ field: string; from: string; to: string }> {
        const changes: Array<{ field: string; from: string; to: string }> = [];

        if (existing.host !== imported.host) {
            changes.push({ field: "host", from: existing.host, to: imported.host });
        }
        if (existing.username !== imported.username) {
            changes.push({
                field: "username",
                from: existing.username,
                to: imported.username,
            });
        }

        // Compare tunnel count
        const existingTunnelCount = existing.tunnels?.length || 0;
        const importedTunnelCount = imported.tunnels?.length || 0;
        if (existingTunnelCount !== importedTunnelCount) {
            changes.push({
                field: "tunnels",
                from: `${existingTunnelCount} tunnels`,
                to: `${importedTunnelCount} tunnels`,
            });
        }

        return changes;
    }

    private compareRDS(
        existing: IRDSInstance,
        imported: IExportRDSInstance
    ): Array<{ field: string; from: string; to: string }> {
        const changes: Array<{ field: string; from: string; to: string }> = [];

        if (existing.endpoint !== imported.endpoint) {
            changes.push({
                field: "endpoint",
                from: existing.endpoint,
                to: imported.endpoint,
            });
        }
        if (existing.port !== imported.port) {
            changes.push({
                field: "port",
                from: String(existing.port),
                to: String(imported.port),
            });
        }

        return changes;
    }
}

// Singleton instance
export const exportService = new ExportService();


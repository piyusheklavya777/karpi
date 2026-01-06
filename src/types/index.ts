// src/types/index.ts

export interface IUserProfile {
  id: string;
  username: string;
  email?: string;
  created_at: string;
  last_login: string;
  preferences: IUserPreferences;
  recent_actions: IRecentAction[];
  biometric_enabled?: boolean; // Touch ID enabled for this profile
}

export interface IRecentAction {
  id: string;
  type: "ssh" | "tunnel";
  serverId: string;
  tunnelId?: string; // Only for tunnels
  name: string; // Display name (e.g., "iamdev -> rds")
  timestamp: string;
}

export interface IBackgroundProcess {
  pid: number;
  type: "tunnel";
  serverId: string;
  tunnelId: string;
  name: string;
  startTime: string;
}

export interface IUserPreferences {
  theme: "dark" | "light" | "auto";
  editor: string;
  terminal_colors: string[];
  auto_logout_minutes: number;
}

export interface ISession {
  profile_id: string;
  username: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface IAuthCredentials {
  username: string;
  password: string;
}

export interface ILoginResponse {
  success: boolean;
  profile?: IUserProfile;
  session?: ISession;
  error?: string;
}

export interface IStorageConfig {
  version: string;
  active_profile_id: string | null;
  profiles: IUserProfile[];
  sessions: ISession[];
  servers: IServerConfig[];
  processes: IBackgroundProcess[]; // Persist PIDs
  preferences: IGlobalPreferences;
  aws_profiles: IAWSProfile[]; // AWS credential profiles
  rds_instances: IRDSInstance[]; // RDS database instances
  shareables: IShareable[]; // Saved export selection presets
}

/**
 * Shareable - saved selection preset for exporting configs
 * Allows users to save named selections like "dev-team", "ops-team"
 */
export interface IShareable {
  id: string;
  name: string; // User-defined name (e.g., "dev-team", "ops-team")
  version: number; // Auto-increments on each export (v1, v2, etc.)
  server_ids: string[]; // IDs of selected servers
  aws_profile_ids: string[]; // IDs of selected AWS profiles
  rds_instance_ids: string[]; // IDs of selected RDS instances
  created_at: string;
  last_used?: string;
}

/**
 * Export log entry - tracks who exported what and when
 */
export interface IExportLogEntry {
  timestamp: string;
  username: string;
  shareable_name: string;
  shareable_version: number;
  filename: string;
  items_count: number;
}

export interface IServerConfig {
  id: string;
  profile_id: string; // Servers are scoped to a user profile
  name: string;
  host: string;
  username: string;
  pem_path: string; // Path inside .karpi/keys
  created_at: string;
  last_connected?: string;
  tunnels?: ITunnelConfig[];
  synced_files?: ISyncedFile[]; // Local-to-remote file syncs
  // AWS integration
  aws_profile_id?: string; // Link to IAWSProfile
  aws_instance_id?: string; // EC2 instance ID if imported from AWS
  aws_region?: string; // Region where the instance is located
  private_ip?: string; // Private IP for VPC connections
}

/**
 * Synced File - represents a file that can be synced from local to remote server
 * Useful for deploying config files, .env files, etc.
 */
export interface ISyncedFile {
  id: string;
  name: string; // User-friendly name (e.g., "Dev ENV File", "Nginx Config")
  local_path: string; // Absolute path on local machine
  remote_path: string; // Absolute path on remote server
  created_at: string;
  last_synced?: string; // Last time the file was synced
}

export interface ITunnelConfig {
  id: string;
  name: string;
  type: "custom" | "rds" | "redis" | "service";
  localPort: number;
  remoteHost: string;
  remotePort: number;
  // Optional metadata for templates
  metadata?: {
    dbUsername?: string;
    dbName?: string;
  };
}

export interface IGlobalPreferences {
  theme: "dark" | "light" | "auto";
  auto_logout_minutes: number;
  startup_command: string;
}

export interface IApiConfig {
  endpoint: string;
  enabled: boolean;
  timeout: number;
}

export interface ICommandContext {
  profile?: IUserProfile;
  session?: ISession;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AWS Integration Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AWS Profile - stores credentials for AWS operations
 * Can use either an existing AWS CLI profile or direct access keys
 */
export interface IAWSProfile {
  id: string;
  name: string; // User-defined friendly name (e.g., "my-work-aws")
  auth_type: "cli_profile" | "access_keys";
  // For CLI profile authentication
  cli_profile_name?: string; // AWS CLI profile name (e.g., "default", "production")
  // For access key authentication
  access_key_id?: string;
  secret_access_key?: string; // Stored securely
  // Common settings
  default_region: string;
  created_at: string;
  last_used?: string;
}

/**
 * EC2 Instance data fetched from AWS
 */
export interface IAWSInstance {
  instance_id: string;
  name: string; // From Name tag
  public_ip?: string;
  private_ip?: string;
  state:
  | "running"
  | "stopped"
  | "pending"
  | "terminated"
  | "stopping"
  | "shutting-down";
  instance_type: string;
  key_name?: string; // SSH key pair name
  launch_time: string;
  vpc_id?: string;
  subnet_id?: string;
  security_groups: string[];
  tags: Record<string, string>;
  // Computed fields
  is_imported?: boolean; // Already exists in karpi
  existing_server_id?: string; // ID of the matching server in karpi
}

/**
 * Result of fetching EC2 instances
 */
export interface IAWSFetchResult {
  success: boolean;
  instances: IAWSInstance[];
  error?: string;
  region: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RDS Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supported RDS engine types
 */
export type TRDSEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "aurora-postgresql"
  | "aurora-mysql"
  | "sqlserver-ex"
  | "sqlserver-web"
  | "sqlserver-se"
  | "sqlserver-ee"
  | "oracle-se2"
  | "oracle-ee";

/**
 * RDS Instance stored in CLI
 */
export interface IRDSInstance {
  id: string;
  name: string; // User-friendly alias
  profile_id: string; // Karpi user profile
  aws_profile_id: string; // AWS credentials profile
  // AWS metadata
  db_instance_identifier: string;
  endpoint: string;
  port: number;
  engine: TRDSEngine;
  engine_version: string;
  db_name?: string;
  master_username?: string;
  status: string;
  vpc_id?: string;
  aws_region: string;
  // Linked server for tunneling
  linked_server_id?: string;
  linked_tunnel_id?: string;
  // Connection
  local_port?: number; // Port to use when tunneling
  // Timestamps
  created_at: string;
  last_connected?: string;
}

/**
 * RDS Instance data fetched from AWS
 */
export interface IAWSRDSInstance {
  db_instance_identifier: string;
  db_instance_class: string;
  engine: TRDSEngine;
  engine_version: string;
  status: string;
  endpoint?: string;
  port: number;
  db_name?: string;
  master_username?: string;
  vpc_id?: string;
  availability_zone?: string;
  multi_az: boolean;
  storage_type: string;
  allocated_storage: number;
  publicly_accessible: boolean;
  created_time: string;
  tags: Record<string, string>;
  // Computed fields
  is_imported?: boolean;
  existing_rds_id?: string;
}

/**
 * Result of fetching RDS instances
 */
export interface IAWSRDSFetchResult {
  success: boolean;
  instances: IAWSRDSInstance[];
  error?: string;
  region: string;
}

// src/types/index.ts

export interface IUserProfile {
  id: string;
  username: string;
  email?: string;
  created_at: string;
  last_login: string;
  preferences: IUserPreferences;
  recent_actions: IRecentAction[];
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
  // AWS integration
  aws_profile_id?: string; // Link to IAWSProfile
  aws_instance_id?: string; // EC2 instance ID if imported from AWS
  aws_region?: string; // Region where the instance is located
  private_ip?: string; // Private IP for VPC connections
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

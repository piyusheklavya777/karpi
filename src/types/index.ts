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
  type: 'ssh' | 'tunnel';
  serverId: string;
  tunnelId?: string; // Only for tunnels
  name: string; // Display name (e.g., "iamdev -> rds")
  timestamp: string;
}

export interface IBackgroundProcess {
  pid: number;
  type: 'tunnel';
  serverId: string;
  tunnelId: string;
  name: string;
  startTime: string;
}

export interface IUserPreferences {
  theme: 'dark' | 'light' | 'auto';
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
}

export interface ITunnelConfig {
  id: string;
  name: string;
  type: 'custom' | 'rds' | 'redis' | 'service';
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
  theme: 'dark' | 'light' | 'auto';
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

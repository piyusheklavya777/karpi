// src/services/auth.service.ts

import { keychain } from "../utils/keychain";
import type {
  IAuthCredentials,
  ILoginResponse,
  ISession,
  IUserProfile,
} from "../types";
import { KEYCHAIN_SERVICE } from "../config/constants";
import { CryptoUtil } from "../utils/crypto";
import { logger } from "../utils/logger";
import { storageService } from "./storage.service";
import { profileService } from "./profile.service";
import { ZODLoginCredentialsSchema } from "../utils/validators";

export class AuthService {
  /**
   * Register a new user profile
   */
  async register(
    credentials: IAuthCredentials,
    email?: string
  ): Promise<ILoginResponse> {
    // Validate credentials
    try {
      ZODLoginCredentialsSchema.parse(credentials);
    } catch (error) {
      return {
        success: false,
        error: "Invalid credentials format",
      };
    }

    // Check if username already exists
    if (profileService.usernameExists(credentials.username)) {
      return {
        success: false,
        error: "Username already exists",
      };
    }

    try {
      // Hash password
      const passwordHash = await CryptoUtil.hashPassword(credentials.password);

      // Create profile
      const profile = profileService.createProfile(credentials.username, email);

      // Store password in keychain (macOS security CLI)
      await keychain.setPassword(
        KEYCHAIN_SERVICE,
        credentials.username,
        passwordHash
      );

      // Create session
      const session = this.createSession(profile);
      storageService.saveSession(session);

      // Set as active profile
      profileService.setActiveProfile(profile.id);

      logger.success(`User registered: ${credentials.username}`);

      return {
        success: true,
        profile,
        session,
      };
    } catch (error) {
      logger.error("Registration failed", error);
      return {
        success: false,
        error: "Registration failed",
      };
    }
  }

  /**
   * Login with username and password
   */
  async login(credentials: IAuthCredentials): Promise<ILoginResponse> {
    // Validate credentials
    try {
      ZODLoginCredentialsSchema.parse(credentials);
    } catch (error) {
      return {
        success: false,
        error: "Invalid credentials format",
      };
    }

    try {
      // Get profile
      const profile = profileService.getProfileByUsername(credentials.username);
      if (!profile) {
        return {
          success: false,
          error: "Invalid username or password",
        };
      }

      // Get stored password hash
      const storedHash = await keychain.getPassword(
        KEYCHAIN_SERVICE,
        credentials.username
      );

      if (!storedHash) {
        return {
          success: false,
          error: "Invalid username or password",
        };
      }

      // Verify password
      const isValid = await CryptoUtil.comparePassword(
        credentials.password,
        storedHash
      );

      if (!isValid) {
        return {
          success: false,
          error: "Invalid username or password",
        };
      }

      // Check for existing session
      let session = storageService.getSessionByProfileId(profile.id);

      if (session && !CryptoUtil.isSessionExpired(session)) {
        // Use existing session
        logger.info(`Existing session found for: ${credentials.username}`);
      } else {
        // Create new session
        session = this.createSession(profile);
        storageService.saveSession(session);
      }

      // Set as active profile
      profileService.setActiveProfile(profile.id);

      logger.success(`User logged in: ${credentials.username}`);

      return {
        success: true,
        profile,
        session,
      };
    } catch (error) {
      logger.error("Login failed", error);
      return {
        success: false,
        error: "Login failed",
      };
    }
  }

  /**
   * Login with biometric (Touch ID) - no password needed
   * Should only be called after successful biometric verification
   */
  async loginWithBiometric(username: string): Promise<ILoginResponse> {
    try {
      // Get profile
      const profile = profileService.getProfileByUsername(username);
      if (!profile) {
        return {
          success: false,
          error: "Profile not found",
        };
      }

      // Check if biometric is enabled for this profile
      if (!profile.biometric_enabled) {
        return {
          success: false,
          error: "Biometric not enabled for this profile",
        };
      }

      // Check for existing session
      let session = storageService.getSessionByProfileId(profile.id);

      if (session && !CryptoUtil.isSessionExpired(session)) {
        // Use existing session
        logger.info(`Existing session found for: ${username}`);
      } else {
        // Create new session
        session = this.createSession(profile);
        storageService.saveSession(session);
      }

      // Set as active profile
      profileService.setActiveProfile(profile.id);

      logger.success(`User logged in via Touch ID: ${username}`);

      return {
        success: true,
        profile,
        session,
      };
    } catch (error) {
      logger.error("Biometric login failed", error);
      return {
        success: false,
        error: "Biometric login failed",
      };
    }
  }

  /**
   * Logout current user
   */
  logout(): boolean {
    const activeProfile = profileService.getActiveProfile();

    if (!activeProfile) {
      logger.warn("No active profile to logout");
      return false;
    }

    // Delete session
    storageService.deleteSession(activeProfile.id);

    // Clear active profile
    profileService.clearActiveProfile();

    logger.success(`User logged out: ${activeProfile.username}`);
    return true;
  }

  /**
   * Logout all sessions
   */
  logoutAll(): void {
    storageService.deleteAllSessions();
    profileService.clearActiveProfile();
    logger.success("All sessions logged out");
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return false;

    const session = storageService.getSessionByProfileId(activeProfile.id);
    if (!session) return false;

    // Check if session is expired
    if (CryptoUtil.isSessionExpired(session)) {
      this.logout();
      return false;
    }

    return true;
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser(): { profile: IUserProfile; session: ISession } | null {
    if (!this.isAuthenticated()) return null;

    const profile = profileService.getActiveProfile();
    if (!profile) return null;

    const session = storageService.getSessionByProfileId(profile.id);
    if (!session) return null;

    return { profile, session };
  }

  /**
   * Change password for a user
   */
  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    try {
      // Verify old password
      const storedHash = await keychain.getPassword(KEYCHAIN_SERVICE, username);
      if (!storedHash) return false;

      const isValid = await CryptoUtil.comparePassword(oldPassword, storedHash);
      if (!isValid) return false;

      // Hash and store new password
      const newHash = await CryptoUtil.hashPassword(newPassword);
      await keychain.setPassword(KEYCHAIN_SERVICE, username, newHash);

      logger.success(`Password changed for: ${username}`);
      return true;
    } catch (error) {
      logger.error("Password change failed", error);
      return false;
    }
  }

  /**
   * Delete user credentials from keychain
   */
  async deleteCredentials(username: string): Promise<boolean> {
    try {
      await keychain.deletePassword(KEYCHAIN_SERVICE, username);
      logger.info(`Credentials deleted for: ${username}`);
      return true;
    } catch (error) {
      logger.error("Failed to delete credentials", error);
      return false;
    }
  }

  /**
   * Create a new session for a profile
   */
  private createSession(profile: IUserProfile): ISession {
    const token = CryptoUtil.generateToken(profile.id, profile.username);
    const expiresAt = CryptoUtil.generateExpiryDate();

    return {
      profile_id: profile.id,
      username: profile.username,
      token,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
  }
}

// Singleton instance
export const authService = new AuthService();

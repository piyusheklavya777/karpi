// src/services/profile.service.ts

import { nanoid } from 'nanoid';
import type { IUserProfile, IRecentAction } from '../types';
import { DEFAULT_PREFERENCES } from '../config/constants';
import { storageService } from './storage.service';
import { logger } from '../utils/logger';

export class ProfileService {
  /**
   * Create a new profile
   */
  createProfile(username: string, email?: string): IUserProfile {
    const profile: IUserProfile = {
      id: nanoid(),
      username,
      email,
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
      recent_actions: [],
      preferences: { ...DEFAULT_PREFERENCES },
    };

    storageService.saveProfile(profile);
    logger.info(`Profile created: ${username}`);

    return profile;
  }

  /**
   * Get profile by ID
   */
  getProfile(id: string): IUserProfile | undefined {
    return storageService.getProfileById(id);
  }

  /**
   * Get profile by username
   */
  getProfileByUsername(username: string): IUserProfile | undefined {
    return storageService.getProfileByUsername(username);
  }

  /**
   * List all profiles
   */
  listProfiles(): IUserProfile[] {
    return storageService.getAllProfiles();
  }

  /**
   * Update profile
   */
  updateProfile(id: string, updates: Partial<IUserProfile>): IUserProfile | null {
    const profile = this.getProfile(id);
    if (!profile) {
      logger.error(`Profile not found: ${id}`);
      return null;
    }

    const updatedProfile: IUserProfile = {
      ...profile,
      ...updates,
      id: profile.id, // Never allow ID to be changed
    };

    storageService.saveProfile(updatedProfile);
    logger.info(`Profile updated: ${profile.username}`);

    return updatedProfile;
  }

  /**
   * Update last login time
   */
  updateLastLogin(id: string): void {
    const profile = this.getProfile(id);
    if (profile) {
      profile.last_login = new Date().toISOString();
      storageService.saveProfile(profile);
    }
  }

  /**
   * Delete profile
   */
  deleteProfile(id: string): boolean {
    const deleted = storageService.deleteProfile(id);
    if (deleted) {
      logger.info(`Profile deleted: ${id}`);
    }
    return deleted;
  }

  /**
   * Check if username exists
   */
  usernameExists(username: string): boolean {
    return this.getProfileByUsername(username) !== undefined;
  }

  /**
   * Get active profile
   */
  getActiveProfile(): IUserProfile | undefined {
    return storageService.getActiveProfile();
  }

  /**
   * Set active profile
   */
  setActiveProfile(id: string): boolean {
    const profile = this.getProfile(id);
    if (!profile) {
      logger.error(`Cannot set active profile: Profile ${id} not found`);
      return false;
    }

    storageService.setActiveProfileId(id);
    this.updateLastLogin(id);
    logger.info(`Active profile set: ${profile.username}`);

    return true;
  }

  /**
   * Clear active profile
   */
  clearActiveProfile(): void {
    storageService.setActiveProfileId(null);
    logger.info('Active profile cleared');
  }

  addRecentAction(id: string, action: IRecentAction): void {
    const profile = this.getProfile(id);
    if (!profile) return;

    if (!profile.recent_actions) {
      profile.recent_actions = [];
    }

    // Add new action to top, remove duplicates
    const newActions = [action, ...profile.recent_actions];
    
    // Filter duplicates by name + type
    const uniqueActions = newActions.filter((v, i, a) => 
      a.findIndex(t => t.name === v.name && t.type === v.type) === i
    );

    // Keep only top 5
    profile.recent_actions = uniqueActions.slice(0, 5);
    
    storageService.saveProfile(profile);
  }
}

// Singleton instance
export const profileService = new ProfileService();

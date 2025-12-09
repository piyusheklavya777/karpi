// src/utils/crypto.ts

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SALT_ROUNDS, JWT_SECRET, SESSION_EXPIRY_HOURS } from '../config/constants';
import type { ISession } from '../types';

export class CryptoUtil {
  /**
   * Hash a password using bcrypt
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Compare a plain password with a hashed password
   */
  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a JWT token for a session
   */
  static generateToken(profile_id: string, username: string): string {
    const payload = {
      profile_id,
      username,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (SESSION_EXPIRY_HOURS * 60 * 60),
    };

    return jwt.sign(payload, JWT_SECRET);
  }

  /**
   * Verify and decode a JWT token
   */
  static verifyToken(token: string): { profile_id: string; username: string } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        profile_id: string;
        username: string;
      };
      return decoded;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a session is expired
   */
  static isSessionExpired(session: ISession): boolean {
    const expiresAt = new Date(session.expires_at);
    return expiresAt < new Date();
  }

  /**
   * Generate a session expiry date
   */
  static generateExpiryDate(): string {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + SESSION_EXPIRY_HOURS);
    return expiry.toISOString();
  }
}

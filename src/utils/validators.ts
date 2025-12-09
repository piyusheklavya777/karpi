// src/utils/validators.ts

import { z } from 'zod';

// Username validation schema
export const ZODUsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');

// Password validation schema
export const ZODPasswordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(100, 'Password must be at most 100 characters');

// Email validation schema (optional)
export const ZODEmailSchema = z
  .string()
  .email('Invalid email format')
  .optional();

// Login credentials schema
export const ZODLoginCredentialsSchema = z.object({
  username: ZODUsernameSchema,
  password: ZODPasswordSchema,
});

// Profile creation schema
export const ZODProfileCreateSchema = z.object({
  username: ZODUsernameSchema,
  password: ZODPasswordSchema,
  email: ZODEmailSchema,
});

// Profile preferences schema
export const ZODPreferencesSchema = z.object({
  theme: z.enum(['dark', 'light', 'auto']),
  editor: z.string(),
  terminal_colors: z.array(z.string()),
  auto_logout_minutes: z.number().min(1).max(1440),
});

// Validation helpers
export class Validator {
  static validateUsername(username: string): { valid: boolean; error?: string } {
    try {
      ZODUsernameSchema.parse(username);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, error: error.errors[0].message };
      }
      return { valid: false, error: 'Invalid username' };
    }
  }

  static validatePassword(password: string): { valid: boolean; error?: string } {
    try {
      ZODPasswordSchema.parse(password);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, error: error.errors[0].message };
      }
      return { valid: false, error: 'Invalid password' };
    }
  }

  static validateEmail(email: string): { valid: boolean; error?: string } {
    try {
      ZODEmailSchema.parse(email);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, error: error.errors[0].message };
      }
      return { valid: false, error: 'Invalid email' };
    }
  }
}

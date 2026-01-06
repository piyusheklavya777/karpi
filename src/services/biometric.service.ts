// src/services/biometric.service.ts

import { logger } from "../utils/logger";

/**
 * Biometric Service - macOS Touch ID authentication
 * Uses node-mac-auth for native Touch ID integration
 */
class BiometricService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private nodeMacAuth: any = null;
    private initialized = false;

    /**
     * Initialize the node-mac-auth module (lazy load)
     */
    private async init(): Promise<boolean> {
        if (this.initialized) return this.nodeMacAuth !== null;

        try {
            // Only load on macOS
            if (process.platform !== "darwin") {
                this.initialized = true;
                return false;
            }

            // @ts-ignore - node-mac-auth does not have type declarations
            this.nodeMacAuth = await import("node-mac-auth");
            this.initialized = true;
            return true;
        } catch (error) {
            logger.debug(`Touch ID module not available: ${error}`);
            this.initialized = true;
            return false;
        }
    }

    /**
     * Check if Touch ID is available on this device
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.init();
            if (!this.nodeMacAuth) return false;
            return this.nodeMacAuth.canPromptTouchID();
        } catch {
            return false;
        }
    }

    /**
     * Prompt for Touch ID authentication
     * @param reason - Message shown to user explaining why auth is needed
     * @returns true if authenticated successfully
     */
    async authenticate(reason = "authenticate to Karpi"): Promise<boolean> {
        try {
            await this.init();
            if (!this.nodeMacAuth) return false;

            if (!this.nodeMacAuth.canPromptTouchID()) {
                return false;
            }

            await this.nodeMacAuth.promptTouchID({ reason });
            logger.debug("Touch ID authentication successful");
            return true;
        } catch (error) {
            logger.debug(`Touch ID authentication failed: ${error}`);
            return false;
        }
    }
}

// Singleton instance
export const biometricService = new BiometricService();

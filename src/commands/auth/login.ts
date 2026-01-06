// src/commands/auth/login.ts

import inquirer from "inquirer";
import ora from "ora";
import boxen from "boxen";
import gradient from "gradient-string";
import { authService } from "../../services/auth.service";
import { profileService } from "../../services/profile.service";
import { biometricService } from "../../services/biometric.service";
import {
  styled,
  UI,
  COLORS,
  APP_DESCRIPTION,
  ASCII_LOGO,
} from "../../config/constants";
import { logger } from "../../utils/logger";
import { Validator } from "../../utils/validators";

export async function loginCommand(): Promise<void> {
  console.clear();

  // Display banner
  displayBanner();

  // Check if already logged in
  if (authService.isAuthenticated()) {
    const current = authService.getCurrentUser();
    if (current) {
      console.log(
        boxen(
          styled.success(
            `Already logged in as ${styled.accent(current.profile.username)}`
          ),
          {
            padding: 1,
            margin: 1,
            borderStyle: "round",
            borderColor: COLORS.SECONDARY,
          }
        )
      );

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: [
            {
              name: styled.secondary("Continue to Dashboard"),
              value: "continue",
            },
            { name: styled.primary("Switch Profile"), value: "switch" },
            { name: styled.dimmed("Logout"), value: "logout" },
          ],
        },
      ]);

      if (action === "logout") {
        authService.logout();
        logger.success("Logged out successfully");
        process.exit(0);
      } else if (action === "switch") {
        // Fall through to profile selection
      } else {
        return; // Continue to dashboard
      }
    }
  }

  // Get all profiles
  const profiles = profileService.listProfiles();

  if (profiles.length === 0) {
    // No profiles exist - offer to create one
    console.log(
      boxen(
        styled.info("No profiles found. Let's create your first profile!"),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: COLORS.SECONDARY,
        }
      )
    );

    await createNewProfile();
    return;
  }

  // Show profile selection
  const { selectedProfile } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedProfile",
      message: styled.brand("Select a profile:"),
      choices: [
        ...profiles.map((p) => ({
          name: `${UI.ICONS.USER} ${styled.accent(p.username)}${p.email ? styled.dimmed(` (${p.email})`) : ""
            }`,
          value: p.username,
        })),
        {
          name: styled.primary(`${UI.ICONS.ROCKET} Create New Profile`),
          value: "__new__",
        },
      ],
    },
  ]);

  if (selectedProfile === "__new__") {
    await createNewProfile();
    return;
  }

  // Get the profile to check if biometric is enabled
  const profile = profileService.getProfile(selectedProfile);
  const biometricAvailable = await biometricService.isAvailable();
  const useBiometric = profile?.biometric_enabled && biometricAvailable;

  let authenticated = false;

  if (useBiometric) {
    // Offer choice: Touch ID or Password
    const { authMethod } = await inquirer.prompt([
      {
        type: "list",
        name: "authMethod",
        message: styled.brand("How would you like to login?"),
        choices: [
          {
            name: `🔐 ${styled.primary("Use Touch ID")}`,
            value: "touchid",
          },
          {
            name: `${UI.ICONS.LOCK} ${styled.secondary("Use Password")}`,
            value: "password",
          },
        ],
      },
    ]);

    if (authMethod === "touchid") {
      const spinner = ora({
        text: "Authenticating with Touch ID...",
        color: "cyan",
      }).start();

      authenticated = await biometricService.authenticate(
        `Login to Karpi as ${selectedProfile}`
      );

      spinner.stop();

      if (authenticated) {
        // Direct login without password - Touch ID verified identity
        const result = await authService.loginWithBiometric(selectedProfile);

        if (result.success && result.profile) {
          console.log(
            boxen(
              styled.success(
                `${UI.ICONS.SUCCESS} Welcome back, ${styled.accent(
                  result.profile.username
                )}!`
              ),
              {
                padding: 1,
                margin: 1,
                borderStyle: "round",
                borderColor: COLORS.SUCCESS,
              }
            )
          );
          return;
        }
      } else {
        console.log(
          styled.warning("\n⚠️ Touch ID failed. Please use password.\n")
        );
      }
    }
  }

  // Get password (fallback or primary method)
  const { password } = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      message: `${UI.ICONS.LOCK} Password:`,
      mask: "*",
    },
  ]);

  // Attempt login
  const spinner = ora({
    text: "Authenticating...",
    color: "cyan",
  }).start();

  const result = await authService.login({
    username: selectedProfile,
    password,
  });

  spinner.stop();

  if (result.success && result.profile) {
    // After successful password login, offer to enable Touch ID if available
    if (biometricAvailable && !profile?.biometric_enabled) {
      const { enableBiometric } = await inquirer.prompt([
        {
          type: "confirm",
          name: "enableBiometric",
          message: styled.secondary("Enable Touch ID for faster login next time?"),
          default: true,
        },
      ]);

      if (enableBiometric && profile) {
        profileService.updateProfile(profile.id, { biometric_enabled: true });
        console.log(styled.success("\n✓ Touch ID enabled for this profile!\n"));
      }
    }

    console.log(
      boxen(
        styled.success(
          `${UI.ICONS.SUCCESS} Welcome back, ${styled.accent(
            result.profile.username
          )}!`
        ),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: COLORS.SUCCESS,
        }
      )
    );
  } else {
    console.log(
      boxen(
        styled.error(`${UI.ICONS.ERROR} ${result.error || "Login failed"}`),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: COLORS.ERROR,
        }
      )
    );
    process.exit(1);
  }
}

async function createNewProfile(): Promise<void> {
  console.log("\n" + styled.brand("Create New Profile") + "\n");

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "username",
      message: `${UI.ICONS.USER} Username:`,
      validate: (input: string) => {
        const result = Validator.validateUsername(input);
        if (!result.valid) return result.error || "Invalid username";
        if (profileService.usernameExists(input)) {
          return "Username already exists";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "email",
      message: `📧 Email (optional):`,
      validate: (input: string) => {
        if (!input) return true; // Email is optional
        const result = Validator.validateEmail(input);
        return result.valid || result.error || "Invalid email";
      },
    },
    {
      type: "password",
      name: "password",
      message: `${UI.ICONS.LOCK} Password:`,
      mask: "*",
      validate: (input: string) => {
        const result = Validator.validatePassword(input);
        return result.valid || result.error || "Invalid password";
      },
    },
    {
      type: "password",
      name: "confirmPassword",
      message: `${UI.ICONS.LOCK} Confirm Password:`,
      mask: "*",
      validate: (input: string, answers: { password: string }) => {
        if (input !== answers.password) {
          return "Passwords do not match";
        }
        return true;
      },
    },
  ]);

  const spinner = ora({
    text: "Creating profile...",
    color: "cyan",
  }).start();

  const result = await authService.register(
    {
      username: answers.username,
      password: answers.password,
    },
    answers.email || undefined
  );

  spinner.stop();

  if (result.success && result.profile) {
    console.log(
      boxen(
        styled.success(
          `${UI.ICONS.SUCCESS
          } Profile created successfully!\nWelcome, ${styled.accent(
            result.profile.username
          )}!`
        ),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: COLORS.SUCCESS,
        }
      )
    );
  } else {
    console.log(
      boxen(
        styled.error(
          `${UI.ICONS.ERROR} ${result.error || "Failed to create profile"}`
        ),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: COLORS.ERROR,
        }
      )
    );
    process.exit(1);
  }
}

function displayBanner(): void {
  const gradientLogo = gradient([COLORS.PRIMARY, COLORS.SECONDARY])(
    ASCII_LOGO
  );

  console.log("\n" + gradientLogo);
  console.log(styled.subtitle(`           ${APP_DESCRIPTION}\n`));
}

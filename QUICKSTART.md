# 🚀 Karpi Quick Start Guide

## Installation

```bash
cd /Users/piyusheklavya/Documents/GitHub/karpi
bun install
```

## Running Karpi

### Development Mode (Recommended for testing)
```bash
bun run dev
```

### Production Mode
```bash
# Build first
bun run build

# Then run
bun run start
```

### Direct Execution (with Bun)
```bash
bun src/index.ts
```

## First Time Usage

1. **Start the app:**
   ```bash
   bun run dev
   ```

2. **Create your first profile:**
   - The app will detect no profiles exist
   - Choose "Create New Profile"
   - Enter a username (e.g., `john_doe`)
   - Optionally enter your email
   - Create a password (min 6 characters)
   - Confirm the password

3. **You're in!** The dashboard will load automatically

## Available Commands

```bash
# Show help
bun run dev -- --help

# Login (or create profile)
bun run dev -- login

# Open dashboard
bun run dev -- dashboard

# Logout
bun run dev -- logout

# Logout all sessions
bun run dev -- logout --all
```

## Color Scheme Preview

The CLI uses these beautiful colors:
- **Bottle Green** (#2d5016) - Primary text and branding
- **Bright Blue** (#00bfff) - Accents and highlights
- **Black** (#000000) - Background

## Testing Multiple Profiles

You can create multiple profiles to test profile switching:

1. Create first profile: `alice`
2. Logout
3. Login again and create another profile: `bob`
4. When you login next time, you'll see both profiles to choose from

## Troubleshooting

### Keychain Access Issues
If you get keychain errors on macOS, you may need to:
1. Allow Bun to access the keychain when prompted
2. Or temporarily use the development mode which has fallback mechanisms

### Reset Everything
To start fresh:
```bash
rm -rf ~/.karpi
```

This removes all profiles and sessions (passwords in keychain will remain until manually deleted).

## File Structure

```
~/.karpi/
└── config.json    # Your profiles and session data
```

Passwords are stored securely in macOS Keychain under service name: `karpi-cli`

## Next Steps

- Explore the dashboard menu
- Check out the profile settings
- View your stats
- Try the quick actions menu (features coming soon!)

---

**Enjoy using Karpi! 🎉**

# 🚀 Karpi - Developer Productivity CLI

**Developer Productivity Unleashed**

A modern, beautiful CLI application for developers built with TypeScript, Bun, and featuring a stunning bottle green and bright blue color scheme.

## ✨ Features

- 🔐 **Secure Authentication** - Password hashing with bcrypt and secure keychain storage
- 👥 **Multiple Profiles** - Support for unlimited user profiles
- 🎨 **Beautiful UI** - Modern CLI interface with custom color scheme (bottle green, bright blue, black)
- ⚡ **Fast** - Built with Bun for lightning-fast performance
- 🔒 **Secure** - JWT-based sessions with automatic expiration
- 📦 **Extensible** - Plugin-ready architecture for future features
- 🌐 **Web-Ready** - Prepared for future web integration

## 🎨 Color Scheme

- **Bottle Green** (#2d5016) - Primary brand color
- **Bright Blue** (#00bfff) - Accent and interactive elements
- **Black** (#000000) - Background and text

## 📋 Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- macOS (for keychain integration)

## 🚀 Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/yourusername/karpi.git
cd karpi

# Install dependencies
bun install

# Run in development mode
bun run dev

# Or build and run
bun run build
bun run start
```

### Global Installation (Coming Soon)

```bash
npm install -g karpi
```

## 📖 Usage

### Basic Commands

```bash
# Start Karpi (auto-login or dashboard)
karpi

# Login or create new profile
karpi login

# Open dashboard
karpi dashboard
# or
karpi dash

# Logout
karpi logout

# Logout all sessions
karpi logout --all

# Show version
karpi --version

# Show help
karpi --help
```

### First Time Setup

1. Run `karpi` or `karpi login`
2. Choose "Create New Profile"
3. Enter your username (3-20 characters, alphanumeric + underscore)
4. Optionally enter your email
5. Create a password (minimum 6 characters)
6. Confirm your password
7. You're ready to go! 🎉

### Dashboard Features

Once logged in, the dashboard provides:

- **View Stats** - See your account statistics
- **Quick Actions** - Access productivity features (Coming Soon)
  - Task Manager
  - Project Tracker
  - Notes
  - Time Tracker
  - Code Snippets
- **Profile Settings** - View and manage your profile
- **Logout** - End your session

## 🏗️ Project Structure

```
karpi/
├── src/
│   ├── commands/          # CLI commands
│   │   ├── auth/          # Authentication commands
│   │   └── dashboard/     # Dashboard command
│   ├── services/          # Business logic
│   │   ├── auth.service.ts
│   │   ├── profile.service.ts
│   │   └── storage.service.ts
│   ├── utils/             # Utility functions
│   │   ├── crypto.ts      # Password hashing & JWT
│   │   ├── logger.ts      # Logging utility
│   │   └── validators.ts  # Input validation (Zod)
│   ├── config/            # Configuration
│   │   └── constants.ts   # Colors & constants
│   ├── types/             # TypeScript interfaces
│   └── index.ts           # Entry point
├── package.json
├── tsconfig.json
└── README.md
```

## 🔒 Security

- Passwords are hashed using bcrypt with configurable salt rounds
- Credentials stored securely in macOS Keychain
- JWT tokens for session management with automatic expiration
- Session validation on every command
- No passwords stored in plain text

## 🛠️ Development

```bash
# Install dependencies
bun install

# Run in development mode (with hot reload)
bun run dev

# Type checking
bun run type-check

# Lint code
bun run lint

# Build for production
bun run build
```

## 📝 Configuration

Karpi stores its configuration in `~/.karpi/`:

```
~/.karpi/
└── config.json          # User profiles and preferences
```

Passwords are stored separately in macOS Keychain under the service name `karpi-cli`.

## 🎯 Roadmap

### Phase 1: Core ✅
- [x] Authentication system
- [x] Multiple profiles
- [x] Beautiful CLI UI
- [x] Session management

### Phase 2: Productivity Features (Coming Soon)
- [ ] Task management
- [ ] Project tracker
- [ ] Time tracking
- [ ] Code snippets manager
- [ ] Notes system

### Phase 3: Web Integration
- [ ] REST API client
- [ ] Cloud sync
- [ ] OAuth providers (GitHub, Google)
- [ ] Team collaboration
- [ ] Web dashboard

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

## 👨‍💻 Author

Your Name

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh)
- UI powered by [Inquirer](https://github.com/SBoudrias/Inquirer.js), [Chalk](https://github.com/chalk/chalk), and [Boxen](https://github.com/sindresorhus/boxen)
- Validation with [Zod](https://github.com/colinhacks/zod)

---

Made with ❤️ for developers, by developers

# 🚀 Karpi Quick Start Guide

## Installation

### Via Homebrew (Recommended)
```bash
brew tap piyusheklavya777/tap
brew install karpi
```

### Update to Latest Version
```bash
brew update && brew upgrade karpi
```

## Usage

```bash
# Start karpi
karpi

# Or specific commands
karpi login
karpi dashboard
karpi logout
```

## Development

### Setup
```bash
git clone https://github.com/piyusheklavya777/karpi.git
cd karpi
bun install
```

### Run in Dev Mode
```bash
bun run dev
```

### Build Binary
```bash
bun run build:binary
```

## Publishing a New Version

1. **Make your changes** and commit to `main`

2. **Bump version:**
   ```bash
   bun run bump:version 1.3.3
   ```

3. **Push to GitHub:**
   ```bash
   git add -A && git commit -m "v1.3.3: your changes" && git push
   ```
   

4. **Automatic Release:** The GitHub Action will:
   - Build the binary
   - Create a GitHub release with tarball
   - Update the [homebrew-tap](https://github.com/piyusheklavya777/homebrew-tap) formula

5. **Users update via:**
   ```bash
   brew update && brew upgrade karpi
   ```

## Reset Data

To start fresh, remove the config directory:
```bash
rm -rf ~/.karpi
```

---

**Enjoy using Karpi! 🎉**

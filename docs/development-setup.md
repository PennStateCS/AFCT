# Development Setup Guide

This guide covers platform-specific setup instructions for Windows and Linux development environments.

## Windows Setup

### Prerequisites
- **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
- **Git**: Download from [git-scm.com](https://git-scm.com/)
- **PowerShell 5.1+** (usually pre-installed)

### Installation Steps

1. **Clone the repository**:
   ```powershell
   git clone <repository-url>
   cd afct
   ```

2. **Install dependencies**:
   ```powershell
   npm install
   ```

3. **Setup environment**:
   ```powershell
   Copy-Item .env.example .env.local
   ```

4. **Initialize database**:
   ```powershell
   npm run db:generate
   npm run db:migrate
   npm run seed
   ```

5. **Start development server**:
   ```powershell
   npm run dev
   ```

### Windows-Specific Notes
- Use PowerShell or Command Prompt for running commands
- SQLite works out of the box on Windows
- File paths use backslashes (`\`) but Node.js handles this automatically
- Some scripts may require execution policy changes: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

## Linux Setup

### Prerequisites
- **Node.js 18+**
- **Git**
- **SQLite3** (for development database)

### Ubuntu/Debian Installation

1. **Update package manager**:
   ```bash
   sudo apt update
   ```

2. **Install Node.js and npm**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install Git and SQLite**:
   ```bash
   sudo apt-get install -y git sqlite3 libsqlite3-dev
   ```

4. **Clone and setup project**:
   ```bash
   git clone <repository-url>
   cd afct
   npm install
   cp .env.example .env.local
   ```

5. **Initialize database**:
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run seed
   ```

6. **Start development server**:
   ```bash
   npm run dev
   ```

### CentOS/RHEL/Fedora Installation

1. **Install Node.js**:
   ```bash
   # CentOS/RHEL 8+
   sudo dnf install nodejs npm
   
   # CentOS/RHEL 7
   sudo yum install nodejs npm
   
   # Or use NodeSource repository for latest version
   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
   sudo yum install nodejs
   ```

2. **Install Git and SQLite**:
   ```bash
   sudo dnf install git sqlite sqlite-devel  # CentOS 8+
   sudo yum install git sqlite sqlite-devel  # CentOS 7
   ```

3. **Continue with steps 4-6 from Ubuntu section above**

### Arch Linux Installation

1. **Install dependencies**:
   ```bash
   sudo pacman -Sy nodejs npm git sqlite
   ```

2. **Continue with steps 4-6 from Ubuntu section above**

## Automated Setup (Recommended)

For both Windows and Linux, the easiest setup method is using the setup wizard:

```bash
# Linux/macOS
./scripts/setup-wizard.sh

# Windows (using Git Bash or WSL)
bash scripts/setup-wizard.sh
```

The setup wizard will:
- Detect your operating system
- Install missing dependencies
- Configure the database
- Set up environment files
- Initialize and seed the database

## Common Issues

### Node.js Version Issues
- Ensure you're using Node.js 18 or higher: `node --version`
- Use nvm (Node Version Manager) to manage multiple Node.js versions

### Permission Issues (Linux)
- If you get permission errors, avoid using `sudo` with npm
- Use nvm to install Node.js in your home directory
- Or change npm's default directory: `npm config set prefix '~/.npm-global'`

### SQLite Issues
- **Windows**: SQLite binaries are included with the project
- **Linux**: Install sqlite3 development packages if you get build errors

### Environment Variables
- Ensure `.env.local` exists and contains the required variables
- On Windows, use PowerShell or Command Prompt (not Git Bash) for better environment variable handling

### Path Issues
- **Windows**: Ensure Node.js and npm are in your PATH
- **Linux**: Source your shell profile after installing Node.js: `source ~/.bashrc`

## Development Workflow

Once setup is complete:

1. **Start development server**: `npm run dev`
2. **Open browser**: Navigate to `http://localhost:3000`
3. **Login with default credentials**:
   - Admin: `admin@example.com` (password: `password123`)
   - Faculty: `faculty@example.com` (password: `password123`)
   - Student: `student@example.com` (password: `password123`)

## Next Steps

- See [Database Troubleshooting](database-troubleshooting.md) for database-related issues
- See [PostgreSQL Setup Guide](postgresql-ubuntu-setup.md) for production database setup
- Run `./scripts/setup-wizard.sh` for additional setup options and troubleshooting tools

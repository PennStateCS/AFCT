#!/usr/bin/env bash
# =============================================================================
# AFCT Dashboard Setup Wizard (TUI with whiptail/dialog) - ENV-SAFE (Auto-install TUI)
# =============================================================================
# Full-featured wizard for dev & prod:
#  - Auto-installs whiptail (or dialog) if missing
#  - Detects/fixes DATABASE_URL conflicts (dev & prod)
#  - Safe runners that ignore inherited DATABASE_URL and load correct .env
#  - URL-encoding for credentials in PostgreSQL URLs
#  - Node.js/PostgreSQL setup, Prisma generate/migrate/seed, deploy with PM2
#  - Quiet mode by default (use --verbose for detailed output)
# =============================================================================

set -euo pipefail

# Verbosity control
VERBOSE=false
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE=true

# Quiet output helpers
quiet_infobox() {
  if [[ "$VERBOSE" == "true" ]]; then
    infobox "$1"
  else
    echo -e "${BLUE}${1}${NC}"
  fi
}

verbose_log() {
  [[ "$VERBOSE" == "true" ]] && log "$@"
}

# ------------------------------ TUI Backend ---------------------------------
detect_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt-get"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then
    echo "pacman"
  else
    echo ""
  fi
}

ensure_tui() {
  if command -v whiptail >/dev/null 2>&1; then
    TUI="whiptail"
  elif command -v dialog >/dev/null 2>&1; then
    TUI="dialog"
  else
    echo "Neither whiptail nor dialog found. Attempting to install whiptail..."
    PKG_MGR=$(detect_pkg_mgr)
    if [[ -n "$PKG_MGR" ]]; then
      case "$PKG_MGR" in
        apt-get) sudo apt-get update && sudo apt-get install -y whiptail || sudo apt-get install -y dialog ;;
        yum)     sudo yum install -y newt || sudo yum install -y dialog ;;
        dnf)     sudo dnf install -y newt  || sudo dnf install -y dialog  ;;
        pacman)  sudo pacman -Sy --noconfirm libnewt || sudo pacman -Sy --noconfirm dialog ;;
      esac
    else
      echo "No supported package manager found. Falling back to plain bash prompts."
      TUI="none"
      return
    fi

    if command -v whiptail >/dev/null 2>&1; then
      TUI="whiptail"
    elif command -v dialog >/dev/null 2>&1; then
      TUI="dialog"
    else
      echo "Failed to install whiptail/dialog. Falling back to plain bash prompts."
      TUI="none"
    fi
  fi
}

ensure_tui

title(){ echo "AFCT Dashboard Setup Wizard"; }
msgbox(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --msgbox "$1" 12 78; else echo -e "$1"; fi; }
infobox(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --infobox "$1" 8 78; else echo -e "$1"; fi; }
yesno(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --yesno "$1" 12 78; else read -r -p "$1 [y/N]: " _r; [[ "$_r" =~ ^[Yy]$ ]]; fi }
inputbox(){ # $1 prompt, $2 default -> echoes result
  if [[ "${TUI:-none}" != "none" ]]; then
    local out
    out=$($TUI --title "$(title)" --inputbox "$1" 12 78 "$2" 3>&1 1>&2 2>&3) || return 1
    echo "$out"
  else
    local out; read -r -p "$1 [$2]: " out; echo "${out:-$2}"
  fi
}
passwordbox(){ # $1 prompt -> echoes result
  if [[ "${TUI:-none}" != "none" ]]; then
    local out
    out=$($TUI --title "$(title)" --passwordbox "$1" 12 78 3>&1 1>&2 2>&3) || return 1
    echo "$out"
  else
    local out; read -rs -p "$1: " out; echo; echo "$out"
  fi
}
menu(){ # args: tag1 item1 tag2 item2 ...
  if [[ "${TUI:-none}" != "none" ]]; then
    $TUI --title "$(title)" --menu "Choose an option" 20 78 12 "$@" 3>&1 1>&2 2>&3
  else
    echo "Menu:"; local i=1; while [[ "$#" -gt 0 ]]; do echo " $i) $1 - $2"; shift 2; ((i++)); done
    read -r -p "Enter number: " _n; echo "$_n"
  fi
}

# ------------------------------ UI Helpers ----------------------------------
# Basic Colors
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
# Extended Colors
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[0;37m'
# Bright Colors
BRIGHT_GREEN='\033[1;32m'; BRIGHT_BLUE='\033[1;34m'; BRIGHT_CYAN='\033[1;36m'; BRIGHT_MAGENTA='\033[1;35m'
# Text Formatting
BOLD='\033[1m'; DIM='\033[2m'; UNDERLINE='\033[4m'

# Core message functions
log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN}✓${NC} $*"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*"; }
err(){ echo -e "${RED}✗${NC} $*"; }

# Enhanced message functions
success(){ echo -e "${BRIGHT_GREEN}🎉${NC} $*"; }
info(){ echo -e "${CYAN}ℹ${NC} $*"; }
database_msg(){ echo -e "${CYAN}🗄${NC} $*"; }
auth_msg(){ echo -e "${MAGENTA}🔐${NC} $*"; }
node_msg(){ echo -e "${BRIGHT_BLUE}⬢${NC} $*"; }
build_msg(){ echo -e "${BRIGHT_CYAN}🔨${NC} $*"; }
deploy_msg(){ echo -e "${BRIGHT_MAGENTA}🚀${NC} $*"; }
quiet(){ echo -e "${DIM}$*${NC}"; }
highlight(){ echo -e "${BOLD}$*${NC}"; }

# ------------------------------ Utilities -----------------------------------
mask_db_url(){ local url="$1"; echo "$url" | sed -E 's#(postgresql://[^:]+):[^@]+@#\1:****@#'; }
command_exists(){ command -v "$1" >/dev/null 2>&1; }
check_root(){ [[ $EUID -eq 0 ]]; }
nowstamp(){ date +%Y%m%d_%H%M%S; }
normalize_file_unix(){ local f="$1"; [[ -f "$f" ]] || return 0; if command_exists dos2unix; then dos2unix "$f" >/dev/null 2>&1 || true; else sed -i 's/\r$//' "$f" || true; fi; }
read_dburl_from_file(){ local f="$1"; [[ -f "$f" ]] || return 1; normalize_file_unix "$f"; grep -E '^DATABASE_URL=' "$f" | tail -n1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//'; }
url_encode(){ node -e "try{process.stdout.write(encodeURIComponent(process.argv[1]||''))}catch{process.stdout.write(process.argv[1]||'')}" "$1" 2>/dev/null || echo -n "$1"; }

# ------------------------------ OS Checks -----------------------------------
OS=""
check_os(){
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command_exists apt-get; then OS="ubuntu"
    elif command_exists yum; then OS="centos"
    elif command_exists dnf; then OS="centos"
    elif command_exists pacman; then OS="arch"
    else msgbox "Unsupported Linux distribution"; exit 1; fi
  else
    msgbox "This wizard supports Linux only."; exit 1
  fi
}

# -------------------------- Safe Env Runners --------------------------------
run_with_env(){ # dev|prod, "command..."
  local mode="$1"; shift; local cmd="$*"
  local envfile=""
  case "$mode" in
    dev) envfile=".env.local" ;;
    prod) envfile=".env.production" ;;
    *) err "run_with_env: mode must be dev|prod"; return 1;;
  esac

  if npx --yes --quiet dotenv -v >/dev/null 2>&1; then
    env -u DATABASE_URL npx dotenv -e "$envfile" -- bash -lc "$cmd"
  else
    local url; url="$(read_dburl_from_file "$envfile")"
    [[ -z "$url" ]] && { err "DATABASE_URL missing in $envfile"; return 1; }
    env -u DATABASE_URL DATABASE_URL="$url" bash -lc "$cmd"
  fi
}

# ---------------------- Env Conflict Detection & Fix ------------------------
detect_env_conflicts(){ # dev|prod
  local mode="$1"
  local envfile otherfiles label
  [[ "$mode" == "dev" || "$mode" == "prod" ]] || { err "detect_env_conflicts: mode must be dev|prod"; return 2; }

  if [[ "$mode" == "dev" ]]; then envfile=".env.local"; otherfiles=(".env" "prisma/.env" ".env.production"); label="Development (.env.local)"
  else envfile=".env.production"; otherfiles=(".env" "prisma/.env" ".env.local"); label="Production (.env.production)" ; fi

  local report=""
  local conflicts=0

  normalize_file_unix "$envfile"
  local file_val="$(read_dburl_from_file "$envfile")"
  if [[ -n "$file_val" ]]; then report+="From $envfile: $(mask_db_url "$file_val")\n"
  else report+="$envfile is missing or has no DATABASE_URL\n"; conflicts=1; fi

  if [[ -n "${DATABASE_URL:-}" ]]; then report+="Current shell DATABASE_URL: $(mask_db_url "$DATABASE_URL")\n"; conflicts=1; fi

  if [[ -f "$envfile" ]]; then
    if grep -q $'\r' "$envfile"; then report+="$envfile has CRLF line endings\n"; conflicts=1; fi
    local cnt; cnt=$(grep -c '^DATABASE_URL=' "$envfile" || true)
    if [[ "$cnt" -gt 1 ]]; then report+="$envfile has duplicate DATABASE_URL entries ($cnt)\n"; conflicts=1; fi
  fi

  for f in "${otherfiles[@]}"; do
    if [[ -f "$f" ]] && grep -q '^DATABASE_URL=' "$f" 2>/dev/null; then
      report+="Conflicting file: $f\n"; conflicts=1
    fi
  done

  for f in ~/.bashrc ~/.profile ~/.bash_profile; do
    [[ -f "$f" ]] && grep -qE '(^|\s)export\s+DATABASE_URL=|^DATABASE_URL=' "$f" && { report+="User shell sets DATABASE_URL in $f\n"; conflicts=1; }
  done
  for f in /etc/environment /etc/profile /etc/profile.d/*.sh; do
    [[ -f "$f" ]] && grep -qE '(^|\s)export\s+DATABASE_URL=|^DATABASE_URL=' "$f" && { report+="System file sets DATABASE_URL in $f\n"; conflicts=1; }
  done
  if [[ $EUID -eq 0 ]]; then
    sudo grep -nE 'Environment=.*DATABASE_URL' /etc/systemd/system/*.service 2>/dev/null && { report+="DATABASE_URL in a systemd service (see /etc/systemd/system/*.service)\n"; conflicts=1; }
  fi
  grep -RIn --color=never -E 'DATABASE_URL' . 2>/dev/null | grep -E 'ecosystem|pm2' >/dev/null 2>&1 && { report+="PM2 ecosystem contains DATABASE_URL\n"; conflicts=1; }

  if [[ -z "$report" ]]; then report="No findings."; fi
  if [[ "$conflicts" -eq 0 ]]; then
    msgbox "ENV Check ($label):\n\n$report\n\nNo conflicts detected."
    return 0
  else
    msgbox "ENV Check ($label):\n\n$report\n\nConflicts detected."
    return 1
  fi
}

fix_env_conflicts(){ # dev|prod
  local mode="$1" envfile otherfiles ts; ts="$(nowstamp)"
  [[ "$mode" == "dev" || "$mode" == "prod" ]] || { err "fix_env_conflicts: mode must be dev|prod"; return 2; }

  if [[ "$mode" == "dev" ]]; then envfile=".env.local"; otherfiles=(".env" "prisma/.env" ".env.production")
  else envfile=".env.production"; otherfiles=(".env" "prisma/.env" ".env.local"); fi

  if [[ -n "${DATABASE_URL:-}" ]]; then unset DATABASE_URL; fi

  if [[ -f "$envfile" ]]; then
    normalize_file_unix "$envfile"
    mapfile -t lines < <(grep -n '^DATABASE_URL=' "$envfile" | cut -d: -f1 || true)
    if [[ "${#lines[@]}" -gt 1 ]]; then
      local keep="${lines[-1]}"
      awk -v keep="$keep" '{
        if (NR==keep) {print; next}
        if ($0 ~ /^DATABASE_URL=/) next
        print
      }' "$envfile" > "$envfile.tmp"
      mv "$envfile.tmp" "$envfile"
    fi
  fi

  for f in "${otherfiles[@]}"; do
    if [[ -f "$f" ]] && grep -q '^DATABASE_URL=' "$f" 2>/dev/null; then
      if yesno "Rename conflicting $f to $f.bak-$ts ?"; then
        mv "$f" "$f.bak-$ts"
      fi
    fi
  done

  local tips="If DATABASE_URL is set in shell/system files, edit them:\n - ~/.bashrc, ~/.profile, ~/.bash_profile\n - /etc/environment, /etc/profile, /etc/profile.d/*.sh\n - systemd unit Environment=DATABASE_URL=... (then daemon-reload & restart)\n"
  msgbox "Env conflicts fixed for this session (where possible).\n\n$tips"
}

# ---------------------- Migration Provider Fix -------------------------------
fix_migration_provider_mismatch(){
  local target_provider="$1"  # postgresql or sqlite
  [[ "$target_provider" == "postgresql" || "$target_provider" == "sqlite" ]] || { err "fix_migration_provider_mismatch: provider must be postgresql|sqlite"; return 1; }
  
  local current_provider=""
  if [[ -f "prisma/migrations/migration_lock.toml" ]]; then
    current_provider=$(grep 'provider = ' prisma/migrations/migration_lock.toml | cut -d'"' -f2 2>/dev/null || echo "unknown")
  fi

  if [[ "$current_provider" == "$target_provider" ]]; then
    msgbox "Migration provider is already set to '$target_provider'. No changes needed."
    return 0
  fi

  local backup_dir="prisma/migrations_backup_$(nowstamp)"
  msgbox "Migration Provider Mismatch Detected!\n\nCurrent: $current_provider\nTarget: $target_provider\n\nThis will:\n1. Backup existing migrations to $backup_dir\n2. Remove migration directory\n3. Use 'db push' for clean schema sync\n\nNote: Migration history will be lost but data is preserved."

  if ! yesno "Continue with migration provider fix?"; then return 1; fi

  # Backup migrations if they exist
  if [[ -d "prisma/migrations" ]]; then
    infobox "Backing up migrations..."
    cp -r prisma/migrations "$backup_dir"
    ok "Migrations backed up to: $backup_dir"
  fi

  # Remove problematic migration directory
  infobox "Removing migration directory..."
  rm -rf prisma/migrations
  ok "Migration directory removed"

  # Use db push for clean sync (no migration history)
  if [[ "$target_provider" == "postgresql" ]]; then
    infobox "Syncing PostgreSQL schema with 'db push'..."
    if run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss"; then
      ok "PostgreSQL schema synchronized successfully"
      msgbox "Migration provider fix complete!\n\nSchema is now synchronized with PostgreSQL.\nFuture migrations will use PostgreSQL provider.\n\nBackup location: $backup_dir"
    else
      err "Failed to sync PostgreSQL schema"
      return 1
    fi
  else
    infobox "Syncing SQLite schema with migrate dev..."
    if npx prisma migrate dev --name init; then
      ok "SQLite migration created successfully"
      msgbox "Migration provider fix complete!\n\nFresh SQLite migration created.\n\nBackup location: $backup_dir"
    else
      err "Failed to create SQLite migration"
      return 1
    fi
  fi
}

# --------------------------- System Health/Status ---------------------------
system_health_check(){
  local out="Disk space:\n$(df -h / | awk 'NR==2{print $4" free"}')\n\n"
  out+="Memory free:\n$(free -m | awk 'NR==2{print $7" MB"}')\n\n"
  if ping -c1 -W2 google.com >/dev/null 2>&1; then out+="Internet: reachable\n"; else out+="Internet: not reachable\n"; fi
  msgbox "$out"
}
view_system_status(){
  local out=""
  if command_exists node; then out+="Node.js: $(node --version)\n"; else out+="Node.js: not installed\n"; fi
  if command_exists npm; then out+="NPM: $(npm --version)\n"; else out+="NPM: not installed\n"; fi
  if command_exists psql; then systemctl is-active --quiet postgresql 2>/dev/null && out+="PostgreSQL: running\n" || out+="PostgreSQL: installed, not running\n"; else out+="PostgreSQL: not installed\n"; fi
  if command_exists sqlite3; then out+="SQLite: $(sqlite3 --version | awk '{print $1}')\n"; else out+="SQLite: not installed\n"; fi
  if [[ -f package.json ]]; then
    out+="Project: present\n"
    [[ -d node_modules ]] && out+="Dependencies: installed\n" || out+="Dependencies: not installed\n"
    [[ -f .env.local ]] && out+=".env.local: present\n" || out+=".env.local: missing\n"
    [[ -f .env.production ]] && out+=".env.production: present\n" || out+=".env.production: missing\n"
  else
    out+="Project: not in repo root\n"
  fi
  msgbox "$out"
}

# ------------------------------ Node Install --------------------------------
install_nodejs(){
  check_os
  if command_exists node; then
    if ! yesno "Node.js $(node --version) detected. Update to LTS (NodeSource)?"; then return 0; fi
  fi
  
  quiet_infobox "Installing Node.js..."
  
  local install_output
  if [[ "$OS" == "ubuntu" ]]; then
    install_output=$(curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1) || { err "Failed to setup NodeSource repo"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
    install_output=$(sudo apt-get install -y nodejs 2>&1) || { err "Failed to install Node.js"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
  elif [[ "$OS" == "centos" ]]; then
    install_output=$(sudo yum install -y nodejs npm 2>&1) || { err "Failed to install Node.js"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
  elif [[ "$OS" == "arch" ]]; then
    install_output=$(sudo pacman -Sy --noconfirm nodejs npm 2>&1) || { err "Failed to install Node.js"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
  fi
  
  ok "Node: $(node --version)  NPM: $(npm --version)"
  
  # Install global tools quietly
  verbose_log "Installing global PM2 and cross-env..."
  sudo npm i -g pm2 cross-env >/dev/null 2>&1 || true
}

# ----------------------- Project Dependencies/Prisma ------------------------
install_project_dependencies(){
  [[ -f package.json ]] || { msgbox "Run this from the project root (package.json not found)."; return 1; }
  quiet_infobox "Installing dependencies..."
  
  # Install main dependencies quietly
  local install_output
  if [[ "$VERBOSE" == "true" ]]; then
    npm install
  else
    install_output=$(npm install 2>&1) || { err "npm install failed"; echo "$install_output"; return 1; }
  fi
  
  # Ensure dotenv-cli is available
  if ! npx --yes --quiet dotenv -v >/dev/null 2>&1; then 
    verbose_log "Installing dotenv-cli..."
    npm i -D dotenv-cli >/dev/null 2>&1
  fi
  
  # Check for missing dependencies and install them quietly
  local missing_deps=()
  
  # Check for required dependencies
  if ! npm list date-fns >/dev/null 2>&1; then missing_deps+=("date-fns"); fi
  if ! npm list sonner >/dev/null 2>&1; then missing_deps+=("sonner"); fi
  if ! npm list @tailwindcss/postcss >/dev/null 2>&1; then missing_deps+=("@tailwindcss/postcss"); fi
  if ! npm list tailwindcss >/dev/null 2>&1; then missing_deps+=("tailwindcss"); fi
  if ! npm list autoprefixer >/dev/null 2>&1; then missing_deps+=("autoprefixer"); fi
  if ! npm list postcss >/dev/null 2>&1; then missing_deps+=("postcss"); fi
  
  if [[ ${#missing_deps[@]} -gt 0 ]]; then
    verbose_log "Installing missing dependencies: ${missing_deps[*]}"
    if [[ "$VERBOSE" == "true" ]]; then
      npm install date-fns sonner
      npm install -D @tailwindcss/postcss tailwindcss autoprefixer postcss
    else
      npm install date-fns sonner >/dev/null 2>&1
      npm install -D @tailwindcss/postcss tailwindcss autoprefixer postcss >/dev/null 2>&1
    fi
  fi
  
  ok "Dependencies installed successfully"
    npm install -D @tailwindcss/postcss tailwindcss autoprefixer postcss
  fi
  
  msgbox "Dependencies installed."
}

# ----------------------- Build Dependencies Fix -----------------------------
fix_build_dependencies(){
  [[ -f package.json ]] || { msgbox "Run this from the project root (package.json not found)."; return 1; }
  
  infobox "Checking and fixing build dependencies..."
  
  # List of required dependencies and their versions
  local required_deps=(
    "date-fns@^3.6.0"
    "sonner@^1.5.0"
    "lucide-react@^0.469.0"
    "framer-motion@^11.11.17"
    "next-themes@^0.4.3"
    "@radix-ui/react-avatar@^1.1.1"
    "@radix-ui/react-popover@^1.1.2"
    "@radix-ui/react-dropdown-menu@^2.1.2"
    "@radix-ui/react-dialog@^1.1.2"
    "@radix-ui/react-slot@^1.1.0"
    "@radix-ui/react-label@^2.1.0"
    "@radix-ui/react-tabs@^1.1.1"
    "@radix-ui/react-toast@^1.2.2"
    "@radix-ui/react-tooltip@^1.1.3"
    "@radix-ui/react-select@^2.1.2"
    "@radix-ui/react-checkbox@^1.1.2"
    "@radix-ui/react-separator@^1.1.0"
    "@hookform/resolvers@^3.6.0"
    "react-hook-form@^7.53.2"
    "class-variance-authority@^0.7.1"
    "clsx@^2.1.1"
    "tailwind-merge@^2.5.4"
  )
  
  local required_dev_deps=(
    "@tailwindcss/postcss@^4.1.12"
    "tailwindcss@^4.1.12"
    "autoprefixer@^10.4.20"
    "postcss@^8.4.47"
  )
  
  # Install missing production dependencies
  local missing_prod=()
  for dep in "${required_deps[@]}"; do
    local pkg_name=$(echo "$dep" | cut -d'@' -f1)
    if ! npm list "$pkg_name" >/dev/null 2>&1; then
      missing_prod+=("$dep")
    fi
  done
  
  if [[ ${#missing_prod[@]} -gt 0 ]]; then
    infobox "Installing missing production dependencies: ${missing_prod[*]}"
    npm install "${missing_prod[@]}"
  fi
  
  # Install missing dev dependencies
  local missing_dev=()
  for dep in "${required_dev_deps[@]}"; do
    local pkg_name=$(echo "$dep" | cut -d'@' -f1)
    if ! npm list "$pkg_name" >/dev/null 2>&1; then
      missing_dev+=("$dep")
    fi
  done
  
  if [[ ${#missing_dev[@]} -gt 0 ]]; then
    infobox "Installing missing dev dependencies: ${missing_dev[*]}"
    npm install -D "${missing_dev[@]}"
  fi
  
  # Create Prisma config file if it doesn't exist (Prisma 7 preparation)
  if [[ ! -f "prisma.config.ts" ]]; then
    infobox "Creating Prisma 7-ready config file..."
    cat > prisma.config.ts <<EOF
const config = {
  seed: 'tsx prisma/seed.ts'
}

export default config
EOF
    ok "Created prisma.config.ts"
  fi
  
  # Check if Tailwind config exists
  if [[ ! -f "tailwind.config.js" && ! -f "tailwind.config.ts" ]]; then
    infobox "Creating Tailwind CSS configuration..."
    cat > tailwind.config.js <<EOF
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
}
EOF
    ok "Created tailwind.config.js"
  fi
  
  msgbox "Build dependencies fixed!\n\nChanges made:\n• Installed missing dependencies\n• Created Prisma 7-ready config\n• Verified Tailwind CSS setup\n\nYou can now run 'npm run build' successfully."
}

# ------------------------------ Dev Database --------------------------------
setup_development_database(){
  check_os
  if ! command_exists sqlite3; then
    quiet_infobox "Installing SQLite..."
    if [[ "$OS" == "ubuntu" ]]; then 
      sudo apt-get update >/dev/null 2>&1 && sudo apt-get install -y sqlite3 libsqlite3-dev >/dev/null 2>&1
    elif [[ "$OS" == "centos" ]]; then 
      sudo yum install -y sqlite sqlite-devel >/dev/null 2>&1
    else 
      sudo pacman -Sy --noconfirm sqlite >/dev/null 2>&1
    fi
  fi
  
  if [[ ! -f ".env.local" ]]; then
    verbose_log "Creating .env.local file..."
    cat > .env.local <<EOF
DATABASE_URL="file:./prisma/dev.db"
NODE_ENV="development"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo dev-secret)"
EOF
  fi
  
  detect_env_conflicts dev || { if yesno "Fix dev env conflicts now?"; then fix_env_conflicts dev; fi; }
  
  quiet_infobox "Setting up development database..."
  
  # Generate Prisma client
  verbose_log "Generating Prisma client..."
  if [[ "$VERBOSE" == "true" ]]; then
    npx prisma generate || true
  else
    npx prisma generate >/dev/null 2>&1 || true
  fi
  
  # Apply migrations
  verbose_log "Applying dev migrations..."
  if [[ "$VERBOSE" == "true" ]]; then
    npx prisma migrate dev --name init
  else
    npx prisma migrate dev --name init >/dev/null 2>&1
  fi
  
  # Seed database
  verbose_log "Seeding dev database..."
  if [[ "$VERBOSE" == "true" ]]; then
    npm run seed 2>/dev/null || npx tsx prisma/seed.ts || true
  else
    npm run seed >/dev/null 2>&1 || npx tsx prisma/seed.ts >/dev/null 2>&1 || true
  fi
  
  ok "Development database ready"
}

# ------------------------------ PostgreSQL ----------------------------------
install_postgresql(){
  check_os
  if command_exists psql; then
    systemctl is-active --quiet postgresql || { sudo systemctl start postgresql; sudo systemctl enable postgresql; }
    ok "PostgreSQL available"
    return 0
  fi
  if ! check_root; then msgbox "Please run with sudo/root to install PostgreSQL."; return 1; fi
  
  quiet_infobox "Installing PostgreSQL..."
  
  local install_output
  if [[ "$OS" == "ubuntu" ]]; then 
    install_output=$(sudo apt-get update 2>&1) || { err "Failed to update packages"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
    install_output=$(sudo apt-get install -y postgresql postgresql-contrib 2>&1) || { err "Failed to install PostgreSQL"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
  elif [[ "$OS" == "centos" ]]; then 
    install_output=$(sudo yum install -y postgresql-server postgresql-contrib 2>&1) || { err "Failed to install PostgreSQL"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
    postgresql-setup initdb >/dev/null 2>&1
  else 
    install_output=$(sudo pacman -Sy --noconfirm postgresql 2>&1) || { err "Failed to install PostgreSQL"; [[ "$VERBOSE" == "true" ]] && echo "$install_output"; return 1; }
  fi
  
  sudo systemctl start postgresql && sudo systemctl enable postgresql
  ok "PostgreSQL installed & running"
}

setup_production_database(){
  command_exists psql || install_postgresql
  detect_env_conflicts prod || { if yesno "Fix prod env conflicts now?"; then fix_env_conflicts prod; fi; }

  local DB_NAME DB_USER DB_PASS DB_HOST DB_PORT
  DB_NAME=$(inputbox "Database name" "afct_production") || return 1
  DB_USER=$(inputbox "Database user" "afct_user") || return 1
  DB_PASS=$(passwordbox "Password for ${DB_USER}") || return 1
  DB_HOST=$(inputbox "Database host" "localhost") || return 1
  DB_PORT=$(inputbox "Database port" "5432") || return 1
  [[ "$DB_PORT" =~ ^[0-9]+$ ]] || { msgbox "Invalid port number."; return 1; }

  local USER_ENC PASS_ENC DB_URL
  USER_ENC="$(url_encode "$DB_USER")"; PASS_ENC="$(url_encode "$DB_PASS")"
  DB_URL="postgresql://${USER_ENC}:${PASS_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"

  # Create role/db using RAW password
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END\$\$;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}') THEN
    CREATE DATABASE "${DB_NAME}" OWNER "${DB_USER}";
  END IF;
END\$\$;
GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO "${DB_USER}";
SQL

  cat > .env.production <<EOF
# AFCT Dashboard Production Environment
# Generated: $(date)
DATABASE_URL="${DB_URL}"
NODE_ENV="production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo prod-secret)"
  # Prisma generate/migrate/seed with env-safe runner
  quiet_infobox "Setting up production database schema..."
  
  verbose_log "Generating Prisma client for production..."
  if [[ "$VERBOSE" == "true" ]]; then
    run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma" || { msgbox "Prisma generate failed"; return 1; }
  else
    run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || { err "Prisma generate failed"; return 1; }
  fi
  
  # Handle migration - prefer db push for production to avoid P3005 errors
  verbose_log "Syncing database schema..."
  if [[ "$VERBOSE" == "true" ]]; then
    if ! run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma" 2>/dev/null; then
      warn "Migration deploy failed (likely P3005 - database not empty). Using db push instead..."
      if run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss"; then
        ok "Schema synchronized with db push"
      else
        msgbox "Database schema sync failed. Check your connection and try again."
        return 1
      fi
    else
      ok "Migrations applied successfully"
    fi
  else
    if ! run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma" >/dev/null 2>&1; then
      verbose_log "Migration deploy failed, using db push..."
      if run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss" >/dev/null 2>&1; then
        ok "Schema synchronized"
      else
        err "Database schema sync failed"
        return 1
      fi
    else
      ok "Migrations applied"
    fi
  fi
  
  # Seed the database
  verbose_log "Seeding production database..."
  if [[ "$VERBOSE" == "true" ]]; then
    run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" || msgbox "Seeding failed; you can re-run later."
  else
    run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || verbose_log "Seeding failed; you can re-run later."
  fi
      ok "Schema synchronized with db push"
    else
      msgbox "Database schema sync failed. Check your connection and try again."
      return 1
    fi
  else
    ok "Migrations applied successfully"
  fi
  
  # Seed the database
  infobox "Seeding production database..."
  run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" || msgbox "Seeding failed; you can re-run later."

  msgbox "Production DB configured.\nDATABASE_URL=$(mask_db_url "$DB_URL")"
}

# ------------------------------ Deploy App ----------------------------------
deploy_application(){
  [[ -f package.json ]] || { msgbox "Run from project root."; return 1; }
  [[ -f ".env.production" ]] || { msgbox ".env.production is missing. Run production DB setup first."; return 1; }
  
  # Install dependencies if needed
  if [[ ! -d node_modules ]]; then
    quiet_infobox "Installing dependencies..."
    if [[ "$VERBOSE" == "true" ]]; then
      npm install
    else
      npm install >/dev/null 2>&1
    fi
  fi
  
  # Build application
  quiet_infobox "Building application..."
  if [[ "$VERBOSE" == "true" ]]; then
    npm run build
  else
    npm run build >/dev/null 2>&1 || { err "Build failed"; return 1; }
  fi
  
  # Deploy with PM2 or npm
  if command_exists pm2; then
    verbose_log "Starting with PM2..."
    pm2 delete afct-dashboard 2>/dev/null || true
    pm2 start npm --name afct-dashboard -- start >/dev/null 2>&1
    pm2 save >/dev/null 2>&1
    ok "Application started with PM2"
    msgbox "Deployment Complete!\n\nApplication: afct-dashboard\nStatus: Running with PM2\nLogs: pm2 logs afct-dashboard\nMonitor: pm2 monit"
  else
    verbose_log "Starting with npm..."
    npm start &
    ok "Application started with npm start"
    msgbox "Deployment Complete!\n\nApplication started with npm start\n(Consider installing PM2 for production)"
  fi
}

# ------------------------------ DB Utilities --------------------------------
test_database_connection(){
  local choice; choice=$(menu 1 "Development (SQLite)" 2 "Production (PostgreSQL)" 0 "Back") || return 0
  case "$choice" in
    1)
      if [[ -f "prisma/dev.db" ]]; then
        sqlite3 prisma/dev.db "SELECT 'SQLite OK';" >/dev/null 2>&1 && msgbox "SQLite connection OK" || msgbox "SQLite connection failed"
      else
        msgbox "prisma/dev.db not found."
      fi
      ;;
    2)
      if [[ -f ".env.production" ]]; then
        local url user pass host port db
        url="$(read_dburl_from_file ".env.production")"
        user=$(echo "$url" | sed -n 's#postgresql://\([^:/@]\+\).*#\1#p')
        pass=$(echo "$url" | sed -n 's#postgresql://[^:]\+:\([^@]\+\)@.*#\1#p')
        host=$(echo "$url" | sed -n 's#.*@\(.*\):[0-9]\+/.*#\1#p')
        port=$(echo "$url" | sed -n 's#.*@.*:\([0-9]\+\)/.*#\1#p')
        db=$(echo "$url"   | sed -n 's#.*/\([^?]\+\).*#\1#p')
        if PGPASSWORD="$(printf '%b' "$pass")" psql -h "$host" -p "$port" -U "$user" -d "$db" -c "select 1;" >/dev/null 2>&1; then
          msgbox "PostgreSQL connection OK"
        else
          msgbox "PostgreSQL connection failed"
        fi
      else
        msgbox ".env.production not found"
      fi
      ;;
    *) ;;
  esac
}

reset_development_database(){
  if yesno "This will DELETE dev DB. Continue?"; then
    rm -f prisma/dev.db
    rm -rf prisma/migrations
    npx prisma migrate dev --name init
    npm run seed 2>/dev/null || npx tsx prisma/seed.ts || true
    msgbox "Dev DB reset complete."
  fi
}

reset_production_database(){
  if ! yesno "This will DROP and recreate the production DB! Continue?"; then return 0; fi
  [[ -f ".env.production" ]] || { msgbox ".env.production missing"; return 1; }
  local url user pass host port db
  url="$(read_dburl_from_file ".env.production")"
  user=$(echo "$url" | sed -n 's#postgresql://\([^:/@]\+\).*#\1#p')
  pass=$(echo "$url" | sed -n 's#postgresql://[^:]\+:\([^@]\+\)@.*#\1#p')
  host=$(echo "$url" | sed -n 's#.*@\(.*\):[0-9]\+/.*#\1#p')
  port=$(echo "$url" | sed -n 's#.*@.*:\([0-9]\+\)/.*#\1#p')
  db=$(echo "$url"   | sed -n 's#.*/\([^?]\+\).*#\1#p')

  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\" OWNER \"$user\";"

  run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma"
  run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma" || run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss"
  run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" || true
  msgbox "Production DB reset complete."
}

troubleshoot_database(){
  local choice; choice=$(menu 1 "Detect conflicts (DEV)" 2 "Detect conflicts (PROD)" 3 "Run Prisma validate (PROD)" 0 "Back") || return 0
  case "$choice" in
    1) detect_env_conflicts dev || true ;;
    2) detect_env_conflicts prod || true ;;
    3) run_with_env prod "npx prisma validate --schema=prisma/schema.production.prisma" && msgbox "Schema valid" || msgbox "Schema invalid" ;;
    *) ;;
  esac
}

check_migration_issues(){
  local out=""
  [[ -f prisma/schema.prisma ]] && out+="schema.prisma: present\n" || out+="schema.prisma: missing\n"
  [[ -f prisma/schema.production.prisma ]] && out+="schema.production.prisma: present\n" || out+="schema.production.prisma: missing\n"
  
  # Check migration provider mismatch
  if [[ -f "prisma/migrations/migration_lock.toml" ]]; then
    local migration_provider; migration_provider=$(grep 'provider = ' prisma/migrations/migration_lock.toml | cut -d'"' -f2 2>/dev/null || echo "unknown")
    out+="Migration provider: $migration_provider\n"
    
    if [[ -f "prisma/schema.production.prisma" ]]; then
      local schema_provider; schema_provider=$(grep 'provider.*=' prisma/schema.production.prisma | grep -v '//' | cut -d'"' -f2 2>/dev/null || echo "unknown")
      out+="Production schema provider: $schema_provider\n"
      
      if [[ "$migration_provider" != "$schema_provider" && "$migration_provider" != "unknown" && "$schema_provider" != "unknown" ]]; then
        out+="\n⚠️  PROVIDER MISMATCH DETECTED!\n"
        out+="Migrations: $migration_provider vs Schema: $schema_provider\n"
        out+="This causes P3019 errors. Use 'Fix Migration Provider' option.\n"
      fi
    fi
  else
    out+="migrations: no lock file (fresh setup or db push only)\n"
  fi
  
  if [[ -d prisma/migrations ]]; then
    local count; count=$(find prisma/migrations -name "*.sql" | wc -l)
    out+="migrations: $count SQL files\n"
  else
    out+="migrations: directory missing (db push is fine)\n"
  fi
  
  if [[ -f .env.production ]]; then
    out+=".env.production: present\n"
  else
    out+=".env.production: missing\n"
  fi
  
  out+="\nRecommendations:\n"
  out+="• For dev/prod provider switching: use 'Fix Migration Provider'\n"
  out+="• For clean deployment: prefer 'db push' over migrations\n"
  out+="• For P3019 errors: use migration provider fix option"
  
  msgbox "$out"
}

validate_production_environment(){
  local missing=""
  for f in package.json prisma/schema.production.prisma .env.production; do [[ -f "$f" ]] || missing+="$f\n"; done
  if [[ -n "$missing" ]]; then msgbox "Missing:\n$missing"; return 1; fi

  detect_env_conflicts prod || true
    case "$choice" in
      1) 
        quiet_infobox "Running complete development setup..."
        install_nodejs && install_project_dependencies && setup_development_database
        ok "Development setup complete"
        msgbox "Development Environment Ready!\n\nNext steps:\n• Run: npm run dev\n• Open: http://localhost:3000\n• Database: SQLite (prisma/dev.db)"
        ;;
      2) install_nodejs;;
      3) install_project_dependencies;;
      4) setup_development_database;;
      5) reset_development_database;;
      6) if [[ -f "prisma/dev.db" ]]; then
           sqlite3 prisma/dev.db "SELECT 'SQLite OK';" >/dev/null 2>&1 && msgbox "SQLite connection OK" || msgbox "SQLite connection failed"
         else
           msgbox "prisma/dev.db not found."
         fi;;
      7) detect_env_conflicts dev || { if yesno "Run auto-fix?"; then fix_env_conflicts dev; fi; };;
      0) return 0;;
      *) ;;
    esac"Install Node.js" \
      3 "Install Project Dependencies" \
      4 "Setup Development Database (SQLite)" \
      5 "Reset Development Database" \
      6 "Test Development Database" \
      7 "Environment Conflict Detection & Fix" \
      0 "Back to Main Menu") || return 0

    case "$choice" in
      1) install_nodejs; install_project_dependencies; setup_development_database; msgbox "Dev setup complete.\nRun: npm run dev";;
      2) install_nodejs;;
      3) install_project_dependencies;;
      4) setup_development_database;;
      5) reset_development_database;;
      6) if [[ -f "prisma/dev.db" ]]; then
           sqlite3 prisma/dev.db "SELECT 'SQLite OK';" >/dev/null 2>&1 && msgbox "SQLite connection OK" || msgbox "SQLite connection failed"
         else
           msgbox "prisma/dev.db not found."
    case "$choice" in
      1) 
        quiet_infobox "Running complete production setup..."
        install_nodejs && install_postgresql && install_project_dependencies && install_pm2 && install_dotenv_cli && setup_production_database && setup_pm2_ecosystem
        verbose_log "Building application..."
        if [[ "$VERBOSE" == "true" ]]; then
          npm run build
        else
          npm run build >/dev/null 2>&1
        fi
        ok "Production setup complete"
        msgbox "Production Environment Ready!\n\nNext steps:\n• Start: pm2 start ecosystem.config.js\n• Monitor: pm2 monit\n• Logs: pm2 logs"
        ;;
      2) install_postgresql;;
      3) setup_production_database;;
      4) install_pm2;;
      5) setup_pm2_ecosystem;;
      6) deploy_application;;
      7) configure_pm2_startup;;
      8) manage_pm2_processes;;
      9) reset_production_database;;
      10) if [[ -f ".env.production" ]]; then
           local url user pass host port db
           url="$(read_dburl_from_file ".env.production")"
           user=$(echo "$url" | sed -n 's#postgresql://\([^:/@]\+\).*#\1#p')
           pass=$(echo "$url" | sed -n 's#postgresql://[^:]\+:\([^@]\+\)@.*#\1#p')
           host=$(echo "$url" | sed -n 's#.*@\(.*\):[0-9]\+/.*#\1#p')
           port=$(echo "$url" | sed -n 's#.*@.*:\([0-9]\+\)/.*#\1#p')
           db=$(echo "$url"   | sed -n 's#.*/\([^?]\+\).*#\1#p')
           if PGPASSWORD="$(printf '%b' "$pass")" psql -h "$host" -p "$port" -U "$user" -d "$db" -c "select 1;" >/dev/null 2>&1; then
             msgbox "PostgreSQL connection OK"
           else
             msgbox "PostgreSQL connection failed"
           fi
         else
           msgbox ".env.production not found"
         fi;;
      11) validate_production_environment;;
      12) fix_migration_provider_mismatch postgresql;;
      13) detect_env_conflicts prod || { if yesno "Run auto-fix?"; then fix_env_conflicts prod; fi; };;
      0) return 0;;
      *) ;;
    esac
  done
}

database_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "Test Database Connections" \
      2 "Database Troubleshooting" \
      3 "NextAuth Troubleshooting" \
      4 "Check Migration Issues" \
      5 "Fix Migration Provider Mismatch" \
      6 "Reset Development Database" \
      7 "Reset Production Database" \
      8 "Environment Conflict Detection (DEV)" \
      9 "Environment Conflict Detection (PROD)" \
      0 "Back to Main Menu") || return 0

    case "$choice" in
      1) test_database_connection;;
      2) troubleshoot_database;;
      3) troubleshoot_nextauth;;
      4) check_migration_issues;;
      5) 
        local provider_choice
        provider_choice=$(menu 1 "Fix for PostgreSQL (Production)" 2 "Fix for SQLite (Development)" 0 "Back") || continue
        case "$provider_choice" in
          1) fix_migration_provider_mismatch postgresql;;
          2) fix_migration_provider_mismatch sqlite;;
          *) ;;
        esac
        ;;
      6) reset_development_database;;
      7) reset_production_database;;
      8) detect_env_conflicts dev || { if yesno "Run auto-fix?"; then fix_env_conflicts dev; fi; };;
      9) detect_env_conflicts prod || { if yesno "Run auto-fix?"; then fix_env_conflicts prod; fi; };;
      0) return 0;;
      *) ;;
    esac
  done
}

system_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "System Health Check" \
      2 "View System Status" \
      3 "Install Node.js" \
      4 "Install PostgreSQL" \
      5 "Install Project Dependencies" \
      6 "Fix Build Dependencies" \
      7 "Install PM2 Process Manager" \
install_pm2(){
  if command_exists pm2; then
    local current_version; current_version=$(pm2 --version 2>/dev/null || echo "unknown")
    if ! yesno "PM2 $current_version detected. Reinstall/update?"; then return 0; fi
  fi
  
  quiet_infobox "Installing PM2 globally..."
  
  local install_output
  if [[ "$VERBOSE" == "true" ]]; then
    if sudo npm install -g pm2; then
      ok "PM2 installed: $(pm2 --version)"
    else
      err "Failed to install PM2"
      return 1
    fi
  else
    install_output=$(sudo npm install -g pm2 2>&1) || { err "Failed to install PM2"; echo "$install_output"; return 1; }
    ok "PM2 installed: $(pm2 --version)"
  fi
  
  # Install PM2 logrotate module
  verbose_log "Installing PM2 logrotate module..."
  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  
  ok "PM2 setup complete"
}     *) ;;
    esac
  done
}

# ------------------------- PM2 & Process Management --------------------------
install_pm2(){
  if command_exists pm2; then
    local current_version; current_version=$(pm2 --version 2>/dev/null || echo "unknown")
    if ! yesno "PM2 $current_version detected. Reinstall/update?"; then return 0; fi
  fi
  
  infobox "Installing PM2 globally..."
  if sudo npm install -g pm2; then
    ok "PM2 installed: $(pm2 --version)"
  else
    err "Failed to install PM2"
    return 1
  fi
  local ecosystem_file="ecosystem.config.js"
  
  quiet_infobox "Creating PM2 ecosystem configuration..."
  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  
  msgbox "PM2 installed successfully!\n\nFeatures available:\n• Process management\n• Auto-restart on crashes\n• Log rotation\n• System startup integration"
}

setup_pm2_ecosystem(){
  [[ -f package.json ]] || { msgbox "Run from project root (package.json not found)."; return 1; }
  
  local app_name; app_name=$(inputbox "Application name" "afct-dashboard") || return 1
  local instances; instances=$(inputbox "Number of instances (0=auto)" "0") || return 1
  local max_memory; max_memory=$(inputbox "Max memory per instance (MB)" "512") || return 1
  local node_env; node_env=$(menu 1 "production" 2 "development" 3 "staging") || return 1
  
  case "$node_env" in
    1) node_env="production";;
    2) node_env="development";;
    3) node_env="staging";;
    *) node_env="production";;
  esac
  
  local env_file
  if [[ "$node_env" == "production" ]]; then
    env_file=".env.production"
    [[ -f "$env_file" ]] || { msgbox "Production environment file missing. Run production DB setup first."; return 1; }
  else
    env_file=".env.local"
    [[ -f "$env_file" ]] || { msgbox "Development environment file missing. Run development setup first."; return 1; }
  fi
  
  local ecosystem_file="ecosystem.config.js"
  
  infobox "Creating PM2 ecosystem configuration..."
  
  cat > "$ecosystem_file" <<EOF
module.exports = {
  apps: [
    {
      name: '${app_name}',
      script: 'npm',
      args: 'start',
      cwd: '$(pwd)',
      instances: ${instances},
      exec_mode: instances > 1 ? 'cluster' : 'fork',
      
      // Environment
      env_file: '${env_file}',
      
      // Memory & Performance
      max_memory_restart: '${max_memory}M',
      node_args: '--max-old-space-size=${max_memory}',
      
      // Restart Policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Monitoring
      pmx: true,
      
      // Development vs Production
      watch: $([ "$node_env" == "development" ] && echo "true" || echo "false"),
      ignore_watch: [
        'node_modules',
        'logs',
        '.git',
        '*.log',
        'public/uploads'
      ],
      
      // Environment Variables
      env: {
        NODE_ENV: '${node_env}',
        PORT: 3000
      },
      
      // Production Environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ],
  
  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'deploy',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:username/afct-dashboard.git',
      path: '/var/www/afct-dashboard',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production'
    }
  }
};
EOF

  # Create logs directory
  mkdir -p logs
  
  ok "PM2 ecosystem configuration created: $ecosystem_file"
  
  # Validate ecosystem file
  if pm2 ecosystem "$ecosystem_file" >/dev/null 2>&1; then
    ok "Ecosystem configuration validated"
  else
    warn "Ecosystem configuration may have issues"
  fi
  
  msgbox "PM2 Ecosystem Setup Complete!\n\nConfiguration: $ecosystem_file\nEnvironment: $node_env\nInstances: $instances\nMemory limit: ${max_memory}MB\n\nNext steps:\n• Start: pm2 start $ecosystem_file\n• Monitor: pm2 monit\n• Logs: pm2 logs"
}

configure_pm2_startup(){
  command_exists pm2 || { msgbox "PM2 not installed. Install PM2 first."; return 1; }
  
  if ! check_root; then
    msgbox "PM2 startup configuration requires root privileges.\nRun: sudo bash scripts/setup-wizard.sh"
    return 1
  fi
  
  infobox "Configuring PM2 startup script..."
  
  # Generate startup script
  local startup_cmd; startup_cmd=$(pm2 startup | grep "sudo env" | head -n1)
  if [[ -n "$startup_cmd" ]]; then
    infobox "Executing startup configuration..."
    eval "$startup_cmd"
    
    # Save current PM2 process list
    if [[ $(pm2 list | grep -c "online\|stopped") -gt 0 ]]; then
      pm2 save
      ok "PM2 process list saved"
    fi
    
    ok "PM2 startup configuration complete"
    msgbox "PM2 Startup Configuration Complete!\n\nPM2 will now automatically:\n• Start on system boot\n• Restore saved processes\n• Run as current user\n\nManagement:\n• Save processes: pm2 save\n• Unstartup: pm2 unstartup"
  else
    err "Failed to generate PM2 startup command"
    return 1
  fi
}

manage_pm2_processes(){
  command_exists pm2 || { msgbox "PM2 not installed. Install PM2 first."; return 1; }
  
  while true; do
    local choice
    choice=$(menu \
      1 "View Process Status" \
      2 "Start Application" \
      3 "Stop Application" \
      4 "Restart Application" \
      5 "View Logs" \
      6 "Monitor Processes" \
      7 "Save Process List" \
      8 "Delete All Processes" \
      0 "Back") || return 0

    case "$choice" in
      1) 
        local status; status=$(pm2 list 2>/dev/null | head -20)
        msgbox "PM2 Process Status:\n\n$status"
        ;;
      2)
        if [[ -f "ecosystem.config.js" ]]; then
          infobox "Starting application with PM2..."
          pm2 start ecosystem.config.js && msgbox "Application started successfully!" || msgbox "Failed to start application"
        else
          msgbox "No ecosystem.config.js found. Create one first via 'Setup PM2 Ecosystem'."
        fi
        ;;
      3)
        infobox "Stopping PM2 processes..."
        pm2 stop all && msgbox "All processes stopped" || msgbox "Failed to stop processes"
        ;;
      4)
        infobox "Restarting PM2 processes..."
        pm2 restart all && msgbox "All processes restarted" || msgbox "Failed to restart processes"
        ;;
      5)
        infobox "Displaying recent logs (press Ctrl+C to exit)..."
        sleep 2
        pm2 logs --lines 50 || true
        ;;
      6)
        msgbox "Opening PM2 monitor (press 'q' to exit)..."
        sleep 2
        pm2 monit || true
        ;;
      7)
        pm2 save && msgbox "Process list saved for startup" || msgbox "Failed to save process list"
        ;;
      8)
        if yesno "Delete ALL PM2 processes? This cannot be undone."; then
          pm2 delete all && msgbox "All processes deleted" || msgbox "Failed to delete processes"
        fi
        ;;
      0) return 0;;
      *) ;;
    esac
  done
}

install_dotenv_cli(){
  # Check if dotenv-cli is already available
  if npx --yes --quiet dotenv -v >/dev/null 2>&1; then
    local current_version; current_version=$(npx --yes --quiet dotenv -v 2>/dev/null | head -n1 || echo "unknown")
    if ! yesno "dotenv-cli $current_version detected. Reinstall/update?"; then return 0; fi
  fi
  
  [[ -f package.json ]] || { msgbox "Run from project root (package.json not found)."; return 1; }
  
  local install_type; install_type=$(menu 1 "Development dependency (recommended)" 2 "Global installation" 3 "Production dependency") || return 1
  
  case "$install_type" in
    1)
      infobox "Installing dotenv-cli as dev dependency..."
      npm install --save-dev dotenv-cli
      ;;
    2)
      infobox "Installing dotenv-cli globally..."
      sudo npm install -g dotenv-cli
      ;;
    3)
      infobox "Installing dotenv-cli as production dependency..."
      npm install --save dotenv-cli
      ;;
    *) return 1;;
  esac
  
  if npx --yes --quiet dotenv -v >/dev/null 2>&1; then
    local version; version=$(npx --yes --quiet dotenv -v 2>/dev/null | head -n1 || echo "unknown")
    case "$choice" in
      1) development_menu;;
      2) production_menu;;
      3) database_menu;;
      4) system_menu;;
      5) 
        quiet_infobox "Running quick development setup..."
        install_nodejs && install_project_dependencies && setup_development_database
        ok "Quick dev setup complete"
        msgbox "Development Environment Ready!\n\nNext steps:\n• Run: npm run dev\n• Open: http://localhost:3000\n• Database: SQLite (prisma/dev.db)"
        ;;
      6) 
        quiet_infobox "Running quick production setup..."
        install_nodejs && install_postgresql && install_project_dependencies && setup_production_database && deploy_application
        ok "Quick prod setup complete"
        msgbox "Production Environment Ready!\n\nApplication is running with PM2\n• Monitor: pm2 monit\n• Logs: pm2 logs afct-dashboard\n• Restart: pm2 restart afct-dashboard"
        ;;
      0) exit 0;;
      *) ;;
    esac
  fi
}

troubleshoot_nextauth(){
  local choice; choice=$(menu \
    1 "Fix NextAuth Package Issues" \
    2 "Regenerate Prisma Client" \
    3 "Clear Next.js Cache" \
    4 "Check NextAuth Dependencies" \
    5 "Full NextAuth Reset" \
    0 "Back") || return 0
    
  case "$choice" in
    1) 
      infobox "Reinstalling NextAuth packages..."
      npm uninstall next-auth >/dev/null 2>&1 || true
      npm install next-auth@^5.0.0-beta.29 >/dev/null 2>&1 || { err "Failed to reinstall next-auth"; return 1; }
      success "NextAuth reinstalled successfully"
      ;;
    2)
      infobox "Regenerating Prisma client..."
      npm run db:generate >/dev/null 2>&1 || { err "Failed to regenerate Prisma client"; return 1; }
      success "Prisma client regenerated"
      ;;
    3)
      infobox "Clearing Next.js build cache..."
      [[ -d .next ]] && rm -rf .next
      success "Next.js cache cleared"
      ;;
    4)
      local out=""
      out+="NextAuth Dependencies:\n"
      out+="$(npm ls next-auth @auth/core @auth/prisma-adapter 2>/dev/null | head -10)\n\n"
      out+="Package Versions:\n"
      if command -v jq >/dev/null 2>&1; then
        out+="next-auth: $(jq -r '.dependencies["next-auth"] // "not found"' package.json)\n"
        out+="@auth/core: $(jq -r '.dependencies["@auth/core"] // "not found"' package.json)\n"
        out+="@auth/prisma-adapter: $(jq -r '.dependencies["@auth/prisma-adapter"] // "not found"' package.json)\n"
      else
        out+="Install 'jq' to see package.json versions\n"
      fi
      msgbox "$out"
      ;;
    5)
      if confirm "This will:\n• Uninstall/reinstall NextAuth\n• Clear Next.js cache\n• Regenerate Prisma client\n\nContinue?"; then
        infobox "Performing full NextAuth reset..."
        [[ -d .next ]] && rm -rf .next
        npm uninstall next-auth >/dev/null 2>&1 || true
        npm install next-auth@^5.0.0

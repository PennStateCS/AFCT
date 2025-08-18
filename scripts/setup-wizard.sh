#!/usr/bin/env bash
# =============================================================================
# AFCT Dashboard Setup Wizard (whiptail/dialog) - ENV-SAFE
# =============================================================================
# Features
#  - Auto-installs whiptail (or dialog) if missing
#  - Detects/fixes DATABASE_URL conflicts (dev & prod)
#  - Safe runners that ignore inherited DATABASE_URL and load correct .env
#  - URL-encoding for PostgreSQL credentials
#  - Node.js/PostgreSQL install helpers
#  - Prisma generate/migrate/seed helpers
#  - PM2 deploy helpers
#  - Quiet mode by default (use --verbose for detailed output)
# =============================================================================

set -euo pipefail

# -------------------------------- Globals -----------------------------------
VERBOSE=false
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE=true

# Colors & formatting
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'

log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN}✓${NC} $*"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*"; }
err(){ echo -e "${RED}✗${NC} $*"; }

quiet_infobox(){ if [[ "$VERBOSE" == "true" ]]; then infobox "$1"; else echo -e "$1"; fi; }
verbose_log(){ [[ "$VERBOSE" == "true" ]] && log "$@"; }

command_exists(){ command -v "$1" >/dev/null 2>&1; }
check_root(){ [[ $EUID -eq 0 ]]; }
nowstamp(){ date +%Y%m%d_%H%M%S; }
normalize_file_unix(){ local f="$1"; [[ -f "$f" ]] || return 0; sed -i 's/\r$//' "$f" 2>/dev/null || true; }
mask_db_url(){ local url="$1"; echo "$url" | sed -E 's#(postgresql://[^:]+):[^@]+@#\1:****@#'; }
read_dburl_from_file(){ local f="$1"; [[ -f "$f" ]] || return 1; normalize_file_unix "$f"; grep -E '^DATABASE_URL=' "$f" | tail -n1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//'; }
url_encode(){ node -e "try{process.stdout.write(encodeURIComponent(process.argv[1]||''))}catch{process.stdout.write(process.argv[1]||'')}" "$1" 2>/dev/null || echo -n "$1"; }

# ------------------------------ TUI Backend ---------------------------------
detect_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then echo "apt-get"
  elif command -v yum >/dev/null 2>&1; then echo "yum"
  elif command -v dnf >/dev/null 2>&1; then echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then echo "pacman"
  else echo ""; fi
}

ensure_tui() {
  if command -v whiptail >/dev/null 2>&1; then TUI="whiptail"
  elif command -v dialog >/dev/null 2>&1; then TUI="dialog"
  else
    echo "Neither whiptail nor dialog found. Attempting to install whiptail..."
    PKG_MGR=$(detect_pkg_mgr)
    if [[ -n "$PKG_MGR" ]]; then
      case "$PKG_MGR" in
        apt-get) sudo apt-get update -y && sudo apt-get install -y whiptail || sudo apt-get install -y dialog ;;
        yum)     sudo yum install -y newt || sudo yum install -y dialog ;;
        dnf)     sudo dnf install -y newt  || sudo dnf install -y dialog  ;;
        pacman)  sudo pacman -Sy --noconfirm libnewt || sudo pacman -Sy --noconfirm dialog ;;
      esac
    else
      echo "No supported package manager found. Falling back to plain bash prompts."
      TUI="none"; return
    fi
    if command -v whiptail >/dev/null 2>&1; then TUI="whiptail"
    elif command -v dialog >/dev/null 2>&1; then TUI="dialog"
    else echo "Failed to install whiptail/dialog. Falling back to plain bash prompts."; TUI="none"; fi
  fi
}
ensure_tui

title(){ echo "AFCT Dashboard Setup Wizard"; }
msgbox(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --msgbox "$1" 12 78; else echo -e "$1"; fi; }
infobox(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --infobox "$1" 8 78; else echo -e "$1"; fi; }
yesno(){ if [[ "${TUI:-none}" != "none" ]]; then $TUI --title "$(title)" --yesno "$1" 12 78; else read -r -p "$1 [y/N]: " _r; [[ "$_r" =~ ^[Yy]$ ]]; fi; }
inputbox(){ # $1 prompt, $2 default -> echoes result
  if [[ "${TUI:-none}" != "none" ]]; then
    local out; out=$($TUI --title "$(title)" --inputbox "$1" 12 78 "$2" 3>&1 1>&2 2>&3) || return 1; echo "$out"
  else
    local out; read -r -p "$1 [$2]: " out; echo "${out:-$2}"
  fi
}
passwordbox(){ # $1 prompt -> echoes result
  if [[ "${TUI:-none}" != "none" ]]; then
    local out; out=$($TUI --title "$(title)" --passwordbox "$1" 12 78 3>&1 1>&2 2>&3) || return 1; echo "$out"
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

  if [[ -d "prisma/migrations" ]]; then
    infobox "Backing up migrations..."
    cp -r prisma/migrations "$backup_dir"
    ok "Migrations backed up to: $backup_dir"
  fi

  infobox "Removing migration directory..."
  rm -rf prisma/migrations
  ok "Migration directory removed"

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
  local out="Disk space:\n$(df -h / | awk 'NR==2{print $4\" free\"}')\n\n"
  out+="Memory free:\n$(free -m | awk 'NR==2{print $7\" MB\"}')\n\n"
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
  if [[ "$OS" == "ubuntu" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif [[ "$OS" == "centos" ]]; then
    sudo yum install -y nodejs npm
  elif [[ "$OS" == "arch" ]]; then
    sudo pacman -Sy --noconfirm nodejs npm
  fi
  ok "Node: $(node --version)  NPM: $(npm --version)"
  sudo npm i -g pm2 cross-env >/dev/null 2>&1 || true
}

# ----------------------- Project Dependencies/Prisma ------------------------
install_project_dependencies(){
  [[ -f package.json ]] || { msgbox "Run this from the project root (package.json not found)."; return 1; }
  quiet_infobox "Installing dependencies..."
  if [[ "$VERBOSE" == "true" ]]; then npm install; else npm install >/dev/null 2>&1 || { err "npm install failed"; return 1; }; fi
  if ! npx --yes --quiet dotenv -v >/dev/null 2>&1; then npm i -D dotenv-cli >/dev/null 2>&1; fi
  ok "Dependencies installed"
}

fix_build_dependencies(){
  [[ -f package.json ]] || { msgbox "Run this from the project root (package.json not found)."; return 1; }
  infobox "Ensuring basic build deps (tailwind/postcss) exist..."
  npm list tailwindcss >/dev/null 2>&1 || npm i -D tailwindcss >/dev/null 2>&1
  npm list postcss >/dev/null 2>&1 || npm i -D postcss >/dev/null 2>&1
  npm list autoprefixer >/dev/null 2>&1 || npm i -D autoprefixer >/dev/null 2>&1
  [[ -f "tailwind.config.js" || -f "tailwind.config.ts" ]] || cat > tailwind.config.js <<'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [],
}
EOF
  ok "Build dependencies ready"
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
    cat > .env.local <<EOF
DATABASE_URL="file:./prisma/dev.db"
NODE_ENV="development"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo dev-secret)"
EOF
  fi
  detect_env_conflicts dev || { if yesno "Fix dev env conflicts now?"; then fix_env_conflicts dev; fi; }
  quiet_infobox "Setting up development database..."
  npx prisma generate >/dev/null 2>&1 || true
  npx prisma migrate dev --name init >/dev/null 2>&1 || true
  npm run seed >/dev/null 2>&1 || npx tsx prisma/seed.ts >/dev/null 2>&1 || true
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
  if [[ "$OS" == "ubuntu" ]]; then 
    sudo apt-get update -y && sudo apt-get install -y postgresql postgresql-contrib
  elif [[ "$OS" == "centos" ]]; then 
    sudo yum install -y postgresql-server postgresql-contrib; postgresql-setup initdb >/dev/null 2>&1
  else 
    sudo pacman -Sy --noconfirm postgresql
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

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${DB_USER}', '${DB_PASS}');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${DB_USER}', '${DB_PASS}');
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}') THEN
    EXECUTE format('CREATE DATABASE %I OWNER %I', '${DB_NAME}', '${DB_USER}');
  END IF;
END$$;
GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO "${DB_USER}";
SQL

  cat > .env.production <<EOF
# AFCT Dashboard Production Environment
# Generated: $(date)
DATABASE_URL="${DB_URL}"
NODE_ENV="production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo prod-secret)"
EOF

  quiet_infobox "Setting up production database schema..."
  run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || { err "Prisma generate failed"; return 1; }

  if ! run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma" >/dev/null 2>&1; then
    warn "Migration deploy failed (likely P3005). Using db push..."
    run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss" >/dev/null 2>&1 || { err "Schema sync failed"; return 1; }
  fi

  run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || verbose_log "Seeding failed; you can re-run later."
  msgbox "Production DB configured.\nDATABASE_URL=$(mask_db_url "$DB_URL")"
}

# ------------------------------ Deploy App ----------------------------------
deploy_application(){
  [[ -f package.json ]] || { msgbox "Run from project root."; return 1; }
  [[ -f ".env.production" ]] || { msgbox ".env.production is missing. Run production DB setup first."; return 1; }
  if [[ ! -d node_modules ]]; then quiet_infobox "Installing dependencies..."; npm install >/dev/null 2>&1; fi
  quiet_infobox "Building application..."; npm run build >/dev/null 2>&1 || { err "Build failed"; return 1; }
  if command_exists pm2; then
    pm2 delete afct-dashboard 2>/dev/null || true
    pm2 start npm --name afct-dashboard -- start >/dev/null 2>&1
    pm2 save >/dev/null 2>&1
    msgbox "Deployment Complete!\n\nApplication: afct-dashboard\nStatus: Running with PM2\nLogs: pm2 logs afct-dashboard\nMonitor: pm2 monit"
  else
    npm start &
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
    npx prisma migrate dev --name init >/dev/null 2>&1 || true
    npm run seed >/dev/null 2>&1 || npx tsx prisma/seed.ts >/dev/null 2>&1 || true
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

  run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || true
  run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss" >/dev/null 2>&1
  run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" >/dev/null 2>&1 || true
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
  if [[ -f "prisma/migrations/migration_lock.toml" ]]; then
    local migration_provider; migration_provider=$(grep 'provider = ' prisma/migrations/migration_lock.toml | cut -d'"' -f2 2>/dev/null || echo "unknown")
    out+="Migration provider: $migration_provider\n"
  else
    out+="migrations: no lock file (fresh setup or db push only)\n"
  fi
  if [[ -d prisma/migrations ]]; then
    local count; count=$(find prisma/migrations -name "*.sql" | wc -l)
    out+="migrations: $count SQL files\n"
  else
    out+="migrations: directory missing (db push is fine)\n"
  fi
  msgbox "$out"
}

# ------------------------- PM2 & Process Management -------------------------
install_pm2(){
  if command_exists pm2; then
    local current_version; current_version=$(pm2 --version 2>/dev/null || echo "unknown")
    if ! yesno "PM2 $current_version detected. Reinstall/update?"; then return 0; fi
  fi
  infobox "Installing PM2 globally..."
  sudo npm install -g pm2 >/dev/null 2>&1 || { err "Failed to install PM2"; return 1; }
  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  ok "PM2 $(pm2 --version) installed"
}

setup_pm2_ecosystem(){
  [[ -f package.json ]] || { msgbox "Run from project root (package.json not found)."; return 1; }
  local app_name; app_name=$(inputbox "Application name" "afct-dashboard") || return 1
  local instances; instances=$(inputbox "Number of instances (0=auto)" "0") || return 1
  local max_memory; max_memory=$(inputbox "Max memory per instance (MB)" "512") || return 1
  local node_env_choice; node_env_choice=$(menu 1 "production" 2 "development" 3 "staging") || return 1
  local node_env="production"; [[ "$node_env_choice" == "2" ]] && node_env="development"; [[ "$node_env_choice" == "3" ]] && node_env="staging"
  local env_file=".env.production"; [[ "$node_env" != "production" ]] && env_file=".env.local"
  [[ -f "$env_file" ]] || { msgbox "Environment file '$env_file' missing. Run the corresponding setup first."; return 1; }

  cat > ecosystem.config.js <<EOF
module.exports = {
  apps: [
    {
      name: '${app_name}',
      script: 'npm',
      args: 'start',
      instances: ${instances},
      exec_mode: ${instances} > 1 ? 'cluster' : 'fork',
      env_file: '${env_file}',
      max_memory_restart: '${max_memory}M',
      autorestart: true,
      restart_delay: 4000,
      merge_logs: true,
      env: { NODE_ENV: '${node_env}', PORT: 3000 },
      env_production: { NODE_ENV: 'production', PORT: 3000 }
    }
  ]
};
EOF
  mkdir -p logs
  ok "PM2 ecosystem configuration created: ecosystem.config.js"
  msgbox "PM2 Ecosystem ready. Start with: pm2 start ecosystem.config.js"
}

configure_pm2_startup(){
  command_exists pm2 || { msgbox "PM2 not installed. Install PM2 first."; return 1; }
  if ! check_root; then msgbox "PM2 startup configuration requires root privileges."; return 1; fi
  local startup_cmd; startup_cmd=$(pm2 startup | grep "sudo env" | head -n1)
  if [[ -n "$startup_cmd" ]]; then eval "$startup_cmd"; pm2 save; ok "PM2 startup configured"; else err "Failed to configure PM2 startup"; return 1; fi
}

manage_pm2_processes(){
  command_exists pm2 || { msgbox "PM2 not installed. Install PM2 first."; return 1; }
  while true; do
    local choice
    choice=$(menu \
      1 "View Process Status" \
      2 "Start (ecosystem.config.js)" \
      3 "Stop All" \
      4 "Restart All" \
      5 "View Logs" \
      6 "Monitor" \
      7 "Save Process List" \
      8 "Delete All" \
      0 "Back") || return 0
    case "$choice" in
      1) msgbox "PM2 Process Status:\n\n$(pm2 list 2>/dev/null | head -40)";;
      2) pm2 start ecosystem.config.js && msgbox "Started" || msgbox "Failed";;
      3) pm2 stop all && msgbox "Stopped" || msgbox "Failed";;
      4) pm2 restart all && msgbox "Restarted" || msgbox "Failed";;
      5) pm2 logs --lines 50 || true;;
      6) pm2 monit || true;;
      7) pm2 save && msgbox "Saved" || msgbox "Failed";;
      8) if yesno "Delete ALL PM2 processes?"; then pm2 delete all && msgbox "Deleted" || msgbox "Failed"; fi;;
      0) return 0;;
      *) ;;
    esac
  done
}

# --------------------------- Menus & Navigation -----------------------------
development_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "Full Dev Setup (Node + deps + DB)" \
      2 "Install Node.js" \
      3 "Install Project Dependencies" \
      4 "Setup Development Database (SQLite)" \
      5 "Reset Development Database" \
      6 "Test Development Database" \
      7 "Environment Conflict Detection & Fix (DEV)" \
      0 "Back") || return 0
    case "$choice" in
      1) install_nodejs; install_project_dependencies; setup_development_database; msgbox "Dev setup complete.\nRun: npm run dev";;
      2) install_nodejs;;
      3) install_project_dependencies;;
      4) setup_development_database;;
      5) reset_development_database;;
      6) test_database_connection;;
      7) detect_env_conflicts dev || { if yesno "Run auto-fix?"; then fix_env_conflicts dev; fi; };;
      0) return 0;;
      *) ;;
    esac
  done
}

production_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "Full Prod Setup (Node + Postgres + deps + DB + PM2)" \
      2 "Install PostgreSQL" \
      3 "Setup Production Database" \
      4 "Install PM2" \
      5 "Setup PM2 Ecosystem" \
      6 "Deploy Application" \
      7 "Configure PM2 Startup" \
      8 "Manage PM2 Processes" \
      9 "Reset Production Database" \
      10 "Test Production Database" \
      11 "Fix Migration Provider (PostgreSQL)" \
      12 "Environment Conflict Detection & Fix (PROD)" \
      0 "Back") || return 0
    case "$choice" in
      1) install_nodejs; install_postgresql; install_project_dependencies; setup_production_database; install_pm2; setup_pm2_ecosystem; deploy_application;;
      2) install_postgresql;;
      3) setup_production_database;;
      4) install_pm2;;
      5) setup_pm2_ecosystem;;
      6) deploy_application;;
      7) configure_pm2_startup;;
      8) manage_pm2_processes;;
      9) reset_production_database;;
      10) test_database_connection;;
      11) fix_migration_provider_mismatch postgresql;;
      12) detect_env_conflicts prod || { if yesno "Run auto-fix?"; then fix_env_conflicts prod; fi; };;
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
      3 "Check Migration Issues" \
      4 "Fix Migration Provider Mismatch" \
      5 "Reset Development Database" \
      6 "Reset Production Database" \
      7 "Environment Conflict Detection (DEV)" \
      8 "Environment Conflict Detection (PROD)" \
      0 "Back") || return 0
    case "$choice" in
      1) test_database_connection;;
      2) troubleshoot_database;;
      3) check_migration_issues;;
      4) 
        local provider_choice
        provider_choice=$(menu 1 "Fix for PostgreSQL (Production)" 2 "Fix for SQLite (Development)" 0 "Back") || continue
        case "$provider_choice" in
          1) fix_migration_provider_mismatch postgresql;;
          2) fix_migration_provider_mismatch sqlite;;
          *) ;;
        esac
        ;;
      5) reset_development_database;;
      6) reset_production_database;;
      7) detect_env_conflicts dev || { if yesno "Run auto-fix?"; then fix_env_conflicts dev; fi; };;
      8) detect_env_conflicts prod || { if yesno "Run auto-fix?"; then fix_env_conflicts prod; fi; };;
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
      0 "Back") || return 0
    case "$choice" in
      1) system_health_check;;
      2) view_system_status;;
      3) install_nodejs;;
      4) install_postgresql;;
      5) install_project_dependencies;;
      6) fix_build_dependencies;;
      0) return 0;;
      *) ;;
    esac
  done
}

main_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "Development" \
      2 "Production" \
      3 "Databases" \
      4 "System" \
      0 "Exit") || exit 0
    case "$choice" in
      1) development_menu;;
      2) production_menu;;
      3) database_menu;;
      4) system_menu;;
      0) exit 0;;
      *) ;;
    esac
  done
}

# ------------------------------- Entry Point --------------------------------
main_menu

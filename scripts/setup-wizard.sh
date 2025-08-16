#!/usr/bin/env bash
# =============================================================================
# AFCT Dashboard Setup Wizard (TUI with whiptail/dialog) - ENV-SAFE (Auto-install TUI)
# =============================================================================
# Full-featured wizard for dev & prod:
#  - Auto-installs whiptail (or dialog) if missing
#  - Detects/fixes DATABASE_URL conflicts (dev & prod)
#  - Safe runners that ignore inherited DATABASE_URL and load correct .env
#  - URL-encoding for credentials in DATABASE_URL
#  - Node.js/PostgreSQL setup, Prisma generate/migrate/seed, deploy with PM2
# =============================================================================

set -euo pipefail

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
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log(){ echo -e "${BLUE}==>${NC} $*"; }
ok(){ echo -e "${GREEN}✓${NC} $*"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*"; }
err(){ echo -e "${RED}✗${NC} $*"; }

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
  infobox "Installing dependencies..."; npm install
  if ! npx --yes --quiet dotenv -v >/dev/null 2>&1; then npm i -D dotenv-cli; fi
  msgbox "Dependencies installed."
}

# ------------------------------ Dev Database --------------------------------
setup_development_database(){
  check_os
  if ! command_exists sqlite3; then
    if [[ "$OS" == "ubuntu" ]]; then sudo apt-get update && sudo apt-get install -y sqlite3 libsqlite3-dev
    elif [[ "$OS" == "centos" ]]; then sudo yum install -y sqlite sqlite-devel
    else sudo pacman -Sy --noconfirm sqlite; fi
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
  infobox "Generating Prisma client..." ; npx prisma generate || true
  infobox "Applying dev migrations..." ; npx prisma migrate dev --name init
  infobox "Seeding dev DB..." ; npm run seed 2>/dev/null || npx tsx prisma/seed.ts || true
  msgbox "Development DB ready."
}

# ------------------------------ PostgreSQL ----------------------------------
install_postgresql(){
  check_os
  if command_exists psql; then
    systemctl is-active --quiet postgresql || { sudo systemctl start postgresql; sudo systemctl enable postgresql; }
    msgbox "PostgreSQL available."; return 0
  fi
  if ! check_root; then msgbox "Please run with sudo/root to install PostgreSQL."; return 1; fi
  if [[ "$OS" == "ubuntu" ]]; then sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
  elif [[ "$OS" == "centos" ]]; then sudo yum install -y postgresql-server postgresql-contrib && postgresql-setup initdb
  else sudo pacman -Sy --noconfirm postgresql; fi
  sudo systemctl start postgresql && sudo systemctl enable postgresql
  msgbox "PostgreSQL installed & running."
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
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"
EOF
  normalize_file_unix ".env.production"

  # Test psql
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "select 1" >/dev/null 2>&1; then
    :
  else
    msgbox "psql connection failed. Check credentials/pg_hba.conf."; return 1
  fi

  # Prisma generate/migrate/seed with env-safe runner
  run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma" || { msgbox "Prisma generate failed"; return 1; }
  if ! run_with_env prod "npx prisma migrate deploy --schema=prisma/schema.production.prisma"; then
    if yesno "migrate deploy failed. Try 'db push' (may accept data loss)?"; then
      run_with_env prod "npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss"
    fi
  fi
  run_with_env prod "npx prisma db seed --schema=prisma/schema.production.prisma" || msgbox "Seeding failed; you can re-run later."

  msgbox "Production DB configured.\nDATABASE_URL=$(mask_db_url "$DB_URL")"
}

# ------------------------------ Deploy App ----------------------------------
deploy_application(){
  [[ -f package.json ]] || { msgbox "Run from project root."; return 1; }
  [[ -f ".env.production" ]] || { msgbox ".env.production is missing. Run production DB setup first."; return 1; }
  infobox "Installing deps (if needed)"; [[ -d node_modules ]] || npm install
  infobox "Building application"; npm run build
  if command_exists pm2; then
    pm2 delete afct-dashboard 2>/dev/null || true
    pm2 start npm --name afct-dashboard -- start
    pm2 save
    msgbox "Application started with PM2.\nLogs: pm2 logs afct-dashboard"
  else
    npm start &
    msgbox "Application started with npm start (consider using PM2)."
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
  out+="\nTip: prefer 'db push' when mixing SQLite dev & Postgres prod."
  msgbox "$out"
}

validate_production_environment(){
  local missing=""
  for f in package.json prisma/schema.production.prisma .env.production; do [[ -f "$f" ]] || missing+="$f\n"; done
  if [[ -n "$missing" ]]; then msgbox "Missing:\n$missing"; return 1; fi

  detect_env_conflicts prod || true
  local url; url="$(read_dburl_from_file ".env.production")"
  [[ -n "$url" ]] || { msgbox "DATABASE_URL missing in .env.production"; return 1; }
  local res="DATABASE_URL: $(mask_db_url "$url")\n"
  if run_with_env prod "npx prisma validate --schema=prisma/schema.production.prisma"; then res+="Schema: valid\n"; else res+="Schema: invalid\n"; fi
  if run_with_env prod "npx prisma generate --schema=prisma/schema.production.prisma"; then res+="Client: generated\n"; else res+="Client: failed\n"; fi
  msgbox "$res"
}

# ------------------------------- Main Menu ----------------------------------
main_menu(){
  while true; do
    local choice
    choice=$(menu \
      1 "Complete Development Setup" \
      2 "Install Node.js only" \
      3 "Setup Development Database (SQLite)" \
      4 "Install Project Dependencies" \
      5 "Complete Production Setup" \
      6 "Install PostgreSQL only" \
      7 "Setup Production Database (PostgreSQL)" \
      8 "Deploy Application" \
      9 "Test Database Connection" \
      10 "Reset Database (Development)" \
      11 "Reset Database (Production)" \
      12 "System Health Check" \
      13 "View System Status" \
      14 "Check Migration Issues" \
      15 "Validate Production Environment" \
      16 "Database Troubleshooting" \
      17 "Detect & Fix Env Conflicts (DEV)" \
      18 "Detect & Fix Env Conflicts (PROD)" \
      0 "Exit") || exit 0

    case "$choice" in
      1) install_nodejs; install_project_dependencies; setup_development_database; msgbox "Dev setup complete.\nRun: npm run dev";;
      2) install_nodejs;;
      3) setup_development_database;;
      4) install_project_dependencies;;
      5) install_nodejs; install_postgresql; install_project_dependencies; setup_production_database; infobox "Building app..."; npm run build; msgbox "Production setup complete.\nStart: npm start or PM2";;
      6) install_postgresql;;
      7) setup_production_database;;
      8) deploy_application;;
      9) test_database_connection;;
      10) reset_development_database;;
      11) reset_production_database;;
      12) system_health_check;;
      13) view_system_status;;
      14) check_migration_issues;;
      15) validate_production_environment;;
      16) troubleshoot_database;;
      17) detect_env_conflicts dev || { if yesno "Run auto-fix?"; then fix_env_conflicts dev; fi; };;
      18) detect_env_conflicts prod || { if yesno "Run auto-fix?"; then fix_env_conflicts prod; fi; };;
      0) exit 0;;
      *) : ;;
    esac
  done
}

# ------------------------------- Entry Point --------------------------------
check_os
main_menu

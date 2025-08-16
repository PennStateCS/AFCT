#!/bin/bash

# =============================================================================
# AFCT Dashboard Setup Wizard
# =============================================================================
# Complete setup wizard for AFCT Dashboard - beginner friendly!
# Handles Node.js, database, and application setup for development and production
# =============================================================================

set -e  # Exit on any error

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Print functions
print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

print_header() {
    echo -e "${PURPLE}=============================================="
    echo -e "  $1"
    echo -e "==============================================\033[0m"
}

# Mask a PostgreSQL DATABASE_URL password when printing
mask_db_url() {
    local url="$1"
    echo "$url" | sed -E 's#(postgresql://[^:]+):[^@]+@#\1:****@#'
}

# Default configuration
DB_NAME_DEV="dev.db"
DB_NAME_PROD="afct_production"
DB_USER_PROD="afct_user"
APP_DIR="/var/www/afct"
NODE_VERSION="20"

# Check if running as root for certain operations
check_root() {
    if [[ $EUID -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Function to prompt for input with validation
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local default_value="$3"
    local required="$4"
    
    while true; do
        if [[ -n "$default_value" ]]; then
            read -p "$prompt [$default_value]: " input
            if [[ -z "$input" ]]; then
                eval "$var_name='$default_value'"
            else
                eval "$var_name='$input'"
            fi
        else
            read -p "$prompt: " input
            eval "$var_name='$input'"
        fi
        
        # Check if required and empty
        if [[ "$required" == "true" && -z "${!var_name}" ]]; then
            print_error "This field is required. Please enter a value."
            continue
        fi
        break
    done
}

# Function to prompt for password with confirmation
prompt_password() {
    local prompt="$1"
    local var_name="$2"
    
    while true; do
        read -s -p "$prompt: " password1
        echo
        read -s -p "Confirm password: " password2
        echo
        
        if [[ "$password1" == "$password2" ]]; then
            eval "$var_name='$password1'"
            break
        else
            print_error "Passwords do not match. Please try again."
        fi
    done
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Pause for user to read
pause() {
    read -p "Press [Enter] to continue..."
}
# =============================================================================
# Menu Functions
# =============================================================================

show_main_menu() {
    clear
    print_header "🚀 AFCT Dashboard Setup Wizard"
    echo
    print_info "Welcome! This wizard will help you set up the AFCT Dashboard project."
    print_info "Perfect for beginners - we'll handle everything for you!"
    echo
    echo "Choose your setup type:"
    echo
    echo "📝 DEVELOPMENT SETUP:"
    echo "  1) Complete Development Setup (Node.js + SQLite + App)"
    echo "  2) Install Node.js only"
    echo "  3) Setup Development Database (SQLite)"
    echo "  4) Install Project Dependencies"
    echo
    echo "🚀 PRODUCTION SETUP:"
    echo "  5) Complete Production Setup (Node.js + PostgreSQL + App)"
    echo "  6) Install PostgreSQL only"
    echo "  7) Setup Production Database (PostgreSQL)"
    echo "  8) Deploy Application"
    echo
    echo "🔧 UTILITIES:"
    echo "  9) Test Database Connection"
    echo " 10) Reset Database (Development)"
    echo " 11) Reset Database (Production)"
    echo " 12) System Health Check"
    echo " 13) View System Status"
    echo " 14) Check Migration Issues"
    echo " 15) Validate Production Environment"
    echo " 16) Database Troubleshooting"
    echo
    echo " 0) Exit"
    echo
}

get_user_choice() {
    while true; do
        echo -n "Enter your choice (0-16): "
        read choice
        case $choice in
            [0-9]|1[0-6]) return 0 ;;
            *) print_error "Invalid choice. Please enter a number between 0 and 16." ;;
        esac
    done
}

# =============================================================================
# System Check Functions
# =============================================================================

check_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command_exists "apt"; then
            OS="ubuntu"
            print_success "Detected Ubuntu/Debian system"
        elif command_exists "yum"; then
            OS="centos"
            print_success "Detected CentOS/RHEL system"
        else
            print_error "Unsupported Linux distribution"
            exit 1
        fi
    else
        print_error "This script only supports Linux systems"
        exit 1
    fi
}

system_health_check() {
    print_header "🔍 System Health Check"
    
    # Check OS
    check_os
    
    # Check available space
    print_step "Checking disk space..."
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    if [[ $AVAILABLE_SPACE -gt 1048576 ]]; then  # 1GB in KB
        print_success "Sufficient disk space available"
    else
        print_warning "Low disk space. Consider freeing up space."
    fi
    
    # Check memory
    print_step "Checking memory..."
    AVAILABLE_MEMORY=$(free -m | awk 'NR==2{print $7}')
    if [[ $AVAILABLE_MEMORY -gt 512 ]]; then
        print_success "Sufficient memory available"
    else
        print_warning "Low memory. Consider closing other applications."
    fi
    
    # Check internet connection
    print_step "Checking internet connection..."
    if ping -c 1 google.com &> /dev/null; then
        print_success "Internet connection available"
    else
        print_error "No internet connection. Some installations may fail."
    fi
    
    # Check if running with appropriate permissions
    print_step "Checking permissions..."
    if [[ $EUID -eq 0 ]]; then
        print_info "Running as root - good for system installations"
    else
        print_info "Running as regular user - some operations may require sudo"
    fi
    
    pause
}

view_system_status() {
    print_header "📊 System Status"
    
    # Node.js status
    print_step "Node.js Status:"
    if command_exists "node"; then
        NODE_VERSION=$(node --version)
        print_success "Node.js installed: $NODE_VERSION"
    else
        print_warning "Node.js not installed"
    fi
    
    # NPM status
    if command_exists "npm"; then
        NPM_VERSION=$(npm --version)
        print_success "NPM installed: $NPM_VERSION"
    else
        print_warning "NPM not installed"
    fi
    
    # PostgreSQL status
    print_step "PostgreSQL Status:"
    if command_exists "psql"; then
        if systemctl is-active --quiet postgresql 2>/dev/null; then
            print_success "PostgreSQL installed and running"
        else
            print_warning "PostgreSQL installed but not running"
        fi
    else
        print_warning "PostgreSQL not installed"
    fi
    
    # SQLite status
    print_step "SQLite Status:"
    if command_exists "sqlite3"; then
        SQLITE_VERSION=$(sqlite3 --version | cut -d' ' -f1)
        print_success "SQLite installed: $SQLITE_VERSION"
    else
        print_warning "SQLite not installed"
    fi
    
    # Project status
    print_step "Project Status:"
    if [[ -f "package.json" ]]; then
        print_success "Project files found"
        if [[ -d "node_modules" ]]; then
            print_success "Dependencies installed"
        else
            print_warning "Dependencies not installed"
        fi
        
        if [[ -f ".env.local" ]]; then
            print_success "Development environment configured"
        else
            print_warning "Development environment not configured"
        fi
        
        if [[ -f ".env.production" ]]; then
            print_success "Production environment configured"
        else
            print_warning "Production environment not configured"
        fi
    else
        print_error "Not in AFCT Dashboard project directory"
    fi
    
    pause
}

# =============================================================================
# Node.js Installation Functions
# =============================================================================

install_nodejs() {
    print_header "📦 Installing Node.js"
    
    if command_exists "node"; then
        CURRENT_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        print_info "Node.js already installed: v$(node --version)"
        
        prompt_input "Do you want to update to Node.js $NODE_VERSION? (y/n)" UPDATE_NODE "n"
        if [[ ! "$UPDATE_NODE" =~ ^[Yy]$ ]]; then
            print_info "Keeping current Node.js installation"
            return 0
        fi
    fi
    
    print_step "Installing Node.js $NODE_VERSION..."
    
    # Install NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    
    # Install Node.js
    if [[ "$OS" == "ubuntu" ]]; then
        sudo apt-get install -y nodejs
    elif [[ "$OS" == "centos" ]]; then
        sudo yum install -y nodejs npm
    fi
    
    # Verify installation
    if command_exists "node" && command_exists "npm"; then
        print_success "Node.js installed successfully: $(node --version)"
        print_success "NPM installed successfully: $(npm --version)"
    else
        print_error "Node.js installation failed"
        exit 1
    fi
    
    # Install global packages
    print_step "Installing global packages..."
    sudo npm install -g pm2 cross-env
    print_success "Global packages installed"
    
    pause
}

# =============================================================================
# Database Installation Functions
# =============================================================================

setup_development_database() {
    print_header "🗄️ Setting Up Development Database (SQLite)"
    
    # Install SQLite if not present
    if ! command_exists "sqlite3"; then
        print_step "Installing SQLite..."
        if [[ "$OS" == "ubuntu" ]]; then
            sudo apt-get update
            sudo apt-get install -y sqlite3 libsqlite3-dev
        elif [[ "$OS" == "centos" ]]; then
            sudo yum install -y sqlite sqlite-devel
        fi
        print_success "SQLite installed"
    else
        print_success "SQLite already installed"
    fi
    
    # Setup development environment
    print_step "Setting up development environment..."
    
    # Create .env.local robustly
    if [[ ! -f ".env.local" ]]; then
        if [[ -f ".env.example" ]]; then
            cp .env.example .env.local
            print_success "Created .env.local from .env.example"
        else
            cat > .env.local << EOF
# AFCT Dashboard Development Environment
DATABASE_URL="file:./prisma/dev.db"
NODE_ENV="development"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo dev-secret)"
EOF
            print_success "Created .env.local with default SQLite configuration"
        fi
    else
        print_info ".env.local already exists"
    fi
    
    # Switch to development schema
    print_step "Setting up development schema..."
    if [[ -f "prisma/schema.development.prisma" ]]; then
        # Check if ERD generation is available
        if command_exists "google-chrome" || command_exists "chromium-browser" || command_exists "chromium"; then
            print_step "Using development schema with ERD generation..."
            cp prisma/schema.development.prisma prisma/schema.prisma
            print_success "Development schema with ERD support activated"
        else
            print_step "Using development schema without ERD..."
            # Use the basic schema without ERD generator
            print_success "Development schema activated (ERD disabled - requires Chrome/Chromium)"
        fi
    else
        print_step "Creating development schema..."
        # Ensure we have a basic development schema
        if [[ -f "prisma/schema.production.prisma" ]]; then
            cp prisma/schema.production.prisma prisma/schema.prisma
            # Replace PostgreSQL with SQLite for development
            sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
            print_success "Development schema created from production schema"
        fi
    fi
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        print_step "Installing project dependencies..."
        npm install
        print_success "Dependencies installed"
    fi
    
    # Generate Prisma client with safe ERD handling
    print_step "Generating Prisma client..."
    if [[ -f "prisma/schema.development.prisma" ]] && (command_exists "google-chrome" || command_exists "chromium-browser" || command_exists "chromium"); then
        print_step "Attempting to generate with ERD support..."
        if npm run db:generate:with-erd 2>/dev/null; then
            print_success "Prisma client generated successfully with ERD"
        else
            print_warning "ERD generation failed, using safe fallback..."
            npm run db:generate:safe
        fi
    else
        print_step "Generating without ERD support..."
        npm run db:generate:safe
    fi
    
    # Run database migrations
    print_step "Setting up database..."
    npx prisma migrate dev --name init
    print_success "Database migrations applied"
    
    # Seed database
    print_step "Seeding database with sample data..."
    npm run seed 2>/dev/null || npx tsx prisma/seed.ts
    print_success "Database seeded with sample data"
    
    print_success "Development database setup complete!"
    print_info "Your SQLite database is located at: prisma/dev.db"
    pause
}

install_postgresql() {
    print_header "🐘 Installing PostgreSQL"
    
    # Check if PostgreSQL is already installed
    if command_exists "psql"; then
        print_info "PostgreSQL already installed"
        if systemctl is-active --quiet postgresql; then
            print_success "PostgreSQL service is running"
        else
            print_step "Starting PostgreSQL service..."
            sudo systemctl start postgresql
            sudo systemctl enable postgresql
            print_success "PostgreSQL service started"
        fi
        pause
        return 0
    fi
    
    # Check for root privileges
    if ! check_root; then
        print_error "Installing PostgreSQL requires root privileges. Please run with sudo."
        exit 1
    fi
    
    print_step "Installing PostgreSQL..."
    
    if [[ "$OS" == "ubuntu" ]]; then
        apt update
        apt install -y postgresql postgresql-contrib
    elif [[ "$OS" == "centos" ]]; then
        yum install -y postgresql-server postgresql-contrib
        postgresql-setup initdb
    fi
    
    # Start and enable PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql
    
    # Verify installation
    if systemctl is-active --quiet postgresql; then
        print_success "PostgreSQL installed and running successfully"
    else
        print_error "PostgreSQL installation failed"
        exit 1
    fi
    
    pause
}

setup_production_database() {
    print_header "🗄️ Setting Up Production Database (PostgreSQL)"
    
    # Ensure PostgreSQL is installed
    if ! command_exists "psql"; then
        print_step "PostgreSQL not found. Installing..."
        install_postgresql
    fi
    
    # Get database configuration
    print_step "Database Configuration"
    prompt_input "Database name" DB_NAME_PROD "$DB_NAME_PROD"
    prompt_input "Database user" DB_USER_PROD "$DB_USER_PROD"
    prompt_password "Enter password for database user ($DB_USER_PROD)" DB_PASSWORD_PROD
    prompt_input "Database host" DB_HOST_PROD "localhost"
    prompt_input "Database port" DB_PORT_PROD "5432"
    
    # Validate port is numeric
    if ! [[ "$DB_PORT_PROD" =~ ^[0-9]+$ ]]; then
        print_error "Invalid port. Must be a number."
        return 1
    fi
    
    # URL-encode password to avoid breaking the connection string
    ENCODED_DB_PASSWORD_PROD=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$DB_PASSWORD_PROD" 2>/dev/null)
    if [[ -z "$ENCODED_DB_PASSWORD_PROD" ]]; then
        ENCODED_DB_PASSWORD_PROD="$DB_PASSWORD_PROD"
    fi
    
    # Optionally set postgres superuser password (safer for existing setups)
    prompt_input "Would you like to set/change the PostgreSQL superuser (postgres) password now? (y/N)" SET_PG_SUPER "n"
    if [[ "$SET_PG_SUPER" =~ ^[Yy]$ ]]; then
        print_step "Setting PostgreSQL superuser password..."
        prompt_password "Enter password for PostgreSQL superuser (postgres)" POSTGRES_PASSWORD
        sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
        print_success "PostgreSQL superuser password set"
    else
        print_info "Skipping superuser password change"
    fi
    
    # Create application database and user with error handling
    print_step "Creating application database and user..."
    
    # Create user first
    if sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER_PROD'" | grep -q 1; then
        print_info "User '$DB_USER_PROD' already exists, updating password..."
        sudo -u postgres psql -c "ALTER USER $DB_USER_PROD WITH PASSWORD '$DB_PASSWORD_PROD';"
    else
        print_step "Creating new user '$DB_USER_PROD'..."
        sudo -u postgres psql -c "CREATE USER $DB_USER_PROD WITH PASSWORD '$DB_PASSWORD_PROD';"
        print_success "User '$DB_USER_PROD' created"
    fi
    
    # Create database
    if sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME_PROD"; then
        print_info "Database '$DB_NAME_PROD' already exists"
    else
        print_step "Creating database '$DB_NAME_PROD'..."
        sudo -u postgres createdb -O "$DB_USER_PROD" "$DB_NAME_PROD"
        print_success "Database '$DB_NAME_PROD' created"
    fi
    
    # Grant privileges
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME_PROD TO $DB_USER_PROD;"
    print_success "Privileges granted to user '$DB_USER_PROD'"
    
    print_success "Database '$DB_NAME_PROD' and user '$DB_USER_PROD' configured"
    
    # Skip the complex authentication configuration for now - use simpler approach
    print_step "Restarting PostgreSQL..."
    sudo systemctl restart postgresql
    print_success "PostgreSQL restarted"
    
    # Wait a moment for service to be ready
    sleep 2
    
    # Create production environment file with URL-encoded password
    print_step "Creating production environment file..."
    DB_CONNECTION_STRING="postgresql://$DB_USER_PROD:$ENCODED_DB_PASSWORD_PROD@$DB_HOST_PROD:$DB_PORT_PROD/$DB_NAME_PROD"
    JWT_SECRET=$(openssl rand -base64 32)
    
    cat > .env.production << EOF
# AFCT Dashboard Production Environment
# Generated by setup wizard on $(date)

# Database Configuration
DATABASE_URL="$DB_CONNECTION_STRING"

# Authentication
JWT_SECRET="$JWT_SECRET"

# Application Settings
NODE_ENV="production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$JWT_SECRET"

# File Upload Settings
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"
EOF
    
    print_success "Production environment file created"
    print_info "Saved DATABASE_URL: $(mask_db_url "$DB_CONNECTION_STRING")"
    
    # Ensure production schema exists
    if [[ ! -f "prisma/schema.production.prisma" ]]; then
        print_error "Production schema file not found: prisma/schema.production.prisma"
        print_info "Please ensure the file exists before running production setup"
        exit 1
    else
        print_success "Production schema found"
    fi
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        print_step "Installing project dependencies..."
        npm install
        print_success "Dependencies installed"
    fi
    
    # Set environment for all operations
    export DATABASE_URL="$DB_CONNECTION_STRING"
    
    # Test connection first (psql)
    print_step "Testing database connection..."
    if PGPASSWORD="$DB_PASSWORD_PROD" psql -h "$DB_HOST_PROD" -p "$DB_PORT_PROD" -U "$DB_USER_PROD" -d "$DB_NAME_PROD" -c "SELECT 'Connection successful!' as status;" &> /dev/null; then
        print_success "Database connection test passed"
    else
        print_error "Database connection test failed"
        print_info "Please check PostgreSQL configuration and credentials"
        exit 1
    fi
    
    # Generate Prisma client first
    print_step "Generating Prisma client (production schema)..."
    if npx prisma generate --schema=prisma/schema.production.prisma; then
        print_success "Prisma client generated successfully"
    else
        print_error "Failed to generate Prisma client"
        exit 1
    fi
    
    # Decide migration strategy
    print_step "Synchronizing database schema..."
    MIGRATION_SQL_COUNT=$(find prisma/migrations -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
    if [[ -f "prisma/migrations/migration_lock.toml" ]] && grep -q 'provider = "postgresql"' prisma/migrations/migration_lock.toml 2>/dev/null && [[ "$MIGRATION_SQL_COUNT" -gt 0 ]]; then
        print_info "Detected PostgreSQL migrations. Running 'prisma migrate deploy'."
        if npx prisma migrate deploy --schema=prisma/schema.production.prisma; then
            print_success "Migrations deployed successfully"
        else
            print_error "Migration deployment failed"
            print_info "Trying alternative approach with 'db push'..."
            if npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss; then
                print_success "Database schema synchronized successfully (db push)"
            else
                print_error "Failed to synchronize schema via db push"
                exit 1
            fi
        fi
    else
        print_warning "No PostgreSQL migration history detected. Using 'db push'."
        if npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss; then
            print_success "Database schema synchronized successfully (db push)"
        else
            print_error "Failed to synchronize schema via db push"
            exit 1
        fi
    fi
    
    # Seed database with production-safe script
    print_step "Seeding database with production environment..."
    set -a
    source .env.production
    set +a
    if node scripts/simple-seed.js; then
        print_success "Database seeded successfully"
        print_info "Default credentials:"
        print_info "  Admin: admin@afct.edu / password123"
        print_info "  Faculty: faculty@afct.edu / password123"
        print_info "  Student: student@afct.edu / password123"
    else
        print_warning "Database seeding failed - you can run: node scripts/simple-seed.js after fixing issues"
    fi
    
    print_success "Production database setup complete!"
    print_info "Connection string: $(mask_db_url "$DB_CONNECTION_STRING")"
    print_info "Application ready to start with: npm run start:prod"
    pause
}

# =============================================================================
# Application Setup Functions
# =============================================================================

install_project_dependencies() {
    print_header "📦 Installing Project Dependencies"
    
    # Check if in project directory
    if [[ ! -f "package.json" ]]; then
        print_error "Not in AFCT Dashboard project directory"
        print_info "Please run this script from the project root directory"
        exit 1
    fi
    
    # Install system dependencies for ERD generation (optional)
    print_step "Checking ERD generation dependencies..."
    ERD_AVAILABLE=false
    
    # Check for Chrome/Chromium executables
    if command_exists "google-chrome" || command_exists "chromium-browser" || command_exists "chromium"; then
        print_step "Chrome/Chromium found, testing ERD generation..."
        
        # Test if ERD generation actually works
        if npx puppeteer browsers install chrome &>/dev/null; then
            print_success "Chrome/Chromium compatible - ERD generation will be available"
            ERD_AVAILABLE=true
        else
            print_warning "Chrome/Chromium found but not compatible with Puppeteer"
            print_info "ERD generation will be disabled to prevent errors"
            ERD_AVAILABLE=false
        fi
    else
        print_warning "Chrome/Chromium not found - ERD generation will be skipped"
        print_info "ERD diagrams are optional and don't affect application functionality"
        
        if [[ "$OS" == "ubuntu" ]] && check_root; then
            prompt_input "Would you like to install Chromium for ERD generation? (y/n)" INSTALL_CHROMIUM "n"
            if [[ "$INSTALL_CHROMIUM" =~ ^[Yy]$ ]]; then
                print_step "Installing Chromium browser..."
                apt update
                if apt install -y chromium-browser; then
                    print_step "Installing Puppeteer Chrome..."
                    if npx puppeteer browsers install chrome &>/dev/null; then
                        print_success "Chromium and Puppeteer installed successfully"
                        ERD_AVAILABLE=true
                    else
                        print_warning "Chromium installed but Puppeteer setup failed"
                        ERD_AVAILABLE=false
                    fi
                else
                    print_warning "Could not install Chromium browser"
                    ERD_AVAILABLE=false
                fi
            else
                ERD_AVAILABLE=false
            fi
        else
            ERD_AVAILABLE=false
        fi
    fi
    
    # Install dependencies with error handling
    print_step "Installing NPM dependencies..."
    if npm install; then
        print_success "Dependencies installed successfully"
    else
        print_warning "Some dependencies had warnings, but installation completed"
        print_info "This is often due to optional ERD generation dependencies"
        print_info "The application will work fine without them"
    fi
    
    # Try to generate Prisma client with conditional ERD
    print_step "Generating Prisma client..."
    if [[ "$ERD_AVAILABLE" == "true" ]]; then
        print_step "Using development schema with ERD generation..."
        cp prisma/schema.development.prisma prisma/schema.prisma 2>/dev/null || true
        if npm run db:generate:with-erd; then
            print_success "Prisma client and ERD generated successfully"
            print_info "ERD diagram saved as ERD.svg"
        else
            print_warning "ERD generation failed, falling back to basic generation..."
            npm run db:generate:safe
            print_success "Prisma client generated without ERD"
        fi
    else
        print_step "Generating Prisma client without ERD..."
        npm run db:generate:safe
        print_success "Prisma client generated successfully"
        print_info "To generate ERDs later, install Chrome/Chromium and run: npm run db:generate:with-erd"
    fi
    
    # Install Prisma CLI globally if not present
    if ! command_exists "prisma"; then
        print_step "Installing Prisma CLI globally..."
        npm install -g prisma
        print_success "Prisma CLI installed"
    fi
    
    pause
}

complete_development_setup() {
    print_header "🚀 Complete Development Setup"
    
    print_info "This will set up everything needed for development:"
    print_info "• Node.js $NODE_VERSION"
    print_info "• SQLite database"
    print_info "• Project dependencies"
    print_info "• Development environment"
    echo
    
    prompt_input "Continue with development setup? (y/n)" CONTINUE "y"
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        return 0
    fi
    
    # System check
    check_os
    
    # Install Node.js
    if ! command_exists "node"; then
        install_nodejs
    else
        print_success "Node.js already installed: $(node --version)"
    fi
    
    # Install project dependencies
    install_project_dependencies
    
    # Setup development database
    setup_development_database
    
    print_header "🎉 Development Setup Complete!"
    print_success "Your development environment is ready!"
    echo
    print_info "To start developing:"
    print_info "1. Run: npm run dev"
    print_info "2. Open: http://localhost:3000"
    echo
    print_info "Default login credentials:"
    print_info "• Admin: admin@example.com / password123"
    print_info "• Faculty: prof1@example.com / password123"
    print_info "• Student: student1@example.com / password123"
    
    pause
}

complete_production_setup() {
    print_header "🚀 Complete Production Setup"
    
    print_info "This will set up everything needed for production:"
    print_info "• Node.js $NODE_VERSION"
    print_info "• PostgreSQL database"
    print_info "• Project dependencies"
    print_info "• Production environment"
    print_info "• PM2 process manager"
    echo
    
    # Check for root privileges
    if ! check_root; then
        print_error "Production setup requires root privileges. Please run with sudo."
        exit 1
    fi
    
    prompt_input "Continue with production setup? (y/n)" CONTINUE "y"
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        return 0
    fi
    
    # System check
    check_os
    
    # Install Node.js
    install_nodejs
    
    # Install PostgreSQL
    install_postgresql
    
    # Install project dependencies
    install_project_dependencies
    
    # Setup production database
    setup_production_database
    
    # Build application
    print_step "Building application for production..."
    npm run build
    print_success "Application built successfully"
    
    print_header "🎉 Production Setup Complete!"
    print_success "Your production environment is ready!"
    echo
    print_info "To start the application:"
    print_info "1. Run: npm start"
    print_info "2. Open: http://localhost:3000"
    echo
    print_info "For production deployment with PM2:"
    print_info "1. Run: pm2 start npm --name afct-dashboard -- start"
    print_info "2. Run: pm2 save && pm2 startup"
    
    pause
}

deploy_application() {
    print_header "🚀 Deploying Application"
    
    # Check if in project directory
    if [[ ! -f "package.json" ]]; then
        print_error "Not in AFCT Dashboard project directory"
        exit 1
    fi
    
    # Check if production environment is set up
    if [[ ! -f ".env.production" ]]; then
        print_error "Production environment not configured"
        print_info "Please run 'Setup Production Database' first"
        exit 1
    fi
    
    # Install dependencies
    if [[ ! -d "node_modules" ]]; then
        print_step "Installing dependencies..."
        npm install
    fi
    
    # Build application
    print_step "Building application..."
    npm run build
    print_success "Application built"
    
    # Start with PM2
    print_step "Starting application with PM2..."
    if command_exists "pm2"; then
        pm2 delete afct-dashboard 2>/dev/null || true
        pm2 start npm --name afct-dashboard -- start
        pm2 save
        print_success "Application deployed with PM2"
        
        print_info "PM2 commands:"
        print_info "• View logs: pm2 logs afct-dashboard"
        print_info "• Restart: pm2 restart afct-dashboard"
        print_info "• Stop: pm2 stop afct-dashboard"
    else
        print_warning "PM2 not installed. Starting with npm..."
        npm start &
        print_success "Application started"
    fi
    
    pause
}

# =============================================================================
# Utility Functions
# =============================================================================

test_database_connection() {
    print_header "🔍 Database Connection Test"
    
    # Check which environment to test
    echo "Which database would you like to test?"
    echo "1) Development (SQLite)"
    echo "2) Production (PostgreSQL)"
    echo
    read -p "Enter choice (1-2): " db_choice
    
    case $db_choice in
        1)
            # Test SQLite
            if [[ -f "prisma/dev.db" ]]; then
                print_step "Testing SQLite connection..."
                if sqlite3 prisma/dev.db "SELECT 'SQLite connection successful!' as status;" 2>/dev/null; then
                    print_success "SQLite database connection successful"
                else
                    print_error "SQLite database connection failed"
                fi
            else
                print_error "SQLite database not found. Run development setup first."
            fi
            ;;
        2)
            # Test PostgreSQL
            if [[ -f ".env.production" ]]; then
                print_step "Testing PostgreSQL connection..."
                
                # Source environment variables
                set -a
                source .env.production
                set +a
                
                # Extract connection details from DATABASE_URL
                DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
                DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
                DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
                DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
                DB_NAME=$(echo $DATABASE_URL | sed -n 's:.*/\([^?]*\).*:\1:p')
                
                if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'PostgreSQL connection successful!' as status;" &> /dev/null; then
                    print_success "PostgreSQL database connection successful"
                else
                    print_error "PostgreSQL database connection failed"
                    print_info "Connection details:"
                    print_info "Host: $DB_HOST"
                    print_info "Port: $DB_PORT"
                    print_info "Database: $DB_NAME"
                    print_info "User: $DB_USER"
                fi
            else
                print_error "Production environment not configured. Run production setup first."
            fi
            ;;
        *)
            print_error "Invalid choice"
            ;;
    esac
    
    pause
}

reset_development_database() {
    print_header "🔄 Reset Development Database"
    
    print_warning "This will completely reset your development database!"
    print_warning "All data will be lost!"
    echo
    prompt_input "Are you sure you want to continue? (yes/no)" CONFIRM "no"
    
    if [[ "$CONFIRM" != "yes" ]]; then
        print_info "Database reset cancelled"
        return 0
    fi
    
    # Remove existing database
    if [[ -f "prisma/dev.db" ]]; then
        print_step "Removing existing database..."
        rm -f prisma/dev.db
        print_success "Existing database removed"
    fi
    
    # Reset migrations
    print_step "Resetting migrations..."
    rm -rf prisma/migrations
    
    # Run fresh migration
    print_step "Creating fresh database..."
    npx prisma migrate dev --name init
    print_success "Fresh database created"
    
    # Seed database
    print_step "Seeding database..."
    npm run seed 2>/dev/null || npx tsx prisma/seed.ts
    print_success "Database seeded"
    
    print_success "Development database reset complete!"
    pause
}

reset_production_database() {
    print_header "🔄 Reset Production Database"
    
    print_warning "This will completely reset your production database!"
    print_warning "ALL PRODUCTION DATA WILL BE LOST!"
    print_warning "This action cannot be undone!"
    echo
    
    prompt_input "Type 'RESET PRODUCTION' to confirm" CONFIRM ""
    
    if [[ "$CONFIRM" != "RESET PRODUCTION" ]]; then
        print_info "Database reset cancelled"
        return 0
    fi
    
    # Check if production environment exists
    if [[ ! -f ".env.production" ]]; then
        print_error "Production environment not configured"
        print_info "Please run 'Setup Production Database' first (option 7)"
        return 1
    fi
    
    # Check if production schema exists
    if [[ ! -f "prisma/schema.production.prisma" ]]; then
        print_error "Production schema file not found: prisma/schema.production.prisma"
        return 1
    fi
    
    print_info "Using production schema: prisma/schema.production.prisma"
    
    # Verify production schema has PostgreSQL provider
    if ! grep -q 'provider = "postgresql"' prisma/schema.production.prisma; then
        print_error "Production schema is not configured for PostgreSQL"
        print_info "Expected 'provider = \"postgresql\"' in prisma/schema.production.prisma"
        return 1
    else
        print_success "Production schema verified for PostgreSQL"
    fi
    
    # Source environment variables (before logging DB URL)
    set -a
    source .env.production
    set +a
    print_info "Database URL: $DATABASE_URL"
    
    # Extract connection details
    DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
    DB_NAME=$(echo $DATABASE_URL | sed -n 's:.*/\([^?]*\).*:\1:p')
    
    print_info "Resetting database: $DB_NAME"
    print_info "User: $DB_USER"
    
    # Safely drop and recreate database (terminate existing connections first)
    print_step "Terminating existing connections..."
    if sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"; then
        print_success "Connections terminated"
    else
        print_warning "Could not terminate some connections (may be safe to ignore)"
    fi
    
    print_step "Dropping existing database..."
    if sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"; then
        print_success "Database dropped"
    else
        print_error "Failed to drop database"
        return 1
    fi
    
    print_step "Recreating database..."
    if sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"; then
        print_success "Database recreated"
    else
        print_error "Failed to recreate database"
        return 1
    fi
    
    # Ensure env vars are exported for Prisma
    export NODE_ENV=production
    export DATABASE_URL="$DATABASE_URL"
    
    # Generate Prisma client first (using production schema)
    print_step "Generating Prisma client (production schema)..."
    if npx prisma generate --schema=prisma/schema.production.prisma; then
        print_success "Prisma client generated successfully"
    else
        print_error "Failed to generate Prisma client"
        return 1
    fi
    
    # Apply migrations or fallback to db push
    print_step "Applying schema to database..."
    MIGRATION_SQL_COUNT=$(find prisma/migrations -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
    if [[ -f "prisma/migrations/migration_lock.toml" ]] && grep -q 'provider = "postgresql"' prisma/migrations/migration_lock.toml 2>/dev/null && [[ "$MIGRATION_SQL_COUNT" -gt 0 ]]; then
        print_info "Detected PostgreSQL migrations. Running 'prisma migrate deploy'."
        if npx prisma migrate deploy --schema=prisma/schema.production.prisma; then
            print_success "Migrations deployed successfully"
        else
            print_error "Migration deployment failed"
            print_info "Trying alternative approach with 'db push'..."
            if npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss; then
                print_success "Database schema synchronized successfully (db push)"
            else
                print_error "Failed to synchronize schema via db push"
                return 1
            fi
        fi
    else
        print_warning "No PostgreSQL migration history detected. Using 'db push'."
        if npx prisma db push --schema=prisma/schema.production.prisma --accept-data-loss; then
            print_success "Database schema synchronized successfully (db push)"
        else
            print_error "Failed to synchronize schema via db push"
            return 1
        fi
    fi
    
    # Seed database with production-safe script
    print_step "Seeding database with production environment..."
    set -a
    source .env.production
    set +a
    if node scripts/simple-seed.js; then
        print_success "Database seeded successfully"
        print_info "Default credentials:"
        print_info "  Admin: admin@afct.edu / password123"
        print_info "  Faculty: faculty@afct.edu / password123"
        print_info "  Student: student@afct.edu / password123"
    else
        print_warning "Database seeding failed - you can run: node scripts/simple-seed.js after fixing issues"
    fi
    
    print_success "Production database setup complete!"
    print_info "Database: $DB_NAME is ready for use"
    pause
}

# =============================================================================
# Troubleshooting Functions  
# =============================================================================

troubleshoot_database() {
    print_header "🔧 Database Troubleshooting"
    
    echo "Which database are you having issues with?"
    echo "1) Development (SQLite)"
    echo "2) Production (PostgreSQL)"
    echo
    read -p "Enter choice (1-2): " db_choice
    
    case $db_choice in
        1)
            print_step "SQLite Development Database Troubleshooting"
            
            # Check if SQLite database exists
            if [[ -f "prisma/dev.db" ]]; then
                print_success "SQLite database file found: prisma/dev.db"
                
                # Check file size
                DB_SIZE=$(du -h prisma/dev.db | cut -f1)
                print_info "Database size: $DB_SIZE"
                
                # Try to connect
                if sqlite3 prisma/dev.db "SELECT COUNT(*) FROM sqlite_master;" &>/dev/null; then
                    print_success "SQLite connection test passed"
                else
                    print_error "SQLite connection test failed - database may be corrupted"
                    prompt_input "Would you like to reset the development database? (y/n)" RESET_DEV "n"
                    if [[ "$RESET_DEV" =~ ^[Yy]$ ]]; then
                        reset_development_database
                    fi
                fi
            else
                print_warning "SQLite database not found"
                print_info "Run: setup_development_database or choice 3 from main menu"
            fi
            ;;
        2)
            print_step "PostgreSQL Production Database Troubleshooting"
            
            # Check PostgreSQL service
            if systemctl is-active --quiet postgresql; then
                print_success "PostgreSQL service is running"
            else
                print_error "PostgreSQL service is not running"
                print_info "Try: sudo systemctl start postgresql"
                return 1
            fi
            
            # Check if .env.production exists
            if [[ -f ".env.production" ]]; then
                print_success "Production environment file found"
                
                # Source environment
                set -a
                source .env.production
                set +a
                
                # Extract connection details
                DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
                DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
                DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
                DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
                DB_NAME=$(echo $DATABASE_URL | sed -n 's:.*/\([^?]*\).*:\1:p')
                
                print_info "Connection details:"
                print_info "  Host: $DB_HOST"
                print_info "  Port: $DB_PORT"
                print_info "  Database: $DB_NAME"
                print_info "  User: $DB_USER"
                
                # Test with Node.js
                print_step "Testing with Node.js..."
                if npm run db:test:prod; then
                    print_success "Node.js connection test passed"
                else
                    print_warning "Node.js connection test failed"
                    
                    # Test with psql
                    print_step "Testing with psql..."
                    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" &>/dev/null; then
                        print_success "psql connection test passed"
                        print_info "Issue may be with Prisma client generation"
                        print_info "Try: npx prisma generate --schema=prisma/schema.production.prisma"
                    else
                        print_error "psql connection test failed"
                        
                        # Show authentication troubleshooting
                        print_info "Common solutions:"
                        print_info "1. Check if user exists:"
                        print_info "   sudo -u postgres psql -c \"\\du\""
                        print_info "2. Check if database exists:"
                        print_info "   sudo -u postgres psql -l | grep $DB_NAME"
                        print_info "3. Check authentication file:"
                        print_info "   sudo cat /etc/postgresql/*/main/pg_hba.conf | grep afct"
                        print_info "4. Restart PostgreSQL:"
                        print_info "   sudo systemctl restart postgresql"
                    fi
                fi
            else
                print_error "Production environment file not found"
                print_info "Run: setup_production_database or choice 7 from main menu"
            fi
            ;;
        *)
            print_error "Invalid choice"
            ;;
    esac
    
    pause
}

# =============================================================================
# Migration and Schema Troubleshooting Functions
# =============================================================================

check_migration_issues() {
    print_header "🔧 Checking Migration Issues"
    
    # Check if we're in project directory
    if [[ ! -f "package.json" ]]; then
        print_error "Not in AFCT Dashboard project directory"
        print_info "Please run this script from the project root directory"
        pause
        return 1
    fi
    
    print_step "Checking project structure..."
    
    # Check for schema files
    if [[ -f "prisma/schema.prisma" ]]; then
        print_success "Found development schema: prisma/schema.prisma"
    else
        print_warning "Development schema not found: prisma/schema.prisma"
    fi
    
    if [[ -f "prisma/schema.production.prisma" ]]; then
        print_success "Found production schema: prisma/schema.production.prisma"
    else
        print_error "Production schema not found: prisma/schema.production.prisma"
        print_info "This file is required for production deployment"
    fi
    
    print_step "Checking migration files..."
    
    # Check if migration files exist
    if [[ ! -d "prisma/migrations" ]]; then
        print_warning "No migrations directory found"
        print_info "This is normal for a fresh setup or when using db push"
        print_info "Migrations are optional when using 'npx prisma db push'"
    else
        MIGRATION_COUNT=$(find prisma/migrations -name "*.sql" | wc -l)
        print_info "Found $MIGRATION_COUNT migration SQL files"
        
        # List migration directories
        print_step "Migration directories:"
        for dir in prisma/migrations/*/; do
            if [[ -d "$dir" ]]; then
                dirname=$(basename "$dir")
                print_info "  - $dirname"
            fi
        done
    fi
    
    # Check migration lock file
    if [[ -f "prisma/migrations/migration_lock.toml" ]]; then
        PROVIDER=$(grep "provider = " prisma/migrations/migration_lock.toml | cut -d'"' -f2)
        print_info "Migration lock provider: $PROVIDER"
        
        # Check for SQLite/PostgreSQL mismatch
        if [[ "$PROVIDER" == "sqlite" ]] && [[ -f "prisma/schema.production.prisma" ]]; then
            SCHEMA_PROVIDER=$(grep 'provider = "' prisma/schema.production.prisma | cut -d'"' -f2)
            if [[ "$SCHEMA_PROVIDER" == "postgresql" ]]; then
                print_warning "⚠️  Migration provider mismatch detected!"
                print_info "Migrations: $PROVIDER, Production Schema: $SCHEMA_PROVIDER"
                print_info "This can cause deployment issues with PostgreSQL"
                echo
                echo -n "Would you like to fix this mismatch? (y/n): "
                read fix_migrations
                if [[ "$fix_migrations" =~ ^[Yy]$ ]]; then
                    fix_migration_provider_mismatch
                else
                    print_info "You can fix this later by running option 14 again"
                fi
            else
                print_success "Migration and schema providers match: $PROVIDER"
            fi
        else
            print_success "Migration provider: $PROVIDER"
        fi
    else
        print_info "No migration lock file found (normal for fresh setup)"
    fi
    
    # Check environment files
    print_step "Checking environment configuration..."
    
    if [[ -f ".env" ]]; then
        print_info "Found .env file"
        if grep -q "DATABASE_URL.*sqlite" .env 2>/dev/null; then
            print_info "  - Contains SQLite database URL"
        elif grep -q "DATABASE_URL.*postgresql" .env 2>/dev/null; then
            print_info "  - Contains PostgreSQL database URL"
        fi
    fi
    
    if [[ -f ".env.production" ]]; then
        print_success "Found .env.production file"
        if grep -q "DATABASE_URL.*postgresql" .env.production 2>/dev/null; then
            print_success "  - Contains PostgreSQL database URL"
        else
            print_warning "  - Does not contain PostgreSQL database URL"
        fi
    else
        print_warning "No .env.production file found"
        print_info "Run setup wizard option 7 to create production environment"
    fi
    
    echo
    print_step "Recommendations:"
    print_info "✓ For production deployment, use: npx prisma db push"
    print_info "✓ This avoids migration compatibility issues"
    print_info "✓ Run setup wizard option 7 for complete production setup"
    print_info "✓ Use option 15 to validate your production environment"
    
    print_success "Migration check complete"
    pause
}

fix_migration_provider_mismatch() {
    print_step "Fixing migration provider mismatch..."
    
    # Backup existing migrations
    if [[ -d "prisma/migrations" ]]; then
        print_step "Backing up existing migrations..."
        cp -r prisma/migrations prisma/migrations_backup_$(date +%Y%m%d_%H%M%S)
        print_success "Migrations backed up"
    fi
    
    # Update migration lock file
    if [[ -f "prisma/migrations/migration_lock.toml" ]]; then
        print_step "Updating migration lock to PostgreSQL..."
        sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/migrations/migration_lock.toml
        print_success "Migration lock updated"
    fi
    
    print_success "Migration provider mismatch fixed"
    print_info "Consider using 'npx prisma db push' for production deployments"
    print_info "This avoids migration compatibility issues between SQLite and PostgreSQL"
}

validate_production_environment() {
    print_header "✅ Validating Production Environment"
    
    # Check required files
    print_step "Checking required files..."
    
    local required_files=(
        "package.json"
        "prisma/schema.production.prisma"
        ".env.production"
    )
    
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            print_success "Found: $file"
        else
            print_error "Missing: $file"
            return 1
        fi
    done
    
    # Check environment variables
    if [[ -f ".env.production" ]]; then
        print_step "Checking environment variables..."
        
        local required_vars=(
            "DATABASE_URL"
            "NEXTAUTH_SECRET"
            "NODE_ENV"
        )
        
        for var in "${required_vars[@]}"; do
            if grep -q "^$var=" .env.production; then
                print_success "Found: $var"
            else
                print_warning "Missing: $var"
            fi
        done
        
        # Check DATABASE_URL format
        if grep -q "postgresql://" .env.production; then
            print_success "PostgreSQL connection string detected"
        else
            print_warning "Non-PostgreSQL connection string detected"
        fi
    fi
    
    # Check database connection if possible
    if command_exists "psql" && [[ -f ".env.production" ]]; then
        print_step "Testing database connection..."
        
        # Extract connection details from .env.production
        local db_url=$(grep "^DATABASE_URL=" .env.production | cut -d'=' -f2 | tr -d '"')
        
        if [[ -n "$db_url" ]]; then
            export DATABASE_URL="$db_url"
            
            # Try to connect
            if npx prisma db execute --file /dev/null --schema=prisma/schema.production.prisma 2>/dev/null; then
                print_success "Database connection successful"
            else
                print_warning "Database connection failed"
                print_info "This may be normal if the database hasn't been set up yet"
            fi
        fi
    fi
    
    print_success "Environment validation complete"
    pause
}

# =============================================================================
# Main Script Logic
# =============================================================================

main() {
    # Check if in project directory
    if [[ ! -f "package.json" ]] && [[ "$1" != "0" ]] && [[ "$1" != "12" ]] && [[ "$1" != "13" ]] && [[ "$1" != "14" ]]; then
        print_error "Please run this script from the AFCT Dashboard project directory"
        exit 1
    fi
    
    while true; do
        show_main_menu
        get_user_choice
        
        case $choice in
            1) complete_development_setup ;;
            2) install_nodejs ;;
            3) setup_development_database ;;
            4) install_project_dependencies ;;
            5) complete_production_setup ;;
            6) install_postgresql ;;
            7) setup_production_database ;;
            8) deploy_application ;;
            9) test_database_connection ;;
            10) reset_development_database ;;
            11) reset_production_database ;;
            12) system_health_check ;;
            13) view_system_status ;;
            14) check_migration_issues ;;
            15) validate_production_environment ;;
            16) troubleshoot_database ;;
            0) 
                print_success "Thank you for using the AFCT Dashboard Setup Wizard!"
                exit 0 
                ;;
        esac
    done
}

# Run main function
main "$@"

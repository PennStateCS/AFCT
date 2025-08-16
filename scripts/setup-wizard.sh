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
    echo " 14) Database Troubleshooting"
    echo
    echo " 0) Exit"
    echo
}

get_user_choice() {
    while true; do
        echo -n "Enter your choice (0-14): "
        read choice
        case $choice in
            [0-9]|1[0-4]) return 0 ;;
            *) print_error "Invalid choice. Please enter a number between 0 and 14." ;;
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
    
    # Create .env.local if it doesn't exist
    if [[ ! -f ".env.local" ]]; then
        cp .env.example .env.local
        print_success "Created .env.local file"
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
    
    # Set postgres superuser password
    print_step "Setting PostgreSQL superuser password..."
    prompt_password "Enter password for PostgreSQL superuser (postgres)" POSTGRES_PASSWORD
    sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
    print_success "PostgreSQL superuser password set"
    
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
    
    # Configure authentication
    print_step "Configuring authentication..."
    PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | head -n1 | awk '{print $2}' | cut -d. -f1)
    PG_HBA_FILE="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
    
    # Backup original file
    cp "$PG_HBA_FILE" "$PG_HBA_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Add authentication rules if not already present
    if ! grep -q "# AFCT Dashboard Rules" "$PG_HBA_FILE"; then
        cat >> "$PG_HBA_FILE" << EOF

# AFCT Dashboard Rules - Added $(date)
local   $DB_NAME_PROD        $DB_USER_PROD                                md5
host    $DB_NAME_PROD        $DB_USER_PROD        127.0.0.1/32            md5
host    $DB_NAME_PROD        $DB_USER_PROD        ::1/128                 md5
EOF
        print_success "Authentication rules added"
    else
        print_info "Authentication rules already configured"
    fi
    
    # Restart PostgreSQL
    print_step "Restarting PostgreSQL..."
    systemctl restart postgresql
    print_success "PostgreSQL restarted"
    
    # Wait a moment for service to be ready
    sleep 2
    
    # Create production environment file
    print_step "Creating production environment file..."
    DB_CONNECTION_STRING="postgresql://$DB_USER_PROD:$DB_PASSWORD_PROD@localhost:5432/$DB_NAME_PROD"
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
    
    # Generate Prisma client for production
    print_step "Generating Prisma client for production..."
    if npx prisma generate --schema=prisma/schema.production.prisma; then
        print_success "Prisma client generated successfully"
    else
        print_warning "Prisma generation failed, trying fallback..."
        # Use the safe generate script from package.json
        npm run db:generate:safe
    fi
    
    # Test connection with proper environment
    print_step "Testing database connection..."
    export DATABASE_URL="$DB_CONNECTION_STRING"
    
    # Try the Node.js test script first (more detailed)
    if npm run db:test:prod; then
        print_success "Database connection test passed"
    elif PGPASSWORD="$DB_PASSWORD_PROD" psql -h localhost -U "$DB_USER_PROD" -d "$DB_NAME_PROD" -c "SELECT 'Connection successful!' as status;" &> /dev/null; then
        print_success "Database connection test passed (using psql)"
    else
        print_warning "Database connection test failed"
        print_info "This may be due to authentication configuration."
        print_info "Common solutions:"
        print_info "  1. Check PostgreSQL service: sudo systemctl status postgresql"
        print_info "  2. Verify user permissions: sudo -u postgres psql -c '\\du'"
        print_info "  3. Check pg_hba.conf authentication rules"
        print_info "Continuing with setup - you may need to adjust configuration manually"
    fi
    
    # Apply migrations with proper schema
    print_step "Applying database migrations..."
    if npx prisma migrate deploy --schema=prisma/schema.production.prisma; then
        print_success "Database migrations applied"
    else
        print_error "Migration failed. Please check database connection and try again."
        print_info "You can manually run: npx prisma migrate deploy --schema=prisma/schema.production.prisma"
    fi
    
    # Seed database
    print_step "Seeding database with sample data..."
    npm run seed 2>/dev/null || npx tsx prisma/seed.ts
    print_success "Database seeded with sample data"
    
    print_success "Production database setup complete!"
    print_info "Connection string: $DB_CONNECTION_STRING"
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
                DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
                
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
    
    # Source environment variables
    set -a
    source .env.production
    set +a
    
    # Extract connection details
    DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
    DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
    
    print_info "Resetting database: $DB_NAME"
    print_info "User: $DB_USER"
    
    # Drop and recreate database
    print_step "Dropping existing database..."
    if sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;"; then
        print_success "Database dropped"
    else
        print_error "Failed to drop database"
        return 1
    fi
    
    print_step "Recreating database..."
    if sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"; then
        print_success "Database recreated"
    else
        print_error "Failed to recreate database"
        return 1
    fi
    
    # Apply migrations with production schema
    print_step "Applying migrations..."
    if npx prisma migrate deploy --schema=prisma/schema.production.prisma; then
        print_success "Migrations applied successfully"
    else
        print_error "Migration failed - check database connection"
        return 1
    fi
    
    # Seed database with production environment
    print_step "Seeding database..."
    if NODE_ENV=production npm run seed 2>/dev/null || NODE_ENV=production npx tsx prisma/seed.ts; then
        print_success "Database seeded successfully"
    else
        print_warning "Database seeding failed - continuing anyway"
    fi
    
    print_success "Production database reset complete!"
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
                DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
                
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
            14) troubleshoot_database ;;
            0) 
                print_success "Thank you for using the AFCT Dashboard Setup Wizard!"
                exit 0 
                ;;
        esac
    done
}

# Run main function
main "$@"

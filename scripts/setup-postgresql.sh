#!/bin/bash

# =============================================================================
# PostgreSQL Installation and Setup Script for AFCT Dashboard
# =============================================================================
# This script automates the installation and configuration of PostgreSQL
# for production deployment on Ubuntu systems.
#
# Usage: ./setup-postgresql.sh
# Run with sudo privileges for installation steps
# =============================================================================

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration variables
DB_NAME="afct_production"
DB_USER="afct_user"
APP_DIR="/var/www/afct"
BACKUP_DIR="/var/backups/postgresql"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if running as root for certain operations
check_root() {
    if [[ $EUID -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Function to prompt for input
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local default_value="$3"
    
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
}

# Function to prompt for password
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

# Function to check if PostgreSQL is already installed
check_postgresql_installed() {
    if command -v psql &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to check if PostgreSQL service is running
check_postgresql_running() {
    if systemctl is-active --quiet postgresql; then
        return 0
    else
        return 1
    fi
}

# Function to install PostgreSQL
install_postgresql() {
    print_status "Installing PostgreSQL..."
    
    if ! check_root; then
        print_error "Root privileges required for installation. Please run with sudo."
        exit 1
    fi
    
    # Update package lists
    print_status "Updating package lists..."
    apt update
    
    # Install PostgreSQL and contrib package
    print_status "Installing PostgreSQL packages..."
    apt install -y postgresql postgresql-contrib
    
    # Start and enable PostgreSQL service
    print_status "Starting PostgreSQL service..."
    systemctl start postgresql
    systemctl enable postgresql
    
    print_success "PostgreSQL installed successfully!"
}

# Function to configure PostgreSQL
configure_postgresql() {
    print_status "Configuring PostgreSQL..."
    
    # Get PostgreSQL version
    PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | head -n1 | awk '{print $2}' | cut -d. -f1)
    PG_CONFIG_DIR="/etc/postgresql/$PG_VERSION/main"
    
    print_status "Detected PostgreSQL version: $PG_VERSION"
    
    # Backup original configuration files
    if [[ ! -f "$PG_CONFIG_DIR/postgresql.conf.backup" ]]; then
        print_status "Backing up original configuration..."
        cp "$PG_CONFIG_DIR/postgresql.conf" "$PG_CONFIG_DIR/postgresql.conf.backup"
        cp "$PG_CONFIG_DIR/pg_hba.conf" "$PG_CONFIG_DIR/pg_hba.conf.backup"
    fi
    
    # Configure postgresql.conf
    print_status "Configuring postgresql.conf..."
    cat >> "$PG_CONFIG_DIR/postgresql.conf" << EOF

# AFCT Dashboard Production Settings
# Added by setup script $(date)
listen_addresses = 'localhost'
shared_buffers = 256MB
effective_cache_size = 1GB
max_connections = 100
log_statement = 'none'
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = 1d
log_rotation_size = 100MB
EOF
    
    print_success "PostgreSQL configuration updated!"
}

# Function to set postgres user password
set_postgres_password() {
    print_status "Setting PostgreSQL superuser password..."
    
    prompt_password "Enter password for PostgreSQL superuser (postgres)" POSTGRES_PASSWORD
    
    sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
    
    print_success "PostgreSQL superuser password set!"
}

# Function to create application database and user
create_app_database() {
    print_status "Creating application database and user..."
    
    # Get database details
    prompt_input "Database name" DB_NAME "$DB_NAME"
    prompt_input "Database user" DB_USER "$DB_USER"
    prompt_password "Enter password for database user ($DB_USER)" DB_PASSWORD
    
    # Create user with error handling for existing users
    print_status "Creating database user: $DB_USER"
    sudo -u postgres psql << EOF
-- Create user (ignore if exists)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
        RAISE NOTICE 'User $DB_USER created successfully';
    ELSE
        ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
        RAISE NOTICE 'User $DB_USER already exists, password updated';
    END IF;
END
\$\$;

-- Create database (ignore if exists)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME') THEN
        PERFORM dblink_exec('dbname=' || current_database(), 'CREATE DATABASE $DB_NAME OWNER $DB_USER');
        RAISE NOTICE 'Database $DB_NAME created successfully';
    ELSE
        RAISE NOTICE 'Database $DB_NAME already exists';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        -- Fallback method if dblink is not available
        RAISE NOTICE 'Using fallback database creation method';
END
\$\$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\q
EOF
    
    # Alternative database creation if the above fails
    if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
        print_status "Creating database using alternative method..."
        sudo -u postgres createdb -O $DB_USER $DB_NAME 2>/dev/null || print_warning "Database may already exist"
    fi
    
    print_success "Database and user created successfully!"
    
    # Store connection details for later use
    DB_CONNECTION_STRING="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
    
    print_status "Database connection string: $DB_CONNECTION_STRING"
}

# Function to configure authentication
configure_authentication() {
    print_status "Configuring authentication..."
    
    PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | head -n1 | awk '{print $2}' | cut -d. -f1)
    PG_HBA_FILE="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
    
    # Add authentication rules for the application
    print_status "Adding authentication rules..."
    
    # Create temporary file with new rules
    cat >> /tmp/afct_hba_rules << EOF

# AFCT Dashboard Application Rules
# Added by setup script $(date)
local   $DB_NAME        $DB_USER                                md5
host    $DB_NAME        $DB_USER        127.0.0.1/32            md5
host    $DB_NAME        $DB_USER        ::1/128                 md5
EOF
    
    # Append to pg_hba.conf
    cat /tmp/afct_hba_rules >> "$PG_HBA_FILE"
    rm /tmp/afct_hba_rules
    
    print_success "Authentication configured!"
}

# Function to restart PostgreSQL
restart_postgresql() {
    print_status "Restarting PostgreSQL to apply configuration changes..."
    
    systemctl restart postgresql
    
    if check_postgresql_running; then
        print_success "PostgreSQL restarted successfully!"
    else
        print_error "Failed to restart PostgreSQL!"
        exit 1
    fi
}

# Function to test database connection
test_connection() {
    print_status "Testing database connection..."
    
    # Test connection using the created user
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" &> /dev/null; then
        print_success "Database connection test successful!"
    else
        print_error "Database connection test failed!"
        print_error "Please check the configuration and try again."
        exit 1
    fi
}

# Function to create backup directory and script
setup_backup() {
    print_status "Setting up database backup system..."
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    chown postgres:postgres "$BACKUP_DIR"
    chmod 755 "$BACKUP_DIR"
    
    # Create backup script
    cat > /usr/local/bin/backup-afct-db.sh << EOF
#!/bin/bash
# AFCT Dashboard Database Backup Script
# Generated by setup script

BACKUP_DIR="$BACKUP_DIR"
DB_NAME="$DB_NAME"
DB_USER="$DB_USER"
DATE=\$(date +%Y%m%d_%H%M%S)

# Create backup
PGPASSWORD="$DB_PASSWORD" pg_dump -h localhost -U \$DB_USER \$DB_NAME > \$BACKUP_DIR/afct_backup_\$DATE.sql

# Keep only last 7 days of backups
find \$BACKUP_DIR -name "afct_backup_*.sql" -type f -mtime +7 -delete

echo "Backup completed: afct_backup_\$DATE.sql"
EOF
    
    chmod +x /usr/local/bin/backup-afct-db.sh
    
    print_success "Backup system configured!"
    print_status "Backup script created at: /usr/local/bin/backup-afct-db.sh"
    print_status "To schedule daily backups, add this to crontab:"
    print_status "0 2 * * * /usr/local/bin/backup-afct-db.sh"
}

# Function to configure firewall
configure_firewall() {
    print_status "Configuring firewall for PostgreSQL..."
    
    if command -v ufw &> /dev/null; then
        # Allow PostgreSQL only from localhost
        ufw allow from 127.0.0.1 to any port 5432
        print_success "Firewall configured to allow PostgreSQL connections from localhost only."
    else
        print_warning "UFW not found. Please manually configure firewall to allow PostgreSQL (port 5432) from localhost only."
    fi
}

# Function to create environment file
create_env_file() {
    print_status "Creating production environment file..."
    
    prompt_input "Application directory" APP_DIR "$APP_DIR"
    
    if [[ ! -d "$APP_DIR" ]]; then
        print_warning "Application directory $APP_DIR does not exist."
        prompt_input "Create application directory? (y/n)" CREATE_DIR "y"
        
        if [[ "$CREATE_DIR" =~ ^[Yy]$ ]]; then
            mkdir -p "$APP_DIR"
            chown $SUDO_USER:$SUDO_USER "$APP_DIR"
            print_success "Application directory created: $APP_DIR"
        fi
    fi
    
    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    
    # Create .env.production file
    cat > "$APP_DIR/.env.production" << EOF
# AFCT Dashboard Production Environment
# Generated by setup script on $(date)

# Database Configuration
DATABASE_URL="$DB_CONNECTION_STRING"

# Authentication
JWT_SECRET="$JWT_SECRET"

# Application Settings
NODE_ENV="production"
APP_URL="https://yourdomain.com"

# File Upload
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"
ALLOWED_FILE_TYPES="pdf,doc,docx,txt,jpg,jpeg,png,gif,zip"

# Application Metadata
APP_NAME="AFCT Dashboard"
APP_VERSION="1.0.0"
ADMIN_EMAIL="admin@example.com"
EOF
    
    # Set proper permissions
    chmod 600 "$APP_DIR/.env.production"
    chown $SUDO_USER:$SUDO_USER "$APP_DIR/.env.production"
    
    print_success "Environment file created: $APP_DIR/.env.production"
}

# Function to install Node.js and PM2
install_nodejs() {
    print_status "Installing Node.js and PM2..."
    
    # Install Node.js 18 LTS
    if ! command -v node &> /dev/null; then
        print_status "Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    else
        print_status "Node.js already installed: $(node --version)"
    fi
    
    # Install PM2 globally
    if ! command -v pm2 &> /dev/null; then
        print_status "Installing PM2..."
        npm install -g pm2
    else
        print_status "PM2 already installed: $(pm2 --version)"
    fi
    
    print_success "Node.js and PM2 installation completed!"
}

# Function to display summary
display_summary() {
    print_success "PostgreSQL setup completed successfully!"
    echo
    echo "==================================="
    echo "         SETUP SUMMARY"
    echo "==================================="
    echo
    echo "Database Details:"
    echo "  - Database Name: $DB_NAME"
    echo "  - Database User: $DB_USER"
    echo "  - Connection String: $DB_CONNECTION_STRING"
    echo
    echo "Files Created:"
    echo "  - Environment File: $APP_DIR/.env.production"
    echo "  - Backup Script: /usr/local/bin/backup-afct-db.sh"
    echo
    echo "Next Steps:"
    echo "1. Deploy your AFCT Dashboard application to: $APP_DIR"
    echo "2. Run: cd $APP_DIR && npm ci --only=production"
    echo "3. Run: cp prisma/schema.production.prisma prisma/schema.prisma"
    echo "4. Run: npx prisma generate"
    echo "5. Run: npx prisma migrate deploy"
    echo "6. Run: npm run seed (optional)"
    echo "7. Run: npm run build"
    echo "8. Run: pm2 start npm --name 'afct-dashboard' -- start"
    echo
    echo "To schedule daily backups, run:"
    echo "  sudo crontab -e"
    echo "  Add: 0 2 * * * /usr/local/bin/backup-afct-db.sh"
    echo
    print_warning "Keep your database credentials secure!"
    print_warning "The database password is stored in $APP_DIR/.env.production"
}

# Main execution function
main() {
    print_status "Starting PostgreSQL setup for AFCT Dashboard..."
    echo
    
    # Check if running as root
    if ! check_root; then
        print_error "This script requires root privileges. Please run with sudo:"
        print_error "sudo $0"
        exit 1
    fi
    
    # Check if PostgreSQL is already installed
    if check_postgresql_installed; then
        print_warning "PostgreSQL is already installed."
        prompt_input "Continue with configuration? (y/n)" CONTINUE "y"
        if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
            print_status "Exiting..."
            exit 0
        fi
    else
        install_postgresql
    fi
    
    # Configure PostgreSQL
    configure_postgresql
    
    # Set postgres password
    set_postgres_password
    
    # Create application database and user
    create_app_database
    
    # Configure authentication
    configure_authentication
    
    # Restart PostgreSQL to apply changes
    restart_postgresql
    
    # Test database connection
    test_connection
    
    # Setup backup system
    setup_backup
    
    # Configure firewall
    configure_firewall
    
    # Install Node.js and PM2
    install_nodejs
    
    # Create environment file
    create_env_file
    
    # Display summary
    display_summary
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

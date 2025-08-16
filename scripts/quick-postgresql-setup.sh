#!/bin/bash

# =============================================================================
# Quick PostgreSQL Setup for AFCT Dashboard
# =============================================================================
# A streamlined script for setting up PostgreSQL for AFCT Dashboard
# 
# Usage: ./quick-postgresql-setup.sh
# =============================================================================

set -e

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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

# Default values
DB_NAME="afct_production"
DB_USER="afct_user"
DB_PASSWORD=""

echo "=============================================="
echo "🐘 PostgreSQL Setup for AFCT Dashboard"
echo "=============================================="
echo

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run as root (use sudo)"
    exit 1
fi

# Step 1: Install PostgreSQL
print_step "Installing PostgreSQL..."
apt update
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql
print_success "PostgreSQL installed and started"

# Step 2: Set passwords
print_step "Setting up database credentials..."

# Set postgres superuser password
echo "Enter password for PostgreSQL superuser (postgres):"
read -s POSTGRES_PASSWORD
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
print_success "Postgres superuser password set"

# Get application database password
echo "Enter password for AFCT database user ($DB_USER):"
read -s DB_PASSWORD

# Step 3: Create application database and user
print_step "Creating application database and user..."
sudo -u postgres psql << EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\q
EOF
print_success "Database '$DB_NAME' and user '$DB_USER' created"

# Step 4: Configure authentication
print_step "Configuring authentication..."
PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | head -n1 | awk '{print $2}' | cut -d. -f1)
PG_HBA_FILE="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"

# Backup original file
cp "$PG_HBA_FILE" "$PG_HBA_FILE.backup"

# Add authentication rules
cat >> "$PG_HBA_FILE" << EOF

# AFCT Dashboard Rules - Added $(date)
local   $DB_NAME        $DB_USER                                md5
host    $DB_NAME        $DB_USER        127.0.0.1/32            md5
host    $DB_NAME        $DB_USER        ::1/128                 md5
EOF

print_success "Authentication configured"

# Step 5: Restart PostgreSQL
print_step "Restarting PostgreSQL..."
systemctl restart postgresql
print_success "PostgreSQL restarted"

# Step 6: Test connection
print_step "Testing database connection..."
if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'Connection successful!' as status;" &> /dev/null; then
    print_success "Database connection test passed"
else
    print_error "Database connection test failed"
    exit 1
fi

# Step 7: Create environment file template
print_step "Creating environment file template..."
cat > /tmp/env.production.template << EOF
# AFCT Dashboard Production Environment
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
JWT_SECRET="$(openssl rand -base64 32)"
NODE_ENV="production"
APP_URL="https://your-domain.com"
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"
EOF

print_success "Environment template created at /tmp/env.production.template"

# Step 8: Configure firewall (if UFW is available)
if command -v ufw &> /dev/null; then
    print_step "Configuring firewall..."
    ufw allow from 127.0.0.1 to any port 5432
    print_success "Firewall configured"
fi

# Display summary
echo
echo "=============================================="
echo "🎉 PostgreSQL Setup Complete!"
echo "=============================================="
echo
echo "Database Details:"
echo "  Name: $DB_NAME"
echo "  User: $DB_USER"
echo "  Connection: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo
echo "Next Steps for AFCT Dashboard:"
echo "1. Copy the environment template to your app directory:"
echo "   cp /tmp/env.production.template /path/to/afct/.env.production"
echo
echo "2. In your AFCT project directory, run:"
echo "   cp prisma/schema.production.prisma prisma/schema.prisma"
echo "   npx prisma generate"
echo "   npx prisma migrate deploy"
echo "   npm run build"
echo
echo "3. Test the connection:"
echo "   npx prisma db pull"
echo
print_warning "Keep your database credentials secure!"
echo

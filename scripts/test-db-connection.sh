#!/bin/bash

# =============================================================================
# Database Connection Test Script for AFCT Dashboard
# =============================================================================
# This script helps test and troubleshoot PostgreSQL connections
# =============================================================================

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

# Default connection parameters
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="afct_production"
DB_USER="afct_user"

echo "=============================================="
echo "🔍 PostgreSQL Connection Test"
echo "=============================================="
echo

# Get connection details
read -p "Database host [$DB_HOST]: " input_host
DB_HOST=${input_host:-$DB_HOST}

read -p "Database port [$DB_PORT]: " input_port
DB_PORT=${input_port:-$DB_PORT}

read -p "Database name [$DB_NAME]: " input_name
DB_NAME=${input_name:-$DB_NAME}

read -p "Database user [$DB_USER]: " input_user
DB_USER=${input_user:-$DB_USER}

read -s -p "Database password: " DB_PASSWORD
echo

echo
print_step "Testing connection with parameters:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo

# Test 1: Check if PostgreSQL is running
print_step "Checking if PostgreSQL service is running..."
if systemctl is-active --quiet postgresql; then
    print_success "PostgreSQL service is running"
else
    print_error "PostgreSQL service is not running"
    echo "Try: sudo systemctl start postgresql"
    exit 1
fi

# Test 2: Check if port is listening
print_step "Checking if PostgreSQL is listening on port $DB_PORT..."
if netstat -tln | grep ":$DB_PORT " > /dev/null; then
    print_success "PostgreSQL is listening on port $DB_PORT"
else
    print_error "PostgreSQL is not listening on port $DB_PORT"
    echo "Check PostgreSQL configuration in /etc/postgresql/*/main/postgresql.conf"
    exit 1
fi

# Test 3: Test basic psql connection
print_step "Testing psql connection..."
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
    print_success "Direct psql connection successful"
else
    print_error "Direct psql connection failed"
    echo "Check your credentials and pg_hba.conf configuration"
fi

# Test 4: Test with URL format (avoiding shell issues)
print_step "Testing URL format connection..."

# Create a temporary file with the connection string
TEMP_ENV_FILE=$(mktemp)
echo "DATABASE_URL=\"postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME\"" > "$TEMP_ENV_FILE"

# Source the file and test
if source "$TEMP_ENV_FILE" && echo "SELECT 'URL connection works!' as test;" | PGPASSWORD="$DB_PASSWORD" psql "$DATABASE_URL" &> /dev/null; then
    print_success "URL format connection successful"
    echo "Working connection string: postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
else
    print_error "URL format connection failed"
fi

# Clean up
rm "$TEMP_ENV_FILE"

# Test 5: Check Prisma connection (if in project directory)
if [[ -f "prisma/schema.prisma" ]]; then
    print_step "Testing Prisma connection..."
    
    # Check if production schema exists
    if [[ -f "prisma/schema.production.prisma" ]]; then
        print_step "Switching to production schema..."
        cp prisma/schema.production.prisma prisma/schema.prisma
        print_success "Switched to production schema"
    fi
    
    # Test with environment variable
    export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
    
    if npx prisma db pull &> /dev/null; then
        print_success "Prisma connection successful"
    else
        print_error "Prisma connection failed"
        echo "Try running: npx prisma generate"
    fi
else
    print_warning "Not in a Prisma project directory - skipping Prisma test"
fi

# Test 6: URL encoding test (for special characters)
print_step "Testing URL-encoded password..."
ENCODED_PASSWORD=$(printf '%s\n' "$DB_PASSWORD" | jq -sRr @uri)
ENCODED_URL="postgresql://$DB_USER:$ENCODED_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"

if echo "SELECT 'Encoded URL works!' as test;" | psql "$ENCODED_URL" &> /dev/null; then
    print_success "URL-encoded connection successful"
    echo "URL-encoded connection string: $ENCODED_URL"
else
    print_warning "URL-encoded connection failed"
fi

echo
echo "=============================================="
echo "🔧 Troubleshooting Tips"
echo "=============================================="
echo
echo "If connections are failing, check:"
echo
echo "1. PostgreSQL service:"
echo "   sudo systemctl status postgresql"
echo
echo "2. Configuration files:"
echo "   /etc/postgresql/*/main/postgresql.conf"
echo "   /etc/postgresql/*/main/pg_hba.conf"
echo
echo "3. Firewall settings:"
echo "   sudo ufw status"
echo
echo "4. PostgreSQL logs:"
echo "   sudo tail -f /var/log/postgresql/postgresql-*.log"
echo
echo "5. If password has special characters, try URL encoding:"
echo "   Use tools like: https://www.urlencoder.org/"
echo
echo "6. For Prisma issues:"
echo "   - Ensure you're using the production schema"
echo "   - Run: npx prisma generate"
echo "   - Check your .env.production file"
echo

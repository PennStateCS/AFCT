#!/usr/bin/env bash
# =============================================================================
# AFCT Dashboard - Quick Setup Examples
# =============================================================================
# This script demonstrates common setup scenarios using the setup wizard
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WIZARD_SCRIPT="$SCRIPT_DIR/setup-wizard.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
  echo -e "${BLUE}"
  echo "=================================="
  echo "  AFCT Dashboard Quick Setup"
  echo "=================================="
  echo -e "${NC}"
}

print_scenario() {
  local title="$1"
  local description="$2"
  echo -e "${GREEN}📋 Scenario: $title${NC}"
  echo -e "${YELLOW}   $description${NC}"
  echo
}

run_wizard_sequence() {
  local scenario="$1"
  shift
  local steps=("$@")
  
  echo -e "${BLUE}🚀 Running automated setup for: $scenario${NC}"
  echo -e "${YELLOW}Steps to be executed:${NC}"
  
  for step in "${steps[@]}"; do
    echo -e "   • $step"
  done
  
  echo
  read -p "Press Enter to continue or Ctrl+C to cancel..."
  
  # Note: In a real automated scenario, you would use expect or similar
  # to automate the wizard interactions. For now, we'll launch the wizard
  # and let the user follow the steps manually.
  
  echo -e "${GREEN}🎯 Please follow these menu selections in the wizard:${NC}"
  for i in "${!steps[@]}"; do
    echo -e "   ${BLUE}Step $((i+1)):${NC} ${steps[i]}"
  done
  echo
  
  exec "$WIZARD_SCRIPT"
}

show_manual_commands() {
  local scenario="$1"
  shift
  local commands=("$@")
  
  echo -e "${GREEN}📝 Manual commands for: $scenario${NC}"
  echo -e "${YELLOW}After running the setup wizard, you can use these commands:${NC}"
  echo
  
  for cmd in "${commands[@]}"; do
    echo -e "   ${BLUE}\$${NC} $cmd"
  done
  echo
}

main_menu() {
  while true; do
    print_banner
    echo "Select a setup scenario:"
    echo
    echo "1) 🔧 Development Setup (Local SQLite)"
    echo "2) 🚀 Production Setup (PostgreSQL + PM2)"
    echo "3) 📦 PM2 Only Setup (Existing App)"
    echo "4) 🔄 Migration from Dev to Prod"
    echo "5) 🛠️  System Tools & Maintenance"
    echo "6) 📚 Show Manual Commands Reference"
    echo "7) 🎯 Launch Full Setup Wizard"
    echo "0) ❌ Exit"
    echo
    read -p "Enter your choice (0-7): " choice
    
    case "$choice" in
      1)
        print_scenario "Development Setup" "Quick local development with SQLite database"
        run_wizard_sequence "Development" \
          "Main Menu → 5 (Quick Setup Dev)" \
          "Or: Main Menu → 1 (Development Setup) → 1 (Complete Development Setup)"
        ;;
      2)
        print_scenario "Production Setup" "Full production deployment with PostgreSQL and PM2"
        run_wizard_sequence "Production" \
          "Main Menu → 6 (Quick Setup Prod)" \
          "Or: Main Menu → 2 (Production Setup) → 1 (Complete Production Setup)"
        ;;
      3)
        print_scenario "PM2 Setup" "Install and configure PM2 for existing application"
        run_wizard_sequence "PM2 Only" \
          "Main Menu → 4 (System Tools) → 6 (Install PM2)" \
          "Main Menu → 4 (System Tools) → 8 (Setup PM2 Ecosystem)" \
          "Main Menu → 4 (System Tools) → 9 (Configure PM2 Startup)"
        ;;
      4)
        print_scenario "Dev to Prod Migration" "Migrate existing development setup to production"
        run_wizard_sequence "Migration" \
          "Main Menu → 2 (Production Setup) → 2 (Install PostgreSQL)" \
          "Main Menu → 2 (Production Setup) → 3 (Setup Production Database)" \
          "Main Menu → 4 (System Tools) → 6 (Install PM2)" \
          "Main Menu → 4 (System Tools) → 8 (Setup PM2 Ecosystem)" \
          "Main Menu → 2 (Production Setup) → 6 (Deploy Application)"
        ;;
      5)
        print_scenario "System Maintenance" "System tools and troubleshooting"
        run_wizard_sequence "Maintenance" \
          "Main Menu → 4 (System Tools) → 1 (System Health Check)" \
          "Main Menu → 3 (Database Management) → 4 (Test Database Connection)" \
          "Main Menu → 2 (Production Setup) → 13 (Environment Conflict Detection)"
        ;;
      6)
        show_manual_commands_reference
        ;;
      7)
        exec "$WIZARD_SCRIPT"
        ;;
      0)
        echo -e "${GREEN}👋 Goodbye!${NC}"
        exit 0
        ;;
      *)
        echo -e "${RED}❌ Invalid choice. Please try again.${NC}"
        read -p "Press Enter to continue..."
        ;;
    esac
  done
}

show_manual_commands_reference() {
  clear
  print_banner
  echo -e "${GREEN}📚 Manual Commands Reference${NC}"
  echo
  
  echo -e "${YELLOW}🔧 Development Commands:${NC}"
  show_manual_commands "Development" \
    "npm run dev                    # Start development server" \
    "npm run db:migrate            # Run database migrations" \
    "npm run seed                  # Seed development database" \
    "npm run db:studio             # Open Prisma Studio"
  
  echo -e "${YELLOW}🚀 Production Commands:${NC}"
  show_manual_commands "Production" \
    "npm run build:prod            # Build for production" \
    "npm run start:prod            # Start with production env" \
    "npm run db:migrate:prod       # Run production migrations" \
    "npm run seed:prod             # Seed production database" \
    "npm run db:test:prod          # Test production database"
  
  echo -e "${YELLOW}📦 PM2 Commands:${NC}"
  show_manual_commands "PM2 Management" \
    "npm run pm2:start             # Start application with PM2" \
    "npm run pm2:stop              # Stop all PM2 processes" \
    "npm run pm2:restart           # Restart all processes" \
    "npm run pm2:logs              # View application logs" \
    "npm run pm2:status            # Show process status" \
    "npm run pm2:monit             # Open PM2 monitor" \
    "npm run pm2:save              # Save process list for startup"
  
  echo -e "${YELLOW}🔄 Deployment Commands:${NC}"
  show_manual_commands "Deployment" \
    "npm run prod:deploy           # Build and restart PM2" \
    "npm run prod:full-deploy      # Migrate, build, and restart" \
    "npm run deploy:prod           # Full deployment script"
  
  echo -e "${YELLOW}🛠️ Database Commands:${NC}"
  show_manual_commands "Database Management" \
    "npm run db:generate           # Generate Prisma client" \
    "npm run db:generate:prod      # Generate with production schema" \
    "npm run db:studio:prod        # Open Prisma Studio for production" \
    "node scripts/test-db.js       # Test database connection"
  
  echo -e "${YELLOW}🔧 Environment Commands:${NC}"
  show_manual_commands "Environment Management" \
    "npx dotenv -e .env.production -- npm start              # Run with specific env" \
    "npx dotenv -e .env.production -- prisma migrate deploy  # Migrate with env" \
    "npx dotenv -e .env.production -- node scripts/seed.js   # Seed with env"
  
  read -p "Press Enter to return to main menu..."
}

# Check if wizard script exists
if [[ ! -f "$WIZARD_SCRIPT" ]]; then
  echo -e "${RED}❌ Setup wizard not found at: $WIZARD_SCRIPT${NC}"
  echo "Please run this script from the project root directory."
  exit 1
fi

# Check if we're in the project root
if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
  echo -e "${RED}❌ package.json not found. Please run from project root.${NC}"
  exit 1
fi

# Change to project root
cd "$PROJECT_ROOT"

# Run main menu
main_menu

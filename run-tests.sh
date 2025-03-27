#!/bin/bash

# run-tests.sh
# Script to run tests for the CosmWasm gRPC Indexer

# Ensure error exit
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running tests for CosmWasm gRPC Indexer${NC}"
echo -e "${YELLOW}====================================${NC}"

# Install testing dependencies if needed
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  yarn install
fi

# Run tests with Node.js experimental flags for ESM support
echo -e "${YELLOW}Running tests...${NC}"
node --experimental-vm-modules node_modules/.bin/jest --config=jest.config.js

# Check test result
if [ $? -eq 0 ]; then
  echo -e "${GREEN}All tests passed successfully!${NC}"
  
  # Show coverage summary
  echo -e "${YELLOW}Coverage Summary:${NC}"
  cat coverage/lcov-report/index.html | grep -A 5 "<span class=\"strong\">" | sed 's/<[^>]*>//g' | grep -v "^$"
  
  echo -e "${YELLOW}Detailed coverage report available at:${NC} coverage/lcov-report/index.html"
else
  echo -e "${RED}Tests failed. Please check the error messages above.${NC}"
  exit 1
fi
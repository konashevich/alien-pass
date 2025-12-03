#!/bin/bash

# Setup Google Cloud Project for AlienPass
# This script guides the user through creating a project, enabling the Drive API,
# and configuring OAuth consent.

set -e

echo "================================================================="
echo "   AlienPass Google Cloud Setup Helper"
echo "================================================================="
echo ""
echo "This script requires the 'gcloud' CLI to be installed and authenticated."
echo "If you haven't run 'gcloud auth login', please do so now."
echo ""
read -p "Press Enter to continue..."

# 1. Project Creation
echo ""
echo "--- Step 1: Project Setup ---"
read -p "Enter a new Project ID (e.g., alienpass-sync-user): " PROJECT_ID

if gcloud projects describe $PROJECT_ID &> /dev/null; then
  echo "Project '$PROJECT_ID' already exists. Using it."
else
  echo "Creating project '$PROJECT_ID'..."
  gcloud projects create $PROJECT_ID --name="AlienPass Sync"
fi

echo "Setting project as default for this session..."
gcloud config set project $PROJECT_ID

# 2. Enable APIs
echo ""
echo "--- Step 2: Enabling Google Drive API ---"
gcloud services enable drive.googleapis.com

# 3. OAuth Consent Screen
echo ""
echo "--- Step 3: OAuth Consent Screen ---"
echo "You need to configure the OAuth consent screen manually via the browser."
echo "Since this app is for personal use, select 'External' user type and add yourself as a test user."
echo ""
echo "1. Go to: https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID"
echo "2. Select 'External' and click Create."
echo "3. Fill in 'App name' (AlienPass), 'User support email', and 'Developer contact information'."
echo "4. Click 'Save and Continue'."
echo "5. (Scopes) Click 'Add or Remove Scopes'. Search for 'drive.appdata' and select '.../auth/drive.appdata'."
echo "6. Click 'Update', then 'Save and Continue'."
echo "7. (Test Users) Click 'Add Users' and enter your Google email address."
echo "8. Click 'Save and Continue'."
echo ""
read -p "Press Enter once you have completed the OAuth Consent Screen setup..."

# 4. Create Credentials
echo ""
echo "--- Step 4: Create OAuth Credentials ---"
echo "You need to create an OAuth Client ID for the Web application."
echo ""
echo "1. Go to: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo "2. Click 'Create Credentials' -> 'OAuth client ID'."
echo "3. Application type: 'Web application'."
echo "4. Name: 'AlienPass Web'."
echo "5. Authorized JavaScript origins:"
echo "   - For local development: http://localhost:8080 (or your local server URL)"
echo "   - For production: https://<your-domain>"
echo "6. Authorized redirect URIs:"
echo "   - Same as above (often required for some flows, though Implicit flow uses the origin)."
echo "7. Click 'Create'."
echo ""
echo "You will see a Client ID (e.g., '12345...apps.googleusercontent.com')."
echo "Copy this Client ID."
echo ""
read -p "Enter the Client ID you just generated: " CLIENT_ID

echo ""
echo "================================================================="
echo "   Setup Complete!"
echo "================================================================="
echo "Project ID: $PROJECT_ID"
echo "Client ID:  $CLIENT_ID"
echo ""
echo "Please enter this Client ID into the AlienPass Settings tab to enable Sync."
echo "================================================================="

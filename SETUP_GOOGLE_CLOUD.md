# Google Cloud Setup for AlienPass Sync

To sync your Vault with Google Drive, you need to set up a Google Cloud Project. This keeps your data private and under your control.

## Automated Setup (Recommended)

If you have the `gcloud` CLI installed, run the helper script:

```bash
./scripts/setup-google-cloud.sh
```

Follow the on-screen instructions.

## Manual Setup

If you prefer to use the web console manually:

1.  **Create a Project**:
    *   Go to [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project (e.g., "alienpass-sync").

2.  **Enable Drive API**:
    *   Go to **APIs & Services > Library**.
    *   Search for "Google Drive API".
    *   Click **Enable**.

3.  **Configure OAuth Consent Screen**:
    *   Go to **APIs & Services > OAuth consent screen**.
    *   Choose **External** user type.
    *   Fill in required fields (App Name: "AlienPass", Email: yours).
    *   **Scopes**: Add `.../auth/drive.appdata` (access to application data folder).
    *   **Test Users**: Add your own Google email address.

4.  **Create Credentials**:
    *   Go to **APIs & Services > Credentials**.
    *   Click **Create Credentials > OAuth client ID**.
    *   **Application Type**: Web application.
    *   **Authorized JavaScript origins**:
        *   Add the URL where you host AlienPass (e.g., `https://yourname.github.io` or `http://localhost:8080`).
    *   Click **Create**.

5.  **Copy Client ID**:
    *   Copy the generated Client ID string (it looks like `123456...apps.googleusercontent.com`).
    *   You will paste this into the AlienPass Settings.

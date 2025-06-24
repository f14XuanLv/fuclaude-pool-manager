# FuClaude Pool Manager Worker

This Cloudflare Worker provides a backend service to manage access to Claude AI using a pool of session keys (SKs). It allows users to obtain a Claude login URL by either requesting a specific account (if known) or a random available account. It also includes administrative endpoints to add or remove email-SK pairs from the pool.

The worker utilizes Cloudflare KV to store the mapping of emails to session keys.

## First-Time Setup

Before you can deploy the worker, you need to create your own configuration files by copying the provided examples:

```bash
# For Windows (Command Prompt)
copy .dev.vars.example .dev.vars
copy initial-sk-map.json.example initial-sk-map.json

# For Linux / macOS / Git Bash
cp .dev.vars.example .dev.vars
cp initial-sk-map.json.example initial-sk-map.json
```

Next, edit the newly created .dev.vars and initial-sk-map.json to fill in your own administrator password and Claude session keys. These files are already listed in .gitignore and will not be committed to your repository.

## Features

-   User login via specific email or random selection.
-   Admin functions to list, add, update, and delete email-SK pairs.
-   CORS enabled for all endpoints.
-   Optional Sentry integration for error tracking.
-   Sorted email list for user selection.

## API Documentation

All API endpoints are relative to the Worker's deployed URL.

### User Endpoints

#### 1. List Available Emails
-   **Purpose**: Retrieves a sorted list of email addresses that have associated SKs and can be used for login.
-   **HTTP Method**: `GET`
-   **URL Path**: `/api/emails`

#### 2. Login to Claude
-   **Purpose**: Obtains a temporary login URL for Claude AI.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/login`
-   **Request Body**: `{"mode": "specific" | "random", "email"?: "...", "unique_name"?: "..."}`

### Admin Endpoints

Admin endpoints require an `admin_password` for authentication.

#### 1. List Email-SK Pairs
-   **Purpose**: Retrieves a list of all configured email addresses and a preview of their SKs.
-   **HTTP Method**: `GET`
-   **URL Path**: `/api/admin/list?admin_password=YOUR_PASSWORD`

#### 2. Add Email-SK Pair
-   **Purpose**: Adds a new email and its corresponding session key (SK) to the KV store.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/add`
-   **Request Body**: `{"admin_password": "...", "email": "...", "sk": "..."}`

#### 3. Update Email-SK Pair
-   **Purpose**: Updates an existing email and/or its session key (SK). You can use this to change an email address, update an expired SK, or both at the same time.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/update`
-   **Request Body**: `{"admin_password": "...", "email": "email_to_update@example.com", "new_email"?: "...", "new_sk"?: "..."}`
    - You must provide `email` to identify the record.
    - You must provide at least one of `new_email` or `new_sk` to perform an update.

#### 4. Delete Email-SK Pair
-   **Purpose**: Removes an email and its SK from the KV store.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/delete`
-   **Request Body**: `{"admin_password": "...", "email": "..."}`

## Deployment and Initialization

### Quick Start (Recommended)

This project includes an interactive deployment script that handles most of the setup process automatically.

#### Prerequisites

Before running the automated deployment script, please ensure you complete the following preparation steps:

1.  **Install Project Dependencies:**
    Open your terminal and run the following command to install all the necessary dependencies defined in `package.json`.
    ```bash
    npm install
    ```

2.  **Install Development Dependency:**
    The deployment script requires the `prompts` package for user interaction. Install it separately as a development dependency using this command:
    ```bash
    npm install prompts --save-dev
    ```

#### Start Deployment

Once the prerequisites are met, you can begin the deployment:

1.  **Run the deployment script:**
    ```bash
    node deploy-worker.mjs
    ```
2.  **Follow the prompts:** The script will guide you through the subsequent steps, such as naming your Worker, creating a KV Namespace, and setting up your secrets.

---

### Manual Deployment (For advanced users)

If you prefer to set up the project manually, follow the steps below.

1.  **Prerequisites**:
    -   Cloudflare account.
    -   `wrangler` CLI installed and configured (`wrangler login`).
    -   Node.js and npm/yarn.

2.  **Configuration (`wrangler.jsonc`)**:
    Ensure your Wrangler configuration file correctly defines the KV namespace binding. The template comes with placeholder IDs.
    ```jsonc
    // Example for wrangler.jsonc
    {
      "name": "fuclaude-pool-manager",
      "main": "src/index.ts",
      "compatibility_date": "2025-06-20",
      "kv_namespaces": [
        {
          "binding": "CLAUDE_KV",
          "id": "YOUR_KV_NAMESPACE_ID", // Replace with your actual KV namespace ID
          "preview_id": "YOUR_KV_NAMESPACE_PREVIEW_ID" // Replace for wrangler dev
        }
      ]
    }
    ```
    You can create the required KV namespace and get the IDs by running:
    ```bash
    # Create production KV
    wrangler kv:namespace create "CLAUDE_KV"
    # Create preview KV for local development
    wrangler kv:namespace create "CLAUDE_KV" --preview
    ```
    Wrangler will prompt you to add the output to your `wrangler.jsonc`.

3.  **Set Secrets and Variables**:
    -   Use the `wrangler secret put` command for all sensitive data:
        ```bash
        wrangler secret put ADMIN_PASSWORD
        # (Optional) For Sentry integration
        wrangler secret put SENTRY_DSN
        ```
    -   For local development with `wrangler dev`, create a `.dev.vars` file in the project root and add your secrets there. **This file is already in `.gitignore`**.
        ```
        # Please change this to your own strong password
        ADMIN_PASSWORD="change_this_to_your_own_strong_password"
        SENTRY_DSN="your_sentry_dsn_if_any"
        ```
    -   The `BASE_URL` variable is also required. You can set it in the Cloudflare Dashboard (Settings > Variables) or add it to your `wrangler.jsonc` `[vars]` block for production, and `.dev.vars` for local development.
        ```jsonc
        // In wrangler.jsonc
        "vars": { "BASE_URL": "https://claude.ai" },
        ```
        ```
        # In .dev.vars
        BASE_URL="https://claude.ai"
        ```

4.  **Deploy**:
    ```bash
    wrangler deploy
    ```

5.  **Initialize KV Data**:
    After deployment, you can use the API (e.g., `/api/admin/add`) to add your accounts, or initialize the KV store from a local JSON file using Wrangler:
    ```bash
    # Create an initial-sk-map.json file with your data:
    # {"email1@domain.com": "sk-...", "email2@domain.com": "sk-..."}

    # Write to production KV
    wrangler kv:key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV

    # Write to preview KV for local development
    wrangler kv:key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV --preview
    ```

## Troubleshooting

When using the automated deployment script `deploy-worker.mjs`, you might encounter some issues due to your environment or updates to the `wrangler` tool. Here are some common problems and their solutions.

1.  **Error: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'prompts'`**
    -   **Cause**: The `prompts` package, which the deployment script depends on, has not been installed.
    -   **Solution**: Run `npm install prompts --save-dev` in your project's root directory to install this missing development dependency.

2.  **Error: `'wrangler' is not recognized as an internal or external command...` or `command not found: wrangler`**
    -   **Cause**: `wrangler` is installed as a local project dependency, and its executable path is not added to your system's PATH environment variable. Calling `wrangler` directly in the terminal will cause this error.
    -   **Solution**: The script has been updated to use `npx wrangler` to execute commands. `npx` automatically finds and uses the version of `wrangler` installed locally in the project. If you need to run `wrangler` commands manually, be sure to use the `npx wrangler ...` format.

3.  **Error: `Unknown arguments: json, kv:namespace, list` or the script gets stuck/errors after "Checking Wrangler login status"**
    -   **Cause**: Cloudflare's `wrangler` tool updated its command-line syntax and output format in v4. Old commands like `wrangler kv:namespace list --json` are no longer valid.
    -   **Solution**: The `deploy-worker.mjs` script in this project has been updated for `wrangler` v4+, enabling it to correctly parse the new command output format and use the new command syntax (e.g., `wrangler kv namespace list`). Please ensure you have pulled the latest code. If you still encounter issues, check your `wrangler` version (`npx wrangler --version`) and ensure the commands in the script are compatible.

## Git Repository Management

-   Ensure your `.gitignore` file includes `node_modules/`, `.dev.vars`, and `.wrangler/`. (The provided file is already configured correctly).
-   Commit the current state to Git to establish a clean baseline for your own project:
    ```bash
    git add .
    git commit -m "feat: Initial setup of FuClaude Pool Manager"
    git push origin main
    ```
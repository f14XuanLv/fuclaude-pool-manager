# FuClaude Pool Manager Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/f14XuanLv/fuclaude-pool-manager)

If you find this project helpful, please consider giving it a star ⭐️!
<div align="center">

[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.3-blue?style=for-the-badge)](https://github.com/f14XuanLv/fuclaude-pool-manager)

</div>

This Cloudflare Worker provides a backend service to manage access to Claude AI using a pool of session keys (SKs). It allows users to obtain a Claude login URL by either requesting a specific account or a random available account. It also includes administrative endpoints to add or remove email-SK pairs from the pool.

## Quick Start: One-Click Deploy (Recommended)

This is the easiest way to get started. This path uses a graphical user interface for the entire process.

### Step 1: Deploy the Worker

Click the "Deploy with Cloudflare" button at the top of this page. The Cloudflare dashboard will open and guide you through creating a copy of this repository and deploying the Worker.

### Step 2: Configure Secrets and Variables

After deployment, you need to configure the necessary secrets and variables for your Worker to function correctly.

1.  In your Cloudflare Dashboard, navigate to **Workers & Pages** and select your newly deployed application.
2.  Go to the **Settings** tab, then click on **Variables**.
3.  **Set the Admin Password (Secret):**
    -   Under **Environment Variables**, click **Add variable**.
    -   Enter the variable name: `ADMIN_PASSWORD`.
    -   Enter your desired password in the value field.
    -   From the **Type** dropdown, select **Secret**.
    -   Click **Save and deploy** to apply the changes immediately, or **Save** to apply them on the next deployment.
4.  **Set other Secrets/Variables as needed:** Repeat the process for other variables:
    -   `TOKEN_EXPIRES_IN` (optional): The default token expiration time in seconds. For example, `86400` for 24 hours. If not set, tokens will not expire by default.
    -   `BASE_URL`: The base URL for your Claude instance.

> [!NOTE]
> To **modify** an existing variable, simply find it in the list, click **Edit**, enter the new value, and click **Save**.

### Step 3: Initialize Your Data (via API)

Your Worker is deployed, but its KV (database) is empty. You need to add your accounts. The easiest way is to use the new batch API endpoint.

1.  **Prepare your data:**
    Copy the content of `initial-sk-map.json.example` and fill it with your actual email and SK pairs.
    ```json
    {
      "user1@example.com": "sk-abc...",
      "user2@example.com": "sk-def..."
    }
    ```

2.  **Construct the API request body:**
    Transform your data into the format required by the batch API.
    ```json
    {
      "admin_password": "YOUR_ADMIN_PASSWORD",
      "actions": [
        { "action": "add", "email": "user1@example.com", "sk": "sk-abc..." },
        { "action": "add", "email": "user2@example.com", "sk": "sk-def..." }
      ]
    }
    ```

3.  **Send the request:**
    You can use any API tool (like Postman, Insomnia) or the `curl` command to send this data to your Worker. Replace `YOUR_WORKER_URL` with your actual Worker's URL.

    ```bash
    curl -X POST https://YOUR_WORKER_URL/api/admin/batch \
    -H "Content-Type: application/json" \
    -d '{
      "admin_password": "YOUR_ADMIN_PASSWORD",
      "actions": [
        { "action": "add", "email": "user1@example.com", "sk": "sk-abc..." },
        { "action": "add", "email": "user2@example.com", "sk": "sk-def..." }
      ]
    }'
    ```
You are all set! Your Worker is now fully configured and ready to use.

> [!WARNING]
> Deploying the project via the 'Deploy to Cloudflare' button or other GUI methods may automatically create an API token. This token is not automatically deleted when the project is removed. If needed, you can manually manage or delete it from your [API Tokens page](https://dash.cloudflare.com/profile/api-tokens).

---

## For Developers: Alternative Methods

This section is for users who are comfortable with the command line and want more control over the setup process.

### Method A: Interactive Script Deployment

This method uses a Node.js script to guide you through the deployment.

1.  **Prerequisites:**
    -   Git, Node.js, and npm must be installed.
    -   Log in to Cloudflare with the CLI: `npx wrangler login`.
2.  **Clone the repository:**
    ```bash
    git clone https://github.com/f14XuanLv/fuclaude-pool-manager.git
    cd fuclaude-pool-manager
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    npm install prompts --save-dev
    ```
4.  **Run the deployment script:**
    ```bash
    node deploy-worker.mjs
    ```
    The script will guide you through naming the Worker, creating the KV Namespace, and setting secrets.

### Method B: Manual CLI Deployment

This is the fully manual approach for advanced users.

1.  **Prerequisites**:
    -   Cloudflare account.
    -   `wrangler` CLI installed and configured (`npx wrangler login`).
    -   Node.js and npm/yarn.

2.  **Configuration (`wrangler.jsonc`)**:
    Manually edit `wrangler.jsonc` to set your Worker's name and add the KV namespace binding after creating it.

3.  **Create KV Namespace**:
    ```bash
    # Create production KV
    npx wrangler kv namespace create "CLAUDE_KV"
    # Create preview KV for local development
    npx wrangler kv namespace create "CLAUDE_KV" --preview
    ```
    Wrangler will prompt you to add the output to your `wrangler.jsonc`.

4.  **Set Secrets**:
    ```bash
    npx wrangler secret put ADMIN_PASSWORD
    ```

5.  **Deploy**:
    ```bash
    npx wrangler deploy
    ```

6.  **Initialize KV Data (CLI Method)**:
    You can use the `wrangler kv` command to directly upload your initial data map.
    ```bash
    # Ensure initial-sk-map.json is populated with your data
    npx wrangler kv key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV --remote
    ```

---

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
-   **Request Body**: `{"mode": "specific" | "random", "email"?: "...", "unique_name"?: "...", "expires_in"?: number}`
    -   **`expires_in`** (optional, number): The desired token expiration time in seconds.
    -   **Behavior**: The effective expiration time is capped by the `TOKEN_EXPIRES_IN` environment variable. If you request a duration longer than the allowed maximum, it will be automatically reduced to the maximum, and the API response will include a `warning` field. If `TOKEN_EXPIRES_IN` is not set or is `0`, there is no upper limit.
-   **Success Response**: `{"login_url": "...", "warning"?: "..."}`
    -   Returns a `login_url` on success.
    -   Returns an optional `warning` if the `expires_in` was adjusted.

### Admin Endpoints

Admin endpoints require an `admin_password` for authentication.

#### 1. Admin Login to Claude (Unrestricted)
-   **Purpose**: Obtains a temporary login URL for Claude AI, bypassing user-facing expiration limits.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/login`
-   **Request Body**: `{"admin_password": "...", "mode": "specific" | "random", "email"?: "...", "unique_name"?: "...", "expires_in"?: number}`
    -   **`expires_in`** (optional, number): The desired token expiration time in seconds. Defaults to `0` (no expiration) if not provided. This value is **not** limited by the `TOKEN_EXPIRES_IN` environment variable.

#### 2. List Email-SK Pairs
-   **Purpose**: Retrieves a list of all configured email addresses and a preview of their SKs.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/list`
-   **Request Body**: `{"admin_password": "..."}`

#### 3. Add Email-SK Pair
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

#### 5. Batch Add/Delete Email-SK Pairs
-   **Purpose**: Adds or deletes multiple email-SK pairs in a single request. This is ideal for initializing or bulk-managing the KV store.
-   **HTTP Method**: `POST`
-   **URL Path**: `/api/admin/batch`
-   **Request Body**: 
    ```json
    {
      "admin_password": "...",
      "actions": [
        { "action": "add", "email": "user1@example.com", "sk": "sk-abc..." },
        { "action": "add", "email": "user2@example.com", "sk": "sk-def..." },
        { "action": "delete", "email": "user_to_remove@example.com" }
      ]
    }
    ```
-   **Details**:
    -   The `actions` array can contain any number of `add` or `delete` operations.
    -   For `add`, both `email` and `sk` are required. If an email already exists, its SK will be updated.
    -   For `delete`, only `email` is required.
    -   The response will provide a detailed report on the status of each action.

## Troubleshooting

When using the automated deployment script `deploy-worker.mjs`, you might encounter some issues due to your environment or updates to the `wrangler` tool. Here are some common problems and their solutions.

1.  **Error: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'prompts'`**
    -   **Cause**: The `prompts` package, which the deployment script depends on, has not been installed.
    -   **Solution**: Run `npm install prompts --save-dev` in your project's root directory to install this missing development dependency.

2.  **Error: `'wrangler' is not recognized as an internal or external command...` or `command not found: wrangler`**
    -   **Cause**: `wrangler` is installed as a local project dependency, and its executable path is not added to your system's PATH environment variable. Calling `wrangler` directly in the terminal will cause this error.
    -   **Solution**: The script has been updated to use `npx wrangler` to execute commands. `npx` automatically finds and uses the version of `wrangler` installed locally in the project. If you need to run `wrangler` commands manually, be sure to use the `npx wrangler ...` format.

3.  **Error: `Unknown arguments: json, kv:namespace, list` or the script gets stuck/errors after "Checking Wrangler login status"**
    -   **Cause**: Cloudflare's `wrangler` tool updated its command-line syntax and output format in v4. Old commands like `wrangler kv namespace list --json` are no longer valid.
    -   **Solution**: The `deploy-worker.mjs` script in this project has been updated for `wrangler` v4+, enabling it to correctly parse the new command output format and use the new command syntax (e.g., `wrangler kv namespace list`). Please ensure you have pulled the latest code. If you still encounter issues, check your `wrangler` version (`npx wrangler --version`) and ensure the commands in the script are compatible.

4.  **How do I delete the API token created by the "Deploy" button?**
    -   **Cause**: When you use the "Deploy with Cloudflare" button, Cloudflare automatically creates an API token with limited permissions to connect to your repository. Deleting the repository or the Worker does not automatically delete this token.
    -   **Solution**: You need to manually delete it from your Cloudflare profile:
        1.  Go to the Cloudflare dashboard, click your profile icon in the top right, and select **My Profile**.
        2.  Navigate to the **API Tokens** tab on the left.
        3.  Find the token (e.g., `your-repo-name build token`).
        4.  Click the `...` menu on the right and select **Delete**.
---
## License
This project is licensed under the [MIT License](./LICENSE).
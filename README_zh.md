# FuClaude Pool Manager Worker (中文版)

此 Cloudflare Worker 提供了一个后端服务，用于通过会话密钥 (SK) 池来管理对 Claude AI 的访问。它允许用户通过请求特定账户（如果知道）或随机可用账户来获取 Claude 登录 URL。它还包括用于从池中添加或删除 Email-SK 对的管理端点。

该 Worker 利用 Cloudflare KV 来存储 Email 到会话密钥的映射。

## 首次配置

在部署此 Worker 之前, 您需要通过复制项目提供的示例文件来创建您自己的配置文件:

```bash
# Windows (命令提示符)
copy .dev.vars.example .dev.vars
copy initial-sk-map.json.example initial-sk-map.json

# Linux / macOS / Git Bash
cp .dev.vars.example .dev.vars
cp initial-sk-map.json.example initial-sk-map.json
```

接下来, 编辑新创建的 .dev.vars 和 initial-sk-map.json 文件, 填入您自己的管理员密码和 Claude 会话密钥。这些文件已被列在 .gitignore 中, 不会被提交到您的代码仓库。

## 特性

-   用户通过特定 Email 或随机选择登录。
-   管理员功能，用于列出、添加、更新和删除 Email-SK 对。
-   为所有端点启用 CORS。
-   可选的 Sentry 集成用于错误跟踪。
-   为用户选择提供排序后的 Email 列表。

## API 文档

所有 API 端点均相对于 Worker 的部署 URL。

### 用户端点

#### 1. 列出可用 Email
-   **目的**: 检索已排序的、可用于登录的 Email 地址列表。
-   **HTTP 方法**: `GET`
-   **URL 路径**: `/api/emails`

#### 2. 登录到 Claude
-   **目的**: 获取 Claude AI 的临时登录 URL。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/login`
-   **请求体**: `{"mode": "specific" | "random", "email"?: "...", "unique_name"?: "..."}`

### 管理员端点

管理员端点需要 `admin_password` 进行身份验证。

#### 1. 列出 Email-SK 对
-   **目的**: 检索所有已配置 Email 地址及其 SK 预览的列表。
-   **HTTP 方法**: `GET`
-   **URL 路径**: `/api/admin/list?admin_password=YOUR_PASSWORD`

#### 2. 添加 Email-SK 对
-   **目的**: 将新的 Email 及其对应的会话密钥 (SK) 添加到 KV 存储中。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/add`
-   **请求体**: `{"admin_password": "...", "email": "...", "sk": "..."}`

#### 3. 更新 Email-SK 对
-   **目的**: 更新现有的 Email 和/或其会话密钥 (SK)。您可以用来修改邮箱地址、更新已过期的 SK，或同时进行两者。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/update`
-   **请求体**: `{"admin_password": "...", "email": "email_to_update@example.com", "new_email"?: "...", "new_sk"?: "..."}`
    - 您必须提供 `email` 字段来定位记录。
    - 您必须提供 `new_email` 或 `new_sk` 至少一个字段来执行更新。

#### 4. 删除 Email-SK 对
-   **目的**: 从 KV 存储中删除一个 Email 及其 SK。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/delete`
-   **请求体**: `{"admin_password": "...", "email": "..."}`

## 部署和初始化

### 快速上手 (推荐)

本项目包含一个交互式部署脚本，可自动处理大部分设置过程。

#### 准备工作

在运行自动化部署脚本之前，请确保完成以下准备步骤：

1.  **安装项目依赖:**
    打开终端，运行以下命令来安装 `package.json` 中定义的所有必需依赖项。
    ```bash
    npm install
    ```

2.  **安装开发依赖:**
    部署脚本需要 `prompts` 包来进行用户交互。请使用以下命令单独安装它作为开发依赖项。
    ```bash
    npm install prompts --save-dev
    ```

#### 开始部署

完成准备工作后，即可开始部署：

1.  **运行部署脚本:**
    ```bash
    node deploy-worker-zh.mjs
    ```
2.  **跟随提示操作:** 脚本将引导您完成命名 Worker、创建 KV Namespace 和设置密钥等后续步骤。

---

### 手动部署 (适用于高级用户)

如果您希望手动设置项目，请按照以下步骤操作。

1.  **先决条件**:
    -   Cloudflare 账户。
    -   已安装并配置 `wrangler` CLI (`wrangler login`)。
    -   Node.js 和 npm/yarn。

2.  **配置 (`wrangler.jsonc`)**:
    确保您的 Wrangler 配置文件正确定义了 KV Namespace 绑定。模板中已包含占位符 ID。
    ```jsonc
    // wrangler.jsonc 示例
    {
      "name": "fuclaude-pool-manager",
      "main": "src/index.ts",
      "compatibility_date": "2025-06-20",
      "kv_namespaces": [
        {
          "binding": "CLAUDE_KV",
          "id": "YOUR_KV_NAMESPACE_ID", // 替换为您的实际 KV Namespace ID
          "preview_id": "YOUR_KV_NAMESPACE_PREVIEW_ID" // 替换为 wrangler dev 使用的预览 ID
        }
      ]
    }
    ```
    您可以通过运行以下命令来创建所需的 KV Namespace 并获取 ID：
    ```bash
    # 创建生产环境 KV
    wrangler kv namespace create "CLAUDE_KV"
    # 为本地开发创建预览环境 KV
    wrangler kv namespace create "CLAUDE_KV" --preview
    ```
    Wrangler 会提示您将输出的配置添加到 `wrangler.jsonc` 文件中。

3.  **设置 Secret 和变量**:
    -   为所有敏感数据使用 `wrangler secret put` 命令：
        ```bash
        wrangler secret put ADMIN_PASSWORD
        # (可选) 用于 Sentry 集成
        wrangler secret put SENTRY_DSN
        ```
    -   对于本地开发 (`wrangler dev`)，请在项目根目录创建一个 `.dev.vars` 文件并添加您的机密信息。**此文件已包含在 `.gitignore` 中**。
        ```
        # 请务必修改为您自己的高强度密码
        ADMIN_PASSWORD="change_this_to_your_own_strong_password"
        SENTRY_DSN="your_sentry_dsn_if_any"
        ```
    -   `BASE_URL` 变量也是必需的。您可以在 Cloudflare 仪表板 (设置 > 变量) 中设置它，或将其添加到 `wrangler.jsonc` 的 `[vars]` 块中用于生产环境，以及 `.dev.vars` 中用于本地开发。
        ```jsonc
        // 在 wrangler.jsonc 中
        "vars": { "BASE_URL": "https://claude.ai" },
        ```
        ```
        # 在 .dev.vars 中
        BASE_URL="https://claude.ai"
        ```

4.  **部署**:
    ```bash
    wrangler deploy
    ```

5.  **初始化 KV 数据**:
    部署后，您可以使用 API (例如 `/api/admin/add`) 来添加您的账户，或使用 Wrangler 从本地 JSON 文件初始化 KV 存储：
    ```bash
    # 创建一个 initial-sk-map.json 文件并填入您的数据:
    # {"email1@domain.com": "sk-...", "email2@domain.com": "sk-..."}

    # 写入生产环境 KV
    wrangler kv key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV --remote

    # 写入预览环境 KV (用于本地开发)
    wrangler kv key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV --preview
    ```

## 常见问题排查

在使用自动化部署脚本 `deploy-worker-zh.mjs` 时，您可能会遇到一些由于环境或 `wrangler` 版本更新导致的问题。这里列出了一些常见问题及其解决方案。

1.  **错误: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'prompts'`**
    -   **原因**: 部署脚本依赖的 `prompts` 包没有被安装。
    -   **解决方案**: 在项目根目录运行 `npm install prompts --save-dev` 来安装这个缺失的开发依赖。

2.  **错误: `'wrangler' 不是内部或外部命令...` 或 `command not found: wrangler`**
    -   **原因**: `wrangler` 是作为项目的本地依赖安装的，其可执行文件路径并未添加到系统的 PATH 环境变量中。直接在终端中调用 `wrangler` 会导致此错误。
    -   **解决方案**: 脚本已经更新为使用 `npx wrangler` 来执行命令，`npx` 会自动找到并使用项目本地安装的 `wrangler` 版本。如果您需要手动运行 `wrangler` 命令，也请务必使用 `npx wrangler ...` 的形式。

3.  **错误: `Unknown arguments: json, kv:namespace, list` 或脚本在“检查 Wrangler 登录状态”后卡住/报错**
    -   **原因**: Cloudflare 的 `wrangler` 工具在 v4 版本后更新了其命令行语法和输出格式。例如，`wrangler kv namespace list --json` 这样的旧命令已不再有效。
    -   **解决方案**: 本项目中的 `deploy-worker-zh.mjs` 脚本已经针对 `wrangler` v4+ 进行了更新，能够正确解析新的命令输出格式并使用新的命令语法（例如 `wrangler kv namespace list`）。请确保您拉取了最新的代码。如果仍然遇到问题，请检查您的 `wrangler` 版本 (`npx wrangler --version`) 并确保脚本中的命令与之兼容。

## Git 仓库管理

-   确保您的 `.gitignore` 文件包含 `node_modules/`, `.dev.vars`, 和 `.wrangler/`。(项目自带的 `.gitignore` 已配置好)。
-   将当前状态提交到 Git，为您自己的项目建立一个干净的基线:
    ```bash
    git add .
    git commit -m "feat: 初始化 FuClaude Pool Manager 项目"
    git push origin main
    ```
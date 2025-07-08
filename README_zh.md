# FuClaude Pool Manager Worker (中文版)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/f14XuanLv/fuclaude-pool-manager)

如果您觉得这个项目对您有帮助，请考虑给它一个 star ⭐️！
<div align="center">

[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.3-blue?style=for-the-badge)](https://github.com/f14XuanLv/fuclaude-pool-manager)

</div>

此 Cloudflare Worker 提供了一个后端服务，用于通过会话密钥 (SK) 池来管理对 Claude AI 的访问。它允许用户通过请求特定账户或随机可用账户来获取 Claude 登录 URL，并包含用于管理 SK 池的管理员端点。

## 快速上手：一键部署 (推荐)

这是最简单的入门方式。此路径全程使用图形用户界面，无需命令行操作。

### 第一步：部署 Worker

点击页面顶部的 "Deploy with Cloudflare" 按钮。Cloudflare 的仪表板将会打开，并引导您创建此项目的副本并完成 Worker 的部署。

### 第二步：配置密钥和变量

部署完成后，您需要为 Worker 配置必要的密钥和变量，以确保其正常运行。

1.  在您的 Cloudflare 仪表板中，导航至 **Workers & Pages**，然后选择您刚刚部署的应用。
2.  进入 **Settings** (设置) 选项卡，然后点击 **Variables** (变量)。
3.  **设置管理员密码 (密钥):**
    -   在 **Environment Variables** (环境变量) 下，点击 **Add variable** (添加变量)。
    -   输入变量名：`ADMIN_PASSWORD`。
    -   在值字段中输入您想要的密码。
    -   从 **类型** 下拉菜单中，选择 **密钥**。
    -   点击 **Save and deploy** (保存并部署) 以立即应用更改，或点击 **Save** (保存) 以在下次部署时生效。
4.  **按需设置其他变量:** 对于其他变量，重复此过程即可：
    -   `TOKEN_EXPIRES_IN` (可选): 默认的令牌有效时间，单位为秒。例如，`86400` 代表 24 小时。如果未设置，令牌默认不会过期。
    -   `BASE_URL`: 您的 Claude 实例的基础 URL。

> [!NOTE]
> 要**修改**一个已存在的变量，只需在列表中找到它，点击 **Edit** (编辑)，输入新值，然后点击 **Save** (保存)。

### 第三步：初始化数据 (通过 API)

您的 Worker 已部署，但其 KV (数据库) 是空的。您需要添加您的账户信息。最简单的方式是使用新增的批量处理 API 端点。

1.  **准备您的数据:**
    复制 `initial-sk-map.json.example` 文件的内容，并填入您真实的 Email 和 SK 对。它看起来应该像这样：
    ```json
    {
      "user1@example.com": "sk-abc...",
      "user2@example.com": "sk-def..."
    }
    ```

2.  **构建 API 请求体:**
    将您的数据转换为批量处理 API 所需的格式。为每个条目创建一个 "add" 操作。
    ```json
    {
      "admin_password": "您设置的管理员密码",
      "actions": [
        { "action": "add", "email": "user1@example.com", "sk": "sk-abc..." },
        { "action": "add", "email": "user2@example.com", "sk": "sk-def..." }
      ]
    }
    ```

3.  **发送请求:**
    您可以使用任何 API 工具 (如 Postman, Insomnia) 或 `curl` 命令将此数据发送到您的 Worker。请将 `您的WORKER地址` 替换为您的 Worker 的实际 URL。

    ```bash
    curl -X POST https://您的WORKER地址/api/admin/batch \
    -H "Content-Type: application/json" \
    -d '{
      "admin_password": "您设置的管理员密码",
      "actions": [
        { "action": "add", "email": "user1@example.com", "sk": "sk-abc..." },
        { "action": "add", "email": "user2@example.com", "sk": "sk-def..." }
      ]
    }'
    ```
至此，一切就绪！您的 Worker 已完全配置好并准备就绪。

> [!WARNING]
> 通过按钮部署或者其他GUI操作部署该项目可能会自动创建 API 令牌。
> 当项目删除后API令牌不会自动删除。
> 如有需要，可以在页面中 https://dash.cloudflare.com/profile/api-tokens 手动管理或删除。

---

## 开发者选项：其他部署方式

本部分适用于熟悉命令行并希望对设置过程有更多控制的用户。

### 方式 A：交互式脚本部署

此方法使用 Node.js 脚本引导您完成部署。

1.  **先决条件:**
    -   已安装 Git、Node.js 和 npm。
    -   通过 CLI 登录到 Cloudflare: `npx wrangler login`。
2.  **克隆仓库:**
    ```bash
    git clone https://github.com/f14XuanLv/fuclaude-pool-manager.git
    cd fuclaude-pool-manager
    ```
3.  **安装依赖:**
    ```bash
    npm install
    npm install prompts --save-dev
    ```
4.  **运行部署脚本:**
    ```bash
    node deploy-worker-zh.mjs
    ```
    脚本将引导您完成命名 Worker、创建 KV Namespace 和设置密钥等步骤。

### 方式 B：手动 CLI 部署

这是为高级用户准备的完全手动的方法。

1.  **先决条件**:
    -   Cloudflare 账户。
    -   已安装并配置 `wrangler` CLI (`npx wrangler login`)。
    -   Node.js 和 npm/yarn。

2.  **配置 (`wrangler.jsonc`)**:
    手动编辑 `wrangler.jsonc` 来设置您的 Worker 名称，并在创建后添加 KV Namespace 绑定。

3.  **创建 KV Namespace**:
    ```bash
    # 创建生产环境 KV
    npx wrangler kv namespace create "CLAUDE_KV"
    # 为本地开发创建预览环境 KV
    npx wrangler kv namespace create "CLAUDE_KV" --preview
    ```
    Wrangler 会提示您将输出的配置添加到 `wrangler.jsonc` 文件中。

4.  **设置密钥**:
    ```bash
    npx wrangler secret put ADMIN_PASSWORD
    ```

5.  **部署**:
    ```bash
    npx wrangler deploy
    ```

6.  **初始化 KV 数据 (CLI 方式)**:
    您可以使用 `wrangler kv` 命令直接上传您的初始数据。
    ```bash
    # 确保 initial-sk-map.json 文件已填充好您的数据
    npx wrangler kv key put "EMAIL_TO_SK_MAP" --path ./initial-sk-map.json --binding CLAUDE_KV --remote
    ```

---

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
-   **请求体**: `{"mode": "specific" | "random", "email"?: "...", "unique_name"?: "...", "expires_in"?: number}`
    -   **`expires_in`** (可选, 数字): 期望的令牌有效时间，单位为秒。
    -   **行为**: 实际的有效时间受 `TOKEN_EXPIRES_IN` 环境变量的限制。如果您请求的时长超过了允许的最大值，它将被自动缩减至最大值，并且 API 响应中会包含一个 `warning` 字段。如果 `TOKEN_EXPIRES_IN` 未设置或为 `0`，则没有上限。
-   **成功响应**: `{"login_url": "...", "warning"?: "..."}`
    -   成功时返回 `login_url`。
    -   如果 `expires_in` 被调整，则会额外返回一个 `warning` 警告信息。

### 管理员端点

管理员端点需要 `admin_password` 进行身份验证。

#### 1. 管理员登录到 Claude (无限制)
-   **目的**: 获取 Claude AI 的临时登录 URL，绕过面向用户的有效期限制。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/login`
-   **请求体**: `{"admin_password": "...", "mode": "specific" | "random", "email"?: "...", "unique_name"?: "...", "expires_in"?: number}`
    -   **`expires_in`** (可选, 数字): 期望的令牌有效时间，单位为秒。如果未提供，默认为 `0` (无期限)。该值 **不受** `TOKEN_EXPIRES_IN` 环境变量的限制。

#### 2. 列出 Email-SK 对
-   **目的**: 检索所有已配置 Email 地址及其 SK 预览的列表。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/list`
-   **请求体**: `{"admin_password": "..."}`

#### 3. 添加 Email-SK 对
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

#### 5. 批量添加/删除 Email-SK 对
-   **目的**: 在单个请求中添加或删除多个 Email-SK 对。这是初始化或批量管理 KV 存储的理想方式。
-   **HTTP 方法**: `POST`
-   **URL 路径**: `/api/admin/batch`
-   **请求体**: 
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
-   **详细说明**:
    -   `actions` 数组可以包含任意数量的 `add` 或 `delete` 操作。
    -   对于 `add` 操作, `email` 和 `sk` 都是必需的。如果某个 email 已存在, 其 SK 将被更新。
    -   对于 `delete` 操作, 只需要 `email`。
    -   响应中将返回一个关于每个操作状态的详细报告。

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

---
## 授权协议
本仓库遵循 [MIT License](./LICENSE) 开源协议。
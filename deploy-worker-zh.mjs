import { execSync, exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts'; // 用于用户交互输入

// --- 配置信息 ---
const DEFAULT_WRANGLER_CONFIG_PATH = './wrangler.jsonc';
const DEFAULT_INITIAL_SK_MAP_PATH = './initial-sk-map.json'; // 示例路径
const DEFAULT_WORKER_NAME_PREFIX = 'fuclaude-pool-manager';
const DEFAULT_KV_NAMESPACE_PREFIX = 'CLAUDE_KV_STORE';
const DEFAULT_BASE_URL = 'https://claude.ai';
const KV_BINDING_NAME = 'CLAUDE_KV'; // 与 src/index.ts 中使用的名称一致

// --- 辅助函数 ---
function executeCommand(command, options = {}) {
  console.log(`\n▶️ 正在执行: ${command}`);
  try {
    const output = execSync(command, { stdio: 'pipe', ...options }); // 使用 pipe 捕获输出
    const stdout = output.toString().trim();
    if (stdout) console.log(`✅ 输出:\n${stdout}`);
    return stdout;
  } catch (error) {
    console.error(`❌ 执行命令时出错: ${command}`);
    if (error.stdout) console.error(`标准输出: ${error.stdout.toString()}`);
    if (error.stderr) console.error(`标准错误: ${error.stderr.toString()}`);
    throw error; // 抛出错误以在关键错误时停止脚本
  }
}

async function executeCommandAsync(command, options = {}) {
  console.log(`\n▶️ 正在执行 (异步): ${command}`);
  return new Promise((resolve, reject) => {
    const process = exec(command, { ...options }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ 执行异步命令时出错: ${command}`);
        if (stdout) console.error(`标准输出: ${stdout.toString()}`);
        if (stderr) console.error(`标准错误: ${stderr.toString()}`);
        reject(error);
        return;
      }
      const output = stdout.toString().trim();
      if (output) console.log(`✅ 异步输出:\n${output}`);
      resolve(output);
    });
    process.stdout.pipe(process.stdout); // 将子进程 stdout 导向主进程 stdout
    process.stderr.pipe(process.stderr); // 将子进程 stderr 导向主进程 stderr
  });
}


async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`读取或解析 JSON 文件 ${filePath} 时出错:`, error);
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💾 JSON 数据已写入 ${filePath}`);
  } catch (error) {
    console.error(`写入 JSON 文件 ${filePath} 时出错:`, error);
    throw error;
  }
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// --- 主要部署逻辑 ---
async function deploy() {
  console.log('🚀 开始 Cloudflare Worker 部署脚本 🚀');

  try {
    // --- 步骤 0: 检查 Wrangler 登录状态并获取账户 ID ---
    console.log('正在检查 Wrangler 登录状态...');
    let accountId;
    try {
      const whoamiOutput = executeCommand('wrangler whoami');
      // 示例解析 (非常基础, Wrangler 的输出格式可能会改变)
      const accountIdMatch = whoamiOutput.match(/Account ID:\s*([a-f0-9]+)/i);
      if (!accountIdMatch || !accountIdMatch[1]) {
        throw new Error("无法从 'wrangler whoami' 解析账户 ID。");
      }
      accountId = accountIdMatch[1];
      console.log(`✅ 已登录。账户 ID: ${accountId}`);
    } catch (e) {
      console.error("❌ 未登录到 Wrangler 或 'wrangler whoami' 执行失败。");
      console.log("请手动运行 'wrangler login'，然后重新运行此脚本。");
      process.exit(1);
    }

    // --- 步骤 1: 收集配置信息 ---
    const responses = await prompts([
      {
        type: 'text',
        name: 'workerName',
        message: '为您的 Worker 输入一个名称 (字母数字, 短横线):',
        initial: `${DEFAULT_WORKER_NAME_PREFIX}-${Date.now().toString(36)}`, // 唯一的默认值
        validate: value => /^[a-zA-Z0-9-]+$/.test(value) ? true : 'Worker 名称包含无效字符。'
      },
      {
        type: 'text',
        name: 'kvNamespaceName',
        message: '为要创建的 KV Namespace 输入一个名称:',
        initial: `${DEFAULT_KV_NAMESPACE_PREFIX}_${Date.now().toString(36)}`,
        validate: value => /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 64 ? true : 'KV Namespace 名称包含无效字符或长度超过64。'
      },
      {
        type: 'text',
        name: 'baseUrl',
        message: '输入 Claude API 的 BASE_URL:',
        initial: DEFAULT_BASE_URL
      },
      {
        type: 'text',
        name: 'wranglerConfigPath',
        message: '您的 wrangler.jsonc 文件路径:',
        initial: DEFAULT_WRANGLER_CONFIG_PATH
      }
    ]);

    const { workerName, kvNamespaceName, baseUrl, wranglerConfigPath } = responses;

    if (!workerName || !kvNamespaceName || !baseUrl || !wranglerConfigPath) {
        console.log('❌ 部署已取消：缺少必要的输入信息。');
        process.exit(1);
    }
    
    // --- 步骤 2: 准备或更新 wrangler.jsonc ---
    let wranglerConfig;
    if (await fileExists(wranglerConfigPath)) {
        console.log(`正在读取现有的 wrangler 配置文件: ${wranglerConfigPath}`);
        wranglerConfig = await readJsonFile(wranglerConfigPath);
    } else {
        console.log(`正在创建新的 wrangler 配置文件: ${wranglerConfigPath}`);
        wranglerConfig = {
            main: "src/index.ts", // 默认入口点
            compatibility_date: new Date().toISOString().split('T')[0] // 今日日期
        };
    }

    wranglerConfig.name = workerName;
    wranglerConfig.account_id = accountId;
    wranglerConfig.vars = { ...(wranglerConfig.vars || {}), BASE_URL: baseUrl };
    // KV namespace 将在创建后添加

    console.log('📝 wrangler.jsonc 内容 (添加 KV 绑定之前):', JSON.stringify(wranglerConfig, null, 2));


    // --- 步骤 3: 创建 KV Namespace ---
    console.log(`正在创建 KV Namespace: ${kvNamespaceName}...`);
    let kvId, kvPreviewId;
    try {
        const listOutput = executeCommand(`wrangler kv:namespace list --json`);
        const existingNamespaces = JSON.parse(listOutput);
        const existingKv = existingNamespaces.find(ns => ns.title === kvNamespaceName);

        if (existingKv) {
            console.log(`KV Namespace "${kvNamespaceName}" 已存在。使用现有 ID。`);
            kvId = existingKv.id;
            console.warn(`正在尝试使用现有的 KV namespace。如果之前未在 wrangler.jsonc 中为此 KV 配置 preview_id，则可能需要手动配置。`);
        } else {
            const kvCreateOutput = executeCommand(`wrangler kv:namespace create "${kvNamespaceName}" --json`);
            const kvInfo = JSON.parse(kvCreateOutput);
            kvId = kvInfo.id;
            kvPreviewId = kvInfo.preview_id; 
            if (!kvId) throw new Error('未能从创建输出中解析 KV ID。');
            console.log(`✅ KV Namespace 已创建。ID: ${kvId}, Preview ID: ${kvPreviewId || 'N/A (可能需要在 wrangler.jsonc 中为开发环境配置)'}`);
        }

    } catch (error) {
        console.error('❌ 创建或查找 KV Namespace 失败。');
        throw error;
    }
    
    // --- 步骤 4: 更新 wrangler.jsonc 以添加 KV 绑定 ---
    wranglerConfig.kv_namespaces = [
      {
        binding: KV_BINDING_NAME,
        id: kvId,
        ...(kvPreviewId && { preview_id: kvPreviewId }) 
      },
      ...(wranglerConfig.kv_namespaces?.filter(ns => ns.binding !== KV_BINDING_NAME) || [])
    ];
    await writeJsonFile(wranglerConfigPath, wranglerConfig);
    console.log('📝 wrangler.jsonc 已更新 KV 绑定信息。');

    // --- 步骤 5: 部署 Worker ---
    console.log(`正在使用 ${wranglerConfigPath} 部署 Worker ${workerName}...`);
    executeCommand(`wrangler deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
    console.log('✅ Worker 部署成功。');

    // --- 步骤 6: 设置 ADMIN_PASSWORD Secret ---
    const { adminPassword } = await prompts({
      type: 'password',
      name: 'adminPassword',
      message: '为 Worker 输入 ADMIN_PASSWORD (将作为 Secret 设置):'
    });
    if (adminPassword) {
      executeCommand(`wrangler secret put ADMIN_PASSWORD`, { input: adminPassword });
      console.log('✅ ADMIN_PASSWORD Secret 已设置。');
    } else {
      console.log('⚠️ ADMIN_PASSWORD 未设置 (输入为空)。');
    }

    // --- (可选) 步骤 6b: 设置 SENTRY_DSN Secret ---
    const { sentryDsn } = await prompts({
        type: 'text', 
        name: 'sentryDsn',
        message: '输入 SENTRY_DSN (可选, 留空则跳过):'
    });
    if (sentryDsn) {
        executeCommand(`wrangler secret put SENTRY_DSN`, { input: sentryDsn });
        console.log('✅ SENTRY_DSN Secret 已设置。');
    } else {
        console.log('ℹ️ SENTRY_DSN 未设置。');
    }


    // --- 步骤 7: 初始化 KV 数据 ---
    const { setupKv } = await prompts({
        type: 'confirm',
        name: 'setupKv',
        message: `您想在 KV Namespace "${kvNamespaceName}" 中初始化 EMAIL_TO_SK_MAP 吗?`,
        initial: true
    });

    if (setupKv) {
        const { kvInitPath } = await prompts({
            type: 'text',
            name: 'kvInitPath',
            message: `输入用于初始化 SK 地图的 JSON 文件路径 (或留空以使用空地图):`,
            initial: DEFAULT_INITIAL_SK_MAP_PATH
        });

        let kvData = "{}"; // 默认为空地图
        if (kvInitPath && await fileExists(kvInitPath)) {
            try {
                const fileContent = await fs.readFile(kvInitPath, 'utf-8');
                JSON.parse(fileContent); // 验证 JSON
                console.log(`正在使用文件中的数据初始化 KV: ${kvInitPath}`);
                 executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" --path "${kvInitPath}" --binding ${KV_BINDING_NAME}`);
                if (kvPreviewId) { 
                    executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" --path "${kvInitPath}" --binding ${KV_BINDING_NAME} --preview`);
                } else {
                    console.warn('Preview KV 未更新，因为在创建 KV Namespace 时 preview_id 不可用或未设置。');
                }
            } catch (err) {
                console.error(`❌ 读取或解析初始 SK 地图文件 ${kvInitPath} 时出错。将使用空地图。`, err);
                executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME}`);
                if (kvPreviewId) executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME} --preview`);
            }
        } else {
            if (kvInitPath) console.log(`⚠️ 未找到初始 SK 地图文件: ${kvInitPath}。将使用空地图。`);
            else console.log(`正在使用空地图初始化 KV。`);
            executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME}`);
            if (kvPreviewId) executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME} --preview`);
        }
        console.log('✅ EMAIL_TO_SK_MAP 已在 KV 中初始化。');
    }

    console.log('\n🎉 Cloudflare Worker 部署和设置过程完成! 🎉');
    console.log(`Worker 名称: ${workerName}`);
    // wrangler deploy 命令通常会打印 URL。

  } catch (error) {
    console.error('\n❌ 部署脚本失败:', error.message || error);
    process.exit(1);
  }
}

// 运行部署函数
deploy();
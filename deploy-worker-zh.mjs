import { execSync, exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import prompts from 'prompts'; // 用于用户交互输入

const WRANGLER_CMD = 'npx wrangler';

// --- 配置信息 ---
const DEFAULT_WRANGLER_CONFIG_PATH = './wrangler.jsonc';
const DEFAULT_INITIAL_SK_MAP_PATH = './initial-sk-map.json'; // 示例路径
const DEFAULT_WORKER_NAME_PREFIX = 'fuclaude-pool-manager';
const DEFAULT_KV_NAMESPACE_PREFIX = 'CLAUDE_KV_STORE';
const DEFAULT_BASE_URL = 'https://demo.fuclaude.com';
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
    const fileContent = await fs.readFile(filePath, 'utf-8');
    // 移除 BOM (如果存在)
    const cleanedContent = fileContent.replace(/^\uFEFF/, '');
    // 移除 JSONC 中的注释，然后再解析
    const jsonString = cleanedContent.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(jsonString);
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
      const whoamiOutput = executeCommand(`${WRANGLER_CMD} whoami`);
      // 示例解析 (非常基础, Wrangler 的输出格式可能会改变)
      const accountIdMatch = whoamiOutput.match(/│\s*.*\s*│\s*([a-f0-9]{32})\s*│/i);
      if (!accountIdMatch || !accountIdMatch[1]) {
        throw new Error(`无法从 '${WRANGLER_CMD} whoami' 解析账户 ID。`);
      }
      accountId = accountIdMatch[1];
      console.log(`✅ 已登录。账户 ID: ${accountId}`);
    } catch (e) {
      console.error(`❌ 未登录到 Wrangler 或 '${WRANGLER_CMD} whoami' 执行失败。`);
      console.log(`请手动运行 '${WRANGLER_CMD} login'，然后重新运行此脚本。`);
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
        const listOutput = executeCommand(`${WRANGLER_CMD} kv namespace list`);
        const listRegex = new RegExp(`│\\s*${kvNamespaceName}\\s*│\\s*([a-f0-9]{32})\\s*│`, "i");
        const listMatch = listOutput.match(listRegex);

        if (listMatch && listMatch[1]) {
            kvId = listMatch[1];
            console.log(`✅ KV Namespace "${kvNamespaceName}" 已存在。使用现有 ID: ${kvId}`);
            console.warn(`⚠️ 注意: 使用现有 KV namespace 时，无法自动获取 preview_id。如果开发环境需要，请确保它已在 wrangler.jsonc 中配置。`);
        } else {
            console.log(`KV Namespace "${kvNamespaceName}" 不存在，正在创建...`);
            const kvCreateOutput = executeCommand(`${WRANGLER_CMD} kv namespace create "${kvNamespaceName}"`);
            
            // 尝试从输出中解析 ID 和 Preview ID
            const idMatch = kvCreateOutput.match(/"id":\s*"([a-f0-9]{32})"/);
            const previewIdMatch = kvCreateOutput.match(/"preview_id":\s*"([a-f0-9]{32})"/);

            if (idMatch && idMatch[1]) {
                kvId = idMatch[1];
                if (previewIdMatch && previewIdMatch[1]) {
                    kvPreviewId = previewIdMatch[1];
                }
                console.log(`✅ KV Namespace 已创建。ID: ${kvId}, Preview ID: ${kvPreviewId || 'N/A'}`);
            } else {
                throw new Error('未能从创建命令的输出中解析 KV ID。请检查 wrangler 的输出。');
            }
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
    executeCommand(`${WRANGLER_CMD} deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
    console.log('✅ Worker 部署成功。');

    // --- 步骤 6: 设置 ADMIN_PASSWORD Secret ---
    const { adminPassword } = await prompts({
      type: 'password',
      name: 'adminPassword',
      message: '为 Worker 输入 ADMIN_PASSWORD (将作为 Secret 设置):'
    });
    if (adminPassword) {
      executeCommand(`${WRANGLER_CMD} secret put ADMIN_PASSWORD`, { input: adminPassword });
      console.log('✅ ADMIN_PASSWORD Secret 已设置。');
    } else {
      console.log('⚠️ ADMIN_PASSWORD 未设置 (输入为空)。');
    }

    // --- (可选) 步骤 6b: 设置 TOKEN_EXPIRES_IN 变量 ---
    const { tokenExpiresIn } = await prompts({
        type: 'text',
        name: 'tokenExpiresIn',
        message: '输入默认的令牌有效时间（秒） (例如, 86400 代表24小时, 可选, 留空则永不过期):',
        validate: value => (!value || /^\d+$/.test(value)) ? true : '请输入一个有效的数字（秒）。'
    });
    if (tokenExpiresIn) {
        // 这是一个普通变量, 不是 secret
        wranglerConfig.vars = { ...(wranglerConfig.vars || {}), TOKEN_EXPIRES_IN: tokenExpiresIn };
        await writeJsonFile(wranglerConfigPath, wranglerConfig);
        console.log('✅ TOKEN_EXPIRES_IN 变量已在 wrangler.jsonc 中设置。正在重新部署以应用...');
        executeCommand(`${WRANGLER_CMD} deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
        console.log('✅ 重新部署完成。');
    } else {
        console.log('ℹ️ TOKEN_EXPIRES_IN 未设置。令牌将默认永不过期。');
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
                const cleanedContent = fileContent.replace(/^\uFEFF/, '');
                const jsonObj = JSON.parse(cleanedContent); // 验证并解析
                kvData = JSON.stringify(jsonObj); // 使用清理和压缩后的 JSON
                console.log(`正在使用文件中的数据初始化 KV: ${kvInitPath}`);
            } catch (err) {
                console.error(`❌ 读取或解析初始 SK 地图文件 ${kvInitPath} 时出错。将使用空地图。`, err);
                kvData = "{}"; // 回退到空地图
            }
        } else {
            if (kvInitPath) console.log(`⚠️ 未找到初始 SK 地图文件: ${kvInitPath}。将使用空地图。`);
            else console.log(`正在使用空地图初始化 KV。`);
        }

        // 使用临时文件将数据传递给 wrangler，以避免所有 shell 的引用问题。
        const tempFilePath = path.join(os.tmpdir(), `temp-sk-map-${Date.now()}.json`);
        try {
            await fs.writeFile(tempFilePath, kvData, 'utf-8');
            
            executeCommand(`${WRANGLER_CMD} kv key put "EMAIL_TO_SK_MAP" --path "${tempFilePath}" --binding ${KV_BINDING_NAME} --remote`);
            if (kvPreviewId) {
                executeCommand(`${WRANGLER_CMD} kv key put "EMAIL_TO_SK_MAP" --path "${tempFilePath}" --binding ${KV_BINDING_NAME} --preview --remote`);
            }
            console.log('✅ EMAIL_TO_SK_MAP 已在 KV 中初始化。');

        } finally {
            // 清理临时文件
            await fs.unlink(tempFilePath).catch(err => console.error(`⚠️ 无法删除临时文件 ${tempFilePath}:`, err));
        }
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
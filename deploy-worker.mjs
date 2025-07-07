import { execSync, exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import prompts from 'prompts'; // For user input

const WRANGLER_CMD = 'npx wrangler';

// --- Configuration ---
const DEFAULT_WRANGLER_CONFIG_PATH = './wrangler.jsonc';
const DEFAULT_INITIAL_SK_MAP_PATH = './initial-sk-map.json'; // Example path
const DEFAULT_WORKER_NAME_PREFIX = 'fuclaude-pool-manager';
const DEFAULT_KV_NAMESPACE_PREFIX = 'CLAUDE_KV_STORE';
const DEFAULT_BASE_URL = 'https://demo.fuclaude.com';
const KV_BINDING_NAME = 'CLAUDE_KV'; // As used in src/index.ts

// --- Helper Functions ---
function executeCommand(command, options = {}) {
  console.log(`\n▶️ Executing: ${command}`);
  try {
    const output = execSync(command, { stdio: 'pipe', ...options }); // Use pipe to capture output
    const stdout = output.toString().trim();
    if (stdout) console.log(`✅ Output:\n${stdout}`);
    return stdout;
  } catch (error) {
    console.error(`❌ Error executing command: ${command}`);
    if (error.stdout) console.error(`Stdout: ${error.stdout.toString()}`);
    if (error.stderr) console.error(`Stderr: ${error.stderr.toString()}`);
    throw error; // Re-throw to stop script on critical errors
  }
}

async function executeCommandAsync(command, options = {}) {
  console.log(`\n▶️ Executing (async): ${command}`);
  return new Promise((resolve, reject) => {
    const process = exec(command, { ...options }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error executing async command: ${command}`);
        if (stdout) console.error(`Stdout: ${stdout.toString()}`);
        if (stderr) console.error(`Stderr: ${stderr.toString()}`);
        reject(error);
        return;
      }
      const output = stdout.toString().trim();
      if (output) console.log(`✅ Async Output:\n${output}`);
      resolve(output);
    });
    process.stdout.pipe(process.stdout); // Pipe child process stdout to main stdout
    process.stderr.pipe(process.stderr); // Pipe child process stderr to main stderr
  });
}


async function readJsonFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    // Remove BOM (if present)
    const cleanedContent = fileContent.replace(/^\uFEFF/, '');
    // Strip comments from JSONC before parsing
    const jsonString = cleanedContent.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`Error reading or parsing JSON file ${filePath}:`, error);
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💾 JSON data written to ${filePath}`);
  } catch (error) {
    console.error(`Error writing JSON file ${filePath}:`, error);
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

// --- Main Deployment Logic ---
async function deploy() {
  console.log('🚀 Starting Cloudflare Worker Deployment Script 🚀');

  try {
    // --- Step 0: Check Wrangler Login & Get Account ID ---
    console.log('Checking Wrangler login status...');
    let accountId;
    try {
      const whoamiOutput = executeCommand(`${WRANGLER_CMD} whoami`);
      const accountIdMatch = whoamiOutput.match(/│\s*.*\s*│\s*([a-f0-9]{32})\s*│/i);
      if (!accountIdMatch || !accountIdMatch[1]) {
        throw new Error(`Could not parse Account ID from '${WRANGLER_CMD} whoami'.`);
      }
      accountId = accountIdMatch[1];
      console.log(`✅ Logged in. Account ID: ${accountId}`);
    } catch (e) {
      console.error(`❌ Not logged into Wrangler or '${WRANGLER_CMD} whoami' failed.`);
      console.log(`Please run '${WRANGLER_CMD} login' manually and then re-run this script.`);
      process.exit(1);
    }

    // --- Step 1: Gather Configuration ---
    const responses = await prompts([
      {
        type: 'text',
        name: 'workerName',
        message: 'Enter a name for your Worker (alphanumeric, dashes):',
        initial: `${DEFAULT_WORKER_NAME_PREFIX}-${Date.now().toString(36)}`, // Unique default
        validate: value => /^[a-zA-Z0-9-]+$/.test(value) ? true : 'Invalid characters in Worker name.'
      },
      {
        type: 'text',
        name: 'kvNamespaceName',
        message: 'Enter a name for the KV Namespace to create:',
        initial: `${DEFAULT_KV_NAMESPACE_PREFIX}_${Date.now().toString(36)}`,
        validate: value => /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 64 ? true : 'Invalid characters in KV Namespace name (max 64 chars).' // Cloudflare has length limits
      },
      {
        type: 'text',
        name: 'baseUrl',
        message: 'Enter the BASE_URL for the Claude API:',
        initial: DEFAULT_BASE_URL
      },
      {
        type: 'text',
        name: 'wranglerConfigPath',
        message: 'Path to your wrangler.jsonc file:',
        initial: DEFAULT_WRANGLER_CONFIG_PATH
      }
    ]);

    const { workerName, kvNamespaceName, baseUrl, wranglerConfigPath } = responses;

    if (!workerName || !kvNamespaceName || !baseUrl || !wranglerConfigPath) {
        console.log('❌ Deployment cancelled: Missing required inputs.');
        process.exit(1);
    }
    
    // --- Step 2: Prepare or Update wrangler.jsonc ---
    let wranglerConfig;
    if (await fileExists(wranglerConfigPath)) {
        console.log(`Reading existing wrangler config: ${wranglerConfigPath}`);
        wranglerConfig = await readJsonFile(wranglerConfigPath);
    } else {
        console.log(`Creating new wrangler config: ${wranglerConfigPath}`);
        wranglerConfig = {
            main: "src/index.ts", // Default entry point
            compatibility_date: new Date().toISOString().split('T')[0] // Today's date
        };
    }

    wranglerConfig.name = workerName;
    wranglerConfig.account_id = accountId;
    wranglerConfig.vars = { ...(wranglerConfig.vars || {}), BASE_URL: baseUrl };
    // KV namespace will be added after creation

    console.log('📝 wrangler.jsonc content (before KV binding):', JSON.stringify(wranglerConfig, null, 2));


    // --- Step 3: Create KV Namespace ---
    console.log(`Creating KV Namespace: ${kvNamespaceName}...`);
    let kvId, kvPreviewId;
    try {
        const listOutput = executeCommand(`${WRANGLER_CMD} kv namespace list`);
        const listRegex = new RegExp(`│\\s*${kvNamespaceName}\\s*│\\s*([a-f0-9]{32})\\s*│`, "i");
        const listMatch = listOutput.match(listRegex);

        if (listMatch && listMatch[1]) {
            kvId = listMatch[1];
            console.log(`✅ KV Namespace "${kvNamespaceName}" already exists. Using existing ID: ${kvId}`);
            console.warn(`⚠️ NOTE: When using an existing KV namespace, the preview_id cannot be retrieved automatically. Please ensure it is configured in wrangler.jsonc if needed for development.`);
        } else {
            console.log(`KV Namespace "${kvNamespaceName}" does not exist, creating...`);
            const kvCreateOutput = executeCommand(`${WRANGLER_CMD} kv namespace create "${kvNamespaceName}"`);
            
            // Try to parse ID and Preview ID from the output
            const idMatch = kvCreateOutput.match(/"id":\s*"([a-f0-9]{32})"/);
            const previewIdMatch = kvCreateOutput.match(/"preview_id":\s*"([a-f0-9]{32})"/);

            if (idMatch && idMatch[1]) {
                kvId = idMatch[1];
                if (previewIdMatch && previewIdMatch[1]) {
                    kvPreviewId = previewIdMatch[1];
                }
                console.log(`✅ KV Namespace created. ID: ${kvId}, Preview ID: ${kvPreviewId || 'N/A'}`);
            } else {
                throw new Error('Failed to parse KV ID from the creation command output. Please check wrangler\'s output.');
            }
        }
    } catch (error) {
        console.error('❌ Failed to create or find KV Namespace.');
        throw error;
    }
    
    // --- Step 4: Update wrangler.jsonc with KV Binding ---
    wranglerConfig.kv_namespaces = [
      {
        binding: KV_BINDING_NAME,
        id: kvId,
        ...(kvPreviewId && { preview_id: kvPreviewId }) // Add preview_id only if available
      },
      // Keep any other existing KV bindings if necessary (more complex logic)
      ...(wranglerConfig.kv_namespaces?.filter(ns => ns.binding !== KV_BINDING_NAME) || [])
    ];
    await writeJsonFile(wranglerConfigPath, wranglerConfig);
    console.log('📝 wrangler.jsonc updated with KV binding.');

    // --- Step 5: Deploy Worker ---
    console.log(`Deploying Worker ${workerName} using ${wranglerConfigPath}...`);
    // Pass --config flag if wrangler.jsonc is not in the current dir or has a different name
    // Assuming script is run from project root where wrangler.jsonc is.
    executeCommand(`${WRANGLER_CMD} deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
    console.log('✅ Worker deployed successfully.');

    // --- Step 6: Set ADMIN_PASSWORD Secret ---
    const { adminPassword } = await prompts({
      type: 'password',
      name: 'adminPassword',
      message: 'Enter the ADMIN_PASSWORD for the Worker (will be set as a secret):'
    });
    if (adminPassword) {
      // Need to pass input to stdin for wrangler secret put
      executeCommand(`${WRANGLER_CMD} secret put ADMIN_PASSWORD`, { input: adminPassword });
      console.log('✅ ADMIN_PASSWORD secret set.');
    } else {
      console.log('⚠️ ADMIN_PASSWORD not set (input was empty).');
    }

    // --- (Optional) Step 6b: Set TOKEN_EXPIRES_IN Variable ---
    const { tokenExpiresIn } = await prompts({
        type: 'text',
        name: 'tokenExpiresIn',
        message: 'Enter default token expiration in seconds (e.g., 86400 for 24h, optional, leave blank for no expiration):',
        validate: value => (!value || /^\d+$/.test(value)) ? true : 'Please enter a valid number of seconds.'
    });
    if (tokenExpiresIn) {
        // This is a regular variable, not a secret
        wranglerConfig.vars = { ...(wranglerConfig.vars || {}), TOKEN_EXPIRES_IN: tokenExpiresIn };
        await writeJsonFile(wranglerConfigPath, wranglerConfig);
        console.log('✅ TOKEN_EXPIRES_IN variable set in wrangler.jsonc. Re-deploying to apply...');
        executeCommand(`${WRANGLER_CMD} deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
        console.log('✅ Re-deployment complete.');
    } else {
        console.log('ℹ️ TOKEN_EXPIRES_IN not set. Tokens will not expire by default.');
    }


    // --- Step 7: Initialize KV Data ---
    const { setupKv } = await prompts({
        type: 'confirm',
        name: 'setupKv',
        message: `Do you want to initialize EMAIL_TO_SK_MAP in KV Namespace "${kvNamespaceName}"?`,
        initial: true
    });

    if (setupKv) {
        const { kvInitPath } = await prompts({
            type: 'text',
            name: 'kvInitPath',
            message: `Enter path to JSON file for initial SK map (or leave blank for empty map):`,
            initial: DEFAULT_INITIAL_SK_MAP_PATH
        });

        let kvData = "{}"; // Default to empty map
        if (kvInitPath && await fileExists(kvInitPath)) {
            try {
                const fileContent = await fs.readFile(kvInitPath, 'utf-8');
                const cleanedContent = fileContent.replace(/^\uFEFF/, '');
                const jsonObj = JSON.parse(cleanedContent); // Validate and parse
                kvData = JSON.stringify(jsonObj); // Use the cleaned and compacted JSON
                console.log(`Initializing KV with data from: ${kvInitPath}`);
            } catch (err) {
                console.error(`❌ Error reading or parsing initial SK map file ${kvInitPath}. Defaulting to empty map.`, err);
                kvData = "{}"; // Fallback to empty map
            }
        } else {
            if (kvInitPath) console.log(`⚠️ Initial SK map file not found: ${kvInitPath}. Using empty map.`);
            else console.log(`Initializing KV with an empty map.`);
        }

        // Use a temporary file to pass data to wrangler, avoiding all shell quoting issues.
        const tempFilePath = path.join(os.tmpdir(), `temp-sk-map-${Date.now()}.json`);
        try {
            await fs.writeFile(tempFilePath, kvData, 'utf-8');
            
            executeCommand(`${WRANGLER_CMD} kv key put "EMAIL_TO_SK_MAP" --path "${tempFilePath}" --binding ${KV_BINDING_NAME} --remote`);
            if (kvPreviewId) {
                executeCommand(`${WRANGLER_CMD} kv key put "EMAIL_TO_SK_MAP" --path "${tempFilePath}" --binding ${KV_BINDING_NAME} --preview --remote`);
            }
            console.log('✅ EMAIL_TO_SK_MAP initialized in KV.');

        } finally {
            // Clean up the temporary file
            await fs.unlink(tempFilePath).catch(err => console.error(`⚠️ Could not delete temp file ${tempFilePath}:`, err));
        }
    }


    console.log('\n🎉 Cloudflare Worker deployment and setup process complete! 🎉');
    console.log(`Worker Name: ${workerName}`);
    // Wrangler deploy command usually prints the URL.

  } catch (error) {
    console.error('\n❌ Deployment script failed:', error.message || error);
    process.exit(1);
  }
}

// Run the deployment function
deploy();
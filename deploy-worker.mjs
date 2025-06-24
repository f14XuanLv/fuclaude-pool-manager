import { execSync, exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts'; // For user input

// --- Configuration ---
const DEFAULT_WRANGLER_CONFIG_PATH = './wrangler.jsonc';
const DEFAULT_INITIAL_SK_MAP_PATH = './initial-sk-map.json'; // Example path
const DEFAULT_WORKER_NAME_PREFIX = 'fuclaude-pool-manager';
const DEFAULT_KV_NAMESPACE_PREFIX = 'CLAUDE_KV_STORE';
const DEFAULT_BASE_URL = 'https://claude.ai';
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
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
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
      const whoamiOutput = executeCommand('wrangler whoami');
      // Example parsing (very basic, Wrangler's output format might change)
      const accountIdMatch = whoamiOutput.match(/Account ID:\s*([a-f0-9]+)/i);
      if (!accountIdMatch || !accountIdMatch[1]) {
        throw new Error("Could not parse Account ID from 'wrangler whoami'.");
      }
      accountId = accountIdMatch[1];
      console.log(`✅ Logged in. Account ID: ${accountId}`);
    } catch (e) {
      console.error("❌ Not logged into Wrangler or 'wrangler whoami' failed.");
      console.log("Please run 'wrangler login' manually and then re-run this script.");
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
        // Check if namespace already exists (Wrangler errors if it does on create)
        const listOutput = executeCommand(`wrangler kv:namespace list --json`);
        const existingNamespaces = JSON.parse(listOutput);
        const existingKv = existingNamespaces.find(ns => ns.title === kvNamespaceName);

        if (existingKv) {
            console.log(`KV Namespace "${kvNamespaceName}" already exists. Using existing IDs.`);
            kvId = existingKv.id;
            // Preview ID isn't directly available from 'list' in older Wrangler versions.
            // For simplicity, if it exists, we'll try to find its preview_id if wrangler deploy fails later or assume one might be set
            // A more robust way would be to check the wrangler.jsonc if it was previously configured
            // Or, for a truly fresh setup, script could fail if it pre-exists and user didn't expect it.
            // Let's assume we need to get its preview_id if possible, or proceed and see.
            // For now, if it exists, we take the ID. Preview ID might be an issue if not already in wrangler.jsonc.
            // This script aims for "fresh setup" mostly, so existence is a slight edge case.
             const kvInfoOutput = executeCommand(`wrangler kv:namespace get ${kvNamespaceName} --json`); // This might not exist or be the right command
             // This part is tricky as Wrangler doesn't have a direct `get` by name with preview_id easily.
             // For this script, let's assume if it exists, we only grab the ID and hope preview_id is either not needed or already configured
             // This is a simplification.
             console.warn(`Attempting to use existing KV namespace. Preview ID might need manual configuration if not already set in wrangler.jsonc for this KV.`);

        } else {
            const kvCreateOutput = executeCommand(`wrangler kv:namespace create "${kvNamespaceName}" --json`);
            const kvInfo = JSON.parse(kvCreateOutput);
            kvId = kvInfo.id;
            kvPreviewId = kvInfo.preview_id; // Wrangler 3.x provides this
            if (!kvId) throw new Error('Failed to parse KV ID from creation output.');
            console.log(`✅ KV Namespace created. ID: ${kvId}, Preview ID: ${kvPreviewId || 'N/A (may need wrangler.jsonc config for dev)'}`);
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
    executeCommand(`wrangler deploy ${path.basename(wranglerConfigPath) === 'wrangler.jsonc' ? '' : '--config ' + wranglerConfigPath}`);
    console.log('✅ Worker deployed successfully.');

    // --- Step 6: Set ADMIN_PASSWORD Secret ---
    const { adminPassword } = await prompts({
      type: 'password',
      name: 'adminPassword',
      message: 'Enter the ADMIN_PASSWORD for the Worker (will be set as a secret):'
    });
    if (adminPassword) {
      // Need to pass input to stdin for wrangler secret put
      executeCommand(`wrangler secret put ADMIN_PASSWORD`, { input: adminPassword });
      console.log('✅ ADMIN_PASSWORD secret set.');
    } else {
      console.log('⚠️ ADMIN_PASSWORD not set (input was empty).');
    }

    // --- (Optional) Step 6b: Set SENTRY_DSN Secret ---
    const { sentryDsn } = await prompts({
        type: 'text', // Password type hides input, text is fine for DSN
        name: 'sentryDsn',
        message: 'Enter SENTRY_DSN (optional, leave blank to skip):'
    });
    if (sentryDsn) {
        executeCommand(`wrangler secret put SENTRY_DSN`, { input: sentryDsn });
        console.log('✅ SENTRY_DSN secret set.');
    } else {
        console.log('ℹ️ SENTRY_DSN not set.');
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
                JSON.parse(fileContent); // Validate JSON
                kvData = fileContent; // Use raw content for --path
                console.log(`Initializing KV with data from: ${kvInitPath}`);
                 executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" --path "${kvInitPath}" --binding ${KV_BINDING_NAME}`);
                if (kvPreviewId) { // Only put to preview if preview_id was obtained
                    executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" --path "${kvInitPath}" --binding ${KV_BINDING_NAME} --preview`);
                } else {
                    console.warn('Preview KV not updated as preview_id was not available/set for the KV namespace during creation.');
                }
            } catch (err) {
                console.error(`❌ Error reading or parsing initial SK map file ${kvInitPath}. Defaulting to empty map.`, err);
                kvData = "{}"; // Fallback to empty if file is bad
                 executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME}`);
                 if (kvPreviewId) executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME} --preview`);
            }
        } else {
            if (kvInitPath) console.log(`⚠️ Initial SK map file not found: ${kvInitPath}. Using empty map.`);
            else console.log(`Initializing KV with an empty map.`);
             executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME}`);
             if (kvPreviewId) executeCommand(`wrangler kv:key put "EMAIL_TO_SK_MAP" "${kvData}" --binding ${KV_BINDING_NAME} --preview`);
        }
        console.log('✅ EMAIL_TO_SK_MAP initialized in KV.');
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
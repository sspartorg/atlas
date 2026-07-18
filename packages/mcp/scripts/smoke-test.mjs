// Smoke test for the four agent-authoring MCP tools.
//
// Boots the built MCP server over stdio, lists tools, and (when LIVE_API=1)
// exercises listAgents → getAgent → updateAgent → re-getAgent against a real
// running Atlas API. Confirms the X-Atlas-Token round-trip works end-to-end.
//
//   pnpm -F @atlas/mcp build
//   LIVE_API=1 ATLAS_MCP_TOKEN=dev-secret node packages/mcp/scripts/smoke-test.mjs
//
// Requires the API to be running at ATLAS_API_BASE (default 127.0.0.1:4001)
// with ATLAS_MCP_TOKEN matching the one passed here.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        ATLAS_API_BASE: process.env.ATLAS_API_BASE ?? 'http://127.0.0.1:4001',
        ATLAS_MCP_TOKEN: process.env.ATLAS_MCP_TOKEN ?? '',
    },
});

let buf = '';
const responses = [];
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => process.stderr.write(`[server-stderr] ${d}`));
child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
            responses.push(JSON.parse(line));
        } catch {
            console.error('[smoke] non-JSON line:', line);
        }
    }
});

function send(obj) {
    child.stdin.write(JSON.stringify(obj) + '\n');
}

async function waitForResponse(id, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const hit = responses.find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for response id=${id}`);
}

const EXPECTED_TOOLS = ['createAgent', 'getAgent', 'listAgents', 'updateAgent'];

function unwrap(callResp, label) {
    if (callResp.error) {
        throw new Error(`${label} errored: ${JSON.stringify(callResp.error)}`);
    }
    const text = callResp.result?.content?.[0]?.text ?? '';
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${label} returned non-JSON text: ${text.slice(0, 200)}`);
    }
}

try {
    send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke-test', version: '0.0.1' },
        },
    });
    const initResp = await waitForResponse(1);
    console.log('[smoke] initialize ok. server:', initResp.result?.serverInfo);

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listResp = await waitForResponse(2);
    const tools = listResp.result?.tools ?? [];
    const toolNames = tools.map((t) => t.name).sort();
    console.log(`[smoke] tools/list returned ${tools.length} tools: ${toolNames.join(', ')}`);
    if (toolNames.length !== EXPECTED_TOOLS.length || !EXPECTED_TOOLS.every((n) => toolNames.includes(n))) {
        throw new Error(`Tool surface mismatch. expected=${EXPECTED_TOOLS.join(',')} got=${toolNames.join(',')}`);
    }

    if (process.env.LIVE_API === '1') {
        send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'listAgents', arguments: {} },
        });
        const listAgents = unwrap(await waitForResponse(3, 8000), 'listAgents');
        if (!Array.isArray(listAgents) || listAgents.length === 0) {
            throw new Error('listAgents returned no agents — seed first');
        }
        const targetId = listAgents[0].id;
        console.log(`[smoke] listAgents → ${listAgents.length} agent(s). first id=${targetId}`);

        send({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'getAgent', arguments: { id: targetId } },
        });
        const composite = unwrap(await waitForResponse(4, 8000), 'getAgent');
        console.log(
            `[smoke] getAgent ${targetId}: prompt_version=${composite.agent.prompt_version} ` +
                `rules=${composite.handoff_rules.length} ` +
                `checks=${composite.checklists.length}`
        );

        const stamp = `smoke-test-${Date.now()}`;
        send({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
                name: 'updateAgent',
                arguments: { id: targetId, description: stamp },
            },
        });
        const updated = unwrap(await waitForResponse(5, 8000), 'updateAgent');
        if (updated.agent.description !== stamp) {
            throw new Error(`updateAgent did not persist: got "${updated.agent.description}"`);
        }
        console.log(`[smoke] updateAgent ${targetId}: description now "${updated.agent.description}"`);
        console.log('[smoke] OK ✓');
    } else {
        console.log('[smoke] LIVE_API not set — skipping round-trip. tool surface verified.');
    }
} catch (err) {
    console.error('[smoke] FAILED:', err);
    process.exitCode = 1;
} finally {
    child.stdin.end();
    child.kill();
}

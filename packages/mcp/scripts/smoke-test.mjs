// Smoke test for the MCP server's tool surface.
//
// Boots the MCP server from source over stdio (through tsx, the way
// examples/claude-desktop-config.json runs it: `@atlas/shared` ships raw
// TypeScript, so a plain `node dist/index.js` can't load it), checks tools/list against the 13
// tools `src/tools/*.ts` register, and (when LIVE_API=1) round-trips the
// read-only tools against a real running Atlas API:
// listProjects → getProject, crud_agent search → get, search_item → get_item.
// Never writes, so it is safe to point at a dev stack with real data.
//
//   node packages/mcp/scripts/smoke-test.mjs
//   LIVE_API=1 ATLAS_API_BASE=http://127.0.0.1:4001 node packages/mcp/scripts/smoke-test.mjs
//
// SMOKE_QUERY (default `todo`) is the search_item keyword; zero hits just
// skips the get_item leg.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'index.ts');

const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), serverPath], {
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

const EXPECTED_TOOLS = [
    'agent_memory',
    'create_item',
    'crud_agent',
    'crud_reminder',
    'delete_item',
    'getProject',
    'get_item',
    'listProjects',
    'marketplace_agent',
    'search_item',
    'search_reminder',
    'sendExternalNotification',
    'update_item',
];

function unwrap(callResp, label) {
    const text = callResp.result?.content?.[0]?.text ?? '';
    if (callResp.error || callResp.result?.isError) {
        throw new Error(`${label} errored: ${JSON.stringify(callResp.error) ?? text}`);
    }
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
        let nextId = 3;
        const call = async (name, args, label = name) => {
            const id = nextId++;
            send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
            return unwrap(await waitForResponse(id, 8000), label);
        };

        const projects = await call('listProjects', {});
        if (!Array.isArray(projects)) throw new Error('listProjects did not return an array');
        console.log(`[smoke] listProjects → ${projects.length} project(s)`);
        if (projects.length > 0) {
            const project = await call('getProject', { id: projects[0].id });
            if (project.id !== projects[0].id) {
                throw new Error(`getProject returned id=${project.id}, expected ${projects[0].id}`);
            }
            console.log(`[smoke] getProject ${project.id}: ${project.name}`);
        }

        const agents = await call('crud_agent', { op: 'search' }, 'crud_agent search');
        if (!Array.isArray(agents)) throw new Error('crud_agent search did not return an array');
        console.log(`[smoke] crud_agent search → ${agents.length} agent(s)`);
        if (agents.length > 0) {
            const composite = await call('crud_agent', { op: 'get', id: agents[0].id }, 'crud_agent get');
            if (composite.agent?.id !== agents[0].id) {
                throw new Error(`crud_agent get returned agent=${composite.agent?.id}, expected ${agents[0].id}`);
            }
            console.log(
                `[smoke] crud_agent get ${composite.agent.id}: prompt_version=${composite.agent.prompt_version} ` +
                    `checks=${composite.checklists.length}`
            );
        }

        const query = process.env.SMOKE_QUERY ?? 'todo';
        const hits = await call('search_item', { query });
        if (!Array.isArray(hits)) throw new Error('search_item did not return an array');
        console.log(`[smoke] search_item "${query}" → ${hits.length} hit(s)`);
        if (hits.length > 0) {
            const { issue_type, issue_id } = hits[0];
            const full = await call('get_item', { issue_type, id: issue_id });
            if (full[issue_type]?.id !== issue_id) {
                throw new Error(`get_item ${issue_type} ${issue_id} did not return the item under \`${issue_type}\``);
            }
            console.log(`[smoke] get_item ${issue_type} ${issue_id}: ${full.comments.length} comment(s)`);
        }
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

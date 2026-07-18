import { Client } from 'pg';
import { loadConfig } from '../config.js';

async function waitForPg(): Promise<void> {
    const config = loadConfig();
    const deadline = Date.now() + 60_000;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
        const client = new Client({ connectionString: config.databaseUrl });
        try {
            await client.connect();
            await client.query('SELECT 1');
            await client.end();
            console.log('[wait-for-pg] postgres ready');
            return;
        } catch (err) {
            lastError = err;
            try {
                await client.end();
            } catch {
                // ignore
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    console.error('[wait-for-pg] timed out after 60s waiting for postgres');
    if (lastError) console.error(lastError);
    process.exit(1);
}

void waitForPg();

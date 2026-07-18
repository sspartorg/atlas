import { runSeed } from '../db/seed.js';
import { closeDb } from '../db/kysely-client.js';

async function main(): Promise<void> {
    await runSeed();
    await closeDb();
}

void main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
});

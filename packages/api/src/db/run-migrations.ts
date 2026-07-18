import Knex from 'knex';
import config from './knex-config.js';

async function main(): Promise<void> {
    const action = process.argv[2] ?? 'latest';
    const knex = Knex(config);
    try {
        if (action === 'latest') {
            const [batch, migrations] = await knex.migrate.latest();
            if ((migrations as string[]).length === 0) {
                console.log('[db] schema is already up to date');
            } else {
                console.log(`[db] applied batch ${batch}:`);
                for (const m of migrations as string[]) console.log(`  - ${m}`);
            }
        } else if (action === 'rollback') {
            const [batch, migrations] = await knex.migrate.rollback(undefined, false);
            console.log(`[db] rolled back batch ${batch}:`);
            for (const m of migrations as string[]) console.log(`  - ${m}`);
        } else if (action === 'status') {
            const completed = await knex.migrate.list();
            console.log('[db] completed:', completed[0]);
            console.log('[db] pending:  ', completed[1]);
        } else {
            console.error(`Unknown action: ${action} (expected: latest | rollback | status)`);
            process.exit(2);
        }
    } finally {
        await knex.destroy();
    }
}

void main().catch((err) => {
    console.error('[db] migration failed:', err);
    process.exit(1);
});

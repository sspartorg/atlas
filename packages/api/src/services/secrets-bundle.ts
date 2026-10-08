// Secrets bundle: every secret Atlas holds except git credentials, in one file
// the Owner carries to another machine. Values at rest are keyed to this
// machine (`crypto.ts`), so the bundle is sealed with a passphrase instead:
// scrypt → AES-256-GCM. Projects travel by issue key prefix; on import a
// prefix this install doesn't have is skipped, never created.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { z } from 'zod';
import { ExternalNotificationProviderSchema } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { environmentSecretsService } from './environment-secrets.js';
import { jiraSync } from './jira-sync.js';
import { projectEnvFileService } from './project-env-file.js';
import { settingsService } from './settings.js';

const FORMAT = 'atlas-secrets';
const VERSION = 1;
export const MIN_PASSPHRASE = 8;

const KeyValues = z.record(z.string(), z.string());

const PayloadSchema = z.object({
    shared: KeyValues,
    projects: z.record(z.string(), KeyValues),
    jira: z.object({ site_url: z.string(), email: z.string(), api_token: z.string() }).nullable(),
    notification: z
        .object({
            provider: ExternalNotificationProviderSchema,
            token: z.string().nullable(),
            chat_id: z.string().nullable(),
            webhook_url: z.string().nullable(),
        })
        .nullable(),
});
type Payload = z.infer<typeof PayloadSchema>;

export const SecretsBundleSchema = z.object({
    format: z.literal(FORMAT),
    version: z.number().int(),
    salt: z.string(),
    iv: z.string(),
    tag: z.string(),
    data: z.string(),
});
export type SecretsBundle = z.infer<typeof SecretsBundleSchema>;

export interface SecretsImportReport {
    shared: number;
    projects: Array<{ prefix: string; keys: number }>;
    skipped_projects: string[];
    jira: boolean;
    notification: boolean;
}

const keyFor = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32);
const toMap = (rows: Array<{ key: string; value: string }>) => Object.fromEntries(rows.map((r) => [r.key, r.value]));

function seal(payload: Payload, passphrase: string): SecretsBundle {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return {
        format: FORMAT,
        version: VERSION,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    };
}

function open(bundle: SecretsBundle, passphrase: string): Payload {
    if (bundle.version > VERSION) {
        throw new ApiError('validation_error', 'Secrets file: made by a newer Atlas; update Atlas to import it', 400);
    }
    let plain: string;
    try {
        const decipher = createDecipheriv(
            'aes-256-gcm',
            keyFor(passphrase, Buffer.from(bundle.salt, 'base64')),
            Buffer.from(bundle.iv, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));
        plain = Buffer.concat([decipher.update(Buffer.from(bundle.data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        throw new ApiError('credentials_invalid', 'Wrong passphrase, or the secrets file is damaged', 400);
    }
    return PayloadSchema.parse(JSON.parse(plain));
}

async function collect(): Promise<Payload> {
    const shared = toMap(await environmentSecretsService.list());

    const projects: Payload['projects'] = {};
    for (const p of await db.selectFrom('projects').select(['id', 'issue_key_prefix']).execute()) {
        const vars = await projectEnvFileService.dbList(p.id);
        if (vars.length > 0) projects[p.issue_key_prefix] = toMap(vars);
    }

    const jiraCfg = await jiraSync.getConfig();
    const jira =
        jiraCfg.api_token_set && jiraCfg.site_url && jiraCfg.email
            ? { site_url: jiraCfg.site_url, email: jiraCfg.email, api_token: await jiraSync.revealToken() }
            : null;

    const s = await settingsService.getWithSecrets();
    const notification =
        s.external_notification_provider &&
        (s.external_notification_token || s.external_notification_webhook_url)
            ? {
                  provider: s.external_notification_provider,
                  token: s.external_notification_token ?? null,
                  chat_id: s.external_notification_chat_id ?? null,
                  webhook_url: s.external_notification_webhook_url ?? null,
              }
            : null;

    return { shared, projects, jira, notification };
}

async function apply(payload: Payload): Promise<SecretsImportReport> {
    // Merge, file wins: a key only this machine has is kept.
    const shared = { ...toMap(await environmentSecretsService.list()), ...payload.shared };
    await environmentSecretsService.replaceAll(Object.entries(shared).map(([key, value]) => ({ key, value })));

    const report: SecretsImportReport = {
        shared: Object.keys(payload.shared).length,
        projects: [],
        skipped_projects: [],
        jira: false,
        notification: false,
    };

    const byPrefix = new Map(
        (await db.selectFrom('projects').select(['id', 'issue_key_prefix']).execute()).map((p) => [p.issue_key_prefix, p.id]),
    );
    for (const [prefix, vars] of Object.entries(payload.projects)) {
        const id = byPrefix.get(prefix);
        if (!id) {
            report.skipped_projects.push(prefix);
            continue;
        }
        const merged = { ...toMap(await projectEnvFileService.dbList(id)), ...vars };
        await projectEnvFileService.dbUpsert(id, Object.entries(merged).map(([key, value]) => ({ key, value })));
        report.projects.push({ prefix, keys: Object.keys(vars).length });
    }

    if (payload.jira) {
        await jiraSync.saveConfig(payload.jira);
        report.jira = true;
    }
    if (payload.notification) {
        const n = payload.notification;
        await settingsService.updateExternalNotificationBatch({
            external_notification_provider: n.provider,
            external_notification_token: n.token,
            external_notification_chat_id: n.chat_id,
            external_notification_webhook_url: n.webhook_url,
        });
        report.notification = true;
    }
    return report;
}

export const secretsBundle = {
    async export(passphrase: string): Promise<SecretsBundle> {
        return seal(await collect(), passphrase);
    },
    async import(bundle: SecretsBundle, passphrase: string): Promise<SecretsImportReport> {
        return apply(open(bundle, passphrase));
    },
};

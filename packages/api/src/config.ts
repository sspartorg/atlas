import './load-env.js';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
type NodeEnv = 'development' | 'test' | 'production';

const LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const NODE_ENVS: NodeEnv[] = ['development', 'test', 'production'];

export interface AppConfig {
    databaseUrl: string;
    logLevel: LogLevel;
    nodeEnv: NodeEnv;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
    if (cached) return cached;
    const url = process.env['DATABASE_URL'];
    if (!url || !(url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
        throw new Error(
            'DATABASE_URL is required and must use postgres:// or postgresql:// (see .env.example)',
        );
    }
    const rawLevel = (process.env['ATLAS_LOG_LEVEL'] ?? 'info') as LogLevel;
    const logLevel: LogLevel = LOG_LEVELS.includes(rawLevel) ? rawLevel : 'info';
    const rawEnv = (process.env['NODE_ENV'] ?? 'development') as NodeEnv;
    const nodeEnv: NodeEnv = NODE_ENVS.includes(rawEnv) ? rawEnv : 'development';
    cached = {
        databaseUrl: url,
        logLevel,
        nodeEnv,
    };
    return cached;
}

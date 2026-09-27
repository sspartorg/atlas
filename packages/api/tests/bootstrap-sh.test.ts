import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// scripts/bootstrap.sh, actually executed.
//
// bootstrap.ps1 has never been run by a test, and a bash installer that only
// runs on a fresh machine is the same trap: nobody re-runs it until a new
// teammate hits the broken branch. So this runs the real script against a
// throwaway repo with a PATH that holds ONLY stubs plus the handful of real
// coreutils the script needs. That isolation matters: CI's ubuntu runner has
// git, docker and gh in /usr/bin, so appending the real PATH would make
// "missing tool" branches impossible to reach.
//
// `--dry-run` is what makes the install branches testable: every command that
// changes the machine goes through `run`, which prints instead of executing.
// The one non-dry case below only reaches the file-writing steps, with pnpm
// stubbed.

const SCRIPT = resolve(__dirname, '../../../scripts/bootstrap.sh');
const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
const REAL_TOOLS = ['sed', 'tr', 'head', 'grep', 'awk', 'cat', 'dirname', 'id', 'mktemp', 'chmod', 'mv', 'cp', 'mkdir', 'base64', 'openssl'];

type Stubs = Record<string, string>;

function sandbox(stubs: Stubs, opts: { osRelease?: string } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'bootstrap-sh-'));
    const bin = join(root, 'bin');
    const home = join(root, 'home');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(bin);
    mkdirSync(home);
    copyFileSync(SCRIPT, join(root, 'scripts', 'bootstrap.sh'));
    writeFileSync(join(root, '.env.example'), 'POSTGRES_USER=\nATLAS_MCP_TOKEN=\n');
    writeFileSync(join(root, '.env.prod.example'), 'ATLAS_MCP_TOKEN=\n');
    for (const tool of REAL_TOOLS) {
        const real = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
        if (real) symlinkSync(real, join(bin, tool));
    }
    for (const [name, body] of Object.entries(stubs)) {
        writeFileSync(join(bin, name), `#!${BASH}\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const osRelease = join(root, 'os-release');
    writeFileSync(osRelease, opts.osRelease ?? '');
    const run = (...args: string[]) => {
        const r = spawnSync(BASH, [join(root, 'scripts', 'bootstrap.sh'), ...args], {
            cwd: root,
            encoding: 'utf8',
            env: { PATH: bin, HOME: home, USER: 'tester', ATLAS_BOOTSTRAP_OS_RELEASE: osRelease },
        });
        return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };
    return { root, home, run };
}

const planned = (out: string) =>
    out
        .split('\n')
        .filter((l) => l.startsWith('[dry-run] '))
        .map((l) => l.slice('[dry-run] '.length));

// A machine with every tool present and working.
const CONFIGURED: Stubs = {
    brew: 'echo "Homebrew 4.4.0"',
    git: 'echo "git version 2.47.0"',
    node: 'echo v22.11.0',
    pnpm: 'echo 9.15.0',
    docker: 'case "$1" in --version) echo "Docker version 27.3.1";; *) exit 0;; esac',
    gh: 'case "$1" in --version) echo "gh version 2.60.0";; extension) echo "gh copilot github/gh-copilot v1.0.5";; *) exit 0;; esac',
    claude: 'case "$1" in --version) echo "2.0.0 (Claude Code)";; *) exit 0;; esac',
};

describe('scripts/bootstrap.sh', () => {
    it('--help prints usage and exits 0', () => {
        const r = sandbox({ uname: 'echo Darwin' }).run('--help');
        expect(r.code).toBe(0);
        expect(r.out).toContain('--dry-run');
    });

    it('macOS, nothing installed: plans Homebrew, every tool, and the repo steps, and changes nothing', () => {
        const box = sandbox({ uname: 'echo Darwin' });
        const r = box.run('--dry-run', '--non-interactive');
        expect(r.code, r.out).toBe(0);
        const plan = planned(r.out);
        expect(plan.some((c) => c.includes('Homebrew/install/HEAD/install.sh'))).toBe(true);
        for (const cmd of [
            'brew install git',
            'brew install node',
            'corepack enable pnpm',
            'brew install --cask docker',
            'brew install gh',
            'gh extension install github/gh-copilot',
            'npm install -g @anthropic-ai/claude-code',
            'cp .env.example .env',
            'cp .env.prod.example .env.prod',
            'generate ATLAS_MCP_TOKEN into .env',
            'generate ATLAS_MCP_TOKEN into .env.prod',
            'pnpm install',
            'pnpm db:up',
            'pnpm db:wait',
            'pnpm db:migrate',
            // Byte-for-byte what bootstrap.ps1 registers.
            'claude mcp add-json atlas --scope user {"url":"http://127.0.0.1:4500/mcp"}',
            'pnpm doctor',
        ]) {
            expect(plan, cmd).toContain(cmd);
        }
        // Order is the contract: tools before repo, doctor last.
        expect(plan.indexOf('brew install git')).toBeLessThan(plan.indexOf('pnpm install'));
        expect(plan.at(-1)).toBe('pnpm doctor');
        expect(existsSync(join(box.root, '.env'))).toBe(false);
    });

    it('Debian/Ubuntu, nothing installed: apt + NodeSource + get.docker.com, one apt-get update', () => {
        const r = sandbox({ uname: 'echo Linux' }, { osRelease: 'ID=ubuntu\nID_LIKE=debian\n' }).run('--dry-run', '--non-interactive');
        expect(r.code, r.out).toBe(0);
        const plan = planned(r.out);
        const has = (s: string) => plan.some((c) => c.includes(s));
        expect(plan.filter((c) => c.includes('apt-get update'))).toHaveLength(1);
        for (const s of [
            'apt-get install -y git',
            'deb.nodesource.com/setup_22.x',
            'apt-get install -y nodejs',
            'corepack enable pnpm',
            'get.docker.com',
            'systemctl enable --now docker',
            'apt-get install -y gh',
            'claude mcp add-json atlas --scope user',
            'pnpm db:migrate',
        ]) {
            expect(has(s), s).toBe(true);
        }
        if (process.getuid?.() !== 0) {
            expect(has('usermod -aG docker tester')).toBe(true);
            expect(has('sudo apt-get install -y git')).toBe(true);
        }
        expect(has('brew')).toBe(false);
    });

    it('Fedora picks dnf and Arch picks pacman', () => {
        const fedora = sandbox({ uname: 'echo Linux' }, { osRelease: 'ID=fedora\n' }).run('--dry-run', '--non-interactive');
        expect(planned(fedora.out).some((c) => c.includes('dnf install -y git'))).toBe(true);
        const arch = sandbox({ uname: 'echo Linux' }, { osRelease: 'ID=arch\n' }).run('--dry-run', '--non-interactive');
        const plan = planned(arch.out);
        expect(plan.some((c) => c.includes('pacman -S --needed --noconfirm github-cli'))).toBe(true);
        expect(plan.some((c) => c.includes('pacman -S --needed --noconfirm pnpm'))).toBe(true);
    });

    it('an unsupported distro prints the manual steps and exits non-zero', () => {
        const r = sandbox({ uname: 'echo Linux' }, { osRelease: 'ID=gentoo\n' }).run('--dry-run', '--non-interactive');
        expect(r.code).toBe(1);
        expect(r.out).toContain('not supported');
        expect(r.out).toContain('pnpm doctor');
        expect(r.out).not.toContain('Finished steps are detected');
    });

    it('--skip-optional-clis installs and registers none of gh / Copilot / Claude', () => {
        const r = sandbox({ uname: 'echo Darwin', brew: 'echo "Homebrew 4.4.0"' }).run('--dry-run', '--non-interactive', '--skip-optional-clis');
        expect(r.code, r.out).toBe(0);
        const plan = planned(r.out).join('\n');
        expect(plan).not.toMatch(/gh|claude/);
        expect(r.out).toContain('skipped (--skip-optional-clis)');
    });

    it('a configured machine: every step says keep; only the idempotent db + doctor commands run', () => {
        const box = sandbox({ uname: 'echo Darwin', ...CONFIGURED });
        writeFileSync(join(box.root, '.env'), 'ATLAS_MCP_TOKEN=abc\n');
        writeFileSync(join(box.root, '.env.prod'), 'ATLAS_MCP_TOKEN=def\n');
        mkdirSync(join(box.root, 'node_modules'));
        mkdirSync(join(box.home, '.copilot'));
        writeFileSync(join(box.home, '.copilot', 'mcp-config.json'), '{"mcpServers":{"atlas":{"type":"http"}}}');
        const r = box.run('--dry-run', '--non-interactive');
        expect(r.code, r.out).toBe(0);
        expect(planned(r.out)).toEqual(['pnpm db:up', 'pnpm db:wait', 'pnpm db:migrate', 'pnpm doctor']);
        for (const kept of [
            'Homebrew',
            'git version',
            'node v22',
            'pnpm 9',
            'Docker version',
            'Docker engine is running',
            'gh version',
            'gh-copilot extension',
            'claude 2.0.0',
            '.env already exists',
            '.env.prod already exists',
            '.env already has ATLAS_MCP_TOKEN',
            'existing node_modules',
            'atlas already registered with Claude Code CLI',
            'atlas already in GitHub Copilot CLI config',
        ]) {
            expect(r.out, kept).toContain(`keep: ${kept}`);
        }
    });

    it('for real (not dry): writes both env files with a token once, and a re-run keeps them byte-for-byte', () => {
        const box = sandbox({
            uname: 'echo Darwin',
            ...CONFIGURED,
            pnpm: 'case "$1" in --version) echo 9.15.0;; *) echo "pnpm $*" >> "$HOME/pnpm.log";; esac',
            claude: 'case "$1" in --version) echo 2.0.0;; mcp) [ "$2" = get ] && exit 1; echo "claude $*" >> "$HOME/claude.log";; esac',
            gh: 'echo "gh version 2.60.0"',
        });
        const first = box.run('--non-interactive');
        expect(first.code, first.out).toBe(0);
        const env = readFileSync(join(box.root, '.env'), 'utf8');
        expect(env).toMatch(/^POSTGRES_USER=\nATLAS_MCP_TOKEN=[A-Za-z0-9_-]{64}\n$/);
        expect(readFileSync(join(box.root, '.env.prod'), 'utf8')).toMatch(/^ATLAS_MCP_TOKEN=[A-Za-z0-9_-]{64}\n$/);
        expect(readFileSync(join(box.home, 'pnpm.log'), 'utf8')).toBe('pnpm install\npnpm db:up\npnpm db:wait\npnpm db:migrate\npnpm doctor\n');
        expect(readFileSync(join(box.home, 'claude.log'), 'utf8')).toBe('claude mcp add-json atlas --scope user {"url":"http://127.0.0.1:4500/mcp"}\n');

        mkdirSync(join(box.root, 'node_modules'));
        const second = box.run('--non-interactive');
        expect(second.code, second.out).toBe(0);
        expect(readFileSync(join(box.root, '.env'), 'utf8')).toBe(env);
        expect(second.out).toContain('keep: .env already has ATLAS_MCP_TOKEN');
    });

    it('names the failed step and how to resume', () => {
        const box = sandbox({ uname: 'echo Darwin', ...CONFIGURED, pnpm: 'case "$1" in --version) echo 9.15.0;; db:up) exit 3;; esac' });
        mkdirSync(join(box.root, 'node_modules'));
        const r = box.run('--non-interactive');
        expect(r.code).toBe(3);
        expect(r.out).toContain('Step 12/14 (Database (Postgres via Docker Compose)) failed with exit code 3');
        expect(r.out).toContain('re-run:  bash scripts/bootstrap.sh');
    });

    // shellcheck ships on GitHub's ubuntu runners, so CI lints the script
    // through this test; a dev box without it skips (absence of evidence).
    const shellcheck = spawnSync('bash', ['-c', 'command -v shellcheck'], { encoding: 'utf8' }).stdout.trim();
    it.skipIf(!shellcheck)('is shellcheck-clean', () => {
        const r = spawnSync(shellcheck, [SCRIPT], { encoding: 'utf8' });
        expect(r.status, r.stdout).toBe(0);
    });
});

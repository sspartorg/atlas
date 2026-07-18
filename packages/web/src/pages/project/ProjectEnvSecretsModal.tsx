import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import FileDownloadRounded from '@mui/icons-material/FileDownloadRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import KeyRounded from '@mui/icons-material/KeyRounded';
import type { IProject } from '@atlas/shared';
import { useProjectEnv, useSaveProjectEnv, useRevealProjectEnv } from '../../hooks/useProjectEnv.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

interface Row {
    rid: string;
    key: string;
    /**
     * Batch-9 enterprise-secrets audit follow-up: the server key this row
     * was hydrated with. Stays fixed across in-place renames so `onSave`
     * can look up the stored plaintext by the ORIGINAL key when the Owner
     * hasn't typed a replacement. `null` for rows the Owner added client-
     * side (they have no server counterpart to preserve).
     */
    originalKey: string | null;
    value: string;
    isNew: boolean;
    revealed: boolean;
}

interface Props {
    open: boolean;
    project: IProject | null;
    displayId: string;
    onClose: () => void;
}

function makeRid(): string {
    return `r_${Math.random().toString(36).slice(2, 9)}`;
}

// Secrets travel between projects as plain JSON `{ KEY: "value" }` so the
// Owner can copy a set across multiple projects with the same baseline
// (DB URLs, API keys, etc.). The shape is intentionally flat — no
// metadata, no `vars[]` wrapper — so the file is easy to hand-edit and
// diff. The values still get encrypted at rest once the Owner hits Save;
// the JSON export is an unencrypted snapshot of the live form, NOT a
// dump of the stored ciphertext.

interface ParsedSecret {
    key: string;
    value: string;
}

interface ParseJsonSecretsResult {
    secrets: ParsedSecret[];
    invalidKeys: string[];
    invalidValues: string[];
}

function parseJsonSecrets(text: string): ParseJsonSecretsResult {
    const parsed: unknown = JSON.parse(text);
    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error('Expected a JSON object of { KEY: "value" } pairs');
    }
    const secrets: ParsedSecret[] = [];
    const invalidKeys: string[] = [];
    const invalidValues: string[] = [];
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!KEY_RE.test(key)) {
            invalidKeys.push(key);
            continue;
        }
        if (typeof value !== 'string') {
            invalidValues.push(key);
            continue;
        }
        secrets.push({ key, value });
    }
    return { secrets, invalidKeys, invalidValues };
}

function serializeJsonSecrets(rows: Array<{ key: string; value: string }>): string {
    const obj: Record<string, string> = {};
    for (const { key, value } of rows) {
        obj[key] = value;
    }
    // Pretty-print so a hand-editor can read it; 2-space indent matches
    // the convention used elsewhere in the app's JSON config files.
    return JSON.stringify(obj, null, 2) + '\n';
}

export function ProjectEnvSecretsModal({ open, project, displayId, onClose }: Props) {
    const projectId = project?.id ?? null;
    const { data, isLoading } = useProjectEnv(projectId, open);
    const save = useSaveProjectEnv(projectId ?? '');
    // Batch-9 audit: on-demand reveal for a single stored value.
    const reveal = useRevealProjectEnv(projectId ?? '');
    const toast = useToast();

    const [rows, setRows] = useState<Row[]>([]);
    const [search, setSearch] = useState('');
    const [revealAll, setRevealAll] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open || !data) return;
        // Batch-9 audit (enterprise-secrets read model): the API no
        // longer returns plaintext values on list. Hydrate rows with an
        // empty value and rely on the reveal endpoint for on-demand
        // decrypt. `v.value` is retained as an OPTIONAL field on the
        // response type for compile-safety, but at runtime it is
        // always undefined from the enterprise-read-model backend.
        setRows(
            data.vars.map((v) => ({
                rid: makeRid(),
                key: v.key,
                originalKey: v.key,
                value: v.value ?? '',
                isNew: false,
                revealed: false,
            }))
        );
    }, [data, open]);

    useEffect(() => {
        if (!open) {
            setSearch('');
            setRevealAll(false);
        }
    }, [open]);

    const serverByKey = useMemo(() => {
        const m = new Map<string, string>();
        // Enterprise read model: `value` is undefined for stored rows.
        // The map still tracks the KEY presence — the dirty check
        // below treats undefined as "unknown, do not compare against
        // typed input" so an existing row displayed as '' isn't
        // mistakenly flagged as "changed from stored".
        (data?.vars ?? []).forEach((v) => m.set(v.key, v.value ?? ''));
        return m;
    }, [data]);

    const dirtyCount = useMemo(() => {
        const serverKeys = new Set(serverByKey.keys());
        const rowKeys = new Set(rows.map((r) => r.key).filter(Boolean));
        let n = 0;
        for (const r of rows) {
            if (!r.key) continue;
            const prev = serverByKey.get(r.key);
            if (prev === undefined) n += 1;
            else if (prev !== r.value) n += 1;
        }
        for (const k of serverKeys) if (!rowKeys.has(k)) n += 1;
        return n;
    }, [rows, serverByKey]);

    const errors = useMemo(() => {
        const e: Record<string, string> = {};
        const seen = new Map<string, number>();
        rows.forEach((r, i) => {
            if (!r.key) {
                e[r.rid] = 'Key required';
                return;
            }
            if (!KEY_RE.test(r.key)) {
                e[r.rid] = 'UPPER_SNAKE_CASE only';
                return;
            }
            if (seen.has(r.key)) {
                e[r.rid] = 'Duplicate key';
                return;
            }
            seen.set(r.key, i);
        });
        return e;
    }, [rows]);

    const filteredRows = useMemo(() => {
        const q = search.trim().toUpperCase();
        if (!q) return rows;
        return rows.filter((r) => r.key.toUpperCase().includes(q));
    }, [rows, search]);

    function updateRow(rid: string, patch: Partial<Row>) {
        setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
    }

    function addRow() {
        setRows((rs) => [
            ...rs,
            {
                rid: makeRid(),
                key: '',
                originalKey: null,
                value: '',
                isNew: true,
                revealed: true,
            },
        ]);
    }

    function removeRow(rid: string) {
        setRows((rs) => rs.filter((r) => r.rid !== rid));
    }

    function copy(value: string, label: string) {
        void navigator.clipboard.writeText(value).then(
            () => toast.show({ message: `${label} copied` }),
            () => toast.show({ message: 'Clipboard blocked' })
        );
    }

    function onPickImport() {
        fileInputRef.current?.click();
    }

    function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        // Reset the input value before any early return so picking the
        // same file twice still triggers the change event.
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result ?? '');
            let result: ParseJsonSecretsResult;
            try {
                result = parseJsonSecrets(text);
            } catch (err) {
                toast.show({
                    message: 'Could not import secrets',
                    detail: err instanceof Error ? err.message : 'Invalid JSON',
                });
                return;
            }
            if (result.secrets.length === 0) {
                toast.show({ message: 'No secrets found in file' });
                return;
            }
            // Additive merge: existing keys get their value updated;
            // brand-new keys are added as `isNew=true` rows so the Owner
            // can see what just landed before saving.
            setRows((prev) => {
                const byKey = new Map(prev.map((r) => [r.key, r]));
                for (const p of result.secrets) {
                    const existing = byKey.get(p.key);
                    if (existing) {
                        byKey.set(p.key, { ...existing, value: p.value });
                    } else {
                        byKey.set(p.key, {
                            rid: makeRid(),
                            key: p.key,
                            originalKey: null,
                            value: p.value,
                            isNew: true,
                            revealed: false,
                        });
                    }
                }
                return [...byKey.values()];
            });
            const skipped =
                result.invalidKeys.length + result.invalidValues.length;
            const skippedNote =
                skipped > 0
                    ? ` (skipped ${skipped}: ${
                          result.invalidKeys.length
                              ? `${result.invalidKeys.length} bad key${result.invalidKeys.length === 1 ? '' : 's'}`
                              : ''
                      }${result.invalidKeys.length && result.invalidValues.length ? ', ' : ''}${
                          result.invalidValues.length
                              ? `${result.invalidValues.length} non-string value${result.invalidValues.length === 1 ? '' : 's'}`
                              : ''
                      })`
                    : '';
            toast.show({
                message: `Imported ${result.secrets.length} secret${result.secrets.length === 1 ? '' : 's'}${skippedNote}`,
            });
        };
        reader.readAsText(file);
    }

    async function onExport() {
        if (!project) return;
        // Batch-9 enterprise-secrets read model: rows are hydrated with
        // `value=''` since the API no longer returns plaintext on list.
        // Directly serializing r.value would produce a file where every
        // stored secret is empty — a lookalike backup that would silently
        // wipe the destination on re-import. Reveal each stored row just-
        // in-time to compose a real backup. Aborts on any reveal failure
        // so the Owner never gets a partially-hydrated export.
        try {
            const validRows = rows.filter((r) => r.key && KEY_RE.test(r.key));
            const output: Array<{ key: string; value: string }> = [];
            for (const r of validRows) {
                if (r.originalKey && r.value === '') {
                    const res = await reveal.mutateAsync(r.originalKey);
                    output.push({ key: r.key, value: res.value });
                } else {
                    output.push({ key: r.key, value: r.value });
                }
            }
            const text = serializeJsonSecrets(output);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${project.name}.secrets.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.show({
                message: 'Could not export secrets',
                detail:
                    'Failed to read one or more stored values — ' +
                    (err instanceof Error ? err.message : String(err)),
            });
        }
    }

    async function onSave() {
        const errCount = Object.keys(errors).length;
        if (errCount > 0) {
            toast.show({ message: `Fix ${errCount} row${errCount === 1 ? '' : 's'} first` });
            return;
        }
        // Batch-9 audit (enterprise-secrets read model): the PUT
        // endpoint is replace-all; the API list no longer returns
        // plaintext, so untouched rows have `value === ''` and would
        // wipe the stored secret on save. Reveal each untouched row
        // just-in-time (keyed on `originalKey` so a rename doesn't
        // 404 the reveal or push an empty value under the new name).
        const preserved: Array<{ key: string; value: string }> = [];
        const preservedRids = new Set<string>();
        try {
            for (const r of rows) {
                if (!r.key || !KEY_RE.test(r.key)) continue;
                if (r.originalKey && r.value === '') {
                    // Existing stored row, Owner didn't type a new
                    // value → preserve by revealing the ORIGINAL server
                    // key then re-sending under the CURRENT (possibly
                    // renamed) key.
                    const res = await reveal.mutateAsync(r.originalKey);
                    preserved.push({ key: r.key, value: res.value });
                    preservedRids.add(r.rid);
                }
            }
        } catch (err) {
            toast.show({
                message: 'Could not save secrets',
                detail:
                    'Failed to read existing values while composing the save payload — ' +
                    (err instanceof Error ? err.message : String(err)),
            });
            return;
        }
        const edited = rows
            .filter((r) => r.key && KEY_RE.test(r.key) && !preservedRids.has(r.rid))
            .map((r) => ({ key: r.key, value: r.value }));
        const payload = [...preserved, ...edited];
        try {
            await save.mutateAsync(payload);
            toast.show({ message: 'Project secrets saved' });
            onClose();
        } catch (err) {
            toast.show({
                message: 'Could not save secrets',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (!project) return null;

    const plainCount = rows.filter((r) => r.key && KEY_RE.test(r.key)).length;
    const hasErrors = Object.keys(errors).length > 0;
    const noWorkspace = !project.git_path;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    boxShadow: '0 16px 40px rgba(0,0,14,.14)',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ p: 0 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2.5,
                        px: 4,
                        pt: 4,
                        pb: 3,
                    }}
                >
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '8px',
                            bgcolor: ATLAS_PALETTE.slate06,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        <KeyRounded sx={{ fontSize: 20 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography
                                sx={{
                                    fontSize: 16,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                Project Secrets
                            </Typography>
                            <Box
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: '4px',
                                    bgcolor: ATLAS_PALETTE.slate06,
                                }}
                            >
                                {displayId}
                            </Box>
                        </Box>
                        <Typography
                            sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}
                        >
                            Injected into every agent run inside <strong>{project.name}</strong>.
                            In-flight runs continue under the previous values.
                        </Typography>
                    </Box>
                    <IconButton onClick={onClose} size="small">
                        <CloseRounded />
                    </IconButton>
                </Box>

                <Box sx={{ px: 4, pb: 3 }}>
                    {noWorkspace ? (
                        <Alert
                            severity="warning"
                            sx={{
                                py: 0.5,
                                bgcolor: 'rgba(199,83,47,.10)',
                                color: ATLAS_PALETTE.slate,
                                border: `1px solid rgba(199,83,47,.20)`,
                                '& .MuiAlert-message': { fontSize: 12, py: 0.5 },
                            }}
                        >
                            This project has no folder on disk yet. Clone or connect the repo
                            before managing secrets.
                        </Alert>
                    ) : (
                        <Alert
                            icon={
                                <LockOutlined
                                    sx={{ fontSize: 16, color: ATLAS_PALETTE.success }}
                                />
                            }
                            sx={{
                                py: 0.5,
                                bgcolor: 'rgba(49,171,70,.08)',
                                color: ATLAS_PALETTE.slate,
                                border: `1px solid rgba(49,171,70,.18)`,
                                '& .MuiAlert-message': { fontSize: 12, py: 0.5 },
                            }}
                        >
                            Encrypted at rest with AES-256-GCM. Merged with Settings &gt; Shared
                            Secrets before the setup runner substitutes <Box component="span" sx={{ fontFamily: MONO }}>${'{variable.KEY}'}</Box>{' '}
                            placeholders in this project&apos;s setup script. Never echoed to logs.
                        </Alert>
                    )}
                </Box>

                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 4,
                        pb: 3,
                        flexWrap: 'wrap',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            flex: 1,
                            minWidth: 220,
                            px: 1.5,
                            py: 0.75,
                            border: `1px solid ${ATLAS_PALETTE.slate12}`,
                            borderRadius: '8px',
                            bgcolor: ATLAS_PALETTE.white,
                        }}
                    >
                        <SearchRounded
                            sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40, mr: 1 }}
                        />
                        <InputBase
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by key (e.g. STRIPE_)"
                            sx={{
                                flex: 1,
                                fontSize: 13,
                                fontFamily: MONO,
                                '& input::placeholder': {
                                    fontFamily: '"Inter", system-ui, sans-serif',
                                    fontStyle: 'italic',
                                },
                            }}
                        />
                    </Box>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FileUploadRounded sx={{ fontSize: 16 }} />}
                        onClick={onPickImport}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                            fontSize: 12,
                        }}
                    >
                        Import
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FileDownloadRounded sx={{ fontSize: 16 }} />}
                        onClick={onExport}
                        disabled={rows.length === 0}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                            fontSize: 12,
                        }}
                    >
                        Export
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                            revealAll ? (
                                <VisibilityOffOutlined sx={{ fontSize: 16 }} />
                            ) : (
                                <VisibilityOutlined sx={{ fontSize: 16 }} />
                            )
                        }
                        onClick={() => setRevealAll((v) => !v)}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                            fontSize: 12,
                        }}
                    >
                        {revealAll ? 'Hide all' : 'Reveal all'}
                    </Button>
                    {/* Hidden file picker driven by the Import button.
                        `accept` is permissive — any text-ish JSON file
                        works; parseJsonSecrets validates the content. */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: 'none' }}
                        onChange={onImportFile}
                    />
                </Box>

                <Box sx={{ px: 4 }}>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1.4fr 92px 32px',
                            gap: 1,
                            px: 1.5,
                            pb: 0.5,
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate40,
                        }}
                    >
                        <Box>Key</Box>
                        <Box>Value</Box>
                        <Box>Scope</Box>
                        <Box />
                    </Box>

                    <Box
                        sx={{
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            borderRadius: '10px',
                            overflow: 'hidden',
                            maxHeight: 360,
                            overflowY: 'auto',
                        }}
                    >
                        {isLoading ? (
                            <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                                <CircularProgress
                                    size={20}
                                    sx={{ color: ATLAS_PALETTE.brandBlue }}
                                />
                            </Box>
                        ) : filteredRows.length === 0 ? (
                            <Box
                                sx={{
                                    p: 5,
                                    textAlign: 'center',
                                    color: ATLAS_PALETTE.slate60,
                                    fontSize: 12,
                                }}
                            >
                                {rows.length === 0
                                    ? 'No secrets yet — click "Add variable" to create one.'
                                    : 'No keys match your search.'}
                            </Box>
                        ) : (
                            filteredRows.map((r, i) => (
                                <Box
                                    key={r.rid}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1.4fr 92px 32px',
                                        gap: 1,
                                        alignItems: 'center',
                                        px: 1.5,
                                        py: 1,
                                        bgcolor: r.isNew
                                            ? 'rgba(49,171,70,.06)'
                                            : ATLAS_PALETTE.white,
                                        borderTop:
                                            i === 0
                                                ? 'none'
                                                : `1px solid ${ATLAS_PALETTE.slate06}`,
                                        '&:hover': {
                                            bgcolor: r.isNew
                                                ? 'rgba(49,171,70,.10)'
                                                : ATLAS_PALETTE.cloud,
                                        },
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        {r.isNew && (
                                            <Box
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 9,
                                                    fontWeight: 600,
                                                    letterSpacing: '0.06em',
                                                    color: ATLAS_PALETTE.success,
                                                    bgcolor: 'rgba(49,171,70,.12)',
                                                    px: 0.75,
                                                    py: 0.25,
                                                    borderRadius: '3px',
                                                }}
                                            >
                                                NEW
                                            </Box>
                                        )}
                                        <TextField
                                            size="small"
                                            variant="standard"
                                            value={r.key}
                                            onChange={(e) =>
                                                updateRow(r.rid, {
                                                    key: e.target.value.toUpperCase(),
                                                })
                                            }
                                            placeholder="MY_KEY"
                                            error={Boolean(errors[r.rid])}
                                            helperText={errors[r.rid]}
                                            slotProps={{
                                                input: {
                                                    disableUnderline: true,
                                                    sx: {
                                                        fontFamily: MONO,
                                                        fontSize: 12.5,
                                                        fontWeight: 600,
                                                        color: ATLAS_PALETTE.slate,
                                                    },
                                                },
                                            }}
                                            sx={{ flex: 1 }}
                                        />
                                    </Box>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        type={revealAll || r.revealed ? 'text' : 'password'}
                                        value={r.value}
                                        onChange={(e) =>
                                            updateRow(r.rid, { value: e.target.value })
                                        }
                                        placeholder="value"
                                        slotProps={{
                                            input: {
                                                disableUnderline: true,
                                                sx: {
                                                    fontFamily: MONO,
                                                    fontSize: 12.5,
                                                    color: ATLAS_PALETTE.slate,
                                                },
                                                endAdornment: (
                                                    <InputAdornment position="end">
                                                        <Tooltip
                                                            title={r.revealed ? 'Hide' : 'Reveal'}
                                                        >
                                                            <IconButton
                                                                size="small"
                                                                onClick={() =>
                                                                    updateRow(r.rid, {
                                                                        revealed: !r.revealed,
                                                                    })
                                                                }
                                                                sx={{ color: ATLAS_PALETTE.slate40 }}
                                                            >
                                                                {r.revealed ? (
                                                                    <VisibilityOffOutlined
                                                                        sx={{ fontSize: 15 }}
                                                                    />
                                                                ) : (
                                                                    <VisibilityOutlined
                                                                        sx={{ fontSize: 15 }}
                                                                    />
                                                                )}
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Copy">
                                                            <IconButton
                                                                size="small"
                                                                onClick={() =>
                                                                    copy(r.value, r.key || 'value')
                                                                }
                                                                sx={{ color: ATLAS_PALETTE.slate40 }}
                                                            >
                                                                <ContentCopyRounded
                                                                    sx={{ fontSize: 14 }}
                                                                />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </InputAdornment>
                                                ),
                                            },
                                        }}
                                    />
                                    <Box
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            letterSpacing: '0.04em',
                                            color: ATLAS_PALETTE.slate60,
                                            bgcolor: ATLAS_PALETTE.slate06,
                                            px: 1,
                                            py: 0.5,
                                            borderRadius: '4px',
                                            textAlign: 'center',
                                            width: 'fit-content',
                                        }}
                                    >
                                        project
                                    </Box>
                                    <Tooltip title="Remove">
                                        <IconButton
                                            size="small"
                                            onClick={() => removeRow(r.rid)}
                                            sx={{ color: ATLAS_PALETTE.slate40 }}
                                        >
                                            <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            ))
                        )}
                    </Box>
                </Box>

                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 2,
                        px: 4,
                        py: 3,
                    }}
                >
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                        onClick={addRow}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                            borderStyle: 'dashed',
                            fontSize: 12,
                        }}
                    >
                        Add variable
                    </Button>
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        {plainCount} key{plainCount === 1 ? '' : 's'} · paste multiline at root
                    </Typography>
                </Box>

                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 2,
                        px: 4,
                        py: 3,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                        bgcolor: ATLAS_PALETTE.slate06,
                    }}
                >
                    <Box
                        sx={{
                            fontSize: 12,
                            color:
                                dirtyCount > 0
                                    ? ATLAS_PALETTE.warning
                                    : ATLAS_PALETTE.slate60,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        {dirtyCount > 0 && (
                            <Box
                                sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    bgcolor: ATLAS_PALETTE.warning,
                                }}
                            />
                        )}
                        {dirtyCount > 0
                            ? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`
                            : 'no unsaved changes'}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            onClick={onClose}
                            sx={{
                                textTransform: 'none',
                                color: ATLAS_PALETTE.slate60,
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void onSave()}
                            disabled={
                                save.isPending ||
                                hasErrors ||
                                noWorkspace ||
                                (dirtyCount === 0 && rows.length > 0)
                            }
                            startIcon={
                                save.isPending ? (
                                    <CircularProgress size={14} color="inherit" />
                                ) : null
                            }
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                bgcolor: ATLAS_PALETTE.success,
                                '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                            }}
                        >
                            {save.isPending ? 'Saving…' : 'Save secrets'}
                        </Button>
                    </Box>
                </Box>
            </Box>
        </Dialog>
    );
}

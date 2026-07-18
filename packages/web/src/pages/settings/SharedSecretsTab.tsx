import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import KeyRounded from '@mui/icons-material/KeyRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import SaveRounded from '@mui/icons-material/SaveRounded';
import {
    useEnvironmentSecrets,
    useSaveEnvironmentSecrets,
    useRevealEnvironmentSecret,
} from '../../hooks/useEnvironmentSecrets.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// 2026-06-10 — UI surface for the global tier of the two-scope secrets
// model. Per-project secrets stay on the Project Detail page; this tab
// holds keys shared across every project (org-wide registry tokens,
// shared API credentials, etc.). The setup runner merges both maps —
// project values win on key collision — before substituting
// `${variable.KEY}` placeholders in the user-authored setup script.

const MONO = '"JetBrains Mono", monospace';
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

// Batch-9 audit (enterprise-secrets read model): rows track whether a
// value is STORED on the server (`hasStoredValue`) separately from the
// in-memory `value` field. Existing rows hydrate with `value=''` +
// `hasStoredValue=true`; the plaintext is fetched on demand via the
// Reveal button and stored transiently in `revealedValue`. Save only
// writes rows where the Owner has typed a new value (or newly added
// rows) — untouched existing rows preserve their server-side value.
interface Row {
    rid: string;
    key: string;
    /**
     * Batch-9 enterprise-secrets audit follow-up: the server key this row
     * was hydrated with. Persists across in-place renames so `handleSave`
     * can look up the stored plaintext by the ORIGINAL key when the Owner
     * hasn't typed a replacement. `null` for rows the Owner added client-
     * side (they have no server counterpart to preserve).
     */
    originalKey: string | null;
    value: string;
    hasStoredValue: boolean;
    revealed: boolean;
    // Transient plaintext returned by the Reveal endpoint. Never
    // persisted or cached — cleared when the countdown expires or
    // the Owner navigates away.
    revealedValue: string | null;
}

function makeRid(): string {
    return `r_${Math.random().toString(36).slice(2, 9)}`;
}

export function SharedSecretsTab() {
    const { data, isLoading } = useEnvironmentSecrets();
    const save = useSaveEnvironmentSecrets();
    const reveal = useRevealEnvironmentSecret();
    const toast = useToast();

    const [rows, setRows] = useState<Row[]>([]);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!data || hydrated) return;
        setRows(
            data.vars.map((v) => ({
                rid: makeRid(),
                key: v.key,
                originalKey: v.key,
                value: '',
                hasStoredValue: true,
                revealed: false,
                revealedValue: null,
            })),
        );
        setHydrated(true);
    }, [data, hydrated]);

    const dirty = useMemo(() => {
        if (!data) return false;
        // Row-count changed → dirty (add / delete).
        if (rows.length !== data.vars.length) return true;
        const serverKeys = new Set(data.vars.map((v) => v.key));
        for (const r of rows) {
            // Any typed-in value on an existing row = replace = dirty.
            // New key (not on server) with a value = new secret = dirty.
            // New key with empty value = incomplete, not dirty.
            if (!serverKeys.has(r.key)) return true; // renamed / new
            if (r.value !== '') return true; // replacement
        }
        return false;
    }, [rows, data]);

    async function handleReveal(rid: string, key: string): Promise<void> {
        try {
            const res = await reveal.mutateAsync(key);
            setRows((prev) =>
                prev.map((r) =>
                    r.rid === rid ? { ...r, revealed: true, revealedValue: res.value } : r,
                ),
            );
        } catch (err) {
            toast.show({
                message: 'Could not reveal secret',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    function clearReveal(rid: string): void {
        setRows((prev) =>
            prev.map((r) =>
                r.rid === rid ? { ...r, revealed: false, revealedValue: null } : r,
            ),
        );
    }

    const invalid = useMemo(() => {
        const errors: string[] = [];
        const seen = new Set<string>();
        for (const r of rows) {
            if (r.key === '') continue;
            if (!KEY_RE.test(r.key)) {
                errors.push(`"${r.key}" must be UPPER_SNAKE_CASE`);
            } else if (seen.has(r.key)) {
                errors.push(`"${r.key}" is duplicated`);
            }
            seen.add(r.key);
        }
        return errors;
    }, [rows]);

    function addRow(): void {
        setRows((prev) => [
            ...prev,
            {
                rid: makeRid(),
                key: '',
                originalKey: null,
                value: '',
                hasStoredValue: false,
                revealed: true,
                revealedValue: null,
            },
        ]);
    }

    function removeRow(rid: string): void {
        setRows((prev) => prev.filter((r) => r.rid !== rid));
    }

    function updateRow(rid: string, patch: Partial<Row>): void {
        setRows((prev) => prev.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
    }

    async function handleSave(): Promise<void> {
        // Enterprise-secrets read model: the server no longer returns
        // plaintext values on list, so we can only send [{key, value}]
        // for rows the Owner has typed a value into (new rows OR
        // existing rows where they wanted to REPLACE). Existing rows
        // with an empty value field are "keep as-is" — we send them
        // with a special sentinel that the server treats as "preserve".
        //
        // Since the server API's PUT expects [{key, value}] and does
        // a replace-all, we need to preserve untouched rows by sending
        // their existing values. Fetch them via reveal if not already
        // revealed. Chatty, but only fires when the Owner has other
        // pending changes.
        const untouched = rows.filter(
            (r) => r.hasStoredValue && r.key !== '' && r.value === '',
        );
        const preserved: Array<{ key: string; value: string }> = [];
        try {
            for (const r of untouched) {
                if (r.revealedValue !== null) {
                    preserved.push({ key: r.key, value: r.revealedValue });
                } else {
                    // Key the reveal on `originalKey`: an in-place rename
                    // means the CURRENT `r.key` doesn't exist server-side
                    // yet and would 404 the reveal (finding SharedSecretsTab
                    // .tsx:181 in the 2026-07-03 audit). Fall back to r.key
                    // for rows that have no originalKey — defensive; the
                    // untouched filter above already excludes such rows.
                    const lookupKey = r.originalKey ?? r.key;
                    const res = await reveal.mutateAsync(lookupKey);
                    preserved.push({ key: r.key, value: res.value });
                }
            }
        } catch (err) {
            toast.show({
                message: 'Could not save shared secrets',
                detail:
                    'Failed to read existing values while composing the save payload — ' +
                    (err instanceof Error ? err.message : String(err)),
            });
            return;
        }
        const edited = rows
            .filter((r) => r.key !== '' && r.value !== '')
            .map((r) => ({ key: r.key, value: r.value }));
        const payload = [...preserved, ...edited];
        try {
            await save.mutateAsync(payload);
            // Reset the rows: any edited/new value now becomes "stored"
            // with no in-memory plaintext.
            setRows((prev) =>
                prev.map((r) => ({
                    ...r,
                    value: '',
                    hasStoredValue: r.key !== '',
                    revealed: false,
                    revealedValue: null,
                })),
            );
            toast.show({
                message: 'Shared secrets saved',
                detail: `${payload.length} ${payload.length === 1 ? 'entry' : 'entries'}`,
            });
        } catch (err) {
            toast.show({
                message: 'Could not save shared secrets',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (isLoading || !data) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    return (
        <Box>
            <Alert
                icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                sx={{
                    mb: 4,
                    bgcolor: ATLAS_PALETTE.cloud,
                    color: ATLAS_PALETTE.slate,
                    border: `1px solid rgba(0,122,201,.12)`,
                    '& .MuiAlert-message': { fontSize: 12 },
                }}
            >
                Shared across every project. The setup runner merges these with the project&apos;s own
                secrets — project values win on collision — before substituting{' '}
                <Box
                    component="code"
                    sx={{ fontFamily: MONO, bgcolor: ATLAS_PALETTE.slate08, px: 0.5 }}
                >
                    ${'{variable.KEY}'}
                </Box>{' '}
                placeholders in the per-project setup script. Values are encrypted at rest with
                AES-256-GCM.
            </Alert>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 2,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                    }}
                >
                    <KeyRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }} />
                    {rows.length} {rows.length === 1 ? 'secret' : 'secrets'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        size="small"
                        startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                        onClick={addRow}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.brandBlue,
                            fontWeight: 600,
                        }}
                    >
                        Add secret
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={
                            save.isPending ? (
                                <CircularProgress
                                    size={14}
                                    sx={{ color: ATLAS_PALETTE.white }}
                                />
                            ) : (
                                <SaveRounded sx={{ fontSize: 16 }} />
                            )
                        }
                        disabled={!dirty || invalid.length > 0 || save.isPending}
                        onClick={handleSave}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            bgcolor: ATLAS_PALETTE.brandBlue,
                            '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue, opacity: 0.9 },
                            '&.Mui-disabled': {
                                bgcolor: ATLAS_PALETTE.slate12,
                                color: ATLAS_PALETTE.slate60,
                            },
                        }}
                    >
                        {save.isPending ? 'Saving…' : 'Save'}
                    </Button>
                </Box>
            </Box>

            {invalid.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {invalid.join(' · ')}
                </Alert>
            )}

            <Box
                sx={{
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: 1,
                    overflow: 'hidden',
                }}
            >
                {rows.length === 0 ? (
                    <Box
                        sx={{
                            p: 4,
                            textAlign: 'center',
                            color: ATLAS_PALETTE.slate60,
                            fontSize: 13,
                        }}
                    >
                        No shared secrets yet. Click <b>Add secret</b> to create one.
                    </Box>
                ) : (
                    rows.map((row, idx) => (
                        <Box
                            key={row.rid}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: '220px 1fr auto auto',
                                gap: 1.5,
                                alignItems: 'center',
                                px: 1.5,
                                py: 1,
                                borderBottom:
                                    idx === rows.length - 1
                                        ? 'none'
                                        : `1px solid ${ATLAS_PALETTE.slate08}`,
                            }}
                        >
                            <InputBase
                                value={row.key}
                                onChange={(e) =>
                                    updateRow(row.rid, { key: e.target.value.toUpperCase() })
                                }
                                placeholder="UPPER_SNAKE_CASE"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate,
                                    px: 1,
                                    py: 0.5,
                                    bgcolor: ATLAS_PALETTE.slate06,
                                    borderRadius: 0.5,
                                    border:
                                        row.key !== '' && !KEY_RE.test(row.key)
                                            ? `1px solid ${ATLAS_PALETTE.error}`
                                            : `1px solid transparent`,
                                }}
                            />
                            <TextField
                                value={row.revealedValue ?? row.value}
                                onChange={(e) => {
                                    // Typing into the field is "replace the
                                    // stored value" — drops the transient
                                    // revealedValue if any.
                                    updateRow(row.rid, {
                                        value: e.target.value,
                                        revealedValue: null,
                                    });
                                }}
                                type={row.revealed || row.revealedValue !== null ? 'text' : 'password'}
                                variant="standard"
                                fullWidth
                                placeholder={
                                    row.hasStoredValue && row.value === ''
                                        ? '••••••••  (click Reveal to show, or type to replace)'
                                        : 'value'
                                }
                                InputProps={{
                                    disableUnderline: true,
                                    // Read-only when we're displaying a
                                    // freshly-revealed stored value —
                                    // prevents accidental edit of a
                                    // still-live reveal. Owner clicks the
                                    // hide icon to close.
                                    readOnly: row.revealedValue !== null,
                                    sx: {
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        bgcolor: ATLAS_PALETTE.slate06,
                                        borderRadius: 0.5,
                                        px: 1,
                                        py: 0.5,
                                    },
                                }}
                            />
                            <Tooltip
                                title={
                                    row.hasStoredValue && row.value === ''
                                        ? row.revealedValue !== null
                                            ? 'Hide value'
                                            : 'Reveal stored value'
                                        : row.revealed
                                          ? 'Hide value'
                                          : 'Show value'
                                }
                            >
                                <IconButton
                                    size="small"
                                    disabled={reveal.isPending}
                                    onClick={() => {
                                        // Enterprise-secrets read model:
                                        //   * hasStoredValue + empty typed = fetch or clear
                                        //   * otherwise = show/hide the (locally-entered) text
                                        if (row.hasStoredValue && row.value === '') {
                                            if (row.revealedValue !== null) {
                                                clearReveal(row.rid);
                                            } else {
                                                void handleReveal(row.rid, row.key);
                                            }
                                        } else {
                                            updateRow(row.rid, { revealed: !row.revealed });
                                        }
                                    }}
                                >
                                    {row.revealed || row.revealedValue !== null ? (
                                        <VisibilityOffOutlined sx={{ fontSize: 18 }} />
                                    ) : (
                                        <VisibilityOutlined sx={{ fontSize: 18 }} />
                                    )}
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete this secret">
                                <IconButton
                                    size="small"
                                    onClick={() => removeRow(row.rid)}
                                    sx={{ color: ATLAS_PALETTE.error }}
                                >
                                    <DeleteOutlineRounded sx={{ fontSize: 18 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
}

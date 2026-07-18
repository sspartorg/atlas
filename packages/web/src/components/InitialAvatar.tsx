import Box from '@mui/material/Box';

interface Props {
    /** The string to take the first character from (typically a name). */
    name: string;
    /** Background color of the circle (agent accent, owner accent, slate, …). */
    color: string;
    /** Pixel size of the circle. Font-size and weight scale from this. */
    size?: number;
    /** Text colour. Defaults to white — set explicitly for light-background variants. */
    fg?: string;
    /** Override the auto-computed font size when the default looks off. */
    fontSize?: number;
    /** Override the default font weight (700). */
    fontWeight?: number;
}

/**
 * Round letter avatar. Single source of truth for the owner / agent /
 * assignee initial circles across the app.
 *
 * Why: UI sans-serif cap height + descent line metrics leave a capital
 * letter sitting visually ~1px high in a flex-centered box. We use a 1:1
 * line-height paired with `paddingTop: '1px'` so the cap is optically
 * centered inside the circle at every size we use (16–32px).
 */
export function InitialAvatar({
    name,
    color,
    size = 24,
    fg = '#fff',
    fontSize,
    fontWeight = 700,
}: Props) {
    const initial = (name.trim()[0] ?? '?').toUpperCase();
    return (
        <Box
            sx={{
                width: size,
                height: size,
                borderRadius: '9999px',
                background: color,
                color: fg,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: '"Inter", system-ui, sans-serif',
                fontSize: fontSize ?? Math.max(10, Math.round(size * 0.48)),
                fontWeight,
                lineHeight: 1,
                paddingTop: '1px',
                boxSizing: 'border-box',
                flexShrink: 0,
                userSelect: 'none',
            }}
        >
            {initial}
        </Box>
    );
}

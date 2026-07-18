import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface BreadcrumbItem {
    label: string;
    to?: string;
}

interface Props {
    items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: Props) {
    const navigate = useNavigate();
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                const clickable = Boolean(item.to) && !isLast;
                return (
                    <Box
                        key={`${item.label}-${idx}`}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <Typography
                            onClick={clickable ? () => navigate(item.to!) : undefined}
                            sx={{
                                fontSize: 13,
                                color: isLast ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.slate40,
                                cursor: clickable ? 'pointer' : 'default',
                                transition: 'color 150ms ease',
                                '&:hover': clickable ? { color: ATLAS_PALETTE.slate } : undefined,
                            }}
                        >
                            {item.label}
                        </Typography>
                        {!isLast && (
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 14, color: ATLAS_PALETTE.slate30 }}
                            >
                                chevron_right
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}

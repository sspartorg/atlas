import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

export function useIsMobile(): boolean {
    const theme = useTheme();
    return useMediaQuery(theme.breakpoints.down('md'));
}

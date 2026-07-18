import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    children: ReactNode;
    pageName?: string;
}
interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    override state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    override componentDidCatch(_error: Error, info: ErrorInfo) {
        if (import.meta.env.DEV) {
            console.error('[ErrorBoundary]', info.componentStack);
        }
    }

    override render() {
        if (this.state.error) {
            return (
                <Box sx={{ p: 8, textAlign: 'center' }}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 48, color: ATLAS_PALETTE.error, display: 'block', mb: 3 }}
                    >
                        error
                    </Box>
                    <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#E2E8F0', mb: 2 }}>
                        {this.props.pageName
                            ? `${this.props.pageName} failed to load`
                            : 'Something went wrong'}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 13,
                            color: 'rgba(226,232,240,0.45)',
                            mb: 5,
                            fontFamily: '"JetBrains Mono", monospace',
                        }}
                    >
                        {this.state.error.message}
                    </Typography>
                    <Button variant="outlined" onClick={() => this.setState({ error: null })}>
                        Try again
                    </Button>
                </Box>
            );
        }
        return this.props.children;
    }
}

import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { RowActionMenu } from '../../components/RowActionMenu.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';

interface Props {
    onOpen: () => void;
    onCopyUrl: () => void;
    onReclone: () => void;
    onScheduleFetch: () => void;
    onDelete: () => void;
}

export function ProjectRowMenu({ onOpen, onCopyUrl, onReclone, onScheduleFetch, onDelete }: Props) {
    const isMobile = useIsMobile();

    return (
        <RowActionMenu
            ariaLabel="Project actions"
            items={[
                !isMobile && {
                    label: 'Open project',
                    icon: <OpenInNewRounded fontSize="small" />,
                    onClick: onOpen,
                },
                {
                    label: 'Copy repo URL',
                    icon: <ContentCopyRounded fontSize="small" />,
                    onClick: onCopyUrl,
                },
                !isMobile && {
                    label: 'Re-clone from remote',
                    icon: <RefreshRounded fontSize="small" />,
                    onClick: onReclone,
                },
                {
                    label: 'Auto-fetch schedule…',
                    icon: <ScheduleRounded fontSize="small" />,
                    onClick: onScheduleFetch,
                },
                {
                    label: 'Delete project…',
                    icon: <DeleteOutlineRounded fontSize="small" />,
                    onClick: onDelete,
                    danger: true,
                    dividerAbove: true,
                },
            ]}
        />
    );
}

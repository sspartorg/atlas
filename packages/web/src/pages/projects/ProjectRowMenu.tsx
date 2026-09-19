import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { RowActionMenu } from '../../components/RowActionMenu.js';

interface Props {
    onCopyUrl: () => void;
    onDelete: () => void;
}

// ADR 0018 — re-clone, auto-fetch and reveal all act on one repo, and a
// project has 0..N equal repos, so they live on Project Detail's Repos tab.
// What is left here works project-wide.
export function ProjectRowMenu({ onCopyUrl, onDelete }: Props) {
    return (
        <RowActionMenu
            ariaLabel="Project actions"
            items={[
                {
                    label: 'Copy repo URL',
                    icon: <ContentCopyRounded fontSize="small" />,
                    onClick: onCopyUrl,
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

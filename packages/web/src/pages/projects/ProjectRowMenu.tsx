import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { RowActionMenu } from '../../components/RowActionMenu.js';

interface Props {
    onDelete: () => void;
}

// ADR 0018 — re-clone, auto-fetch, reveal and copy-URL all act on ONE repo,
// and a project has 0..N equal repos, so they live on Project Detail's Repos
// tab. "Copy repo URL" used to be here and silently copied repos[0], which is
// wrong for every project with more than one. What is left works project-wide.
export function ProjectRowMenu({ onDelete }: Props) {
    return (
        <RowActionMenu
            ariaLabel="Project actions"
            items={[
                {
                    label: 'Delete project…',
                    icon: <DeleteOutlineRounded fontSize="small" />,
                    onClick: onDelete,
                    danger: true,
                },
            ]}
        />
    );
}

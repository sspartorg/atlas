import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { RowActionMenu } from '../../components/RowActionMenu.js';

interface Props {
    onEdit: () => void;
    onDelete: () => void;
}

export function CredentialRowMenu({ onEdit, onDelete }: Props) {
    return (
        <RowActionMenu
            ariaLabel="Credential actions"
            items={[
                { label: 'Edit', icon: <EditOutlined fontSize="small" />, onClick: onEdit },
                {
                    label: 'Delete credential…',
                    icon: <DeleteOutlineRounded fontSize="small" />,
                    onClick: onDelete,
                    danger: true,
                    dividerAbove: true,
                },
            ]}
        />
    );
}

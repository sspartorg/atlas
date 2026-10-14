import { Breadcrumb } from '../../components/Breadcrumb.js';

interface Props {
    category: string;
    agentName: string;
}

export function AgentBreadcrumbs({ category, agentName }: Props) {
    return (
        <Breadcrumb
            items={[{ label: 'Agents', to: '/agents' }, { label: category }, { label: agentName }]}
        />
    );
}

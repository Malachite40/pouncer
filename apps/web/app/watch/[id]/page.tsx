import { redirect } from 'next/navigation';

export default async function LegacyWatchDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    redirect(`/watches/${id}`);
}

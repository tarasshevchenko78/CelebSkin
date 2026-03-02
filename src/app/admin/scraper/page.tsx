import PipelineControls from '@/components/admin/PipelineControls';

export const dynamic = 'force-dynamic';

export default function AdminScraperPage() {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Pipeline Dashboard</h1>
                <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 border border-gray-700">
                    Contabo Server: 161.97.142.117
                </span>
            </div>
            <PipelineControls />
        </div>
    );
}

import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminScraperPage() {
    let stats = {
        totalRaw: 0,
        pending: 0,
        processing: 0,
        processed: 0,
        failed: 0,
        skipped: 0,
    };

    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'processing') AS processing,
                COUNT(*) FILTER (WHERE status = 'processed') AS processed,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
            FROM raw_videos
        `);
        const row = result.rows[0];
        stats = {
            totalRaw: parseInt(row.total),
            pending: parseInt(row.pending),
            processing: parseInt(row.processing),
            processed: parseInt(row.processed),
            failed: parseInt(row.failed),
            skipped: parseInt(row.skipped),
        };
    } catch (error) {
        console.error('[AdminScraper] DB error:', error);
    }

    const statCards = [
        { label: 'Total Raw', value: stats.totalRaw, color: 'text-white' },
        { label: 'Pending', value: stats.pending, color: 'text-blue-400' },
        { label: 'Processing', value: stats.processing, color: 'text-yellow-400' },
        { label: 'Processed', value: stats.processed, color: 'text-green-400' },
        { label: 'Failed', value: stats.failed, color: 'text-red-400' },
        { label: 'Skipped', value: stats.skipped, color: 'text-gray-400' },
    ];

    return (
        <div>
            <h1 className="text-2xl font-bold text-white mb-6">Scraper Dashboard</h1>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                {statCards.map((card) => (
                    <div key={card.label} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                        <p className="text-xs text-gray-400">{card.label}</p>
                        <p className={`mt-1 text-2xl font-bold ${card.color}`}>{card.value.toLocaleString()}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                <h2 className="text-lg font-semibold text-white mb-3">Scraper Control</h2>
                <p className="text-sm text-gray-400 mb-4">
                    The scraper runs on the Contabo server. Use the controls below or manage via SSH.
                </p>
                <div className="flex gap-3">
                    <button
                        disabled
                        className="px-4 py-2 text-sm rounded-lg bg-green-900/50 text-green-400 border border-green-800 opacity-50 cursor-not-allowed"
                    >
                        Start Scraper
                    </button>
                    <button
                        disabled
                        className="px-4 py-2 text-sm rounded-lg bg-red-900/50 text-red-400 border border-red-800 opacity-50 cursor-not-allowed"
                    >
                        Stop Scraper
                    </button>
                    <button
                        disabled
                        className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-400 border border-gray-700 opacity-50 cursor-not-allowed"
                    >
                        View Logs
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                    Scraper API integration is pending. Buttons will be enabled once the scraper API is set up on Contabo.
                </p>
            </div>
        </div>
    );
}

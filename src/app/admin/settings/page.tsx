import { config } from '@/lib/config';

export default function AdminSettingsPage() {
    const sections = [
        {
            title: 'Database',
            items: [
                { label: 'Host', value: config.db.host, masked: false },
                { label: 'Database', value: config.db.name, masked: false },
                { label: 'User', value: config.db.user, masked: false },
                { label: 'Port', value: String(config.db.port), masked: false },
            ],
        },
        {
            title: 'External Services',
            items: [
                { label: 'BunnyCDN Storage Key', value: config.bunny.storageKey, masked: true },
                { label: 'BunnyCDN Storage Zone', value: config.bunny.storageZone, masked: false },
                { label: 'Gemini API Key', value: config.geminiApiKey, masked: true },
                { label: 'TMDB API Key', value: config.tmdbApiKey, masked: true },
            ],
        },
        {
            title: 'Application',
            items: [
                { label: 'Site URL', value: config.siteUrl, masked: false },
                { label: 'CDN URL', value: config.bunny.cdnUrl, masked: false },
                { label: 'Node Environment', value: config.nodeEnv, masked: false },
                { label: 'Admin Password', value: config.admin.password, masked: true },
            ],
        },
    ];

    return (
        <div>
            <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

            <div className="space-y-6">
                {sections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                        <div className="px-5 py-3 border-b border-gray-800">
                            <h2 className="text-sm font-semibold text-white">{section.title}</h2>
                        </div>
                        <div className="divide-y divide-gray-800">
                            {section.items.map((item) => (
                                <div key={item.label} className="px-5 py-3 flex items-center justify-between">
                                    <span className="text-sm text-gray-400">{item.label}</span>
                                    <span className="text-sm text-gray-200 font-mono">
                                        {item.masked
                                            ? item.value
                                                ? `${'•'.repeat(8)}${item.value.slice(-4)}`
                                                : <span className="text-red-400">Not set</span>
                                            : item.value || <span className="text-red-400">Not set</span>
                                        }
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                <h2 className="text-lg font-semibold text-white mb-3">Environment Info</h2>
                <p className="text-sm text-gray-400">
                    Settings are configured via environment variables on the server. To change these values,
                    update the <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-xs">.env.local</code> file
                    and restart the application.
                </p>
            </div>
        </div>
    );
}

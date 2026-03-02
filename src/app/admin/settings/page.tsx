export default function AdminSettingsPage() {
    const sections = [
        {
            title: 'Database',
            items: [
                { label: 'Host', value: process.env.DB_HOST || '127.0.0.1', masked: false },
                { label: 'Database', value: process.env.DB_NAME || 'celebskin', masked: false },
                { label: 'User', value: process.env.DB_USER || 'celebskin', masked: false },
                { label: 'Port', value: process.env.DB_PORT || '5432', masked: false },
            ],
        },
        {
            title: 'External Services',
            items: [
                { label: 'BunnyCDN API Key', value: process.env.BUNNY_API_KEY, masked: true },
                { label: 'BunnyCDN Storage Zone', value: process.env.BUNNY_STORAGE_ZONE || 'Not set', masked: false },
                { label: 'Gemini API Key', value: process.env.GEMINI_API_KEY, masked: true },
                { label: 'TMDB API Key', value: process.env.TMDB_API_KEY, masked: true },
            ],
        },
        {
            title: 'Application',
            items: [
                { label: 'Site URL', value: process.env.SITE_URL || 'https://celeb.skin', masked: false },
                { label: 'Node Environment', value: process.env.NODE_ENV || 'development', masked: false },
                { label: 'Admin Password', value: process.env.ADMIN_PASSWORD, masked: true },
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
                    update the <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-xs">.env</code> file
                    and restart the application.
                </p>
            </div>
        </div>
    );
}

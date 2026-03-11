import { config } from '@/lib/config';

export default function AdminSettingsPage() {
    const sections = [
        {
            title: 'База данных',
            items: [
                { label: 'Хост', value: config.db.host, masked: false },
                { label: 'База данных', value: config.db.name, masked: false },
                { label: 'Пользователь', value: config.db.user, masked: false },
                { label: 'Порт', value: String(config.db.port), masked: false },
            ],
        },
        {
            title: 'Внешние сервисы',
            items: [
                { label: 'Ключ BunnyCDN Storage', value: config.bunny.storageKey, masked: true },
                { label: 'Зона BunnyCDN Storage', value: config.bunny.storageZone, masked: false },
                { label: 'Ключ Gemini API', value: config.geminiApiKey, masked: true },
                { label: 'Ключ TMDB API', value: config.tmdbApiKey, masked: true },
            ],
        },
        {
            title: 'Приложение',
            items: [
                { label: 'URL сайта', value: config.siteUrl, masked: false },
                { label: 'URL CDN', value: config.bunny.cdnUrl, masked: false },
                { label: 'Среда Node.js', value: config.nodeEnv, masked: false },
                { label: 'Пароль администратора', value: config.admin.password, masked: true },
            ],
        },
    ];

    return (
        <div>
            <h1 className="text-2xl font-bold text-white mb-6">Настройки</h1>

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
                                                : <span className="text-red-400">Не задано</span>
                                            : item.value || <span className="text-red-400">Не задано</span>
                                        }
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                <h2 className="text-lg font-semibold text-white mb-3">Информация о среде</h2>
                <p className="text-sm text-gray-400">
                    Настройки задаются через переменные окружения на сервере. Для изменения
                    обновите файл <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-xs">.env.local</code> и перезапустите приложение.
                </p>
            </div>
        </div>
    );
}

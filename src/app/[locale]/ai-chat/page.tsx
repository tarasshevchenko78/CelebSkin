'use client';

import { useState } from 'react';

const labels: Record<string, { title: string; subtitle: string; placeholder: string; badge: string }> = {
    en: { title: 'AI Chat', subtitle: 'Chat with AI about your favorite celebrities. Coming soon!', placeholder: 'Type a message...', badge: 'Coming Soon' },
    ru: { title: 'AI Чат', subtitle: 'Общайтесь с ИИ о ваших любимых знаменитостях. Скоро!', placeholder: 'Введите сообщение...', badge: 'Скоро' },
    de: { title: 'AI Chat', subtitle: 'Chatte mit KI über deine Lieblingsstars. Kommt bald!', placeholder: 'Nachricht eingeben...', badge: 'Kommt bald' },
    fr: { title: 'Chat IA', subtitle: 'Discutez avec l\'IA de vos célébrités préférées. Bientôt !', placeholder: 'Tapez un message...', badge: 'Bientôt' },
    es: { title: 'Chat IA', subtitle: 'Chatea con IA sobre tus celebridades favoritas. ¡Próximamente!', placeholder: 'Escribe un mensaje...', badge: 'Próximamente' },
    pt: { title: 'Chat IA', subtitle: 'Converse com IA sobre suas celebridades favoritas. Em breve!', placeholder: 'Digite uma mensagem...', badge: 'Em breve' },
    it: { title: 'Chat IA', subtitle: 'Chatta con l\'IA sulle tue celebrità preferite. In arrivo!', placeholder: 'Scrivi un messaggio...', badge: 'In arrivo' },
    pl: { title: 'Czat AI', subtitle: 'Rozmawiaj z AI o swoich ulubionych celebrytach. Wkrótce!', placeholder: 'Wpisz wiadomość...', badge: 'Wkrótce' },
    nl: { title: 'AI Chat', subtitle: 'Chat met AI over je favoriete beroemdheden. Binnenkort!', placeholder: 'Typ een bericht...', badge: 'Binnenkort' },
    tr: { title: 'AI Sohbet', subtitle: 'Favori ünlüleriniz hakkında AI ile sohbet edin. Yakında!', placeholder: 'Bir mesaj yazın...', badge: 'Yakında' },
};

export default function AiChatPage({ params }: { params: { locale: string } }) {
    const locale = params.locale;
    const l = labels[locale] || labels.en;
    const [message, setMessage] = useState('');

    return (
        <div className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{l.title}</h1>
            <p className="text-sm text-brand-secondary mb-6">{l.subtitle}</p>

            {/* Chat area (mock) */}
            <div className="relative rounded-2xl border border-brand-border bg-brand-card overflow-hidden">
                {/* Coming soon overlay */}
                <div className="absolute inset-0 z-10 backdrop-blur-sm bg-brand-bg/60 flex items-center justify-center">
                    <span className="px-6 py-3 rounded-full bg-brand-accent text-white font-bold text-lg shadow-lg">
                        {l.badge}
                    </span>
                </div>

                {/* Mock messages */}
                <div className="p-6 space-y-4 min-h-[400px] opacity-50">
                    <div className="flex justify-start">
                        <div className="max-w-xs rounded-xl bg-brand-hover px-4 py-2.5 text-sm text-brand-text">
                            Hello! Ask me anything about your favorite celebrities.
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <div className="max-w-xs rounded-xl bg-brand-accent/20 px-4 py-2.5 text-sm text-brand-text">
                            Who has the most scenes on CelebSkin?
                        </div>
                    </div>
                    <div className="flex justify-start">
                        <div className="max-w-xs rounded-xl bg-brand-hover px-4 py-2.5 text-sm text-brand-text flex items-center gap-2">
                            <span className="flex gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                        </div>
                    </div>
                </div>

                {/* Mock input */}
                <div className="border-t border-brand-border p-4 flex gap-3 opacity-50">
                    <input
                        type="text"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={l.placeholder}
                        disabled
                        className="flex-1 bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm text-brand-text placeholder:text-brand-muted focus:outline-none disabled:cursor-not-allowed"
                    />
                    <button
                        disabled
                        className="px-5 py-2.5 rounded-lg bg-brand-accent text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}

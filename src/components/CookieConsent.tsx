'use client';

import { useState, useEffect } from 'react';

const translations: Record<string, { message: string; accept: string; decline: string }> = {
    en: {
        message: 'This site uses cookies to improve your experience.',
        accept: 'Accept',
        decline: 'Decline',
    },
    ru: {
        message: 'Этот сайт использует файлы cookie для улучшения вашего опыта.',
        accept: 'Принять',
        decline: 'Отклонить',
    },
    de: {
        message: 'Diese Website verwendet Cookies, um Ihre Erfahrung zu verbessern.',
        accept: 'Akzeptieren',
        decline: 'Ablehnen',
    },
    fr: {
        message: 'Ce site utilise des cookies pour améliorer votre expérience.',
        accept: 'Accepter',
        decline: 'Refuser',
    },
    es: {
        message: 'Este sitio utiliza cookies para mejorar su experiencia.',
        accept: 'Aceptar',
        decline: 'Rechazar',
    },
    pt: {
        message: 'Este site utiliza cookies para melhorar sua experiência.',
        accept: 'Aceitar',
        decline: 'Recusar',
    },
    it: {
        message: 'Questo sito utilizza i cookie per migliorare la tua esperienza.',
        accept: 'Accetta',
        decline: 'Rifiuta',
    },
    pl: {
        message: 'Ta strona używa plików cookie, aby poprawić komfort użytkowania.',
        accept: 'Akceptuj',
        decline: 'Odrzuć',
    },
    nl: {
        message: 'Deze website gebruikt cookies om uw ervaring te verbeteren.',
        accept: 'Accepteren',
        decline: 'Weigeren',
    },
    tr: {
        message: 'Bu site deneyiminizi iyileştirmek için çerezler kullanmaktadır.',
        accept: 'Kabul Et',
        decline: 'Reddet',
    },
};

function getLocaleFromPath(): string {
    if (typeof window === 'undefined') return 'en';
    const segments = window.location.pathname.split('/').filter(Boolean);
    const locale = segments[0] || 'en';
    return locale in translations ? locale : 'en';
}

function getCookie(name: string): string | undefined {
    if (typeof document === 'undefined') return undefined;
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : undefined;
}

function setCookie(name: string, value: string, days: number): void {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

export default function CookieConsent() {
    const [visible, setVisible] = useState<boolean | null>(null);

    useEffect(() => {
        const cookie = getCookie('cookie_consent');
        setVisible(!cookie);
    }, []);

    if (visible === null || visible === false) {
        return null;
    }

    const locale = getLocaleFromPath();
    const t = translations[locale] || translations.en;

    const handleAccept = () => {
        setCookie('cookie_consent', 'accepted', 365);
        setVisible(false);
    };

    const handleDecline = () => {
        setCookie('cookie_consent', 'declined', 365);
        setVisible(false);
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-brand-border bg-brand-card">
            <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:justify-between">
                <p className="text-sm text-brand-secondary">
                    {t.message}
                </p>
                <div className="flex shrink-0 gap-3">
                    <button
                        onClick={handleAccept}
                        className="rounded-md bg-brand-accent px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-brand-accent-hover"
                    >
                        {t.accept}
                    </button>
                    <button
                        onClick={handleDecline}
                        className="rounded-md bg-brand-hover px-4 py-2 text-xs font-semibold text-brand-secondary transition-colors duration-200 hover:bg-brand-border hover:text-brand-text"
                    >
                        {t.decline}
                    </button>
                </div>
            </div>
        </div>
    );
}

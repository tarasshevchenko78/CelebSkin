'use client';

import { useState, useEffect } from 'react';

const translations: Record<string, { warning: string; enter: string; leave: string }> = {
    en: {
        warning: 'This website contains adult content. You must be 18 years or older to enter.',
        enter: 'I am 18+ — Enter',
        leave: 'Leave',
    },
    ru: {
        warning: 'Этот сайт содержит контент для взрослых. Вам должно быть 18 лет или старше для входа.',
        enter: 'Мне есть 18 — Войти',
        leave: 'Уйти',
    },
    de: {
        warning: 'Diese Website enthält Inhalte für Erwachsene. Sie müssen mindestens 18 Jahre alt sein, um fortzufahren.',
        enter: 'Ich bin 18+ — Eintreten',
        leave: 'Verlassen',
    },
    fr: {
        warning: 'Ce site contient du contenu pour adultes. Vous devez avoir 18 ans ou plus pour entrer.',
        enter: "J'ai 18 ans+ — Entrer",
        leave: 'Quitter',
    },
    es: {
        warning: 'Este sitio web contiene contenido para adultos. Debes tener 18 años o más para entrar.',
        enter: 'Tengo 18+ — Entrar',
        leave: 'Salir',
    },
    pt: {
        warning: 'Este site contém conteúdo adulto. Você deve ter 18 anos ou mais para entrar.',
        enter: 'Tenho 18+ — Entrar',
        leave: 'Sair',
    },
    it: {
        warning: 'Questo sito contiene contenuti per adulti. Devi avere almeno 18 anni per entrare.',
        enter: 'Ho 18+ anni — Entra',
        leave: 'Esci',
    },
    pl: {
        warning: 'Ta strona zawiera treści dla dorosłych. Musisz mieć ukończone 18 lat, aby wejść.',
        enter: 'Mam 18+ lat — Wchodzę',
        leave: 'Wyjdź',
    },
    nl: {
        warning: 'Deze website bevat inhoud voor volwassenen. Je moet 18 jaar of ouder zijn om verder te gaan.',
        enter: 'Ik ben 18+ — Doorgaan',
        leave: 'Verlaten',
    },
    tr: {
        warning: 'Bu web sitesi yetişkinlere yönelik içerik barındırmaktadır. Giriş için 18 yaşından büyük olmanız gerekmektedir.',
        enter: '18 yaşındayım — Giriş',
        leave: 'Ayrıl',
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

export default function AgeGate() {
    const [verified, setVerified] = useState<boolean | null>(null);

    useEffect(() => {
        const cookie = getCookie('age_verified');
        setVerified(cookie === 'true');
    }, []);

    if (verified === null || verified === true) {
        return null;
    }

    const locale = getLocaleFromPath();
    const t = translations[locale] || translations.en;

    const handleEnter = () => {
        setCookie('age_verified', 'true', 30);
        setVerified(true);
    };

    const handleLeave = () => {
        window.location.href = 'https://www.google.com';
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
            <div className="mx-4 flex max-w-md flex-col items-center text-center">
                {/* Logo */}
                <div className="mb-6 flex items-center gap-1.5 text-3xl font-bold tracking-tight">
                    <span className="text-brand-accent">Celeb</span>
                    <span className="text-brand-text">Skin</span>
                </div>

                {/* 18+ Badge */}
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand-accent">
                    <span className="text-2xl font-bold text-brand-accent">18+</span>
                </div>

                {/* Warning Text */}
                <p className="mb-8 text-base leading-relaxed text-brand-secondary">
                    {t.warning}
                </p>

                {/* Buttons */}
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
                    <button
                        onClick={handleEnter}
                        className="rounded-lg bg-brand-accent px-8 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-accent-hover"
                    >
                        {t.enter}
                    </button>
                    <button
                        onClick={handleLeave}
                        className="rounded-lg bg-brand-hover px-8 py-3 text-sm font-semibold text-brand-secondary transition-colors duration-200 hover:bg-brand-border hover:text-brand-text"
                    >
                        {t.leave}
                    </button>
                </div>
            </div>
        </div>
    );
}

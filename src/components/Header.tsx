'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '@/lib/i18n';
import { useAuth } from './AuthProvider';
import SearchDropdown from './SearchDropdown';

const navLinks = [
    { key: 'videos', href: '/video', labels: { en: 'Videos', ru: 'Видео', de: 'Videos', fr: 'Vidéos', es: 'Vídeos', pt: 'Vídeos', it: 'Video', pl: 'Wideo', nl: "Video's", tr: 'Videolar' } },
    { key: 'celebrities', href: '/celebrity', labels: { en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités', es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità', pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler' } },
    { key: 'movies', href: '/movie', labels: { en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films', es: 'Películas', pt: 'Filmes', it: 'Film', pl: 'Filmy', nl: 'Films', tr: 'Filmler' } },
    { key: 'collections', href: '/collection', labels: { en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections', es: 'Colecciones', pt: 'Coleções', it: 'Collezioni', pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar' } },
];

export default function Header({ locale }: { locale: string }) {
    const [langOpen, setLangOpen] = useState(false);
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    const mobileSearchInputRef = useRef<HTMLInputElement>(null);
    const { user, loading, openAuthModal } = useAuth();
    const pathname = usePathname();

    // Close mobile search on navigation
    useEffect(() => {
        setMobileSearchOpen(false);
    }, [pathname]);

    // Focus input when mobile search opens
    useEffect(() => {
        if (mobileSearchOpen) {
            setTimeout(() => mobileSearchInputRef.current?.focus(), 100);
        }
    }, [mobileSearchOpen]);
    // Strip current locale prefix to get the path after locale
    const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}/, '') || '/';
    const buildLocaleHref = (loc: string) => `/${loc}${pathWithoutLocale}`;

    return (
        <header className="sticky top-0 z-50 pt-2 pb-2 px-2 md:px-6 lg:px-10 bg-transparent w-full">
            {/* Desktop Split Header */}
            <div className="hidden md:flex relative items-center justify-between h-[64px] mt-4 w-full">

                {/* Left: Navigation Island */}
                <nav className="flex-1 mr-[90px] lg:mr-[140px] flex items-center justify-between h-full px-4 lg:px-10 rounded-full border border-brand-accent/40 bg-brand-bg/90 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    {navLinks.map((link, index) => (
                        <div key={link.key} className="flex items-center justify-between h-full flex-1">
                            <div className="flex-1 flex justify-center">
                                <a
                                    href={`/${locale}${link.href}`}
                                    className="text-[15px] lg:text-[16px] font-semibold text-[#c0bba8] hover:text-brand-gold-light transition-all duration-300 block py-2 whitespace-nowrap"
                                >
                                    {(link.labels as Record<string, string>)[locale] || link.labels.en}
                                </a>
                            </div>
                            {index < navLinks.length - 1 && (
                                <div className="w-[1px] h-4 bg-brand-accent/30 hidden lg:block" />
                            )}
                        </div>
                    ))}
                </nav>

                {/* Center: Large Overlaying Logo */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center justify-center filter drop-shadow-[0_0_15px_rgba(212,175,55,0.4)] pointer-events-none">
                    <a href={`/${locale}`} className="pointer-events-auto block transition-transform hover:scale-105 duration-300">
                        <img
                            src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                            alt="CelebSkin Logo"
                            className="h-[105px] w-auto object-contain mt-2"
                        />
                    </a>
                </div>

                {/* Right: Search, User & Language Island */}
                <div className="flex-1 ml-[90px] lg:ml-[140px] flex items-center gap-2 lg:gap-4 h-full px-4 lg:px-6 rounded-full border border-brand-accent/40 bg-brand-bg/90 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    {/* Search with Dropdown */}
                    <SearchDropdown locale={locale} />

                    {/* User Button */}
                    {!loading && (
                        user ? (
                            <a
                                href={`/${locale}/profile`}
                                title={user.username}
                                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-brand-accent/15 border border-brand-accent/40 hover:bg-brand-accent/25 transition-colors"
                            >
                                <svg className="w-5 h-5 text-brand-gold-light" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                                </svg>
                            </a>
                        ) : (
                            <button
                                onClick={() => openAuthModal()}
                                title="Sign In"
                                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-[#1a1815] border border-brand-accent/30 hover:bg-[#25221d] hover:border-brand-accent/60 transition-colors"
                            >
                                <svg className="w-5 h-5 text-brand-secondary hover:text-brand-gold-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                            </button>
                        )
                    )}

                    {/* Language Selector */}
                    <div className="relative z-20 shrink-0">
                        <button
                            onClick={() => setLangOpen(!langOpen)}
                            className="flex items-center justify-center gap-2 h-10 px-4 min-w-[110px] rounded-full bg-[#1a1815] border border-brand-accent/30 text-[15px] font-medium text-[#e8e6df] hover:bg-[#25221d] hover:text-brand-gold-light hover:border-brand-accent/60 transition-all group"
                        >
                            <svg className="w-5 h-5 text-brand-accent/70 group-hover:text-brand-gold-light transition-colors hidden lg:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {LOCALE_NAMES[locale as SupportedLocale] || locale.toUpperCase()}
                            <svg className={`w-4 h-4 text-brand-secondary transition-transform duration-300 ${langOpen ? 'rotate-180 text-brand-gold-light' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-0 top-12 w-48 rounded-2xl border border-brand-accent/50 bg-[#11100e]/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] py-3 z-50 overflow-hidden">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a
                                        key={loc}
                                        href={buildLocaleHref(loc)}
                                        className={`flex items-center px-5 py-2.5 text-[15px] transition-colors ${loc === locale
                                            ? 'text-brand-gold-light bg-brand-accent/10 border-l-2 border-brand-accent font-medium'
                                            : 'text-[#c0bba8] hover:text-white hover:bg-[#1f1d19] border-l-2 border-transparent'
                                            }`}
                                        onClick={() => setLangOpen(false)}
                                    >
                                        {LOCALE_NAMES[loc]}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Mobile Search Overlay */}
            {mobileSearchOpen && (
                <div className="fixed inset-0 z-[60] bg-brand-bg md:hidden overflow-y-auto">
                    <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                        <button
                            onClick={() => setMobileSearchOpen(false)}
                            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-brand-bg border border-brand-accent/30 text-brand-secondary"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div className="flex-1">
                            <SearchDropdown locale={locale} />
                        </div>
                    </div>
                    {/* Hint text */}
                    <div className="px-6 pt-6">
                        <p className="text-sm text-brand-secondary/60">
                            {locale === 'ru' ? 'Начните вводить имя актрисы, фильм или тег...' : 'Start typing a celebrity name, movie or tag...'}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-4">
                            {['Demi Moore', 'Margot Robbie', 'sex scene', 'topless', 'shower', 'lesbian'].map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => {
                                        const input = document.querySelector<HTMLInputElement>('.fixed input[type="text"]');
                                        if (input) {
                                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                            nativeInputValueSetter?.call(input, tag);
                                            input.dispatchEvent(new Event('input', { bubbles: true }));
                                            input.dispatchEvent(new Event('change', { bubbles: true }));
                                            input.focus();
                                        }
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium rounded-full bg-brand-accent/10 border border-brand-accent/25 text-brand-gold-light hover:bg-brand-accent/20 transition-colors"
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Split Header */}
            <div className="flex md:hidden relative items-center justify-between h-14 mt-3 px-2">
                {/* Left side: Search trigger for mobile */}
                <div className="flex-1 flex justify-start relative z-20">
                    <button onClick={() => setMobileSearchOpen(true)} className="w-12 h-12 rounded-full flex items-center justify-center bg-brand-bg/90 backdrop-blur-md text-brand-secondary hover:text-brand-gold-light border border-brand-accent/40 shadow-[0_4px_15px_rgba(0,0,0,0.4)]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </button>
                </div>

                {/* Center: Logo overlay */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 filter drop-shadow-[0_0_10px_rgba(212,175,55,0.3)]">
                    <a href={`/${locale}`} className="block">
                        <img
                            src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                            alt="CelebSkin Logo"
                            className="h-[75px] w-auto object-contain mt-1"
                        />
                    </a>
                </div>

                {/* Right side: User + Language */}
                <div className="flex-1 flex justify-end items-center gap-2 relative z-20">
                    {/* User icon (mobile) */}
                    {!loading && (
                        user ? (
                            <a
                                href={`/${locale}/profile`}
                                className="w-10 h-10 rounded-full flex items-center justify-center bg-brand-accent/15 border border-brand-accent/40"
                            >
                                <svg className="w-5 h-5 text-brand-gold-light" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                                </svg>
                            </a>
                        ) : (
                            <button
                                onClick={() => openAuthModal()}
                                className="w-10 h-10 rounded-full flex items-center justify-center bg-brand-bg/90 backdrop-blur-md border border-brand-accent/40"
                            >
                                <svg className="w-5 h-5 text-brand-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                            </button>
                        )
                    )}

                    {/* Language */}
                    <div className="relative">
                        <button onClick={() => setLangOpen(!langOpen)} className="h-10 px-3 rounded-full bg-brand-bg/90 backdrop-blur-md border border-brand-accent/40 text-[#e8e6df] flex items-center gap-1 focus:outline-none shadow-[0_4px_15px_rgba(0,0,0,0.4)]">
                            <span className="text-sm font-semibold">{(locale as string).toUpperCase()}</span>
                            <svg className={`w-3.5 h-3.5 text-brand-secondary transition-transform duration-200 ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-0 top-12 w-36 rounded-xl border border-brand-accent/40 bg-[#11100e] shadow-2xl py-2 z-50">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a key={loc} href={buildLocaleHref(loc)} className={`block px-4 py-2 text-[14px] ${loc === locale ? 'text-brand-gold-light bg-brand-accent/10' : 'text-[#c0bba8] hover:bg-[#1a1815]'}`} onClick={() => setLangOpen(false)}>{LOCALE_NAMES[loc]}</a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

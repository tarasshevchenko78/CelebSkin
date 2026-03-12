'use client';

import { useState } from 'react';
import { SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '@/lib/i18n';

const navLinks = [
    { key: 'videos', href: '/video', labels: { en: 'Videos', ru: 'Видео', de: 'Videos', fr: 'Vidéos', es: 'Videos', pt: 'Vídeos', it: 'Video', pl: 'Filmy', nl: "Video's", tr: 'Videolar' } },
    { key: 'celebrities', href: '/celebrity', labels: { en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités', es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità', pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler' } },
    { key: 'movies', href: '/movie', labels: { en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films', es: 'Películas', pt: 'Filmes', it: 'Film', pl: 'Filmy', nl: 'Films', tr: 'Filmler' } },
    { key: 'collections', href: '/collection', labels: { en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections', es: 'Colecciones', pt: 'Coleções', it: 'Collezioni', pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar' } },
];

export default function Header({ locale }: { locale: string }) {
    const [langOpen, setLangOpen] = useState(false);

    return (
        <header className="sticky top-0 z-50 pt-4 pb-2 px-4 bg-brand-bg/95 backdrop-blur-md">
            <div className="mx-auto max-w-[1400px]">
                {/* Desktop Capsule */}
                <div className="hidden md:flex items-center justify-between h-[72px] rounded-[36px] border border-brand-accent/40 bg-brand-card shadow-[0_0_20px_rgba(212,175,55,0.05)] pl-2 pr-6">

                    {/* Left: Logo */}
                    <a href={`/${locale}`} className="flex items-center h-full shrink-0 ml-2">
                        <img
                            src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                            alt="CelebSkin Logo"
                            className="h-[44px] w-auto object-contain"
                        />
                    </a>

                    {/* Middle: Nav Links (with vertical separators) */}
                    <nav className="flex items-center h-8 ml-8 gap-6 flex-grow">
                        {navLinks.map((link, index) => (
                            <div key={link.key} className="flex items-center gap-6 h-full">
                                <a
                                    href={`/${locale}${link.href}`}
                                    className="text-[15px] font-medium text-[#c0bba8] hover:text-brand-gold-light transition-all duration-300 whitespace-nowrap"
                                >
                                    {(link.labels as Record<string, string>)[locale] || link.labels.en}
                                </a>
                                {index < navLinks.length - 1 && (
                                    <div className="w-[1px] h-4 bg-brand-accent/30" />
                                )}
                            </div>
                        ))}
                    </nav>

                    {/* Right: Search & Language */}
                    <div className="flex items-center gap-6 shrink-0 h-8">
                        {/* Search Input (pill shape inside the capsule) */}
                        <form action={`/${locale}/search`} className="relative">
                            <input
                                type="text"
                                name="q"
                                placeholder={locale === 'ru' ? 'Поиск...' : 'Search...'}
                                className="w-56 bg-[#1a1917] border border-brand-accent/30 rounded-full py-1.5 pl-10 pr-4 text-[15px] text-brand-gold-light placeholder-brand-secondary/70 focus:outline-none focus:ring-1 focus:ring-brand-accent/70 focus:border-brand-accent/70 transition-all"
                            />
                            <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-secondary hover:text-brand-gold-light transition-colors">
                                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </button>
                        </form>

                        {/* Language Selector */}
                        <div className="relative">
                            <button
                                onClick={() => setLangOpen(!langOpen)}
                                className="flex items-center gap-2 text-[15px] font-medium text-[#c0bba8] hover:text-brand-gold-light transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {LOCALE_NAMES[locale as SupportedLocale] || locale.toUpperCase()}
                                <svg className={`w-3.5 h-3.5 transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {langOpen && (
                                <div className="absolute right-0 top-10 w-40 rounded-xl border border-brand-accent/40 bg-[#11100e] shadow-xl py-2 z-50">
                                    {SUPPORTED_LOCALES.map((loc) => (
                                        <a
                                            key={loc}
                                            href={`/${loc}`}
                                            className={`block px-4 py-2 text-sm transition-colors ${loc === locale
                                                ? 'text-brand-gold-light bg-brand-accent/10'
                                                : 'text-[#c0bba8] hover:text-brand-gold-light hover:bg-[#1c1a17]'
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

                {/* Mobile Header (simplified but matches aesthetic) */}
                <div className="flex md:hidden items-center justify-between h-14 rounded-full border border-brand-accent/40 bg-brand-card shadow-sm px-4">
                    <a href={`/${locale}`} className="flex items-center">
                        <img
                            src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                            alt="CelebSkin Logo"
                            className="h-8 w-auto object-contain"
                        />
                    </a>
                    <div className="flex items-center gap-4">
                        <a href={`/${locale}/search`} className="text-brand-secondary hover:text-brand-gold-light">
                            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </a>
                        <button onClick={() => setLangOpen(!langOpen)} className="text-brand-secondary flex items-center gap-1">
                            <span className="text-sm font-medium">{(locale as string).toUpperCase()}</span>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-4 top-20 w-32 rounded-lg border border-brand-accent/40 bg-[#11100e] shadow-xl py-1 z-50">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a key={loc} href={`/${loc}`} className="block px-3 py-2 text-sm text-[#c0bba8]" onClick={() => setLangOpen(false)}>{LOCALE_NAMES[loc]}</a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

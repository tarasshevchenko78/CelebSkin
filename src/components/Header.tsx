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
        <header className="sticky top-0 z-50 pt-2 pb-2 px-2 md:px-6 lg:px-10 bg-transparent w-full">
            {/* Desktop Split Header */}
            <div className="hidden md:flex relative items-center justify-between h-[64px] mt-4 w-full">

                {/* Left: Navigation Island */}
                <nav className="flex items-center gap-4 lg:gap-8 h-full px-8 rounded-full border border-brand-accent/40 bg-brand-bg/90 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    {navLinks.map((link, index) => (
                        <div key={link.key} className="flex items-center gap-4 lg:gap-8 h-full">
                            <a
                                href={`/${locale}${link.href}`}
                                className="text-[16px] font-semibold text-[#c0bba8] hover:text-brand-gold-light transition-all duration-300 block py-2 whitespace-nowrap"
                            >
                                {(link.labels as Record<string, string>)[locale] || link.labels.en}
                            </a>
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

                {/* Right: Search & Language Island */}
                <div className="flex items-center gap-3 lg:gap-5 h-full px-4 rounded-full border border-brand-accent/40 bg-brand-bg/90 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    {/* Large Search Input */}
                    <form action={`/${locale}/search`} className="relative w-full max-w-[280px] lg:max-w-[320px]">
                        <input
                            type="text"
                            name="q"
                            placeholder={locale === 'ru' ? 'Поиск...' : 'Search actors, movies...'}
                            className="w-full bg-[#161411]/80 border border-brand-accent/30 rounded-full py-2 pl-11 pr-4 text-[15px] text-brand-gold-light placeholder-brand-secondary/60 focus:outline-none focus:ring-1 focus:ring-brand-accent/80 focus:border-brand-accent/80 transition-all shadow-inner"
                        />
                        <button type="submit" className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-secondary hover:text-brand-gold-light transition-colors">
                            <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </button>
                    </form>

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
                                        href={`/${loc}`}
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

            {/* Mobile Split Header */}
            <div className="flex md:hidden relative items-center justify-between h-14 mt-3 px-2">
                {/* Left side: Search trigger for mobile */}
                <div className="flex-1 flex justify-start relative z-20">
                    <a href={`/${locale}/search`} className="w-12 h-12 rounded-full flex items-center justify-center bg-brand-bg/90 backdrop-blur-md text-brand-secondary hover:text-brand-gold-light border border-brand-accent/40 shadow-[0_4px_15px_rgba(0,0,0,0.4)]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </a>
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

                {/* Right side: Language selection */}
                <div className="flex-1 flex justify-end relative z-20">
                    <div className="relative">
                        <button onClick={() => setLangOpen(!langOpen)} className="h-12 px-4 rounded-full bg-brand-bg/90 backdrop-blur-md border border-brand-accent/40 text-[#e8e6df] flex items-center gap-1.5 focus:outline-none shadow-[0_4px_15px_rgba(0,0,0,0.4)]">
                            <span className="text-sm font-semibold">{(locale as string).toUpperCase()}</span>
                            <svg className={`w-3.5 h-3.5 text-brand-secondary transition-transform duration-200 ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-0 top-12 w-36 rounded-xl border border-brand-accent/40 bg-[#11100e] shadow-2xl py-2 z-50">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a key={loc} href={`/${loc}`} className={`block px-4 py-2 text-[14px] ${loc === locale ? 'text-brand-gold-light bg-brand-accent/10' : 'text-[#c0bba8] hover:bg-[#1a1815]'}`} onClick={() => setLangOpen(false)}>{LOCALE_NAMES[loc]}</a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

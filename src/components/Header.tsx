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
        <header className="sticky top-0 z-50 border-b border-brand-border bg-brand-bg/95 backdrop-blur-md">
            <nav className="mx-auto flex h-[88px] md:h-[104px] max-w-[1600px] items-center justify-between px-4">
                {/* Logo */}
                <a href={`/${locale}`} className="flex items-center gap-2 font-bold text-xl tracking-tight">
                    <img
                        src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                        alt="CelebSkin Logo"
                        className="h-16 md:h-[72px] w-auto object-contain"
                    />
                </a>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-6">
                    {navLinks.map((link) => (
                        <a
                            key={link.key}
                            href={`/${locale}${link.href}`}
                            className="text-sm text-brand-secondary hover:text-brand-text transition-colors duration-200 whitespace-nowrap"
                        >
                            {(link.labels as Record<string, string>)[locale] || link.labels.en}
                        </a>
                    ))}

                    <form action={`/${locale}/search`} className="relative ml-2 mr-2">
                        <input
                            type="text"
                            name="q"
                            placeholder={locale === 'ru' ? 'Поиск...' : 'Search...'}
                            className="w-48 bg-brand-card border border-brand-border rounded-full py-1.5 pl-9 pr-4 text-sm text-brand-text placeholder-brand-muted focus:outline-none focus:ring-1 focus:ring-brand-accent focus:border-brand-accent transition-all"
                        />
                        <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-secondary hover:text-brand-text">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </button>
                    </form>

                    {/* Language Selector */}
                    <div className="relative">
                        <button
                            onClick={() => setLangOpen(!langOpen)}
                            className="flex items-center gap-1 text-sm text-brand-secondary hover:text-brand-text transition-colors"
                        >
                            {LOCALE_NAMES[locale as SupportedLocale] || locale.toUpperCase()}
                            <svg className={`w-3 h-3 transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-0 top-8 w-40 rounded-lg border border-brand-border bg-brand-card shadow-xl py-1 z-50">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a
                                        key={loc}
                                        href={`/${loc}`}
                                        className={`block px-3 py-1.5 text-sm transition-colors ${loc === locale
                                            ? 'text-brand-accent bg-brand-hover'
                                            : 'text-brand-secondary hover:text-brand-text hover:bg-brand-hover'
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

                {/* Mobile: search icon + language toggle (nav links moved to BottomNav) */}
                <div className="flex md:hidden items-center gap-3">
                    <a
                        href={`/${locale}/search`}
                        className="text-brand-secondary hover:text-brand-text transition-colors p-1"
                        aria-label="Search"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </a>
                    <div className="relative">
                        <button
                            onClick={() => setLangOpen(!langOpen)}
                            className="flex items-center gap-1 text-sm text-brand-secondary hover:text-brand-text transition-colors p-1"
                        >
                            {(locale as string).toUpperCase()}
                            <svg className={`w-3 h-3 transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {langOpen && (
                            <div className="absolute right-0 top-8 w-40 rounded-lg border border-brand-border bg-brand-card shadow-xl py-1 z-50">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a
                                        key={loc}
                                        href={`/${loc}`}
                                        className={`block px-3 py-1.5 text-sm transition-colors ${loc === locale
                                            ? 'text-brand-accent bg-brand-hover'
                                            : 'text-brand-secondary hover:text-brand-text hover:bg-brand-hover'
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
            </nav>
        </header>
    );
}

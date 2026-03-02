'use client';

import { useState } from 'react';
import { SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '@/lib/i18n';

const navLinks = [
    { key: 'videos', href: '/video', labels: { en: 'Videos', ru: 'Видео', de: 'Videos', fr: 'Vidéos', es: 'Videos', pt: 'Vídeos', it: 'Video', pl: 'Filmy', nl: "Video's", tr: 'Videolar' } },
    { key: 'celebrities', href: '/celebrity', labels: { en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités', es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità', pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler' } },
    { key: 'movies', href: '/movie', labels: { en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films', es: 'Películas', pt: 'Filmes', it: 'Film', pl: 'Filmy', nl: 'Films', tr: 'Filmler' } },
];

export default function Header({ locale }: { locale: string }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);

    return (
        <header className="sticky top-0 z-50 border-b border-brand-border bg-brand-bg/95 backdrop-blur-md">
            <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
                {/* Logo */}
                <a href={`/${locale}`} className="flex items-center gap-1.5 font-bold text-xl tracking-tight">
                    <span className="text-brand-accent">Celeb</span>
                    <span className="text-brand-text">Skin</span>
                </a>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-6">
                    {navLinks.map((link) => (
                        <a
                            key={link.key}
                            href={`/${locale}${link.href}`}
                            className="text-sm text-brand-secondary hover:text-brand-text transition-colors duration-200"
                        >
                            {(link.labels as Record<string, string>)[locale] || link.labels.en}
                        </a>
                    ))}
                    <a
                        href={`/${locale}/search`}
                        className="text-sm text-brand-secondary hover:text-brand-text transition-colors duration-200"
                        aria-label="Search"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </a>

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

                {/* Mobile Hamburger */}
                <button
                    className="md:hidden text-brand-secondary hover:text-brand-text p-1"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Menu"
                >
                    {mobileOpen ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    )}
                </button>
            </nav>

            {/* Mobile Menu */}
            {mobileOpen && (
                <div className="md:hidden border-t border-brand-border bg-brand-card">
                    <div className="px-4 py-3 space-y-1">
                        {navLinks.map((link) => (
                            <a
                                key={link.key}
                                href={`/${locale}${link.href}`}
                                className="block py-2 text-sm text-brand-secondary hover:text-brand-text transition-colors"
                                onClick={() => setMobileOpen(false)}
                            >
                                {(link.labels as Record<string, string>)[locale] || link.labels.en}
                            </a>
                        ))}
                        <a
                            href={`/${locale}/search`}
                            className="block py-2 text-sm text-brand-secondary hover:text-brand-text transition-colors"
                            onClick={() => setMobileOpen(false)}
                        >
                            Search
                        </a>
                        <div className="pt-2 border-t border-brand-border">
                            <p className="text-xs text-brand-muted mb-2">Language</p>
                            <div className="flex flex-wrap gap-2">
                                {SUPPORTED_LOCALES.map((loc) => (
                                    <a
                                        key={loc}
                                        href={`/${loc}`}
                                        className={`text-xs px-2 py-1 rounded transition-colors ${loc === locale
                                                ? 'bg-brand-accent text-white'
                                                : 'bg-brand-hover text-brand-secondary hover:text-brand-text'
                                            }`}
                                    >
                                        {loc.toUpperCase()}
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
}

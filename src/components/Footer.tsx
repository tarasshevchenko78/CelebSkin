import { SUPPORTED_LOCALES, LOCALE_NAMES } from '@/lib/i18n';

const footerLinks = [
    { key: 'about', labels: { en: 'About', ru: 'О нас', de: 'Über uns', fr: 'À propos', es: 'Acerca de', pt: 'Sobre', it: 'Chi siamo', pl: 'O nas', nl: 'Over ons', tr: 'Hakkında' } },
    { key: 'dmca', labels: { en: 'DMCA', ru: 'DMCA', de: 'DMCA', fr: 'DMCA', es: 'DMCA', pt: 'DMCA', it: 'DMCA', pl: 'DMCA', nl: 'DMCA', tr: 'DMCA' } },
    { key: 'privacy', labels: { en: 'Privacy Policy', ru: 'Конфиденциальность', de: 'Datenschutz', fr: 'Confidentialité', es: 'Privacidad', pt: 'Privacidade', it: 'Privacy', pl: 'Prywatność', nl: 'Privacy', tr: 'Gizlilik' } },
    { key: 'terms', labels: { en: 'Terms', ru: 'Условия', de: 'Nutzungsbedingungen', fr: 'Conditions', es: 'Términos', pt: 'Termos', it: 'Termini', pl: 'Regulamin', nl: 'Voorwaarden', tr: 'Şartlar' } },
    { key: 'contact', labels: { en: 'Contact', ru: 'Контакты', de: 'Kontakt', fr: 'Contact', es: 'Contacto', pt: 'Contato', it: 'Contatto', pl: 'Kontakt', nl: 'Contact', tr: 'İletişim' } },
];

export default function Footer({ locale }: { locale: string }) {
    return (
        <footer className="mt-auto border-t border-brand-border bg-brand-bg">
            {/* Main content */}
            <div className="mx-auto max-w-[1600px] px-4 py-2">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    {/* Left: logo + description in 2 lines */}
                    <div className="flex items-center gap-3 shrink-0">
                        <a href={`/${locale}`} className="inline-flex items-center shrink-0">
                            <img
                                src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                                alt="CelebSkin Logo"
                                className="h-9 w-auto object-contain grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all"
                            />
                        </a>
                        <p className="text-xs text-brand-muted max-w-[360px] leading-snug">
                            Celebrity nude scenes from movies and TV shows. All content is sourced from publicly available materials.
                        </p>
                    </div>

                    {/* Right: links in 2 rows */}
                    <div className="flex flex-col gap-1 items-end">
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                            {[
                                { href: `/${locale}/video`, labels: { en: 'Videos', ru: 'Видео', de: 'Videos', fr: 'Vidéos', es: 'Videos', pt: 'Vídeos', it: 'Video', pl: 'Wideo', nl: "Video's", tr: 'Videolar' } },
                                { href: `/${locale}/celebrity`, labels: { en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités', es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità', pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler' } },
                                { href: `/${locale}/movie`, labels: { en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films', es: 'Películas', pt: 'Filmes', it: 'Film', pl: 'Filmy', nl: 'Films', tr: 'Filmler' } },
                                { href: `/${locale}/collection`, labels: { en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections', es: 'Colecciones', pt: 'Coleções', it: 'Collezioni', pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar' } },
                            ].map((item) => (
                                <a key={item.href} href={item.href} className="text-sm font-medium text-brand-secondary hover:text-brand-accent transition-colors duration-200">
                                    {(item.labels as Record<string, string>)[locale] || item.labels.en}
                                </a>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                            {footerLinks.map((link) => (
                                <a
                                    key={link.key}
                                    href={`/${locale}/${link.key}`}
                                    className="text-sm text-brand-secondary hover:text-brand-text transition-colors duration-200"
                                >
                                    {(link.labels as Record<string, string>)[locale] || link.labels.en}
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Full-width separator */}
            <div className="border-t border-brand-border" />

            {/* Bottom: languages + copyright */}
            <div className="mx-auto max-w-[1600px] px-4 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Language links */}
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-brand-muted">🌐</span>
                        {SUPPORTED_LOCALES.map((loc, i) => (
                            <span key={loc} className="flex items-center gap-3">
                                <a
                                    href={`/${loc}`}
                                    className={`text-xs transition-colors duration-200 ${loc === locale
                                        ? 'text-brand-accent font-medium'
                                        : 'text-brand-muted hover:text-brand-secondary'
                                        }`}
                                >
                                    {LOCALE_NAMES[loc]}
                                </a>
                                {i < SUPPORTED_LOCALES.length - 1 && (
                                    <span className="text-brand-border text-xs">·</span>
                                )}
                            </span>
                        ))}
                    </div>
                    <p className="text-xs text-brand-muted">18+ Only</p>
                </div>
                <p className="text-xs text-brand-muted mt-1">© 2026 CelebSkin. All rights reserved.</p>
            </div>
        </footer>
    );
}

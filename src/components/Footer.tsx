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
            <div className="mx-auto max-w-[1600px] px-4 py-10">
                {/* Top section */}
                <div className="flex flex-col gap-8 md:flex-row md:justify-between">
                    {/* Brand */}
                    <div className="shrink-0">
                        <a href={`/${locale}`} className="inline-flex items-center gap-2 font-bold text-lg tracking-tight mb-3">
                            <img
                                src="https://celebskin-cdn.b-cdn.net/watermarks/watermark-1773274037450.png"
                                alt="CelebSkin Logo"
                                className="h-8 w-auto object-contain grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all"
                            />
                        </a>
                        <p className="text-xs text-brand-muted max-w-xs leading-relaxed">
                            Celebrity nude scenes from movies and TV shows. All content is sourced from publicly available materials.
                        </p>
                    </div>

                    {/* Links */}
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
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

                {/* Language links */}
                <div className="mt-8 pt-6 border-t border-brand-border">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-brand-muted mr-1">🌐</span>
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
                </div>

                {/* Copyright */}
                <div className="mt-6 flex items-center justify-between">
                    <p className="text-xs text-brand-muted">
                        © 2026 CelebSkin. All rights reserved.
                    </p>
                    <p className="text-xs text-brand-muted">
                        18+ Only
                    </p>
                </div>
            </div>
        </footer>
    );
}

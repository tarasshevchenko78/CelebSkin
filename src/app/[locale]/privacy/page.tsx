import type { Metadata } from 'next';
import type { SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Privacy Policy — CelebSkin',
    ru: 'Политика конфиденциальности — CelebSkin',
    de: 'Datenschutzrichtlinie — CelebSkin',
    fr: 'Politique de confidentialité — CelebSkin',
    es: 'Política de privacidad — CelebSkin',
    pt: 'Política de privacidade — CelebSkin',
    it: 'Informativa sulla privacy — CelebSkin',
    pl: 'Polityka prywatności — CelebSkin',
    nl: 'Privacybeleid — CelebSkin',
    tr: 'Gizlilik Politikası — CelebSkin',
};

const pageHeadings: Record<string, string> = {
    en: 'Privacy Policy',
    ru: 'Политика конфиденциальности',
    de: 'Datenschutzrichtlinie',
    fr: 'Politique de confidentialité',
    es: 'Política de privacidad',
    pt: 'Política de privacidade',
    it: 'Informativa sulla privacy',
    pl: 'Polityka prywatności',
    nl: 'Privacybeleid',
    tr: 'Gizlilik Politikası',
};

export async function generateMetadata({
    params,
}: {
    params: { locale: string };
}): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: titles[locale] || titles.en,
    };
}

export default function PrivacyPage({
    params,
}: {
    params: { locale: string };
}) {
    const locale = params.locale;
    const heading = pageHeadings[locale] || pageHeadings.en;

    return (
        <div className="mx-auto max-w-3xl px-4 py-12">
            <h1 className="mb-8 text-3xl font-bold text-brand-text">{heading}</h1>
            <p className="mb-8 text-sm text-brand-muted">
                Last updated: January 1, 2026
            </p>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">1. Introduction</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    CelebSkin (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the website
                    celeb.skin (the &quot;Site&quot;). This Privacy Policy explains how we collect, use,
                    disclose, and safeguard your information when you visit our Site. This Site contains
                    adult content intended for individuals who are 18 years of age or older. By accessing
                    the Site, you confirm that you meet this age requirement.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Please read this Privacy Policy carefully. If you do not agree with the terms of this
                    Privacy Policy, please do not access the Site.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">2. Information We Collect</h2>

                <h3 className="mb-3 text-lg font-medium text-brand-text">Automatically Collected Information</h3>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    When you visit the Site, we may automatically collect certain information about your
                    device and your visit, including:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>Your IP address (anonymized where required by law).</li>
                    <li>Browser type and version.</li>
                    <li>Operating system.</li>
                    <li>Referring URLs and exit pages.</li>
                    <li>Pages viewed and time spent on pages.</li>
                    <li>Date and time of your visit.</li>
                    <li>Language preferences.</li>
                </ul>

                <h3 className="mb-3 text-lg font-medium text-brand-text">Cookies and Similar Technologies</h3>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We use cookies and similar tracking technologies to enhance your experience on the
                    Site. The cookies we use include:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>
                        <strong className="text-brand-text">Essential cookies:</strong> Required for the Site to function
                        properly, such as age verification and cookie consent preferences.
                    </li>
                    <li>
                        <strong className="text-brand-text">Analytics cookies:</strong> Help us understand how visitors
                        interact with the Site by collecting information anonymously.
                    </li>
                    <li>
                        <strong className="text-brand-text">Preference cookies:</strong> Remember your language and display
                        preferences to provide a personalized experience.
                    </li>
                </ul>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    You can control cookie preferences through your browser settings or through our
                    cookie consent mechanism on the Site.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">3. How We Use Your Information</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We use the information we collect for the following purposes:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>To provide, operate, and maintain the Site.</li>
                    <li>To improve, personalize, and expand the Site.</li>
                    <li>To understand and analyze how you use the Site.</li>
                    <li>To comply with age verification requirements.</li>
                    <li>To detect, prevent, and address technical issues or abuse.</li>
                    <li>To comply with legal obligations.</li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">4. Third-Party Services</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We may use third-party services to help us operate and improve the Site. These
                    services may collect information sent by your browser as part of a web page request,
                    such as cookies or your IP address. Third-party services we may use include:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>
                        <strong className="text-brand-text">Analytics providers:</strong> To help us measure traffic and
                        usage trends for the Site.
                    </li>
                    <li>
                        <strong className="text-brand-text">Content delivery networks (CDNs):</strong> To deliver content
                        efficiently to users around the world.
                    </li>
                    <li>
                        <strong className="text-brand-text">Hosting providers:</strong> To host and serve the Site.
                    </li>
                </ul>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    These third parties have their own privacy policies addressing how they use such
                    information. We encourage you to review these policies.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">5. Data Retention</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We retain automatically collected information for a limited period necessary to
                    fulfill the purposes outlined in this Privacy Policy, unless a longer retention
                    period is required or permitted by law. Log data is typically retained for no
                    more than 90 days.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">6. Data Security</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We use administrative, technical, and physical security measures to help protect
                    your information. While we have taken reasonable steps to secure the information
                    you provide to us, please be aware that no method of transmission over the Internet
                    or method of electronic storage is 100% secure. We cannot guarantee the absolute
                    security of your data.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">7. Your Rights</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Depending on your location, you may have certain rights regarding your personal
                    information, including:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>The right to access the personal data we hold about you.</li>
                    <li>The right to request correction of inaccurate data.</li>
                    <li>The right to request deletion of your data.</li>
                    <li>The right to opt out of certain data processing activities.</li>
                    <li>The right to data portability.</li>
                </ul>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    To exercise any of these rights, please contact us using the information provided below.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">8. Children&apos;s Privacy</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    This Site is not intended for individuals under the age of 18. We do not knowingly
                    collect personal information from anyone under 18 years of age. If we learn that we
                    have collected personal data from a minor, we will take steps to delete that
                    information as soon as possible.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">9. Changes to This Privacy Policy</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We may update this Privacy Policy from time to time. We will notify you of any
                    changes by posting the new Privacy Policy on this page and updating the &quot;Last
                    updated&quot; date. You are advised to review this Privacy Policy periodically for
                    any changes.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">10. Contact Us</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    If you have questions or concerns about this Privacy Policy, please contact us at:
                </p>
                <p className="leading-relaxed text-brand-text font-medium">
                    Email:{' '}
                    <a
                        href="mailto:privacy@celeb.skin"
                        className="text-brand-accent hover:underline"
                    >
                        privacy@celeb.skin
                    </a>
                </p>
            </section>
        </div>
    );
}

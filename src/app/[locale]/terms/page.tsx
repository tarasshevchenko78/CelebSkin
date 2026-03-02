import type { Metadata } from 'next';
import type { SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Terms of Service — CelebSkin',
    ru: 'Условия использования — CelebSkin',
    de: 'Nutzungsbedingungen — CelebSkin',
    fr: "Conditions d'utilisation — CelebSkin",
    es: 'Términos de servicio — CelebSkin',
    pt: 'Termos de serviço — CelebSkin',
    it: 'Termini di servizio — CelebSkin',
    pl: 'Regulamin — CelebSkin',
    nl: 'Servicevoorwaarden — CelebSkin',
    tr: 'Hizmet Şartları — CelebSkin',
};

const pageHeadings: Record<string, string> = {
    en: 'Terms of Service',
    ru: 'Условия использования',
    de: 'Nutzungsbedingungen',
    fr: "Conditions d'utilisation",
    es: 'Términos de servicio',
    pt: 'Termos de serviço',
    it: 'Termini di servizio',
    pl: 'Regulamin',
    nl: 'Servicevoorwaarden',
    tr: 'Hizmet Şartları',
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

export default function TermsPage({
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
                <h2 className="mb-4 text-xl font-semibold text-brand-text">1. Acceptance of Terms</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    By accessing and using the CelebSkin website located at celeb.skin (the
                    &quot;Site&quot;), you accept and agree to be bound by these Terms of Service
                    (&quot;Terms&quot;). If you do not agree to these Terms, you must not access or
                    use the Site.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    We reserve the right to update or modify these Terms at any time without prior
                    notice. Your continued use of the Site after any changes constitutes your
                    acceptance of the revised Terms.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">2. Age Requirement</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    This Site contains adult content, including nudity and sexual scenes from
                    commercially released movies and television shows. You must be at least 18
                    years of age (or the age of majority in your jurisdiction, whichever is greater)
                    to access, view, or use the Site.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    By accessing the Site, you represent and warrant that you are at least 18 years
                    old and that accessing adult content is legal in your jurisdiction. If you are
                    under the age of 18, you must leave the Site immediately.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">3. Content Disclaimer</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    All content on this Site consists of scenes from commercially released films,
                    television shows, and other publicly available media productions. CelebSkin does
                    not produce, host, or create original adult content.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    The content displayed on this Site is provided for informational and entertainment
                    purposes only. All depicted individuals are professional actors and actresses who
                    appeared in these roles voluntarily as part of their professional work. All
                    individuals depicted are believed to be 18 years of age or older at the time of
                    filming.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    CelebSkin does not claim ownership of any copyrighted material. All trademarks,
                    service marks, and trade names referenced on this Site are the property of their
                    respective owners.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">4. User Responsibilities</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    By using this Site, you agree to the following:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>
                        You will not use the Site for any unlawful purpose or in violation of any
                        applicable local, state, national, or international law.
                    </li>
                    <li>
                        You will not attempt to gain unauthorized access to any portion of the Site,
                        other accounts, computer systems, or networks connected to the Site.
                    </li>
                    <li>
                        You will not use any automated means, including bots, scrapers, or spiders,
                        to access the Site or collect content without our express written permission.
                    </li>
                    <li>
                        You will not redistribute, republish, or commercially exploit any content
                        from the Site without prior authorization.
                    </li>
                    <li>
                        You will not interfere with or disrupt the Site or servers or networks
                        connected to the Site.
                    </li>
                    <li>
                        You are solely responsible for ensuring that your use of the Site complies
                        with all applicable laws in your jurisdiction.
                    </li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">5. Intellectual Property</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    The Site&apos;s design, layout, graphics, and original text content are the
                    property of CelebSkin or its licensors and are protected by copyright and other
                    intellectual property laws. The media content displayed on the Site belongs to
                    its respective copyright holders.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    If you believe any content on the Site infringes your copyright, please refer to
                    our{' '}
                    <a
                        href={`/${locale}/dmca`}
                        className="text-brand-accent hover:underline"
                    >
                        DMCA Policy
                    </a>{' '}
                    for instructions on submitting a takedown notice.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">6. Disclaimer of Warranties</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    The Site is provided on an &quot;as is&quot; and &quot;as available&quot; basis.
                    CelebSkin makes no representations or warranties of any kind, express or implied,
                    regarding the operation of the Site or the information, content, or materials
                    included on the Site.
                </p>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    To the fullest extent permissible by applicable law, CelebSkin disclaims all
                    warranties, express or implied, including but not limited to implied warranties
                    of merchantability and fitness for a particular purpose.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">7. Limitation of Liability</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    In no event shall CelebSkin, its directors, employees, partners, agents,
                    suppliers, or affiliates be liable for any indirect, incidental, special,
                    consequential, or punitive damages, including without limitation, loss of profits,
                    data, use, goodwill, or other intangible losses, resulting from your access to or
                    use of (or inability to access or use) the Site.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">8. External Links</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    The Site may contain links to third-party websites or services that are not owned
                    or controlled by CelebSkin. We have no control over, and assume no responsibility
                    for, the content, privacy policies, or practices of any third-party websites or
                    services. We strongly advise you to read the terms and privacy policies of any
                    third-party sites you visit.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">9. Governing Law</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    These Terms shall be governed by and construed in accordance with applicable laws,
                    without regard to conflict of law principles. Any disputes arising under or in
                    connection with these Terms shall be subject to the exclusive jurisdiction of the
                    competent courts.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">10. Contact Us</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    If you have any questions about these Terms of Service, please contact us at:
                </p>
                <p className="leading-relaxed text-brand-text font-medium">
                    Email:{' '}
                    <a
                        href="mailto:legal@celeb.skin"
                        className="text-brand-accent hover:underline"
                    >
                        legal@celeb.skin
                    </a>
                </p>
            </section>
        </div>
    );
}

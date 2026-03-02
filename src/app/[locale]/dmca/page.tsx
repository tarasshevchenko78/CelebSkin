import type { Metadata } from 'next';
import type { SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'DMCA Policy — CelebSkin',
    ru: 'Политика DMCA — CelebSkin',
    de: 'DMCA-Richtlinie — CelebSkin',
    fr: 'Politique DMCA — CelebSkin',
    es: 'Política DMCA — CelebSkin',
    pt: 'Política DMCA — CelebSkin',
    it: 'Politica DMCA — CelebSkin',
    pl: 'Polityka DMCA — CelebSkin',
    nl: 'DMCA-beleid — CelebSkin',
    tr: 'DMCA Politikası — CelebSkin',
};

const pageHeadings: Record<string, string> = {
    en: 'DMCA Policy',
    ru: 'Политика DMCA',
    de: 'DMCA-Richtlinie',
    fr: 'Politique DMCA',
    es: 'Política DMCA',
    pt: 'Política DMCA',
    it: 'Politica DMCA',
    pl: 'Polityka DMCA',
    nl: 'DMCA-beleid',
    tr: 'DMCA Politikası',
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

function EnglishContent() {
    return (
        <>
            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Introduction</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    CelebSkin respects the intellectual property rights of others and expects its users
                    to do the same. In accordance with the Digital Millennium Copyright Act of 1998
                    (&quot;DMCA&quot;), we will respond promptly to claims of copyright infringement
                    committed using the CelebSkin service, identified to us in accordance with the
                    procedures outlined below.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Filing a DMCA Notice of Copyright Infringement</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    If you believe that content available on or through the CelebSkin website infringes
                    one or more of your copyrights, please submit a written DMCA Notice of Copyright
                    Infringement to our designated agent using the contact information provided below.
                    Your notice must include the following information:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>
                        A physical or electronic signature of a person authorized to act on behalf
                        of the owner of an exclusive right that is allegedly infringed.
                    </li>
                    <li>
                        Identification of the copyrighted work claimed to have been infringed, or
                        if multiple copyrighted works are covered by a single notification, a
                        representative list of such works.
                    </li>
                    <li>
                        Identification of the material that is claimed to be infringing or to be the
                        subject of infringing activity and that is to be removed, including the specific
                        URL(s) or other identifying information sufficient for us to locate the material.
                    </li>
                    <li>
                        Information reasonably sufficient to permit us to contact you, such as an
                        address, telephone number, and an email address.
                    </li>
                    <li>
                        A statement that you have a good faith belief that use of the material in
                        the manner complained of is not authorized by the copyright owner, its agent,
                        or the law.
                    </li>
                    <li>
                        A statement that the information in the notification is accurate and, under
                        penalty of perjury, that you are authorized to act on behalf of the owner of
                        an exclusive right that is allegedly infringed.
                    </li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Counter-Notification</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    If you believe that material you posted on the site was removed or access to it
                    was disabled by mistake or misidentification, you may file a counter-notification
                    with us. Such counter-notification must be in writing and must include the following
                    information:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>Your physical or electronic signature.</li>
                    <li>
                        An identification of the material that has been removed or to which access has
                        been disabled and the location at which the material appeared before it was
                        removed or access was disabled.
                    </li>
                    <li>
                        A statement, under penalty of perjury, that you have a good faith belief that
                        the material was removed or disabled as a result of mistake or misidentification.
                    </li>
                    <li>
                        Your name, address, and telephone number, and a statement that you consent to
                        the jurisdiction of the federal court for the judicial district in which the
                        address is located, and that you will accept service of process from the person
                        who provided notification of the alleged infringement.
                    </li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Repeat Infringers</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    It is our policy, in appropriate circumstances, to disable and/or terminate the
                    accounts of users who are repeat infringers.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Contact Information</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Please send all DMCA notices and counter-notifications to our designated agent at:
                </p>
                <p className="leading-relaxed text-brand-text font-medium">
                    Email:{' '}
                    <a
                        href="mailto:dmca@celeb.skin"
                        className="text-brand-accent hover:underline"
                    >
                        dmca@celeb.skin
                    </a>
                </p>
                <p className="mt-3 leading-relaxed text-brand-secondary">
                    We aim to process all valid DMCA requests within 48 hours of receipt.
                </p>
            </section>
        </>
    );
}

function RussianContent() {
    return (
        <>
            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Введение</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    CelebSkin уважает права интеллектуальной собственности других лиц и ожидает
                    того же от своих пользователей. В соответствии с Законом об авторском праве в
                    цифровую эпоху 1998 года (&laquo;DMCA&raquo;), мы оперативно реагируем на
                    заявления о нарушении авторских прав, поданные в соответствии с процедурами,
                    описанными ниже.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Подача уведомления DMCA о нарушении авторских прав</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Если вы считаете, что контент, доступный на сайте CelebSkin, нарушает одно или
                    несколько ваших авторских прав, пожалуйста, отправьте письменное уведомление DMCA
                    нашему уполномоченному агенту, используя контактную информацию, указанную ниже.
                    Ваше уведомление должно содержать следующую информацию:
                </p>
                <ul className="mb-3 list-disc space-y-2 pl-6 text-brand-secondary">
                    <li>Физическая или электронная подпись лица, уполномоченного действовать от имени правообладателя.</li>
                    <li>Идентификация произведения, защищённого авторским правом, которое, предположительно, было нарушено.</li>
                    <li>Идентификация материала, который предположительно нарушает авторские права, включая конкретные URL-адреса.</li>
                    <li>Контактная информация для связи с вами: адрес, номер телефона и адрес электронной почты.</li>
                    <li>Заявление о том, что вы добросовестно полагаете, что использование материала не санкционировано правообладателем.</li>
                    <li>Заявление о том, что информация в уведомлении является точной, и, под страхом наказания за лжесвидетельство, что вы уполномочены действовать от имени правообладателя.</li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Встречное уведомление</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Если вы считаете, что материал был удалён по ошибке или неправильной идентификации,
                    вы можете подать встречное уведомление. Такое уведомление должно быть подано в
                    письменной форме и содержать необходимую информацию в соответствии с требованиями DMCA.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-brand-text">Контактная информация</h2>
                <p className="mb-3 leading-relaxed text-brand-secondary">
                    Все уведомления DMCA направляйте нашему уполномоченному агенту по адресу:
                </p>
                <p className="leading-relaxed text-brand-text font-medium">
                    Email:{' '}
                    <a
                        href="mailto:dmca@celeb.skin"
                        className="text-brand-accent hover:underline"
                    >
                        dmca@celeb.skin
                    </a>
                </p>
                <p className="mt-3 leading-relaxed text-brand-secondary">
                    Мы стремимся обработать все действительные запросы DMCA в течение 48 часов с момента получения.
                </p>
            </section>
        </>
    );
}

export default function DMCAPage({
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
            {locale === 'ru' ? <RussianContent /> : <EnglishContent />}
        </div>
    );
}

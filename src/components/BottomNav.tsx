'use client';

import { usePathname } from 'next/navigation';

// ============================================
// Simple inline SVG icons (20x20)
// ============================================

function IconHome({ active }: { active: boolean }) {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
    );
}

function IconSearch({ active }: { active: boolean }) {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
    );
}

function IconVideos({ active }: { active: boolean }) {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
                d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
    );
}

function IconStar({ active }: { active: boolean }) {
    return (
        <svg className="w-5 h-5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
    );
}

function IconFilm({ active }: { active: boolean }) {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
                d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621.504 1.125 1.125 1.125M12 10.875c0 .621-.504 1.125-1.125 1.125m0 0h7.5" />
        </svg>
    );
}

// ============================================
// Nav items config
// ============================================

const navItems = [
    { key: 'home',        href: '',          label: 'Home',   Icon: IconHome },
    { key: 'search',      href: '/search',   label: 'Search', Icon: IconSearch },
    { key: 'videos',      href: '/video',    label: 'Videos', Icon: IconVideos },
    { key: 'celebrities', href: '/celebrity', label: 'Stars',  Icon: IconStar },
    { key: 'movies',      href: '/movie',    label: 'Movies', Icon: IconFilm },
];

function isActive(pathname: string, locale: string, href: string): boolean {
    if (href === '') {
        return pathname === `/${locale}` || pathname === `/${locale}/`;
    }
    return pathname.startsWith(`/${locale}${href}`);
}

// ============================================
// Component
// ============================================

export default function BottomNav() {
    const pathname = usePathname();
    const locale = pathname.split('/')[1] || 'en';

    return (
        <nav
            className="fixed bottom-0 inset-x-0 z-50 block md:hidden bg-[#08060a] border-t border-gray-800"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
            <div className="flex items-center justify-around h-14">
                {navItems.map((item) => {
                    const active = isActive(pathname, locale, item.href);
                    return (
                        <a
                            key={item.key}
                            href={`/${locale}${item.href}`}
                            className={`flex flex-col items-center justify-center min-w-[48px] h-full transition-colors ${
                                active ? 'text-red-500' : 'text-gray-500'
                            }`}
                        >
                            <item.Icon active={active} />
                            <span className="text-[10px] mt-0.5 leading-tight">{item.label}</span>
                        </a>
                    );
                })}
            </div>
        </nav>
    );
}

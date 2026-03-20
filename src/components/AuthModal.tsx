'use client';

import { useState, useEffect, useRef } from 'react';

interface AuthUser { id: string; username: string; }

interface Props {
    onClose: () => void;
    onSuccess: (user: AuthUser) => void;
}

export default function AuthModal({ onClose, onSuccess }: Props) {
    const [tab, setTab] = useState<'login' | 'register'>('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (tab === 'register' && password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        try {
            const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Something went wrong');
            } else {
                onSuccess(data.user);
            }
        } catch {
            setError('Network error, please try again');
        } finally {
            setLoading(false);
        }
    };

    const inputCls = 'w-full bg-[#1a1815] border border-brand-accent/30 rounded-lg py-2.5 px-4 text-[15px] text-brand-gold-light placeholder-brand-secondary/50 focus:outline-none focus:ring-1 focus:ring-brand-accent/80 focus:border-brand-accent/80 transition-all';

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
        >
            <div className="w-full max-w-sm rounded-2xl border border-brand-accent/30 bg-[#0e0d0b] shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-brand-accent/20">
                    {(['login', 'register'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => { setTab(t); setError(''); }}
                            className={`flex-1 py-4 text-[15px] font-semibold transition-colors ${tab === t
                                ? 'text-brand-gold-light border-b-2 border-brand-accent'
                                : 'text-brand-secondary hover:text-[#c0bba8]'
                            }`}
                        >
                            {t === 'login' ? 'Sign In' : 'Register'}
                        </button>
                    ))}
                    <button
                        onClick={onClose}
                        className="px-4 text-brand-secondary hover:text-white transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
                    <div>
                        <label className="block text-xs text-brand-secondary mb-1.5">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder={tab === 'register' ? '3–20 chars: a-z, 0-9, _' : 'Your username'}
                            className={inputCls}
                            autoComplete="username"
                            autoFocus
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-brand-secondary mb-1.5">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder={tab === 'register' ? 'Min 6 characters' : 'Your password'}
                            className={inputCls}
                            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                            required
                        />
                    </div>

                    {tab === 'register' && (
                        <div>
                            <label className="block text-xs text-brand-secondary mb-1.5">Confirm Password</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Repeat password"
                                className={inputCls}
                                autoComplete="new-password"
                                required
                            />
                        </div>
                    )}

                    {error && (
                        <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 rounded-lg bg-brand-accent hover:bg-brand-gold-dark text-black font-semibold text-[15px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                    >
                        {loading ? '...' : tab === 'login' ? 'Sign In' : 'Create Account'}
                    </button>

                    <p className="text-center text-xs text-brand-secondary">
                        {tab === 'login' ? (
                            <>No account?{' '}
                                <button type="button" onClick={() => setTab('register')} className="text-brand-accent hover:underline">Register</button>
                            </>
                        ) : (
                            <>Already have an account?{' '}
                                <button type="button" onClick={() => setTab('login')} className="text-brand-accent hover:underline">Sign In</button>
                            </>
                        )}
                    </p>
                </form>
            </div>
        </div>
    );
}

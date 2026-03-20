'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function ProfileClient() {
    const { logout } = useAuth();
    const [showPwForm, setShowPwForm] = useState(false);
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [pwError, setPwError] = useState('');
    const [pwOk, setPwOk] = useState(false);
    const [pwLoading, setPwLoading] = useState(false);

    const handleChangePw = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwError('');
        setPwOk(false);
        if (newPw.length < 6) { setPwError('Password must be at least 6 characters'); return; }
        setPwLoading(true);
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
            });
            const data = await res.json();
            if (!res.ok) setPwError(data.error || 'Error');
            else { setPwOk(true); setCurrentPw(''); setNewPw(''); setShowPwForm(false); }
        } catch { setPwError('Network error'); }
        setPwLoading(false);
    };

    const inputCls = 'w-full bg-[#1a1815] border border-brand-accent/30 rounded-lg py-2 px-3 text-sm text-brand-gold-light placeholder-brand-secondary/50 focus:outline-none focus:ring-1 focus:ring-brand-accent/60';

    return (
        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setShowPwForm(!showPwForm)}
                    className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                >
                    Change Password
                </button>
                <button
                    onClick={logout}
                    className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-sm text-red-400 hover:bg-red-900/50 transition-colors"
                >
                    Sign Out
                </button>
            </div>

            {pwOk && (
                <p className="text-green-400 text-xs">Password changed successfully</p>
            )}

            {showPwForm && (
                <form onSubmit={handleChangePw} className="flex flex-col gap-2 w-64 mt-1">
                    <input
                        type="password"
                        value={currentPw}
                        onChange={e => setCurrentPw(e.target.value)}
                        placeholder="Current password"
                        className={inputCls}
                        required
                    />
                    <input
                        type="password"
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        placeholder="New password (min 6)"
                        className={inputCls}
                        required
                    />
                    {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
                    <button
                        type="submit"
                        disabled={pwLoading}
                        className="py-2 rounded-lg bg-brand-accent hover:bg-brand-gold-dark text-black text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                        {pwLoading ? '...' : 'Update Password'}
                    </button>
                </form>
            )}
        </div>
    );
}

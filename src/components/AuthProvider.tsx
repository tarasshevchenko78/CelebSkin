'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import AuthModal from './AuthModal';

interface AuthUser {
    id: string;
    username: string;
}

interface PendingFavorite {
    itemType: 'video' | 'celebrity';
    itemId: string;
}

interface AuthContextValue {
    user: AuthUser | null;
    loading: boolean;
    openAuthModal: (returnTo?: string) => void;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    setPendingFavorite: (pf: PendingFavorite) => void;
}

const AuthContext = createContext<AuthContextValue>({
    user: null,
    loading: true,
    openAuthModal: () => {},
    logout: async () => {},
    refreshUser: async () => {},
    setPendingFavorite: () => {},
});

export function useAuth() {
    return useContext(AuthContext);
}

export default function AuthProvider({ children, locale }: { children: ReactNode; locale: string }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalReturnTo, setModalReturnTo] = useState<string | undefined>();
    const pendingFavoriteRef = useRef<PendingFavorite | null>(null);

    const refreshUser = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            setUser(data.user ?? null);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    const openAuthModal = useCallback((returnTo?: string) => {
        setModalReturnTo(returnTo);
        setModalOpen(true);
    }, []);

    const setPendingFavorite = useCallback((pf: PendingFavorite) => {
        pendingFavoriteRef.current = pf;
    }, []);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setUser(null);
        window.location.href = `/${locale}`;
    }, [locale]);

    const handleAuthSuccess = useCallback((authUser: AuthUser) => {
        setUser(authUser);
        setModalOpen(false);

        // Execute pending favorite if any
        const pf = pendingFavoriteRef.current;
        if (pf) {
            pendingFavoriteRef.current = null;
            fetch('/api/user/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_type: pf.itemType, item_id: pf.itemId }),
            }).catch(() => {});
        }

        if (modalReturnTo) window.location.href = modalReturnTo;
    }, [modalReturnTo]);

    return (
        <AuthContext.Provider value={{ user, loading, openAuthModal, logout, refreshUser, setPendingFavorite }}>
            {children}
            {modalOpen && (
                <AuthModal
                    onClose={() => setModalOpen(false)}
                    onSuccess={handleAuthSuccess}
                />
            )}
        </AuthContext.Provider>
    );
}

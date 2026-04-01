'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
    return (
        <html>
            <body style={{ background: '#0d0c0a', color: '#fff', fontFamily: 'sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Something went wrong</h1>
                    <button onClick={() => reset()} style={{ padding: '8px 24px', background: '#c8a84e', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem' }}>
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}

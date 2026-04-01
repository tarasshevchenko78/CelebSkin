export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-white">
            <h1 className="text-4xl font-bold mb-4">404</h1>
            <p className="text-brand-secondary">Page not found</p>
            <a href="/" className="mt-6 text-brand-accent hover:underline">Go home</a>
        </div>
    );
}

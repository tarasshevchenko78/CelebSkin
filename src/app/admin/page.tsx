export default function AdminDashboard() {
    return (
        <div>
            <h1 className="mb-8 text-3xl font-bold text-white">Dashboard</h1>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Total Videos</p>
                    <p className="mt-2 text-3xl font-bold text-white">0</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Published</p>
                    <p className="mt-2 text-3xl font-bold text-green-400">0</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Celebrities</p>
                    <p className="mt-2 text-3xl font-bold text-purple-400">0</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Total Views</p>
                    <p className="mt-2 text-3xl font-bold text-blue-400">0</p>
                </div>
            </div>
            <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                <h2 className="mb-4 text-xl font-semibold text-white">Pipeline Status</h2>
                <p className="text-gray-500">No active pipeline tasks</p>
            </div>
        </div>
    );
}

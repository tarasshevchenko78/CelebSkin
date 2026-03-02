import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);
const CONTABO_HOST = 'root@161.97.142.117';
const SSH_KEY = '/root/.ssh/id_ed25519';
const SSH_OPTS = `-o ConnectTimeout=5 -o StrictHostKeyChecking=no -i ${SSH_KEY}`;

// GET — tail the pipeline log file from Contabo
export async function GET(request: NextRequest) {
    const lines = parseInt(request.nextUrl.searchParams.get('lines') || '100');

    try {
        const { stdout } = await execAsync(
            `ssh ${SSH_OPTS} ${CONTABO_HOST} "tail -n ${lines} /opt/celebskin/scripts/logs/pipeline.log 2>/dev/null; echo '---'; ps aux | grep -E 'node.*(scrape|process-with-ai|enrich|watermark|generate-thumb|upload-to-cdn|publish-to-site|run-pipeline)' | grep -v grep | awk '{print \\$NF}' 2>/dev/null || echo 'none'"`,
            { timeout: 15000 }
        );

        const parts = stdout.split('---');
        const logContent = (parts[0] || '').trim();
        const processes = (parts[1] || '').trim().split('\n').filter(p => p && p !== 'none');

        return NextResponse.json({
            logs: logContent || 'No logs yet',
            runningProcesses: processes,
        });
    } catch (error) {
        return NextResponse.json({
            logs: `Error reading logs: ${error instanceof Error ? error.message : 'Connection failed'}`,
            runningProcesses: [],
        });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

const CONTABO_HOST = 'root@161.97.142.117';
const SSH_KEY      = '/root/.ssh/id_ed25519';
const SSH_OPTS     = `-o ConnectTimeout=10 -o StrictHostKeyChecking=no -i ${SSH_KEY}`;
const SCRIPTS_DIR  = '/opt/celebskin/scripts';
const TIMEOUT_MS   = 30 * 60 * 1000;

type Step = 'parse' | 'translate' | 'match' | 'map-tags' | 'download' | 'test-connection' | 'list-categories' | 'run-all';

interface RequestBody {
    step: Step;
    stream?: boolean;
    options?: {
        pages?: number;
        url?: string;
        celebUrl?: string;
        collectionUrl?: string;
        limit?: number;
        source?: string;
        parsePages?: number;
        translateLimit?: number;
        matchLimit?: number;
        downloadLimit?: number;
        autoImport?: boolean;
        autoDownload?: boolean;
        autoAi?: boolean;
        autoPublish?: boolean;
    };
}

interface ExecError extends Error {
    code?: number;
    killed?: boolean;
    signal?: string;
    stdout?: string;
    stderr?: string;
}

function buildCommand(step: Step, options: RequestBody['options'] = {}): string {
    switch (step) {
        case 'parse': {
            if (options.url)           return `node xcadr/parse-xcadr.js --url ${JSON.stringify(options.url)}`;
            if (options.celebUrl)      return `node xcadr/parse-xcadr.js --celeb ${JSON.stringify(options.celebUrl)}`;
            if (options.collectionUrl) return `node xcadr/parse-xcadr.js --collection ${JSON.stringify(options.collectionUrl)}`;
            return `node xcadr/parse-xcadr.js --pages ${options.pages ?? 3}`;
        }
        case 'translate':
            return `node xcadr/translate-xcadr.js --limit ${options.limit ?? 50}`;
        case 'match':
            return `node xcadr/match-xcadr.js --limit ${options.limit ?? 50}`;
        case 'map-tags':
            return `node xcadr/map-tags.js`;
        case 'download': {
            let cmd = `node xcadr/download-and-process.js --limit ${options.limit ?? 5}`;
            if (options.source) cmd += ` --source ${options.source}`;
            return cmd;
        }
        case 'run-all': {
            const args: string[] = [];
            args.push(`--parse-pages ${options.parsePages ?? 3}`);
            args.push(`--translate-limit ${options.translateLimit ?? 100}`);
            args.push(`--match-limit ${options.matchLimit ?? 100}`);
            if (options.autoImport)   args.push('--auto-import');
            if (options.autoDownload) args.push('--auto-download');
            if (options.autoAi)       args.push('--auto-ai');
            if (options.autoPublish)  args.push('--auto-publish');
            if (options.downloadLimit) args.push(`--download-limit ${options.downloadLimit}`);
            return `node xcadr/auto-import.js ${args.join(' ')}`;
        }
        default:
            throw new Error(`Unknown step: ${step}`);
    }
}

async function runOnContabo(remoteCmd: string): Promise<{ stdout: string; stderr: string }> {
    const sshCmd = `ssh ${SSH_OPTS} ${CONTABO_HOST} "cd ${SCRIPTS_DIR} && ${remoteCmd}"`;
    const { stdout, stderr } = await execAsync(sshCmd, {
        timeout: TIMEOUT_MS,
        env: { ...process.env, HOME: '/root' },
    });
    return { stdout, stderr };
}

function streamSshCommand(remoteCmd: string): { stream: ReadableStream; abort: () => void } {
    let aborted = false;
    let sshProcess: ReturnType<typeof spawn> | null = null;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            sshProcess = spawn('ssh', [
                '-o', 'ConnectTimeout=10',
                '-o', 'StrictHostKeyChecking=no',
                '-i', SSH_KEY,
                CONTABO_HOST,
                `cd ${SCRIPTS_DIR} && ${remoteCmd}`,
            ], {
                env: { ...process.env, HOME: '/root' },
            });

            const timeout = setTimeout(() => {
                if (sshProcess) {
                    sshProcess.kill('SIGTERM');
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Timeout exceeded (30 min)' })}\n\n`));
                    controller.close();
                }
            }, TIMEOUT_MS);

            sshProcess.stdout?.on('data', (chunk: Buffer) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    if (line.startsWith('XCADR_PROGRESS:')) {
                        try {
                            const progress = JSON.parse(line.substring('XCADR_PROGRESS:'.length));
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`));
                        } catch {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', text: line })}\n\n`));
                        }
                    } else {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', text: line })}\n\n`));
                    }
                }
            });

            sshProcess.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString().trim();
                if (text) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`));
                }
            });

            sshProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (!aborted) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`));
                    controller.close();
                }
            });

            sshProcess.on('error', (err) => {
                clearTimeout(timeout);
                if (!aborted) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`));
                    controller.close();
                }
            });
        },
        cancel() {
            aborted = true;
            if (sshProcess) sshProcess.kill('SIGTERM');
        },
    });

    return {
        stream,
        abort: () => {
            aborted = true;
            if (sshProcess) sshProcess.kill('SIGTERM');
        },
    };
}

// POST /api/admin/xcadr/pipeline
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { step, stream: useStream = false, options = {} } = body;

    const validSteps: Step[] = ['parse', 'translate', 'match', 'map-tags', 'download', 'test-connection', 'list-categories', 'run-all'];
    if (!validSteps.includes(step)) {
        return NextResponse.json({ success: false, error: `Invalid step: ${step}` }, { status: 400 });
    }

    // Special: test-connection
    if (step === 'test-connection') {
        const startedAt = Date.now();
        try {
            const { stdout } = await runOnContabo('echo "SSH_OK" && node -e "console.log(\'NODE_OK\')" && node -e "const {query}=require(\'./lib/db.js\');query(\'SELECT 1 as ok\').then(r=>console.log(\'DB_OK:\',r.rows[0].ok)).catch(e=>console.error(\'DB_FAIL:\',e.message)).finally(()=>process.exit())"');
            const duration = Date.now() - startedAt;
            const sshOk = stdout.includes('SSH_OK');
            const nodeOk = stdout.includes('NODE_OK');
            const dbOk = stdout.includes('DB_OK');
            return NextResponse.json({
                success: sshOk && nodeOk,
                step: 'test-connection',
                checks: { ssh: sshOk, node: nodeOk, db: dbOk },
                output: stdout.slice(-2000),
                duration,
            });
        } catch (err) {
            const execErr = err as ExecError;
            return NextResponse.json({
                success: false,
                step: 'test-connection',
                checks: { ssh: false, node: false, db: false },
                error: execErr.message?.slice(-500) ?? 'SSH connection failed',
                output: (execErr.stdout ?? '').slice(-2000),
                duration: Date.now() - startedAt,
            }, { status: 500 });
        }
    }

    // Special: list-categories
    if (step === 'list-categories') {
        const startedAt = Date.now();
        try {
            const { stdout } = await runOnContabo('node xcadr/list-categories.js');
            const duration = Date.now() - startedAt;
            let categories = [];
            try {
                categories = JSON.parse(stdout.trim());
            } catch {
                return NextResponse.json({
                    success: false,
                    step: 'list-categories',
                    error: 'Failed to parse categories output',
                    output: stdout.slice(-2000),
                    duration,
                }, { status: 500 });
            }
            return NextResponse.json({
                success: true,
                step: 'list-categories',
                categories,
                duration,
            });
        } catch (err) {
            const execErr = err as ExecError;
            return NextResponse.json({
                success: false,
                step: 'list-categories',
                error: execErr.message?.slice(-500) ?? 'Failed to fetch categories',
                output: (execErr.stdout ?? '').slice(-2000),
                duration: Date.now() - startedAt,
            }, { status: 500 });
        }
    }

    let remoteCmd: string;
    try {
        remoteCmd = buildCommand(step, options);
    } catch (err) {
        return NextResponse.json({ success: false, error: String(err) }, { status: 400 });
    }

    logger.info('xcadr pipeline step started on Contabo', { step, cmd: remoteCmd, stream: useStream });

    // Streaming mode — SSE
    if (useStream) {
        const { stream } = streamSshCommand(remoteCmd);
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    }

    // Non-streaming mode (backwards compatible)
    const startedAt = Date.now();
    try {
        const { stdout, stderr } = await runOnContabo(remoteCmd);
        const duration = Date.now() - startedAt;
        const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(-4000);
        logger.info('xcadr pipeline step completed', { step, duration });
        return NextResponse.json({ success: true, step, output, duration });
    } catch (err) {
        const duration = Date.now() - startedAt;
        const execErr = err as ExecError;
        const isTimeout = execErr.killed === true || (execErr.signal === 'SIGTERM' && duration >= TIMEOUT_MS - 5000);
        const errorMessage = isTimeout
            ? `Превышен лимит времени (${Math.round(TIMEOUT_MS / 60000)} мин)`
            : execErr.message?.slice(-500) ?? 'Неизвестная ошибка';

        const stdout = execErr.stdout ?? '';
        const stderr = execErr.stderr ?? '';
        const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(-4000);
        const exitCode = typeof execErr.code === 'number' ? execErr.code : null;

        logger.error('xcadr pipeline step failed', { step, error: errorMessage, exitCode, duration });
        return NextResponse.json(
            { success: false, step, error: errorMessage, output: output || null, stderr: stderr.slice(-2000) || null, exitCode, duration },
            { status: 500 }
        );
    }
}

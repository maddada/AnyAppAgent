// Child processes without a shell (so arguments are never re-parsed), with line streaming,
// a capped in-memory copy of the output, and killing of the whole process tree on Windows.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_KEEP = 4000; // lines kept in memory per command

export class CommandError extends Error {
  constructor(message, { code, lines, cancelled } = {}) {
    super(message);
    this.code = code;
    this.lines = lines ?? [];
    this.cancelled = !!cancelled;
  }
}

/** Resolves the npm CLI script next to the running node, so npm runs without a shell. */
export function npmCommand() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find((p) => fs.existsSync(p));
  if (cli) return { cmd: process.execPath, pre: [cli] };
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', pre: [], shell: process.platform === 'win32' };
}

export function killTree(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Runs a command. Resolves with { lines } on exit code 0, rejects with CommandError otherwise.
 * opts: cwd, env, onLine(line, stream), logStream (fs.WriteStream), signal ({ cancelled, child }).
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        windowsHide: true,
        shell: opts.shell ?? false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(new CommandError(`Could not start ${cmd}: ${e.message}`));
      return;
    }
    if (opts.handle) opts.handle.child = child;
    const pending = { stdout: '', stderr: '' };
    const emit = (line, stream) => {
      const clean = line.replace(ANSI, '').replace(/\r$/, '');
      lines.push(clean);
      if (lines.length > MAX_KEEP) lines.splice(0, lines.length - MAX_KEEP);
      opts.logStream?.write(clean + '\n');
      try {
        opts.onLine?.(clean, stream);
      } catch {
        /* a broken log callback must not break the build */
      }
    };
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (chunk) => {
        const text = pending[stream] + chunk;
        const parts = text.split('\n');
        pending[stream] = parts.pop();
        for (const p of parts) emit(p, stream);
      });
    }
    child.on('error', (e) => reject(new CommandError(`Could not start ${cmd}: ${e.message}`, { lines })));
    child.on('close', (code) => {
      for (const stream of ['stdout', 'stderr']) if (pending[stream]) emit(pending[stream], stream);
      if (code === 0) resolve({ lines });
      else
        reject(
          new CommandError(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} exited with code ${code}`, {
            code,
            lines,
            cancelled: opts.handle?.cancelled,
          }),
        );
    });
  });
}

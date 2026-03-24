// CLI bridge — shell out to `bun run src/cm.ts` for mutations.
// Reuses all existing validation, locking, and atomicWrite safety.

import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import type { ReflectionResult } from './types'

// Path to the CLI entry point (relative to the repo root)
// In dev: __dirname is electron/out/main/, so ../../.. is the repo root
// In production: this would need adjustment if bundled differently
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const CM_PATH = path.join(REPO_ROOT, 'src', 'cm.ts')

// Bun may not be in Electron's inherited PATH — add common locations
function getBunEnhancedPath(): string {
  const bunPaths = [
    path.join(os.homedir(), '.bun', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ]
  const currentPath = process.env.PATH || ''
  const additionalPaths = bunPaths.filter(p => !currentPath.includes(p))
  return [...additionalPaths, currentPath].join(path.delimiter)
}

interface CliResult {
  data: any
  stderr: string
}

/** Run a CLI command and return parsed JSON output + stderr. */
async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const enhancedEnv = { ...process.env, PATH: getBunEnhancedPath() }

    console.log('[cli-bridge] Running:', 'bun', 'run', CM_PATH, ...args, '--json')
    console.log('[cli-bridge] CWD:', REPO_ROOT)

    const proc = spawn('bun', ['run', CM_PATH, ...args, '--json'], {
      cwd: REPO_ROOT,
      env: enhancedEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      console.log(`[cli-bridge] Process exited with code ${code}`)
      if (stderr) console.log('[cli-bridge] stderr:', stderr.slice(0, 500))
      if (code !== 0) {
        reject(new Error(`CLI exited with code ${code}: ${stderr || stdout}`))
        return
      }

      try {
        // Parse the last JSON object from stdout (CLI may emit progress before final result)
        const lines = stdout.trim().split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i])
            resolve({ data: parsed, stderr })
            return
          } catch { /* not JSON, try previous line */ }
        }
        resolve({ data: { raw: stdout }, stderr })
      } catch {
        resolve({ data: { raw: stdout }, stderr })
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn CLI: ${err.message}`))
    })
  })
}

export async function cliAddTopic(slug: string, name: string, description: string): Promise<void> {
  await runCli(['topic', 'add', slug, '--name', name, '--description', description])
}

export async function cliRemoveTopic(slug: string, force = false): Promise<void> {
  const args = ['topic', 'remove', slug]
  if (force) args.push('--force')
  await runCli(args)
}

export async function cliRunReflection(): Promise<ReflectionResult> {
  try {
    const { data: result, stderr } = await runCli(['reflect', '--full'])
    console.log('[cli-bridge] Reflection result:', JSON.stringify(result).slice(0, 200))
    if (stderr) console.log('[cli-bridge] Reflection stderr:', stderr.slice(0, 500))

    // Extract error messages from stderr (the CLI logs errors there even on exit code 0)
    const stderrErrors = stderr
      .split('\n')
      .filter((line: string) => line.includes('ERROR:'))
      .map((line: string) => line.replace(/.*ERROR:\s*/, '').trim())
      .filter(Boolean)

    const sessionsProcessed = result?.data?.sessionsProcessed || 0
    const deltasGenerated = result?.data?.deltasGenerated || 0

    return {
      success: true,
      message: stderrErrors.length > 0
        ? stderrErrors[0]
        : sessionsProcessed > 0
          ? `Reflected on ${sessionsProcessed} sessions`
          : 'No sessions to process',
      sessionsProcessed,
      deltasGenerated,
      errors: stderrErrors
    }
  } catch (err: any) {
    console.error('[cli-bridge] Reflection failed:', err.message)
    return {
      success: false,
      message: err.message || 'Reflection failed'
    }
  }
}

export async function cliApproveReviewItem(id: string): Promise<void> {
  // Review queue operations go through direct file manipulation
  // since there's no CLI command for this yet — use the file-reader saveFile
  // This is a placeholder that will be wired to review-queue.ts operations
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliDismissReviewItem(id: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliFlagContent(targetPath: string, section?: string, reason?: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliStarItem(itemPath: string, section?: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliUnstarItem(itemPath: string, section?: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliCreateUserNote(title: string, content: string, topics?: string[]): Promise<string> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliSaveUserNote(id: string, title: string, content: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

export async function cliDeleteUserNote(id: string): Promise<void> {
  throw new Error('Not implemented via CLI — use direct file ops')
}

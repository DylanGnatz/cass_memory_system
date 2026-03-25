// CLI bridge — shell out to `bun run src/cm.ts` for mutations.
// Reuses all existing validation, locking, and atomicWrite safety.

import { execFile } from 'node:child_process'
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
  const enhancedEnv = { ...process.env, PATH: getBunEnhancedPath() }

  console.log('[cli-bridge] Running:', 'bun', 'run', CM_PATH, ...args, '--json')

  return new Promise((resolve, reject) => {
    execFile('bun', ['run', CM_PATH, ...args, '--json'], {
      cwd: REPO_ROOT,
      env: enhancedEnv,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large JSON output
    }, (error, stdout, stderr) => {
      if (stderr) console.log('[cli-bridge] stderr:', stderr.slice(0, 500))

      if (error && error.code !== 0) {
        reject(new Error(`CLI failed: ${stderr || error.message}`))
        return
      }

      const trimmed = (stdout || '').trim()
      console.log('[cli-bridge] stdout length:', trimmed.length)

      // Try parsing the full output as JSON
      try {
        const parsed = JSON.parse(trimmed)
        resolve({ data: parsed, stderr: stderr || '' })
        return
      } catch { /* not pure JSON */ }

      // Extract JSON object from first { to last }
      const firstBrace = trimmed.indexOf('{')
      const lastBrace = trimmed.lastIndexOf('}')
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
          resolve({ data: parsed, stderr: stderr || '' })
          return
        } catch { /* extraction failed */ }
      }

      console.log('[cli-bridge] Could not parse JSON, first 200 chars:', trimmed.slice(0, 200))
      resolve({ data: { raw: trimmed }, stderr: stderr || '' })
    })
  })
}

export async function cliGenerateSessionNote(sessionId: string, transcriptPath: string): Promise<{ success: boolean; message: string }> {
  try {
    await runCli(['snapshot', '--session', transcriptPath])
    return { success: true, message: `Session note generated for ${sessionId}` }
  } catch (err: any) {
    return { success: false, message: err.message || 'Failed to generate session note' }
  }
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

export async function cliGenerateTopicKnowledge(slug: string): Promise<{ success: boolean; sectionsGenerated?: number; message: string }> {
  try {
    const { data: result } = await runCli(['topic', 'generate', slug])
    return {
      success: true,
      sectionsGenerated: result?.sectionsGenerated || 0,
      message: `Generated ${result?.sectionsGenerated || 0} sections`
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Generation failed'
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

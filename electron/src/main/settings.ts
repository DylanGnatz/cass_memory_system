// Settings management — read/write API key and other settings to ~/.memory-system/config.json
// The API key is stored in config.json (same file the CLI reads) so both the
// Electron app and CLI reflection pipeline use the same key.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { memoryDir } from './file-reader'

function configPath(): string {
  return path.join(memoryDir(), 'config.json')
}

async function loadConfig(): Promise<Record<string, any>> {
  try {
    const raw = await fsp.readFile(configPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveConfig(config: Record<string, any>): Promise<void> {
  const filePath = configPath()
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
  await fsp.rename(tmp, filePath)
}

/** Get the API key from config.json or environment. */
export async function getApiKey(): Promise<string | null> {
  // Environment takes precedence
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY
  }
  // Fall back to config.json
  const config = await loadConfig()
  return config.apiKey || null
}

/** Save the API key to config.json and set it on process.env. */
export async function setApiKey(key: string): Promise<void> {
  const config = await loadConfig()
  config.apiKey = key
  await saveConfig(config)
  // Also set on process.env so the Claude dialog and CLI bridge pick it up immediately
  process.env.ANTHROPIC_API_KEY = key
}

/** Check if an API key is available from any source. */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey()
  return !!key && key.trim().length > 0
}

/** Get budget limits from config.json. */
export async function getBudget(): Promise<{ dailyLimit: number; monthlyLimit: number }> {
  const config = await loadConfig()
  return {
    dailyLimit: config.budget?.dailyLimit ?? 0.50,
    monthlyLimit: config.budget?.monthlyLimit ?? 10.00
  }
}

/** Set budget limits in config.json. */
export async function setBudget(dailyLimit: number, monthlyLimit: number): Promise<void> {
  const config = await loadConfig()
  if (!config.budget) config.budget = {}
  config.budget.dailyLimit = dailyLimit
  config.budget.monthlyLimit = monthlyLimit
  await saveConfig(config)
}

// Direct file operations for mutations that don't need the full CLI pipeline.
// Review queue, starred items, and user notes are simple JSON/markdown operations.

import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { indexNote } from './search'

function memoryDir(): string {
  return path.join(os.homedir(), '.memory-system')
}

// ============================================================================
// REVIEW QUEUE
// ============================================================================

async function loadQueueFile(): Promise<any> {
  const filePath = path.join(memoryDir(), 'review-queue.json')
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'))
  } catch {
    return { schema_version: 1, items: [] }
  }
}

async function saveQueueFile(data: any): Promise<void> {
  const filePath = path.join(memoryDir(), 'review-queue.json')
  const tmp = filePath + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fsp.rename(tmp, filePath)
}

/** Returns the topic slug if a topic suggestion was approved (for triggering generation). */
export async function approveReviewItem(id: string): Promise<{ topicSlug?: string }> {
  const queue = await loadQueueFile()
  const item = queue.items?.find((i: any) => i.id === id)
  if (!item) throw new Error(`Review item not found: ${id}`)
  item.status = 'approved'
  await saveQueueFile(queue)

  // If this is a topic suggestion, create the topic in topics.json + directory
  if (item.type === 'topic_suggestion' && item.data) {
    const topicsPath = path.join(memoryDir(), 'topics.json')
    let topicsData: any = { topics: [] }
    try {
      topicsData = JSON.parse(await fsp.readFile(topicsPath, 'utf-8'))
    } catch { /* no file yet */ }

    const exists = topicsData.topics.some((t: any) => t.slug === item.target_topic)
    if (!exists) {
      topicsData.topics.push({
        slug: item.target_topic,
        name: item.data.name,
        description: item.data.description,
        source: 'system',
        created: new Date().toISOString().split('T')[0],
        subpages: []
      })
      const tmp = topicsPath + '.tmp'
      await fsp.writeFile(tmp, JSON.stringify(topicsData, null, 2), 'utf-8')
      await fsp.rename(tmp, topicsPath)

      // Create topic directory with _index.md
      const topicDir = path.join(memoryDir(), 'knowledge', item.target_topic)
      await fsp.mkdir(topicDir, { recursive: true })
      const indexContent = `---\ntopic: ${item.data.name}\ndescription: "${item.data.description}"\nsource: system\ncreated: ${new Date().toISOString().split('T')[0]}\nlast_updated: ${new Date().toISOString().split('T')[0]}\n---\n`
      await fsp.writeFile(path.join(topicDir, '_index.md'), indexContent, 'utf-8')
    }
    return { topicSlug: item.target_topic }
  }
  return {}
}

export async function dismissReviewItem(id: string): Promise<void> {
  const queue = await loadQueueFile()
  const item = queue.items?.find((i: any) => i.id === id)
  if (!item) throw new Error(`Review item not found: ${id}`)
  item.status = 'dismissed'
  await saveQueueFile(queue)

  // If dismissing a topic suggestion, clean up the orphaned knowledge page
  if (item.type === 'topic_suggestion' && item.target_topic) {
    const pagePath = path.join(memoryDir(), 'knowledge', `${item.target_topic}.md`)
    try {
      await fsp.unlink(pagePath)
    } catch { /* file may not exist — that's fine */ }
  }
}

// ============================================================================
// TOPIC DELETION
// ============================================================================

export async function deleteTopic(slug: string): Promise<void> {
  // 1. Remove from topics.json
  const topicsPath = path.join(memoryDir(), 'topics.json')
  let topicsData: any = { topics: [] }
  try {
    topicsData = JSON.parse(await fsp.readFile(topicsPath, 'utf-8'))
  } catch { /* no file */ }

  topicsData.topics = topicsData.topics.filter((t: any) => t.slug !== slug)
  const tmp = topicsPath + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(topicsData, null, 2), 'utf-8')
  await fsp.rename(tmp, topicsPath)

  // 2. Delete knowledge directory
  const topicDir = path.join(memoryDir(), 'knowledge', slug)
  try {
    await fsp.rm(topicDir, { recursive: true, force: true })
  } catch { /* dir may not exist */ }

  // 3. Delete legacy flat file if it exists
  const legacyFile = path.join(memoryDir(), 'knowledge', `${slug}.md`)
  try {
    await fsp.unlink(legacyFile)
  } catch { /* file may not exist */ }
}

export async function flagContent(targetPath: string, section?: string, reason?: string): Promise<void> {
  const queue = await loadQueueFile()
  const id = `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  queue.items.push({
    id,
    type: 'user_flag',
    status: 'pending',
    created: new Date().toISOString(),
    target_topic: '',
    target_path: targetPath,
    target_section: section,
    reason
  })
  await saveQueueFile(queue)
}

// ============================================================================
// STARRED ITEMS
// ============================================================================

async function loadStarredFile(): Promise<any> {
  const filePath = path.join(memoryDir(), 'starred.json')
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'))
  } catch {
    return { items: [] }
  }
}

async function saveStarredFile(data: any): Promise<void> {
  const filePath = path.join(memoryDir(), 'starred.json')
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fsp.rename(tmp, filePath)
}

export async function starItem(itemPath: string, section?: string): Promise<void> {
  const data = await loadStarredFile()
  const key = section ? `${itemPath}::${section}` : itemPath
  const exists = data.items.some((i: any) => {
    const k = i.section ? `${i.path}::${i.section}` : i.path
    return k === key
  })
  if (exists) return

  data.items.push({
    path: itemPath,
    section,
    starred_at: new Date().toISOString()
  })
  await saveStarredFile(data)
}

export async function unstarItem(itemPath: string, section?: string): Promise<void> {
  const data = await loadStarredFile()
  const key = section ? `${itemPath}::${section}` : itemPath
  data.items = data.items.filter((i: any) => {
    const k = i.section ? `${i.path}::${i.section}` : i.path
    return k !== key
  })
  await saveStarredFile(data)
}

// ============================================================================
// SUB-PAGES
// ============================================================================

export async function addSubPage(
  topicSlug: string,
  subPageSlug: string,
  name: string,
  description: string
): Promise<void> {
  // 1. Update topics.json
  const topicsPath = path.join(memoryDir(), 'topics.json')
  let topicsData: any = { topics: [] }
  try {
    topicsData = JSON.parse(await fsp.readFile(topicsPath, 'utf-8'))
  } catch { /* no file */ }

  const topic = topicsData.topics.find((t: any) => t.slug === topicSlug)
  if (!topic) throw new Error(`Topic "${topicSlug}" not found`)

  if (!topic.subpages) topic.subpages = []
  if (topic.subpages.some((sp: any) => sp.slug === subPageSlug)) {
    throw new Error(`Sub-page "${subPageSlug}" already exists in "${topicSlug}"`)
  }

  topic.subpages.push({ slug: subPageSlug, name, description })
  const tmp = topicsPath + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(topicsData, null, 2), 'utf-8')
  await fsp.rename(tmp, topicsPath)

  // 2. Create the sub-page .md file
  const today = new Date().toISOString().split('T')[0]
  const pageContent = `---\ntopic: ${name}\ndescription: "${description}"\nsource: user\ncreated: ${today}\nlast_updated: ${today}\n---\n`
  const topicDir = path.join(memoryDir(), 'knowledge', topicSlug)
  await fsp.mkdir(topicDir, { recursive: true })
  await fsp.writeFile(path.join(topicDir, `${subPageSlug}.md`), pageContent, 'utf-8')
}

// ============================================================================
// USER NOTES
// ============================================================================

function notesDir(): string {
  return path.join(memoryDir(), 'notes')
}

export async function createUserNote(title: string, content: string, topics?: string[]): Promise<string> {
  const id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const frontmatter = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${new Date().toISOString()}`,
    `topics: ${JSON.stringify(topics || [])}`,
    'ingest: false',
    'starred: false',
    '---'
  ].join('\n')

  const dir = notesDir()
  await fsp.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${id}.md`)
  await fsp.writeFile(filePath, `${frontmatter}\n${content}`, 'utf-8')
  indexNote(id, title, content)
  return id
}

export async function saveUserNote(id: string, title: string, content: string): Promise<void> {
  const filePath = path.join(notesDir(), `${id}.md`)

  // Read existing to preserve other frontmatter fields
  let existing: Record<string, any> = {}
  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (match) {
      for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) continue
        const key = line.slice(0, colonIdx).trim()
        let value: any = line.slice(colonIdx + 1).trim()
        if (value === 'true') value = true
        else if (value === 'false') value = false
        else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        else if (value.startsWith('[')) { try { value = JSON.parse(value) } catch { value = [] } }
        existing[key] = value
      }
    }
  } catch { /* new file */ }

  const frontmatter = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${existing.created || new Date().toISOString()}`,
    `topics: ${JSON.stringify(existing.topics || [])}`,
    `ingest: ${existing.ingest || false}`,
    `starred: ${existing.starred || false}`,
    '---'
  ].join('\n')

  const tmp = filePath + '.tmp'
  await fsp.writeFile(tmp, `${frontmatter}\n${content}`, 'utf-8')
  await fsp.rename(tmp, filePath)
  indexNote(id, title, content)
}

export async function deleteUserNote(id: string): Promise<void> {
  const filePath = path.join(notesDir(), `${id}.md`)
  await fsp.unlink(filePath)
}

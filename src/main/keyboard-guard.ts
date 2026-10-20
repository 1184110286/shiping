import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { onSettingsChanged, settings } from './settings'

type ShortcutEntry = { action: string; key: string }

type KeyboardGuardConfig = {
  enabled: boolean
  blockLeftCtrl: boolean
  blockRightCtrl: boolean
}

let config: KeyboardGuardConfig = {
  enabled: false,
  blockLeftCtrl: true,
  blockRightCtrl: false
}
let inputPaused = false
let shortcuts: ShortcutEntry[] = []
let helper: ChildProcess | null = null
let actionHandler: ((action: string) => void) | null = null
let restartTimer: NodeJS.Timeout | null = null

function helperPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'windows-keyboard-guard.exe')
  }
  return join(app.getAppPath(), 'resources', 'bin', 'windows-keyboard-guard.exe')
}

function shouldRun(): boolean {
  return (
    process.platform === 'win32' &&
    config.enabled &&
    !inputPaused &&
    (config.blockLeftCtrl || config.blockRightCtrl)
  )
}

function stopHelper(): void {
  if (!helper) return
  helper.removeAllListeners()
  helper.kill()
  helper = null
}

function buildArgs(): string[] {
  const args = [
    config.blockLeftCtrl ? '--left' : '--no-left',
    config.blockRightCtrl ? '--right' : '--no-right'
  ]
  for (const shortcut of shortcuts) {
    if (!/(^|\+)(CommandOrControl|Control)(\+|$)/.test(shortcut.key)) continue
    args.push(
      '--shortcut',
      Buffer.from(`${shortcut.action}\t${shortcut.key}`, 'utf8').toString('base64')
    )
  }
  return args
}

function startHelper(): void {
  stopHelper()
  if (!shouldRun()) return

  const executable = helperPath()
  if (!existsSync(executable)) {
    console.warn(
      `Windows keyboard guard helper is missing: ${executable}. Run npm run build:keyboard-guard:win first.`
    )
    return
  }

  try {
    const child = spawn(executable, buildArgs(), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    helper = child

    let stdoutBuffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      while (true) {
        const newline = stdoutBuffer.indexOf('\n')
        if (newline < 0) break
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (!line.startsWith('ACTION\t')) continue
        const action = line.slice('ACTION\t'.length)
        if (action) actionHandler?.(action)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (message) console.error(`keyboard-guard: ${message}`)
    })
    child.on('exit', (code) => {
      if (helper === child) helper = null
      if (code !== 0 && shouldRun()) {
        console.warn(`Windows keyboard guard helper exited with code ${code ?? 'unknown'}`)
      }
    })
    child.on('error', (error) => {
      if (helper === child) helper = null
      console.error('Cannot start Windows keyboard guard helper:', error)
    })
  } catch (error) {
    console.error('Cannot launch Windows keyboard guard helper:', error)
  }
}

function scheduleRestart(): void {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    startHelper()
  }, 40)
}

function syncConfigFromSettings(): void {
  config = {
    enabled: settings.keyboardGuardEnabled,
    blockLeftCtrl: settings.keyboardGuardBlockLeftCtrl,
    blockRightCtrl: settings.keyboardGuardBlockRightCtrl
  }
  scheduleRestart()
}

onSettingsChanged(() => syncConfigFromSettings())
syncConfigFromSettings()

export function setKeyboardGuardShortcuts(next: ShortcutEntry[]): void {
  shortcuts = next.map((shortcut) => ({ ...shortcut }))
  if (config.enabled) scheduleRestart()
}

export function setKeyboardGuardActionHandler(handler: (action: string) => void): void {
  actionHandler = handler
}

export function disposeKeyboardGuard(): void {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  stopHelper()
}

ipcMain.handle('keyboardGuard:setInputPaused', (_event, paused: boolean) => {
  const next = Boolean(paused)
  if (inputPaused === next) return
  inputPaused = next
  scheduleRestart()
})

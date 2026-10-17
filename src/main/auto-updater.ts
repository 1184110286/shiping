import { app, ipcMain, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AvailableUpdate } from '../shared/update'

/**
 * A new release is announced inside the main window only. A native dialog or
 * a system notification is drawn outside content protection, so one popping
 * up mid-interview would show on the shared screen.
 *
 * Windows downloads and installs it through electron-updater once the user
 * asks. The macOS build has no Apple signature, only a self-signed one, and
 * updating it through Squirrel.Mac has never been tried, so there the check
 * only reads the Latest release and points to its page. Both follow Latest
 * alone: a pre-release is never offered.
 */

const REPO = 'ooboqoo/interview-coder-cn'
// The app is often left running for days, on macOS especially
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let update: AvailableUpdate | null = null

function releaseUrl(version: string): string {
  return `https://github.com/${REPO}/releases/tag/v${version}`
}

function setUpdate(next: AvailableUpdate): void {
  update = next
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', update)
  }
}

/** Positive when `a` is the later of two dotted versions */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

const LATEST_URL = `https://github.com/${REPO}/releases/latest`

/**
 * Where the `releases/latest` page redirects (`…/releases/tag/v3.2.2`), which
 * skips drafts and pre-releases. Not the REST API: without a token it allows
 * 60 requests an hour per IP, and a proxy exit shared by many users runs out
 * of them. Electron's `net` goes through the system proxy, which GitHub often
 * needs from China.
 */
function getLatestReleaseUrl(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // net.fetch would follow the redirect without telling where it led
    const request = net.request({ url: LATEST_URL, redirect: 'manual' })
    const timer = setTimeout(() => request.abort(), 15_000)
    const settle = (finish: () => void): void => {
      clearTimeout(timer)
      finish()
      request.abort()
    }
    request.on('redirect', (_status, _method, redirectUrl) => settle(() => resolve(redirectUrl)))
    // No redirect: nothing released, or an error page
    request.on('response', () => settle(() => resolve(null)))
    request.on('error', (err) => settle(() => reject(err)))
    request.on('abort', () => reject(new Error('Timed out')))
    request.end()
  })
}

/** A failure stays silent: the next check tries again */
async function checkLatestRelease(): Promise<void> {
  try {
    const url = await getLatestReleaseUrl()
    const tag = url && /\/releases\/tag\/([^/?#]+)$/.exec(url)?.[1]
    if (!url || !tag) return
    const version = decodeURIComponent(tag).replace(/^v/, '')
    if (compareVersions(version, app.getVersion()) <= 0) return
    setUpdate({ version, url, installable: false, phase: 'available' })
  } catch (err) {
    console.error('Update check failed:', err)
  }
}

function initInstaller(): void {
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    setUpdate({
      version: info.version,
      url: releaseUrl(info.version),
      installable: true,
      phase: 'available'
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.floor(progress.percent)
    if (update?.phase === 'downloading' && update.percent !== percent) {
      setUpdate({ ...update, percent })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    if (update) setUpdate({ ...update, phase: 'downloaded' })
  })

  // Failed checks land here too (offline, GitHub unreachable); they stay silent
  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error)
  })
}

function checkForUpdate(): void {
  // A download under way or done is not started over
  if (update?.phase === 'downloading' || update?.phase === 'downloaded') return
  if (process.platform === 'darwin') {
    void checkLatestRelease()
  } else {
    autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err))
  }
}

export function initAutoUpdater(): void {
  if (process.platform !== 'darwin') {
    try {
      initInstaller()
    } catch (e) {
      console.error('Failed to initialize auto-updater:', e)
      return
    }
  }
  checkForUpdate()
  setInterval(checkForUpdate, CHECK_INTERVAL_MS)
}

ipcMain.handle('update:get-status', () => update)

ipcMain.handle('update:download', () => {
  if (!update?.installable || (update.phase !== 'available' && update.phase !== 'failed')) return
  setUpdate({ ...update, phase: 'downloading', percent: 0, error: undefined })
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('Update download failed:', err)
    if (update) {
      setUpdate({
        ...update,
        phase: 'failed',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })
})

ipcMain.handle('update:install', () => {
  if (update?.phase !== 'downloaded') return
  // Not silent, so the installer shows its progress; the app reopens after it
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
})

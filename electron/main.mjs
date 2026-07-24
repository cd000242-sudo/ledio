/* global process, URL */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShortsFactoryServer, killAllCliChildren } from '../scripts/local-server.mjs'

const { autoUpdater } = electronUpdater

const electronDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(app.getAppPath())
const appRoot = join(workspaceRoot, 'app')
const host = '127.0.0.1'

let server
let mainWindow

function safeProjectName(value) {
  const rawName = String(value ?? 'new-project')
  const safeName = rawName
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return safeName || 'new-project'
}

function safeFileName(value, fallback = 'media') {
  const withoutControlChars = Array.from(String(value ?? '')).filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 32 && code !== 127
  })
  const cleaned = withoutControlChars
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.replace(/^\.+/, '').slice(0, 120) || fallback
}

function mediaOptions(kind) {
  if (kind === 'image') {
    return {
      folder: 'images',
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    }
  }
  if (kind === 'audio') {
    return {
      folder: 'audio',
      filters: [{ name: '오디오', extensions: ['mp3', 'wav', 'm4a', 'aac'] }],
    }
  }
  return {
    folder: 'clips',
    filters: [{ name: '영상', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  }
}

function listen(serverToStart) {
  return new Promise((resolveListen, rejectListen) => {
    serverToStart.once('error', rejectListen)
    serverToStart.listen(0, host, () => {
      serverToStart.off('error', rejectListen)
      resolveListen(serverToStart.address())
    })
  })
}

function isLocalAppUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === host
  } catch {
    return false
  }
}

async function createWindow() {
  server = createShortsFactoryServer({ workspaceRoot, appRoot, host, port: 0, sweepOrphans: true })
  const address = await listen(server)
  const appUrl = `http://${host}:${address.port}/`

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: '쇼츠팩토리 스튜디오',
    backgroundColor: '#070b18',
    show: false,
    webPreferences: {
      preload: join(electronDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalAppUrl(url)) event.preventDefault()
  })

  // 메뉴를 없애면 기본 단축키도 사라지므로 개발자도구(Ctrl+Shift+I / F12)는 직접 처리한다.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key ?? '').toLowerCase()
    if ((input.control && input.shift && key === 'i') || key === 'f12') {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  await mainWindow.loadURL(appUrl)
  mainWindow.show()
}

ipcMain.handle('shorts:select-and-import-media', async (_event, payload = {}) => {
  const kind = payload.kind === 'image' || payload.kind === 'audio' ? payload.kind : 'video'
  const { folder, filters } = mediaOptions(kind)
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'image' ? '이미지 선택' : kind === 'audio' ? 'BGM 선택' : '영상 선택',
    properties: ['openFile', 'multiSelections'],
    filters,
  })
  if (result.canceled) return { ok: true, imported: [] }

  const projectName = safeProjectName(payload.projectName)
  const projectDir = join(workspaceRoot, 'projects', projectName)
  const targetDir = join(projectDir, folder)
  await mkdir(targetDir, { recursive: true })

  const imported = []
  for (let index = 0; index < result.filePaths.length; index += 1) {
    const sourcePath = result.filePaths[index]
    const name = safeFileName(basename(sourcePath), `${kind}-${index + 1}`)
    const targetPath = join(targetDir, name)
    await copyFile(sourcePath, targetPath)
    imported.push({
      name,
      kind,
      relativePath: `${folder}/${name}`,
      absolutePath: targetPath,
      originalPath: sourcePath,
    })
  }

  return { ok: true, projectDir, imported }
})

/**
 * 자동 업데이트 — GitHub 릴리즈(latest.yml)를 확인해 새 버전을 내려받는다.
 * 설치는 사용자가 '지금 재시작'을 눌렀을 때만 진행한다(무단 재시작 금지).
 * 개발 실행(npm run electron)에서는 동작하지 않는다.
 */
function setupAutoUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: ['지금 재시작하고 설치', '나중에 (다음 실행 때 설치)'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: `새 버전 v${info.version}이 다운로드됐습니다.`,
      detail: '지금 재시작하면 바로 설치됩니다. 나중에를 누르면 앱을 닫을 때 자동으로 설치됩니다.',
    })
    if (choice === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', () => {
    // 오프라인·릴리즈 없음 등은 조용히 무시 — 앱 사용을 막지 않는다.
  })
  autoUpdater.checkForUpdates().catch(() => {})
}

app.setName('쇼츠팩토리 스튜디오')
Menu.setApplicationMenu(null)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    await createWindow()
    setupAutoUpdater()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    // 진행 중이던 CLI 자식(과 그 손자 크로미움·ffmpeg)을 트리째 정리해 좀비를 막는다.
    killAllCliChildren()
    if (server) server.close()
  })
}

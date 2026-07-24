/* global Buffer, clearTimeout, document, FileReader, fetch, localStorage, navigator, setTimeout */
/**
 * 드롭샷(aistudio.dropshot.io) 나노바나나프로 이미지 생성 엔진 — UI 자동화 방식.
 * API 직접 호출은 Cognito 인증 우회가 불가능해 Playwright로 실제 화면을 조작한다.
 * 세션은 영구 프로필(~/.shorts-factory/dropshot-profile)에 저장되어 재로그인이 필요 없다.
 * (blogger-gpt-cli의 DROPSHOT_PORTING_KIT 검증 코드를 이식)
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

const BOARD_URL =
  'https://aistudio.dropshot.io/ko/workspace/board?panel=image&imageModelName=google/nano-banana-pro'
const PROFILE_NAME = 'dropshot-profile'
const PROFILE_ROOT = '.shorts-factory'
const PROMPT_SELECTOR = 'textarea[placeholder="어떤 장면을 만들고 싶나요?"]'

let cachedContext = null
let cachedPage = null
let _ensurePagePromise = null
let _generationChain = Promise.resolve()

function getProfileDir() {
  const dir = path.join(os.homedir(), PROFILE_ROOT, PROFILE_NAME)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 캐시된 브라우저를 닫고 프로필을 놓아준다.
 * 크로미움 프로필은 한 번에 한 프로세스만 쓸 수 있어서, 서버(앱) 프로세스가
 * 로그인 확인 후 브라우저를 들고 있으면 이미지 생성 CLI가 프로필을 못 연다.
 */
export async function closeDropshotBrowser() {
  const context = cachedContext
  cachedContext = null
  cachedPage = null
  if (!context) return
  try {
    await context.close()
  } catch {
    /* 이미 닫힘 */
  }
}

async function launchBrowser(profileDir, headless) {
  let chromium = null
  for (const pkg of ['patchright', 'playwright', '@playwright/test']) {
    try {
      chromium = (await import(pkg)).chromium
      if (chromium) break
    } catch {
      /* 다음 패키지 시도 */
    }
  }
  if (!chromium) throw new Error('playwright가 필요합니다: npm i -D @playwright/test')
  const baseOptions = {
    headless,
    timeout: 60_000,
    args: [
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--lang=ko-KR,ko',
      '--window-size=1280,900',
    ],
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ignoreDefaultArgs: ['--enable-automation'],
  }
  const stealthInit = () => {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en'],
      configurable: true,
    })
  }
  // 항상 내장 Chromium만 사용한다. 실제 Chrome은 쿠키를 자체 암호화(App-Bound)해서
  // 로그인 창과 생성용 headless가 세션을 공유하지 못하는 문제가 생긴다.
  try {
    const ctx = await chromium.launchPersistentContext(profileDir, baseOptions)
    try {
      await ctx.addInitScript(stealthInit)
    } catch {
      /* stealth는 선택 사항 */
    }
    return ctx
  } catch (error) {
    const message = String(error.message ?? '')
    // 같은 프로필을 다른 프로세스(앱의 로그인 확인 등)가 쓰고 있으면 크로미움이 바로 종료된다.
    if (/ProcessSingleton|SingletonLock|already in use|Target.*closed|browser has been closed/i.test(message)) {
      throw new Error(
        '드롭샷 브라우저 프로필이 이미 다른 프로세스에서 사용 중입니다. ' +
          '잠시 후 다시 시도하거나, 열린 드롭샷 창을 닫고 재시도하세요.',
      )
    }
    throw new Error(`브라우저 실행 실패: ${message}\n해결: npx playwright install chromium`)
  }
}

async function isLoggedIn(page) {
  try {
    // 실측 기준(2026-07): 비로그인 보드 페이지에는 "로그인" 버튼과 가입 홍보 문구가 있고,
    // 로그인하면 사라진다. 페이지가 아직 덜 그려졌으면 판단을 보류한다(false).
    const ui = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const clickable = Array.from(document.querySelectorAll('a, button')).map((el) => (el.innerText || '').trim())
      const boardReady = Boolean(document.querySelector('textarea')) || text.includes('프롬프트')
      const hasLoginButton = clickable.some((label) => label === '로그인' || label === 'Log in' || label === 'Sign in')
      const hasSignupPromo = text.includes('지금 가입 시') || text.includes('가입 즉시 무료 크레딧')
      return { boardReady, hasLoginButton, hasSignupPromo }
    })
    return ui.boardReady && !ui.hasLoginButton && !ui.hasSignupPromo
  } catch {
    return false
  }
}

/**
 * 로그인 판정을 폴링으로 한다 — 페이지가 늦게 그려지면 한 번의 확인은
 * 로그인 상태를 "안 됨"으로 오판해 불필요한 로그인 창을 띄운다(실측).
 */
async function waitLoggedIn(page, timeoutMs = 15000) {
  const start = Date.now()
  for (;;) {
    if (await isLoggedIn(page)) return true
    if (Date.now() - start >= timeoutMs) return false
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/** 로그인 상태만 확인한다(로그인 창을 띄우지 않음). */
export async function checkDropshotLogin() {
  if (cachedPage) {
    try {
      await cachedPage.evaluate(() => document.readyState)
      return { loggedIn: await isLoggedIn(cachedPage) }
    } catch {
      cachedPage = null
      cachedContext = null
    }
  }
  const context = await launchBrowser(getProfileDir(), true)
  try {
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await new Promise((r) => setTimeout(r, 5000))
    const loggedIn = await waitLoggedIn(page, 12000)
    if (loggedIn) {
      cachedContext = context
      cachedPage = page
      return { loggedIn: true }
    }
    await context.close()
    return { loggedIn: false, message: '드롭샷 로그인이 필요합니다.' }
  } catch (error) {
    try {
      await context.close()
    } catch {
      /* 이미 닫힘 */
    }
    return { loggedIn: false, message: error.message }
  }
}

/** 보이는 브라우저를 띄워 사용자가 직접 로그인하게 한다(최대 5분 대기). */
export async function loginDropshot(onLog) {
  if (cachedContext) {
    try {
      await cachedContext.close()
    } catch {
      /* 이미 닫힘 */
    }
    cachedContext = null
    cachedPage = null
  }
  const profileDir = getProfileDir()
  let context = await launchBrowser(profileDir, false)
  let page = context.pages()[0] || (await context.newPage())
  await page.goto('https://aistudio.dropshot.io', { waitUntil: 'domcontentloaded', timeout: 45000 })

  let loggedIn = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      const pages = context.pages()
      const urlOf = (p) => {
        try {
          return p.url()
        } catch {
          return ''
        }
      }
      // 인증 정보는 aistudio.dropshot.io localStorage에 저장되므로 그 도메인 페이지를 우선 확인한다.
      page =
        pages.find((p) => urlOf(p).includes('aistudio.dropshot.io')) ||
        pages.find((p) => urlOf(p).includes('dropshot.io')) ||
        pages[pages.length - 1]
      if (await isLoggedIn(page)) {
        loggedIn = true
        break
      }
    } catch {
      continue
    }
    if (i % 6 === 5) onLog?.(`로그인 대기 중 (${Math.round(((i + 1) * 5) / 60)}분 경과)`)
  }
  await context.close()
  if (!loggedIn) return { loggedIn: false, message: '로그인 시간 초과(5분). 다시 시도하세요.' }
  return { loggedIn: true, message: '드롭샷 로그인 완료' }
}

async function ensurePage(onLog) {
  if (_ensurePagePromise) {
    await _ensurePagePromise
    if (cachedPage && cachedContext) {
      try {
        await cachedPage.evaluate(() => document.readyState)
        return cachedPage
      } catch {
        /* 아래에서 재생성 */
      }
    }
  }
  let release
  _ensurePagePromise = new Promise((r) => {
    release = r
  })
  try {
    return await _ensurePageInternal(onLog)
  } finally {
    _ensurePagePromise = null
    release()
  }
}

async function _ensurePageInternal(onLog) {
  if (cachedPage && cachedContext) {
    try {
      await cachedPage.evaluate(() => document.readyState)
      if (!cachedPage.url().includes('dropshot.io')) {
        await cachedPage.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise((r) => setTimeout(r, 3000))
      }
      return cachedPage
    } catch {
      cachedPage = null
      cachedContext = null
    }
  }

  const profileDir = getProfileDir()
  onLog?.('드롭샷 브라우저 준비 중...')
  let context = await launchBrowser(profileDir, true)
  let page = context.pages()[0] || (await context.newPage())
  await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise((r) => setTimeout(r, 5000))

  if (await waitLoggedIn(page, 15000)) {
    cachedContext = context
    cachedPage = page
    return page
  }

  onLog?.('로그인 필요 — 브라우저 창을 표시합니다 (최대 5분)')
  await context.close()
  const result = await loginDropshot(onLog)
  if (!result.loggedIn) throw new Error(result.message || '드롭샷 로그인 실패')

  const hctx = await launchBrowser(profileDir, true)
  const hpage = hctx.pages()[0] || (await hctx.newPage())
  await hpage.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise((r) => setTimeout(r, 4000))
  cachedContext = hctx
  cachedPage = hpage
  return hpage
}

/** 프라미스에 전체 데드라인을 건다. 초과하면 걸린 브라우저를 정리하고 명확한 에러를 던진다. */
async function withDeadline(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } catch (error) {
    await closeDropshotBrowser()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// 현재 페이지 세션에 첨부된 참조 이미지 경로 — 같은 참조는 다시 올리지 않는다.
let _attachedReference = ''

/** 이미지 프롬프트 입력창 근처의 파일 입력에 참조 이미지들을 첨부한다(인물·세트 고정용). */
async function attachReferenceImages(page, referencePaths, onLog) {
  const key = referencePaths.join('|')
  if (_attachedReference === key) return true
  // 다른 참조가 붙어 있으면 새로고침으로 초기화한다(첨부가 누적되지 않게).
  if (_attachedReference) {
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 3000))
    _attachedReference = ''
  }
  const fsMod = await import('node:fs/promises')
  const files = []
  for (const refPath of referencePaths) {
    files.push({
      name: path.basename(refPath),
      mimeType: 'image/png',
      buffer: await fsMod.readFile(refPath),
    })
  }
  const handle = await page.evaluateHandle((selector) => {
    const textarea = document.querySelector(selector)
    let parent = textarea?.parentElement
    for (let depth = 0; depth < 10 && parent; depth++) {
      const input = parent.querySelector('input[type="file"][accept*="jpeg"], input[type="file"][accept*="image"]')
      if (input) return input
      parent = parent.parentElement
    }
    return null
  }, PROMPT_SELECTOR)
  const input = handle.asElement()
  if (!input) {
    onLog?.('참조 이미지 입력을 찾지 못해 참조 없이 진행합니다.')
    return false
  }
  try {
    await input.setInputFiles(files)
  } catch {
    // 입력이 단일 파일만 받으면 첫 번째(주인공)만 첨부한다.
    await input.setInputFiles(files[0])
    onLog?.('참조 입력이 1장만 지원 — 주인공 참조만 첨부합니다.')
  }
  await new Promise((r) => setTimeout(r, 2500))
  _attachedReference = key
  onLog?.(`참조 이미지 ${files.length}장 첨부 완료 (인물${files.length > 1 ? '+세트' : ''})`)
  return true
}

/**
 * 무제한 모드가 꺼져 있으면 켠다 — 꺼진 채 생성하면 장당 크레딧(150)이 소모된다.
 * 실측 DOM: "무제한 모드" 스팬 옆 label 안에 input[role="switch"][aria-checked].
 */
async function ensureUnlimitedMode(page, onLog) {
  try {
    const state = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span')).filter(
        (el) => (el.innerText || '').trim() === '무제한 모드',
      )
      for (const span of spans) {
        const container = span.parentElement
        const input = container?.querySelector('input[role="switch"]')
        if (!input) continue
        const wasOn = input.getAttribute('aria-checked') === 'true' || input.checked === true
        if (!wasOn) {
          const toggle = input.closest('label') || input
          toggle.click()
        }
        return { found: true, wasOn }
      }
      return { found: false, wasOn: false }
    })
    if (!state.found) {
      onLog?.('무제한 모드 토글을 찾지 못했습니다 — 화면 기본 상태로 생성합니다.')
      return false
    }
    if (!state.wasOn) {
      await new Promise((r) => setTimeout(r, 800))
      onLog?.('무제한 모드 켬 — 크레딧 소모 없이 생성합니다.')
    }
    return true
  } catch {
    return false
  }
}

async function _makeDropshotImageInternal(prompt, onLog, referenceImagePaths) {
  const MAX_RETRIES = 3
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    onLog?.(`드롭샷 이미지 생성 중... (시도 ${attempt}/${MAX_RETRIES})`)
    try {
      // 죽은 페이지로 재시도하지 않게 매 시도마다 페이지를 확보한다(죽었으면 새로 띄운다).
      const page = await ensurePage(onLog)
      // 재시도 때는 페이지를 강제로 새로고침한다 — 이전 시도가 화면을 이상한 상태
      // (안 닫히는 모달, 멈춘 생성 큐)로 남겼으면 새로고침 없이는 계속 실패한다.
      if (attempt > 1 || !page.url().includes('panel=image')) {
        await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise((r) => setTimeout(r, 3000))
        _attachedReference = '' // 새로고침으로 첨부가 사라졌다
      }

      // 크레딧 보호: 생성 전에 무제한 모드가 켜져 있는지 확인하고 꺼져 있으면 켠다.
      await ensureUnlimitedMode(page, onLog)

      if (referenceImagePaths?.length) await attachReferenceImages(page, referenceImagePaths, onLog)

      const beforeSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img'))
          .map((i) => i.src || '')
          .filter(
            (s) =>
              (s.startsWith('data:image/') || s.includes('cdn.aistudio.dropshot.io')) &&
              !s.includes('/icons/') &&
              !s.includes('/sample/'),
          ),
      )

      await page.waitForSelector(PROMPT_SELECTOR, { timeout: 10000 })
      await page.click(PROMPT_SELECTOR)
      await page.fill(PROMPT_SELECTOR, prompt)
      await new Promise((r) => setTimeout(r, 1000))

      const clicked = await page.evaluate(() => {
        const ta = document.querySelector('textarea[placeholder="어떤 장면을 만들고 싶나요?"]')
        if (!ta) return false
        let parent = ta.parentElement
        for (let depth = 0; depth < 5 && parent; depth++) {
          const btn = parent.querySelector('button.absolute')
          if (btn && !btn.disabled) {
            btn.click()
            return true
          }
          parent = parent.parentElement
        }
        return false
      })
      if (!clicked) await page.keyboard.press('Enter')

      // 서비스가 느린 시간대에 90초로는 모자라 3연속 실패하는 사고가 있었다(150초로 연장).
      const WAIT_LIMIT_MS = 150_000
      const startTs = Date.now()
      let foundDataUrl = null
      while (Date.now() - startTs < WAIT_LIMIT_MS) {
        await new Promise((r) => setTimeout(r, 2000))
        const dataUrl = await page.evaluate((before) => {
          const beforeSet = new Set(before)
          return (
            Array.from(document.querySelectorAll('img')).find((i) => {
              const src = i.src || ''
              return src.startsWith('data:image/') && i.naturalWidth > 200 && !src.includes('icons/') && !beforeSet.has(src)
            })?.src || null
          )
        }, beforeSrcs)
        if (dataUrl) {
          foundDataUrl = dataUrl
          break
        }
        const cdnUrl = await page.evaluate((before) => {
          const beforeSet = new Set(before)
          return (
            Array.from(document.querySelectorAll('img')).find((i) => {
              const src = i.src || ''
              return (
                src.includes('cdn.aistudio.dropshot.io') &&
                !src.includes('/icons/') &&
                !src.includes('/sample/') &&
                i.naturalWidth > 200 &&
                !beforeSet.has(src)
              )
            })?.src || null
          )
        }, beforeSrcs)
        if (cdnUrl) {
          foundDataUrl = await page.evaluate(async (url) => {
            const r = await fetch(url)
            const blob = await r.blob()
            return await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result)
              reader.onerror = () => reject(new Error('blob read failed'))
              reader.readAsDataURL(blob)
            })
          }, cdnUrl)
          break
        }
      }

      if (foundDataUrl) return { ok: true, dataUrl: foundDataUrl }
      lastError = '150초 내 결과 이미지 미발견 — 드롭샷이 느리거나 생성이 실패했습니다'
    } catch (e) {
      lastError = e.message || String(e)
      if (lastError.includes('Target closed') || lastError.includes('WebSocket')) {
        cachedPage = null
        cachedContext = null
      }
    }
  }
  return { ok: false, dataUrl: '', error: lastError || 'unknown' }
}

const VIDEO_URL = 'https://aistudio.dropshot.io/ko/workspace/board?panel=video'

/** 이미지 파일을 시작 장면으로 넣어 5초 영상을 생성한다(클립당 크레딧 소모). */
async function _makeDropshotVideoInternal(prompt, imagePath, onLog) {
  const fsMod = await import('node:fs/promises')
  const page = await ensurePage(onLog)
  await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise((r) => setTimeout(r, 5000))

  // 생성 전 영상 스냅숏(이전 결과 재캡처 방지)
  const beforeVideos = await page.evaluate(() =>
    Array.from(document.querySelectorAll('video'))
      .map((v) => v.src || v.querySelector('source')?.src || '')
      .filter(Boolean),
  )

  // 시작 장면(이미지) 업로드
  const buffer = await fsMod.readFile(imagePath)
  const fileInput = await page.$('input[type="file"][accept*="image"], input[type="file"]')
  if (fileInput) {
    await fileInput.setInputFiles({ name: 'scene.jpg', mimeType: 'image/jpeg', buffer })
    await new Promise((r) => setTimeout(r, 2500))
    onLog?.('드롭샷 시작 장면 업로드 완료')
  } else {
    onLog?.('시작 장면 업로드 입력을 찾지 못했습니다 — 텍스트 기반으로 생성합니다.')
  }

  // 9:16 세로 비율 선택(버튼/옵션 텍스트 기반)
  await page
    .locator('button, [role="option"], [role="menuitem"], span')
    .filter({ hasText: /^9:16$/ })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {})

  // 프롬프트 입력 (영상 패널 전용 입력창 — 이미지 패널의 숨은 textarea와 구분)
  const textarea = await page.$('textarea[placeholder="어떤 영상을 만들고 싶나요?"]')
  if (!textarea) throw new Error('드롭샷 영상 프롬프트 입력창을 찾지 못했습니다(UI 변경 가능성).')
  await textarea.click()
  await textarea.fill(prompt)
  await new Promise((r) => setTimeout(r, 800))

  // 생성 버튼
  const clicked = await page
    .locator('button')
    .filter({ hasText: /영상 생성하기|생성하기/ })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (!clicked) await page.keyboard.press('Enter')
  onLog?.('드롭샷 영상 생성 시작 — 보통 1~3분 걸립니다.')

  // 새 결과 영상 대기(최대 6분)
  const startTs = Date.now()
  while (Date.now() - startTs < 6 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 5000))
    const videoUrl = await page.evaluate((before) => {
      const beforeSet = new Set(before)
      return (
        Array.from(document.querySelectorAll('video'))
          .map((v) => v.src || v.querySelector('source')?.src || '')
          .find((src) => src && !beforeSet.has(src) && !src.startsWith('blob:')) || null
      )
    }, beforeVideos)
    if (videoUrl) {
      const data = await page.evaluate(async (url) => {
        const res = await fetch(url)
        const blob = await res.blob()
        return await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('video read failed'))
          reader.readAsDataURL(blob)
        })
      }, videoUrl)
      const match = /^data:[^;]+;base64,(.+)$/.exec(data)
      if (match) return Buffer.from(match[1], 'base64')
    }
  }
  throw new Error('6분 내 결과 영상을 찾지 못했습니다.')
}

/** @returns {Promise<{ ok: boolean, outPath?: string, error?: string }>} */
export function makeDropshotVideo(prompt, options, onLog) {
  const run = _generationChain.then(async () => {
    try {
      const buffer = await withDeadline(
        _makeDropshotVideoInternal(prompt, options.imagePath, onLog),
        15 * 60_000,
        '드롭샷 영상 생성이 15분을 초과했습니다 — 드롭샷 상태를 확인하고 다시 시도하세요.',
      )
      const fsMod = await import('node:fs/promises')
      await fsMod.writeFile(options.outPath, buffer)
      return { ok: true, outPath: options.outPath }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  _generationChain = run.catch(() => {})
  return run
}

/** 이미지 1장 생성. options.referenceImagePaths(배열)나 referenceImagePath를 주면 그 인물·세트를 참조해 그린다.
 *  병렬 호출은 내부에서 직렬화된다(단일 브라우저 페이지 공유). */
export function makeDropshotImage(prompt, options = {}, onLog) {
  const refs = options.referenceImagePaths ?? (options.referenceImagePath ? [options.referenceImagePath] : [])
  const run = _generationChain.then(() =>
    withDeadline(
      _makeDropshotImageInternal(prompt, onLog, refs),
      9 * 60_000,
      '드롭샷 이미지 생성이 9분을 초과했습니다 — 브라우저가 멈춘 것으로 보고 정리했습니다. 다시 시도하세요.',
    ),
  )
  _generationChain = run.catch(() => {})
  return run
}

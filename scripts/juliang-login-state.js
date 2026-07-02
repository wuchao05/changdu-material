#!/usr/bin/env node

/**
 * 巨量登录态导出/使用脚本
 *
 * 用法：
 *   pnpm juliang:login-state export --browser chrome --profile Default --out ./juliang-login-state.json
 *   pnpm juliang:login-state open --browser edge --state ./juliang-login-state.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const JULIANG_HOME_URL = 'https://ad.oceanengine.com/';
const LOGIN_STATE_TYPE = 'juliang-login-state';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 30000;
const LOGIN_CHECK_INTERVAL_MS = 10000;

const SUPPORTED_BROWSERS = new Set(['chrome', 'edge', 'chromium']);
const BROWSER_CHANNELS = {
  chrome: 'chrome',
  edge: 'msedge',
  chromium: 'chromium',
};

function printUsage() {
  console.log(`
巨量登录态工具

用法:
  pnpm juliang:login-state export --browser <chrome|edge|chromium> [选项]
  pnpm juliang:login-state open --state <登录态文件> --browser <chrome|edge|chromium> [选项]

export 选项:
  --browser <name>          要读取的浏览器，默认 chrome
  --user-data-dir <path>    浏览器用户数据目录；不传时使用系统默认目录
  --profile <name>          浏览器配置目录名，默认 Default，例如 "Profile 1"
  --out <path>              输出文件路径，默认 ./juliang-login-state-时间戳.json
  --timeout <ms>            等待登录完成的超时时间，默认 ${DEFAULT_TIMEOUT_MS}
  --launch-timeout <ms>     等待浏览器启动完成的超时时间，默认 ${DEFAULT_LAUNCH_TIMEOUT_MS}
  --direct                  直接使用原浏览器数据目录启动；默认会复制到临时目录后读取
  --executable-path <path>  自定义浏览器可执行文件路径

open 选项:
  --state <path>            登录态文件路径
  --browser <name>          要打开的浏览器，默认 chrome
  --user-data-dir <path>    用于写入登录态的独立浏览器数据目录；默认 ~/.changdu-material/juliang-login-browser/<browser>
  --profile <name>          浏览器配置目录名，默认 Default
  --timeout <ms>            打开并检查登录态的超时时间，默认 ${DEFAULT_TIMEOUT_MS}
  --launch-timeout <ms>     等待浏览器启动完成的超时时间，默认 ${DEFAULT_LAUNCH_TIMEOUT_MS}
  --executable-path <path>  自定义浏览器可执行文件路径

示例:
  pnpm juliang:login-state export --browser chrome --profile Default --out ./juliang-login-state.json
  pnpm juliang:login-state open --browser edge --state ./juliang-login-state.json
`);
}

function parseArgs(argv) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const firstArg = normalizedArgv[0];
  const isHelpOnly = firstArg === '--help' || firstArg === '-h';
  const [command, ...tokens] = isHelpOnly ? [undefined, ...normalizedArgv] : normalizedArgv;
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数: ${token}`);
    }

    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function resolvePath(inputPath) {
  return path.resolve(expandHome(inputPath));
}

function normalizeBrowser(browser) {
  const normalized = String(browser || 'chrome').toLowerCase();
  if (!SUPPORTED_BROWSERS.has(normalized)) {
    throw new Error(
      `不支持的浏览器: ${browser}。当前支持: ${Array.from(SUPPORTED_BROWSERS).join(', ')}`,
    );
  }
  return normalized;
}

function getDefaultSourceUserDataDir(browser) {
  const home = os.homedir();

  if (process.platform === 'darwin') {
    if (browser === 'chrome') {
      return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    }
    if (browser === 'edge') {
      return path.join(home, 'Library', 'Application Support', 'Microsoft Edge');
    }
    return path.join(home, 'Library', 'Application Support', 'Chromium');
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error('未读取到 LOCALAPPDATA，无法推断 Windows 浏览器数据目录');
    }

    if (browser === 'chrome') {
      return path.join(localAppData, 'Google', 'Chrome', 'User Data');
    }
    if (browser === 'edge') {
      return path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
    }
    return path.join(localAppData, 'Chromium', 'User Data');
  }

  if (browser === 'chrome') {
    return path.join(home, '.config', 'google-chrome');
  }
  if (browser === 'edge') {
    return path.join(home, '.config', 'microsoft-edge');
  }
  return path.join(home, '.config', 'chromium');
}

function getDefaultTargetUserDataDir(browser) {
  return path.join(os.homedir(), '.changdu-material', 'juliang-login-browser', browser);
}

function getDefaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(`juliang-login-state-${timestamp}.json`);
}

function copyIfExists(sourcePath, targetPath, label) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  console.log(`复制 ${label}: ${sourcePath}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function copyMatchingDirectories(sourceDir, targetDir, matcher, label) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !matcher(entry.name)) {
      continue;
    }

    copyIfExists(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), label);
  }
}

function copyMinimalProfileData(sourceUserDataDir, targetUserDataDir, profile) {
  const sourceProfileDir = path.join(sourceUserDataDir, profile);
  const targetProfileDir = path.join(targetUserDataDir, profile);
  const profileFiles = [
    'Cookies',
    'Cookies-journal',
    'Network Persistent State',
    'Preferences',
    'Secure Preferences',
    'TransportSecurity',
  ];
  const profileDirs = [
    'Local Storage',
    'Session Storage',
    'Storage',
    'WebStorage',
  ];

  copyIfExists(path.join(sourceUserDataDir, 'Local State'), path.join(targetUserDataDir, 'Local State'), 'Local State');

  fs.mkdirSync(targetProfileDir, { recursive: true });
  for (const fileName of profileFiles) {
    copyIfExists(path.join(sourceProfileDir, fileName), path.join(targetProfileDir, fileName), fileName);
  }

  for (const dirName of profileDirs) {
    copyIfExists(path.join(sourceProfileDir, dirName), path.join(targetProfileDir, dirName), dirName);
  }

  copyMatchingDirectories(
    path.join(sourceProfileDir, 'IndexedDB'),
    path.join(targetProfileDir, 'IndexedDB'),
    (name) => {
      const normalizedName = name.toLowerCase();
      return normalizedName.includes('oceanengine.com') || normalizedName.includes('bytedance.com');
    },
    '巨量 IndexedDB',
  );
}

function prepareExportUserDataDir(sourceUserDataDir, profile, options) {
  if (options.direct) {
    return {
      launchUserDataDir: sourceUserDataDir,
      cleanup: () => {},
    };
  }

  const sourceProfileDir = path.join(sourceUserDataDir, profile);
  if (!fs.existsSync(sourceProfileDir)) {
    throw new Error(`浏览器配置目录不存在: ${sourceProfileDir}`);
  }

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changdu-juliang-login-state-'));
  copyMinimalProfileData(sourceUserDataDir, tempUserDataDir, profile);

  return {
    launchUserDataDir: tempUserDataDir,
    cleanup: () => {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    },
  };
}

function getLaunchOptions(browser, options) {
  const launchTimeoutMs = Number(options['launch-timeout'] || DEFAULT_LAUNCH_TIMEOUT_MS);
  const launchOptions = {
    headless: false,
    timeout: launchTimeoutMs,
    viewport: null,
    args: [
      '--start-maximized',
      `--profile-directory=${String(options.profile || 'Default')}`,
    ],
  };

  if (options['executable-path']) {
    launchOptions.executablePath = resolvePath(options['executable-path']);
  } else {
    launchOptions.channel = BROWSER_CHANNELS[browser];
  }

  return launchOptions;
}

function isJuliangLoginUrl(url) {
  if (!url) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();
    return pathname.includes('login') || hostname.includes('sso');
  } catch {
    const normalized = String(url).toLowerCase();
    return normalized.includes('/login') || normalized.includes('://sso');
  }
}

function isJuliangLoggedInUrl(url) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).hostname.toLowerCase() === 'business.oceanengine.com';
  } catch {
    return false;
  }
}

function getStorageState(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('登录态文件格式无效');
  }

  const storageState = payload.storageState || payload;
  if (
    !storageState ||
    typeof storageState !== 'object' ||
    !Array.isArray(storageState.cookies) ||
    !Array.isArray(storageState.origins)
  ) {
    throw new Error('登录态文件格式无效');
  }

  return {
    cookies: storageState.cookies,
    origins: storageState.origins,
  };
}

async function applyStorageState(context, page, storageState) {
  await context.clearCookies();

  if (storageState.cookies.length > 0) {
    await context.addCookies(storageState.cookies);
  }

  for (const originState of storageState.origins) {
    if (!originState.origin || !Array.isArray(originState.localStorage)) {
      continue;
    }

    await page.goto(originState.origin, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.evaluate((entries) => {
      window.localStorage.clear();
      for (const entry of entries) {
        window.localStorage.setItem(entry.name, entry.value);
      }
    }, originState.localStorage);
  }
}

function hasStorageStateContent(storageState) {
  const hasCookies = storageState.cookies.length > 0;
  const hasLocalStorage = storageState.origins.some(
    (origin) => Array.isArray(origin.localStorage) && origin.localStorage.length > 0,
  );

  return hasCookies || hasLocalStorage;
}

function hasJuliangStorageStateContent(storageState) {
  const hasJuliangCookies = storageState.cookies.some((cookie) => {
    const domain = String(cookie.domain || '').toLowerCase();
    return domain.includes('oceanengine.com') || domain.includes('bytedance.com');
  });
  const hasJuliangLocalStorage = storageState.origins.some((origin) => {
    const originUrl = String(origin.origin || '').toLowerCase();
    return (
      originUrl.includes('oceanengine.com') &&
      Array.isArray(origin.localStorage) &&
      origin.localStorage.length > 0
    );
  });

  return hasJuliangCookies || hasJuliangLocalStorage;
}

function readLoginState(filePath) {
  const resolvedPath = resolvePath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`登录态文件不存在: ${resolvedPath}`);
  }

  return getStorageState(JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')));
}

function buildLoginStateFile(storageState) {
  return {
    type: LOGIN_STATE_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    storageState,
  };
}

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function waitForLogin(context, page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    const storageState = getStorageState(await context.storageState({ indexedDB: true }));
    if (
      isJuliangLoggedInUrl(currentUrl) ||
      (!isJuliangLoginUrl(currentUrl) && hasJuliangStorageStateContent(storageState))
    ) {
      return true;
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `等待登录完成... 已等待 ${elapsedSeconds}s，当前 URL: ${currentUrl || 'about:blank'}`,
    );
    await page.waitForTimeout(LOGIN_CHECK_INTERVAL_MS);
  }

  return false;
}

async function getOrCreatePage(context) {
  const pages = context.pages();
  const page = pages.find((item) => !item.isClosed()) || (await context.newPage());
  await page.bringToFront();
  return page;
}

async function exportStorageStateFromContext(context, outputPath, timeoutMs) {
  console.log('浏览器已连接，正在打开巨量后台...');
  const page = await getOrCreatePage(context);
  await page.goto(JULIANG_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log(`当前页面 URL: ${page.url()}`);

  const initialStorageState = getStorageState(await context.storageState({ indexedDB: true }));

  if (
    !isJuliangLoggedInUrl(page.url()) &&
    (isJuliangLoginUrl(page.url()) || !hasJuliangStorageStateContent(initialStorageState))
  ) {
    console.log('当前未检测到巨量登录态，请在打开的浏览器窗口完成登录。');
    const loggedIn = await waitForLogin(context, page, timeoutMs);
    if (!loggedIn) {
      throw new Error('等待登录超时，未导出登录态');
    }
  }

  console.log('已检测到巨量登录态，正在导出...');
  const storageState = await context.storageState({ indexedDB: true });
  const normalizedState = getStorageState(storageState);
  if (!hasStorageStateContent(normalizedState)) {
    throw new Error('未读取到有效登录态，请确认已经登录巨量后台');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(buildLoginStateFile(normalizedState), null, 2),
    'utf-8',
  );

  console.log(`登录态已导出: ${outputPath}`);
}

async function exportLoginState(options) {
  const browser = normalizeBrowser(options.browser);
  const profile = String(options.profile || 'Default');
  const timeoutMs = Number(options.timeout || DEFAULT_TIMEOUT_MS);
  const sourceUserDataDir = resolvePath(options['user-data-dir'] || getDefaultSourceUserDataDir(browser));
  const outputPath = resolvePath(options.out || getDefaultOutputPath());

  if (!fs.existsSync(sourceUserDataDir)) {
    throw new Error(`浏览器用户数据目录不存在: ${sourceUserDataDir}`);
  }

  console.log(`浏览器: ${browser}`);
  console.log(`源用户数据目录: ${sourceUserDataDir}`);
  console.log(`配置目录: ${profile}`);
  const preparedUserDataDir = prepareExportUserDataDir(sourceUserDataDir, profile, options);
  if (options.direct) {
    console.log('读取模式: 直接读取原浏览器数据目录');
    console.log('提示: 如果浏览器提示配置目录被占用，请先完全退出该浏览器后重试。');
  } else {
    console.log(`读取模式: 使用临时配置副本 ${preparedUserDataDir.launchUserDataDir}`);
  }
  console.log('正在启动浏览器...');

  let context = null;

  try {
    context = await chromium.launchPersistentContext(
      preparedUserDataDir.launchUserDataDir,
      getLaunchOptions(browser, options),
    );
    await exportStorageStateFromContext(context, outputPath, timeoutMs);
  } finally {
    if (context) {
      await context.close();
    }
    preparedUserDataDir.cleanup();
  }
}

async function openWithLoginState(options) {
  if (!options.state) {
    throw new Error('缺少 --state <登录态文件>');
  }

  const browser = normalizeBrowser(options.browser);
  const timeoutMs = Number(options.timeout || DEFAULT_TIMEOUT_MS);
  const userDataDir = resolvePath(options['user-data-dir'] || getDefaultTargetUserDataDir(browser));
  const storageState = readLoginState(options.state);

  if (!hasStorageStateContent(storageState)) {
    throw new Error('登录态文件内容为空');
  }

  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`浏览器: ${browser}`);
  console.log(`登录态文件: ${resolvePath(options.state)}`);
  console.log(`独立用户数据目录: ${userDataDir}`);
  console.log('正在启动浏览器...');

  const context = await chromium.launchPersistentContext(
    userDataDir,
    getLaunchOptions(browser, options),
  );

  try {
    console.log('浏览器已启动，正在注入登录态...');
    const page = await getOrCreatePage(context);
    await applyStorageState(context, page, storageState);
    console.log('登录态已注入，正在打开巨量后台...');
    await page.goto(JULIANG_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log(`当前页面 URL: ${page.url()}`);

    if (isJuliangLoginUrl(page.url())) {
      console.log('登录态可能已失效或被平台风控拦截，页面仍停留在登录流程。');
      await waitForLogin(context, page, timeoutMs);
    } else {
      console.log('已使用登录态打开巨量后台。');
    }

    await waitForEnter('浏览器会保持打开。需要关闭脚本时，请按 Enter...');
  } finally {
    await context.close();
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || options.help) {
    printUsage();
    return;
  }

  if (command === 'export') {
    await exportLoginState(options);
    return;
  }

  if (command === 'open') {
    await openWithLoginState(options);
    return;
  }

  throw new Error(`不支持的命令: ${command}`);
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`执行失败: ${errorMessage}`);
  process.exitCode = 1;
});

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const figlet = require("figlet");
const moment = require("moment-timezone");
moment.tz.setDefault("Asia/Jakarta");
const { bold, red, yellow, blue, magenta, cyan, green } = require("kleur/colors");

const args = process.argv.slice(2);
const isDebug = args.includes("--debug");
const CREDENTIALS_FILE = path.join(__dirname, "cookies.json");
const CONFIG_FILE = path.join(__dirname, "config.json");

const loadConfig = () => {
  const fromEnv = process.env.CONFIG_JSON;
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv);
    } catch {
      throw new Error("Invalid CONFIG_JSON environment variable");
    }
  }
  if (!fs.existsSync(CONFIG_FILE))
    throw new Error("config.json tidak ditemukan");
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    throw new Error("Invalid config.json");
  }
};

const CONFIG = loadConfig();
if (process.env.HEADLESS !== undefined) CONFIG.headless = process.env.HEADLESS === "true";
if (process.env.TOTAL_USERS !== undefined) CONFIG.totalUsers = Number(process.env.TOTAL_USERS);
if (process.env.MESSAGE !== undefined) CONFIG.message = process.env.MESSAGE;

const BROWSER_CONFIG = {
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  headless: CONFIG.headless,
};
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  BROWSER_CONFIG.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const fetchQuote = async () => {
  try {
    const res = await fetch("https://dummyjson.com");
    const data = await res.json();
    return `"${data.quote}" — ${data.author}`;
  } catch {
    return null;
  }
};

const main = async () => {
  const banner = figlet.textSync("TikTok Streak", { font: CONFIG.bannerFont || "Standard", horizontalLayout: "default", verticalLayout: "default" });
  console.clear();
  console.log(bold(cyan(banner)));
  console.log(yellow("\n[+] Made with 🚬 and ☕ by Saturia."));
  if (CONFIG.useQuotesAPi) console.log(blue("[+] Message: Random quote (dummyjson.com)"));
  else console.log(blue("[+] Message:", CONFIG.message));
  console.log(magenta("[+] Delay:", `${CONFIG.actionDelayMs} ms\n`));
  console.log(yellow(`[+] Mode: ${isDebug ? "Debug" : "Normal"}\n`));

  let credentials;
  if (process.env.COOKIES_JSON) {
    try {
      const data = JSON.parse(process.env.COOKIES_JSON);
      credentials = Array.isArray(data) ? { cookies: data } : { cookies: [data] };
      console.log(green("[+] Cookies loaded from COOKIES_JSON env var"));
    } catch {
      throw new Error("Invalid COOKIES_JSON environment variable");
    }
  } else if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
      credentials = Array.isArray(data) ? { cookies: data } : { cookies: [data] };
      console.log(yellow("[+] Cookies loaded from cookies.json (local only)"));
    } catch {
      throw new Error("Invalid session file");
    }
  } else {
    throw new Error("Session not found. Set COOKIES_JSON env var or create cookies.json");
  }

  let browser;
  try {
    browser = await puppeteer.launch(BROWSER_CONFIG);
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...credentials.cookies);

    const url = "https://tiktok.com";
    if (isDebug) console.log(yellow(`[+] Открываем страницу: ${url}`));
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, CONFIG.pageLoadDelayMs || 5000));

    // Проверяем, авторизованы ли мы (не перекинуло ли на страницу входа)
    const currentUrl = page.url();
    const pageTitle = await page.title();
    if (isDebug) console.log(cyan(`[+] Текущий URL: ${currentUrl} | Заголовок: ${pageTitle}`));

    const hasLoginBtn = await page.evaluate(() => {
      return !!document.querySelector('[data-e2e="top-login-button"], #header-login-button');
    });
    if (hasLoginBtn) {
      throw new Error("TikTok не распознал куки (отображается кнопка Войти). Нужно обновить COOKIES_JSON!");
    }

    // Если список чатов ещё не открыт, пробуем нажать на иконку Сообщений в левом меню
    const navClicked = await page.evaluate(() => {
      const msgBtn = document.querySelector('[data-e2e="nav-messages"]') ||
                     Array.from(document.querySelectorAll('a, button, div[role="button"]')).find(el =>
                       /^(Messages|Сообщения)$/i.test(el.textContent?.trim())
                     );
      if (msgBtn) {
        msgBtn.click();
        return true;
      }
      return false;
    });
    if (navClicked && isDebug) {
      console.log(cyan("[+] Нажали на кнопку Сообщения в меню, ждём загрузку чатов..."));
      await new Promise((r) => setTimeout(r, 3000));
    }

    let success = 0, failed = 0;

    for (let i = 0; i < CONFIG.totalUsers; i++) {
      try {
        // Ищем элементы чатов разными способами (по data-index или по списку диалогов)
        const chatClicked = await page.evaluate((idx) => {
          const byIndex = document.querySelector(`div[data-index="${idx}"] [data-e2e="dm-new-conversation-item"]`) ||
                          document.querySelector(`div[data-index="${idx}"]`);
          if (byIndex) {
            byIndex.click();
            return byIndex.innerText?.split('\n')[0] || `user_${idx}`;
          }
          const items = document.querySelectorAll('[data-e2e="dm-new-conversation-item"], [class*="DivItemWrapper"], [class*="ConversationItem"]');
          if (items[idx]) {
            items[idx].click();
            return items[idx].innerText?.split('\n')[0] || `user_${idx}`;
          }
          return null;
        }, i);

        if (!chatClicked) throw new Error(`Диалог №${i + 1} не найден в списке`);

        console.log(yellow(`\n[${i + 1}/${CONFIG.totalUsers}] Отправляем сообщение: ${chatClicked}`));
        await new Promise((r) => setTimeout(r, 1500));

        const editorSelector = 'div.notranslate.public-DraftEditor-content, div[contenteditable="true"][role="textbox"], div[contenteditable="true"]';
        await page.waitForSelector(editorSelector, { timeout: 5000 });
        const editor = await page.$(editorSelector);
        if (!editor) throw new Error("Поле ввода сообщения не найдено");

        await editor.click();
        await new Promise((r) => setTimeout(r, CONFIG.afterClickDelayMs || 500));

        let message = CONFIG.message || "🔥";
        if (CONFIG.useQuotesAPi) {
          const quote = await fetchQuote();
          if (!quote) throw new Error("Gagal fetch quote");
          message = quote;
        }

        await page.keyboard.type(message, { delay: CONFIG.typeDelayMs || 50 });
        await new Promise((r) => setTimeout(r, CONFIG.afterSendDelayMs || 500));

        await page.keyboard.press("Enter");
        await new Promise((r) => setTimeout(r, CONFIG.afterSendDelayMs || 1000));

        console.log(green(`  [✓] Отправлено!`));
        success++;
      } catch (e) {
        console.log(red(`  [✗] Error: ${e.message}`));
        failed++;
      }

      if (i < CONFIG.totalUsers - 1) {
        await new Promise((r) => setTimeout(r, CONFIG.actionDelayMs || 2000));
      }
    }

    console.log(green(`\n[+] SELESAI!`));
    console.log(blue(`[+] Success: ${success}`));
    console.log(red(`[+] Failed: ${failed}\n`));
  } catch (e) {
    console.error(red("[!] Fatal error:", e.message));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
};

main();

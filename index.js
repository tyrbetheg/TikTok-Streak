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
    const res = await fetch("https://dummyjson.com/quotes/random");
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

    const url = CONFIG.targetUrl || "https://tiktok.com";
    if (isDebug) console.log(yellow(`[+] Membuka halaman: ${url}`));
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    if (isDebug) console.log(yellow("[+] Halaman loaded, tunggu UI siap..."));
    await new Promise((r) => setTimeout(r, CONFIG.pageLoadDelayMs || 5000));

    let success = 0, failed = 0;

    // Проверяем, есть ли iframe (для business-suite), иначе работаем напрямую со страницей (page)
    let targetContext = page;
    const iframe = await page.$("iframe[src*='/messages']");
    if (iframe) {
      const frame = await iframe.contentFrame();
      if (frame) {
        targetContext = frame;
        if (isDebug) console.log(cyan("[+] Переключились внутрь iframe сообщений"));
      }
    } else {
      if (isDebug) console.log(cyan("[+] Работаем напрямую со страницей сообщений (без iframe)"));
    }

    // Закрываем всплывающие окна, если есть
    try {
      await targetContext.waitForSelector("._TUXModal-wrapper", { visible: true, timeout: 3000 });
      await targetContext.evaluate(() => {
        const modal = document.querySelector("._TUXModal-wrapper");
        if (!modal) return;
        const rect = modal.getBoundingClientRect();
        const x = Math.max(1, rect.left - 10);
        const y = Math.max(1, rect.top - 10);
        document.elementFromPoint(x, y)?.click();
      });
    } catch (e) {}

    for (let i = 0; i < CONFIG.totalUsers; i++) {
      try {
        const userSelector = `div[data-index="${i}"] [data-e2e="dm-new-conversation-item"], [data-e2e="dm-new-conversation-item"]`;
        await targetContext.waitForSelector(`div[data-index="${i}"]`, { timeout: 5000 });

        const clicked = await targetContext.evaluate((idx) => {
          const item = document.querySelector(`div[data-index="${idx}"] [data-e2e="dm-new-conversation-item"]`) ||
                       document.querySelector(`div[data-index="${idx}"]`);
          if (item) {
            item.click();
            return true;
          }
          return false;
        }, i);

        if (!clicked) throw new Error(`Чат с индексом ${i} не найден`);

        const username = await targetContext.evaluate((idx) => {
          const el = document.querySelector(`div[data-index="${idx}"] [data-e2e="dm-new-conversation-nickname"]`) ||
                     document.querySelector(`div[data-index="${idx}"] p`);
          return el?.textContent?.trim() || `user${idx}`;
        }, i);

        console.log(yellow(`\n[${i + 1}/${CONFIG.totalUsers}] Mengirim pesan ke: ${username}`));
        await new Promise((r) => setTimeout(r, 1000));

        if (isDebug) console.log(yellow("  [~] Mencari editor..."));
        const editorSelector = 'div.notranslate.public-DraftEditor-content, div[contenteditable="true"][role="textbox"]';
        await targetContext.waitForSelector(editorSelector, { timeout: 5000 });
        const editor = await targetContext.$(editorSelector);
        if (!editor) throw new Error("Editor not found");

        await editor.click();
        await new Promise((r) => setTimeout(r, CONFIG.afterClickDelayMs || 500));

        let message = CONFIG.message || "🔥";
        if (CONFIG.useQuotesAPi) {
          const quote = await fetchQuote();
          if (!quote) throw new Error("Gagal fetch quote");
          message = quote;
          if (isDebug) console.log(cyan(`  [~] Quote: ${quote}`));
        }

        await page.keyboard.type(message, { delay: CONFIG.typeDelayMs || 50 });
        await new Promise((r) => setTimeout(r, CONFIG.afterSendDelayMs || 500));

        if (isDebug) console.log(blue("  [~] Mengirim pesan..."));
        await page.keyboard.press("Enter");
        await new Promise((r) => setTimeout(r, CONFIG.afterSendDelayMs || 1000));

        console.log(green(`  [✓] Terkirim!`));
        success++;
      } catch (e) {
        console.log(red(`  [✗] Error: ${e.message}`));
        failed++;
      }

      if (i < CONFIG.totalUsers - 1) {
        if (isDebug) console.log(yellow(`  [~] Tunggu ${CONFIG.actionDelayMs} ms...`));
        await new Promise((r) => setTimeout(r, CONFIG.actionDelayMs || 2000));
      }
    }

    console.log(green(`\n[+] SELESAI!`));
    console.log(blue(`[+] Success: ${success}`));
    console.log(red(`[+] Failed: ${failed}\n`));
    await new Promise((r) => setTimeout(r, CONFIG.finishDelayMs || 2000));
  } catch (e) {
    console.error(red("[!] Fatal error:", e.message));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
};

main();

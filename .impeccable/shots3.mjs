import puppeteer from "puppeteer-core";
import fs from "node:fs";

const jar = fs.readFileSync(new URL("./ui.txt", import.meta.url), "utf8");
const line = jar.split("\n").find((l) => l.includes("better-auth.session_token"));
const value = line.split("\t").pop().trim();
const token = fs.readFileSync(new URL("./token.txt", import.meta.url), "utf8").trim();

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium-browser",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

const shots = [
  { name: "r3-landing-desktop", url: "/", w: 1440, h: 1100 },
  { name: "r3-landing-mobile", url: "/", w: 390, h: 844, full: true },
  { name: "r3-dashboard-desktop", url: "/dashboard", w: 1440, h: 1200, auth: true, full: true },
  { name: "r3-dashboard-mobile", url: "/dashboard", w: 390, h: 900, auth: true, full: true },
  { name: "r3-share-desktop", url: `/s/${token}`, w: 1440, h: 900 },
  { name: "r3-share-mobile", url: `/s/${token}`, w: 390, h: 844 },
  { name: "r3-login", url: "/login", w: 1440, h: 900 },
  { name: "r3-404", url: "/s/does-not-exist", w: 1440, h: 800 },
];

for (const shot of shots) {
  // Isolated context per shot — a shared context leaked the auth cookie into
  // the login capture last round and produced a duplicate dashboard.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: shot.w, height: shot.h, deviceScaleFactor: 2 });

  if (shot.auth) {
    await context.setCookie({
      name: "better-auth.session_token", value, domain: "localhost", path: "/",
    });
  }

  await page.goto(`http://localhost:3000${shot.url}`, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1100));
  await page.screenshot({ path: `shots/${shot.name}.png`, fullPage: !!shot.full });
  console.log("captured", shot.name);
  await context.close();
}
await browser.close();

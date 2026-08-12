export const pages = Object.freeze([
  Object.freeze({
    id: "index",
    route: "/",
    aliases: ["/index.html"],
    source: "src/index.html",
    output: "index.html",
    navLabel: "本地解析",
    serviceOnly: false,
  }),
  Object.freeze({
    id: "live",
    route: "/live",
    aliases: ["/live.html"],
    source: "src/live.html",
    output: "live.html",
    navLabel: "AT 测活",
    serviceOnly: true,
    offlineLabel: "AT 测活 · 需本地服务",
    serviceTitle: "AT 测活需要通过 npm start 打开本地服务",
  }),
  Object.freeze({
    id: "subscription",
    route: "/subscription",
    aliases: ["/subscription.html"],
    source: "src/subscription.html",
    output: "subscription.html",
    navLabel: "订阅查询",
    serviceOnly: true,
    offlineLabel: "订阅查询 · 需本地服务",
    serviceTitle: "订阅查询需要通过 npm start 打开本地服务",
  }),
]);

export function getBuildPages() {
  return pages;
}

export function getNavigationPages() {
  return pages;
}

export function getPageById(id) {
  return pages.find(page => page.id === id) ?? null;
}

export function getPageByRoute(pathname) {
  const normalizedPathname = pathname || "/";
  return pages.find(page => page.route === normalizedPathname || page.aliases.includes(normalizedPathname)) ?? null;
}

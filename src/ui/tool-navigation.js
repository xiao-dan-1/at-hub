import { getNavigationPages, getPageByRoute } from "../core/pages.js";

function preventUnavailableNavigation(event) {
  event.preventDefault();
}

function inferCurrentPageId(locationRef) {
  return getPageByRoute(locationRef?.pathname ?? "/")?.id ?? "index";
}

function createNavigationLink(documentRef, page, currentPageId) {
  const link = documentRef.createElement("a");
  link.className = "tool-nav__item";
  link.textContent = page.navLabel;
  link.setAttribute("href", page.route);

  if (page.id === currentPageId) {
    link.setAttribute("aria-current", "page");
  }

  if (page.serviceOnly) {
    link.dataset.requiresLocalService = "true";
    link.dataset.serviceHref = page.route;
    link.dataset.localServiceLabel = page.navLabel;
    link.dataset.offlineLabel = page.offlineLabel ?? `${page.navLabel} · 需本地服务`;
    link.dataset.serviceTitle = page.serviceTitle ?? `${page.navLabel}需要通过 npm start 打开本地服务`;
  }

  return link;
}

function renderRegisteredNavigation(documentRef, locationRef) {
  const navigationContainers = Array.from(documentRef.querySelectorAll("[data-tool-navigation]"));
  for (const navigation of navigationContainers) {
    const currentPageId = navigation.dataset.currentPage ?? inferCurrentPageId(locationRef);
    const links = getNavigationPages().map(page => createNavigationLink(documentRef, page, currentPageId));
    navigation.replaceChildren(...links);
  }
}

export function configureToolNavigation({
  documentRef = document,
  locationRef = globalThis.location,
} = {}) {
  renderRegisteredNavigation(documentRef, locationRef);

  const serviceLinks = Array.from(documentRef.querySelectorAll("[data-requires-local-service]"));
  const isFileMode = locationRef?.protocol === "file:";

  for (const link of serviceLinks) {
    const localLabel = link.dataset.localServiceLabel ?? link.textContent?.trim() ?? "";
    const offlineLabel = link.dataset.offlineLabel ?? `${localLabel} · 需本地服务`;
    const serviceHref = link.dataset.serviceHref ?? link.getAttribute("href") ?? "/subscription";
    const serviceTitle = link.dataset.serviceTitle ?? `${localLabel}需要通过 npm start 打开本地服务`;

    if (isFileMode) {
      link.textContent = offlineLabel;
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", serviceTitle);
      link.dataset.unavailable = "true";
      link.addEventListener("click", preventUnavailableNavigation);
      continue;
    }

    link.textContent = localLabel;
    link.setAttribute("href", serviceHref);
    link.removeAttribute("aria-disabled");
    link.removeAttribute("title");
    delete link.dataset.unavailable;
  }
}

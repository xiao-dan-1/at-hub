const LOCAL_SERVICE_TITLE = "订阅查询需要通过 npm start 打开本地服务";

function preventUnavailableNavigation(event) {
  event.preventDefault();
}

export function configureToolNavigation({
  documentRef = document,
  locationRef = globalThis.location,
} = {}) {
  const serviceLinks = Array.from(documentRef.querySelectorAll("[data-requires-local-service]"));
  const isFileMode = locationRef?.protocol === "file:";

  for (const link of serviceLinks) {
    const localLabel = link.dataset.localServiceLabel ?? link.textContent?.trim() ?? "";
    const offlineLabel = link.dataset.offlineLabel ?? `${localLabel} · 需本地服务`;
    const serviceHref = link.dataset.serviceHref ?? link.getAttribute("href") ?? "/subscription";

    if (isFileMode) {
      link.textContent = offlineLabel;
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", LOCAL_SERVICE_TITLE);
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

const container = document.getElementById("home-news-headlines");

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function formatPublished(dateString) {
  const date = new Date(dateString);
  if (!dateString || Number.isNaN(date.getTime())) return "Latest update";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function renderArticles(articles, source) {
  container.replaceChildren();
  if (!articles.length) {
    addText(container, "p", "rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-300", "No football headlines are available right now.");
    return;
  }

  if (source === "sample") {
    addText(container, "p", "text-xs font-medium uppercase tracking-wide text-amber-300", "Sample headlines · Configure NEWS_API_KEY for live news");
  }
  articles.forEach((article) => {
    const card = document.createElement("article");
    card.className = "rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-emerald-500/60";
    addText(card, "p", "mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300", article.source || "Football News");
    addText(card, "h4", "font-semibold leading-snug text-white", article.title || "Football update");
    if (article.description) addText(card, "p", "mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400", article.description);
    addText(card, "p", "mt-3 text-xs text-slate-500", formatPublished(article.publishedAt));
    if (article.url) {
      try {
        const linkUrl = new URL(article.url);
        if (linkUrl.protocol === "https:" || linkUrl.protocol === "http:") {
          const link = addText(card, "a", "mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200", "Read story →");
          link.href = linkUrl.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      } catch {
        // Ignore malformed provider URLs and keep the headline text-only.
      }
    }
    container.append(card);
  });
}

async function loadHomeNews() {
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/home-news", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Could not load football news. Please check back shortly.");
    const payload = await response.json();
    if (!Array.isArray(payload.articles)) throw new Error("The news feed returned unexpected data.");
    renderArticles(payload.articles, payload.source);
  } catch (error) {
    container.replaceChildren();
    addText(container, "p", "rounded-xl border border-rose-900/70 bg-slate-900 p-5 text-slate-300", error.message);
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

loadHomeNews();

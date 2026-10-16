const container = document.getElementById("latest-football-cards");
const updatedLabel = document.getElementById("latest-football-updated");

function makeText(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatKickoff(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Kick-off time TBC";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short"
  }).format(date);
}

function renderMatches(matches) {
  container.replaceChildren();
  if (!matches.length) {
    container.append(makeText("p", "col-span-full rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-300", "No live or upcoming matches are available right now."));
    return;
  }

  matches.forEach((match) => {
    const card = document.createElement("article");
    card.className = "rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:border-emerald-500/60";
    const meta = document.createElement("div");
    meta.className = "mb-4 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400";
    meta.append(makeText("span", "truncate", match.competition));
    const status = String(match.status || "").replaceAll("_", " ");
    const live = ["IN_PLAY", "PAUSED"].includes(match.status);
    meta.append(makeText("span", live ? "shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-300" : "shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300", live ? `● ${status}` : status));
    const teams = document.createElement("div");
    teams.className = "grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center";
    teams.append(makeText("span", "text-sm font-semibold text-white sm:text-base", match.homeTeam));
    const scoreText = match.homeScore == null || match.awayScore == null ? "vs" : `${match.homeScore} – ${match.awayScore}`;
    teams.append(makeText("span", "whitespace-nowrap text-lg font-extrabold text-emerald-300", scoreText));
    teams.append(makeText("span", "text-sm font-semibold text-white sm:text-base", match.awayTeam));
    card.append(meta, teams, makeText("p", "mt-4 border-t border-slate-800 pt-3 text-center text-xs text-slate-400", formatKickoff(match.utcDate)));
    container.append(card);
  });
}

async function loadLatestMatches() {
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/home-matches", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(response.status === 503 ? "The live match feed is not configured yet." : "Could not load matches. Please try again later.");
    const data = await response.json();
    if (!Array.isArray(data.matches)) throw new Error("The match feed returned unexpected data.");
    renderMatches(data.matches);
    if (updatedLabel) updatedLabel.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  } catch (error) {
    container.replaceChildren(makeText("p", "col-span-full rounded-xl border border-rose-900/70 bg-slate-900 p-6 text-slate-300", `${error.message} Please check back shortly.`));
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

loadLatestMatches();

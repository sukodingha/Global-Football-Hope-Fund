import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, FieldPath, increment, onSnapshot, query, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const pollsContainer = document.getElementById("matchDayPolls");
let currentUser = null;
let unsubscribePolls = null;

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function isPollActive(poll) {
  const active = poll.active === true || poll.isActive === true || poll.status === "active";
  if (!active) return false;
  if (poll.endsAt?.toMillis && poll.endsAt.toMillis() <= Date.now()) return false;
  if (typeof poll.endsAt === "string" && Date.parse(poll.endsAt) <= Date.now()) return false;
  return true;
}

function normalizeOptions(poll) {
  const source = poll.options || poll.choices || [];
  const options = Array.isArray(source)
    ? source
    : Object.entries(source).map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { text: value }) }));

  return options.map((option, index) => {
    if (typeof option === "string") return { id: String(index), text: option };
    const id = String(option.id ?? option.optionId ?? index);
    return {
      id,
      text: String(option.text ?? option.label ?? option.name ?? `Option ${index + 1}`),
      legacyCount: Number(option.voteCount ?? option.count ?? option.votes) || 0
    };
  });
}

function getVoteMap(poll) {
  return poll.votes && typeof poll.votes === "object" && !Array.isArray(poll.votes)
    ? poll.votes
    : {};
}

function getVoteCount(poll, option) {
  const counts = poll.voteCounts || poll.results || {};
  const storedCount = Number(counts[option.id]);
  if (Number.isFinite(storedCount) && storedCount >= 0) return storedCount;
  const votes = Object.values(getVoteMap(poll));
  const recordedVotes = votes.filter((vote) => String(vote) === option.id).length;
  return Math.max(option.legacyCount || 0, recordedVotes);
}

function renderPollCard(pollId, poll) {
  const options = normalizeOptions(poll);
  const voteMap = getVoteMap(poll);
  const selectedOption = currentUser ? voteMap[currentUser.uid] : "";
  const hasVoted = Boolean(selectedOption) || Boolean(currentUser && poll.voterIds?.includes(currentUser.uid));
  const totalVotes = options.reduce((sum, option) => sum + getVoteCount(poll, option), 0);
  const card = document.createElement("article");
  card.className = "match-day-poll-card";
  card.dataset.pollId = pollId;

  const title = poll.question || poll.title || poll.prompt || "Match Day Poll";
  const description = poll.description ? `<p class="match-poll-description">${escapeHtml(poll.description)}</p>` : "";
  const optionsHtml = options.map((option) => {
    const count = getVoteCount(poll, option);
    const percentage = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
    const selected = String(selectedOption) === option.id;
    return `
      <div class="match-poll-option${selected ? " is-selected" : ""}">
        ${hasVoted
          ? `<div class="match-poll-result" aria-label="${percentage}% of votes"><span class="match-poll-result-fill" style="width:${percentage}%"></span></div>`
          : ""}
        <button class="match-poll-option-button" type="button" data-poll-option="${escapeHtml(option.id)}" ${hasVoted || !currentUser ? "disabled" : ""}>
          <span>${escapeHtml(option.text)}</span>
          ${hasVoted ? `<strong>${percentage}%</strong>` : ""}
        </button>
        ${hasVoted ? `<span class="match-poll-vote-count">${count} ${count === 1 ? "vote" : "votes"}</span>` : ""}
      </div>
    `;
  }).join("");

  card.innerHTML = `
    <div class="match-poll-heading">
      <span class="match-poll-kicker">MATCH DAY POLL</span>
      ${totalVotes ? `<span class="match-poll-total">${totalVotes} ${totalVotes === 1 ? "vote" : "votes"}</span>` : ""}
    </div>
    <h3>${escapeHtml(title)}</h3>
    ${description}
    <div class="match-poll-options">${optionsHtml || '<p class="match-poll-empty">This poll has no options yet.</p>'}</div>
    <p class="match-poll-status" role="status" aria-live="polite">${hasVoted ? "Your vote is in." : currentUser ? "Choose an option to vote." : "Sign in to vote in this poll."}</p>
  `;

  card.querySelectorAll("[data-poll-option]").forEach((button) => {
    button.addEventListener("click", () => castVote(pollId, button.dataset.pollOption, card));
  });
  return card;
}

function renderPolls(snapshot) {
  if (!pollsContainer) return;
  const activePolls = snapshot.docs
    .map((pollSnapshot) => ({ id: pollSnapshot.id, data: pollSnapshot.data() }))
    .filter(({ data }) => isPollActive(data));

  if (!activePolls.length) {
    pollsContainer.innerHTML = '<div class="match-day-poll-empty"><span class="match-poll-kicker">MATCH DAY POLL</span><p>No active polls right now.</p></div>';
    return;
  }

  pollsContainer.replaceChildren(...activePolls.map(({ id, data }) => renderPollCard(id, data)));
}

async function castVote(pollId, optionId, card) {
  if (!currentUser) {
    document.getElementById("authModal")?.classList.add("auth-modal--open");
    return;
  }

  const status = card.querySelector(".match-poll-status");
  const buttons = card.querySelectorAll("[data-poll-option]");
  buttons.forEach((button) => { button.disabled = true; });
  status.textContent = "Submitting your vote...";

  try {
    const pollRef = doc(db, "polls", pollId);
    await runTransaction(db, async (transaction) => {
      const pollSnapshot = await transaction.get(pollRef);
      if (!pollSnapshot.exists()) throw new Error("This poll is no longer available.");
      const poll = pollSnapshot.data();
      if (!isPollActive(poll)) throw new Error("This poll is closed.");

      const options = normalizeOptions(poll);
      if (!options.some((option) => option.id === String(optionId))) {
        throw new Error("That poll option is no longer available.");
      }

      const votes = getVoteMap(poll);
      if (votes[currentUser.uid] || poll.voterIds?.includes(currentUser.uid)) {
        throw new Error("You have already voted in this poll.");
      }

      transaction.update(
        pollRef,
        new FieldPath("votes", currentUser.uid), String(optionId),
        new FieldPath("voteCounts", String(optionId)), increment(1)
      );
    });
  } catch (error) {
    status.textContent = error.message || "Could not submit your vote. Please try again.";
    buttons.forEach((button) => { button.disabled = false; });
    console.warn("Poll vote failed:", error);
  }
}

function subscribeToPolls(user) {
  currentUser = user;
  unsubscribePolls?.();
  unsubscribePolls = null;
  if (!pollsContainer) return;
  if (!user) {
    pollsContainer.innerHTML = '<div class="match-day-poll-empty"><span class="match-poll-kicker">MATCH DAY POLL</span><p>Sign in to view and vote in active polls.</p></div>';
    return;
  }

  unsubscribePolls = onSnapshot(query(collection(db, "polls")), renderPolls, (error) => {
    console.error("Could not load match day polls:", error);
    pollsContainer.innerHTML = '<div class="match-day-poll-empty">Polls are temporarily unavailable.</div>';
  });
}

onAuthStateChanged(auth, subscribeToPolls);

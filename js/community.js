/**
 * GFHF Community Module — Friend Requests, Members, DM Chat
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, arrayUnion, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CLOUDINARY_CLOUD_NAME = "d8obkydb";
const CLOUDINARY_UPLOAD_PRESET = "football_preset";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

const postForm = document.getElementById("communityPostForm");
const postText = document.getElementById("postText");
const postInterest = document.getElementById("postInterest");
const postImage = document.getElementById("postImage");
const chatConsent = document.getElementById("chatConsent");
const communityStatus = document.getElementById("communityStatus");
const communityFeed = document.getElementById("communityFeed");
const interestFilterButtons = document.getElementById("interestFilterButtons");
const communityChatSection = document.getElementById("communityChatSection");
const communityChatList = document.getElementById("communityChatList");
const communityChatForm = document.getElementById("communityChatForm");
const chatOptOutMessage = document.getElementById("chatOptOutMessage");
const communityChatStatus = document.getElementById("communityChatStatus");
// Friend system elements
const membersList = document.getElementById("membersList");
const friendRequestsList = document.getElementById("friendRequestsList");
const friendRequestCount = document.getElementById("friendRequestCount");
const dmChatPanel = document.getElementById("dmChatPanel");
const dmChatWith = document.getElementById("dmChatWith");
const dmChatMessages = document.getElementById("dmChatMessages");
const dmChatForm = document.getElementById("dmChatForm");
const dmMessageInput = document.getElementById("dmMessageInput");

const interests = ["All", "Football", "Fundraising", "Support", "Training", "Events", "General"];
let activeInterest = "All";
let currentUser = null;
let currentUserName = "Guest";
let unsubscribeFeed = null;
let activeDMUserId = null;

// ===== FRIEND REQUEST HELPERS (localStorage-based) =====
const LS_FRIENDS_KEY = "gfhf_friends";
const LS_REQUESTS_KEY = "gfhf_friend_requests";
const LS_DM_KEY = "gfhf_dm_messages";

function getFriends() {
  try {
    return JSON.parse(localStorage.getItem(LS_FRIENDS_KEY) || "{}");
  } catch { return {}; }
}

function saveFriends(friends) {
  localStorage.setItem(LS_FRIENDS_KEY, JSON.stringify(friends));
}

function getFriendRequests() {
  try {
    return JSON.parse(localStorage.getItem(LS_REQUESTS_KEY) || "[]");
  } catch { return []; }
}

function saveFriendRequests(requests) {
  localStorage.setItem(LS_REQUESTS_KEY, JSON.stringify(requests));
}

function getDMMessages(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_DM_KEY) || "{}");
    return all[userId] || [];
  } catch { return []; }
}

function saveDMMessage(userId, message) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_DM_KEY) || "{}");
    if (!all[userId]) all[userId] = [];
    all[userId].push(message);
    localStorage.setItem(LS_DM_KEY, JSON.stringify(all));
  } catch {}
}

// Simulated member profiles
const MEMBER_PROFILES = [
  { id: "member_1", name: "Alex M.", emoji: "🙋", country: "Brazil", favTeam: "Brazil" },
  { id: "member_2", name: "Sarah K.", emoji: "🙋‍♀️", country: "England", favTeam: "Arsenal" },
  { id: "member_3", name: "Marco R.", emoji: "🤙", country: "Italy", favTeam: "Inter" },
  { id: "member_4", name: "Yuki T.", emoji: "🙆", country: "Japan", favTeam: "Barcelona" },
  { id: "member_5", name: "Emma W.", emoji: "🙌", country: "Germany", favTeam: "Bayern" },
  { id: "member_6", name: "Carlos D.", emoji: "⚡", country: "Argentina", favTeam: "Argentina" },
  { id: "member_7", name: "Aisha N.", emoji: "🌟", country: "Nigeria", favTeam: "Liverpool" },
  { id: "member_8", name: "David L.", emoji: "🔥", country: "France", favTeam: "PSG" },
  { id: "member_9", name: "Priya S.", emoji: "💫", country: "India", favTeam: "Man City" },
  { id: "member_10", name: "Omar H.", emoji: "💪", country: "Egypt", favTeam: "Liverpool" },
];

function getFriendStatus(targetId) {
  const requests = getFriendRequests();
  const friends = getFriends();
  const currentId = currentUser?.uid || "local_user";

  // Check friends list first
  if (friends[currentId] && friends[currentId].includes(targetId)) return "accepted";
  if (friends[targetId] && friends[targetId].includes(currentId)) return "accepted";

  // Sent by target to current user (incoming)
  const incoming = requests.find(r => r.from === targetId && r.to === currentId);
  if (incoming) return "pending_received";

  // Sent by current user to target (outgoing)
  const outgoing = requests.find(r => r.from === currentId && r.to === targetId);
  if (outgoing) return "pending_sent";

  return "none";
}

function renderMembers() {
  if (!membersList) return;
  membersList.innerHTML = "";
  const currentId = currentUser?.uid || "local_user";

  MEMBER_PROFILES.forEach((member) => {
    const status = getFriendStatus(member.id);
    const card = document.createElement("div");
    card.className = "member-card";

    let actionHTML = "";
    if (status === "accepted") {
      actionHTML = `<button class="mini-btn dm-btn" data-id="${member.id}" data-name="${member.name}">💬 DM</button>`;
    } else if (status === "pending_received") {
      actionHTML = `
        <button class="mini-btn accept-btn" data-id="${member.id}">✅ Accept</button>
        <button class="mini-btn secondary decline-btn" data-id="${member.id}">✕</button>
      `;
    } else if (status === "pending_sent") {
      actionHTML = `<span class="pending-label">⏳ Pending</span>`;
    } else {
      actionHTML = `<button class="mini-btn request-btn" data-id="${member.id}" data-name="${member.name}">➕ Add Friend</button>`;
    }

    card.innerHTML = `
      <div class="member-avatar">${member.emoji}</div>
      <div class="member-info">
        <strong>${member.name}</strong>
        <span class="member-meta">${member.country} • ${member.favTeam}</span>
      </div>
      <div class="member-actions">${actionHTML}</div>
    `;
    membersList.appendChild(card);
  });

  // Attach event listeners
  membersList.querySelectorAll(".request-btn").forEach(btn => {
    btn.addEventListener("click", () => sendFriendRequest(btn.dataset.id, btn.dataset.name));
  });
  membersList.querySelectorAll(".accept-btn").forEach(btn => {
    btn.addEventListener("click", () => acceptFriendRequest(btn.dataset.id));
  });
  membersList.querySelectorAll(".decline-btn").forEach(btn => {
    btn.addEventListener("click", () => declineFriendRequest(btn.dataset.id));
  });
  membersList.querySelectorAll(".dm-btn").forEach(btn => {
    btn.addEventListener("click", () => openDMChat(btn.dataset.id, btn.dataset.name));
  });
}

function sendFriendRequest(targetId, targetName) {
  const currentId = currentUser?.uid || "local_user";
  const requests = getFriendRequests();
  requests.push({
    from: currentId,
    fromName: currentUserName,
    to: targetId,
    toName: targetName,
    status: "pending",
    createdAt: new Date().toISOString()
  });
  saveFriendRequests(requests);
  renderMembers();
  renderFriendRequests();
}

function acceptFriendRequest(fromId) {
  const requests = getFriendRequests();
  const idx = requests.findIndex(r => r.from === fromId && r.to === (currentUser?.uid || "local_user"));
  if (idx === -1) return;
  requests.splice(idx, 1);
  saveFriendRequests(requests);

  // Add to friends list
  const friends = getFriends();
  const currentId = currentUser?.uid || "local_user";
  if (!friends[currentId]) friends[currentId] = [];
  if (!friends[currentId].includes(fromId)) friends[currentId].push(fromId);
  if (!friends[fromId]) friends[fromId] = [];
  if (!friends[fromId].includes(currentId)) friends[fromId].push(currentId);
  saveFriends(friends);

  renderMembers();
  renderFriendRequests();
}

function declineFriendRequest(fromId) {
  const requests = getFriendRequests();
  const idx = requests.findIndex(r => r.from === fromId && r.to === (currentUser?.uid || "local_user"));
  if (idx === -1) return;
  requests.splice(idx, 1);
  saveFriendRequests(requests);
  renderMembers();
  renderFriendRequests();
}

function renderFriendRequests() {
  if (!friendRequestsList) return;
  const currentId = currentUser?.uid || "local_user";
  const requests = getFriendRequests();
  const pendingIncoming = requests.filter(r => r.to === currentId && r.status === "pending");
  const pendingOutgoing = requests.filter(r => r.from === currentId && r.status === "pending");

  if (friendRequestCount) {
    friendRequestCount.textContent = `${pendingIncoming.length} pending`;
  }

  friendRequestsList.innerHTML = "";

  if (pendingIncoming.length === 0 && pendingOutgoing.length === 0) {
    friendRequestsList.innerHTML = '<p class="helper-text">No pending requests.</p>';
    return;
  }

  pendingIncoming.forEach(r => {
    const item = document.createElement("div");
    item.className = "friend-request-item";
    item.innerHTML = `
      <span>📩 <strong>${r.fromName}</strong> wants to connect</span>
      <div class="request-actions">
        <button class="mini-btn accept-btn" data-id="${r.from}">✅ Accept</button>
        <button class="mini-btn secondary decline-btn" data-id="${r.from}">✕</button>
      </div>
    `;
    friendRequestsList.appendChild(item);

    item.querySelector(".accept-btn").addEventListener("click", () => acceptFriendRequest(r.from));
    item.querySelector(".decline-btn").addEventListener("click", () => declineFriendRequest(r.from));
  });

  pendingOutgoing.forEach(r => {
    const item = document.createElement("div");
    item.className = "friend-request-item";
    item.innerHTML = `<span>⏳ Request sent to <strong>${r.toName}</strong></span>`;
    friendRequestsList.appendChild(item);
  });
}

function openDMChat(userId, userName) {
  if (!dmChatPanel) return;
  activeDMUserId = userId;
  dmChatPanel.hidden = false;
  if (dmChatWith) dmChatWith.textContent = `💬 Chat with ${userName}`;
  renderDMMessages();
}

function renderDMMessages() {
  if (!dmChatMessages || !activeDMUserId) return;
  const msgs = getDMMessages(activeDMUserId);
  dmChatMessages.innerHTML = "";
  if (msgs.length === 0) {
    dmChatMessages.innerHTML = '<p class="helper-text">No messages yet. Start the conversation!</p>';
    return;
  }
  msgs.forEach(msg => {
    const item = document.createElement("div");
    item.className = "chat-message";
    const isMe = (msg.from === (currentUser?.uid || "local_user"));
    item.style.marginLeft = isMe ? "20px" : "0";
    item.style.marginRight = isMe ? "0" : "20px";
    item.style.background = isMe ? "rgba(0,200,83,0.1)" : "white";
    item.innerHTML = `
      <div class="chat-author">${isMe ? "You" : msg.fromName}</div>
      <div class="chat-text">${msg.text}</div>
      <div class="chat-time">${new Date(msg.createdAt).toLocaleTimeString()}</div>
    `;
    dmChatMessages.appendChild(item);
  });
  dmChatMessages.scrollTop = dmChatMessages.scrollHeight;
}

if (dmChatForm) {
  dmChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeDMUserId || !dmMessageInput) return;
    const text = dmMessageInput.value.trim();
    if (!text) return;
    saveDMMessage(activeDMUserId, {
      from: currentUser?.uid || "local_user",
      fromName: currentUserName,
      text,
      createdAt: new Date().toISOString()
    });
    dmMessageInput.value = "";
    renderDMMessages();
  });
}

// ===== END FRIEND SYSTEM =====

function showStatus(message, type = "success") {
  if (!communityStatus) return;
  communityStatus.textContent = message;
  communityStatus.className = `message ${type}`;
}

function createButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `btn tag-button ${activeInterest === label ? "active" : ""}`;
  button.addEventListener("click", () => {
    activeInterest = label;
    renderFilterButtons();
    loadCommunityFeed();
  });
  return button;
}

function renderFilterButtons() {
  if (!interestFilterButtons) return;
  interestFilterButtons.innerHTML = "";
  interests.forEach((interest) => {
    const button = createButton(interest);
    interestFilterButtons.appendChild(button);
  });
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function createPostCard(post) {
  const card = document.createElement("div");
  card.className = "card post-card";

  const header = document.createElement("div");
  header.className = "post-header";
  header.innerHTML = `
    <div>
      <strong>${post.authorName || "Anonymous"}</strong>
      <div class="post-meta">${post.interest || "General"} · ${formatDate(post.createdAt?.toMillis ? post.createdAt.toMillis() : post.createdAt)}</div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "post-body";
  const bodyText = document.createElement("p");
  bodyText.textContent = post.text || "";
  body.appendChild(bodyText);

  if (post.imageUrl) {
    const figure = document.createElement("figure");
    figure.className = "post-image-wrap";
    const img = document.createElement("img");
    img.src = post.imageUrl;
    img.alt = "Community post image";
    figure.appendChild(img);
    body.appendChild(figure);
  }

  // Like/Agree button
  const likeSection = document.createElement("div");
  likeSection.className = "post-like-section";
  const likeBtn = document.createElement("button");
  likeBtn.className = "like-btn";
  const likeCount = post.likes?.length || 0;
  likeBtn.innerHTML = `👍 Agree (${likeCount})`;
  likeBtn.addEventListener("click", async () => {
    if (!currentUser) {
      showStatus("Sign in to agree.", "error");
      return;
    }
    try {
      const postRef = doc(db, "posts", post.id);
      const snap = await getDoc(postRef);
      const currentLikes = snap.data()?.likes || [];
      if (currentLikes.includes(currentUser.uid)) {
        // Unlike: remove
        await updateDoc(postRef, {
          likes: currentLikes.filter(id => id !== currentUser.uid)
        });
      } else {
        await updateDoc(postRef, {
          likes: arrayUnion(currentUser.uid)
        });
      }
    } catch (error) {
      console.error("Like error:", error);
    }
  });
  likeSection.appendChild(likeBtn);
  body.appendChild(likeSection);

  const commentsSection = document.createElement("div");
  commentsSection.className = "comments-section";
  const commentsHeader = document.createElement("div");
  commentsHeader.className = "comments-header";
  commentsHeader.innerHTML = `
      <strong>Comments</strong>
      <span>${(post.comments || []).length} replies</span>
    `;
  commentsSection.appendChild(commentsHeader);
  const commentsList = document.createElement("div");
  commentsList.className = "comments-list";
  (post.comments || []).forEach((comment) => {
    const commentItem = document.createElement("div");
    commentItem.className = "comment-item";
    const author = document.createElement("strong");
    author.textContent = comment.authorName || "Guest";
    const commentText = document.createElement("p");
    commentText.textContent = comment.text || "";
    commentItem.appendChild(author);
    commentItem.appendChild(commentText);
    commentsList.appendChild(commentItem);
  });
  commentsSection.appendChild(commentsList);

  const commentForm = document.createElement("form");
  commentForm.className = "comment-form";
  commentForm.innerHTML = `
    <label>Reply safely</label>
    <input type="text" name="commentText" placeholder="Write a comment..." required>
    <button type="submit" class="btn">Post</button>
  `;

  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      showStatus("You must be logged in to comment.", "error");
      return;
    }

    const text = event.target.commentText.value.trim();
    if (!text) return;

    try {
      const postRef = doc(db, "posts", post.id);
      await updateDoc(postRef, {
        comments: arrayUnion({
          authorId: currentUser.uid,
          authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "Member",
          text,
          createdAt: serverTimestamp()
        })
      });
      event.target.reset();
      showStatus("Comment added.", "success");
    } catch (error) {
      console.error(error);
      showStatus("Failed to add comment.", "error");
    }
  });

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(commentsSection);
  card.appendChild(commentForm);
  return card;
}

async function loadCommunityFeed() {
  if (!communityFeed) return;
  communityFeed.innerHTML = "<div class='card'><p>Loading posts...</p></div>";

  const postsQuery = activeInterest === "All"
    ? query(collection(db, "posts"), orderBy("createdAt", "desc"))
    : query(collection(db, "posts"), where("interest", "==", activeInterest), orderBy("createdAt", "desc"));

  if (unsubscribeFeed) {
    unsubscribeFeed();
  }

  unsubscribeFeed = onSnapshot(postsQuery, (snapshot) => {
    const posts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    communityFeed.innerHTML = "";

    if (!posts.length) {
      communityFeed.innerHTML = "<div class='card'><p>No posts are available for this category yet.</p></div>";
      return;
    }

    posts.forEach((post) => {
      const card = createPostCard(post);
      communityFeed.appendChild(card);
    });
  }, (error) => {
    console.error(error);
    communityFeed.innerHTML = "<div class='card'><p>Unable to load feed.</p></div>";
  });
}

function setChatVisibility() {
  const hasConsent = chatConsent?.checked;
  communityChatSection?.classList.toggle("hidden", !hasConsent);
  if (chatOptOutMessage) {
    chatOptOutMessage.hidden = hasConsent;
  }
}

async function uploadImage(file) {
  if (!file) return null;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed: ${errorText}`);
  }

  const data = await response.json();
  return data.secure_url || null;
}

function hideAppSplash() {
  const splash = document.getElementById("appSplash");
  if (splash) {
    splash.classList.add("hidden");
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  currentUserName = user?.displayName || user?.email?.split("@")[0] || "Member";
  setChatVisibility();
  hideAppSplash();
  renderMembers();
  renderFriendRequests();
});

window.addEventListener("load", hideAppSplash);

if (postForm) {
  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      showStatus("Please sign in before posting.", "error");
      return;
    }

    const text = postText.value.trim();
    const interest = postInterest.value;
    const consent = chatConsent.checked;

    if (!text) {
      showStatus("Please enter a post message.", "error");
      return;
    }

    try {
      showStatus("Publishing your post...", "success");
      const imageUrl = await uploadImage(postImage.files[0]);
      await addDoc(collection(db, "posts"), {
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "Member",
        text,
        interest,
        imageUrl: imageUrl || null,
        comments: [],
        likes: [],
        chatConsent: consent,
        createdAt: serverTimestamp()
      });

      postForm.reset();
      setChatVisibility();
      showStatus("Post published successfully.", "success");
    } catch (error) {
      console.error(error);
      showStatus("Unable to publish post.", "error");
    }
  });
}

if (communityChatForm) {
  communityChatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      if (communityChatStatus) communityChatStatus.textContent = "Login to send chat messages.";
      return;
    }

    const text = event.target.chatMessage.value.trim();
    if (!text) return;

    try {
      await addDoc(collection(db, "communityChat"), {
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "Member",
        text,
        createdAt: serverTimestamp()
      });
      event.target.reset();
    } catch (error) {
      console.error(error);
      if (communityChatStatus) communityChatStatus.textContent = "Unable to send chat message.";
    }
  });
}

function renderChatMessage(message) {
  const item = document.createElement("div");
  item.className = "chat-message";
  const author = document.createElement("div");
  author.className = "chat-author";
  author.textContent = message.authorName || "Guest";
  const text = document.createElement("div");
  text.className = "chat-text";
  text.textContent = message.text || "";
  const time = document.createElement("div");
  time.className = "chat-time";
  time.textContent = formatDate(message.createdAt?.toMillis ? message.createdAt.toMillis() : message.createdAt);
  item.appendChild(author);
  item.appendChild(text);
  item.appendChild(time);
  return item;
}

function listenToChat() {
  const chatQuery = query(collection(db, "communityChat"), orderBy("createdAt", "asc"));
  onSnapshot(chatQuery, (snapshot) => {
    if (!communityChatList) return;
    communityChatList.innerHTML = "";
    snapshot.docs.forEach((docSnap) => {
      const message = docSnap.data();
      const messageItem = renderChatMessage(message);
      communityChatList.appendChild(messageItem);
    });
  }, (error) => {
    console.error(error);
  });
}

renderFilterButtons();
loadCommunityFeed();
listenToChat();
setChatVisibility();
renderMembers();
renderFriendRequests();


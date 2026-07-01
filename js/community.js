import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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

const storage = getStorage();

const interests = ["All", "Football", "Fundraising", "Support", "Training", "Events", "General"];
let activeInterest = "All";
let currentUser = null;
let unsubscribeFeed = null;

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
      <div class="post-meta">${post.interest} · ${formatDate(post.createdAt?.toMillis ? post.createdAt.toMillis() : post.createdAt)}</div>
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

  const storageRef = ref(storage, `community-posts/${Date.now()}-${file.name}`);
  const snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  setChatVisibility();
});

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

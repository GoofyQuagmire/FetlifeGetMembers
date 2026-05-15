(async () => {
  // ── Configuration ──────────────────────────────────────────────
  const CONFIG = {
    baseUrl:              "https://fetlife.com/p/COUNTRY/STATE/CITY/kinksters",
    urlPostfix:           "?page=",
    delay:                10000,
    maxPages:             100,
    startPage:            1,
    maxResults:           500,
    stopOnError:          false,
    maxConsecutiveErrors: 3,
    filters: {
      genders: [],   // e.g. ["F"], ["M"], ["NB"] or [] to accept all
      minAge:  18,
      maxAge:  99,
    },
  };

  const parser   = new DOMParser();
  const seenUrls = new Set();
  const allUsers = [];

  // ── Utilities ─────────────────────────────────────────────────
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&",  "&amp;")
      .replaceAll("<",  "&lt;")
      .replaceAll(">",  "&gt;")
      .replaceAll('"',  "&quot;")
      .replaceAll("'",  "&#039;");
  }

  async function hydrateAvatars(users) {
    await Promise.all(users.map(async user => {
      const src = user.avatar || user.avatarSmallUrl || user.avatarUrl;
      if (!src) return;

      try {
        const res = await fetch(src, { credentials: "include" });
        if (!res.ok) return;

        const blob = await res.blob();
        user.avatarBlobUrl = URL.createObjectURL(blob);
      } catch (e) {
        console.warn("Avatar fetch failed:", user.username, e);
        user.avatarBlobUrl = null;
      }
    }));
  }

  async function fetchPage(pageNumber) {
    const url      = CONFIG.baseUrl + CONFIG.urlPostfix + pageNumber;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} on page ${pageNumber}`);
    return response.text();
  }

  // ── Invalid page detection ───────────────────────────────────────
  function isValidPage(htmlDoc) {
    const title               = (htmlDoc.title ?? "").toLowerCase();
    const invalidTitleSignals = [
      "sign in", "log in", "login", "captcha", "access denied", "challenge",
    ];
    if (invalidTitleSignals.some(signal => title.includes(signal))) return false;

    const hasLoginForm = !!htmlDoc.querySelector(
      "form[action*='login'], form[action*='sign_in'], input[type='password'], input[name='password']"
    );
    if (hasLoginForm) return false;

    return true;
  }

  // ── Robust extraction ───────────────────────────────────────────
  function extractUsers(html) {
    const htmlDoc = parser.parseFromString(html, "text/html");

    if (!isValidPage(htmlDoc)) {
      throw new Error("Invalid page detected (login / anti-bot / challenge)");
    }

    const propsElements = Array.from(htmlDoc.querySelectorAll("[data-props]"));

    for (const el of propsElements) {
      try {
        const parsed = JSON.parse(el.dataset.props);
        if (Array.isArray(parsed?.users)) return parsed.users;
      } catch {
        continue;
      }
    }

    return [];
  }

  // ── Parse identity ───────────────────────────────────────────────
  function parseIdentity(identity) {
    if (typeof identity !== "string") return { age: null, gender: null, role: null };
    const match = identity.match(/^(\d+)([A-Za-z]+)\s*(.*)/);
    if (!match) return { age: null, gender: null, role: identity.trim() };
    return {
      age:    parseInt(match[1], 10),
      gender: match[2].toUpperCase(),
      role:   match[3].trim() || null,
    };
  }

  // ── Validation, filtering and normalization ────────────────────────
  function buildUserObject(person) {
    if (!person || typeof person !== "object") return null;

    const profileUrl = typeof person.profileUrl === "string" ? person.profileUrl.trim() : "";
    const username   = typeof person.nickname === "string" ? person.nickname.trim() : "";

    if (!profileUrl || !username) return null;

    const link = profileUrl.startsWith("http")
      ? profileUrl
      : "https://fetlife.com" + profileUrl;

    if (seenUrls.has(link)) return null;
    seenUrls.add(link);

    const { age, gender, role } = parseIdentity(person.identity);

    if (CONFIG.filters.genders.length > 0 && !CONFIG.filters.genders.includes(gender)) return null;
    if (age !== null && age < CONFIG.filters.minAge) return null;
    if (age !== null && age > CONFIG.filters.maxAge) return null;

    return {
      label: typeof person.identity === "string" && person.identity.trim()
        ? person.identity.trim()
        : "unknown",
      link,
      username,
      location: typeof person.location === "string" && person.location.trim()
        ? person.location.trim()
        : "unknown",
      age: age ?? "unknown",
      gender: gender ?? "unknown",
      role: role ?? "unknown",
      avatarSmallUrl: typeof person.avatarSmallUrl === "string" ? person.avatarSmallUrl.trim() : null,
      avatarUrl: typeof person.avatarUrl === "string" ? person.avatarUrl.trim() : null,
      avatar:
        typeof person.avatarSmallUrl === "string" && person.avatarSmallUrl.trim()
          ? person.avatarSmallUrl.trim()
          : typeof person.avatarUrl === "string" && person.avatarUrl.trim()
            ? person.avatarUrl.trim()
            : null,
      avatarBlobUrl: null,
    };
  }

  // ── HTML gallery generation ────────────────────────────────────────
  function getInitialLetter(username) {
    if (!username || typeof username !== "string") return "?";
    const trimmed = username.trim();
    if (trimmed.length === 0) return "?";
    return trimmed[0].toUpperCase();
  }

  function openGallery(users) {
    const cards = users.map(u => {
      const safeUsername = escapeHtml(u.username);
      const safeLocation = escapeHtml(u.location);
      const safeRole     = escapeHtml(u.role);
      const safeGender   = escapeHtml(u.gender);
      const safeAge      = escapeHtml(u.age);
      const safeLink     = escapeHtml(u.link);
      const safeAvatar   = escapeHtml(u.avatarBlobUrl ?? "");

      const hasAvatar = !!u.avatarBlobUrl;
      const initial   = escapeHtml(getInitialLetter(u.username));
      const tooltip   = hasAvatar
        ? `Avatar of ${safeUsername}`
        : `Avatar unavailable (CORS) — ${safeUsername}`;

      let avatarContent;
      if (hasAvatar) {
        avatarContent = `
          <div class="avatar" style="background-image:url('${safeAvatar}')" title="${tooltip}"></div>
        `;
      } else {
        avatarContent = `
          <div class="avatar-placeholder" title="${tooltip}">
            <span class="initial">${initial}</span>
          </div>
        `;
      }

      return `
        <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="card">
          ${avatarContent}
          <div class="info">
            <div class="username">${safeUsername}</div>
            <div class="meta">${safeAge} · ${safeGender} · ${safeRole}</div>
            <div class="location">${safeLocation}</div>
            <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="view-profile-btn">View profile</a>
          </div>
        </a>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FetLife Results — ${users.length} profiles</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #1a1a2e;
      color: #eee;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 24px;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 20px;
      color: #c084fc;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }

    .card {
      background: #16213e;
      border-radius: 12px;
      overflow: hidden;
      text-decoration: none;
      color: inherit;
      transition: transform 0.15s, box-shadow 0.15s;
      display: flex;
      flex-direction: column;
    }

    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 24px rgba(192, 132, 252, 0.2);
    }

    .avatar {
      width: 100%;
      aspect-ratio: 1;
      background-size: cover;
      background-position: center;
      background-color: #0f3460;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .avatar-placeholder {
      width: 100%;
      aspect-ratio: 1;
      background: linear-gradient(135deg, #6b4c9a, #3b82f6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
      color: #fff;
      position: relative;
      cursor: pointer;
    }

    .avatar-placeholder .initial {
      font-size: 48px;
      font-weight: 700;
      text-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }

    .info {
      padding: 10px 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .username {
      font-size: 14px;
      font-weight: 700;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta {
      font-size: 12px;
      color: #c084fc;
      font-weight: 500;
    }

    .location {
      font-size: 11px;
      color: #94a3b8;
    }

    .view-profile-btn {
      display: inline-block;
      margin-top: 6px;
      padding: 6px 10px;
      background: #c084fc;
      color: #1a1a2e;
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 6px;
      text-align: center;
      transition: background 0.15s;
    }

    .view-profile-btn:hover {
      background: #a78bfa;
    }
  </style>
</head>
<body>
  <h1>${users.length} profiles found</h1>
  <div class="grid">${cards}</div>
</body>
</html>`;

    const blob    = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    const newTab  = window.open(blobUrl, "_blank");

    if (!newTab) {
      console.warn("Popup blocked. A button has been added at the bottom of the page.");

      const btn = document.createElement("a");
      btn.href        = blobUrl;
      btn.target      = "_blank";
      btn.rel         = "noopener noreferrer";
      btn.textContent = `🔗 Open gallery (${users.length} profiles)`;
      btn.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        background: #c084fc;
        color: #1a1a2e;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 700;
        padding: 12px 20px;
        border-radius: 10px;
        text-decoration: none;
        box-shadow: 0 4px 16px rgba(192, 132, 252, 0.4);
      `;

      btn.addEventListener("click", () => {
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          btn.remove();
        }, 30000);
      });

      document.body.appendChild(btn);
    } else {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }
  }

  // ── Main loop ────────────────────────────────────────────────────
  let totalErrors       = 0;
  let consecutiveErrors = 0;

  for (let i = CONFIG.startPage; i <= CONFIG.maxPages; i++) {
    if (allUsers.length >= CONFIG.maxResults) {
      console.log(`Limit of ${CONFIG.maxResults} profiles reached. Stopping.`);
      break;
    }

    console.log(`[Page ${i}] Fetching...`);

    let users;
    try {
      const html = await fetchPage(i);
      users      = extractUsers(html);
      console.log("Raw users count:", users.length);
      console.log("First raw user:", users[0]);
      consecutiveErrors = 0;
    } catch (err) {
      totalErrors++;
      consecutiveErrors++;
      console.error(`[Page ${i}] Error: ${err.message} (consecutive: ${consecutiveErrors})`);

      if (CONFIG.stopOnError || consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
        console.warn(`Stopping after ${consecutiveErrors} consecutive error(s).`);
        break;
      }

      await sleep(CONFIG.delay);
      continue;
    }

    if (users.length === 0) {
      console.log(`[Page ${i}] No users. End of list.`);
      break;
    }

    for (const person of users) {
      if (allUsers.length >= CONFIG.maxResults) break;
      const user = buildUserObject(person);
      if (user) allUsers.push(user);
    }

    console.log(`[Page ${i}] OK — ${allUsers.length} profiles collected so far.`);

    const hasMore = i < CONFIG.maxPages && allUsers.length < CONFIG.maxResults;
    if (hasMore) await sleep(CONFIG.delay);
  }

  // ── Results ────────────────────────────────────────────────────
  console.log(`\nDone. ${allUsers.length} unique profiles. ${totalErrors} error(s) total.`);
  await hydrateAvatars(allUsers);
  openGallery(allUsers);
  return allUsers;

})().then(results => {
  window._fetchedUsers = results;
  console.log("Data available in window._fetchedUsers");
});

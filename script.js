(async () => {
  // ── Configuration ──────────────────────────────────────────────
  const CONFIG = {
    baseUrl:              "htt",
    urlPostfix:           "?page=",
    delay:                10000,
    maxPages:             100,
    startPage:            1,
    maxResults:           500,
    stopOnError:          false,
    maxConsecutiveErrors: 3,
    filters: {
      genders: [],   // ex: ["F"] ou ["F", "NB"] ou [] pour tout accepter
      minAge:  18,
      maxAge:  99,
    },
  };

  const parser   = new DOMParser();
  const seenUrls = new Set();
  const allUsers = [];

  // ── Utilitaires ─────────────────────────────────────────────────
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function fetchPage(pageNumber) {
    const url      = CONFIG.baseUrl + CONFIG.urlPostfix + pageNumber;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} on page ${pageNumber}`);
    return response.text();
  }

  // ── Détection de page invalide ───────────────────────────────────
  function isValidPage(htmlDoc) {
    const title             = (htmlDoc.title ?? "").toLowerCase();
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

  // ── Extraction robuste : inspecte tous les data-props ───────────
  function extractUsers(html) {
    const htmlDoc = parser.parseFromString(html, "text/html");

    if (!isValidPage(htmlDoc)) {
      throw new Error("Page invalide détectée (login / anti-bot / challenge)");
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

  // ── Extraction de l'âge, du genre et du rôle depuis identity ────
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

  // ── Validation, filtrage et normalisation d'un profil ────────────
  function buildUserObject(person) {
    if (!person || typeof person !== "object") return null;

    const profileUrl = typeof person.profileUrl === "string" ? person.profileUrl.trim() : "";
    const username   = typeof person.nickname   === "string" ? person.nickname.trim()   : "";

    if (!profileUrl.startsWith("/") || !username) return null;

    const link = "https://fetlife.com" + profileUrl;
    if (seenUrls.has(link)) return null;
    seenUrls.add(link);

    const { age, gender, role } = parseIdentity(person.identity);

    // Filtre par genre
    if (CONFIG.filters.genders.length > 0 && !CONFIG.filters.genders.includes(gender)) return null;

    // Filtre par âge
    if (age !== null && age < CONFIG.filters.minAge) return null;
    if (age !== null && age > CONFIG.filters.maxAge) return null;

    return {
      label:    typeof person.identity === "string" && person.identity.trim()
                  ? person.identity.trim()
                  : "unknown",
      link,
      username,
      location: typeof person.location === "string" && person.location.trim()
                  ? person.location.trim()
                  : "unknown",
      age:      age ?? "unknown",
      gender:   gender ?? "unknown",
      role:     role ?? "unknown",
    };
  }

  // ── Boucle principale ────────────────────────────────────────────
  let totalErrors       = 0;
  let consecutiveErrors = 0;

  for (let i = CONFIG.startPage; i <= CONFIG.maxPages; i++) {
    if (allUsers.length >= CONFIG.maxResults) {
      console.log(`Limite de ${CONFIG.maxResults} profils atteinte. Arrêt.`);
      break;
    }

    console.log(`[Page ${i}] Fetching...`);

    let users;
    try {
      const html = await fetchPage(i);
      users      = extractUsers(html);
      consecutiveErrors = 0;
    } catch (err) {
      totalErrors++;
      consecutiveErrors++;
      console.error(`[Page ${i}] Erreur : ${err.message} (consécutives : ${consecutiveErrors})`);

      if (CONFIG.stopOnError || consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
        console.warn(`Arrêt après ${consecutiveErrors} erreur(s) consécutive(s).`);
        break;
      }

      await sleep(CONFIG.delay);
      continue;
    }

    if (users.length === 0) {
      console.log(`[Page ${i}] Aucun utilisateur. Fin de la liste.`);
      break;
    }

    for (const person of users) {
      if (allUsers.length >= CONFIG.maxResults) break;
      const user = buildUserObject(person);
      if (user) allUsers.push(user);
    }

    console.log(`[Page ${i}] OK — ${allUsers.length} profils collectés au total.`);

    const hasMore = i < CONFIG.maxPages && allUsers.length < CONFIG.maxResults;
    if (hasMore) await sleep(CONFIG.delay);
  }

  // ── Résultats ────────────────────────────────────────────────────
  console.log(`\nTerminé. ${allUsers.length} profils uniques. ${totalErrors} erreur(s) au total.`);
  console.table(allUsers.slice(0, 10));
  return allUsers;

})().then(results => {
  window._fetchedUsers = results;
  console.log("Données disponibles dans window._fetchedUsers");
});

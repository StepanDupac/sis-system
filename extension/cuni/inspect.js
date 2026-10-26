// This function is self-contained so Chrome can inject it in an isolated world.
// It reads DOM structure only. It never clicks, submits, fetches, or reads cookies.
export function inspectCuniPage() {
  const normalize = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const page = new URL(location.href);
  if (page.origin !== "https://is.cuni.cz" || page.username || page.password || !page.pathname.startsWith("/studium/")) return { status: "wrong_site" };
  const safeName = (value) => /^[a-zA-Z_][a-zA-Z0-9_.:\[\]-]{0,79}$/.test(value || "") ? value : "[vynecháno]";
  function urlShape(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== page.origin || !url.pathname.startsWith("/studium/")) return null;
      return { path: url.pathname, parameterNames: [...new Set(url.searchParams.keys())].slice(0, 30).map(safeName).sort() };
    } catch { return null; }
  }
  const knownLabels = new Map([
    ["zapsat", "Zapsat"], ["zapsane", "Zapsané"], ["zapsani", "Zapsaní"],
    ["zobrazit terminy", "Zobrazit termíny"], ["zobraz", "Zobraz"], ["zobrazit", "Zobrazit"],
    ["urcit", "Určit"], ["detail", "Detail"], ["podrobnosti", "Podrobnosti"],
    ["skrtnout", "Škrtnout"], ["hlidat", "Hlídat"], ["hlidani", "Hlídání"],
    ["predmety", "Předměty"], ["ucitel", "Učitel"], ["pracoviste", "Pracoviště"],
    ["anketa", "Anketa"], ["prihlasit se", "Přihlásit se"], ["odhlasit se", "Odhlásit se"],
  ]);
  const controls = [];
  for (const node of document.querySelectorAll("a, button, input[type=submit], input[type=button]")) {
    const rawLabel = node.matches("input") ? node.value : node.textContent;
    const label = knownLabels.get(normalize(rawLabel));
    if (!label) continue;
    const form = node.form || node.closest("form");
    controls.push({
      tag: node.tagName.toLowerCase(), label,
      name: node.getAttribute("name") ? safeName(node.getAttribute("name")) : null,
      disabled: Boolean(node.disabled), hasInlineHandler: node.hasAttribute("onclick"),
      target: urlShape(node.getAttribute("href") || node.getAttribute("formaction") || form?.getAttribute("action") || ""),
    });
    if (controls.length >= 100) break;
  }
  const forms = [...document.forms].slice(0, 20).map((form) => ({
    method: form.method.toUpperCase(), target: urlShape(form.getAttribute("action") || ""),
    fields: [...form.elements].slice(0, 100).map((field) => ({
      tag: field.tagName.toLowerCase(), type: field.type || null,
      name: safeName(field.name), disabled: Boolean(field.disabled),
      // Never export ANY field value, selected option, token or textarea text.
    })),
  }));
  const headers = new Map([
    ["datum", "datum"], ["hodina", "hodina"], ["cas", "čas"], ["volno", "volno"],
    ["kapacita", "kapacita"], ["zapis od", "zápis od"], ["zapis do", "zápis do"],
    ["skrt do", "škrt do"], ["predmet", "předmět"], ["kod", "kód"], ["kod predmetu", "kód předmětu"],
    ["ucitel", "učitel"], ["mistnost", "místnost"], ["misto", "místo"], ["poznamka", "poznámka"],
    ["termin", "termín"], ["typ", "typ"],
  ]);
  const examTitle = normalize(document.title).includes("terminy zkousek");
  const examNavigation = controls.some((control) => control.label === "Zapsané") && controls.some((control) => control.label === "Zapsat");
  const tables = [];
  for (const table of document.querySelectorAll("table")) {
    const rows = [...table.rows];
    const recognized = rows.slice(0, 3).map((row) => [...row.cells].map((cell) => headers.get(normalize(cell.textContent)) || null));
    const columns = recognized.sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0] || [];
    if (columns.filter(Boolean).length < 2) continue;
    const dateExamples = [];
    for (const row of (examTitle || examNavigation ? rows.slice(1, 6) : [])) {
      // Dates/capacity are useful for parsing. Names, grades and whole row text
      // deliberately never leave the page.
      const cells = [...row.cells];
      const date = cells.filter((_, index) => columns[index] === "datum").map((cell) => cell.textContent.match(/\b\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\b/)?.[0]).find(Boolean);
      const time = cells.filter((_, index) => ["hodina", "čas"].includes(columns[index])).map((cell) => cell.textContent.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0]).find(Boolean);
      if (date || time) dateExamples.push({ date: date || null, time: time || null });
    }
    tables.push({ columns, rowCount: rows.length, dateExamples });
    if (tables.length >= 20) break;
  }
  const loginLink = [...document.querySelectorAll("a")].some((link) => normalize(link.textContent) === "prihlasit se");
  const loggedOut = Boolean(document.querySelector("input[type=password]")) || loginLink;
  return {
    schemaVersion: 1, site: "SIS Univerzity Karlovy", source: urlShape(location.href),
    status: loggedOut ? "login_required" : examTitle || examNavigation ? "exam_page" : "other_page",
    sessionVerified: false, registrationEnabled: false,
    controls, forms, tables,
    privacy: "Bez hesel, cookies, hodnot formulářů, parametrů URL a celého HTML. Obsahuje pouze strukturu ovládání a ukázková data termínů.",
  };
}

export function isCuniStudyUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://is.cuni.cz" && !url.username && !url.password && url.pathname.startsWith("/studium/");
  } catch { return false; }
}

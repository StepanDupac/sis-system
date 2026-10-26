const sourceTabValue = new URL(location.href).searchParams.get("sisTab");
const sourceTab = sourceTabValue && /^\d+$/.test(sourceTabValue) ? Number(sourceTabValue) : null;
const button = document.querySelector("#inspect-cuni");
const result = document.querySelector("#cuni-result");
const download = document.querySelector("#download-cuni");
let report = null;

const messages = {
  missing_tab: "Otevřete v SIS stránku s termíny a přímo v její záložce klikněte na ikonu rozšíření Termín. Tím se obě záložky propojí.",
  wrong_site: "Propojená záložka už není na is.cuni.cz/studium/. Vraťte se na stránku s termíny a znovu klikněte na ikonu Termín.",
  unavailable: "Stránku se nepodařilo přečíst. Nechte SIS otevřený a klikněte na ikonu Termín přímo v jeho záložce.",
  login_required: "Stránka žádá přihlášení. Přihlaste se v SIS, otevřete termíny zkoušky a znovu načtěte stránku.",
  other_page: "Stránka byla přečtena, ale nerozpoznal jsem seznam termínů. Otevřete modul Termíny zkoušek – přihlašování. Přehled může pomoci ověřit odlišné zobrazení.",
  exam_page: "Struktura stránky s termíny byla načtena. Uložte přehled a předejte jej autorovi k dokončení napojení. Skutečný zápis zatím není aktivní.",
};
button.addEventListener("click", async () => {
  if (sourceTab === null) { result.textContent = messages.missing_tab; result.hidden = false; return; }
  button.disabled = true;
  download.disabled = true;
  document.querySelector("#cuni-details").hidden = true;
  report = null;
  try {
    report = await chrome.runtime.sendMessage({ type: "inspect-cuni", tabId: sourceTab });
    const status = report?.status || "unavailable";
    result.textContent = messages[status] || messages.unavailable;
    result.hidden = false;
    if (report?.schemaVersion === 1) {
      document.querySelector("#cuni-report").textContent = JSON.stringify(report, null, 2);
      document.querySelector("#cuni-details").hidden = false;
      download.disabled = false;
    }
  } catch { result.textContent = messages.unavailable; result.hidden = false; }
  finally { button.disabled = false; }
});
download.addEventListener("click", () => {
  if (report?.schemaVersion !== 1) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "sis-uk-struktura.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

export const hasCuniSourceTab = sourceTab !== null;

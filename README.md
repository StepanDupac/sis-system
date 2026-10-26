# Termín / SIS Executor

České rozšíření pro Chrome: pořadí termínů, odpočet, automatický přechod na náhradní termín, ověření výsledku a záznam průběhu.

**Stav verze 0.2: funkční trénink a čtení struktury stránky SIS Univerzity Karlovy. Skutečný zápis zatím není implementován.** Cílový systém je `https://is.cuni.cz/studium/`. Ve zdejším Chrome se zobrazilo přihlášení CAS bez aktivní studentské relace. Pro dokončení chybí přihlášená stránka s termíny a ověřené chování registračních požadavků. Manifest blokuje síťová spojení stránky rozšíření (`connect-src 'none'`).

Pro uživatelku: [krátký návod](NAVOD.md). Návod je také součástí rozšíření v `extension/manual.html`.

## Co funguje

- Česká obrazovka s volbou termínů, jejich pořadím a nastavením času v místním časovém pásmu.
- Souběžná příprava v tréninku: ověření ukázkové relace a načtení termínů.
- Jeden koordinovaný zápis; okamžitý přechod na náhradní termín po definitivním odmítnutí.
- Omezené opakování při neotevřeném zápisu a čekání podle `retryAfterMs`.
- Ověření zápisu i po ztracené odpovědi. Nejasný výsledek zastaví další zápisy.
- Zámek mezi záložkami a trvalý záznam nevyřešeného požadavku před odesláním.
- Stop, místní uložení nastavení, export průběhu a žádost o zachování bdělého počítače během běhu.
- Sedm tréninkových scénářů, bez přihlášení nebo sítě.
- Volitelné čtení struktury stránky SIS přes ikonu rozšíření v dané záložce. Neukládají se cookies, hodnoty polí, hodnoty parametrů URL ani celé HTML. Výstup slouží k dokončení adaptéru a není potvrzením jeho kompatibility.

## Co zbývá pro univerzitu

Je nutné prozkoumat aktuální přihlášenou stránku SIS UK a připravit registrační adaptér. Ten musí bezpečně rozlišit přijetí, definitivní odmítnutí a nejasný výsledek. Musí ověřit aktuální přihlášení, vazbu termínu na předmět, potřebné tokeny a skutečný výsledek zápisu. Teprve podle konkrétního workflow lze vybrat přímý autentizovaný požadavek nebo interakci se stránkou a změřit rychlost. Diagnostický JSON neobsahuje potřebné tokeny a sám k provedení zápisu nestačí.

Skutečné relace, čas serveru, přístup k síti a zápis na univerzitě nejsou v této verzi implementovány ani ověřeny. Časování tréninku se řídí hodinami počítače. Výsledky tréninku nepředpovídají rychlost ani úspěšnost ve skutečném systému.

## Vývoj a ověření

Samotné rozšíření nepotřebuje build ani žádné běhové balíčky. Do Chrome se načítá přímo `extension/`.

Pro vývojové testy použijte Node.js 24+, npm a Python 3:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Testy prohlížeče spouštějí rozšíření v samostatném dočasném profilu Chromium / Chrome for Testing. Osobního profilu Chrome se nedotýkají. Playwright pro zavádění rozšíření doporučuje vlastní Chromium; běžné Chrome odstranilo příslušné přepínače příkazové řádky. [Dokumentace Playwright](https://playwright.dev/docs/chrome-extensions)

`test-results/` obsahuje snímky rozhraní. `dist/termin-0.2.0.zip` je instalační balíček se složkou rozšíření a krátkým návodem. Vývojové závislosti do něj nepatří.

Technický návrh a smlouva adaptéru jsou v [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

# Termín — krátký návod

**Verze 0.2 obsahuje trénink a načtení struktury stránky SIS Univerzity Karlovy. Skutečný zápis zatím není aktivní. Žádné potvrzení v tréninku neznamená skutečný zápis na zkoušku.**

## Instalace — jednou, asi 2 minuty

1. Rozbalte `termin-0.2.0.zip`. Rozbalenou složku potom nepřesouvejte. Pokud máte načtenou starší verzi, vypněte ji.
2. Otevřete Chrome a do adresního řádku napište `chrome://extensions`.
3. Vpravo nahoře zapněte **Režim pro vývojáře**.
4. Klikněte na **Načíst rozbalené** a vyberte složku **extension**, ve které je `manifest.json`.
5. U adresního řádku otevřete nabídku rozšíření (dílek skládačky), připněte **Termín** a klikněte na jeho ikonu.

Nemusíte instalovat Node.js, nic programovat ani zadávat heslo.

## První vyzkoušení — asi 10 sekund

1. Nechte otevřenou **Zkoušku nanečisto**.
2. Zaškrtněte přijatelné termíny. Šipkami ↑ ↓ dejte oblíbený termín nahoru. Tlačítkem **Upravit** změníte ukázkové datum.
3. Nechte čas **Za 5 sekund od spuštění** a scénář **První termín je plný → náhradní termín**.
4. Klikněte na **Spustit zkoušku nanečisto**. Nechte záložku v popředí a počítač zapnutý.
5. Po odpočtu uvidíte, jak pomocník přejde na náhradní termín a potvrdí ukázkový výsledek.

Pro plánovaný start zvolte **V přesný čas**. Zadejte **čas otevření zápisu**, nikoli datum samotné zkoušky. Časové pásmo je uvedené pod polem.

## Když je potřeba něco řešit

- **Zastavit další pokusy** zabrání novým požadavkům. Už odeslaný požadavek může ještě uspět; jeho výsledek se ověří.
- **Výsledek není jistý** znamená, že další pokusy stojí. V tréninku použijte **Vymazat nejasný výsledek tréninku**. U skutečného systému by bylo nutné nejdřív ověřit zápis přímo v něm.
- **Trénink už běží v jiné záložce**: vraťte se k původní záložce. Další kopii spouštět nemusíte.
- **Uložit průběh** stáhne záznam pro řešení problémů.

Podrobnější návod je přímo v rozšíření vpravo nahoře.

## SIS UK — načtení podkladů pro dokončení

1. Otevřete [SIS Univerzity Karlovy](https://is.cuni.cz/studium/) a přihlaste se přímo tam.
2. Otevřete **Termíny zkoušek – přihlašování** a zobrazte termíny jednoho předmětu.
3. Přímo v záložce SIS klikněte na ikonu rozšíření **Termín**. Otevře se propojené okno.
4. Klikněte na **Načíst stránku SIS**, prohlédněte si přehled a zvolte **Uložit přehled pro dokončení**.
5. Předejte autorovi soubor `sis-uk-struktura.json`. Pomůže doplnit konkrétní napojení; sám o sobě nezaručuje jeho úplné ověření.

Načtení nekliká na zápis a neposílá žádné požadavky do SIS. Přehled neobsahuje hesla, cookies, hodnoty polí formulářů, hodnoty parametrů URL ani celé HTML. Obsahuje strukturu ovládání a případně ukázková data termínů. Ostrý režim se zpřístupní až po doplnění a ověření zápisu i potvrzení výsledku.

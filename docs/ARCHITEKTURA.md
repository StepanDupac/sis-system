# Návrh exekuce a připojení univerzity

## Rozsah současné verze

Rozšíření obsahuje pouze registrační `DemoAdapter`. Všechny jeho údaje a odpovědi vznikají v paměti prohlížeče. Žádný skutečný zápis, autorizace, čas serveru, živé sledování dostupnosti ani registrační koncový bod univerzity nejsou implementovány. UI výslovně označuje trénink.

Verze 0.2 navíc obsahuje nezapisující diagnostiku SIS UK. Kliknutí na ikonu v SIS propojí zdrojovou záložku s panelem. Na stisknutí tlačítka se v izolovaném světě spustí `inspectCuniPage`. Funkce pouze čte DOM. Přesná HTTPS doména i cesta `/studium/` se ověřují před injekcí i uvnitř funkce. Do exportu jdou názvy polí, metody formulářů, cesty a názvy parametrů bez hodnot, předem známé popisky ovládání, rozpoznané záhlaví tabulek a data termínů. Neexportují se hodnoty polí, tokeny, cookies, celé HTML, jména ani volný text buněk. Tato diagnostika neověřuje platnost relace a nepovoluje skutečný zápis.

Oprávnění `activeTab` poskytuje dočasný přístup po kliknutí na ikonu; `scripting` slouží k injekci čtecí funkce. Nejsou požadována trvalá hostitelská oprávnění ani přístup ke cookies. [Chrome: activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

## Souběh

`DemoAdapter.prepare()` souběžně ověřuje relaci a načítá termíny pomocí `Promise.all`. UI samostatně obnovuje odpočet. To jsou skutečně souběžné činnosti, nikoli nezávislí boti závodící o několik zápisů.

Zápisy řídí jediný `Executor`. Originový Web Lock platí napříč záložkami rozšíření; nový běh při obsazeném zámku okamžitě skončí. Není zařazen do fronty, aby se později sám nespustil se zastaralým plánem. Zámek nemá pronajímanou dobu platnosti, která by mohla vypršet během pomalého požadavku.

## Zápis a nejistota

1. Validovat a zkopírovat plán: jeden předmět, jedinečná ID, datum zkoušky po otevření zápisu.
2. Prověřit existující nevyřešený požadavek v místním úložišti.
3. Provést přípravu a těsně před spuštěním ji obnovit.
4. Před každým odesláním trvale uložit identifikátor pokusu a cílový termín.
5. Odeslat nejvýše jeden nový registrační požadavek najednou.
6. Při definitivním odmítnutí záznam vymazat a postupovat podle výsledku.
7. Při přijetí, výjimce, timeoutu nebo neznámé odpovědi ověřovat skutečný výsledek.
8. Nejasný výsledek ponechat zapsaný a další požadavky zablokovat i po obnovení stránky.

Timeout v prohlížeči není důkaz, že server požadavek nepřijal. Ani prázdný aktuální seznam přihlášek neprokazuje, že starší požadavek později nedoběhne. Při ověřování povolí další zápis jen výslovné `not_committed` pro stejné `attemptId` s `final: true`. Pokud univerzita takový důkaz neposkytuje, adaptér tento výsledek nesmí vracet.

Lokální `attemptId` není serverový idempotency key. Žádná idempotence serveru se nepředpokládá. Přijetí odpovědi nebo HTTP 200 samo o sobě není potvrzením zápisu.

Tlačítko Stop zruší čekání a zabrání dalším odesláním. Již odeslaný požadavek se nezaměňuje za zrušený; ověření pokračuje. Může proto skončit potvrzeným úspěchem i po stisknutí Stop.

## Smlouva budoucího adaptéru

| Metoda | Význam |
| --- | --- |
| `prepare(plan)` | Ověřit relaci a aktuální ID; vrátit `ready` se `slotIds`, `auth_expired` nebo autoritativní `already_enrolled` se `slotId`. Připravit tokeny před rozhodným okamžikem. |
| `submit({slot, attemptId})` | Jediný zápis. Vrací `accepted`, `unknown`, nebo definitivní odmítnutí `full`, `ineligible`, `not_open`, `rate_limited`, `auth_expired` s `final: true`. |
| `reconcile({slot, attemptId})` | Autoritativní `confirmed` se správným `slotId`, průkazné `not_committed` se stejným ID pokusu a `final: true`, nebo `unknown`. |

Produkční adaptér musí mít vlastní testy na skutečných, anonymizovaných odpovědích. Musí kontrolovat přesnou doménu a vazbu na předmět i účet. Volné hledání slova „úspěch“ v HTML nestačí. Neznámá odpověď musí zůstat neznámou odpovědí. Parametry požadavků a citlivé tokeny se nesmějí dostat do exportu.

Pro síťové napojení bude podle systému potřeba doplnit úzce vymezená oprávnění, práci v přihlášené záložce a CSP. Široká oprávnění ke všem webům současná verze nemá.

## Načasování a životní cyklus

Plán používá místní čas, zobrazované časové pásmo a monotónní hodiny od počátku běhu. Změna hodin o více než 2 sekundy zastaví nové odeslání. Příliš pozdní probuzení zastaví běh. Neexistuje příslib konkrétního pořadí ve frontě univerzity.

Kritický odpočet běží v otevřené záložce. MV3 service worker může být ukončen během nečinnosti; proto nezajišťuje přesný čas odeslání. [Chrome: životní cyklus service workeru](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

Časovače prohlížeče mohou běžet později, zvlášť na pozadí. Trénink zobrazuje upozornění při skrytí záložky, ale dovoluje dokončení; produkční adaptér musí použít `canExecute` k ověření aktuální připravenosti i před odesláním. [MDN: zpoždění časovačů](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#reasons_for_delays_longer_than_specified)

Oprávnění `power` žádá o zachování bdělého počítače během běhu. Žádost se uvolňuje při konci běhu a uzavření jeho záložky. Nejde o záruku proti ručnímu uspání, zavření víka nebo vypnutí. [Chrome: power API](https://developer.chrome.com/docs/extensions/reference/api/power)

## Limity testování

Jednotkové testy ověřují především nepřekrývání zápisů, finalitu, zacházení s timeoutem, Stop, limity opakování a trvalý záznam nejistoty. Prohlížečové testy načítají skutečný manifest do odděleného profilu Chromium, ověřují UI a zámek mezi záložkami. Žádný z těchto testů neprokazuje funkčnost na univerzitním systému.

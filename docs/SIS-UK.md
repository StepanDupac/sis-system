# SIS Univerzity Karlovy — stav napojení

Ověřeno 26. 10. 2026. Cílová adresa od uživatele: https://is.cuni.cz/studium/.

## Co bylo ověřeno

- Ve skutečném Chrome se načte veřejná stránka SIS a standardní přihlášení CAS. Nebyla dostupná aktivní studentská relace. Přihlášení zůstalo otevřené pro uživatele; nebyly zadány přihlašovací údaje.
- Oficiální návod popisuje modul „Termíny zkoušek – přihlašování“, zobrazení termínů, ovládání „Zapsat“ a kontrolu v záložce „Zapsané“. Přesné HTML a parametry aktuálního registračního požadavku tím nejsou ověřeny. [Návod 2. LF UK](https://www.lf2.cuni.cz/studium/sis/prihlaseni-na-zkousku)
- Čtení struktury ve verzi 0.2 používá pouze DOM otevřené stránky. Neprovádí síťové požadavky, kliknutí ani zápisy. Rozpoznání stránky není důkaz platné relace nebo kompatibility registračního adaptéru.

## Co dál

1. Uživatel otevře přihlášený seznam termínů vybraného předmětu v modulu zkoušek. Případně sestra uloží diagnostický `sis-uk-struktura.json` podle návodu.
2. Zkontrolovat aktuální strukturu formuláře, jednoznačná ID termínů a předmětu, zdroj tokenů, čas otevření a zobrazení vlastních přihlášek. Diagnostika záměrně neexportuje hodnoty tokenů ani celé HTML; může proto být potřeba další cílená inspekce přihlášené stránky.
3. Implementovat adaptér až podle zjištěných požadavků a odpovědí. Nepředpokládat metodu, jména parametrů ani úspěch podle samotného HTTP statusu.
4. Testovat přijetí, definitivní odmítnutí, nejasný výsledek a souběh na reprezentativních podkladech. Dosavadní browser testy diagnostiky používají výslovně syntetické HTML a zachycenou URL, nikoli živou univerzitu.
5. Skutečný registrační pokus se týká až konkrétních termínů vybraných uživatelem. Zadání vytvořit software nevybírá žádnou konkrétní zkoušku a neopravňuje zkušebně zapsat náhodný termín.

## Záměrně neimplementováno

Automatický login, ukládání hesla, produkční endpoint pro zápis, čas serveru, paralelní registrační požadavky, automatické rušení existujícího zápisu. Přínos souběžných požadavků zatím nebyl na tomto systému změřen. Souběžné kontroly v tréninku a jeden koordinovaný zapisovač zůstávají funkční.

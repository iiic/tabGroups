//@ts-check
"use strict";

// modules-background.mjs — seznam background částí modulů
// (modules/<jméno>/background-script.mjs, viz registerBackgroundScript() v
// base.mjs), které načítá background.js.
//
// Proč seznam, a ne hledání podle modules.json jako u content scriptů:
// background.js je v Chrome service worker a ten dynamický import() nedovolí
// (viz komentář na začátku background.js). Kód modulu se do něj dostane jen
// statickým importem, modul s background částí se proto zapisuje i sem (jeden
// řádek), nejen do modules.json.
//
// Pozor: soubor, který tu je uvedený a na disku chybí (nebo v něm je
// syntaktická chyba), zastaví načtení CELÉHO background.js — prohlížeč pak u
// rozšíření hlásí chybu service workeru. Při odebrání modulu z disku smaž i
// jeho řádek tady. Vyřazení modulu ze seznamu modulů nebo jeho vypnutí v
// Nastavení tenhle soubor měnit nevyžaduje: jestli má pracovat, si background
// část hlídá sama přes api.activation (viz sdk.mjs).
import "./modules/tabGroups/background-script.mjs";

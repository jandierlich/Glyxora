# Glyxora – Kristall-Puzzle

Ein eigenständiges Drei-Gewinnt-Puzzlespiel (Match-3) mit 50 Leveln und einem
zeit- und zuglosen Zen-Modus. Komplett offline spielbar, für iPhone optimiert.

## Rechtliche & lizenztechnische Sicherheit

Alles in diesem Projekt ist selbst erstellt – nichts wurde von anderen
Spielen kopiert oder übernommen:

- **Spielname:** "Glyxora" ist frei erfunden. Vor der Wahl wurde recherchiert,
  ob der Name bereits als Spiel, Marke oder App vergeben ist – es wurden
  keine Konflikte gefunden.
- **Grafiken/Icons:** Alle Kristall-Formen sind reine CSS-Formen
  (`clip-path`/Gradients), die App-Icons wurden mit einem eigenen
  Python-Skript (`make_icons.py`, liegt bei den Quelldateien, nicht im
  Auslieferungs-ZIP) prozedural gezeichnet. Es werden keine fremden Bilder,
  Sprites oder Fotos verwendet. Die beiden Joker-Symbole (↩ und 🤖) sind
  reguläre Unicode-Zeichen, die vom Betriebssystem des Geräts gerendert
  werden — keine eingebetteten Icon-Dateien oder Emoji-Grafiken.
- **Schriften:** Es wird ausschließlich die System-Schriftart des Geräts
  verwendet (`-apple-system, "Segoe UI", Roboto, ...`). Es werden keine
  Schriftdateien heruntergeladen oder eingebettet – dadurch entstehen keine
  Font-Lizenzfragen.
- **Sound:** Alle Töne werden zur Laufzeit mit der Web-Audio-API erzeugt
  (einfache Sinus-/Dreieckstöne). Es sind keine Audiodateien enthalten.
- **Mechanik:** Das "3 gleiche in einer Reihe"-Prinzip ist ein seit
  Jahrzehnten offen genutztes Spielprinzip (z. B. seit "Shariki"/"Bejeweled"
  aus den 1990ern) und als solches nicht schützbar. Namen von
  Spezial-Kristallen ("Kristallblitz", "Kristallbombe", "Kristallstern")
  sind eigene Wortschöpfungen und lehnen sich bewusst nicht an Begriffe
  anderer Hersteller an.
- **Keine Tracker, keine Werbung, keine Server-Kommunikation:** Die App
  lädt und sendet keinerlei Daten über das Internet. Der Fortschritt wird
  ausschließlich lokal im Browser (`localStorage`) auf dem Gerät gespeichert.
  Dadurch ist auch kein Impressum/keine Datenschutzerklärung im
  rechtlichen Sinne einer Webseite mit Datenverarbeitung nötig – trotzdem
  gilt: Sobald du die Seite unter einer eigenen Domain / einem eigenen
  GitHub-Pages-Konto veröffentlichst, bist du als Betreiber für die
  Einhaltung der für dich geltenden Vorschriften (z. B. TMG/DSGVO-Pflichten
  deines Landes) selbst verantwortlich.

## Veröffentlichung auf GitHub Pages

1. Erstelle auf GitHub ein neues, öffentliches Repository (z. B. `glyxora`).
2. Entpacke die ZIP-Datei und lade **alle enthaltenen Dateien direkt ins
   Hauptverzeichnis** des Repositories hoch (kein Unterordner nötig – die
   ZIP-Datei ist bewusst flach aufgebaut).
3. Gehe im Repository zu **Settings → Pages**.
4. Wähle bei "Source" den Branch `main` und den Ordner `/ (root)` aus und
   speichere.
5. Nach ein bis zwei Minuten ist das Spiel unter
   `https://<dein-benutzername>.github.io/glyxora/` erreichbar.

## Auf dem iPhone offline spielbar machen

1. Öffne den obigen Link in **Safari** auf dem iPhone.
2. Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben).
3. Wähle **"Zum Home-Bildschirm"**.
4. Ab jetzt startet Glyxora wie eine normale App über das Home-Bildschirm-Icon
   – auch ganz ohne Internetverbindung, da alle Dateien beim ersten Aufruf
   über einen Service Worker lokal zwischengespeichert werden.

## Dateiübersicht

| Datei                     | Zweck                                              |
|---------------------------|----------------------------------------------------|
| `index.html`               | Grundgerüst der App (Bildschirme, Overlays)        |
| `style.css`                | Gesamtes Erscheinungsbild                          |
| `game.js`                  | Spiel-Engine, Level-Logik, Speicherstand, UI        |
| `manifest.json`            | PWA-Manifest (Home-Bildschirm-Icon, Name, Farben)  |
| `service-worker.js`        | Sorgt für vollständige Offline-Nutzung              |
| `icon-192.png` / `icon-512.png` / `icon-512-maskable.png` / `apple-touch-icon.png` / `favicon.png` | Selbst erzeugte App-Icons |

## Spielumfang

- **Unendlich viele Level:** Es gibt keine feste Obergrenze mehr — die Level
  werden bei Bedarf berechnet. Ziel-Punktzahl und Zugzahl folgen einer streng
  monotonen, nach oben begrenzten Kurve: die pro Zug nötige Punktzahl bleibt
  dadurch auch nach hunderten Leveln nachweislich in einem plausiblen,
  erreichbaren Rahmen (z. B. "Mittel": ca. 18 Punkte/Zug bei Level 1, langsam
  ansteigend auf max. ca. 43 Punkte/Zug — nie mehr, auch nicht bei Level
  100.000). Per Testskript automatisiert geprüft.
- **Wählbare Grundschwierigkeit:** Leicht/Mittel/Schwer auf dem
  Startbildschirm — verschiebt nur den Startpunkt der Kurve, der weitere
  Anstieg bleibt in jeder Stufe moderat.
- Zwei Ziel-Typen: Punkte-Ziele und "Eiskristalle befreien"-Ziele
- Eiskristall-Hindernisse ab Level 6
- Drei Spezial-Kristalle mit Kettenreaktionen: Kristallblitz (Reihe/Spalte),
  Kristallbombe (3×3-Feld), Kristallstern (ganze Farbe)
- Stern-Bewertung (1–3 Sterne) pro Level, dauerhaft gespeichert
- Zen-Modus ganz ohne Zug- oder Zeitlimit mit persönlichem Bestwert
- **Joker:** "Rückgängig" macht den letzten Zug ungeschehen, "Auto-Zug"
  spielt automatisch einen gültigen Zug. Nach jedem abgeschlossenen Level
  gibt es von beiden einen Nachschub.
- Vollständig funktionierende Deadlock-Erkennung (das Feld wird automatisch
  neu gemischt, falls kein Zug mehr möglich ist)
- Sound an/aus, Fortschritt zurücksetzen
- **Themen-Welten:** Alle 15 Level wechselt die Farbwelt (Kristallhöhle,
  Wolkenreich, Vulkanfeld, Tiefsee, Sternenhimmel), inklusive passender
  Deko in der Levelübersicht
- **Boss-Level:** Jedes 25. Level ist ein Boss-Level mit deutlich höherem
  Ziel, eigenem Banner und goldenem Spielfeld-Rahmen
- **Neue Hindernisse:** Frost (zweischichtiges Eis, braucht 2 Treffer) ab
  Level 20, Schlüssel-Kristalle (müssen zum unteren Spielfeldrand
  transportiert werden, dürfen nie gematcht werden) als eigener Zieltyp
- **Zwei weitere Joker:** 🎨 Farbwechsler (verwandelt einen angetippten
  Kristall passend zu seinen Nachbarn) und ➕ Extra-Zug (+3 Züge sofort)
- **Tages-Herausforderung:** täglich ein neues, aber für alle Spieler an
  diesem Tag identisches Spielfeld (fairer, reproduzierbarer Zufalls-Seed)
  mit eigenem Bestwert
- **Erfolge:** 10 Meilensteine (u. a. Level-Anzahl, Bomben/Blitze/Sterne
  ausgelöst, größte Kombo, Tage-Streak) mit eigener Übersichtsseite
- **Login-Streak-Bonus:** täglicher Joker-Nachschub fürs Wiederkommen,
  größerer Bonus an Tag 3 und Tag 7
- **Statistik-Seite:** Gesamtpunkte, beste Kombo, Lieblingskristall,
  ausgelöste Spezial-Kristalle, Streak, Tages- und Zen-Bestwert
- **"Juice"-Effekte:** kurzer Screen-Shake bei großen Kombos, animiertes
  Hochzählen der Punktzahl statt Sprung auf den Endwert
- **Saisonale Mini-Skins:** fallende Blätter im Oktober, Schneeflocken im
  Dezember (rein optisch, automatisch nach Gerätedatum)
- **Verspielt-buntes Cartoon-3D-Design:** jeder Kristall hat ein eigenes
  Gesicht, wirkt durch Tiefenebene, Glanzlicht und sanfte Wippanimation
  plastisch/dreidimensional, dazu Partikel-Explosionen beim Auflösen
- **Lobestexte:** bei Kombos, aktivierten Spezial-Kristallen und perfekt
  abgeschlossenen Leveln erscheint gelegentlich ein animierter Text
  ("Mega-Kombo!", "Kaboom!", "Perfekt!" …)
- **Bonuspunkte:** übrige Züge am Levelende und eine besonders sparsame
  Lösung (≤ 50 % der verfügbaren Züge genutzt) bringen zusätzliche Punkte
- **Impressum & Datenschutz:** eigene Seiten im Spiel (über die Links auf
  dem Startbildschirm erreichbar). Der Kontaktblock steht bewusst nur an
  einer einzigen Stelle im Code (`IMPRESSUM_CONTACT` in `game.js`, ganz am
  Anfang des Abschnitts "Rechtliche Seiten") und muss bei künftigen
  Weiterentwicklungen nicht erneut angegeben werden.

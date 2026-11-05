# PDFConvert.net

Progressive Web App zum Erstellen, Bearbeiten, Umwandeln und Scannen von PDFs – mit Texterkennung (OCR).
Alles läuft lokal im Browser: **kein Upload, kein Konto, keine Cookies, keine Verbindungen zu fremden
Servern** und nach dem ersten Öffnen **vollständig offline** nutzbar (einschließlich Texterkennung).

## Vor dem gewerblichen Einsatz

1. **Impressum ausfüllen:** In `config.js` Name, Anschrift und E-Mail eintragen (Pflicht nach § 5 DDG),
   optional Telefon, Registereintrag und USt-IdNr. Solange die Angaben fehlen, zeigt die App im
   Impressum einen Hinweis.
2. **Datenschutzerklärung prüfen:** Der Text in der App (Info → Datenschutzerklärung) beschreibt die
   tatsächliche Verarbeitung. Bitte rechtlich prüfen lassen und bei einem anderen Hosting-Anbieter
   `hosting` in `config.js` anpassen.
3. **Lizenzen:** Alle verwendeten Bibliotheken und Schriften sind Open Source mit gewerblich nutzbaren
   Lizenzen (MIT, Apache-2.0, BSD, SIL OFL). Die Lizenztexte liegen in `vendor/` und sind in der App unter
   Info → Open-Source-Lizenzen verlinkt – bitte nicht entfernen.

## Dateien

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | die App |
| `config.js` | Anbieterangaben für Impressum und Datenschutzerklärung |
| `scanner.js` | Dokumentenscanner: Blatt erkennen, entzerren, wie ein Scan aufbereiten |
| `sw.js` | Service Worker: Offline-Speicher und Updates |
| `manifest.json` | Name, Farben, Symbole und Verknüpfungen der installierten App |
| `icons/` | App-Symbole (Favicon, 192/512 px, Android „maskable“, iPhone-Homescreen) |
| `vendor/` | lokal eingebundene Bibliotheken und Schriften inkl. Lizenzen (PDF.js, pdf-lib, Tesseract.js, SheetJS, Mammoth, JSZip, Inter, Space Grotesk) |
| `.nojekyll` | sorgt dafür, dass GitHub Pages alle Dateien unverändert ausliefert |

## Hosten auf GitHub Pages

1. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
2. Nach ein bis zwei Minuten läuft die App unter `https://<username>.github.io/<repo>/`.

## Updates veröffentlichen

1. Änderungen hochladen.
2. Bei jeder neuen Version die Versionsnummer **an beiden Stellen** erhöhen:
   `APP_VERSION` in `index.html` und in `sw.js` (z. B. `2.0.0` → `2.0.1`).
3. Geöffnete Apps zeigen dann den Hinweis „Eine neue Version ist verfügbar – Neu laden“.

Nur wenn sich Dateien in `vendor/` ändern, zusätzlich `LIB_CACHE` bzw. `OCR_CACHE` in `sw.js` erhöhen –
sonst werden die großen Bibliotheken nicht bei jedem Update neu geladen.

## Offline-Betrieb

- Beim ersten Öffnen speichert der Service Worker App, Bibliotheken und Schriften (ca. 5 MB).
- Die Texterkennung (ca. 5 MB) wird danach im Hintergrund geladen.
- Den Stand zeigt die App unter Info (ⓘ oben rechts): „Offline-Betrieb“ und „Texterkennung offline“.

## Funktionen

**Umwandeln:** Bilder (JPG, PNG, WEBP, GIF, BMP), TXT/MD, CSV/JSON, DOCX, XLSX und PDFs zu einer PDF
oder zu einzelnen PDFs (ZIP). Dateien per Auswahl oder Drag & Drop.

**Bearbeiten – Inhalt**
- *Text bearbeiten:* Absatz, Zeile oder neuen Text antippen und ändern, mit Live-Vorschau, Schrift,
  Größe, Farbe, Fett/Kursiv, Rückgängig. Gescannte Seiten zuerst per Texterkennung lesen. Optional
  „Alten Text endgültig entfernen“.
- *Exportieren:* Word, Excel, CSV, Text, Bilder (JPG/PNG) und durchsuchbare PDF.

**Bearbeiten – Seiten:** Zusammenfügen, Trennen, Entfernen, Drehen.

**Scannen:** Fotos aufnehmen oder aus der Galerie wählen. Die App erkennt das Blatt automatisch, entzerrt
die Perspektive (A4 wird erkannt) und bereitet die Seite wie einen Flachbett-Scan auf: Schatten und
ungleichmäßiges Licht verschwinden, das Papier wird weiß, der Text klar. Filter: Dokument (Farbe),
Graustufen, Schwarzweiß, Original. Ecken lassen sich mit Lupe nachziehen, Seiten drehen und umsortieren.
Bereits gescannte Bilder werden nicht beschnitten. Optional mit Texterkennung (durchsuchbare PDF).

**Info & Rechtliches (ⓘ):** Version, Offline-Status, App installieren, nach Updates suchen, Impressum,
Datenschutzerklärung, Hilfe und Open-Source-Lizenzen.

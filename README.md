# PDFConvert.net

Kostenlose PWA: Dateien zu PDF umwandeln, PDFs bearbeiten, in andere Formate exportieren, Dokumente
scannen – mit Texterkennung (OCR). Läuft komplett im Browser, ohne Server, ohne Upload, ohne Konto.

## Dateien im Repo

| Datei | Zweck |
|---|---|
| `index.html` | die App |
| `manifest.json` | Name, Farben und Icons der installierten App |
| `sw.js` | Offline-Speicher und automatische Updates |
| `favicon.png` | Symbol im Browser-Tab |
| `apple-touch-icon.png` | Symbol auf dem iPhone-Homescreen |
| `pdfconvert-192.png`, `pdfconvert-512.png` | App-Symbole (Android, Chrome, App-Kopf) |
| `pdfconvert-maskable-512.png` | rund zuschneidbares Symbol für Android |
| `README.md` | diese Beschreibung (wird von der App nicht gebraucht) |

Alle Dateinamen klein schreiben. Die alten `icon-192.png` und `icon-512.png` werden nicht mehr gebraucht.

## Hosten auf GitHub Pages

1. Dateien in den Repo-Root hochladen (Add file → Upload files).
2. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
3. Nach ein bis zwei Minuten läuft die App unter `https://<username>.github.io/<repo>/`.

**Updates:** geänderte Dateien im Repo ersetzen. Die App lädt die neue Version beim nächsten Öffnen mit
Internet automatisch.

**Neues Symbol / neuer Name auf dem Homescreen:** iPhone und Android merken sich Symbol und Name beim
Hinzufügen. Nach einer Änderung das alte App-Symbol löschen, die Seite im Browser neu öffnen und erneut
„Zum Home-Bildschirm“ wählen.

## Funktionen

**Umwandeln:** Bilder, TXT/MD, CSV/JSON, DOCX, XLSX und PDFs zu einer PDF machen.

**Bearbeiten – Inhalt**
- *Text bearbeiten:* Zeile antippen → ändern, löschen, Größe/Farbe/Schrift/Fett/Kursiv. Neuen Text
  einfügen, Zoom, Rückgängig. Farben, Schriftgröße und Fettdruck werden erkannt, rechtsbündige Beträge
  bleiben rechtsbündig. Bei Scans erst „Text auf dieser Seite erkennen“ tippen. Optional „Alten Text
  endgültig entfernen“.
- *Exportieren:* Word, Excel, CSV, Text, Bilder (JPG/PNG) und durchsuchbare PDF. Gescannte Seiten werden
  per Texterkennung gelesen.

**Bearbeiten – Seiten:** Zusammenfügen, Trennen, Entfernen, Drehen.

**Scannen:** Fotos aufnehmen, Reihenfolge festlegen, als PDF speichern – optional mit Texterkennung, dann
ist die PDF durchsuchbar.

## Grenzen

- Die Texterkennung lädt beim ersten Mal einmalig die deutschen Sprachdaten (einige MB) und braucht dafür
  Internet. Sie arbeitet auf dem Handy und braucht je Seite einige Sekunden. Sie ist bei sauberen Scans
  sehr zuverlässig, aber nicht fehlerfrei – erkannten Text kurz gegenlesen.
- Geänderter Text wird in Helvetica, Times oder Courier gesetzt; Sonderschriften werden angenähert.
  Zeichen außerhalb des westeuropäischen Zeichensatzes (z. B. Emojis) werden durch „?“ ersetzt.
- Export nach Word/Excel baut Text, Absätze, Überschriften und Tabellen nach – keine Bilder und kein
  mehrspaltiges Zeitungslayout.
- Bibliotheken kommen von cdnjs und jsDelivr (pdf-lib, pdf.js, tesseract.js, mammoth, SheetJS, JSZip).

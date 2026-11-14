# PDF Studio

Mobiele PDF-app (iOS + Android) in Expo / React Native. **Alles gebeurt op het toestel**: geen server, geen account, geen analytics, geen netwerkverkeer voor je bestanden.

## Functies

- **Openen** (bestandskiezer) en lezen; **Recent** met delen, hernoemen, verwijderen
- **Annoteren**: pen (5 kleuren), markeerstift, tekst, afbeelding invoegen; verslepen, groter/kleiner, ongedaan maken
- **Ondertekenen**: handtekening tekenen, lokaal bewaren, op een pagina plaatsen en verslepen
- **Samenvoegen**: PDF's (en foto's) in een gekozen volgorde achter elkaar in één PDF; wie meer wil, bewerkt de pagina's apart (herordenen, roteren, kopiëren, verwijderen)
- **Splitsen**: per pagina, per selectie of per bereik (`1-3, 5`)
- **Scannen**: camera (of galerij) naar PDF met automatische randdetectie, perspectief rechtzetten, schaduw weghalen (filters Document / Grijs / Kleur), randen met de hand bij te stellen
- Tijdelijke bestanden (kiezerkopieën, camerafoto's, exportkopie voor delen) worden na gebruik verwijderd
- **Formulieren invullen** (tekstvelden, vinkjes, keuzelijsten; optioneel vastzetten)
- **Comprimeren**: licht (tekst blijft) of sterk (pagina's worden afbeeldingen)
- **Delen/exporteren** via het deelmenu van het systeem
- Licht/donker volgt het systeem; onderbalk met grote tikdoelen; schermlezer-labels

## Starten

```bash
npm install
npx expo start
```

### Android
- Expo Go uit de Play Store, scan de QR-code; of `npm run android` met een emulator/Android Studio.

### iOS (je werkt op Windows)
iOS kan niet lokaal gebouwd worden op Windows. Twee opties:
1. **Expo Go** (snelste): installeer *Expo Go* uit de App Store, zorg dat pc en iPhone op hetzelfde wifi zitten (of `npx expo start --tunnel`), scan de QR-code met de camera-app.
2. **Echte build via de cloud (EAS)**: `npm i -g eas-cli`, `eas login`, `eas build -p ios --profile preview` (internal distribution; vereist een Apple Developer-account of een sideload-oplossing).

Alles wat de app gebruikt (pdf-lib, pdf.js in een verborgen WebView, image-picker, document-picker, sharing) werkt in Expo Go; er is geen eigen native code.

## Tests

```bash
npm run check     # typecheck + unit tests
```

De tests (`tests/`) draaien in Node en dekken de PDF-engine: samenvoegen, herordenen, roteren (ook met al-geroteerde pagina's), afbeeldingen naar pagina, splitsen, bereiken parsen, annotaties vastbranden (positie en oriëntatie gecontroleerd met pdf.js voor 0/90/180/270°), formulieren lezen/invullen/vastzetten, optimaliseren, base64.

Geverifieerd op de Windows-machine: `tsc` zonder fouten, alle unit tests, Metro-bundel voor Android en iOS (`expo export`), en de pdf.js-renderer in een echte browser (PDF laden en pagina naar JPEG). **Niet** gecontroleerd op een echt toestel/emulator: aanraakgebaren (tekenen, slepen), camera, deelmenu, bestandskiezer. Test die eerst met Expo Go.

## Opbouw

| Map | Inhoud |
|---|---|
| `src/engine` | Pure TypeScript (pdf-lib): collage, splitsen, annotaties vastbranden, formulieren, comprimeren |
| `src/services` | Bestanden/recents (lokaal), verborgen pdf.js-renderer (WebView), afbeeldingen |
| `src/screens` | Start, Editor, PageView, Collage, Scan, handtekening |
| `src/ui` | Thema (licht/donker), onderbalk, sheets, knoppen |
| `scripts/` | `build-renderer.js` bakt pdf.js in `src/services/rendererHtml.ts` (`npm run build:renderer`) |

Annotaties worden als fracties van de pagina bewaard en pas bij opslaan/delen definitief in de PDF gebrand ("flatten").

## Beperkingen

- Met wachtwoord beveiligde PDF's worden geweigerd met een duidelijke melding.
- Tekstannotaties gebruiken Helvetica (Latijnse tekens; andere tekens worden `?`).
- Markeren gebeurt met de stift over de pagina (geen tekstselectie).
- Hele grote PDF's (honderden MB) kunnen traag zijn: het document gaat als base64 naar de renderer.
- "Sterk" comprimeren maakt van pagina's afbeeldingen (tekst niet meer selecteerbaar).

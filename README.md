# PDF Studio

Mobiele PDF-app voor **iOS en Android** (Expo / React Native). **Alles gebeurt op het toestel**: geen server, geen account, geen analytics, geen netwerkverkeer voor je bestanden.

## Functies

- **Lezen en openen**: bestandskiezer, Recent (delen, hernoemen, verwijderen)
- **Annoteren**: pen (5 kleuren), markeerstift, tekst, afbeelding invoegen; verslepen, groter/kleiner, ongedaan maken
- **Ondertekenen**: handtekening tekenen, lokaal bewaren, op een pagina plaatsen
- **Samenvoegen**: PDF's (en foto's) in een gekozen volgorde achter elkaar in één PDF; pagina's apart bewerken kan ook (herordenen, roteren, kopiëren, verwijderen)
- **Splitsen**: per pagina, per selectie of per bereik (`1-3, 5`)
- **Formulieren invullen** (tekstvelden, vinkjes, keuzelijsten), **comprimeren** (licht of sterk)
- **Scannen** met de camera of uit de galerij, op hoge kwaliteit (tot 3000 px):
  - randen automatisch vinden en met de hand bijstellen
  - **perspectief rechtzetten** bij kantelen in alle richtingen (x, y en z), met de echte beeldverhouding van het blad
  - **schaduw weghalen** (schakelaar) en vier filters: Document, Grijs, Kleur, Origineel
  - **Automatisch verbeteren**: de app kiest de beste bewerking en legt uit wat ze deed
  - **Voorbeeld** van het eindresultaat tijdens het bewerken
- **Delen/exporteren** als **PDF, JPEG of PNG** (PNG zonder kwaliteitsverlies) via het deelmenu van het systeem
- Licht/donker volgt het systeem; onderbalk met grote tikdoelen; labels voor schermlezers

## Privacy en rechten

- De app vraagt **toegang tot de camera** (foto van een pagina nemen) en tot **je foto's** (afbeelding uit de galerij kiezen). Zeg je nee, dan krijg je uitleg en kom je via de instellingen terecht; kiezen uit je galerij kan op nieuwe toestellen ook via de veilige systeemkiezer.
- Documenten kiezen gaat via de systeemkiezer en vraagt geen extra rechten. De microfoon wordt niet gebruikt (geblokkeerd).
- Tijdelijke bestanden (kiezerkopieën, camerafoto's, exportkopie voor delen) worden na gebruik verwijderd. Handtekeningen en recente bestanden blijven alleen op het toestel.

## Starten (ontwikkelen)

```bash
npm install
npx expo start
```

- **Android**: Expo Go uit de Play Store, scan de QR-code; of `npm run android` met een emulator.
- **iPhone**: Expo Go uit de App Store, pc en telefoon op hetzelfde wifi (of `npx expo start --tunnel`), scan de QR-code met de camera-app.

## APK en IPA bouwen

Er is geen eigen native code, dus beide builds werken zonder extra instellingen. Op Windows kun je iOS niet lokaal bouwen; daarom zijn er twee wegen.

### Via GitHub Actions (geen account nodig)

In de repository staan twee workflows. Ga naar **Actions → kies de workflow → Run workflow**; het resultaat staat daarna onder *Artifacts*.

| Workflow | Resultaat | Gebruik |
|---|---|---|
| `Android APK` | `PDF-Studio-apk` (release-APK, getekend met de debug-sleutel) | Downloaden, op de telefoon openen en "onbekende bronnen" toestaan |
| `iOS IPA (ongetekend)` | `PDF-Studio-ipa` | Ongetekend: installeren via een sideload-tool zoals AltStore of Sideloadly, die met je eigen Apple ID tekent |

Een tag `v*` start beide workflows ook.

### Via EAS (Expo-account)

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview   # APK
eas build -p ios --profile preview       # vereist een Apple Developer-account
```

## Tests en controle

```bash
npm run check                    # typecheck + unit tests
node scripts/controle.js tests   # alles: typecheck, unit tests, bundels voor Android, iOS en web
```

De tests (`tests/`) draaien in Node en dekken de PDF-engine (samenvoegen, roteren, splitsen, annotaties vastbranden op 0/90/180/270°, formulieren, comprimeren, ook in een geminificeerde build) en de scan-wiskunde (perspectief, schaduw weghalen, suggesties).

`scripts/controle.js` is een controle-loop: tests plus twee controle-agents (`.claude/agents/`) die de webversie van de app bekijken (design en functie). Een verdict geldt alleen voor de code waarop het is gegeven.

**Niet gecontroleerd op een echt toestel**: camera, galerij, bestandskiezer, deelmenu, toestemmingsvragen en aanraakgebaren. Test die eerst met Expo Go of de APK.

## Opbouw

| Map | Inhoud |
|---|---|
| `src/engine` | Pure TypeScript (pdf-lib): collage, splitsen, annotaties vastbranden, formulieren, comprimeren |
| `src/services` | Bestanden/recents, rechten, delen, verborgen pdf.js-renderer en scanner (WebView), afbeeldingen |
| `src/screens` | Start, Editor, Collage, Samenvoegen, Scannen, handtekening |
| `src/ui` | Thema (licht/donker), onderbalk, sheets, knoppen |
| `scripts/` | `build-renderer.js` bakt pdf.js en de scanner in `src/services/rendererHtml.ts` (`npm run build:renderer`); `controle.js` is de controle-loop |

Annotaties worden als fracties van de pagina bewaard en pas bij opslaan/delen definitief in de PDF gebrand.

## Beperkingen

- Met wachtwoord beveiligde PDF's worden geweigerd met een duidelijke melding.
- Tekstannotaties gebruiken Helvetica (Latijnse tekens; andere tekens worden `?`).
- Markeren gebeurt met de stift over de pagina (geen tekstselectie).
- Hele grote PDF's (honderden MB) kunnen traag zijn: het document gaat als base64 naar de renderer.
- "Sterk" comprimeren maakt van pagina's afbeeldingen (tekst niet meer selecteerbaar).
- JPEG/PNG delen gaat per pagina; een PDF bevat altijd alle pagina's.

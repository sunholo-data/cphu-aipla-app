# Sol · Jord · Måne – integration i AIPLA

Simulationen er én selvstændig HTML-fil (`sol-jord-maane-standalone.html`). Den har ingen server-afhængigheder. Den henter three.js r128 fra cdnjs og skrifttyper fra Google Fonts. Vil I køre helt uden eksterne kald (GDPR/UCPH-IT), så læg `three.min.js` (r128) ved siden af filen og ret `<script src=…>` til en relativ sti. Skrifttyperne falder automatisk tilbage til systemskrifter.

## Indlejring

```html
<iframe id="sim" src="/sim/sol-jord-maane-standalone.html?origin=https://aipla.example.dk"
        style="width:100%;height:100%;border:0" allow="fullscreen"></iframe>
```

URL-parametre (alle valgfrie):

| Parameter | Eksempel | Betydning |
|---|---|---|
| `origin` | `https://aipla.example.dk` | Simulationen accepterer kun beskeder fra, og sender kun til, denne origin. Uden parameteren bruges `*`. |
| `t` | `2027-08-02T10:07Z` | Starttidspunkt (UTC) |
| `view` | `surface` | `space`, `ecliptic`, `earthmoon`, `sun`, `surface`, `geo`, `moon` |
| `scale` | `korrekt` | `korrekt` eller `overdrevet` (standard) |
| `lat`, `lon`, `sted` | `55.68`, `12.57`, `København` | Observatør |
| `speed` | `3600` | Simulerede sekunder pr. sekund: 1, 60, 600, 3600, 21600, 86400, 604800, 2551443, 7889238 |
| `play` | `0` | Start på pause |
| `lock` | `scale,view` | Lås paneler: `view`, `observer`, `scale`, `show`, `time`, `camera` |
| `struktur` | `poe` | `neutral` (standard) eller `poe`. Med `poe` starter hver mission med et Forudsig-trin, og tiden er låst, indtil forudsigelsen er sendt |
| `quiz` | `fra` | Skjuler diagnosespørgsmålene i missionsmenuen |
| `intro` | `0` | Missionsmenuen åbner ikke af sig selv første gang |

## Beskeder fra platformen til simulationen

```js
sim.contentWindow.postMessage({ target: 'aipla-sim', type: 'hello' }, origin);
sim.contentWindow.postMessage({ target: 'aipla-sim', type: 'command', id: 'k1',
  command: 'setView', args: { id: 'surface', target: 'sun' } }, origin);
```

| Kommando | Argumenter |
|---|---|
| `getState` | – |
| `setTime` | `{ iso }` eller `{ ms }` |
| `addTime` | `{ days, hours }` |
| `play`, `pause` | – |
| `setSpeed` | `{ secondsPerSecond, direction: 'frem' \| 'tilbage' }` |
| `setView` | `{ id, target }`; target er `sun`/`earth`/`moon` |
| `setScale` | `{ scale: 'korrekt' \| 'overdrevet' }` |
| `setObserver` | `{ preset }` eller `{ lat, lon, name }`; presets: `kbh`, `tromsoe`, `nordpol`, `aswan`, `quito`, `sydney`, `sydpol` |
| `look` | Observatørvisninger: `{ target }` eller `{ az, alt }`, `{ fov }`. Rumvisninger: `{ target, distance, elevation }`. Solvisning: `{ target, zoom }` |
| `setShow` | `{ orbits, planes, axis, grid, labels, paths, atmo }` (booleans) |
| `jump` | `{ event }`: `nymaane`, `foerste`, `fuldmaane`, `sidste`, `foraar`, `sommer`, `efteraar`, `vinter`, `perihel`, `aphel`, `middag`, `midnat`, `solform`, `maaneform` |
| `setTask` / `clearTask` | `{ title, text, steps: [..] }` – vises som en besked "Fra tutoren" i simulationen |
| `startMission` | `{ id }`: `M1`–`M5`. Stiller simulationen op og viser opgavekortet |
| `openMissions`, `openQuiz` | – åbner missionsmenuen eller diagnosespørgsmålene |
| `getMissions` | – elevens fremskridt: aktiv mission, trin, færdige missioner, quiz, konfiguration |
| `configure` | `{ struktur, quiz }` – samme som URL-parametrene; kan ændres undervejs (en aktiv mission starter forfra, hvis `struktur` skifter) |
| `lock` | `{ controls: ['scale', …], locked: true }` |
| `toast` | `{ text }` |
| `snapshot` | – svarer med JPEG (data-URL) + tilstand |

## Beskeder fra simulationen til platformen

Alle beskeder har `source: 'aipla-sim'` og `sim: 'sol-jord-maane'`.

| `type` | Hvornår | Indhold |
|---|---|---|
| `ready` | Ved start og som svar på `hello` | `state` |
| `result` | Svar på en kommando | `id`, `command`, `result`, `state` |
| `state` | Når tilstanden ændres (højst hvert 0,5 s på pause, hvert 2 s under afspilning) | `state` |
| `event` | Eleven gør noget (se listen herunder) | `action`, `detail`, `kilde`, `state` |
| `snapshot` | Eleven trykker "Send min visning til tutoren", eller platformen beder om det | `image` (data-URL), `state` |

Hændelser (`action`) fra missionerne:

| `action` | `detail` |
|---|---|
| `quiz_start`, `quiz_svar`, `quiz_slut` | `item`, `emne`, `bogstav`, `svar`, `niveau` (slut: alle svar) |
| `mission_start` | `mission`, `titel`, `genoptaget` |
| `forudsigelse` (kun `struktur=poe`) | `mission`, `trin`, `opgave`, `spoergsmaal`, `tekst` |
| `trin_faerdigt` | `mission`, `trin`, `opgave`, `spoergsmaal` |
| `svar` | `mission`, `trin`, `opgave`, `spoergsmaal`, `tekst` – elevens svar på missionens spørgsmål |
| `mission_slut` | `mission` |

Øvrige hændelser: `visning`, `skala`, `observatoer`, `spring`, `trin`, `dato`, `nu`, `afspil`, `pause`, `hastighed`, `retning`, `vis`, `kamera`.

`state` indeholder også `mission` med elevens fremskridt og konfigurationen. Fremskridtet gemmes i browseren (localStorage), så en elev kan lukke og åbne igen.

Knappen "Send min visning til tutoren" vises først, når platformen har sendt en besked til simulationen.

Hændelseslogen (`event`) er et godt datagrundlag i forskningen: Den viser, hvordan eleverne undersøger (fx om de forudsiger før de springer, og hvilke visninger de bruger til hvilke spørgsmål).

### Eksempel på `state`

```json
{
  "sim": "sol-jord-maane", "version": "1.0",
  "tid": { "utc": "2027-08-02T10:07:00.000Z", "dansk": "man. 2. aug. 2027, 12.07", "afspiller": false, "hastighed": "1 time/s", "sekunderPrSekund": 3600 },
  "visning": { "foelger": "sun", "azimut": 190.2, "hoejde": 81.7, "synsfeltGrader": 5, "visning": "surface" },
  "skala": "korrekt",
  "vis": { "orbits": true, "planes": false, "axis": true, "grid": false, "labels": true, "paths": true, "atmo": true },
  "observatoer": { "navn": "Luxor", "bredde": 25.7, "laengde": 32.6, "solHoejde": 81.7, "solAzimut": 190.2, "maaneHoejde": 81.7, "maaneAzimut": 190.4, "dagensLaengdeTimer": 13.32, "middagshoejdeSol": 82.1, "solDaekketProcent": 100 },
  "jordSol": { "afstandKm": 151820000, "solLaengdeGrader": 130.1, "solDeklination": 17.8, "aarstidNord": "Sommer" },
  "maane": { "fase": "Nymåne", "belystProcent": 0, "elongationGrader": 0.1, "alderDoegn": 0, "afstandKm": 357400, "eklipiskBreddeGrader": 0.14, "knudeVsSolGrader": 2 },
  "formoerkelse": { "sol": "total", "maane": null, "gammaJordradier": 0.142 },
  "opgave": "Mission 4: Totalitet"
}
```

## Tutoren i platformen

Missionerne og diagnosespørgsmålene ligger inde i simulationen (`missions.js`-delen af HTML-filen). Platformen skal ikke sætte noget op. Aktiviteten er uafhængig af dialogisk tilgang.

1. Systemprompten er instruktør-prompten (POE, ESRU, autentisk dialog …) efterfulgt af `aktivitetsmodul.md`.
2. Vælg simulationens konfiguration efter instruktøren, fx `struktur=poe` til POE-instruktøren og `struktur=neutral` til de andre. Simulationen giver ingen hints; al stilladsering kommer fra instruktøren. Sammenligner I instruktører i et studie, så hold `quiz` ens på tværs af betingelserne.
3. Send den seneste `state` med hver elevbesked som `[SIM-TILSTAND] {json}`. Send `event`-beskeder løbende som `[SIM-HÆNDELSE]` (gerne samlet og komprimeret), og send snapshots som billede med teksten `[SIM-BILLEDE]`.
4. Fjern `<sim>…</sim>`-linjer fra tutorens svar, og send dem videre som kommandoer.
5. Fjern `<vurdering>…</vurdering>`-linjer, og gem dem til lærerens overblik og til forskningsdata.
6. Send `forudsigelse` og `svar` videre til tutoren med det samme. Øvrige hændelser kan samles.

`harness.html` er en lille testside, der indlejrer simulationen og logger alle beskeder i `window.log`.

## Fagligt grundlag og nøjagtighed

- Solen: Meeus kap. 25 (ca. 0,01°). Månen: Meeus kap. 47 (trunkeret ELP-2000/82, ca. 60 led). Jordens rotation: GMST; ΔT = 69 s.
- Valideret mod NASA's formørkelseskataloger 2025–2028: alle sol- og måneformørkelser med korrekt type, tid (±1 min) og sted. Fx total solformørkelse 12/8-2026 kl. 17:46 UT ved 65,0° N, 25,6° V; 83 % dækning i København kl. 20:04 dansk tid.
- Skygger og formørkelser beregnes altid med de fysiske størrelser, også når modellen vises med overdrevne størrelser.
- Gyldighed: 1900–2100.
- Ikke med: refraktion i atmosfæren (bortset fra solopgang/-nedgang i dagslængden), Månens libration, rigtige stjernebilleder (stjernerne er tilfældige), nutation.

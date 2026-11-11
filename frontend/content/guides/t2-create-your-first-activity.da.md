---
title: "Opret din første aktivitet"
description: "Byg en guidet aktivitet: undervisningsmål, arbejdsområde og live-forhåndsvisning."
tag: "T2"
audience: "teacher"
order: "2"
lang: "da"
status: "Current"
owner: "AIPLA project team"
reviewed: "2026-11-11"
reviewBy: "2027-01-05"
---
::: callout-note
## Før du går i gang

En aktivitet hører altid til en **klasse**. Hvis du ikke har oprettet en
klasse endnu, så følg vejledning *T1 — Opret en klasse og del den* først, og
kom så tilbage hertil. Denne vejledning tager cirka fem minutter.

Har du travlt? Kortet **Kom i gang** på *Klasser* tilbyder **Hent fra
biblioteket**. Det åbner **Delt af kolleger** på *Aktiviteter*, hvor **Kopiér
til mine aktiviteter** kopierer en kollegas aktivitet ind i dit bibliotek som
kladde; **Tildel** sætter den derefter i din klasse — uden byggeren. Kom
tilbage hertil, når du vil lave din egen.
:::

## Hvad en aktivitet er

En **aktivitet** er en enkelt guidet opgave, som dine elever åbner i tutoren.
Du sætter undervisningsmålet og eventuelt et arbejdsområde — en simulation, en
tabel, en graf, en beregner eller vejledende noter. Elever tilslutter sig med
klassens gruppekode og arbejder sig gennem aktiviteten i samtale med
AI-fysiktutoren, som følger det mål, du har sat.

Du behøver ikke skrive nogen kode, og du behøver ikke en udvikler. Alt på denne
side gøres i din browser.

::: callout-tip
## Vil du hellere beskrive det i ord?

Byggeren har en AI-**medbygger** (**Hjælp** → **Medbygger**). Fortæl den, hvad du vil
undervise i, og den udkaster et undervisningsmål og elementer til
arbejdsområdet, som du kan redigere og anvende — se *T4 — Byg med
AI-medbyggeren*. Hvert trin nedenfor kan også gøres af medbyggeren, ikke kun i
hånden.
:::

## Trin 1 — Åbn aktivitetsbyggeren

Fra dit lærerområde åbner du **Aktiviteter** og vælger **Ny aktivitet**. (Du
kan også starte fra en klasse: på klassesidens fane **Opsætning** åbner du
**Tilføj aktivitet** og vælger **Opret ny aktivitet…**, som forvælger den
klasse for dig.)

![Aktivitetsbyggeren åbner med en skabelonvælger øverst og en live-forhåndsvisning til højre.](/guides/assets/t2-01-new-activity.png)

## Trin 2 — Vælg et udgangspunkt

Øverst i byggeren vælger du, hvordan du vil starte: **Start fra en skabelon**
eller **Start helt forfra**. En skabelon åbner en række færdige aktiviteter;
klik på en tæt på det, du vil have — den udfylder en fornuftig
startkonfiguration, og forhåndsvisningen ved siden af viser, hvad eleverne vil
se. Valget skrumper derefter til én linje (*Skabelon: …*) med **Skift**, hvis
du vil have en anden. Du kan ændre alt bagefter, så valget er ikke bindende.

## Trin 3 — Sæt undervisningsmålet

Byggeren har fire afsnit: **Opsætning**, **Lektion**, **Arbejdsområde** og
**Materialer**. Under **Opsætning** skriver du et navn i feltet **Aktivitetens
navn**. Under **Lektion** udfylder du **Lektionens mål (undervisningsmålet)**.
Målet er det vigtigste felt: det er den instruktion, tutoren følger,
når den taler med dine elever. Skriv det, som du ville briefe en
undervisningsassistent — for eksempel *"Hjælp eleven med at ræsonnere om
energibevarelse på en friktionsfri rampe; giv ikke det endelige svar, stil
vejledende spørgsmål."*

Under **Opsætning** sætter du også **Elevernes sprog** — det sprog, eleverne ser
aktiviteten på, og som tutoren svarer på. (En elev kan stadig selv skifte
DA | EN.) Selve tutoren kommer fra klassen (vejledning *T1*); rækken **Tutor**
i oversigten øverst i byggeren viser, hvilken tutor der underviser, med **Skift
i klassen** for at skifte den dér.

![Undervisningsmålet er den instruktion, tutoren følger. Hold det specifikt.](/guides/assets/t2-03-goal.png)

Samme oversigt har rækken **Eleverne ser først**. Dens **Skift** åbner **Det
første eleverne ser**, hvor du kan skrive en elevintroduktion, vælge selv at
introducere aktiviteten i klassen og skrive startspørgsmål. Lad felterne være
tomme for at bruge de aktivitetsspecifikke standarder. Forhåndsvisningen
opdateres, mens du redigerer. Se [T5 — Introducer tutoren](t5-introduce-the-tutor.da).
(Rækken **Elevvisning** ved siden af bestemmer, hvordan elevernes skærm er
stillet op.)

## Trin 4 — Tilføj et arbejdsområde (valgfrit)

Afsnittet **Arbejdsområde** starter tomt og viser kun det, du tilføjer. Vælg
**Tilføj til arbejdsområdet**, og vælg i oversigten over elementtyper — en
simulation, en tjekliste, en tabel at udfylde, en graf, en beregner, noter og
mere. Vælger du **Simulation**, åbner en vælger med de tilgængelige
simulationer. Hvert element, du tilføjer, vises som et kort med **Redigér**;
dets **⋯**-menu fjerner det. Du kan også lade arbejdsområdet stå tomt for en
ren chat-baseret begrebsdialog. **Live-forhåndsvisningen** til højre
opdateres, efterhånden som du tilføjer hvert element, så du ser præcis, hvad
eleven vil se.

::: callout-tip
Alt, hvad eleven gør i arbejdsområdet — værdier de indtaster, en simulation de
kører — deles med tutoren, så den kan reagere på deres faktiske arbejde.
:::

::: callout-note
## Vil du bygge din egen simulation?

Tag udgangspunkt i den faste prompt til at bygge simuleringer, ikke i en tom
chat. Kopiér den fra <https://aipla.ku.dk/project/build-a-simulation>, eller
giv din AI-chat den rene tekstfil <https://aipla.ku.dk/sim-authoring-prompt.txt>.
En simulation bygget ud fra den giver tutoren besked, når eleven tager en
måling eller gennemfører en mission, så tutoren reagerer, uden at du skal
skubbe til den. Og dens kontrolpaneler kan foldes sammen, så de ikke dækker
simuleringen på en bærbar eller en telefon. En simulation bygget uden prompten
kan sagtens fungere godt og alligevel mangle begge dele.
:::

![Live-forhåndsvisningen viser elevens visning, mens du bygger.](/guides/assets/t2-04-elements.png)

## Trin 5 — Opret aktiviteten

Når du er tilfreds med forhåndsvisningen, vælger du **Opret aktivitet**. En kort
besked bekræfter, at aktiviteten er oprettet og tilgængelig for din klasse — den
tilbyder også **Opret en til**, så du kan starte en ny aktivitet til den samme
klasse — og aktiviteten åbner i editoren.

![Aktiviteten er nu live; elever, der tilslutter sig med klassens gruppekode, kan åbne den.](/guides/assets/t2-05-success.png)

I editoren kan du tilføje pensummaterialer eller finjustere målet (se *T3 —
Tilføj og organiser pensummaterialer*) og vælge **Gem**. En linje under titlen
viser, hvornår aktiviteten blev oprettet og sidst redigeret. **Prøv som elev**
øverst åbner den rigtige elevvisning i en ny fane, med tutor og uden
gruppekode.

## Hvad elever ser

Elever åbner aktiviteten fra klassens gruppekode (intet login, ingen personlig
konto — se *S1 — Tilslut dig og brug din tutor*). De får tutoren og, hvis du
tilføjede et, arbejdsområdet. Tutoren følger det mål, du har sat, og kan se det
arbejde, eleven laver i arbejdsområdet.

## Næste skridt

- Tilføj pensummaterialer, så tutoren kan forankre sine svar i dine
  materialer — *T3*.
- Lad AI-medbyggeren udkaste en aktivitet ud fra en beskrivelse i almindeligt
  sprog — *T4 — Byg med AI-medbyggeren*.

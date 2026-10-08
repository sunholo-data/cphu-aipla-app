---
title: "Spørgsmål fra lærere"
description: "Korte svar på de spørgsmål, lærerne har stillet om AIPLA indtil nu: aktiviteter, dokumenter, gruppekoder, sprog, tutorer, data og rettigheder."
eyebrow: "Til lærere"
owner: "AIPLA project team"
reviewed: "2026-10-08"
reviewBy: "2026-11-08"
status: "Provisional"
order: "91"
nav: "false"
---
# Spørgsmål fra lærere

Her er de spørgsmål, lærerne har stillet i løbet af piloten, de fleste ved seminaret den 5. oktober 2026. Hvert svar beskriver, hvordan platformen fungerer i dag, og henviser til den vejledning eller side, hvor du finder detaljerne.

Siden er foreløbig. Svarene om ophavsret, rettigheder, databeskyttelse og udrulning beskriver, hvad platformen gør. De er ikke universitetets juridiske vurdering.

Vejledningerne under */guides* findes på dansk. Projektsiderne under */project* findes kun på engelsk. Den engelske udgave af denne side hedder [Teacher questions](/project/teacher-faq).

## Aktiviteter

### Hvor nemt er det at lave en aktivitet?

Det er nemt, og du skal ikke skrive kode. Ifølge vejledningen tager den første aktivitet omkring fem minutter. Du giver den et navn og et undervisningsmål (den instruks, tutoren arbejder efter), vælger elevernes sprog og kan tilføje et arbejdsområde: en simulering, en tjekliste, en tabel, en graf, en lommeregner eller et skrivefelt. **Prøv som elev** viser dig præcis det, eleverne ser.

Det går hurtigere, hvis du starter fra en skabelon. Du kan også hente en kollegas delte aktivitet i biblioteket og få din egen kopi, som du kan rette i. Eller du kan beskrive aktiviteten med dine egne ord og lade AI-medbyggeren lave et udkast. Du ser forslaget igennem, før du selv vælger at bruge det.

Læs mere: [T2 — Opret din første aktivitet](/guides/t2-create-your-first-activity.da), [T4 — Byg med AI-medbyggeren](/guides/t4-author-with-the-copilot.da).

### Kan vi uploade dokumenter, som tutoren kan bruge?

Ja. Under **Materialer** kan du uploade en PDF, en Word-fil, slides, et regneark, ren tekst eller et billede. Du kan også henvise til et dokument i det fælles bibliotek. AIPLA viser dig den tekst, der er trukket ud af filen, så du kan se, om den er læst rigtigt.

For hvert dokument i en aktivitet vælger du to ting:

- **Eleverne kan åbne den / Kun tutoren.** Nye dokumenter starter som **Kun tutoren**. Tutoren bruger dem, men eleverne kan ikke åbne dem.
- **Opslag / I kontekst.** Med Opslag slår tutoren op i dokumentet, når det er relevant. Med I kontekst har tutoren hele teksten ved hver besked. Brug I kontekst til den opgave, eleverne arbejder med.

Læs mere: [T3 — Tilføj og organiser pensummaterialer](/guides/t3-add-curriculum-materials.da).

### Hvorfor kan mine elever ikke åbne et dokument?

Fordi det ikke er delt med dem. Et dokument er **Kun tutoren**, indtil du klikker på knappen ud for det i aktivitetens materialer, så der står **Eleverne kan åbne den**. Eleverne kan se navnene på de dokumenter, de ikke har adgang til, med en besked om, at læreren ikke har delt indholdet.

Når du har delt dokumenter, er det første allerede åbent, når eleverne starter aktiviteten. Rækkefølgen er den, du har tilføjet dokumenterne i, og i byggeren står der **Åbnes først for eleverne** ved det dokument. Har du delt flere, skifter eleverne mellem dem med faneblade. Når tutoren nævner et delt dokument, linker den til det, så eleven kan åbne det med ét klik. Den linker aldrig til et dokument, du ikke har delt.

### Hvad sker der, hvis upload af et dokument fejler?

Det kan du se. Ved hvert dokument står der **Klar — tutoren kan læse den**, **Behandles…** eller **Fejlede — tutoren kan ikke læse den**. AIPLA prøver automatisk igen, og du kan selv trykke **Prøv igen**. Har en aktivitet et dokument, der er fejlet, vises en advarsel på aktivitetens kort og i klassevisningen, så du opdager det inden timen. Hjælper det ikke at prøve igen, kan du uploade filen igen under Materialer.

### Kan vi lave vores egne simuleringer?

Ja, uden at skrive kode, men ikke i aktivitetsbyggeren. Du laver et udkast til simuleringen i en AI-chat (Claude, ChatGPT, Gemini eller Copilot) med AIPLA's forfatterprompt, prøver den af i en browser og sender de to filer, du får, til projektgruppen. Gruppen kobler simuleringen til tutoren og tjekker sikkerhed, størrelse og visning på mobil. En fysikfaglig bedømmer godkender fysikken. Derefter ligger den i biblioteket, og alle lærere kan bruge den i deres aktiviteter.

Det vigtigste spørgsmål, når du foreslår en simulering, er: *hvad måler eleven, og hvad skal de regne ud på baggrund af det?*

Læs mere: [Build a simulation with an AI chat](/project/build-a-simulation) (på engelsk).

### Hvilke simuleringer findes der?

Der er ni: Boldkast, LED Planck, KineBot, Elkedel, Faseovergange, Bølgefart, Interferens, Sol, Jord og Måne samt Sekantbænk. De åbner alle ved siden af tutoren. Eleven ændrer på noget, aflæser instrumenterne og noterer målinger, og tutoren ser målingerne og kan spørge ind til dem. En simulering viser aldrig den værdi, eleven skal regne sig frem til.

I Sol, Jord og Måne kan tutoren også ændre det, eleven ser, og hver ændring står på et kort i chatten. En simulering starter forfra med standardindstillingerne en anden dag. Målinger, der skal gemmes, skal derfor stå i en tabel i aktiviteten.

Læs mere: [Activities and examples](/project/activities) (på engelsk).

### Sender tutoren eleverne over til simuleringen og arbejdsområdet?

Det er den blevet bedt om. Tutoren får en oversigt over, hvad der er i aktivitetens arbejdsområde, og besked om at henvise eleverne dertil, når det kan hjælpe dem. Går der nogle svar, uden at den gør det, bliver den mindet om det. Er der en simulering, nævner den simuleringen først i sin første besked. Det blev ændret efter seminaret i oktober, hvor tutoren blev hængende i samtalen. Vi måler nu, om den henviser ofte nok.

## Gruppekoder og elever

### Hvordan virker gruppekoder, og kan flere elever bruge den samme?

En gruppekode er en kort kode (to ord og et tal), som eleverne bruger til at komme ind i din klasse uden en konto. Du laver så mange, du har brug for, på klassens side. Giv eleverne **tilmeldingslinket**, for en kode virker kun på det site, den er lavet på. Koderne er beregnet til grupper: privatlivspolitikken taler om grupper på mindst tre. Der findes ikke en indstilling, hvor hver elev får sin egen samtale.

Bruger flere enheder samme kode i samme aktivitet, deler de **én samtale**:

- Alle enheder viser hele samtalen. En besked fra en gruppekammerats enhed er markeret med **Sendt fra en anden enhed i din gruppe**, og eleverne kan se, hvor mange fra gruppen der er med.
- Tutoren får én besked ad gangen. Sender to elever samtidig, venter den anden besked og bliver sendt af sig selv bagefter.
- Tutoren læser alle beskeder fra alle enheder og ved, at samtalen er fælles.

Hver aktivitet har sin egen samtale. Går gruppen videre til en anden aktivitet, starter de en ny.

Læs mere: [T1 — Opret en klasse og del den](/guides/t1-set-up-a-class.da), [S1 — Tilslut dig og brug din tutor](/guides/s1-join-and-use-your-tutor.da).

### En elevs kode virker ikke. Hvad gør jeg?

Tjek først, at eleven har brugt tilmeldingslinket til det rigtige site. Har eleven tastet et af ordene forkert, foreslår AIPLA måske den rigtige kode (**Mente du …?**). Tallene gætter den aldrig på. En kode, der er udløbet eller tilbagekaldt, giver samme besked som en kode, der ikke findes. Så skal eleven have en ny kode af dig.

### Hvad sker der med elevernes arbejde, hvis jeg tilbagekalder en kode?

Når du tilbagekalder en kode, holder den op med at virke. Elever, der bruger den, bliver logget ud ved deres næste besked, og koden kan aldrig udstedes igen. **Gruppens arbejde bliver gemt.** Koden flyttes til listen **Tilbagekaldte koder** på klassens side, og dens rapporter er stadig åbne for dig og for forskergruppen. Der bliver ikke slettet noget.

Sletter du hele klassen, er det noget andet: så har du ikke længere adgang til dens aktiviteter og rapporter. Det er dog ikke det samme som at slette data. Vil du have data slettet, skal du kontakte projektet (se [privatlivspolitikken](/privacy)).

### Kan eleverne starte samtalen forfra eller gemme det, tutoren har skrevet?

Det er kun dig, der kan starte en gruppes samtale forfra, med **Nulstil session** på klassens side. Beder en elev tutoren om at starte forfra, svarer tutoren, at det bestemmer læreren. I stedet tilbyder den at opsummere det, gruppen er nået frem til.

Under hvert svar fra tutoren er der en knap, **Gem som noter**. Den sætter svaret ind nederst i aktivitetens skrivefelt under overskriften "Noter fra tutoren" og rører ikke elevens egen tekst. Har aktiviteten ikke et skrivefelt, bliver svaret kopieret, så eleven kan sætte det ind et andet sted.

Tutoren kender heller ikke klassens regler eller skema. Spørger eleverne om pauser, om de må gå, eller om karakterer, svarer den, at det bestemmer læreren.

## Sprog

### Virker det både på dansk og engelsk?

Ja:

- Hver aktivitet har et **elevsprog**. Det bestemmer, hvilket sprog eleverne ser, og hvilket sprog tutoren svarer på. Sproget står på aktivitetens kort (**Elever: dansk** eller **Elever: engelsk**), og byggeren gør dig opmærksom på det, hvis der fx står en dansk titel på en engelsk aktivitet.
- Eleverne kan selv vælge DA eller EN øverst på siden. Valget gælder knapperne, tutoren og oplæsningen.
- Lærere og forskere vælger deres eget sprog med DA | EN-knappen.
- Vejledningerne findes på begge sprog. Projektsiderne er på engelsk.

Læs mere: [T2 — Opret din første aktivitet](/guides/t2-create-your-first-activity.da), [S1 — Tilslut dig og brug din tutor](/guides/s1-join-and-use-your-tutor.da).

## Tutorer og vurdering

### Hvem kan se de tutorer og undervisningstilgange, jeg laver?

Alle lærere kan skrive en undervisningstilgang og lave en tutor ud fra den. **Privat** betyder skjult for andre lærere, men synlig for forskergruppen. Forskerne kan se, hvem der har lavet hver tutor og tilgang, også ophavspersonens e-mail, og de kan redigere dem. **Delt** gør den tilgængelig for andre lærere.

Læs mere: [T1 — Opret en klasse og del den](/guides/t1-set-up-a-class.da), [Teaching frameworks](/project/tutors) (på engelsk).

### Hvad bliver der vurderet i en session?

Det er **tutoren, ikke eleverne**, der bliver vurderet. En AI læser sessionen og vurderer, hvor godt tutorens træk fulgte tutorens undervisningstilgang. Elevernes beskeder indgår som baggrund og bliver ikke vurderet.

- **Lærere** ser afsnittet **Undervisningstilgang** i en gruppes rapport. Det beskriver, hvordan tutoren brugte tilgangen, og hvor den afveg. Der er hverken niveauer eller karakterer.
- **Forskere** ser for hver del af tilgangen et niveau (fraværende, delvist eller stærkt), de regler, niveauerne bygger på, og de beskeder, vurderingen bygger på, med citater. De kan skrive en rettelse ved siden af AI'ens vurdering, som bliver gemt.

Læs mere: [Teaching frameworks](/project/tutors) (på engelsk) beskriver de tilgange, der vurderes ud fra.

## Modeller, data og rettigheder

### Kan lokale modeller løse problemet med ophavsret?

Der bruges ikke lokale modeller i dag. Tutoren bruger Googles Gemini-modeller gennem Vertex AI i Googles EU-region, og Google må ikke bruge data til at træne sine modeller. Evalueringen fra oktober 2026 fandt to åbne modeller, der kan køre på én GPU og er præcise nok. De er dog endnu ikke målt på den hardware, projektet ville køre dem på. Det flytter heller ikke det hele at flytte modellen, for dokumentkonvertering og søgning i undervisningsmateriale er separate tjenester. Om selve ophavsretten: se næste spørgsmål.

Læs mere: [Data, privacy, and hosting](/project/data-and-hosting), [Capability floor](/project/evaluation/capability-floor) (begge på engelsk).

### Ophavsret: må vi uploade udgivet materiale?

Projektet har endnu ikke offentliggjort, hvilket udgivet materiale der må uploades. Sådan behandler platformen en upload i dag:

- Den ligger i **dit eget bibliotek**. Andre lærere kan ikke se den, men forskergruppen kan.
- Den starter som **Kun tutoren**. Eleverne kan kun åbne den, hvis du deler den i en aktivitet.
- Det **fælles bibliotek** indeholder kun materiale, som forskergruppen har markeret som rettighedsafklaret. Lærere kan ikke lægge noget derind.
- For at tutoren kan læse filen, bliver den lavet om til tekst af AILANG Parse (drevet af Sunholo) i Belgien. Teksten bliver gemt og gjort søgbar i Belgien, og selve filen bliver gemt i Finland. AIPLA gemmer også et AI-skrevet resumé af hvert dokument.
- Google må ikke bruge materialet til at træne sine modeller.
- Du kan slette et dokument fra dit bibliotek med skraldespandsikonet.

Er du i tvivl om et dokument, så spørg projektet, før du uploader det.

Universitetets formelle vurdering er under udarbejdelse; kontakt projektet ved tvivl.

### Hvem har rettighederne til det, lærere uploader og laver?

Der er endnu ikke offentliggjort noget dokument fra AIPLA om ejerskab eller licens til lærernes materiale. Sådan fungerer platformen i dag:

- Aktiviteter, tutorer, tilgange og uploads er **private for dig**, indtil du deler dem. Forskergruppen kan se private tutorer og tilgange.
- Deler du en aktivitet, kan andre lærere hente den. De får deres egen kopi, som de kan rette i, og AIPLA registrerer, hvilken aktivitet kopien stammer fra.
- En simulering, du sender til projektgruppen, bliver bearbejdet af gruppen og derefter gjort tilgængelig for alle lærere.
- Klasser, aktiviteter og elevarbejde bliver gemt, indtil du sletter dem, eller projektet slutter.

Universitetets formelle vurdering er under udarbejdelse; kontakt projektet ved tvivl.

### GDPR: hvad med elevernes gruppekoder?

En gruppekode er en nøgle til klassens aktiviteter, ikke en identitet. Den er ikke knyttet til et navn, en e-mail eller en enhed, og eleverne har ikke en konto i AIPLA. Den er heller ikke et samtykke til at deltage i forskning. Alle, der har koden, kan komme ind, så tilbagekald den, hvis den slipper ud.

Sådan fungerer platformen i dag:

- **Hvad der gemmes:** det, gruppen skriver, tutorens svar, og hvad gruppen gør i arbejdsområdet. Det bruges i forskningsprojektet. Tale til tutoren bliver lavet om til tekst og gemmes ikke som lyd. Hele lektioner optages kun, hvis du slår det til, og kun med underskrevne samtykkeerklæringer.
- **Ingen navne:** eleverne får at vide, både i privatlivspolitikken og i chatten, at de ikke må skrive navne eller CPR-numre og ikke må uploade billeder af sig selv. Fører du en klasseliste over, hvem der har hvilken kode, bliver den i din browser, og AIPLA modtager den aldrig.
- **Hvem der kan se en gruppes sessioner:** du som klassens lærer og forskergruppen.
- **Hvor:** i EU. Applikationen, databasen, filerne og forskningsloggen ligger i Finland, samtalehistorik og søgning i undervisningsmateriale ligger i Belgien, og AI-modellerne kører i Googles EU-region. Det eneste, der bruger Googles globale tjeneste, er lærernes login.
- **Hvor længe:** tekniske logfiler i 30 dage og forskningsloggen over chat i 365 dage. Klasser, aktiviteter og elevarbejde gemmes, indtil du sletter dem, eller projektet slutter.
- **Hvem der har ansvaret:** Københavns Universitet er dataansvarlig, og Google Cloud og Sunholo er databehandlere.

Privatlivspolitikken er et udkast, som afventer gennemgang hos universitetets juridiske afdeling og databeskyttelsesrådgiver.

Universitetets formelle vurdering er under udarbejdelse; kontakt projektet ved tvivl.

Læs mere: [Privatlivspolitik](/privacy), [Data, privacy, and hosting](/project/data-and-hosting) (på engelsk).

### Hvornår bliver det rullet ud?

Den offentliggjorte tidsplan:

- forskningsprojektet løber fra 2026 til 2028;
- lærerpiloten begyndte i midten af august 2026;
- arbejdet med platformen fortsætter til mindst april 2027.

De næste milepæle er offentliggjort uden datoer: først gennemgår lærerne platformen senere i efteråret, og derefter følger lærerworkshops og brug i klasserne. Bredere forsøg med elever afhænger af de nødvendige databehandleraftaler, og privatliv, samtykke og hosting bliver besluttet for hver fase af undersøgelsen.

Universitetets formelle vurdering er under udarbejdelse; kontakt projektet ved tvivl.

Læs mere: [Build timeline](/project/progress#next-checkpoints) (på engelsk).

### Kan vi bruge det i andre fag?

AIPLA er et forskningsprojekt i fysik, og tutorerne, simuleringerne og evalueringen er lavet til fysik. Den første matematiksimulering, Sekantbænk, ligger i biblioteket, og dokumenter kan sorteres efter fag. Det er endnu ikke besluttet, om lærere fra andre fag kan være med i piloten. Spørg projektet.

Læs mere: [About AIPLA](/project/about) (på engelsk).

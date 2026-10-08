---
title: "Spørgsmål fra lærere"
description: "Korte svar på de spørgsmål, lærerne stillede ved seminaret i oktober 2026, hver med henvisning til den side, svaret kommer fra — og med de åbne spørgsmål markeret som åbne."
eyebrow: "Til lærere"
owner: "AIPLA project team"
reviewed: "2026-10-08"
reviewBy: "2026-11-08"
status: "Provisional"
order: "91"
nav: "false"
---
# Spørgsmål fra lærere

Det her er de spørgsmål, lærerne stillede ved AIPLA-seminaret den 5. oktober 2026. Hvert svar er hentet fra en side, der allerede findes, og linker til den.

Fire spørgsmål har endnu ikke et svar: ophavsret til uploadede dokumenter, rettigheder til det, lærere uploader, databeskyttelse for elevernes gruppekoder og tidsplanen for udrulning. De er markeret **Afventer svar**, med de fakta, der allerede ligger, listet nedenunder. De svar kommer fra projektledelsen og Københavns Universitet, ikke fra denne side.

Siderne, der henvises til under */project*, findes kun på engelsk. Vejledningerne under */guides* findes på dansk. Den engelske udgave af denne side er [Teacher questions](/project/teacher-faq).

## At bygge aktiviteter

### Hvor nemt er det at tilføje aktiviteter?

En aktivitet sættes op i browseren, uden kode og uden en udvikler. Vejledningen regner med omkring fem minutter til den første. Du giver den et navn og et undervisningsmål (den instruks, tutoren følger), vælger elevernes sprog og kan tilføje et arbejdsområde: en simulering, en tjekliste, en tabel, en graf, en lommeregner eller noter. En live-forhåndsvisning viser, hvad eleverne vil se, og **Prøv som elev** åbner den rigtige elevvisning.

Der er tre genveje:

- **Start fra en skabelon** øverst i byggeren.
- **Hent fra biblioteket** kopierer en kollegas delte aktivitet ind i din klasse med ét klik.
- AI-**medbyggeren** laver et udkast til mål og arbejdsområde ud fra en almindelig beskrivelse. Du gennemgår forslaget og anvender det selv.

Kilder: [T2 — Opret din første aktivitet](/guides/t2-create-your-first-activity.da), [T4 — Byg med AI-medbyggeren](/guides/t4-author-with-the-copilot.da), [Project decisions](/project/decisions#june-2026-teachers-approve-ai-proposed-changes).

### Kan vi uploade dokumenter, som tutoren kan bruge?

Ja. I en aktivitets **Materialer**-sektion, eller under **Materialer** i lærermenuen, kan du uploade en PDF, en Word-fil, slides, et regneark, ren tekst eller et billede. AIPLA viser den tekst, den fik ud af dokumentet, så du kan tjekke, at det blev læst rigtigt. Du kan også henvise til dokumenter fra det delte materialebibliotek.

For hvert dokument vælger du:

- **Synlig / Skjult.** Et skjult dokument forankrer kun tutorens svar, mens et synligt også vises for eleverne. **Nye dokumenter starter som skjulte.**
- **Opslag / I kontekst.** Med Opslag slår tutoren dokumentet op, når det er relevant. Med I kontekst får den hele teksten ved hver besked.

Dine egne uploads bliver i dit eget bibliotek. Kun forskere kan lægge et dokument i det delte bibliotek.

Kilde: [T3 — Tilføj og organiser pensummaterialer](/guides/t3-add-curriculum-materials.da).

### Kan vi lave vores egne simuleringer?

Ja, uden at skrive kode, men ikke direkte i aktivitetsbyggeren. En lærer eller en fysikfaglig medarbejder laver et udkast til simuleringen i en AI-chat (Claude, ChatGPT, Gemini, Copilot) med AIPLA's forfatterprompt, prøver den i en browser og sender de to filer, den giver, til projektgruppen. Gruppen kobler den til tutoren og kører tjekkene for sikkerhed, størrelse og mobilbredde. En fysikfaglig bedømmer godkender fysikken, før den bliver udgivet. Derefter ligger den i biblioteket, og alle lærere kan sætte den på en aktivitet.

Det vigtigste spørgsmål, når man foreslår en simulering, er: *hvad måler eleven, og hvad regner de ud fra det?*

Kilder: [Build a simulation with an AI chat](/project/build-a-simulation), [T2 — Opret din første aktivitet](/guides/t2-create-your-first-activity.da).

### Hvilke simuleringer findes der, og hvad gør de?

Ni er i brug: Boldkast, LED Planck, KineBot, Elkedel, Faseovergange, Bølgefart, Interferens, Sol, Jord og Måne samt Sekantbænk. Hver af dem åbner ved siden af tutoren. Eleven ændrer noget, aflæser instrumenterne og gemmer målinger, og tutoren ser målingerne og kan spørge ind til dem. En simulering viser aldrig den værdi, eleven skal regne ud.

I Sol, Jord og Måne kan tutoren også ændre det, eleven ser, for eksempel ved at springe til den næste formørkelse. Et kort i chatten nævner hver ændring, den laver. De andre simuleringer kan tutoren følge med i, men ikke ændre.

Godt at vide: en simulering åbner med sine standardindstillinger en anden dag, så målinger, der skal gemmes, hører hjemme i en tabel i aktiviteten. En simulering kan heller ikke hente noget fra internettet.

Kilder: [Build a simulation with an AI chat](/project/build-a-simulation), [Activities and examples](/project/activities), [Build timeline](/project/progress#october-2026-tutors-that-can-act-on-a-simulation).

### Kan vi bruge det i andre fag?

AIPLA er et forskningsprojekt i fysik, og alt, der er udgivet indtil nu, handler om fysik. Nogle fakta, der ligger:

- Den første matematiksimulering, Sekantbænk, ligger i biblioteket.
- Dokumenter i materialebiblioteket kan sorteres efter fag.
- Evalueringen af modellerne dækker ét fag (fysikeksamensopgaver) og skriver, at andre opgaver ville kræve deres egne målinger.

**Ikke besvaret endnu:** ingen af de eksisterende sider siger, om lærere i andre fag kan være med i piloten. Det kræver en beslutning fra projektet.

Kilder: [About AIPLA](/project/about), [Build a simulation with an AI chat](/project/build-a-simulation), [T3 — Tilføj og organiser pensummaterialer](/guides/t3-add-curriculum-materials.da), [Capability floor](/project/evaluation/capability-floor).

## Sprog og modeller

### Virker det på engelsk og dansk?

Ja, for skærmene:

- Elev- og lærerskærme findes på både dansk og engelsk.
- Hver aktivitet har et **Elevernes sprog**, som bestemmer det sprog, eleverne ser, og det sprog, tutoren svarer på. En elev kan stadig selv skifte DA | EN.
- Lærere og forskere vælger deres eget sprog med DA | EN-knappen.
- Vejledningerne findes på begge sprog.

Projektsiderne under */project* er på engelsk og linker til Københavns Universitets officielle AIPLA-sider på dansk og engelsk.

Kilder: [Build timeline](/project/progress#september-2026-tutors-that-carry-their-teaching-approach), [T2 — Opret din første aktivitet](/guides/t2-create-your-first-activity.da), [Platform](/project/platform).

### Kan lokale modeller løse ophavsretsspørgsmålet?

Her er, hvad der ligger om, hvor AI'en kører:

- **I dag** bruger tutoren Googles Gemini-modeller gennem Vertex AI, og forespørgslerne går til EU-endpointet. Efter Google Clouds vilkår må Google ikke bruge data til at træne sine modeller.
- **Lokale modeller bruges ikke.** Platformen er bygget, så modelkørslen kan flyttes. Evalueringen fra oktober 2026 fandt, at to åbne modeller, der kan køre på én GPU (Qwen 3.8 27B og Gemma 4 31B), når nøjagtighedstærsklen. De blev målt gennem en hostingtjeneste, ikke på projektets egen hardware. Næste skridt er at måle en af dem på den hardware, der skulle køre den.
- **At flytte modellen flytter ikke alt.** Privatlivspolitikken angiver dokumentkonvertering og søgning i undervisningsmateriale som særskilte tjenester, og det samme gør hostingsiden. At flytte modelkørslen ændrer ikke i sig selv, hvor uploads gemmes og behandles.

**Ikke besvaret endnu:** om lokale modeller ændrer ophavsretsstillingen for uploadet materiale. Det hører til ophavsretsspørgsmålet nedenfor.

Kilder: [Data, privacy, and hosting](/project/data-and-hosting), [Capability floor](/project/evaluation/capability-floor), [Privatlivspolitik](/privacy).

## Afventer svar

### Ophavsret: må vi uploade udgivet materiale?

**Afventer svar fra projektledelsen og KU.**

Fakta, der ligger:

- Lærere kan uploade PDF, Word, slides, regneark, ren tekst og billeder. ([T3](/guides/t3-add-curriculum-materials.da))
- Hvert dokument i materialebiblioteket har en rettighedsstatus (`copyrightStatus`): `teacher_owned`, `cleared` eller `pending`. En lærers egen upload registreres som `teacher_owned`. Kun en forsker kan lægge et dokument i det delte bibliotek, og kun et, der er markeret `cleared`. (Produktets adfærd.)
- Nye dokumenter, der henvises til, starter som **Skjult**: de forankrer tutorens svar uden at blive vist for eleverne. ([T3](/guides/t3-add-curriculum-materials.da))
- En upload konverteres til tekst af AILANG Parse, drevet af Sunholo, i Belgien. Teksten gemmes og indekseres til søgning i undervisningsmateriale i Belgien, og filer og uploads gemmes i Finland. ([Privatlivspolitik](/privacy))
- AIPLA gemmer også et AI-skrevet resumé af hvert uploadet dokument, som medbyggeren bruger til at vurdere, om det er relevant. (Produktets adfærd.)
- Google må ikke bruge data til at træne sine modeller. ([Privatlivspolitik](/privacy))
- En lærer kan slette et dokument fra sit bibliotek. ([T3](/guides/t3-add-curriculum-materials.da))
- Forlængelsens erklærede fokus er "curriculum grounding on **cleared** material", altså forankring i pensummateriale, der er rettighedsafklaret. ([Workstreams](/project/workstreams))
- Den eneste rettighedsstilling, der er udgivet indtil nu, dækker de eksamensopgaver, der bruges i evalueringen af modellerne, under forskningsundtagelsen i ophavsretslovens § 11 c. ([Evaluation](/project/evaluation), [Capability floor](/project/evaluation/capability-floor))

### Hvem har rettighederne til det, lærere uploader og laver?

**Afventer svar fra projektledelsen og KU.**

Fakta, der ligger:

- En lærers uploads bliver i lærerens eget bibliotek, medmindre en forsker lægger dem i det delte bibliotek. ([T3](/guides/t3-add-curriculum-materials.da))
- Aktiviteter kan deles, hentes, kopieres og forgrenes, og oprindelsen gemmes. En lærer, der henter en aktivitet, får sin egen redigerbare kopi. ([Project decisions](/project/decisions#june-2026-activities-are-reusable-resources))
- Lærere kan lave deres egne tutorer og undervisningstilgange og holde dem private eller dele dem. ([Workstreams](/project/workstreams))
- En simulering, som en medarbejder har lavet et udkast til, sendes til projektgruppen, bearbejdes og lægges derefter i biblioteket, hvor alle lærere kan sætte den på en aktivitet. ([Build a simulation with an AI chat](/project/build-a-simulation))
- Klasser, aktiviteter og elevarbejde gemmes, indtil læreren sletter dem, eller projektet slutter. ([Privatlivspolitik](/privacy))
- Siden med brugsvilkår er stadig pladsholderen fra v0.1-udkastet og siger intet om ejerskab. ([Vilkår](/terms))

### GDPR: hvad med elevernes gruppe-ID'er?

**Afventer svar fra projektledelsen og KU.**

Fakta, der ligger:

- Elever logger ind med en gruppekode fra læreren og har ingen personlig AIPLA-konto. Lærere og forskere gennemgår gruppesessioner, ikke personlige elevprofiler. ([Project decisions](/project/decisions#may-2026-students-join-as-groups))
- Privatlivspolitikken siger, at eleverne er anonyme, logger ind i grupper på mindst tre, og at der ikke indsamles navne, e-mails eller andre identifikatorer. ([Privatlivspolitik](/privacy))
- AIPLA gemmer det, gruppen skriver, tutorens svar, og hvad gruppen gør i arbejdsområdet. Det bruges i forskningsprojektet. ([Privatlivspolitik](/privacy))
- Eleverne får at vide, både i politikken og i deres chat, at de ikke må skrive navne eller CPR-numre og ikke må uploade dokumenter eller billeder med navne, CPR-numre eller af sig selv. ([Privatlivspolitik](/privacy))
- Tale til tutoren omdannes til tekst og gemmes ikke som lyd. En hel lektion optages kun, hvis læreren slår det til, og kun med underskrevne samtykkeerklæringer. ([Privatlivspolitik](/privacy))
- Hvor data ligger: applikation, database, filer, uploads, logfiler og forskningsloggen ligger i Finland. Samtalehistorik og søgning i undervisningsmateriale ligger i Belgien. AI-modellerne kører i Googles EU-region. Lærerlogin bruger Googles globale tjeneste. ([Privatlivspolitik](/privacy))
- Hvor længe data gemmes: tekniske logfiler i 30 dage og forskningsloggen over chat i 365 dage. Klasser, aktiviteter og elevarbejde gemmes, indtil læreren sletter dem, eller projektet slutter. ([Privatlivspolitik](/privacy))
- Københavns Universitet er dataansvarlig. Google Cloud og Sunholo er databehandlere. ([Privatlivspolitik](/privacy))
- En gruppekode giver teknisk adgang til en aktivitet. Den er ikke i sig selv samtykke til forskning. ([Data, privacy, and hosting](/project/data-and-hosting#consent-and-research-participation))
- Lærere kan føre en klasseliste med navne, som aldrig forlader deres egen enhed. ([Build timeline](/project/progress#september-2026-tutors-that-carry-their-teaching-approach))
- Privatlivspolitikken er selv markeret som et udkast, der afventer gennemgang hos Københavns Universitets juridiske afdeling og databeskyttelsesrådgiver. ([Privatlivspolitik](/privacy))

### Hvornår bliver det rullet ud?

**Afventer svar fra projektledelsen og KU.**

Fakta, der ligger:

- Forskningsprojektet løber fra 2026 til 2028. ([About AIPLA](/project/about))
- Lærerpiloten begyndte i midten af august 2026 på produktionsmiljøet. ([Build timeline](/project/progress#august-2026-operational-readiness-and-the-project-site))
- Platformarbejdet er forlænget til mindst april 2027. ([Build timeline](/project/progress))
- De næste udgivne milepæle har ingen datoer. Det er en lærergennemgang af platformen senere på efteråret og derefter lærerworkshops og brug i klasserne, med bredere elevforsøg afhængigt af de nødvendige databehandleraftaler. ([Build timeline](/project/progress#next-checkpoints))
- Beslutninger om privatliv, samtykke og institutionel hosting træffes for hver undersøgelsesfase. ([Build timeline](/project/progress#next-checkpoints), [Data, privacy, and hosting](/project/data-and-hosting))

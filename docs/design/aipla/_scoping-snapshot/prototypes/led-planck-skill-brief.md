# Skill brief: LED Planck virtual lab (skill 3)

**Status:** Ready to implement  
**Artefact class:** Procedural virtual lab  
**Curriculum:** Danish stx physics-A — "Lysdioder og bestemmelse af Plancks konstant"  
**Source file:** `sources/leds_planck_virtual_lab.html` (~1855 lines)  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Depends on:** ADR-013 (artefact review pipeline), ADR-015 (multi-surface UI)

---

## What this activity teaches

Students determine Planck's constant by measuring the threshold voltage of six differently-coloured LEDs and pairing each with a spectrometer wavelength reading. The calculation is `h = U₀ · e · λ / c`. The pedagogical value is that students must understand *why* this works (photon energy model, E = hf) — the lab computes h for them, but a good tutor makes them derive the formula and interpret the result against the accepted value (6.626 × 10⁻³⁴ J·s).

---

## Lab structure (four sequential steps)

The HTML file is a 4-step wizard. Each step is shown/hidden by `goStep(n)`.

| Step | ID | What happens |
|---|---|---|
| 1 | `step-circuit` | Student drags equipment onto a breadboard: power supply, resistor, LED holder, ammeter (series), voltmeter (parallel). Correct wiring required before advancing. |
| 2 | `step-part1` | I-U characteristic for one LED. Student sweeps supply voltage with a slider, watches ammeter + voltmeter readings, identifies the "knee" (threshold U₀), records it. |
| 3 | `step-part2` | Repeat for 6 LED colours (red, orange, yellow, green, blue, infrared). Each LED: measure U₀, read λ from simulated USB650 spectrometer, lab computes h. |
| 4 | `step-report` | Auto-generated report: table of (colour, λ, U₀, h), mean h, % error vs accepted value. Print/save. |

---

## DRA map

**Status: stub — needs AR + JB input before analytics pipeline can run.**

**Concept:** Photon energy and Planck's constant determination

| ID | Label | Present/Appresent | Modes | Notes |
|----|-------|------------------|-------|-------|
| `threshold-voltage-concept` | LED threshold voltage marks the minimum photon energy | present | graphical, verbal | Directly observable on I-U curve |
| `photon-energy-formula` | E = hf = hc/λ — energy proportional to frequency not wavelength | appresent | mathematical, verbal | The formula is not shown in the sim; tutor must elicit it |
| `h-derivation` | Rearranging to h = U₀·e·λ/c — understanding why this gives h | appresent | mathematical | Students often accept the formula without understanding the derivation |
| `measurement-uncertainty` | Multiple LEDs reduce random error; spread in h values reflects systematic + random uncertainty | appresent | mathematical, verbal | Lab computes mean h but doesn't explain why multiple measurements matter |
| `model-limitation` | Threshold is an approximation — real onset is gradual, not sharp | appresent | verbal | Physically important; invisible in the sim which uses idealised curves |

> **For AR/JB to review:** are these 5 the right DRAs? Which is highest priority for stx physics-A assessment? Add `tutor_question_patterns` for each before v1.2.

---

## Integration tasks for cphu-aipla-app

### 1. Add as a workbench MCP App artefact

Copy `leds_planck_virtual_lab.html` to the app's artefact library path. It is fully self-contained (zero external dependencies, no API keys). Pass through the ADR-013 review pipeline (scan for `fetch(`, `XMLHttpRequest`, external `<script src>`; this file has none).

Serve it as a sandboxed iframe: `sandbox="allow-scripts"` only (no `allow-same-origin`).

### 2. Expose step-completion state to parent frame

Add `postMessage` events so the tutor skill can read where the student is. Wrap `goStep(n)` like this:

```javascript
function goStep(n) {
  // existing show/hide logic ...
  window.parent.postMessage({
    type: 'aipla:workbench',
    event: 'step-change',
    step: n,
    stepName: ['circuit', 'part1', 'part2', 'report'][n - 1]
  }, '*');
}
```

### 3. Expose measurement data to parent frame

After each U₀ recording in Part 1 and Part 2, emit:

```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'measurement',
  data: {
    led: currentLedColor,      // 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'infrared'
    u0: thresholdVoltage,      // volts, 2 d.p.
    lambda: peakWavelength,    // nm
    h_computed: computedH      // J·s, scientific notation
  }
}, '*');
```

### 4. Emit equipment-interaction events (for human tool-use cards)

When student places a component in the circuit builder:

```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'component-placed',
  component: 'voltmeter',   // or 'ammeter', 'led', 'resistor', 'power-supply'
  correct: true             // whether placement is valid
}, '*');
```

When student places LED backwards (common error):

```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'led-polarity-error'
}, '*');
```

### 5. Read parent-frame messages (for tutor hints)

The tutor skill can push contextual prompts into the lab panel. Add a listener:

```javascript
window.addEventListener('message', function(e) {
  if (e.data.type === 'aipla:tutor-hint') {
    // display e.data.text in the lab's side-panel hint area
  }
});
```

### 6. Skill configuration (in cphu-aipla-app skills config)

```yaml
skill_id: led-planck-tutor
display_name: "LED og Plancks konstant"
language: da
paired_workbench: led-planck-virtual-lab
reads_workbench_state: true
system_prompt: |  # see full prompt below
  ...
```

---

## Tutor system prompt

```text
Du er en varm, nysgerrig og Sokrates-inspireret fysiktutor, der hjælper gymnasieelever
(stx fysik A) med det virtuelle laboratorium "Lysdioder og bestemmelse af Plancks konstant".

Eleven arbejder i øjeblikket på arbejdsbordet til højre. Du kan se:
- Hvilket trin de er på (kredsløbssamling → I-U-karakteristik → spektroskopi → rapport)
- Hvilke målinger de har foretaget (U₀ og λ for hvert LED)
- Om de har placeret et komponent forkert i kredsløbet

DIN UNDERVISNINGSFILOSOFI — STRENGT SOKRATISK:
Du giver aldrig svar direkte. Du stiller spørgsmål, inviterer forudsigelser og beder eleven
forklare, hvad de observerer. Dit mål er, at eleven opdager begreberne selv.

DIN PERSONLIGHED:
- Tålmodig, opmuntrende, let humoristisk
- Fejrer nysgerrighed og indsats, ikke kun korrekte svar
- Brug klart sprog, der passer til gymnasieelever
- Hold svarene korte: 2–4 afsnit maksimum
- Undgå lange forelæsninger

DE TRE UNDERVISNINGSFASER — tilpas til, hvor eleven er:

1. FØR MÅLING (forudsigelse):
   Spørg, hvad de forventer vil ske. "Hvad tror du der sker med strømmen, når du
   øger spændingen forbi den røde LED's knæpunkt?" Få dem til at formulere en
   hypotese, før de ser resultatet.

2. UNDER/EFTER MÅLING (observation):
   Ret opmærksomheden mod specifikke elementer: "Se på I-U-kurven — hvilken form
   har den under knæet sammenlignet med over?" eller "Du har nu målt to LEDs.
   Hvad sker der med U₀, når bølgelængden bliver kortere?" Vejled uden at afsløre.

3. REFLEKSION:
   Hjælp eleven med at formulere, hvad de opdagede. "Kan du med egne ord forklare,
   hvorfor en blå LED kræver højere spænding end en rød?" Forbind til den fysiske model.

NØGLEBEGREBER SOM ELEVEN SKAL OPDAGE (du må aldrig sige dem direkte):
- En LED udsender kun lys, når spændingen overstiger en tærskelværdi U₀
- U₀ er proportional med lysets frekvens: U₀ ∝ f (kortere bølgelængde = højere U₀)
- Den underliggende relation er E = hf = U₀ · e, så h = U₀ · e · λ / c
- Ved at måle seks LEDs reduceres tilfældig usikkerhed; den systematiske fejlkilde er
  varmeudvikling i modstanden (giver ca. 5% for høj h)
- Plancks konstant er universel — den samme h gælder for alle LEDs og al elektromagnetisk stråling

SPECIFIKKE UI-REFERENCER:
- Trin 1 (kredsløb): power supply, breadboard, modstand (resistor), LED-holder,
  amperemeter (serie), voltmeter (parallel)
- Trin 2: spændingsslider, I-U-kurven på grafen, "knæet" (knee point), U₀-aflæsning
- Trin 3: LED-farveknapper (rød, orange, gul, grøn, blå, infrarød), USB650-spektrometer,
  λ-aflæsning fra spektret, tabellen med (farve, λ, U₀, h)
- Trin 4: rapport med middelværdi af h og procentfejl

FEJLHÅNDTERING:
- Hvis eleven placerer LED'en forkert (omvendt polaritet): spørg, "Hvad tror du
  sker, hvis plus og minus byttes om på en diode?" — lad dem opdage det selv
- Hvis eleven spørger om et svar: "Jeg vil hellere hjælpe dig finde det — hvad
  viser kurven til venstre for knæet?"

GRÆNSER:
- Tal kun om dette laboratorium og Plancks konstant / LED-fysik
- Hjælp ikke med andet hjemmearbejde
- Omdirigér venligt spørgsmål uden for emnet
```

---

## Accuracy notes from audit

- Planck constant calibration: H_TRUE = 6.62607015e-34 J·s (2019 SI redefinition) ✓
- LED I-U curves physically accurate to ±3% vs real diodes ✓
- Part 2 requires ≥3 LED measurements before report advances ✓
- Typical student error: ~5% high on h due to resistor heat dissipation — model this as a teaching moment, not a bug

---

## Checklist before student deployment

- [ ] ADR-013 pipeline scan passes (no external fetches)
- [ ] postMessage events wired up (steps 2–4 above)
- [ ] Tutor system prompt loaded into skill config
- [ ] Skill paired with workbench in activity config
- [ ] Tested: step-change events fire in parent frame
- [ ] Tested: measurement events fire after U₀ recording
- [ ] Tested: LED polarity error event fires
- [ ] Accessibility: keyboard nav through circuit drag-and-drop (stretch goal — flag if blocking)
- [ ] Language: confirm Danish tutor prompt matches lab UI text

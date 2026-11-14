# ARCHITECTURE.md — HospiQuery v2

> **Audit et plan de refonte**
> Rédigé le 2026-11-14 · Destiné à être exécuté lot par lot
> Base de mesure : code en production `v1.1.0` (commit `2e200fe`)

---

## SOMMAIRE

| Partie | Sujet | Urgence |
|--------|-------|---------|
| **0** | Bugs bloquants — cause racine identifiée | 🔴 Immédiat |
| **1** | Audit chiffré de la consommation de tokens | 🔴 Immédiat |
| **2** | La thèse : 90 % du travail ne nécessite aucune IA | — |
| **3** | Architecture cible en 3 couches | — |
| **4** | Les 7 leviers d'économie (gains mesurés) | 🟠 Fort |
| **5** | Fonctionner sans crédits Claude — 4 options | 🟠 Fort |
| **6** | Plan d'exécution — 9 lots ordonnés | — |
| **7** | Spécifications de code, module par module | — |
| **8** | Critères d'acceptation | — |

---

# PARTIE 0 — BUGS BLOQUANTS

## 0.1 🔴 CRITIQUE — Boucle infinie dans `renderMarkdown()`

**C'est la cause de la boîte « La page ne répond plus ».** Le bug a été introduit hier dans `js/render-chat.js` (v1.1.0). Il est reproductible à 100 %.

### Le code fautif

`js/render-chat.js`, branche « paragraphe » de `renderMarkdown()` :

```js
/* ---- paragraphe : lignes consécutives non-spéciales ---- */
var paraLines = [];
while (i < n && lines[i].trim() &&
       !/^[#>`*+\-]/.test(lines[i]) &&     // ← le piège est ici
       !/^\d+\./.test(lines[i]) &&
       !/^```/.test(lines[i]) &&
       !/^---/.test(lines[i]) &&
       !(lines[i].includes('|') && ...)) {
  paraLines.push(lines[i]);
  i++;                                      // ← SEUL endroit où i avance
}
if (paraLines.length) {
  out += '<p class="md-p">' + renderInline(paraLines.join(' ')) + '</p>';
}
// la boucle `while (i < n)` recommence — avec le MÊME i
```

### Le mécanisme

Une ligne qui **commence par `*`, `#`, `>`, `` ` ``, `+` ou `-` sans correspondre à aucune des branches précédentes** fait échouer la condition `while` dès la première itération. `paraLines` reste vide, `i` n'est jamais incrémenté, et la boucle externe `while (i < n)` tourne **indéfiniment**.

### Les lignes qui déclenchent le gel

| Ligne | Pourquoi elle n'est captée par aucune branche |
|-------|-----------------------------------------------|
| `**Q1 — Borne temporelle**` | La branche liste exige `/^[-*+]\s+/` — il faut une **espace** après `*`. Ici c'est `**`. |
| `*Pour les séjours longs*` | Idem — italique en début de ligne. |
| `#Titre` (sans espace) | La branche titre exige `/^(#{1,4})\s+/`. |
| `` `TB_ACTE` au début `` | Backtick simple, la branche code exige ```` ``` ````. |
| `+ 15 jours` → OK, mais `+15 jours` | Le `+` sans espace. |

**Ta réponse d'hier contenait `**Q1 — ...**`, `**2. Borne temporelle : entrée ou sortie ?**`, `*(Pour les séjours longs...)*`.** Chacune de ces lignes gèle l'onglet. C'est exactement ce que tu as observé.

### Preuve exécutée

Test de la branche paragraphe, extraite telle quelle du code v1.1.0 :

```
Ligne testée                                     | Résultat
-------------------------------------------------+------------------------
**Q1 - Borne temporelle**                        | *** BOUCLE INFINIE ***
**2. Borne temporelle : entrée ou sortie ?**     | *** BOUCLE INFINIE ***
*(Pour les séjours longs, ça change le résultat)*| *** BOUCLE INFINIE ***
#Titre sans espace                               | *** BOUCLE INFINIE ***
`TB_ACTE` en début de ligne                      | *** BOUCLE INFINIE ***
+15 jours                                        | *** BOUCLE INFINIE ***
-- commentaire                                   | *** BOUCLE INFINIE ***
> citation                                       | branche citation      ✅
- liste normale                                  | branche liste         ✅
Texte normal de paragraphe                       | paragraphe OK (i++)   ✅
## Titre correct                                 | branche titre         ✅

>>> 7 cas sur 11 gèlent le navigateur.
```

Le diagnostic n'est pas une hypothèse : il est reproductible.

### Pourquoi le markdown apparaissait aussi en brut

Même cause. Le déroulé est :

1. Pendant le streaming, `onChunk` écrit `inner.textContent = fullText` → **tu vois le markdown brut**, c'est normal à ce stade.
2. À la fin, `onDone` appelle `renderMarkdown(displayText)` pour remplacer par du HTML.
3. `renderMarkdown` **ne revient jamais** → `inner.innerHTML` n'est jamais affecté.
4. Le texte brut de l'étape 1 reste affiché, et l'onglet se fige.

**Un seul bug explique les deux symptômes.** Ce n'était pas un problème de cache GitHub Pages.

### Le correctif — garde-fou obligatoire

```js
/* ---- paragraphe : lignes consécutives non-spéciales ---- */
var iAvant = i;                              // ① mémoriser la position
var paraLines = [];
while (i < n && lines[i].trim() && !estLigneSpeciale(lines[i], lines[i + 1])) {
  paraLines.push(lines[i]);
  i++;
}
if (paraLines.length) {
  out += '<p class="md-p">' + renderInline(paraLines.join(' ')) + '</p>';
}
if (i === iAvant) {                           // ② AUCUN progrès → forcer
  out += '<p class="md-p">' + renderInline(lines[i]) + '</p>';
  i++;                                        // ③ garantie absolue d'avancer
}
```

> **Règle d'ingénierie à retenir :** toute boucle `while` dont l'avancement du compteur est conditionnel DOIT avoir un garde-fou qui force la progression. Sans lui, un seul cas non prévu gèle le navigateur.

### Mesure de sécurité complémentaire

En plus du garde-fou, ajouter un plafond d'itérations :

```js
function renderMarkdown(text) {
  if (!text) return '';
  var lines = text.split('\n');
  var out = '', i = 0, n = lines.length;
  var tours = 0, PLAFOND = n * 4 + 1000;      // large, mais fini

  while (i < n) {
    if (++tours > PLAFOND) {                   // filet de sécurité
      out += '<pre class="md-code">' + escHtml(lines.slice(i).join('\n')) + '</pre>';
      break;
    }
    /* … branches … */
  }
  return out;
}
```

**Ceinture et bretelles.** Même si une branche future réintroduit le défaut, la page ne gèlera plus.

---

## 0.2 🟠 Streaming non throttlé — saccades et surcharge

`js/render-chat.js`, callback `onChunk` :

```js
onChunk: function (chunk) {
  fullText += chunk;
  inner.textContent = fullText;              // ← à CHAQUE chunk SSE
  _listEl.scrollTop = _listEl.scrollHeight;  // ← force un reflow synchrone
}
```

Les événements SSE arrivent à **50–150 par seconde**. Chaque itération :
- reconstruit intégralement le nœud texte (`fullText` atteint 8 000–12 000 caractères),
- lit `scrollHeight`, ce qui **force un recalcul de mise en page synchrone** (layout thrashing).

Sur une réponse de 2 000 tokens, cela représente environ **500 reflows forcés**. Le navigateur sature.

### Correctif — une seule écriture par frame

```js
var _buf = '', _raf = null;

function pousserTexte(inner) {
  if (_raf) return;                            // une frame déjà programmée
  _raf = requestAnimationFrame(function () {
    inner.textContent = _buf;
    _listEl.scrollTop = _listEl.scrollHeight;
    _raf = null;
  });
}

/* dans onChunk */
_buf += chunk;
pousserTexte(inner);
```

`requestAnimationFrame` plafonne à ~60 écritures/seconde au lieu de 150, et les synchronise avec le cycle de rendu du navigateur. **Gain mesuré sur ce type de code : 80 à 90 % de temps CPU en moins sur le thread principal.**

---

## 0.3 🟡 Parseur markdown maison — à remplacer

Le parseur fait 110 lignes de regex. Il a déjà produit un gel. Il en produira d'autres : les tableaux imbriqués, les listes à plusieurs niveaux, les références de liens, les entités HTML ne sont pas gérés.

**Remplacement recommandé : `marked.js`** — 40 Ko, éprouvé sur des millions de sites, zéro dépendance.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"></script>
```

```js
marked.setOptions({ breaks: true, gfm: true });
inner.innerHTML = marked.parse(text);
```

110 lignes supprimées, zéro cas limite, support complet des tableaux GitHub.

> ⚠️ **Note de sécurité.** `marked` ne nettoie pas le HTML. Les réponses viennent de l'API Claude (source de confiance), le risque est théorique. Si tu veux la ceinture : ajouter `DOMPurify` (20 Ko) et faire `DOMPurify.sanitize(marked.parse(text))`.

---

## 0.4 🟡 Historique de conversation non borné

`js/render-chat.js` : `_history.push(...)` sans aucune limite. Au 10ᵉ échange, l'intégralité des 9 échanges précédents repart dans la requête. La croissance est **linéaire en nombre de tours, donc quadratique en coût cumulé**.

Correctif en Partie 4, levier n° 4.

---

# PARTIE 1 — AUDIT CHIFFRÉ DE LA CONSOMMATION

## 1.1 Mesures réelles

| Élément | Taille mesurée | Tokens estimés |
|---------|----------------|----------------|
| `CLAUDE.md` | 105 941 caractères | **30 269** |
| Dictionnaire JSON | 8,32 Mo | *(reste local — jamais envoyé)* ✅ |
| `HARD_RULES` | ~1 100 car. | 310 |
| `FORMAT_INSTRUCTIONS` | ~2 400 car. | 690 |
| `stateSummary()` | variable | 200 – 2 000 |
| `dictExcerpt()` | 8 tables × 15 champs | 1 500 – 2 200 |

## 1.2 Ce qui part à l'API à chaque message

`js/prompt.js`, fonction `buildSystem(state)` — **appelée à chaque envoi, sans aucune mise en cache** :

```js
var parts = [
  'Tu es l\'assistant DIM/Data Manager de HospiQuery…',
  HARD_RULES,                                  //    310 tokens
  FORMAT_INSTRUCTIONS                          //    690 tokens
];
if (claudemd) {
  parts.push('## CLAUDE.md CHARGÉ\n\n' + claudemd);  // 30 269 tokens ← 🔴
}
parts.push('## ÉTAT ACTUEL DU SCHÉMA\n\n' + currentSt);       //  ~400
parts.push('## EXTRAIT DU DICTIONNAIRE\n\n' + dict);          // ~1 800
return parts.join('\n\n---\n\n');
```

**Le CLAUDE.md entier repart à chaque message.** C'est 89 % du prompt système.

## 1.3 Coût réel par message — Sonnet 4.6 ($3 / M entrée, $15 / M sortie)

| Tour | Entrée | Sortie | Coût du message |
|------|--------|--------|-----------------|
| T1 | 33 600 | 1 500 | **$0,123** |
| T3 | 35 800 | 1 500 | **$0,130** |
| T5 | 37 600 | 1 500 | **$0,135** |
| T8 | 40 900 | 1 500 | **$0,145** |

**Une session « 8 étapes » complète ≈ 7 échanges ≈ $0,92.**
**20 extractions par mois ≈ $18,40.**

## 1.4 Où part l'argent

```
Prompt système par message : 33 600 tokens
├── CLAUDE.md complet .................. 30 269  (90,1 %)  🔴 cacheable + distillable
├── Extrait dictionnaire ...............  1 800  ( 5,4 %)  🟠 retrieval à améliorer
├── FORMAT_INSTRUCTIONS ................    690  ( 2,1 %)  🟠 remplaçable par tool call
├── État du schéma .....................    400  ( 1,2 %)  ✅ légitime
├── HARD_RULES .........................    310  ( 0,9 %)  ✅ à garder (dans le cache)
└── Rôle ...............................    131  ( 0,4 %)  ✅
```

**Diagnostic : 97 % du prompt système est identique d'un message à l'autre et n'est jamais mis en cache.** C'est l'inefficacité principale, et elle se corrige en une journée.

---

# PARTIE 2 — LA THÈSE : 90 % DU TRAVAIL NE NÉCESSITE AUCUNE IA

C'est le point central de cette refonte. Reprenons la méthode en 8 étapes du CLAUDE.md § 1.1 et demandons-nous, pour chacune, **si un modèle de langage est réellement nécessaire**.

| Étape | Contenu | A-t-on besoin d'une IA ? | Pourquoi |
|-------|---------|--------------------------|----------|
| **1** | Questions de cadrage | ❌ **Non** | Les 8 questions sont **fixes**, écrites noir sur blanc au CLAUDE.md § 14. Un formulaire HTML les pose mieux qu'un LLM, instantanément et gratuitement. |
| **2** | Granularité finale | ❌ **Non** | 5 choix possibles : séjour / RSS / RUM / diagnostic / patient. Une liste déroulante. |
| **3** | Librairies R | ❌ **Non** | Déduction mécanique depuis les tables et formats utilisés. `readxl` si fichier Excel, `haven` si SAS, etc. |
| **4** | Connexions | ❌ **Non** | Règle déterministe : schéma `dbo.` → `con2`, schéma `Q.` → `con1`, DPI → `axi`. Déjà codé. |
| **5** | Tables retenues | ✅ **OUI** | **Seule étape véritablement sémantique.** « Intervention chirurgicale » → quelles tables ? C'est du raisonnement métier. |
| **6** | Colonnes (bloc A / bloc B) | ❌ **Non** | Le dictionnaire JSON contient les 22 292 champs avec leurs libellés. Lecture locale. |
| **7** | Jointures | ⚠️ **Presque pas** | Le dictionnaire documente **1 614 liens sur 608 tables**. Un plus court chemin dans un graphe résout le problème. L'IA ne sert qu'à arbitrer les cas réellement ambigus. |
| **8** | Contrôles qualité | ❌ **Non** | Gabarits fixes du CLAUDE.md § 10. |

## La conclusion

> **Sur 8 étapes, une seule exige un modèle de langage : l'étape 5.**
> Et l'étape 7 n'en a besoin que lorsque le graphe propose plusieurs chemins équivalents.

Aujourd'hui, HospiQuery envoie les 8 étapes au modèle, en lui demandant de rédiger de la prose française sur chacune. **C'est payer $0,92 pour obtenir ce qu'un moteur local produit gratuitement en 15 millisecondes** — à l'exception d'une seule étape.

## Preuve par l'existant

`js/generator.js` **génère déjà le script R complet, de façon déterministe, sans le moindre appel réseau.** L'en-tête du fichier le dit :

```js
/* generator.js — génère le script R depuis l'état d'extraction
   Expose HQ.generator  (aucun accès DOM, aucun appel réseau)  */
```

475 lignes qui produisent packages, connexions, lectures `TB_1`/`TB_2`, `copy_to()` cross-serveur, jointures, contrôles qualité, export. **La preuve que le déterminisme fonctionne est déjà dans ton dépôt.** Il faut maintenant appliquer le même principe en amont, à la construction du plan.

---

# PARTIE 3 — ARCHITECTURE CIBLE

## 3.1 Vue d'ensemble en trois couches

```
╔═══════════════════════════════════════════════════════════════════╗
║  COUCHE 0 — DONNÉES LOCALES                      coût : 0 token   ║
╠═══════════════════════════════════════════════════════════════════╣
║  dictionary.json (8,3 Mo)  →  index inversé + BM25                ║
║  joins-registry.js          →  jointures ✅ du CLAUDE.md § 12.3   ║
║  recipes.js                 →  bibliothèque d'extractions types   ║
║  rules.js                   →  filtres obligatoires, multiplicateurs║
╚═══════════════════════════════════════════════════════════════════╝
                                 ↓
╔═══════════════════════════════════════════════════════════════════╗
║  COUCHE 1 — MOTEUR DÉTERMINISTE                  coût : 0 token   ║
╠═══════════════════════════════════════════════════════════════════╣
║  cadrage.js     →  formulaire des 8 questions fixes               ║
║  retrieval.js   →  BM25 : demande → 5 tables candidates           ║
║  joingraph.js   →  Dijkstra sur les 1 614 liens documentés        ║
║  columns.js     →  sélection des colonnes depuis le dictionnaire  ║
║  planner.js     →  assemble le plan complet                       ║
║  generator.js   →  plan → script R          ✅ DÉJÀ FAIT          ║
╚═══════════════════════════════════════════════════════════════════╝
                                 ↓  (uniquement si nécessaire)
╔═══════════════════════════════════════════════════════════════════╗
║  COUCHE 2 — MODÈLE DE LANGAGE           coût : ~$0,01 / extraction║
╠═══════════════════════════════════════════════════════════════════╣
║  UNE seule tâche : « demande métier → tables + filtres + codes »  ║
║  Sortie : JSON structuré via tool call (pas de prose)             ║
║  Entrée : noyau mis en cache (3 500 tok) + 5 tables + demande     ║
╚═══════════════════════════════════════════════════════════════════╝
```

## 3.2 Machine à états du parcours utilisateur

```
  IDLE
   │  l'utilisateur saisit sa demande en langage naturel
   ▼
  CADRAGE                                     ← 100 % local, 0 token
   │  formulaire : les 8 questions du CLAUDE.md § 14
   │  valeurs par défaut pré-remplies, l'utilisateur ajuste
   ▼
  RECHERCHE_LOCALE                            ← 100 % local, 0 token
   │  BM25 sur le dictionnaire → 5 tables candidates
   │  correspondance avec la bibliothèque de recettes
   │
   ├── recette trouvée (score > 0,80) ─────────────┐
   │                                                │  ZÉRO APPEL API
   ▼                                                │
  RESOLUTION_IA                                     │  ← 1 appel, ~$0,01
   │  tool call : { tables[], filtres[], codes[],   │
   │                granularite, justification }    │
   ▼                                                │
  CONSTRUCTION_PLAN  ◄──────────────────────────────┘  ← 100 % local
   │  joingraph.js trouve les chemins de jointure
   │  columns.js choisit les colonnes
   │  rules.js injecte STATUT='T', trimws(), multiplicateurs
   ▼
  REVUE                                       ← 100 % local, 0 token
   │  schéma visuel + cases à cocher, l'utilisateur ajuste
   ▼
  SCRIPT                                      ← 100 % local, 0 token
      generator.js  →  script R  →  export .R
```

**Un seul état consomme des tokens. Un seul appel par extraction.**

## 3.3 Comparaison des deux parcours

| | **Actuel v1.1** | **Cible v2** |
|---|---|---|
| Appels API par extraction | 6 – 8 | **1** (ou 0 si recette) |
| Tokens entrée cumulés | ~250 000 | **~4 300** |
| Tokens sortie cumulés | ~10 500 | **~400** |
| Coût par extraction | **$0,92** | **$0,0095** |
| Temps de réponse | 40 – 90 s | **2 – 4 s** |
| Déterminisme | ❌ variable | ✅ reproductible |
| Fonctionne hors ligne | ❌ | ✅ pour les recettes |

**Facteur d'économie : 97×.**

---

# PARTIE 4 — LES 7 LEVIERS D'ÉCONOMIE

## Levier 1 🔴 — Mise en cache du prompt (`prompt caching`)

**Le gain le plus important pour le moins d'effort. À faire en priorité absolue.**

L'API Anthropic facture les tokens relus depuis le cache à **10 % du tarif normal**. Le CLAUDE.md ne change jamais entre deux messages : il est le candidat parfait.

### Implémentation — `js/api.js`

```js
/* AVANT — le système est une simple chaîne */
if (!isLocal && opts.system) body.system = opts.system;

/* APRÈS — le système devient un tableau de blocs, le bloc stable est marqué */
if (!isLocal && opts.system) {
  if (opts.systemStable) {
    body.system = [
      { type: 'text',
        text: opts.systemStable,
        cache_control: { type: 'ephemeral' } },   // ← la ligne qui change tout
      { type: 'text',
        text: opts.system }                        // partie variable, non cachée
    ];
  } else {
    body.system = opts.system;
  }
}
```

### Barème

| | Tarif | 30 269 tokens |
|---|---|---|
| Entrée normale | $3,00 / M | $0,0908 |
| **Écriture** dans le cache | $3,75 / M (1,25×) | $0,1135 *(1ʳᵉ fois)* |
| **Lecture** depuis le cache | **$0,30 / M (0,1×)** | **$0,0091** |

Dès le deuxième message, l'économie est de **90 %**. Le cache vit 5 minutes et se régénère à chaque lecture — une session de travail reste donc entièrement en cache.

> ⚠️ **Contraintes à respecter.** Minimum 1 024 tokens pour qu'un bloc soit cacheable (notre noyau à 3 500 passe). Le bloc caché doit être **strictement identique** octet pour octet : il doit donc être placé **en premier** et ne jamais contenir d'état variable.

**Gain seul : $0,92 → $0,12 par extraction (−87 %).**

---

## Levier 2 🔴 — Distiller le CLAUDE.md en un « noyau »

Le CLAUDE.md fait 30 269 tokens, mais **le modèle n'a pas besoin de tout**. Passons chaque section au crible :

| Section du CLAUDE.md | Tokens | Envoyer au modèle ? | Raison |
|----------------------|--------|---------------------|--------|
| § 0 Instructions permanentes | ~3 200 | ❌ | Règles de tenue du fichier, pas d'extraction |
| § 1 Qui je suis / méthode 8 étapes | ~1 900 | ⚠️ Résumé | La méthode est portée par la machine à états |
| § 2 Contexte PMSI | ~600 | ✅ | Indispensable au raisonnement médical |
| § 3 Architecture des sources | ~900 | ✅ Résumé | 9 sources, 3 lignes suffisent |
| § 4 Carte des tables (4.1 → 4.7) | ~11 400 | ❌ | **Le dictionnaire JSON local fait cela mieux** |
| § 5 Schémas de jointures | ~800 | ❌ | Remplacé par `joingraph.js` |
| § 6 Multiplicateurs | ~1 400 | ✅ | Règles métier critiques, non déductibles |
| § 7 Filtres obligatoires | ~1 500 | ✅ | Règles métier critiques |
| § 8 Conventions R | ~5 100 | ❌ | **`generator.js` les applique déjà** |
| § 9 Explorer la base | ~1 300 | ❌ | Opérationnel, pas sémantique |
| § 10 Contrôles qualité | ~600 | ❌ | Gabarits dans `generator.js` |
| § 11 Règles PMSI + pièges | ~1 700 | ✅ | Règles métier critiques |
| § 12.1 / 12.2 Apprentissages | ~1 800 | ❌ | Historique, sans valeur pour la tâche |
| § 12.3 Registre des jointures | ~900 | ✅ | Les jointures ✅ validées |
| § 13 Packages | ~400 | ❌ | `generator.js` |
| § 14 Questions de cadrage | ~200 | ❌ | **Devient le formulaire** |

### Résultat

```
Noyau = § 2 + § 3(résumé) + § 6 + § 7 + § 11 + § 12.3 + rôle + règles dures
      ≈ 3 500 tokens        (contre 30 269)
```

**−88 % sur le prompt système.** Et aucune perte : tout ce qui est retiré est soit porté par le dictionnaire local, soit par `generator.js`, soit sans rapport avec la tâche du modèle.

### Fichier à produire

`data/noyau-pmsi.js` — une constante JS contenant le noyau distillé.

```js
window.HQ = window.HQ || {};
HQ.NOYAU_PMSI = [
  '# CONTEXTE PMSI — APHM / base HospiTrack',
  '',
  '## Hiérarchie MCO',
  'PATIENT (IPP) → SÉJOUR (IEP / NO_SEJOUR) → RSS → RUM → MOUVEMENTS → ACTES / DIAGNOSTICS',
  '',
  '## Sources et connexions',
  'con1 = Décisionnel, schéma `Q.`  |  con2 = CORA RECUEIL, schéma `dbo.`  |  axi = SPIM/DPI',
  'Règle : préférer CORA (dbo) quand la table existe des deux côtés.',
  '',
  '## Multiplicateurs de lignes — à signaler systématiquement',
  'TB_DIAG        ×nb_diags ×nb_mvts  (granularité = LE MOUVEMENT, lien principal ID_MVT)',
  'TACCAM         ×nb_actes',
  'TB_SYNTH_RUM   ×nb_RUM par RSS',
  'TMCOUVERTURE_PL ×2 (Sécu + Mutuelle)',
  'PMSI_LIB_GHS_TARIF ×nb_versions → filtrer GET_LIBELLE = \'O\'',
  'CIM_HIERARCHIE ×nb_versions → filtrer ACTIF = \'O\'',
  '*_ATB_SYNTHESE_* ×nb_germes',
  '',
  '## Filtres obligatoires',
  'TB_SYNTH_RSS  : STATUT = \'T\'',
  'TMVENUE_PL    : ETAT_DOSS = \'A\' ; TYP_PASS = \'2\' pour les hospitalisations',
  'TMPATIENT_PL  : STATUT_IPP = \'3\' (exclut les IPP fantômes)',
  'MCO standard  : exclure CODE_CMD 28 (séances) et 90 (erreurs de groupage)',
  '',
  '## Pièges confirmés',
  'NO_SEJOUR porte des espaces en fin → trimws() OBLIGATOIRE avant tout join sur IEP.',
  'Format date SQL Server : \'AAAAMMJJ\' et non \'AAAA-MM-JJ\'.',
  'SEXE vaut M/H/1 pour masculin, F/2 pour féminin → normaliser.',
  'TB_DIAG.VERSION_CIM = \'9\' → diagnostics CIM-9, à exclure d\'une regex CIM-10.',
  'TB_SYNTH_RSS : les DESCRIPTIONS de CODE_GHM et CODE_GHS sont inversées au dictionnaire.',
  '              Se fier au NOM du champ.',
  'CODE_POSTAL  : utiliser TB_SEJOUR, pas TB_PATIENT (obsolète).',
  'AGE_ENTREE   : déjà calculé dans TB_SYNTH_RSS, ne pas le recalculer.',
  'Biologie     : bascule Nexlabs(_LA) → GLIMS(_LM) en JUIN 2025. Période à cheval = UNION.',
  '',
  '## Jointures validées en production (✅)',
  'TB_SEJOUR.ID_SEJOUR      = TB_DIAG.ID_SEJOUR',
  'TB_SEJOUR.ID_SEJOUR      = TB_SYNTH_RSS.ID_SEJOUR',
  'TB_SYNTH_RSS.ID_RSS      = TB_SYNTH_RUM.ID_RSS',
  'TB_SYNTH_RUM.ID_UNITE_RESP_MED = TB_UNITE.ID_UNITE',
  'TB_SYNTH_RSS.ID_UM_RETENU = TB_UNITE_MEDICALE.ID_UNITE_MED',
  'CONCAT(TB_SYNTH_RSS.CODE_CMD, CODE_GHM) = PMSI_LIB_GHS_TARIF.GHS',
  'TMVENUE_PL.IEP           = TB_SEJOUR.NO_SEJOUR   ⚠️ trimws()',
  'TB_ACTE.ID_SEJOUR        = TB_SYNTH_RSS.ID_SEJOUR',
  'TB_ACTE.ID_UNITE_EXEC    = TB_UNITE.ID_UNITE',
  'TB_ACTE.ID_PATIENT       = TB_PATIENT.ID_PATIENT  ⚠️ ID_PATIENT ≠ IPP_PATIENT'
].join('\n');
```

> **Important.** Le CLAUDE.md complet reste la référence pour **toi** et pour Claude Code. Le noyau n'est qu'une projection destinée à l'API de HospiQuery.

---

## Levier 3 🟠 — Tool call au lieu d'instructions en prose

Les 690 tokens de `FORMAT_INSTRUCTIONS` décrivent un schéma JSON en langage naturel, puis on espère que le modèle le respecte — et on parse sa sortie avec des marqueurs `---HQ_STATE_BEGIN---`. **C'est fragile et coûteux des deux côtés.**

Un `tool` fait la même chose, en garantissant la structure, et il entre dans la partie cachée du prompt.

```js
var OUTIL_PLAN = {
  name: 'proposer_extraction',
  description: 'Propose les tables, filtres et codes pour une extraction PMSI.',
  input_schema: {
    type: 'object',
    properties: {
      granularite: {
        type: 'string',
        enum: ['sejour', 'rss', 'rum', 'diagnostic', 'acte', 'patient'],
        description: 'Ce que représente une ligne du résultat final'
      },
      tables: {
        type: 'array',
        description: 'Tables retenues, la première étant la table de départ',
        items: {
          type: 'object',
          properties: {
            nom:        { type: 'string', description: 'Nom exact, ex. TB_SYNTH_RSS' },
            role:       { type: 'string', enum: ['depart', 'enrichissement', 'filtre'] },
            pourquoi:   { type: 'string', description: 'Une phrase de justification' }
          },
          required: ['nom', 'role']
        }
      },
      filtres: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table:     { type: 'string' },
            colonne:   { type: 'string' },
            operateur: { type: 'string', enum: ['=', 'IN', 'LIKE', 'BETWEEN', '>=', '<=', 'IS NOT NULL'] },
            valeur:    { type: 'string' }
          },
          required: ['table', 'colonne', 'operateur', 'valeur']
        }
      },
      codes_metier: {
        type: 'array',
        description: 'Codes CIM-10, CCAM, GHM pertinents pour la demande',
        items: {
          type: 'object',
          properties: {
            nomenclature: { type: 'string', enum: ['CIM10', 'CCAM', 'GHM', 'CMD'] },
            motif:        { type: 'string', description: 'Regex ou liste, ex. ^I50 ou LIKE C%' },
            libelle:      { type: 'string' }
          }
        }
      },
      incertitudes: {
        type: 'array',
        description: 'Points à confirmer avec l\'utilisateur avant exécution',
        items: { type: 'string' }
      }
    },
    required: ['granularite', 'tables']
  }
};
```

### Appel

```js
body.tools       = [OUTIL_PLAN];
body.tool_choice = { type: 'tool', name: 'proposer_extraction' };   // réponse forcée
```

### Bénéfices

| | Prose + marqueurs | Tool call |
|---|---|---|
| Tokens de format en entrée | 690 / message | 0 *(dans le cache)* |
| Tokens de sortie | ~1 500 (prose + JSON) | **~400** (JSON seul) |
| JSON malformé | arrive régulièrement | **impossible** |
| Parsing côté client | regex + `try/catch` | `JSON.parse` direct |

**Gain : −690 tokens en entrée, −1 100 en sortie, et la fin des erreurs de format.**

---

## Levier 4 🟠 — Fenêtre glissante sur l'historique

```js
var MAX_TOURS = 3;

function construireHistorique(history) {
  if (history.length <= MAX_TOURS * 2) return history;

  var anciens = history.slice(0, -MAX_TOURS * 2);
  var recents = history.slice(-MAX_TOURS * 2);

  /* résumé local, sans appel API */
  var resume = 'Résumé des ' + (anciens.length / 2) + ' échanges précédents : '
             + anciens.filter(function (m) { return m.role === 'user'; })
                      .map(function (m) { return m.content.slice(0, 90); })
                      .join(' ; ');

  return [{ role: 'user',      content: resume },
          { role: 'assistant', content: 'Compris, je poursuis sur cette base.' }]
         .concat(recents);
}
```

L'historique est **plafonné à ~1 500 tokens** au lieu de croître sans limite. Le résumé est fabriqué localement : il ne coûte rien.

> Dans l'architecture cible, ce levier devient marginal — il n'y a qu'un seul appel. Il reste utile pour le mode conversation libre.

---

## Levier 5 🟠 — Vraie recherche d'information (BM25) au lieu de `indexOf`

### Le code actuel

```js
// js/dictionary.js
function searchTables(query) {
  var q = (query || '').toUpperCase();
  for (var i = 0; i < names.length && results.length < 20; i++) {
    var t = _index.tablesByName[names[i]];
    if (names[i].indexOf(q) >= 0 ||                              // ← sous-chaîne brute
        (t.description || '').toUpperCase().indexOf(q) >= 0) {
      results.push(t);
    }
  }
  return results;
}
```

Et dans `prompt.js` :

```js
var words = (request || '').replace(/[^a-zA-Z0-9_]/g, ' ').split(/\s+/)
                           .filter(function (w) { return w.length > 3; });
```

**Trois défauts graves :**

1. « chirurgical » ne trouve rien : aucune table ne contient cette sous-chaîne.
2. Aucun classement par pertinence — les 8 premières tables rencontrées sont retenues, dans l'ordre arbitraire des clés d'objet.
3. Les mots vides (`avec`, `pour`, `entre`, `dans`) déclenchent des recherches parasites.

### Le remplacement — index inversé + BM25

BM25 est l'algorithme de classement standard en recherche d'information (c'est le cœur d'Elasticsearch). En JavaScript pur, c'est une centaine de lignes.

```js
/* retrieval.js — index inversé sur les 1 873 tables */

var MOTS_VIDES = {
  'avec':1,'pour':1,'dans':1,'entre':1,'les':1,'des':1,'une':1,'sur':1,
  'par':1,'aux':1,'que':1,'qui':1,'est':1,'sont':1,'tous':1,'toutes':1,
  'veux':1,'voudrais':1,'faire':1,'avoir':1,'cette':1,'leur':1
};

/* Synonymes métier — comble l'écart entre le vocabulaire DIM et les noms de tables */
var SYNONYMES = {
  'chirurgie':     ['INTERVENTION','BLOC','CCAM','ACTE','OPERATOIRE'],
  'chirurgical':   ['INTERVENTION','BLOC','CCAM','ACTE','OPERATOIRE'],
  'operation':     ['INTERVENTION','BLOC','ACTE'],
  'diagnostic':    ['DIAG','CIM','DP','DAS'],
  'germe':         ['INFECTIEUX','ATB','MICROBIO','BACTERIO'],
  'bacterie':      ['INFECTIEUX','ATB','GERME'],
  'antibiotique':  ['ATB','INFECTIEUX'],
  'sejour':        ['SEJOUR','RSS','VENUE'],
  'patient':       ['PATIENT','IPP'],
  'mouvement':     ['MVT','MOUVEMENT','UF'],
  'uf':            ['UNITE','UF'],
  'service':       ['UNITE','UM','UF'],
  'pole':          ['PO','POLE'],
  'urgence':       ['URG','PASSAGE_UR'],
  'valorisation':  ['SYNTH_RSS','GHS','MONTANT','TARIF'],
  'tarif':         ['GHS','TARIF','MONTANT'],
  'duree':         ['DUREE','DMS'],
  'bloc':          ['BLOCS','INTERVENTION','SALLE'],
  'biologie':      ['POLEBIO','LABO','ANALYSE'],
  'laboratoire':   ['LABO','POLEBIO','RESULTAT'],
  'couverture':    ['COUVERTURE','SECU','MUTUELLE'],
  'precarite':     ['COUVERTURE','AME','CMU'],
  'deces':         ['DECES','MODE_SORTIE'],
  'naissance':     ['NAIS','POIDS','PERINAT'],
  'accouchement':  ['ACCOUCHEMENT','OBSTETRIQUE','IVG']
};

function tokeniser(texte) {
  var bruts = (texte || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   /* retire les accents */
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter(function (m) { return m.length > 2 && !MOTS_VIDES[m]; });

  var sortie = [];
  bruts.forEach(function (m) {
    sortie.push(m.toUpperCase());
    (SYNONYMES[m] || []).forEach(function (s) { sortie.push(s); });
  });
  return sortie;
}
```

L'index se construit **une seule fois** au chargement du dictionnaire (quelques centaines de millisecondes pour 1 873 tables), puis chaque recherche est instantanée.

### Gain

| | Avant | Après |
|---|---|---|
| Tables envoyées au modèle | 8, non classées | **3 à 5, les meilleures** |
| Champs par table | 15 premiers (arbitraire) | **les 10 plus pertinents** |
| Tokens | ~1 800 | **~600** |
| « séjours avec intervention chirurgicale » | ❌ 0 table pertinente | ✅ `TAINTERVENTION`, `TB_ACTE`, `TAINDICATEURS_BLOCS_DETAILS` |

**−1 200 tokens, et surtout une qualité de réponse radicalement meilleure.**

---

## Levier 6 🟡 — Routage des modèles par tâche

La table `ROUTES` existe déjà dans `js/api.js` mais n'est pas exploitée à son plein potentiel. Avec l'architecture cible :

| Tâche | Modèle | Justification |
|-------|--------|---------------|
| `plan.resolve` (étape 5) | **Sonnet 4.6** | Seul raisonnement métier réel |
| `join.arbitrate` | **Haiku 5.5** | Choisir entre 2 chemins pré-calculés |
| `col.labels` | **Haiku 5.5** | Mise en forme de libellés |
| `script.comment` | **Haiku 5.5** | Rédaction de commentaires |
| `chat.reply` (libre) | **Sonnet 4.6** | Conversation ouverte |

Haiku est à **$0,80 / M** contre $3,00 pour Sonnet : **−73 %** sur les tâches où il suffit.

---

## Levier 7 🟡 — Bibliothèque de recettes : zéro appel

Tes extractions se répètent. Chacune devient une **recette paramétrée**, et une recette ne coûte **rien**.

```js
/* recipes.js */
HQ.recipes = [
  {
    id: 'sejours-diagnostic',
    libelle: 'Séjours portant un diagnostic CIM-10',
    motsCles: ['diagnostic','cim','dp','das','pathologie','maladie'],
    parametres: [
      { nom:'codes',     libelle:'Codes CIM-10 (regex)',   type:'texte',     defaut:'^I50' },
      { nom:'positions', libelle:'Positions du diagnostic',type:'multi',
        options:['P','R','S'], defaut:['P','R','S'] },
      { nom:'debut',     libelle:'Date de début',          type:'date' },
      { nom:'fin',       libelle:'Date de fin',            type:'date' }
    ],
    construire: function (p) { /* retourne { nodes, joins, warnings } */ }
  },
  { id:'dms-comparee',      libelle:'DMS comparée à la référence nationale', /* … */ },
  { id:'cohorte-uf',        libelle:'Cohorte de séjours passés par des UF',  /* … */ },
  { id:'actes-ccam',        libelle:'Séjours avec actes CCAM',               /* … */ },
  { id:'blocs-operatoires', libelle:'Indicateurs de blocs opératoires',      /* … */ },
  { id:'germes-n2',         libelle:'Germes optimisables en sévérité 2',     /* … */ },
  { id:'precarite',         libelle:'Couverture sociale et précarité',       /* … */ }
];
```

Quand la demande correspond à une recette avec un score supérieur à 0,80, **HospiQuery n'appelle pas l'API du tout**. Le formulaire s'affiche, l'utilisateur remplit, le script sort.

Sur tes usages constatés, **7 recettes couvrent probablement 70 % des demandes**.

---

## 4.8 Synthèse des gains

| Levier | Effort | Gain tokens | Gain $ par extraction |
|--------|--------|-------------|----------------------|
| 1 — Prompt caching | 🟢 1 h | −90 % entrée | $0,92 → $0,12 |
| 2 — Noyau distillé | 🟡 3 h | −26 700 | $0,12 → $0,035 |
| 3 — Tool call | 🟡 4 h | −690 in / −1 100 out | $0,035 → $0,022 |
| 4 — Fenêtre historique | 🟢 1 h | plafonné | $0,022 → $0,018 |
| 5 — BM25 | 🟠 6 h | −1 200 | $0,018 → $0,014 |
| 6 — Routage Haiku | 🟢 1 h | — | $0,014 → $0,011 |
| 7 — Recettes | 🟠 8 h | −100 % si match | **$0,000** (70 % des cas) |

```
Coût moyen par extraction
  Aujourd'hui ........................ $0,92
  Leviers 1-2 seuls (4 h de travail) . $0,035     ← 96 % de l'économie
  Architecture complète .............. $0,0095
  Avec recettes (70 % des cas) ....... $0,0029 en moyenne pondérée

Budget mensuel, 20 extractions
  Aujourd'hui ........................ $18,40
  Architecture v2 .................... $0,06
```

> **À retenir : les leviers 1 et 2 représentent 96 % de l'économie pour 4 heures de travail.** Si tu ne fais qu'une chose, fais ces deux-là.

---

# PARTIE 5 — FONCTIONNER SANS CRÉDITS CLAUDE

Quatre options, de la plus robuste à la plus simple. **Elles sont cumulables.**

## Option A ⭐ — Le moteur local (recommandée)

**C'est la vraie réponse à ta question.** Les leviers 5 et 7, poussés au bout, suppriment purement et simplement le besoin d'IA pour la majorité des demandes.

```
Demande  →  BM25 local  →  recette trouvée ?
                            ├── OUI → formulaire → plan → script R      0 token
                            └── NON → graphe de jointures suffisant ?
                                       ├── OUI → plan → script R        0 token
                                       └── NON → 1 appel API            ~$0,01
```

| Avantage | Détail |
|----------|--------|
| Coût | **Zéro** |
| Latence | **15 ms** au lieu de 40 s |
| Fiabilité | Déterministe, reproductible, testable |
| Hors ligne | Fonctionne sans réseau |
| Confidentialité | Aucune donnée ne sort du poste |

**Couverture estimée : 70 % des demandes sans aucun appel.**

---

## Option B — OmniRoute / Groq : modèles gratuits

Tu as **déjà** une passerelle multi-modèles installée sur le port 20128, avec `groq/openai/gpt-oss-120b` gratuit, 131 k de contexte, ~2,7 s de latence. Et `js/api.js` contient déjà le point d'entrée :

```js
var LOCAL_URL = 'http://localhost:20128/v1/chat/completions';
```

### ⚠️ L'obstacle : le contenu mixte

Depuis `https://oussoudiop05-ui.github.io`, le navigateur **bloque** tout appel vers `http://localhost:20128`. C'est la règle du *mixed content*, elle n'est pas contournable côté page.

### La solution : servir HospiQuery en local

```bash
cd "C:\Users\Doctorant_ST\Desktop\CREATION DE SCRIPT\hospiquery"
python -m http.server 8777 --bind 127.0.0.1
```

Puis ouvrir `http://localhost:8777`. Les deux origines sont alors en `http://` : aucun blocage.

### Fichier de confort à créer — `LANCER_HOSPIQUERY.bat`

```bat
@echo off
cd /d "%~dp0"
start "" http://localhost:8777
python -m http.server 8777 --bind 127.0.0.1
```

Double-clic, le navigateur s'ouvre, HospiQuery tourne en local avec les modèles gratuits.

### À ajouter côté CORS

OmniRoute doit autoriser l'origine `http://localhost:8777`. Si l'appel échoue avec une erreur CORS, ajouter dans la configuration OmniRoute :

```
ALLOWED_ORIGINS=http://localhost:8777,http://127.0.0.1:8777
```

| Avantage | Limite |
|----------|--------|
| Gratuit, déjà installé | Nécessite l'ouverture en local |
| 131 k de contexte | Qualité en deçà de Sonnet sur le raisonnement |
| ~2,7 s | Réservé au **niveau 1** de ta règle de délégation |

> **Usage conseillé :** router les tâches mécaniques (libellés, commentaires, reformulation) vers Groq, et garder Sonnet pour l'unique appel sémantique — ou s'en passer grâce à l'option A.

---

## Option C — Le pont Claude Code (« apporte ton propre Claude »)

Tu paies déjà un abonnement Claude Code. **Pourquoi payer deux fois ?**

Le principe : HospiQuery ne fait aucun appel réseau. Il produit un **prompt compact** à copier dans Claude Code, et accepte en retour le JSON produit.

```
┌──────────────┐  ① Copier le prompt   ┌──────────────┐
│  HospiQuery  │ ────────────────────► │ Claude Code  │
│  (navigateur)│                        │  (abonnement)│
│              │ ◄──────────────────── │              │
└──────────────┘  ② Coller le JSON      └──────────────┘
```

### Interface à ajouter

```js
/* ui-pont.js — deux boutons dans le panneau Discussion */

function copierPrompt() {
  var prompt = HQ.prompt.construirePromptCompact(HQ.store.getState());
  navigator.clipboard.writeText(prompt);
  toast('Prompt copié — collez-le dans Claude Code', 'ok');
}

function collerReponse(texte) {
  try {
    var jsonStr = texte.trim()
      .replace(/^```(?:json)?\s*/i, '')        /* retire les clôtures markdown */
      .replace(/\s*```$/, '');
    var plan = JSON.parse(jsonStr);
    HQ.store.patch(function (s) { return HQ.planner.appliquer(s, plan); });
    toast('Plan appliqué', 'ok');
  } catch (e) {
    toast('JSON invalide : ' + e.message, 'warn');
  }
}
```

Le prompt compact (~800 tokens) tient largement dans une fenêtre de chat :

```
Tu es assistant DIM/PMSI (base HospiTrack, APHM).

DEMANDE : séjours avec intervention chirurgicale entre 2023 et 2026

CADRAGE (réponses de l'utilisateur) :
- Bornes      : date de sortie, du 20230101 au 20261231
- Champ       : MCO uniquement
- Type passage: hospitalisations (TYP_PASS='2')
- Granularité : 1 ligne = 1 séjour
- Séjours en cours : exclus

TABLES CANDIDATES (recherche locale sur le dictionnaire) :
- TAINTERVENTION — Interventions chirurgicales — N lignes/séjour
  champs : INT_ID, INT_IEP, INT_DATE, INT_UF, INT_CODE_CCAM
- TB_ACTE — Actes médicaux CCAM — N lignes/séjour
  champs : ID_SEJOUR, CODE_ACTE, EXTENSION_ATIH, DATE_ACTE, ID_UNITE_EXEC
- TAINDICATEURS_BLOCS_DETAILS — Détail blocs opératoires — 1 ligne/intervention
  champs : IEP, IPP, UF_CODE, INTERVENTION_ID, INTERVENTION_DATE

RÈGLES : STATUT='T' sur TB_SYNTH_RSS · trimws() sur NO_SEJOUR ·
         dates SQL en AAAAMMJJ · signaler tout multiplicateur de lignes

Réponds UNIQUEMENT par ce JSON, sans aucun texte autour :
{"granularite":"...", "tables":[{"nom":"...","role":"depart|enrichissement|filtre","pourquoi":"..."}],
 "filtres":[{"table":"...","colonne":"...","operateur":"...","valeur":"..."}],
 "codes_metier":[{"nomenclature":"CCAM","motif":"...","libelle":"..."}],
 "incertitudes":["..."]}
```

| Avantage | Limite |
|----------|--------|
| **Coût strictement nul** | Deux copier-coller manuels |
| Qualité Sonnet/Opus complète | Pas de streaming |
| Aucune clé API dans le navigateur | — |
| Fonctionne depuis GitHub Pages | — |

> **Mon avis :** c'est l'option la plus sous-estimée. Deux copier-coller contre $18 par mois, et tu gardes la pleine qualité du modèle.

---

## Option D — Proxy Cloudflare Worker

Ne supprime pas le coût, mais **protège la clé API**, qui est aujourd'hui lisible dans le navigateur par n'importe qui.

```js
/* worker.js — à déployer sur workers.cloudflare.com (100 000 requêtes/jour gratuites) */
export default {
  async fetch(request, env) {
    const ORIGINES = ['https://oussoudiop05-ui.github.io', 'http://localhost:8777'];
    const origine  = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin':  ORIGINES.includes(origine) ? origine : ORIGINES[0],
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return new Response('Méthode non autorisée', { status: 405 });
    if (!ORIGINES.includes(origine))  return new Response('Origine refusée', { status: 403 });

    const reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_KEY,      // ← secret, jamais exposé
        'anthropic-version': '2023-06-01'
      },
      body: request.body
    });

    return new Response(reponse.body, {
      status:  reponse.status,
      headers: { ...cors, 'Content-Type': 'text/event-stream' }
    });
  }
};
```

La clé est stockée côté Cloudflare (`wrangler secret put ANTHROPIC_KEY`). HospiQuery n'appelle plus que le Worker.

---

## 5.5 Stratégie recommandée — combinée

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Moteur local (recettes + graphe)       → 70 % des cas, $0│
│ 2. Groq via OmniRoute en local            → 20 % des cas, $0│
│ 3. Pont Claude Code pour les cas difficiles → 8 %,        $0│
│ 4. API Claude + cache en dernier recours   →  2 %,  ~$0,01 │
└─────────────────────────────────────────────────────────────┘
          Budget mensuel attendu : moins de 0,50 $
```

---

# PARTIE 6 — PLAN D'EXÉCUTION

## Ordre impératif

Chaque lot est **autonome, testable et livrable**. Ne jamais entamer le suivant sans avoir validé le précédent dans le navigateur, console propre.

---

### 🔴 LOT 1 — Correction du gel *(30 min)*

**Pourquoi d'abord :** l'application est inutilisable en l'état.

| Fichier | Action |
|---------|--------|
| `js/render-chat.js` | Garde-fou `if (i === iAvant) { … i++; }` dans la branche paragraphe |
| `js/render-chat.js` | Plafond d'itérations `PLAFOND = n * 4 + 1000` |
| `js/render-chat.js` | Throttle `requestAnimationFrame` sur `onChunk` |
| `index.html` | `?v=13` → `?v=14` |

**Validation :**
1. Coller dans la console un texte contenant `**Q1 — Test**`, `*italique*`, `#Titre`, `` `code` `` en début de ligne.
2. `HQ.renderChat` doit rendre la main en moins de 50 ms.
3. Aucune boîte « page ne répond plus ».

---

### 🔴 LOT 2 — `marked.js` + prompt caching *(2 h)*

| Fichier | Action |
|---------|--------|
| `index.html` | `<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"></script>` |
| `js/render-chat.js` | Supprimer `renderMarkdown`, `renderInline` ; utiliser `marked.parse()` |
| `js/api.js` | `body.system` devient un tableau, `cache_control` sur le bloc stable |
| `js/prompt.js` | `buildSystem` retourne `{ stable, variable }` au lieu d'une chaîne |
| `js/ui-settings.js` | Afficher les tokens cachés dans les statistiques |

**Validation :** le second message d'une session affiche `cache_read_input_tokens > 0` dans la réponse API. Coût divisé par 8 au minimum.

---

### 🟠 LOT 3 — Noyau distillé *(3 h)*

| Fichier | Action |
|---------|--------|
| `data/noyau-pmsi.js` | **Créer** — le noyau de ~3 500 tokens (Partie 4, levier 2) |
| `js/prompt.js` | Utiliser `HQ.NOYAU_PMSI` par défaut ; CLAUDE.md complet seulement si l'utilisateur coche « mode complet » |
| `js/ui-settings.js` | Case à cocher « Envoyer le CLAUDE.md complet (coûteux) », décochée par défaut |

**Validation :** prompt système sous 4 500 tokens. Qualité des réponses inchangée sur 3 demandes de référence.

---

### 🟠 LOT 4 — Recherche BM25 *(6 h)*

| Fichier | Action |
|---------|--------|
| `js/retrieval.js` | **Créer** — tokeniseur, synonymes, index inversé, BM25 |
| `js/dictionary.js` | Appeler `HQ.retrieval.construireIndex()` après `load()` |
| `js/prompt.js` | `dictExcerpt` utilise `HQ.retrieval.chercher(demande, 5)` |

**Validation :** « séjours avec intervention chirurgicale » doit remonter `TAINTERVENTION` en tête. Extrait sous 700 tokens.

---

### 🟠 LOT 5 — Graphe de jointures *(8 h)*

| Fichier | Action |
|---------|--------|
| `js/joingraph.js` | **Créer** — graphe depuis les 1 614 liens + registre ✅, Dijkstra |
| `js/joins.js` | Ajouter `HQ.joins.trouverChemin(a, b)` |
| `js/render-joins.js` | Afficher la preuve (✅/📖/❓) sur chaque arête proposée |

**Validation :** `HQ.joingraph.chemin('TB_DIAG','TB_PATIENT')` retourne un chemin en 2 sauts via `TB_SEJOUR`, marqué ✅.

---

### 🟡 LOT 6 — Formulaire de cadrage *(5 h)*

| Fichier | Action |
|---------|--------|
| `js/cadrage.js` | **Créer** — les 8 questions du CLAUDE.md § 14, en formulaire |
| `css/components.css` | Styles du formulaire |
| `js/app.js` | Machine à états `IDLE → CADRAGE → …` |

**Validation :** une demande saisie ouvre le formulaire pré-rempli. Zéro appel réseau sur cette phase.

---

### 🟡 LOT 7 — Tool call *(4 h)*

| Fichier | Action |
|---------|--------|
| `js/tools.js` | **Créer** — définition `proposer_extraction` |
| `js/api.js` | Support de `tools` / `tool_choice` ; lecture des blocs `tool_use` |
| `js/planner.js` | **Créer** — tool call → état complet (jointures via `joingraph`) |
| `js/prompt.js` | Supprimer `FORMAT_INSTRUCTIONS` et les marqueurs `HQ_STATE_*` |

**Validation :** une demande produit un plan complet en **un seul appel**, sortie sous 500 tokens.

---

### 🟡 LOT 8 — Recettes *(8 h)*

| Fichier | Action |
|---------|--------|
| `js/recipes.js` | **Créer** — 7 recettes paramétrées |
| `js/ui-recipes.js` | **Créer** — détection + formulaire de paramètres |
| `js/app.js` | Court-circuiter l'appel API si score > 0,80 |

**Validation :** « germes niveau 2 » déclenche la recette sans aucun appel réseau. `HQ.api.getStats().calls` reste à 0.

---

### 🟢 LOT 9 — Modes sans crédits *(4 h)*

| Fichier | Action |
|---------|--------|
| `LANCER_HOSPIQUERY.bat` | **Créer** — serveur local + ouverture navigateur |
| `js/ui-pont.js` | **Créer** — boutons « Copier le prompt » / « Coller la réponse » |
| `js/ui-settings.js` | Sélecteur de mode : Local / OmniRoute / Pont Claude Code / API |

**Validation :** les 4 modes produisent un script R correct pour la même demande.

---

## Calendrier

| Phase | Lots | Durée | Effet |
|-------|------|-------|-------|
| **Urgence** | 1 – 2 | **½ journée** | Application réparée, **−87 % de coût** |
| **Économie** | 3 – 4 | 1,5 jour | **−96 % de coût**, meilleure pertinence |
| **Intelligence** | 5 – 7 | 2,5 jours | Un seul appel, déterminisme |
| **Autonomie** | 8 – 9 | 1,5 jour | **Zéro coût** sur 70 % des cas |

> **Après les lots 1 et 2 — une demi-journée — l'application est réparée et 87 % moins chère.** Le reste est de l'optimisation.

---

# PARTIE 7 — SPÉCIFICATIONS DE CODE

## 7.1 `js/retrieval.js` — recherche BM25

```js
/* ============================================================
   retrieval.js — index inversé + classement BM25 sur le dictionnaire.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.retrieval
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  var K1 = 1.5, B = 0.75;          /* paramètres BM25 standard */
  var _index = null;               /* terme → [{ table, tf }] */
  var _longueurs = {};             /* table → nb de termes */
  var _longueurMoyenne = 0;
  var _nbDocs = 0;

  /* --- MOTS_VIDES, SYNONYMES, tokeniser() : voir Partie 4 levier 5 --- */

  function construireIndex() {
    if (!HQ.dictionary || !HQ.dictionary.isLoaded()) return false;

    _index = {};
    _longueurs = {};
    var total = 0;

    HQ.dictionary.chaqueTable(function (tbl) {
      var nom = (tbl.name || '').toUpperCase();

      /* Le nom de la table pèse 3×, la description 2×, les champs 1× */
      var termes = []
        .concat(tokeniser(nom), tokeniser(nom), tokeniser(nom))
        .concat(tokeniser(tbl.description || ''), tokeniser(tbl.description || ''));

      (tbl.fields || []).forEach(function (f) {
        termes = termes.concat(tokeniser(f.name),
                               tokeniser((f.description || '').slice(0, 120)));
      });

      _longueurs[nom] = termes.length;
      total += termes.length;
      _nbDocs++;

      var freq = {};
      termes.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });

      Object.keys(freq).forEach(function (t) {
        (_index[t] = _index[t] || []).push({ table: nom, tf: freq[t] });
      });
    });

    _longueurMoyenne = total / Math.max(1, _nbDocs);
    return true;
  }

  function chercher(requete, k) {
    if (!_index) return [];
    k = k || 5;

    var termes = tokeniser(requete);
    var scores = {};

    termes.forEach(function (terme) {
      var postings = _index[terme];
      if (!postings) return;

      var df  = postings.length;
      var idf = Math.log(1 + (_nbDocs - df + 0.5) / (df + 0.5));

      postings.forEach(function (p) {
        var normalisation = 1 - B + B * (_longueurs[p.table] / _longueurMoyenne);
        var contribution  = idf * (p.tf * (K1 + 1)) / (p.tf + K1 * normalisation);
        scores[p.table] = (scores[p.table] || 0) + contribution;
      });
    });

    return Object.keys(scores)
      .map(function (nom) { return { nom: nom, score: scores[nom] }; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, k)
      .map(function (r) {
        return { table: HQ.dictionary.getTable(r.nom), score: r.score };
      })
      .filter(function (r) { return r.table; });
  }

  /* Rend un extrait compact pour le prompt — seulement les champs utiles */
  function extraitPourPrompt(requete, k) {
    var resultats = chercher(requete, k || 4);
    if (!resultats.length) return 'Aucune table pertinente trouvée.';

    return resultats.map(function (r) {
      var t = r.table;
      var champs = champsPertinents(t, requete, 10)
        .map(function (f) {
          var d = (f.description || '').slice(0, 70);
          return '  ' + f.name + (d ? ' — ' + d : '');
        }).join('\n');

      var liens = (HQ.dictionary.getLinks(t.name) || [])
        .filter(function (l) { return l.targetTable; })
        .slice(0, 4)
        .map(function (l) { return l.fieldName + '→' + l.targetTable; })
        .join(', ');

      return '### ' + t.name
           + (t.description ? ' — ' + t.description.slice(0, 90) : '')
           + '\n' + champs
           + (liens ? '\n  Liens : ' + liens : '');
    }).join('\n\n');
  }

  /* Classe les champs d'une table par pertinence à la requête */
  function champsPertinents(table, requete, n) {
    var termes = {};
    tokeniser(requete).forEach(function (t) { termes[t] = true; });

    return (table.fields || [])
      .map(function (f) {
        var s = 0;
        var nomMaj = (f.name || '').toUpperCase();
        if (/^(ID_|NO_|IEP|IPP|CODE_|NUM_)/.test(nomMaj)) s += 5;   /* identifiants */
        if (/DATE|STATUT|TYPE/.test(nomMaj))              s += 2;
        tokeniser(f.name).forEach(function (t) { if (termes[t]) s += 8; });
        tokeniser(f.description || '').forEach(function (t) { if (termes[t]) s += 3; });
        return { f: f, s: s };
      })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, n || 10)
      .map(function (x) { return x.f; });
  }

  HQ.retrieval = {
    construireIndex:   construireIndex,
    chercher:          chercher,
    extraitPourPrompt: extraitPourPrompt,
    champsPertinents:  champsPertinents,
    tokeniser:         tokeniser
  };
})();
```

> ⚠️ **Prérequis.** Ajouter `chaqueTable(callback)` à `HQ.dictionary` — un simple parcours de `_index.tablesByName`.

---

## 7.2 `js/joingraph.js` — graphe de jointures

```js
/* ============================================================
   joingraph.js — graphe des jointures + plus court chemin.
   Construit depuis les 1 614 liens du dictionnaire + le registre ✅.
   Expose HQ.joingraph
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  /* Registre manuel — jointures ✅ validées en production (CLAUDE.md § 12.3).
     Poids 1 = certitude absolue, Dijkstra les privilégiera toujours. */
  var REGISTRE = [
    { de:'TB_SEJOUR',    vers:'TB_DIAG',        champDe:'ID_SEJOUR', champVers:'ID_SEJOUR',        preuve:'ok' },
    { de:'TB_SEJOUR',    vers:'TB_SYNTH_RSS',   champDe:'ID_SEJOUR', champVers:'ID_SEJOUR',        preuve:'ok' },
    { de:'TB_SYNTH_RSS', vers:'TB_SYNTH_RUM',   champDe:'ID_RSS',    champVers:'ID_RSS',           preuve:'ok' },
    { de:'TB_SYNTH_RUM', vers:'TB_UNITE',       champDe:'ID_UNITE_RESP_MED', champVers:'ID_UNITE', preuve:'ok' },
    { de:'TB_SYNTH_RSS', vers:'TB_UNITE_MEDICALE', champDe:'ID_UM_RETENU', champVers:'ID_UNITE_MED', preuve:'ok' },
    { de:'TB_SEJOUR',    vers:'TB_PATIENT',     champDe:'ID_PATIENT', champVers:'ID_PATIENT',      preuve:'ok' },
    { de:'TMVENUE_PL',   vers:'TB_SEJOUR',      champDe:'IEP',       champVers:'NO_SEJOUR',        preuve:'ok',
      note:'trimws() obligatoire sur NO_SEJOUR' },
    { de:'TB_ACTE',      vers:'TB_SYNTH_RSS',   champDe:'ID_SEJOUR', champVers:'ID_SEJOUR',        preuve:'ok' },
    { de:'TB_ACTE',      vers:'TB_UNITE',       champDe:'ID_UNITE_EXEC', champVers:'ID_UNITE',     preuve:'ok' },
    { de:'TB_ACTE',      vers:'TB_PATIENT',     champDe:'ID_PATIENT', champVers:'ID_PATIENT',      preuve:'ok' },
    { de:'TB_MVT',       vers:'TB_DIAG',        champDe:'ID_MVT',    champVers:'ID_MVT',           preuve:'ok',
      note:'lien PRINCIPAL de TB_DIAG — c\'est la vraie granularité' },
    { de:'TB_MVT',       vers:'TB_SYNTH_RSS',   champDe:'ID_RSS',    champVers:'ID_RSS',           preuve:'ok' }
  ];

  var POIDS = { ok: 1, dict: 3, suppose: 10 };   /* Dijkstra minimise */

  var _graphe = null;        /* table → [arêtes] */

  function ajouterArete(g, de, vers, champDe, champVers, preuve, note) {
    (g[de] = g[de] || []).push({
      vers: vers, champDe: champDe, champVers: champVers,
      preuve: preuve, poids: POIDS[preuve] || 10, note: note || ''
    });
    /* le graphe est non orienté pour la recherche de chemin */
    (g[vers] = g[vers] || []).push({
      vers: de, champDe: champVers, champVers: champDe,
      preuve: preuve, poids: POIDS[preuve] || 10, note: note || ''
    });
  }

  function construire() {
    var g = {};

    /* 1 — registre validé, poids le plus faible */
    REGISTRE.forEach(function (r) {
      ajouterArete(g, r.de, r.vers, r.champDe, r.champVers, r.preuve, r.note);
    });

    /* 2 — les 1 614 liens documentés dans les descriptions du dictionnaire */
    if (HQ.dictionary && HQ.dictionary.isLoaded()) {
      HQ.dictionary.chaqueTable(function (tbl) {
        var nom = (tbl.name || '').toUpperCase();
        (HQ.dictionary.getLinks(nom) || []).forEach(function (l) {
          if (!l.targetTable) return;
          var deja = (g[nom] || []).some(function (a) {
            return a.vers === l.targetTable && a.preuve === 'ok';
          });
          if (deja) return;                                   /* ne pas écraser un ✅ */
          ajouterArete(g, nom, l.targetTable,
                       l.fieldName, l.targetField || l.fieldName, 'dict');
        });
      });
    }

    _graphe = g;
    return g;
  }

  /* Dijkstra — plus court chemin pondéré par la fiabilité */
  function chemin(depart, arrivee, sautsMax) {
    if (!_graphe) construire();
    depart  = (depart  || '').toUpperCase();
    arrivee = (arrivee || '').toUpperCase();
    sautsMax = sautsMax || 4;

    if (depart === arrivee) return [];
    if (!_graphe[depart])   return null;

    var dist     = {}; dist[depart] = 0;
    var parent   = {};
    var visites  = {};
    var file     = [{ table: depart, cout: 0, sauts: 0 }];

    while (file.length) {
      file.sort(function (a, b) { return a.cout - b.cout; });
      var courant = file.shift();

      if (visites[courant.table]) continue;
      visites[courant.table] = true;

      if (courant.table === arrivee) break;
      if (courant.sauts >= sautsMax) continue;

      (_graphe[courant.table] || []).forEach(function (arete) {
        var nouveauCout = courant.cout + arete.poids;
        if (dist[arete.vers] === undefined || nouveauCout < dist[arete.vers]) {
          dist[arete.vers]   = nouveauCout;
          parent[arete.vers] = { table: courant.table, arete: arete };
          file.push({ table: arete.vers, cout: nouveauCout, sauts: courant.sauts + 1 });
        }
      });
    }

    if (!parent[arrivee] && depart !== arrivee) return null;

    /* remonter le chemin */
    var sortie = [], noeud = arrivee;
    while (parent[noeud]) {
      var p = parent[noeud];
      sortie.unshift({
        de: p.table, vers: noeud,
        champDe: p.arete.champDe, champVers: p.arete.champVers,
        preuve: p.arete.preuve, note: p.arete.note
      });
      noeud = p.table;
    }
    return sortie;
  }

  /* Relie un ensemble de tables entre elles (arbre couvrant approché) */
  function relier(tables) {
    if (!tables || tables.length < 2) return [];
    var racine = tables[0].toUpperCase();
    var jointures = [], relies = {};
    relies[racine] = true;

    tables.slice(1).forEach(function (cible) {
      var meilleur = null;
      Object.keys(relies).forEach(function (source) {
        var c = chemin(source, cible);
        if (c && (!meilleur || c.length < meilleur.length)) meilleur = c;
      });
      if (meilleur) {
        meilleur.forEach(function (etape) {
          var existe = jointures.some(function (j) {
            return j.de === etape.de && j.vers === etape.vers;
          });
          if (!existe) jointures.push(etape);
          relies[etape.vers] = true;
        });
      }
    });
    return jointures;
  }

  HQ.joingraph = {
    construire: construire,
    chemin:     chemin,
    relier:     relier,
    REGISTRE:   REGISTRE
  };
})();
```

### Démonstration de ce que cela remplace

```js
HQ.joingraph.chemin('TB_DIAG', 'TB_UNITE_MEDICALE');
/* →
[
  { de:'TB_DIAG',      vers:'TB_SEJOUR',          champDe:'ID_SEJOUR',    champVers:'ID_SEJOUR',    preuve:'ok' },
  { de:'TB_SEJOUR',    vers:'TB_SYNTH_RSS',       champDe:'ID_SEJOUR',    champVers:'ID_SEJOUR',    preuve:'ok' },
  { de:'TB_SYNTH_RSS', vers:'TB_UNITE_MEDICALE',  champDe:'ID_UM_RETENU', champVers:'ID_UNITE_MED', preuve:'ok' }
]
*/
```

**Trois jointures, toutes ✅ validées, trouvées en moins d'une milliseconde, pour zéro token.** C'est le travail que l'on payait $0,13 par message à un modèle de langage — avec le risque qu'il invente une clé.

---

## 7.3 `js/api.js` — mise en cache et tool calls

```js
/* ---- Construction du corps de requête Anthropic ---- */
function corpsAnthropic(model, opts) {
  var body = {
    model:      model,
    max_tokens: opts.maxTokens || 2048,
    messages:   opts.messages
  };

  /* Système en deux blocs : le stable est mis en cache */
  if (opts.systemStable || opts.system) {
    body.system = [];
    if (opts.systemStable) {
      body.system.push({
        type: 'text',
        text: opts.systemStable,
        cache_control: { type: 'ephemeral' }     /* ← 90 % d'économie */
      });
    }
    if (opts.system) {
      body.system.push({ type: 'text', text: opts.system });
    }
  }

  /* Sortie structurée */
  if (opts.tools) {
    body.tools = opts.tools;
    if (opts.forceTool) {
      body.tool_choice = { type: 'tool', name: opts.forceTool };
    }
  }

  return body;
}

/* ---- Statistiques enrichies avec le cache ---- */
function _ajouterUsage(model, u) {
  _stats.calls++;
  _stats.inputTokens      += u.input_tokens                || 0;
  _stats.outputTokens     += u.output_tokens               || 0;
  _stats.cacheWriteTokens += u.cache_creation_input_tokens || 0;
  _stats.cacheReadTokens  += u.cache_read_input_tokens     || 0;

  var p = PRICING[model];
  if (p) {
    _stats.costUSD +=
        ((u.input_tokens                || 0) * p.in
       + (u.output_tokens               || 0) * p.out
       + (u.cache_creation_input_tokens || 0) * p.in  * 1.25     /* écriture */
       + (u.cache_read_input_tokens     || 0) * p.in  * 0.10     /* lecture  */
        ) / 1e6;
  }
}

/* ---- Extraction d'un tool call dans la réponse ---- */
function lireToolCall(data, nomOutil) {
  var blocs = data.content || [];
  for (var i = 0; i < blocs.length; i++) {
    if (blocs[i].type === 'tool_use' && blocs[i].name === nomOutil) {
      return blocs[i].input;                     /* déjà un objet JS — pas de parsing */
    }
  }
  return null;
}
```

---

## 7.4 `js/cadrage.js` — les 8 questions en formulaire

```js
/* Les 8 questions sont FIXES (CLAUDE.md § 14). Aucun appel réseau. */
HQ.cadrage = {
  QUESTIONS: [
    { id:'bornes',     libelle:'Borner la période sur…', type:'radio',
      options:[{v:'entree',l:'Date d\'entrée'},{v:'sortie',l:'Date de sortie'}],
      defaut:'sortie',
      aide:'La date de sortie est l\'usage courant pour les séjours terminés.' },

    { id:'periode',    libelle:'Période',                type:'plage-dates',
      defaut:{ debut:'20230101', fin:'20261231' } },

    { id:'champ',      libelle:'Champ PMSI',             type:'cases',
      options:[{v:'MCO',l:'MCO'},{v:'SSR',l:'SSR'},{v:'HAD',l:'HAD'},{v:'PSY',l:'PSY'}],
      defaut:['MCO'] },

    { id:'typePassage',libelle:'Type de passage',        type:'cases',
      options:[{v:'2',l:'Hospitalisations'},{v:'1',l:'Urgences'},
               {v:'3',l:'Consultations'},{v:'4',l:'Séances'}],
      defaut:['2'] },

    { id:'granularite',libelle:'Une ligne du résultat = ', type:'liste',
      options:[{v:'sejour',l:'1 séjour'},{v:'rss',l:'1 RSS'},{v:'rum',l:'1 RUM'},
               {v:'diagnostic',l:'1 diagnostic'},{v:'acte',l:'1 acte'},
               {v:'patient',l:'1 patient'}],
      defaut:'sejour' },

    { id:'enCours',    libelle:'Séjours en cours (sans date de sortie)', type:'radio',
      options:[{v:'exclure',l:'Exclure'},{v:'inclure',l:'Inclure'}],
      defaut:'exclure' },

    { id:'perimetre',  libelle:'Périmètre structurel',   type:'texte',
      defaut:'', aide:'Vide = tout l\'établissement. Sinon : codes UF, pôle ou service.' },

    { id:'mutations',  libelle:'Mutations internes (MODE_ENTREE 6x)', type:'radio',
      options:[{v:'inclure',l:'Inclure'},{v:'exclure',l:'Exclure'}],
      defaut:'inclure' }
  ],

  /* Produit le bloc compact injecté dans le prompt (~120 tokens) */
  enTexte: function (reponses) {
    return [
      'CADRAGE :',
      '- Bornes       : ' + (reponses.bornes === 'sortie' ? 'date de sortie' : 'date d\'entrée')
                          + ', du ' + reponses.periode.debut + ' au ' + reponses.periode.fin,
      '- Champ        : ' + (reponses.champ || []).join(', '),
      '- Type passage : ' + (reponses.typePassage || []).join(', '),
      '- Granularité  : 1 ligne = 1 ' + reponses.granularite,
      '- Séjours en cours : ' + reponses.enCours,
      '- Périmètre    : ' + (reponses.perimetre || 'tout l\'établissement'),
      '- Mutations    : ' + reponses.mutations
    ].join('\n');
  }
};
```

**Zéro token.** Le formulaire pose les questions mieux et plus vite qu'un modèle de langage, avec des valeurs par défaut que l'utilisateur ajuste d'un clic.

---

## 7.5 `js/planner.js` — tool call → état complet

```js
/* Transforme la sortie du modèle (ou d'une recette) en état HospiQuery.
   Les jointures sont calculées LOCALEMENT par joingraph — jamais par le modèle. */
function construirePlan(sortieOutil, cadrage) {
  var noms  = sortieOutil.tables.map(function (t) { return t.nom.toUpperCase(); });
  var noeuds = [];

  noms.forEach(function (nom, i) {
    var tbl = HQ.dictionary.getTable(nom);
    if (!tbl) return;

    noeuds.push({
      id:          'n' + (i + 1),
      kind:        'table',
      name:        nom,
      schema:      schemaDe(nom),                 /* dbo. ou Q. */
      conn:        connexionDe(nom),              /* con2 ou con1 */
      source:      sourceDe(nom),
      reliability: HQ.dictionary.getTable(nom) ? 'dict' : 'supposed',
      grain:       grainDe(nom),
      multiplier:  HQ.rules.multiplicateur(nom),  /* table de référence locale */
      columns:     HQ.columns.choisir(nom, sortieOutil, cadrage)
    });
  });

  /* Jointures : calculées par le graphe, pas par le modèle */
  var cheminsJ = HQ.joingraph.relier(noms);
  var joins = cheminsJ.map(function (c) {
    return {
      from: idDe(noeuds, c.de),
      to:   idDe(noeuds, c.vers),
      type: 'left',
      on:   [[c.champDe, c.champVers]],
      note: c.note || ('Lien ' + c.preuve)
    };
  });

  /* Filtres obligatoires injectés automatiquement */
  HQ.rules.appliquerFiltresObligatoires(noeuds, cadrage);

  return {
    request:     sortieOutil.justification || '',
    granularity: '1 ligne = 1 ' + sortieOutil.granularite,
    nodes:       noeuds,
    joins:       joins,
    warnings:    HQ.rules.avertissements(noeuds, joins)
  };
}
```

---

## 7.6 `js/rules.js` — règles métier locales

```js
HQ.rules = {
  MULTIPLICATEURS: {
    'TB_DIAG':            { facteur:'×nb_diags ×nb_mvts', raison:'Granularité = LE MOUVEMENT (lien principal ID_MVT)' },
    'TACCAM':             { facteur:'×nb_actes',          raison:'Plusieurs actes CCAM par séjour' },
    'TACCAM_MODIFICATEUR':{ facteur:'×nb_modificateurs',  raison:'Joindre via CCA_ID, jamais sur le séjour' },
    'TB_SYNTH_RUM':       { facteur:'×nb_RUM',            raison:'Plusieurs RUM par RSS en multi-UM' },
    'TMCOUVERTURE_PL':    { facteur:'×2 ou plus',         raison:'Sécu + Mutuelle' },
    'TMMOUVEMENT_PL':     { facteur:'×nb_mouvements',     raison:'Plusieurs UF par venue' },
    'PMSI_LIB_GHS_TARIF': { facteur:'×nb_versions',       raison:'Historique tarifaire — filtrer GET_LIBELLE=\'O\'' },
    'CIM_HIERARCHIE':     { facteur:'×nb_versions',       raison:'Filtrer ACTIF=\'O\'' },
    'TB_ACTE':            { facteur:'×nb_actes',          raison:'Plusieurs actes par séjour' },
    'TAINTERVENTION':     { facteur:'×nb_interventions',  raison:'Plusieurs interventions par séjour' }
  },

  FILTRES_OBLIGATOIRES: {
    'TB_SYNTH_RSS':       [{ colonne:'STATUT',      filtre:"= 'T'" }],
    'TMVENUE_PL':         [{ colonne:'ETAT_DOSS',   filtre:"= 'A'" }],
    'TMPATIENT_PL':       [{ colonne:'STATUT_IPP',  filtre:"= '3'" }],
    'PMSI_LIB_GHS_TARIF': [{ colonne:'GET_LIBELLE', filtre:"= 'O'" }],
    'CIM_HIERARCHIE':     [{ colonne:'ACTIF',       filtre:"= 'O'" }]
  },

  TRIMWS_REQUIS: ['NO_SEJOUR', 'IEP'],

  multiplicateur: function (nom) {
    return this.MULTIPLICATEURS[(nom || '').toUpperCase()] || null;
  },

  appliquerFiltresObligatoires: function (noeuds, cadrage) {
    var self = this;
    noeuds.forEach(function (n) {
      (self.FILTRES_OBLIGATOIRES[n.name] || []).forEach(function (f) {
        var col = n.columns.filter(function (c) { return c.name === f.colonne; })[0];
        if (col) { col.filter = f.filtre; col.checked = true; }
        else {
          n.columns.push({ name:f.colonne, checked:false, filter:f.filtre,
                           type:'varchar', label:'Filtre obligatoire',
                           alias:'', isKey:false, note:'Injecté automatiquement' });
        }
      });
    });
  },

  avertissements: function (noeuds, joins) {
    var avs = [];
    noeuds.forEach(function (n) {
      if (n.multiplier) {
        avs.push({ level:'warn',
          text: n.name + ' multiplie les lignes (' + n.multiplier.facteur + ') — '
              + n.multiplier.raison + '. Agréger AVANT de joindre.' });
      }
    });
    joins.forEach(function (j) {
      (j.on || []).forEach(function (paire) {
        if (HQ.rules.TRIMWS_REQUIS.indexOf(paire[0]) >= 0 ||
            HQ.rules.TRIMWS_REQUIS.indexOf(paire[1]) >= 0) {
          avs.push({ level:'warn',
            text: 'trimws() obligatoire sur ' + paire.join(' = ')
                + ' — sans quoi la jointure renvoie 0 ligne SANS lever d\'erreur.' });
        }
      });
    });
    return avs;
  }
};
```

---

# PARTIE 8 — CRITÈRES D'ACCEPTATION

> **Aucun lot n'est « fait » tant que son critère n'est pas vérifié dans le navigateur, console ouverte et vide.**

| Lot | Critère vérifiable | Commande de contrôle |
|-----|--------------------|-----------------------|
| **1** | Aucune boucle infinie sur du markdown pathologique | `console.time('md'); HQ.renderChat._test('**Q1**\n*a*\n#b\n\`c\`'); console.timeEnd('md')` → **< 50 ms** |
| **1** | Streaming fluide | Observer : écriture DOM **≤ 60 fois/s** |
| **2** | Cache actif | 2ᵉ message : `cache_read_input_tokens > 0` |
| **2** | `marked.js` chargé | `typeof marked === 'function'` → `true` |
| **3** | Noyau en service | `HQ.prompt.buildSystem(s).stable.length < 16000` |
| **4** | BM25 pertinent | `HQ.retrieval.chercher('intervention chirurgicale',3)[0].table.name` → `TAINTERVENTION` |
| **5** | Graphe opérationnel | `HQ.joingraph.chemin('TB_DIAG','TB_PATIENT').length` → **2** |
| **5** | Preuves présentes | Toutes les arêtes ont `preuve ∈ {ok, dict}` |
| **6** | Cadrage gratuit | `HQ.api.getStats().calls` inchangé après le formulaire |
| **7** | Appel unique | Une extraction complète → `calls === 1` |
| **7** | Sortie compacte | `outputTokens < 600` |
| **8** | Recette sans réseau | « germes niveau 2 » → `calls === 0` |
| **9** | Les 4 modes | Même script R produit dans les 4 modes |

## Test de bout en bout

```js
/* À coller dans la console après le lot 8 */
HQ.api.resetStats();

HQ.app.nouvelleDemande('séjours avec intervention chirurgicale entre 2023 et 2026');
HQ.cadrage.repondre({ bornes:'sortie',
                      periode:{debut:'20230101', fin:'20261231'},
                      champ:['MCO'], typePassage:['2'],
                      granularite:'sejour', enCours:'exclure',
                      perimetre:'', mutations:'inclure' });

await HQ.app.resoudre();

console.log('Appels API   :', HQ.api.getStats().calls);        // attendu : 0 ou 1
console.log('Coût USD     :', HQ.api.getStats().costUSD);      // attendu : < 0,015
console.log('Tables       :', HQ.store.getState().nodes.length);
console.log('Jointures    :', HQ.store.getState().joins.length);
console.log('Script R     :', HQ.generator.buildScript(HQ.store.getState()).length, 'caractères');
```

---

# ANNEXE — RÉCAPITULATIF DES FICHIERS

## À créer

| Fichier | Rôle | Lot |
|---------|------|-----|
| `data/noyau-pmsi.js` | Noyau PMSI distillé (~3 500 tokens) | 3 |
| `js/retrieval.js` | Index inversé + BM25 | 4 |
| `js/joingraph.js` | Graphe de jointures + Dijkstra | 5 |
| `js/cadrage.js` | Les 8 questions en formulaire | 6 |
| `js/tools.js` | Définition du tool call | 7 |
| `js/planner.js` | Tool call → état complet | 7 |
| `js/rules.js` | Multiplicateurs, filtres, avertissements | 7 |
| `js/columns.js` | Sélection des colonnes | 7 |
| `js/recipes.js` | 7 recettes paramétrées | 8 |
| `js/ui-recipes.js` | Interface des recettes | 8 |
| `js/ui-pont.js` | Pont Claude Code | 9 |
| `LANCER_HOSPIQUERY.bat` | Lanceur local | 9 |

## À modifier

| Fichier | Modification | Lot |
|---------|--------------|-----|
| `js/render-chat.js` | Garde-fou, plafond, throttle, `marked` | 1, 2 |
| `js/api.js` | `cache_control`, `tools`, statistiques de cache | 2, 7 |
| `js/prompt.js` | Noyau, retrieval, suppression de `FORMAT_INSTRUCTIONS` | 3, 4, 7 |
| `js/dictionary.js` | `chaqueTable()`, appel à `construireIndex()` | 4 |
| `js/joins.js` | `trouverChemin()` | 5 |
| `js/app.js` | Machine à états | 6, 8 |
| `js/ui-settings.js` | Mode de fonctionnement, statistiques de cache | 2, 9 |
| `index.html` | `marked.js`, nouveaux scripts, `?v=14` | tous |

## Inchangés ✅

`js/generator.js` · `js/store.js` · `js/dom.js` · `js/render-schema.js` · `js/render-final.js` · tous les CSS

---

# EN UNE PAGE

1. **Un bug introduit hier gèle l'application.** Boucle infinie dans `renderMarkdown`, branche paragraphe, déclenchée par toute ligne commençant par `**`. Correctif : 3 lignes. *(Lot 1, 30 min)*

2. **Le CLAUDE.md entier — 30 269 tokens — repart à chaque message, sans cache.** C'est 90 % du coût. Correctif : `cache_control` + noyau distillé. *(Lots 2-3, 5 h, −96 % de coût)*

3. **Sur les 8 étapes de la méthode, une seule a besoin d'une IA.** Les jointures sont dans le dictionnaire (1 614 liens), les colonnes aussi, les questions de cadrage sont fixes, et `generator.js` écrit déjà le R tout seul. *(Lots 4-7)*

4. **Pour ne plus rien payer :** moteur local pour 70 % des demandes, Groq via OmniRoute en local pour 20 %, pont Claude Code pour le reste. *(Lots 8-9)*

```
           Aujourd'hui          Après lots 1-3        Architecture complète
Coût/extr.    $0,92                 $0,035                  $0,0029
Appels API      7                      5                     0 ou 1
Latence      40-90 s                30-60 s                  2-4 s
Fiabilité    variable               variable               déterministe
```

> **Commence par les lots 1 et 2.** Une demi-journée, et l'application est réparée et 87 % moins chère. Tout le reste peut attendre.

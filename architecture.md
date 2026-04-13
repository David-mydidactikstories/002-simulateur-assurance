# SIMULATEUR VOCAL COFISECURE — MDS
## Architecture & État du projet (mis à jour avril 2026)

---

## 🎯 BUT DU PROJET
Simulateur vocal de vente gamifié pour former les commerciaux Cofidis Belgique à vendre la CofiSecure par téléphone. 10 clients IA progressifs, scoring en temps réel, débrief automatique.

---

## 🚀 DÉPLOIEMENT

**URL en ligne :** https://002-simulateur-assurance.onrender.com

**Repo GitHub :** https://github.com/David-mydidactikstories/002-simulateur-assurance

**Pour mettre à jour en ligne après une modification :**
```
git add -A && git commit -m "description du changement" && git push
```
Render redéploie automatiquement en 2-3 minutes après chaque push.

**Variables d'environnement sur Render (NE PAS mettre dans le code) :**
- `DEEPGRAM_API_KEY`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`

---

## 🏗️ ARCHITECTURE TECHNIQUE

**Frontend :** `public/index.html` — Interface complète, profils clients, jauge, débrief
**Audio Worklet :** `public/audio-processor.js` — Capture micro (AudioWorkletNode, linear16 PCM)
**Backend :** `server.js` — Node.js + Express + WebSocket (`ws`)

**IA Trio :**
- **STT** : Deepgram Nova-2 streaming (`wss://`) — `nova-2`, `fr`, `utterance_end_ms=2000`
- **LLM** : Gemini 2.5-flash-lite REST API — JSON mode, historique glissant
- **TTS** : ElevenLabs REST — `eleven_turbo_v2_5`, `mp3_22050_32`, speed 0.93

---

## 📁 FICHIERS CLÉS

```
Simulateur Vocal/
├── server.js              ← Backend principal (tout le cerveau)
├── package.json           ← start: "node server.js"
├── .gitignore             ← exclut .env et node_modules
├── .env                   ← clés API locales (JAMAIS pushé)
└── public/
    ├── index.html         ← Interface + 10 profils clients + logique frontend
    └── audio-processor.js ← AudioWorklet pour le micro
```

---

## ✅ FONCTIONNALITÉS COMPLÈTES

- [x] 10 profils clients progressifs (niveau 1 Julien Masse → niveau 10 Richard BOSS)
- [x] Scoring -2 à +2 par réplique, jauge 0-10, cap ±2 par tour
- [x] 4 états visuels : vert (écoute) / teal (parle) / orange (IA réfléchit) / bleu (client parle)
- [x] Débrief automatique avec coach IA après chaque appel
- [x] Correction transcription Deepgram (Cofidis, CofiSecure, centimes, montants)
- [x] Anti-doublon transcription (`dernierEnvoi`) et anti-doublon réponse client (`derniereReponseClient`)
- [x] Retry Gemini sur safety block (historique réduit + prompt simplifié)
- [x] Retry Gemini sur réponse dupliquée (temp 0.9 + phrase bannie)
- [x] Nombres en lettres pour ElevenLabs (`nombreEnLettres`, `preparerTexteVoix`)
- [x] Phonetic overrides pour les 6 montants CofiSecure (84.000€, 42.000€, etc.)
- [x] Signal `ia_thinking` envoyé au frontend avant interrogation Gemini
- [x] Upsell : client réagit positivement si David propose formule supérieure
- [x] Condition prix : le client demande le prix avant d'accepter si David ne l'a pas mentionné
- [x] Débrief upsell : félicite uniquement si David propose une mensualité > 10,90€ (pas juste 84.000€)
- [x] Raccrochage d'urgence (`raccroche_immediat`) indépendant de la jauge
- [x] Déployé sur Render (Frankfurt EU Central, Free tier)
- [x] Bouton "Fiche Produit" dans l'UI — visible avant l'appel, masqué au lancement (`btnFicheProduit.style.display='none'`)
- [x] Fiche Produit PDF (charte graphique Cofidis : rouge #e40041, bordeaux #68012e, jaune #fdc100, pastels) — servie depuis `public/Fiche_Produit_CofiSecure.pdf`
- [x] Modal Fiche Produit avec iframe PDF (`#navpanes=0&view=FitH`), header bordeaux, bouton téléchargement rouge
- [x] Fix audio iOS Safari : lecture ElevenLabs via `AudioContext.decodeAudioData` (contourne la restriction autoplay iOS sur `new Audio().play()`)
- [x] Filet de sécurité Belgian French dans `preparerTexteVoix` : si Gemini écrit "quatre-vingt-dix" ou "soixante-dix" malgré les instructions, conversion automatique → "nonante" / "septante" avant envoi à ElevenLabs
- [x] Élisions orales renforcées dans `SHORT_PROMPT_RULE` : liste explicite de transformations obligatoires (j'sais pas, t'as, y'a, vous m'voulez, j'comprends pas…) pour éviter le rendu robotisé : si Gemini écrit "quatre-vingt-dix" ou "soixante-dix" malgré les instructions, conversion automatique → "nonante" / "septante" avant envoi à ElevenLabs

---

## 🧠 LOGIQUE SERVEUR (server.js) — FONCTIONS CLÉS

| Fonction | Rôle |
|---|---|
| `corrigerTranscription(texte)` | Corrige les erreurs Deepgram (coffee→Cofidis, etc.) |
| `extraireJSON(texte)` | Parse le premier objet JSON valide dans la réponse Gemini |
| `nombreEnLettres(n)` | Convertit un nombre en mots français belges |
| `preparerTexteVoix(texte)` | Prépare le texte pour ElevenLabs (chiffres → mots) |
| `interrogerIA(texte)` | Appelle Gemini, gère retry safety + retry doublon |
| `declencherDebrief()` | Génère le débrief coach après fin de partie |

**Variables d'état par session WebSocket :**
- `historique[]` — historique de la conversation (glissant, 20 derniers messages)
- `jauge` — score 0-10 (victoire à 10, défaite à 0)
- `currentConfig` — profil client actif (envoyé par le frontend via message `config`)
- `dernierEnvoi` — dernière transcription envoyée à Gemini (anti-doublon)
- `derniereReponseClient` — dernière réponse client générée (anti-doublon)
- `isGameOver` / `isIAThinking` — états de jeu

---

## 💰 PRODUIT COFISECURE — TABLEAU DES FORMULES

| Mensualité | Capital | Rente/mois × 18 | Total standard | Total accident route (×2) |
|---|---|---|---|---|
| 10,90€ | 15.000€ | 1.500€ | 42.000€ | **84.000€** |
| 14,90€ | 20.000€ | 2.000€ | 56.000€ | 112.000€ |
| 17,90€ | 25.000€ | 2.500€ | 70.000€ | 140.000€ |
| 20,90€ | 30.000€ | 3.000€ | 84.000€ | 168.000€ |
| 24,90€ | 40.000€ | 4.000€ | 112.000€ | 224.000€ |
| 29,90€ | 50.000€ | 5.000€ | 140.000€ | 280.000€ |

⚠️ 84.000€ = formule 10,90€/mois doublée pour accident de route. Ce n'est PAS un upsell.

---

## 👥 10 PROFILS CLIENTS

| Niveau | Nom | Profil | Objection principale | Jauge départ | Voix EL |
|---|---|---|---|---|---|
| 1 | Julien Masse | Jeune salarié IT · Liège | "L'assurance c'est pour les vieux, pas pour moi" | 6 | 4sZ5JOztc9KMssP2KTxg |
| 2 | Mme. Renard | Mère de famille · Namur | Doublement accident voiture — capital vraiment doublé ? | 5 | PX78pFK18wppKjXLR0VX |
| 3 | M. Peeters | Plombier artisan · Charleroi | Mal de dos chronique — est-il couvert ? | 4 | sYABVw6gLH8EJSY1WOcx |
| 4 | Léa Fontaine | Freelance IT · Bruxelles | Horreur des engagements, comment résilier ? | 4 | gC9jy9VUxaXAswovchvQ |
| 5 | Luc Bodart | Cadre supérieur · Louvain | Famille recomposée — qui désigne les bénéficiaires ? | 4 | jN4TrAMAxJAuYzfhQotD |
| 6 | Nathalie Leclercq | Comptable · Mons | AVC et crises cardiaques sont-ils couverts ? | 3 | 8qqO0wh2fpa4hE9K15s0 |
| 7 | M. Lecomte | Retraité veuf · Bruges | "Je suis trop vieux pour souscrire" (62 ans) | 3 | tMLzqy9GdtCGWHR3mzHT |
| 8 | Sarah Bastin | Commerçante · Verviers | Méfiante, déjà arnaquée par un assureur | 2 | gXREIEvPOCZDQTLfXouF |
| 9 | Antoine Claes | Avocat · Bruxelles | Alcool au volant couvert ? (piège provocateur) | 2 | XKm1rpsDP34oBWwJsXb0 |
| 10 | Richard — BOSS | Directeur Achat · Anvers | Chiffres clés en 30 sec sinon il raccroche | 1 | aaxksyasKjsS6ULJLmd3 |

---

## 🔧 CORRECTIONS TRANSCRIPTION DEEPGRAM (corrigerTranscription)

- `coffee` / `coffeedis` / `confidis` → **Cofidis**
- `coffeecure` / `copie secure` / `kofisecure` → **CofiSecure**
- `coffee [chiffre]` / `coffee [chiffre] en ligne` → **Cofidis**
- `centiles` / `sentimes` / `santimes` → **centimes**
- `Julia` / `Jules` → **Julien**
- `Morel` / `Maesse` / `Mas` → **Masse**
- Montants en mots → chiffres normalisés (ex: "dix euros nonante" → "10,90 euros")

---

## ⚠️ PIÈGES CONNUS

1. **84.000€ ≠ upsell** — C'est la formule de base doublée pour accident de route
2. **Gemini safety block** — Retry automatique avec historique réduit (6 messages)
3. **Double UtteranceEnd** — Géré par `dernierEnvoi` (ne renvoie pas si même texte)
4. **`dizaines[8]`** — Doit être `'quatre-vingt'` SANS 's' pour ElevenLabs
5. **Free tier Render** — Le service s'endort après 15 min d'inactivité (cold start ~30 sec)

---

## 📈 MODÈLE B2B (MDS)

Voir `Modèle Économique MDS.docx` et `Plan Développement V2.docx` dans ce dossier.

- **Pilote** : 490€ (accès 30 jours, 1 utilisateur)
- **PME** : Setup + licence annuelle 1.500-2.000€ + recharges 1,50€/crédit
- **Grand Compte** : tarif par siège négocié

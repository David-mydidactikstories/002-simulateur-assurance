require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==========================================
// 1. DIAGNOSTIC DES CLÉS API
// ==========================================
const dgKey = process.env.DEEPGRAM_API_KEY?.trim();
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();

console.log(`=========================================`);
console.log(`🔍 MDS VOICE SERVER — ANTI CRASH & DEBRIEF NEUTRE`);
if (!dgKey) console.error("❌ DEEPGRAM_API_KEY manquante !");
if (!geminiKey) console.error("❌ GEMINI_API_KEY manquante !");
if (!elevenKey) console.error("❌ ELEVENLABS_API_KEY manquante !");
console.log(`=========================================`);

app.use(express.static('public'));

// ==========================================
// CORRECTION DES ERREURS DE TRANSCRIPTION
// ==========================================
function corrigerTranscription(texte) {
    const corrections = [
        // Noms propres
        [/que\s*finiss\w*/gi, 'Cofidis'],
        [/\bcoff(?:ee)?[\s-]?dis\b/gi, 'Cofidis'],
        [/\bcoff(?:ee)?[\s-]?\d+(?:\s+en\s+ligne)?\b/gi, 'Cofidis'],
        // CofiSecure — variantes phonétiques Deepgram (fr)
        [/\bcof[iy][\s-]?s[eéè][ck]?[uü]?r\w*/gi, 'CofiSecure'],
        [/\bcopie[\s-]?s[eéè][ck]?[uü]?r\w*/gi, 'CofiSecure'],
        [/\bcopy[\s-]?s[eéè][ck]?[uü]?r\w*/gi, 'CofiSecure'],
        [/\bcoff(?:ie?|ee?)[\s-]?s[eéè][ck]?[uü]?r\w*/gi, 'CofiSecure'],
        [/\bkof[iy][\s-]?s[eéè][ck]?[uü]?r\w*/gi, 'CofiSecure'],
        [/\bcofi[\s-]?s[eéè]?cur\w*/gi, 'CofiSecure'],
        [/\bco(?:fi|py|pie|ffee?)[\s-]?(?:sécur|secur|sécu|secu|cure)\w*/gi, 'CofiSecure'],
        [/\bcoffeecure\b/gi, 'CofiSecure'],
        [/\bcoff(?:ee|i|y)?[\s-]?(?:ce|se|s)\s*(?:en\s*ligne|online)?\b/gi, 'Cofidis'],
        [/confidis/gi, 'Cofidis'],
        [/\bcoffee\b/gi, 'Cofidis'],
        [/\bJulia\b|\bJules\b/gi, 'Julien'],
        [/\b(Morel|Maesse|Maes|Mas)\b/gi, 'Masse'],
        // Centimes (Deepgram transcrit souvent "centiles", "centile", "sentimes")
        [/centil[eè]?s?\b/gi, 'centimes'],
        [/sentimes?\b/gi, 'centimes'],
        [/santime[sz]?\b/gi, 'centimes'],
        // Chiffres courants pour le prix (10,90€)
        [/\bdix\s*(?:euros?\s*)?(?:et\s*)?nonante\s*centimes?\b/gi, '10,90 euros'],
        [/\bdix\s*(?:virgule|point|,)\s*(?:nonante|90)\b/gi, '10,90 euros'],
        [/\b10\s*(?:virgule|,)\s*90\b/gi, '10,90 euros'],
        // Montants produit connus — normalisation
        [/\bquarante[\s-]?deux[\s-]?mille\b/gi, '42.000'],
        [/\bcinquante[\s-]?six[\s-]?mille\b/gi, '56.000'],
        [/\bsoixante[\s-]?dix[\s-]?mille\b/gi, '70.000'],
        [/\bquatre[\s-]?vingt[\s-]?quatre[\s-]?mille\b/gi, '84.000'],
        [/\bcent[\s-]?douze[\s-]?mille\b/gi, '112.000'],
        [/\bcent[\s-]?quarante[\s-]?mille\b/gi, '140.000'],
        [/\bcent[\s-]?soixante[\s-]?huit[\s-]?mille\b/gi, '168.000'],
        [/\bdeux[\s-]?cent[\s-]?vingt[\s-]?quatre[\s-]?mille\b/gi, '224.000'],
        [/\bdeux[\s-]?cent[\s-]?quatre[\s-]?vingts?[\s-]?mille\b/gi, '280.000'],
        // "100" quand le contexte suggère "centimes"
        [/(\d+)\s*100\b/g, (_, n) => `${n} centimes`],
    ];

    let resultat = texte;
    for (const [pattern, replacement] of corrections) {
        resultat = resultat.replace(pattern, replacement);
    }
    return resultat;
}

// Extrait le premier objet JSON valide dans un texte (évite les doubles-JSON de Gemini)
function extraireJSON(texte) {
    const debut = texte.indexOf('{');
    if (debut === -1) throw new Error("Aucun JSON trouvé dans la réponse");
    let depth = 0;
    for (let i = debut; i < texte.length; i++) {
        if (texte[i] === '{') depth++;
        else if (texte[i] === '}') {
            depth--;
            if (depth === 0) return JSON.parse(texte.slice(debut, i + 1));
        }
    }
    throw new Error("JSON non fermé dans la réponse");
}

wss.on('connection', (ws) => {
    console.log('🟢 Nouveau stagiaire connecté.');
    
    let dgConnection = null;
    let isConnecting = false;
    let historique = []; 
    let jauge = 5; 
    let currentConfig = {};
    let isGameOver = false;
    let isIAThinking = false;
    let transcriptBuffer = "";
    let dernierEnvoi = "";
    let derniereReponseClient = "";

    // Helper sécurisé : envoie seulement si le WebSocket est encore ouvert
    const safeSend = (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    };

    const setupDeepgram = () => {
        if (!dgKey || isConnecting || (dgConnection && dgConnection.readyState === WebSocket.OPEN)) return;
        
        isConnecting = true;
        
        const sampleRate = parseInt(currentConfig.sampleRate) || 16000;
        const deepgramUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=fr&smart_format=true&interim_results=true&encoding=linear16&sample_rate=${sampleRate}&endpointing=false&utterance_end_ms=2000&vad_events=true&keepalive=true`;
        console.log(`🎙️ Deepgram URL : ${deepgramUrl}`);
        
        dgConnection = new WebSocket(deepgramUrl, { headers: { Authorization: `Token ${dgKey}` } });
        
        dgConnection.on('open', () => {
            console.log("✅ Deepgram prêt.");
            isConnecting = false;
            // Keepalive manuel : envoie un ping Deepgram toutes les 8s pour garder la connexion
            const keepaliveInterval = setInterval(() => {
                if (dgConnection && dgConnection.readyState === WebSocket.OPEN) {
                    dgConnection.send(JSON.stringify({ type: "KeepAlive" }));
                } else {
                    clearInterval(keepaliveInterval);
                }
            }, 8000);
        });

        dgConnection.on('message', async (data) => {
            try {
                const response = JSON.parse(data);
                const transcript = response.channel?.alternatives?.[0]?.transcript;

                if (transcript && !isGameOver) {
                    safeSend({ type: 'interim_text', value: transcript, isFinal: response.is_final });
                    if (response.is_final) transcriptBuffer += " " + transcript;
                }

                if (response.type === "UtteranceEnd" && !isGameOver && !isIAThinking) {
                    const brut = transcriptBuffer.trim();
                    const fullSentence = corrigerTranscription(brut);
                    if (brut !== fullSentence) console.log(`🔧 Correction : "${brut}" → "${fullSentence}"`);
                    if (fullSentence.length > 3 && fullSentence !== dernierEnvoi) {
                        console.log(`🗣️ MESSAGE REÇU : "${fullSentence}"`);
                        safeSend({ type: 'text', value: fullSentence });
                        transcriptBuffer = "";
                        dernierEnvoi = fullSentence;
                        await interrogerIA(fullSentence);
                        dernierEnvoi = ""; // reset après réponse IA — David peut répéter pour clarifier
                    } else if (fullSentence === dernierEnvoi) {
                        console.log(`⚠️ Doublon ignoré : "${fullSentence}"`);
                        transcriptBuffer = "";
                    }
                }
            } catch (e) { console.error("❌ Erreur Deepgram:", e.message); }
        });

        dgConnection.on('error', (err) => { console.error("❌ Deepgram ERREUR:", err.message); });
        dgConnection.on('close', (code, reason) => {
            isConnecting = false;
            dgConnection = null;
            console.log(`⚠️ Deepgram déconnecté. Code: ${code}, Raison: ${reason?.toString() || 'inconnue'}`);
        });
    };

    const interrogerIA = async (texteUtilisateur) => {
        if (!geminiKey) return;
        isIAThinking = true;
        safeSend({ type: 'ia_thinking' }); // Signal frontend : micro bloqué, IA en cours
        historique.push(`Commercial: "${texteUtilisateur}"`);

        const systemPrompt = `
Tu joues le rôle d'un client belge qui reçoit un appel téléphonique inattendu d'un commercial de Cofidis nommé David.

════════════════════════════════════════
PROFIL CLIENT : ${currentConfig.prompt}
Jauge actuelle : ${jauge}/10
════════════════════════════════════════

══ FICHE PRODUIT COFISECURE (LA VÉRITÉ ABSOLUE) ══
Tu connais ce produit parfaitement. Si David dit quelque chose de FAUX, tu le ressentiras (méfiance, doute) sans nécessairement le dire ouvertement — mais la jauge BAISSE.

CE QUE COFISECURE COUVRE (accidents uniquement) :
• Décès accidentel → capital + forfait mensuel (max 18 mois) versé aux bénéficiaires désignés
• Invalidité Totale et Permanente accidentelle (>66% selon barème belge) → capital + forfait mensuel à l'assuré
• Accident de la circulation (piéton, cycliste, conducteur/passager véhicule particulier) → prestations DOUBLÉES
• Assistance psychologique : 3x1h avec un psychologue (à demander dans les 30 jours)
• Aide-ménagère : 12h max si hospitalisé plus de 48h (sur 10 jours, à demander dans les 30 jours)
• Couverture à l'étranger (rapatriement inclus en cas de décès hors Belgique)

TABLEAU COMPLET DES FORMULES (capital versé en 5 jours + rente 18 mois) :
┌─────────────┬──────────┬─────────────┬───────────┬──────────────────────┐
│ Mensualité  │ Capital  │ Rente/mois  │ TOTAL     │ TOTAL si accident    │
│             │          │ × 18 mois   │ standard  │ de circulation (×2)  │
├─────────────┼──────────┼─────────────┼───────────┼──────────────────────┤
│ 10,90€/mois │ 15.000€  │ 1.500€×18   │ 42.000€   │ 84.000€              │
│ 14,90€/mois │ 20.000€  │ 2.000€×18   │ 56.000€   │ 112.000€             │
│ 17,90€/mois │ 25.000€  │ 2.500€×18   │ 70.000€   │ 140.000€             │
│ 20,90€/mois │ 30.000€  │ 3.000€×18   │ 84.000€   │ 168.000€             │
│ 24,90€/mois │ 40.000€  │ 4.000€×18   │ 112.000€  │ 224.000€             │
│ 29,90€/mois │ 50.000€  │ 5.000€×18   │ 140.000€  │ 280.000€             │
└─────────────┴──────────┴─────────────┴───────────┴──────────────────────┘

RÈGLES DE VALIDATION DES CHIFFRES (ABSOLUMENT CRITIQUE) :
• Tous les montants du tableau ci-dessus sont CORRECTS — ne JAMAIS les remettre en question.
• Si David mentionne deux chiffres dans la même explication, les deux sont corrects et cohérents. Tu ne dis JAMAIS "vous m'avez dit X tout à l'heure et maintenant Y". C'est interdit.
• CAS FRÉQUENT — 42.000 ET 84.000 dans le même appel : c'est NORMAL et COHÉRENT. 42.000 = formule de base standard. 84.000 = ce même montant DOUBLÉ pour un accident de circulation. Si David t'explique ça, tu réponds "ah d'accord, je comprends" et tu passes à autre chose. Tu n'exprimes AUCUNE confusion.
• 84.000€ N'EST PAS "la formule la plus chère". La formule la plus chère c'est 140.000€ (29,90€/mois). 84.000€ est soit la formule 20,90€/mois, soit la formule 10,90€/mois doublée pour accident de route. Les deux sont valides.
• Si David cite un chiffre absent du tableau (ex: 95.000€, 77.000€) → légère méfiance (-1) mais la conversation continue normalement.
• RÈGLE ABSOLUE : une fois que David a expliqué un chiffre et sa logique, ce sujet est CLOS. Tu n'y reviens plus.

ARGUMENTS COMMERCIAUX FORTS (David devrait les utiliser) :
• Pas d'examen médical requis — souscription simple et rapide
• Souscription possible en ligne ou par téléphone
• Protection immédiate dès la signature
• Résiliable à tout moment sans justification
• 14 jours pour changer d'avis sans frais après souscription
• Plusieurs formules disponibles : de 10,90€/mois (couverture de base) à 29,90€/mois (couverture maximale)

UPSELL — COMPORTEMENT CLIENT :
Si David te propose une formule plus élevée en expliquant ce que ça apporte de plus (capital plus grand, rente plus élevée), tu peux réagir positivement si l'argument tient la route. Une formule à 14,90€ ou 17,90€/mois reste accessible et si David argumente bien ("pour quelques euros de plus vous doublez votre protection"), tu peux être convaincu. Variation = +1 si David propose l'upsell intelligemment.

CONDITIONS :
• Âge : minimum 18 ans, maximum 69 ans pour souscrire
• L'assurance s'arrête automatiquement au 75e anniversaire
• Adhésion annuelle, renouvelée automatiquement
• Résiliable à tout moment par lettre recommandée (effet à l'échéance mensuelle suivante)
• Délai de renonciation : 14 jours après signature, sans frais
• Un seul contrat par personne
• Bénéficiaires désignés dans le certificat d'adhésion, modifiables à tout moment
• En cas de bénéficiaires multiples : partage par parts égales

EXCLUSIONS (ce qui N'EST PAS couvert — très important !) :
• ❌ Toutes les maladies et affections, même soudaines (grippe, cancer, etc.)
• ❌ AVC, infarctus, accidents vasculaires cérébraux, troubles cardiaques = EXCLUS
• ❌ Mal de dos, hernies, problèmes vertébraux, tendinites, fibromyalgies = EXCLUS
• ❌ Alcool au volant (taux supérieur au taux légal belge) et drogues hors prescription = EXCLUS
• ❌ Sports professionnels, sports aériens, sports motorisés, compétitions
• ❌ Suicide
• ❌ Accidents volontaires
• ❌ Maladies infectieuses, virales, parasitaires (même suite à une piqûre d'insecte)
• ❌ Transports en commun (bus, train, avion, bateau) pour le doublement = PAS couvert
• ❌ Actes esthétiques
• ❌ Catastrophes naturelles, guerre, terrorisme (si part active)
• ❌ Accident survenu AVANT l'adhésion

══ RÈGLES DE SCORING — PHILOSOPHIE DU JEU ══
CE SIMULATEUR EST UN JEU PROGRESSIF. Chaque niveau est atteignable si David connaît son produit et gère bien les objections. Tu es résistant selon ton niveau, MAIS tu es persuadable si David dit les bonnes choses. Tu n'es PAS un mur infranchissable.

RÈGLE D'OR : Les variations négatives viennent UNIQUEMENT des erreurs de David, jamais de ton simple caractère. Si David répond correctement, la jauge monte toujours — même si tu es de mauvaise humeur.

Variation entre -2 et +2 PAR RÉPLIQUE MAXIMUM — strictement respecté.

VARIATION = 0 :
• Simple présentation ("bonjour je suis David de Cofidis") → variation = 0, tu réponds "allô ?" ou "oui bonjour ?"
• Tu poses une question sans que David ait encore répondu
• David répète une information correcte qu'il a DÉJÀ donnée dans cette conversation → variation = 0 (pas de points en boucle sur la même info)

VARIATION = +1 :
• Bonne réponse claire et rassurante à une de tes questions (première fois que David donne cette info correcte)
• David gère bien une objection avec un argument solide et nouveau
• David cite un avantage produit pertinent pour toi (pas d'examen médical, résiliable, etc.) — uniquement si pas encore mentionné

VARIATION = +2 (réservé au trigger principal de ton profil) :
• David touche PRÉCISÉMENT ta peur ou préoccupation principale et y répond parfaitement — uniquement la première fois
• Ex : pour Mme Renard → explique correctement le doublement en accident de voiture
• Ex : pour Léa → explique clairement que c'est résiliable à tout moment sans engagement long

VARIATION = -1 :
• Réponse vague, hésitante, qui ne répond pas vraiment à la question
• David évite le sujet ou donne une réponse floue sur un point important

VARIATION = -2 (erreur grave uniquement) :
• David affirme qu'une garantie EXCLUE est couverte (mal de dos, AVC, alcool, maladies...)
• David invente des chiffres ou des garanties qui n'existent pas
• David est agressif, condescendant ou très peu professionnel

RÉCUPÉRATION POSSIBLE : David peut toujours remonter depuis un score bas s'il corrige ses erreurs et donne de bonnes réponses. La progression reste possible jusqu'à la fin — sauf si la jauge tombe à 0.

NIVEAUX DE RÉSISTANCE ET MARGE D'ERREUR :
• Niveaux 1-3 : Tu poses 1-2 questions, tu te laisses convaincre facilement. David a droit à 1-2 erreurs légères avant que ça pèse vraiment.
• Niveaux 4-6 : Tu as des objections précises, tu insistes un peu. Moins de tolérance pour les réponses floues.
• Niveaux 7-9 : Tu es méfiant, tu testes sur les exclusions et les détails. Une erreur grave fait vraiment mal.
• Niveau 10 : Chaque mot compte. Presque aucune marge d'erreur — mais si David est parfait, tu signes.

══ RÈGLES DE COMPORTEMENT ══
RÈGLE ANTI-BOUCLE (ABSOLUMENT CRITIQUE — PRIORITÉ MAXIMALE) :

⚠️ JAMAIS PLUS DE 2 FOIS LA MÊME QUESTION. Jamais. Quel que soit le contexte.
⚠️ JAMAIS DEUX FOIS LA MÊME RÉPONSE. Si tu as déjà dit une phrase dans cet appel, tu ne la répètes PAS mot pour mot. Si David t'apporte de nouvelles informations, tu réagis à ces nouvelles informations — pas à ce qu'il a dit deux répliques plus tôt.

1. CONFIRMATION REÇUE → SUJET IMMÉDIATEMENT FERMÉ :
   Si David dit "oui", "exactement", "c'est ça", "tout à fait", "bien sûr", "effectivement", "c'est bien ça", ou toute autre confirmation positive → tu ACCEPTES et tu passes à autre chose. Point. Tu ne répètes PAS la même question pour "vérifier encore". Tu ne dis pas "ah donc... c'est ça ?" une deuxième fois sur le même sujet. La confirmation de David vaut réponse définitive.

2. BONNE RÉPONSE DÉJÀ DONNÉE → SUJET FERMÉ :
   Si David a répondu correctement à un sujet, ce sujet est définitivement clos. Variation = 0 si David répète la même info.

3. MAUVAISE RÉPONSE → UNE SEULE RELANCE MAX :
   Si David a mal répondu, tu peux relancer UNE SEULE FOIS. Après ça, qu'il réponde bien ou mal, le sujet est clos.

4. CONTRÔLE OBLIGATOIRE AVANT CHAQUE RÉPLIQUE :
   Avant de générer ta réponse, relis l'historique. Si ta réponse contient une question que tu as déjà posée dans cet appel → CHANGE DE SUJET ou réagis autrement. Si David a déjà confirmé quelque chose et que ta réponse redemande la même chose → INTERDIT.

RÉSUMÉ : confirmation = fin du sujet. Même question 2 fois = interdit. Même question 3 fois = impossible.

RÈGLE PHRASE DE CLÔTURE / RELANCE COMMERCIALE (TRÈS IMPORTANT) :
Si David utilise une phrase d'invitation à décider — ex: "qu'en pensez-vous ?", "ça vous parle ?", "alors ?", "qu'est-ce que vous en dites ?", "c'est intéressant non ?", "vous voyez ?", "vous avez des questions ?", "vous en pensez quoi ?", "c'est bon pour vous ?" — c'est le signal que David a terminé son argumentaire et attend une réaction de ta part.
Dans ce cas, TU DOIS PROGRESSER VERS UNE DÉCISION :
• Si tes objections principales ont toutes été traitées ET que le prix a été mentionné → accepte ou montre que tu es convaincu.
• Si le prix n'a pas encore été mentionné → pose la question du prix. UNE SEULE FOIS. Puis, une fois le prix donné, progresse vers l'acceptation.
• Si tu as encore une vraie question légitime non encore posée → pose-la. UNE SEULE. Puis décide.
INTERDIT après une phrase de clôture : relancer sur une objection ou une question déjà traitée dans cette conversation. Tu ne peux pas ignorer le signal de décision de David et repartir en arrière.

RÈGLE DE RÉACTIVITÉ NATURELLE — IMPRÉVU & HUMAIN (TRÈS IMPORTANT) :
Tu es un vrai être humain au téléphone, pas un robot à objections. Tu réagis à CE QUE DIT VRAIMENT David à l'instant — pas à une version scriptée de ce qu'il "devrait" dire.

Cas concrets à gérer naturellement :
• David fait une blague ou une remarque légère → tu réagis à ça d'abord (sourire verbal, "ah ah, c'est vrai..."), PUIS tu poursuis la conv. Variation = 0.
• David te pose une question sur ta vie (ta voiture, tes voyages, ta situation perso) → tu réponds BRIÈVEMENT et naturellement, puis tu reviens au sujet. Variation = 0.
• David dit quelque chose de surprenant ou d'inattendu → tu peux exprimer la surprise ("ah bon ?", "ça c'est intéressant...", "j'savais pas ça"). Variation = 0 ou +1 si c'est pertinent pour toi.
• David s'excuse ou se corrige en cours de phrase → tu l'acceptes simplement ("ah d'accord, donc...") sans pénaliser. Variation = 0.
• David pose une QUESTION DIRECTE sur toi ou sur un sujet → tu RÉPONDS À CETTE QUESTION avant de faire quoi que ce soit d'autre. Ne l'ignore pas pour revenir à ton objection.
• David dit quelque chose de complètement hors sujet → tu réagis brièvement, tu ramènes la conv naturellement ("oui bon, mais revenons à ce que vous me disiez...").

RÈGLE D'OR DE LA RÉACTIVITÉ : RÉAGIS D'ABORD À CE QUI VIENT D'ÊTRE DIT. Ta prochaine objection peut attendre une réplique si nécessaire pour que la conversation reste humaine.

RÈGLE DE RESPIRATION DE LA CONVERSATION :
Tu n'enchaînes pas mécaniquement une objection après chaque réponse de David. Si David vient de bien répondre à une de tes préoccupations, tu peux d'abord ACCUSER RÉCEPTION naturellement ("ah d'accord, ça rassure...", "ok je comprends mieux...") avant d'éventuellement passer à un autre point. Une conversation téléphonique réelle a des temps de respiration — des moments où tu digères une info avant de réagir. Ne saute pas immédiatement sur ta prochaine objection si ce n'est pas naturel dans le contexte.
Si David a traité 2-3 points consécutivement de manière convaincante, une réaction de type "okay, ça commence à me parler..." avec variation +1 est plus réaliste qu'une nouvelle objection surgissant de nulle part.

RÈGLE SUR LES EXCLUSIONS (TRÈS IMPORTANT) : Si David t'explique correctement qu'une garantie N'EST PAS couverte (maladies, AVC, mal de dos, alcool...), c'est une bonne réponse honnête. Tu ne le pénalises PAS pour ça. Variation = 0 ou +1 selon la clarté et le tact. Tu pénalises uniquement si David INVENTE une couverture qui n'existe pas.

RÈGLE DE PERTINENCE : Reste centré sur TON objection principale selon ton profil. Si ton profil dit que tu t'inquiètes du prix, tu poses des questions sur le prix — pas sur les maladies ou les exclusions qui ne te concernent pas directement. Tu peux avoir 1-2 questions secondaires mais reviens toujours à TA vraie préoccupation.

CALCULS ET CHIFFRES : Si David te donne un montant en euros et centimes (ex: "10 euros 90", "dix euros nonante", "10,90€", "environ 11 euros"), tu comprends qu'il répond à une question sur le prix. Tu acceptes les approximations raisonnables.

AMNÉSIE TOTALE : Tu décroches et tu ne sais pas pourquoi on t'appelle. Tu dis juste "allô ?" ou "oui bonjour". Tu attends que David se présente et explique. Tu NE MENTIONNES JAMAIS l'assurance en premier.

FIN D'APPEL :
• Si jauge atteint 10 → tu dis à David, à ta façon selon ton caractère, que tu es convaincu et prêt à prendre l'assurance. C'est ta DERNIÈRE phrase.
• Si jauge atteint 0 → tu raccroches en disant EXPLICITEMENT pourquoi (ex: "Vous ne connaissez pas votre produit", "Vous me racontez n'importe quoi", "Je ne suis pas intéressé, au revoir"). C'est ta DERNIÈRE phrase.

CONDITION PRIX OBLIGATOIRE AVANT D'ACCEPTER :
Avant de dire "oui" ou d'accepter l'assurance (même si la jauge est à 10), tu dois avoir entendu le prix mensuel de la part de David. Si David n'a JAMAIS mentionné un prix (ex: "10,90€/mois", "moins de 11 euros", "36 centimes par jour"), tu lui poses la question AVANT d'accepter : "Et ça coûte combien par mois exactement ?" — puis tu attends sa réponse. Un client réel ne signe jamais sans connaître le prix.

LANGUE — FRANÇAIS DE BELGIQUE :
• Toujours "septante", "nonante", "quatre-vingts"
• Expressions naturelles : "ça fait", "dites donc", "vous savez bien"
• Court : 1-2 phrases max par réplique

BUGS MICRO (sois indulgent) :
• "Julia/Jules" → Julien | "Morel/Mas/Maesse" → Masse
• "Que finisse/Coffee/Confidis" → Cofidis | "Copie Secure/Copie Sécure/Coffee Secure" → CofiSecure
• "40 100" → "40 cents" (0,40€) — NE PAS pénaliser
• NE JAMAIS corriger ou reprendre David sur la prononciation d'un mot. Si tu comprends l'intention, tu réponds normalement sans signaler l'erreur.

RACCROCHAGE D'URGENCE (indépendant de la jauge) :
Si David fait l'une de ces choses — peu importe le score actuel — tu raccroches IMMÉDIATEMENT :
• Il t'insulte ou te manque de respect (grossièreté, mépris, ton agressif)
• Il te tutoie de manière inappropriée alors que tu le vouvoyais
• Il se moque de toi ou de ta situation
• Il dit clairement qu'il s'en fiche ou qu'il fait ça par obligation
• Il dit n'importe quoi de façon délibérée (troll évident)
• Il devient vulgaire ou fait des blagues déplacées
Dans ce cas : "raccroche_immediat": true dans ta réponse JSON, et ta phrase est une réaction directe au comportement (pas au produit).

RÉPONDS UNIQUEMENT EN JSON : {"reponse": "phrase orale courte", "variation": entier entre -2 et +2, "raison": "explication courte", "raccroche_immediat": false}
        `;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Historique :\n${historique.slice(-20).join('\n')}\n\n-> Réponse JSON ?` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await res.json();

            // Log Gemini brut pour diagnostic si réponse vide
            if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]) {
                const raison = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || "inconnue";
                console.error(`❌ Gemini bloqué — raison : ${raison}`, JSON.stringify(data).slice(0, 300));
                // Retry avec une formulation plus neutre si bloqué par safety
                if (raison === 'SAFETY' || raison === 'inconnue') {
                    console.log(`🔄 Retry Gemini avec historique réduit...`);
                    const resRetry = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: `Historique récent :\n${historique.slice(-6).join('\n')}\n\nRéponds en JSON : {"reponse": "...", "variation": 0, "raison": "retry", "raccroche_immediat": false}` }] }],
                            systemInstruction: { parts: [{ text: `Tu es ${currentConfig.nom}, un client belge qui reçoit un appel de vente. Réponds naturellement en 1-2 phrases courtes. INTERDIT : ne génère PAS cette phrase ni rien de similaire : "${derniereReponseClient}". Réagis à la DERNIÈRE chose dite par le commercial, avance dans la conversation.` }] },
                            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
                            safetySettings: [
                                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                            ]
                        })
                    });
                    const dataRetry = await resRetry.json();
                    if (dataRetry.candidates?.[0]?.content?.parts?.[0]) {
                        const rawRetry = dataRetry.candidates[0].content.parts[0].text;
                        const resultRetry = extraireJSON(rawRetry);
                        console.log(`✅ Retry réussi : "${resultRetry.reponse}"`);
                        const varRetry = Math.max(-2, Math.min(2, resultRetry.variation || 0));
                        jauge = Math.max(0, Math.min(10, jauge + varRetry));
                        derniereReponseClient = resultRetry.reponse;
                        historique.push(`Client: "${resultRetry.reponse}"`);
                        safeSend({ type: 'ai_response', value: resultRetry.reponse, variation: varRetry, newScore: jauge, reason: "retry" });
                        await genererVoix(resultRetry.reponse);
                        return;
                    }
                }
                throw new Error(`Gemini bloqué (${raison})`);
            }

            const rawText = data.candidates[0].content.parts[0].text;
            const result = extraireJSON(rawText);
            
            const variation = Math.max(-2, Math.min(2, result.variation));
            jauge = Math.max(0, Math.min(10, jauge + variation));

            // Raccrochage d'urgence : comportement inacceptable, peu importe la jauge
            if (result.raccroche_immediat === true) {
                console.log(`🚨 Raccrochage d'urgence ! Jauge était à ${jauge * 10}%`);
                jauge = 0;
                isGameOver = true;
                historique.push(`Client: "${result.reponse}"`);
                safeSend({ type: 'ai_response', value: result.reponse, variation: -10, newScore: 0, reason: "Comportement inacceptable" });
                await genererVoix(result.reponse);
                setTimeout(() => declencherDebrief(), 4500);
                return;
            }

            // Si la jauge atteint 0 ou 10, on génère une phrase finale adaptée
            if (jauge <= 0 || jauge >= 10) {
                isGameOver = true;
                const win = jauge >= 10;

                const phraseFinalePrompt = win
                    ? `Tu es le client "${currentConfig.nom}" (profil: ${currentConfig.prompt}).
                       Le commercial David vient de te convaincre complètement après cet échange.
                       Génère ta phrase finale EN RESTANT DANS TON PERSONNAGE.
                       Selon ton caractère : Julien sera soulagé et sympa, Richard sera froid et expéditif, Sarah sera surprise, Antoine sera condescendant mais reconnaissant, etc.
                       RÈGLES STRICTES :
                       - MAXIMUM 1 PHRASE COURTE. Pas plus.
                       - Ne répète JAMAIS le prénom "David" plus d'une fois dans la phrase.
                       - Ne dis pas "merci" plusieurs fois. Une seule fois suffit.
                       - Exemple de bonne phrase : "Bon, d'accord, envoyez-moi ça." ou "Eh bien, c'est ce qu'il me faut, je souscris."
                       Parle en français de Belgique (septante, nonante).
                       RÉPONDS EN JSON : {"reponse": "ta phrase finale"}`
                    : `Tu es le client "${currentConfig.nom}" (profil: ${currentConfig.prompt}).
                       Analyse l'historique de cet appel et identifie LA VRAIE RAISON pour laquelle tu raccroches.

                       ANALYSE L'HISTORIQUE et choisis UNE seule raison parmi :
                       A) ATTITUDE : David a été irrespectueux, cynique, condescendant, agressif ou a insulté → tu raccroches à cause de son comportement, pas du produit. Ex: "Votre façon de me parler n'est pas acceptable. Au revoir."
                       B) MENSONGE/ERREUR PRODUIT : David a affirmé qu'une exclusion était couverte (AVC, dos, alcool...) ou a inventé des garanties → tu n'as plus confiance. Ex: "Je ne crois pas ce que vous me dites sur votre produit. Au revoir."
                       C) INCOMPÉTENCE : David était vague, hésitant, ne savait pas répondre → tu n'as pas confiance. Ex: "Vous ne semblez pas connaître votre produit. Je ne suis pas intéressé."
                       D) PAS CONVAINCU / PAS LE BON MOMENT : David n'a pas su répondre à tes préoccupations principales → tu n'es simplement pas convaincu. Ex: "Ça ne m'intéresse pas. Merci quand même."
                       E) IMPOLITESSE/PRESSION : David a été trop insistant ou t'a mis mal à l'aise → tu coupes court. Ex: "Ne me rappelez plus. Au revoir."

                       Reste dans ton personnage (Julien sera poli mais ferme, Sarah sera plus agressive, Richard sera glacial, Antoine sera hautain...).
                       1 phrase max + Au revoir. Parle en français de Belgique (septante, nonante).
                       RÉPONDS EN JSON : {"reponse": "ta phrase finale", "raison_choisie": "A/B/C/D/E"}`;

                try {
                    const resFinale = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: `Historique de l'appel:\n${historique.slice(-10).join('\n')}\n\n${phraseFinalePrompt}` }] }],
                            generationConfig: { responseMimeType: "application/json", temperature: 0.5 }
                        })
                    });
                    const dataFinale = await resFinale.json();
                    const texteFinale = dataFinale.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (texteFinale) {
                        const jsonFinale = extraireJSON(texteFinale);
                        const phraseFinale = jsonFinale.reponse || result.reponse;
                        if (jsonFinale.raison_choisie) console.log(`🎯 Raison du raccrochage : ${jsonFinale.raison_choisie}`);
                        historique.push(`Client: "${phraseFinale}"`);
                        safeSend({ type: 'ai_response', value: phraseFinale, variation: variation, newScore: jauge, reason: result.raison });
                        await genererVoix(phraseFinale);
                    }
                } catch (e) {
                    // Fallback si la phrase finale échoue
                    const fallback = win ? "Vous m'avez convaincu, je vais souscrire. Merci." : "Je ne suis pas intéressé. Au revoir.";
                    historique.push(`Client: "${fallback}"`);
                    safeSend({ type: 'ai_response', value: fallback, variation: variation, newScore: jauge, reason: result.raison });
                    await genererVoix(fallback);
                }

                setTimeout(() => declencherDebrief(), 4500);
            } else {
                let reponseFinale = result.reponse;

                // Garde-fou : si le client répète mot pour mot sa dernière réponse, on régénère AVANT d'envoyer
                if (reponseFinale.trim() === derniereReponseClient.trim()) {
                    console.log(`🔁 Doublon client détecté — régénération forcée...`);
                    try {
                        const resRetry = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: `Historique :\n${historique.slice(-10).join('\n')}\n\nATTENTION ABSOLUE : Tu viens de répéter exactement cette phrase : "${reponseFinale}". C'est interdit. Génère une réaction COURTE et DIFFÉRENTE à la DERNIÈRE chose dite par le commercial. Ne mentionne pas les mêmes chiffres ni les mêmes mots. Avance dans la conversation.` }] }],
                                systemInstruction: { parts: [{ text: `Tu es le client ${currentConfig.nom}. PHRASE BANNIE — ne génère rien de similaire à : "${reponseFinale}". Réagis autrement, avec une question ou un commentaire différent.` }] },
                                generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
                            })
                        });
                        const dataRetry = await resRetry.json();
                        const texteRetry = dataRetry.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (texteRetry) {
                            const retry = extraireJSON(texteRetry);
                            if (retry.reponse && retry.reponse.trim() !== derniereReponseClient.trim()) {
                                reponseFinale = retry.reponse;
                                console.log(`✅ Nouvelle réponse générée : "${reponseFinale}"`);
                            }
                        }
                    } catch(e) { console.error("❌ Erreur régénération doublon:", e.message); }
                }

                derniereReponseClient = reponseFinale;
                historique.push(`Client: "${reponseFinale}"`);
                safeSend({ type: 'ai_response', value: reponseFinale, variation: variation, newScore: jauge, reason: result.raison });
                await genererVoix(reponseFinale);
            }

        } catch (e) { 
            console.error("❌ Erreur IA :", e.message);
            const secours = "Désolé, j'ai eu une coupure, vous disiez ?";
            safeSend({ type: 'ai_response', value: secours, variation: 0, newScore: jauge });
            await genererVoix(secours);
        } finally {
            isIAThinking = false;
        }
    };

    const declencherDebrief = async () => {
        const win = jauge >= 10;
        
        const promptDebrief = `Tu es le coach. Fais le débrief de cet appel de vente. Tutoie David. Parle en français de Belgique (septante, nonante).

        🚨 RÈGLE 1 — PRÉSENTATION : Ne pénalise JAMAIS David s'il se présente en disant "Je suis David de Cofidis". C'est une bonne pratique de vente.

        🚨 RÈGLE 2 — ERREURS DE TRANSCRIPTION MICRO (CRITIQUE) : Le transcript vient d'une reconnaissance vocale imparfaite. Ces erreurs sont des artéfacts techniques, PAS des erreurs de David :
        - "Coffee secure", "copie secure", "copie sécure", "kofisecure" → c'est "CofiSecure" (le produit) mal retranscrit
        - "Coffeece en ligne", "Coffeece", "Confidis", "Coffee Dis", "que finisse" → c'est "Cofidis" (la société) mal retranscrit
        - "40 100", "10 100", "nonante 100" → c'est des centimes (40 cents, 10 cents) mal retranscrit
        - Des noms propres belges mal orthographiés (Masse, Renard, Léa...) → erreur micro
        Si tu vois un de ces artéfacts dans le transcript, IGNORE-LES complètement. Ne pénalise JAMAIS David pour une erreur de transcription.

        🚨 RÈGLE 3 — HÉSITATIONS ET CORRECTIONS : Si David hésite, fait une pause, puis revient avec la BONNE réponse, juge-le sur sa réponse finale, pas sur l'hésitation. Une correction en cours d'appel est une bonne chose, pas une erreur.

        🚨 RÈGLE 4 — BASE-TOI UNIQUEMENT SUR CE QUI EST DIT EXPLICITEMENT : Ne tire pas de conclusions sur ce que David "aurait sous-entendu" ou "aurait laissé croire". S'il n'a pas dit quelque chose explicitement, ne l'en blame pas. Le bénéfice du doute va toujours à David.

        🚨 RÈGLE 5 — COHÉRENCE : Si le client a accepté de souscrire (fin positive), David a globalement bien fait son travail. Ton feedback doit être encourageant et cibler des points d'amélioration réels et précis, pas des suppositions.

        🚨 RÈGLE 6 — UPSELL (IMPORTANT) : CofiSecure existe en 6 formules allant de 10,90€/mois (42.000€ standard, 84.000€ en accident de route) à 29,90€/mois (140.000€ standard, 280.000€ en accident de route). Un bon commercial ne se contente pas de la formule de base — il évalue si le client pourrait être intéressé par une formule supérieure et le propose.

        ⚠️ DISTINCTION CRITIQUE — CE N'EST PAS UN UPSELL :
        - Mentionner 84.000€ = ce n'est PAS un upsell. C'est simplement la formule de base (10,90€/mois) doublée pour un accident de la route. Si David parle de 84.000€ sans proposer une mensualité plus élevée, il vend toujours la formule d'entrée de gamme.
        - Un VRAI upsell = David propose EXPLICITEMENT une formule à 14,90€/mois ou plus (ex: "pour 4 euros de plus par mois, vous passez à 56.000€", "je vous conseille la formule à 17,90€/mois"). Ce n'est un upsell QUE si David mentionne une mensualité supérieure à 10,90€.

        - Si David a proposé une formule à mensualité plus élevée (14,90€ ou plus) ET que le client a accepté → FÉLICITE chaleureusement David dans "point_fort". C'est un excellent réflexe commercial.
        - Si David a proposé une formule plus élevée mais le client a refusé → Mentionne quand même positivement que David a eu le bon réflexe.
        - Si David n'a parlé que de la formule à 10,90€ (même en mentionnant 84.000€) sans jamais proposer une formule supérieure → Mentionne-le dans "a_corriger" comme une opportunité manquée.
        - Si la conversation n'a pas eu le temps d'aborder les formules (appel court ou client difficile) → ne pénalise pas David pour ça.

        RÉPONDS EN JSON : {"diagnostic": "...", "point_fort": "...", "a_corriger": "..."}

        Transcript de l'appel :\n${historique.join('\n')}`;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: promptDebrief }] }], generationConfig: { responseMimeType: "application/json" } }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            const data = await res.json();

            if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]) throw new Error("Debrief IA vide");
            
            const rawText = data.candidates[0].content.parts[0].text;
            const debrief = extraireJSON(rawText);
            safeSend({ type: 'game_over', win: win, debrief: debrief });
        } catch (e) {
            console.error("❌ Erreur Debrief:", e.message);
            // Sécurité : Si Gemini plante sur le débrief, on envoie un fallback pour que l'interface ne reste pas vide.
            safeSend({ 
                type: 'game_over', 
                win: win, 
                debrief: {
                    diagnostic: "L'analyse IA a été interrompue par le réseau.",
                    point_fort: "Vous avez mené l'appel jusqu'au bout.",
                    a_corriger: "Impossible d'analyser les pistes d'amélioration (Erreur Serveur)."
                }
            });
        }
    };

    // Convertit les nombres en lettres pour ElevenLabs (français belge)
    const nombreEnLettres = (n) => {
        if (n === 0) return 'zéro';
        const unites = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
                        'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
        const dizaines = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'septante', 'quatre-vingt', 'nonante'];
        const conv = (nb) => {
            if (nb < 20) return unites[nb];
            if (nb < 100) {
                const d = Math.floor(nb / 10), u = nb % 10;
                if (d === 8 && u === 0) return 'quatre-vingts';
                return dizaines[d] + (u ? '-' + unites[u] : '');
            }
            if (nb < 1000) {
                const c = Math.floor(nb / 100), r = nb % 100;
                return (c === 1 ? 'cent' : unites[c] + ' cent') + (r ? ' ' + conv(r) : (c > 1 ? 's' : ''));
            }
            if (nb < 1000000) {
                const m = Math.floor(nb / 1000), r = nb % 1000;
                return (m === 1 ? 'mille' : conv(m) + ' mille') + (r ? ' ' + conv(r) : '');
            }
            return nb.toString();
        };
        return conv(Math.round(n));
    };

    const preparerTexteVoix = (texte) => {
        return texte
            // Prononciation des noms de marque pour ElevenLabs
            .replace(/\bCofidis\b/gi, 'Cofi-diss')
            .replace(/\bCofiSecure\b/gi, 'Cofi-Sécure')
            // ── Filet de sécurité Belgian French ──────────────────────────────
            // Gemini écrit parfois en français standard malgré les instructions.
            // On corrige AVANT l'envoi à ElevenLabs pour garantir la prononciation belge.
            .replace(/\bquatre[\s-]vingt[\s-]dix[\s-](neuf|huit|sept|six|cinq|quatre|trois|deux|un)\b/gi, (m, u) => {
                const map = { neuf:'nonante-neuf', huit:'nonante-huit', sept:'nonante-sept',
                              six:'nonante-six', cinq:'nonante-cinq', quatre:'nonante-quatre',
                              trois:'nonante-trois', deux:'nonante-deux', un:'nonante et un' };
                return map[u.toLowerCase()] || m;
            })
            .replace(/\bquatre[\s-]vingt[\s-]dix\b/gi, 'nonante')
            .replace(/\bquatre[\s-]vingt[\s-]onze\b/gi, 'nonante et un')
            .replace(/\bsoixante[\s-]et[\s-]onze\b/gi, 'septante et un')
            .replace(/\bsoixante[\s-]dix[\s-](neuf|huit|sept|six|cinq|quatre|trois|deux)\b/gi, (m, u) => {
                const map = { neuf:'septante-neuf', huit:'septante-huit', sept:'septante-sept',
                              six:'septante-six', cinq:'septante-cinq', quatre:'septante-quatre',
                              trois:'septante-trois', deux:'septante-deux' };
                return map[u.toLowerCase()] || m;
            })
            .replace(/\bsoixante[\s-]dix\b/gi, 'septante')
            // Override explicite 10,90 sans symbole (Gemini peut écrire le chiffre seul)
            .replace(/\b10[,.]90\b(?!\s*(?:€|euros?))/gi, 'dix euros et nonante centimes')
            // ──────────────────────────────────────────────────────────────────
            // Overrides phonétiques pour les montants du produit — ElevenLabs les prononce plus naturellement en chiffres
            .replace(/84[\s.]?000\s*(?:€|euros?)?/gi, 'quatre-vingt-quatre mille euros')
            .replace(/42[\s.]?000\s*(?:€|euros?)?/gi, 'quarante-deux mille euros')
            .replace(/56[\s.]?000\s*(?:€|euros?)?/gi, 'cinquante-six mille euros')
            .replace(/70[\s.]?000\s*(?:€|euros?)?/gi, 'septante mille euros')
            .replace(/112[\s.]?000\s*(?:€|euros?)?/gi, 'cent douze mille euros')
            .replace(/140[\s.]?000\s*(?:€|euros?)?/gi, 'cent quarante mille euros')
            .replace(/168[\s.]?000\s*(?:€|euros?)?/gi, 'cent soixante-huit mille euros')   // 168 = 100+68, pas de belgicisme ici
            .replace(/224[\s.]?000\s*(?:€|euros?)?/gi, 'deux cent vingt-quatre mille euros')
            .replace(/280[\s.]?000\s*(?:€|euros?)?/gi, 'deux cent quatre-vingt mille euros')
            // Montants avec point de milliers : 42.000€ → quarante-deux mille euros
            .replace(/(\d+)\.(\d{3})\s*(?:€|euros?)/gi, (match, ent, cents) => {
                const nombre = parseInt(ent + cents);
                return isNaN(nombre) ? match : nombreEnLettres(nombre) + ' euros';
            })
            // Montants décimaux : 10,90€ → dix euros et nonante centimes
            .replace(/(\d+)[,.](\d+)\s*(?:€|euros?)/gi, (match, ent, dec) => {
                return nombreEnLettres(parseInt(ent)) + ' euros et ' + nombreEnLettres(parseInt(dec)) + ' centimes';
            })
            // Montants entiers : 50000€ → cinquante mille euros
            .replace(/(\d+)\s*(?:€|euros?)/gi, (match, nb) => {
                return nombreEnLettres(parseInt(nb)) + ' euros';
            })
            // Grands nombres isolés
            .replace(/\b(\d{4,})\b/g, (match, nb) => {
                const nombre = parseInt(nb);
                return isNaN(nombre) ? match : nombreEnLettres(nombre);
            });
    };

    const genererVoix = async (texte) => {
        if (!elevenKey || !currentConfig.voiceId) return;
        try {
            const texteVoix = preparerTexteVoix(texte);
            console.log(`🔊 TTS : "${texteVoix}"`);
            const url = `https://api.elevenlabs.io/v1/text-to-speech/${currentConfig.voiceId}?output_format=mp3_22050_32&optimize_streaming_latency=4`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: texteVoix, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.93 } })
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`ElevenLabs ${response.status}: ${errText}`);
            }
            const buffer = await response.arrayBuffer();
            safeSend({ type: 'audio', value: Buffer.from(buffer).toString('base64') });
        } catch (e) { console.error("❌ Erreur ElevenLabs:", e.message); }
    };

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'config') {
                currentConfig = data;
                jauge = data.jauge || 5;
                isGameOver = false;
                isIAThinking = false;
                transcriptBuffer = "";
                dernierEnvoi = "";
                derniereReponseClient = "";
                historique = [];
                setupDeepgram();
            }
        } catch (e) {
            if (dgConnection?.readyState === WebSocket.OPEN && !isGameOver) {
                dgConnection.send(msg);
            } else if (!isConnecting && (!dgConnection || dgConnection.readyState === WebSocket.CLOSED)) {
                setupDeepgram();
            }
        }
    });

    ws.on('close', () => { if (dgConnection) dgConnection.close(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur MDS — Prêt sur le port ${PORT}`));
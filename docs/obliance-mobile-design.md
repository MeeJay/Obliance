# Obliance pour Android — document de conception final

| | |
|---|---|
| Statut | Conception finale v1.1 (révision « multi-serveurs »), à valider par le propriétaire du produit |
| Date | 25 septembre 2026 |
| Révision v1.1 | Plusieurs instances Obliance dans une seule app : profils de serveur, bascule rapide « Serveur › Tenant », notifications et « À traiter » de tous les serveurs en permanence (§2.10) |
| Périmètre | Application Android **native** (Kotlin, Jetpack Compose, Material 3) pour Obliance, sur un socle réutilisable par les autres apps Obli |
| Sources | Trois propositions (« astreinte », « flotte », « tablette »), trois jurys (terrain, faisabilité, marque), catalogue d'API relevé dans `server/src`, `shared/src/types.ts` et le client web |
| Remplace | L'adaptation responsive du web dans la WebView, écartée par le propriétaire |

> Les noms techniques (endpoints, événements, modules, composants) restent en anglais. Tous les textes d'interface cités sont en français, au vouvoiement, avec une traduction anglaise dans les ressources (`values/` EN, `values-fr/` FR).

---

## 0. Synthèse

### 0.1 En une page

Obliance pour Android est un **poste d'astreinte de poche** qui devient un **établi** sur tablette.

- **Sur téléphone**, l'application s'ouvre sur « À traiter » : ce qui demande une personne, trié par urgence. Un technicien passe d'une notification à une décision en une dizaine de secondes, et corrige d'une main : ouvrir l'appareil, redémarrer un service, terminer un processus, lancer un script, ouvrir un shell.
- **Sur tablette**, la même application affiche plusieurs volets (liste, détail, panneau secondaire), gère clavier et souris, et garde les sessions distantes (shells, ObliReach) ouvertes dans un dock.
- **La configuration** (éditeurs de scripts, de planifications et de scénarios, politiques, utilisateurs) reste dans le web, ouvert dans une vue web intégrée clairement signalée, qui partage la session.
- **Plusieurs serveurs, une seule app.** Un technicien qui travaille sur plusieurs instances Obliance (Karim : BinaryHearts, Atelier et Client Durand) les ajoute toutes dans l'app, sans clone. Les notifications et « À traiter » couvrent **tous** les serveurs en permanence ; un appui sur la puce de périmètre passe d'un serveur à l'autre en moins d'une seconde, comme on change de tenant. Chaque serveur a sa couleur et son monogramme, visibles partout où l'on agit.
- **Le socle** (authentification et registre des serveurs, réseau, temps réel, design system, coquille de navigation, garde-fous d'action, notifications, mise à jour, vue web, tunnel, terminal) ne contient aucun type Obliance. Obliview et les autres apps Obli pourront démarrer dessus, multi-serveurs compris.

Charpente retenue : la proposition **« astreinte »**, première pour les trois jurys (8,6 terrain · 8,0 faisabilité · 8,5 marque). Greffes principales :
- de la proposition **« tablette »** : sessions comme objets de premier rang (pastille, dock), palette de commandes, clavier et souris, thème de terminal, panneau appareil intégré aux alertes sur tablette ;
- de la proposition **« flotte »** : modèle de périmètre qui sépare *filtrer* et *basculer*, aperçu de l'impact avant une action groupée, anneaux d'expiration et de progression, microtypographie française, choix de chaîne d'outils prudents.

| Livraison | Thème | Contenu en une ligne | Effort (2 dév. Android) |
|---|---|---|---|
| Phase 0 | Fondations | Découpage en modules, design system, réseau, authentification, temps réel, preuves techniques (terminal, Socket.IO, navigation adaptative, sérialisation) | 3 semaines · 6 ps |
| **v1** | « Astreinte » | À traiter, appareils (liste, détail, services, processus, tâches, inventaire, BitLocker), feuille « Agir » avec tous les garde-fous, scripts sur un ou plusieurs appareils, terminal natif avec sessions persistantes, Flotte, notifications actionnables (sondage), mode astreinte, ObliReach par la visionneuse web, **multi-serveurs** (jusqu'à 8 serveurs, À traiter et notifications agrégés, bascule rapide) | ≈ 34 ps · ≈ 17 semaines |
| v1.1 | « Temps réel » | Push UnifiedPush, ObliReach natif, mises à jour, Hyper-V et Veeam, scénarios, supervision, maintenance immédiate, widgets, cache hors ligne des détails | ≈ 22 ps · ≈ 11 semaines |
| v2 | « Parité » | Parité ObliReach, fichiers, Rewind, chat, terminaux scindés, validation biométrique liée à l'appareil, thème clair, seconde app Obli sur le socle | ≈ 25 ps · ≈ 12 semaines |

ps = personne-semaine. Les travaux serveur avancent en parallèle (§10.12).

### 0.2 Arbitrages explicites entre les propositions

| Sujet | Décision | Écarté | Pourquoi |
|---|---|---|---|
| Écran de démarrage | **À traiter** (boîte de tri : Alertes · Approbations · Enrôlements) | Tableau de bord Flotte (« flotte »), Accueil KPI (« tablette ») | À 3 h du matin, le premier écran doit montrer ce qui demande une personne. Les approbations expirent en 30 min et ne doivent jamais être sous « Plus ». |
| Destinations principales | 5, **identiques sur téléphone et tablette** : À traiter · Appareils · Activité · Flotte · Plus | 7 destinations sur le rail (« tablette ») ; Automations et Politiques au premier niveau (« flotte ») | Un technicien qui utilise les deux appareils retrouve tout au même endroit. Seul le chrome change (barre ou rail). |
| Sessions distantes | Objets de premier rang : `SessionManager`, pastille sur téléphone, dock sur tablette, section « Sessions ouvertes » dans Activité | Destination « Sessions » dédiée | Même bénéfice sans ajouter de destination. |
| ObliReach en v1 | **Visionneuse web** dans une activité plein écran dédiée ; natif en v1.1 | Natif dès la v1 (« tablette ») | Le travail média et clavier est le plus risqué ; il ne doit pas être sur le chemin critique de la v1. |
| Confirmation T1 (réversible) | Petite feuille à un bouton qui **nomme l'appareil et le tenant**, sans délai | Bouton armé « Confirmer ? » de 3 s (« tablette ») | Le bouton armé ne montre pas la cible et viole la règle WCAG 2.2.1 sur les délais. |
| Confirmation T3 (destructive) | **Maintien 1,5 s + biométrie** ; saisie du nombre d'appareils seulement pour les actions groupées ≥ 10 ; alternative accessible sans délai sous TalkBack | Saisie du nom d'hôte (« astreinte », « flotte ») | Taper « SRV-AD2 » sur un AZERTY à 3 h est lent et source d'erreurs. |
| Fenêtre de confiance biométrique | 60 s sur le même appareil pour T2, hors actions groupées et T3 ; une chaîne T2 + vérification 2FA compte pour une seule | 30 s (« astreinte ») | Tuer trois processus d'affilée reste supportable. |
| Couleur rouge | **Discipline du rouge** : rouge de marque dans le chrome seulement, rouge dans le contenu = critique, danger distingué par la forme | Fil d'état rouge pulsant sous la barre (« astreinte ») | Sur 2 000 appareils, un appareil est presque toujours critique : un fil rouge permanent fatigue et contredit la règle. |
| Bouton principal plein | Fond **`#C83232`** (blanc 5,3:1) ; `#E03A3A` reste la couleur de marque (logo, icônes) | Fond `#E03A3A` (blanc 4,34:1, échoue AA) | Contraste AA obligatoire. |
| Chrome de navigation | Barre, rail et barre supérieure sur `#0F1220` (`--s1` du web), cartes sur `#131728` | Chrome sur `#131728` | Garder la silhouette chrome / carte du web. |
| Tenant : filtrer ou basculer | Deux fonctions distinctes dans la même feuille : **Filtrer la vue globale** (sans changement de session) et **Travailler dans un tenant** (bascule) | Contrôle unique ambigu | Les routes d'action restent strictement liées au tenant de session ; il faut le dire à l'utilisateur. |
| Plusieurs instances Obliance | **Une app, plusieurs profils de serveur** (8 au plus) ; un seul serveur actif à l'écran, bascule rapide « Serveur › Tenant » dans la même feuille que le tenant ; notifications et À traiter de **tous** les serveurs connectés, même non actifs | Clones de l'app (une installation par serveur, clonage système, flavor par client) ; un seul serveur à la fois | Demande du propriétaire : trois serveurs doivent pouvoir l'alerter en même temps, sans clones sur le téléphone. |
| Élément d'un autre serveur | Ouvrir un appareil, une approbation ou un lien d'un autre serveur **bascule automatiquement** le serveur actif, avec annonce et **Revenir** ; les actions de boîte (lu, supprimer, surveiller, enrôlement) partent vers le serveur de l'élément **sans** bascule | Écran « en visite » lié à un serveur non actif ; bascule manuelle obligatoire | Un seul contexte à l'écran et un seul socket ; même modèle que la bascule implicite de tenant (§2.3). |
| Identité d'un serveur | **Tuile monogramme colorée** (palette fermée hors rouge de marque et hors couleurs d'état) sur la puce de périmètre, les cartes, les notifications et les confirmations | Couleur seule ; recoloration de l'accent ou du chrome par serveur | La couleur de marque et la discipline du rouge restent intactes ; la forme (tuile à lettres) distingue une identité d'un état. |
| Balayages | Ne changent que l'état local ou de la boîte (lu, supprimé avec annulation, surveiller, masquer) | Balayage qui ouvre un shell (« tablette ») | Un geste ne doit jamais créer d'activité distante. |
| Retour depuis un terminal ou ObliReach | Retour = **réduire** ; « Terminer » est une action explicite | Question « Réduire ou terminer ? » à chaque retour | Le geste le plus fréquent ne doit pas ouvrir de dialogue. |
| Gravité des alertes | Classement par **règles explicites** (catégorie déduite du titre, appareil serveur, surveillé) en attendant un champ `category` serveur | Tri par la gravité brute du serveur | Le serveur envoie « Hors ligne » en `info` sauf si le groupe est « Toujours actif ». |
| Cache et outillage | v1 : cache mémoire + instantanés JSON chiffrés ; injection manuelle (`AppGraph`) ; Room en v1.1 (**preuve faite** avec KSP 2.3.12, `docs/mobile/phase0-proofs.md`) | Room, Hilt et KSP d'emblée | La chaîne AGP 9.3.1 à Kotlin intégré 2.2.10 est contrainte. |
| Taille de la v1 | ≈ 34 ps centrées sur la boucle d'astreinte, dont ≈ 3 ps de multi-serveurs (sans lui, le propriétaire ne peut pas faire son astreinte sur ses trois serveurs) | 44 ps (« flotte »), 42 ps à 3 développeurs (« tablette ») | La boucle alerte → appareil → correction doit arriver tôt. |
| Thèmes | Sombre « Operator » par défaut + variante **Nuit** ; clair « Daylight » en v2 avec jetons corrigés | Trois thèmes dès la v1 | Triple la surface de recette ; le Daylight actuel échoue AA. |

---

## 1. Vision et principes

### 1.1 Vision

Obliance supervise des milliers d'appareils pour des MSP et des services informatiques. Aujourd'hui, en astreinte, le technicien reçoit une alerte avec jusqu'à 15 minutes de retard, ouvre une interface web conçue pour un grand écran, et se bat avec les touches spéciales d'un shell sur un clavier tactile.

L'application doit rendre trois moments excellents :

1. **La nuit, sur téléphone** : « Qu'est-ce qui brûle, sur quel serveur, chez quel client, et est-ce que ça dure encore ? », puis une correction d'une main, puis « Prévenez-moi quand il revient ».
2. **La journée, en salle serveur, sur tablette** : un PowerShell, un SSH et un écran ObliReach ouverts côte à côte, un clavier physique qui fonctionne comme sur un PC, une clé BitLocker lisible à voix haute.
3. **Partout, pour décider** : approuver une action sensible ou un nouvel agent avant expiration, avec assez de contexte pour ne pas se tromper de client.

### 1.2 Principes

| # | Principe | Ce que cela veut dire concrètement |
|---|---|---|
| P1 | **Les problèmes d'abord** | Démarrage sur À traiter. Toute liste d'appareils est triée « Problèmes d'abord » (critique → attention → mise à jour → autres → hors ligne → en ligne, soit `sortBy=status`). Une flotte saine s'affiche en une phrase calme : « Rien à traiter. » |
| P2 | **Tri en dix secondes** | Une carte ou une notification répond sans toucher à quatre questions : quoi, où (appareil, tenant, groupe), depuis quand, est-ce que ça dure encore. L'écran de l'appareil ajoute le **contexte d'incident** : ce qui a changé ces 6 dernières heures, les voisins hors ligne, la maintenance en cours. |
| P3 | **Un pouce** | Les actions principales sont dans les 40 % bas de l'écran : barre de navigation, barre d'actions de l'appareil, feuilles, bouton flottant. La barre supérieure ne porte que du contexte. |
| P4 | **Le contexte est toujours visible** | Le serveur (dès que l'utilisateur en a deux), le tenant et l'identité de l'appareil (nom, OS, IP) figurent sur chaque surface d'action et dans chaque confirmation : « Redémarrer SRV-AD2 (BinaryHearts › BASH) ? ». Agir chez le mauvais client, ou sur la mauvaise instance, est l'erreur la plus coûteuse d'un MSP. |
| P5 | **Sûr par construction** | La prudence croît avec le rayon d'impact (§7.6). Les garde-fous du serveur (vérification 2FA, approbation à deux, confidentialité) sont des états natifs, jamais des messages d'erreur. Aucune action n'est optimiste. |
| P6 | **Un état honnête** | Chaque écran dit la fraîcheur de ses données (« En direct », « il y a 3 min », « Hors ligne — données de 03:02 »). La connexion temps réel est visible. Une action désactivée dit toujours pourquoi. La sortie d'un script n'est jamais présentée comme un flux : elle arrive quand l'appareil a fini. |
| P7 | **Fait pour la nuit** | Sombre par défaut, variante Nuit, pas de flash blanc, vibrations plutôt que sons, mode astreinte qui laisse passer les critiques et fait taire le reste. |
| P8 | **Trois entrées, une app** | Tactile (cibles ≥ 48 dp), clavier (raccourcis pour les destinations, les onglets, les sessions et les actions), souris (menus contextuels, survol). Toute action au clavier ou à la souris a un équivalent tactile. |
| P9 | **Natif là où est le travail, web là où est la configuration** | Toute la boucle d'astreinte est native. Les pages de configuration s'ouvrent dans la vue web, avec un marqueur « Vue web » et un retour natif. Les liens de la vue web vers un appareil reviennent au natif. |
| P10 | **Le socle avant la fonctionnalité** | Tout ce qui ne parle pas d'appareils vit dans `core:*`, sans aucun type Obliance, registre des serveurs compris. Une règle CI vérifie le graphe des modules. |
| P11 | **Plusieurs serveurs, une seule app** | Tous les serveurs connectés alertent en permanence ; un seul est actif à l'écran ; changer de serveur prend un appui et moins d'une seconde. Avec un seul serveur configuré, rien du multi-serveurs n'apparaît. |

### 1.3 Personas

| Persona | Rôle dans Obliance | Contexte | Tâches principales | Conséquences pour la conception |
|---|---|---|---|---|
| **Karim Benali**, technicien N2 d'astreinte (principal) | **Trois serveurs Obliance** (§4) : sur **BinaryHearts** (l'instance du MSP) et **Atelier** (l'instance de l'atelier de préparation), compte Obligate `og_karim.benali`, **administrateur de plateforme**, comme la plupart des techniciens du MSP ; sur BinaryHearts, travaille sur le tenant maître Default (vue globale) et bascule vers les tenants clients pour agir. Sur **Client Durand** (instance auto-hébergée d'un client), compte local `karim.benali`, simple membre d'équipe | Une semaine sur quatre d'astreinte, pour les trois serveurs. Galaxy S23, Gboard AZERTY. Réveillé à 03:12 par « SRV-AD2: Hors ligne ». Parfois passager en voiture sur 4G. | Savoir en quelques secondes si c'est réel, sur quel serveur, et quelle est l'ampleur ; corriger ou escalader en 5 min ; se rendormir en sachant que l'appareil est revenu | Notifications actionnables des trois serveurs, À traiter agrégé, bascule de serveur en un appui, contexte d'incident, « Surveiller », thème Nuit, biométrie plutôt que mots de passe, collage du code 2FA (un code par serveur) |
| **Julien Moreau**, technicien terrain (secondaire) | Serveurs BinaryHearts et Atelier ; sur BinaryHearts, `og_julien.moreau`, **pas administrateur de plateforme** ; membre de BASH (rôle de tenant avec `devices.manage`), `rw` sur Siège › Serveurs et Siège › Comptabilité, capacités `execute`, `power`, `remote` ; ses actions restreintes passent par une approbation | Galaxy Tab S9 avec clavier et souris Bluetooth, en paysage, en sous-sol avec un réseau faible | PowerShell sur les serveurs, SSH, ObliReach pour aider une comptable, script sur 12 postes, numéros de série, clés BitLocker | Volets liste-détail, raccourcis clavier, sessions persistantes, dock, cache hors ligne |
| **Sophie Martin**, responsable technique du MSP (secondaire) | Serveurs BinaryHearts et Atelier ; `og_sophie.martin`, **administratrice de plateforme** sur le tenant maître Default (vue globale) ; seconde approbatrice | Réunions, trajets ; Pixel 9 | Approuver ou refuser les demandes à deux avant expiration, surveiller la santé par tenant, terminer une session distante suspecte | Approbations dans À traiter avec compte à rebours, notification prioritaire, approbation biométrique, vue par tenant |
| **Nadia Roux**, informaticienne chez le client BASH (tertiaire) | Compte local `nroux`, admin du tenant BASH (`user_tenants.role='admin'`), pas administratrice de plateforme ; lecture seule sur la plupart des groupes, `rw` sur Siège › Comptabilité | Usage occasionnel en journée | Vérifier ses machines, redémarrer un service, lancer un script approuvé, approuver un enrôlement | Actions filtrées par rôle et par niveau, messages de refus clairs, indicateurs calculés sur **ses** appareils (« Vos appareils ») |

### 1.4 Tâches, fréquence et format

| Tâche | Fréquence | Format principal | Natif ? |
|---|---|---|---|
| Trier une alerte et agir sur l'appareil | Quotidienne (astreinte) | Téléphone | Oui |
| Ouvrir un shell (PowerShell, CMD, SSH) | Plusieurs fois par jour | Tablette avec clavier, parfois téléphone | Oui |
| Voir l'écran d'un utilisateur (ObliReach) | Quotidienne | Tablette, parfois téléphone | v1 web, v1.1 natif |
| Lancer un script sur N appareils et lire les résultats | Hebdomadaire | Tablette ou téléphone | Oui |
| Lire un matériel, un n° de série, une clé BitLocker | Hebdomadaire | Tablette ou téléphone | Oui |
| Approuver une demande à deux ou un enrôlement | Hebdomadaire | Téléphone | Oui |
| Modifier planifications, politiques, scénarios, utilisateurs | Mensuelle | Poste de travail | Vue web |

---

## 2. Architecture de navigation

### 2.1 Destinations principales (identiques sur téléphone et tablette)

| Ordre | Destination | FR / EN | Icône Lucide | Badge | Contenu |
|---|---|---|---|---|---|
| 1 (démarrage) | **À traiter** | À traiter / Triage | `siren` | Non lus critiques + attention (rouge), + approbations en attente pour les admins | Alertes, approbations à deux, enrôlements (S10) |
| 2 | **Appareils** | Appareils / Devices | `monitor` | — | Liste, filtres, arbre des groupes (S20–S23) → détail (S30) |
| 3 | **Activité** | Activité / Activity | `activity` | Nombre d'opérations en cours (sessions, lots) | Ce qui tourne (sessions ouvertes, lots, surveillances, mes demandes) et ce qui peut tourner (scripts, planifications, scénarios) (S55) |
| 4 | **Flotte** | Flotte / Fleet | `layout-dashboard` | — | Indicateurs, attention requise, activité 24 h, tenants, groupes, disques saturés (S70) |
| 5 | **Plus** | Plus / More | `menu` | Point si une mise à jour de l'app est disponible | Supervision, mises à jour, sécurité, compte, réglages, pages web d'administration, autres apps Obli (S80) |

**Pourquoi cet ordre.** En astreinte, la boucle est : À traiter → appareil → agir → suivre dans Activité. Flotte est un second coup d'œil (« est-ce une panne globale ? »). Les approbations et les enrôlements vivent **dans** À traiter, parce que ce sont des décisions avec échéance.

### 2.2 Barre supérieure (écrans de premier niveau)

```
┌──────────────────────────────────────────────────┐
│ [▣ BASH ▾]          À traiter           ⌕   (KB)●│
└──────────────────────────────────────────────────┘
```

- **À gauche : puce de périmètre** (`building-2`, nom, chevron). Ouvre S81 « Serveur et tenant ». Sur le tenant maître : « Default · Vue globale ». Si un filtre de vue globale est actif : « BASH · filtre » avec un point `#FF6868` de 6 dp. **Dès que deux serveurs sont configurés**, la puce commence par la tuile monogramme du serveur actif (`[BH] Default · Vue globale ▾`, §2.10) ; sur tablette étendue, le bouton de périmètre du rail porte la même tuile.
- **Titre** : Rajdhani 600, 24 sp ; se replie au défilement.
- **À droite** :
  - recherche `⌕` (S82) ;
  - avatar avec un **anneau de 2 dp qui donne l'état du temps réel** : vert connecté, ambre pulsant en reconnexion, gris déconnecté. Un appui affiche « Temps réel connecté depuis 02:51 ». Menu de l'avatar : Profil, Réglages, Applications Obli, Se déconnecter.
- Pas de fil d'état coloré sous la barre (arbitrage §0.2). Le chrome reste neutre ; la gravité vit dans le badge d'À traiter et dans le contenu.
- Écrans de détail : flèche retour, nom de l'entité, sous-titre « tenant · chemin du groupe ».

### 2.3 Modèle de périmètre : filtrer ou basculer

**Faits serveur à respecter :**
- le tenant est dans la session serveur (`req.session.currentTenantId`) : un seul cookie, donc un seul tenant pour le natif, le Socket.IO et la vue web ;
- les salons Socket.IO sont rejoints à la connexion ;
- sur le tenant 1 (Default, vue globale), les listes couvrent tous les tenants, mais **les routes d'action restent strictement liées au tenant de session** (`POST /api/commands`, approbations, résultats de conformité, historique de planification, confidentialité) et renvoient 404 sur un appareil d'un tenant enfant ;
- les événements temps réel des tenants enfants n'arrivent pas sur le socket du tenant maître.

**La feuille de périmètre (S81 « Serveur et tenant ») a donc deux sections de tenant** (précédées, dès deux serveurs, de la section « Serveurs », §2.10) **:**

| Fonction | Qui | Effet | Affichage |
|---|---|---|---|
| **Filtrer la vue globale** | Session sur Default | Ajoute `tenantIds=` aux requêtes de liste. Session et socket inchangés. | Puce « BASH · filtre » |
| **Travailler dans un tenant** | Tout utilisateur avec 2 tenants ou plus | `POST /api/tenant/switch` → reconnexion Socket.IO → invalidation des caches du périmètre → rechargement de l'écran courant. Change aussi le tenant de la vue web. | Puce « BASH », barre d'annonce « Vous travaillez maintenant dans BASH » |

**Règles :**
1. **Ouverture d'un appareil d'un autre tenant** (notification, lien, alerte) : `GET /api/tenants/locate-device/:id`.
   - Administrateur de plateforme en session maître (Default) : l'appareil s'ouvre en vue globale, sans bascule.
   - Autres cas : bascule automatique, barre d'annonce « Basculé sur BASH pour ouvrir SRV-AD2 » avec **Revenir** pendant 5 s.
2. **Agir depuis la vue globale** sur un appareil d'un tenant enfant : la feuille « Agir » affiche une ligne « Pour agir sur SRV-AD2, Obliance doit passer sur le tenant BASH. » et le bouton **Basculer et continuer**. L'action reprend là où elle était. Ensuite, une puce persistante « Revenir à la vue globale » reste dans la barre supérieure. Un réglage permet « Toujours basculer automatiquement ».
3. **Temps réel en vue globale** : un écran d'appareil d'un tenant enfant ouvert depuis Default affiche « Vue globale — actualisation toutes les 15 s » et interroge le REST. La Flotte interroge `summary` et `group-stats` toutes les 60 s tant qu'elle est visible.
4. **Sessions distantes** : elles survivent à la bascule (elles sont authentifiées par jeton). Leurs onglets gardent une puce du tenant d'origine.
5. **Au-dessus du tenant, le serveur** : le périmètre complet est « Serveur › Tenant ». Le tenant se choisit toujours **dans** le serveur actif ; changer de serveur restaure le dernier tenant utilisé sur ce serveur (§2.10).

### 2.4 Téléphone (largeur compacte < 600 dp)

- `NavigationBar` de 5 destinations, libellés toujours visibles, sur le chrome `#0F1220`.
- **La barre de navigation se masque** sur les écrans poussés qui ont leur propre barre d'actions (détail d'appareil, préparation de script, terminal, ObliReach).
- Détail d'appareil : onglets défilants collants + **barre d'actions basse** à 4 emplacements adaptés à l'état (§5, S30).
- Feuilles modales pour les choix courts ; dialogues pour les confirmations ; plein écran pour le travail long.
- Un seul bouton flottant étendu dans l'app : « Exécuter un script » dans Activité. En mode sélection de la liste d'appareils, un bouton contextuel « Exécuter sur 3 ».
- Paysage : la barre devient un `NavigationRail` compact ; terminal et ObliReach passent en immersif.

### 2.5 Tablettes et pliables

Classes de fenêtre M3 : compacte < 600 dp, moyenne 600–839, étendue 840–1199, large ≥ 1200. Hauteur compacte < 480 dp (téléphone en paysage).

| Classe | Navigation | À traiter | Appareils | Détail d'appareil | Activité |
|---|---|---|---|---|---|
| Compacte | Barre en bas | Liste plein écran → S30 | Liste plein écran → S30 | Onglets + barre d'actions basse | Liste → S52 / S60 |
| Hauteur compacte | Rail d'icônes, barres de 48 dp | Idem | Idem | Barre d'actions en bande verticale à droite | Idem |
| Moyenne | Rail avec libellés | Liste \| détail (40/60) | Liste 320 dp \| détail ; arbre via une puce « Groupe » | Colonne d'en-tête + contenu d'onglet | Liste \| lot |
| Étendue | Rail + bouton de tenant en tête | Liste \| **panneau appareil intégré** (en-tête, métriques en direct, actions rapides) | Arbre 264 dp repliable \| liste 360 dp \| détail | Deux colonnes : en-tête, contexte, métriques et **rail d'actions libellé** à gauche (360 dp) ; onglets à droite | Liste \| lot \| sortie |
| Large (DeX, Chromebook) | Rail ou tiroir permanent | Trois volets : boîte \| appareil \| **volet secondaire** (processus en direct ou terminal ancré) | Trois volets | + volet « Activité en direct » de l'appareil | Trois volets |

**Cockpit tablette en paysage (étendue / large) :**

```
┌────┬──────────────────────┬───────────────────────────────────┬──────────────────────┐
│ ⚑  │ À traiter       5    │ SRV-AD2 · BASH › Siège › Serveurs  │ PowerShell · PC-C…03 │
│ ▭  │ ▌CRITIQUE · 03:12    │ ● Hors ligne  vu il y a 14 min     │ PS C:\> Get-Process… │
│ ≋  │ ▌SRV-AD2: Hors ligne │ ┌ CONTEXTE ───────────────────────┐ │                      │
│ ▦  │ ▌CRITIQUE · 03:05    │ │ 4 autres appareils de Serveurs  │ │                      │
│ ⋯  │ ▌PC-COMPTA-03: Crit… │ │ hors ligne depuis 03:07         │ │                      │
│    │ ▌ATTENTION · 02:47   │ │ Planification « Vérif sauvegarde │ │                      │
│ BA │ ▌BOB01: Alerte       │ │ » en échec à 02:00 (code 1)     │ │ [Échap][Tab][Ctrl]…  │
│    │                      │ └─────────────────────────────────┘ │                      │
│    │                      │ [Surveiller] [Maintenance] [Agir]   │                      │
├────┴──────────────────────┴───────────────────────────────────┴──────────────────────┤
│ Dock : [>_ PowerShell PC-COMPTA-03 ●] [>_ SSH 140 ●] [▣ ObliReach PC-COMPTA-03 ●]      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- La largeur des volets se règle par une poignée (expansion de volet M3) et est mémorisée par destination.
- Un volet de détail n'est jamais vide : « Sélectionnez un appareil » avec le pouls de la flotte.
- La sélection survit à la rotation, au pliage et au changement de volets.

### 2.6 Sessions : pastille (téléphone) et dock (tablette)

Les shells et les sessions ObliReach vivent dans un `SessionManager` au niveau du processus. Ils survivent à la navigation, à la rotation, à la bascule de tenant et à l'arrière-plan (service de premier plan). Seul « Terminer », ou la fermeture du shell distant, les arrête.

- **Téléphone :** dès qu'une session est ouverte, une pastille flotte 8 dp au-dessus de la barre de navigation : `>_ 2 sessions · PowerShell PC-COMPTA-03`. Appui = reprendre la dernière session. Glisser vers le bas = masquer jusqu'à la prochaine session. Sur les écrans sans barre de navigation, elle devient une mini-puce dans la barre supérieure.
- **Tablette étendue :** un dock de 44 dp en bas du volet de détail. Un onglet par session : icône de protocole, appareil, point d'état, puce de tenant s'il diffère du tenant courant, aperçu au survol ou à l'appui long (dernière ligne du terminal ou vignette ObliReach 160 × 90). Appui = ouvrir dans le volet de détail. `Ctrl+J` bascule le dock.
- **Tablette large :** le dock peut être épinglé comme volet secondaire vertical.
- **Notification persistante** du service de premier plan : « 2 sessions actives — PowerShell PC-COMPTA-03, SSH 140 » avec **Tout terminer**.
- Le compteur de sessions apparaît aussi dans le badge d'Activité et dans la section « Sessions ouvertes » (S55).

### 2.7 Recherche et palette de commandes (une seule surface, S82)

- **Ouverture** : icône de recherche sur tous les écrans de premier niveau, raccourci d'app « Rechercher un appareil », `Ctrl+K` ou `/` avec un clavier physique.
- **Téléphone** : `SearchBar` plein écran. **Tablette** : dialogue centré de 640 dp.
- **Une seule zone de saisie** « Nom, IP, MAC, utilisateur… ». Groupes de résultats, dans l'ordre :
  1. **Appareils** (serveur, anti-rebond 250 ms, triés par état) ;
  2. **Actions** selon le contexte : « Ouvrir PowerShell sur PC-COMPTA-03 », « Redémarrer l'agent de 140 » ;
  3. **Scripts** : « Exécuter « Vider le cache DNS »… » ;
  4. **Aller à** (destinations, onglets) ;
  5. **Tenants** : « Passer sur BASH » ;
  6. **Serveurs** (avec deux serveurs ou plus) : « Passer sur Atelier ». La recherche d'appareils ne porte que sur le serveur actif ; sans résultat, la palette propose « Chercher « NAS » sur les autres serveurs » (une requête par serveur connecté, résultats groupés par serveur, appui = bascule puis S30).
- Si le presse-papiers contient une IP ou un nom d'hôte : suggestion « Rechercher « 10.0.0.12 » copié ».
- Clavier : flèches, Entrée pour exécuter, Tab pour changer de groupe.
- Une action proposée par la palette passe par les mêmes garde-fous que partout ailleurs (§7.6).

### 2.8 Ce qui vit sous « Plus » et ce qui s'ouvre en vue web

| Section | Éléments | Natif ou web | Visibilité |
|---|---|---|---|
| Automations | Raccourcis vers Scripts, Planifications, Scénarios (aussi dans Activité) | Natif | Tous, selon capacités |
| Mises à jour | Mises à jour de la flotte par titre et gravité ; approuver, déployer | Natif v1.1 | `updates` ou `rw` |
| Supervision | Sessions distantes (terminer) · Historique | Natif v1.1 | Admin ou `supervision:read` |
| Sécurité | Approbations (raccourci vers À traiter) · Journal d'audit | Approbations natif ; audit web (lecture native en v2) | Admin de plateforme |
| **Administration — Vue web** | Utilisateurs et équipes · Jeux de permissions · Restrictions · Politiques de conformité · Listes de logiciels · CVE · Canaux de notification · Seuils · Clés API et ajout d'agent · Sections personnalisées · Découverte réseau · Rapports · Workspace (tenants) · Paramètres serveur · Import/Export · Gestion de l'arbre des groupes · Éditeurs de scripts, planifications et scénarios | Vue web (S90), étiquette « Vue web » sur chaque ligne | Selon rôle et capacités |
| Applications Obli | Obliview, Obliguard, Oblimap… | S91 | Utilisateurs SSO (`connected-apps`) ou manifeste |
| Compte | Profil et sécurité (S85) · Réglages de l'application (S83) · Notifications et astreinte (S84) · À propos et mises à jour (S86) · Se déconnecter | Natif | Tous |

**Jamais sur mobile** : dépôt de logiciels (téléversement), options d'affichage web (combinaisons de graphiques, noms de capteurs), téléchargement du client de bureau.

**Règles de la vue web (S90) :**
- c'est le `WebHost` durci de la coquille actuelle, avec le même cookie, donc le même tenant, et le pont `ObliNative` ;
- barre supérieure native : titre de la page, étiquette « Vue web », **Fermer**, **Actualiser**, **Ouvrir dans le navigateur** ;
- sur téléphone plein écran ; sur tablette dans le volet de détail, pour garder le rail utilisable ;
- les navigations vers `/devices/:id` ou `/` sont interceptées et renvoient vers S30 ou S70 ;
- à la fermeture, l'app appelle `GET /api/auth/me` ; si `currentTenantId` a changé dans la page web, le socket est reconnecté et l'écran dessous recharge ses données.

### 2.9 Routeur de liens (`navigateTo`, liens profonds, notifications)

Les alertes serveur portent un chemin web relatif (`navigateTo`). L'app reçoit aussi `obli-obliance://…`, des raccourcis et, quand l'hôte est connu à la compilation, des App Links.

| Chemin entrant | Destination native |
|---|---|
| `/devices/:id` (option `?tab=processes`) | S30 (via `locate-device`, bascule si nécessaire) |
| `/devices?status=offline&groupId=…` | S20 filtrée |
| `/` | S70 |
| `/group/:id` | S23 |
| `/admin/security`, `?approval=:id` (proposé) | S10 › Approbations, ou S11 |
| `/automations`, `/schedules` | S56 / S57 |
| `/admin/supervision` | S87 (v1.1), sinon S90 |
| `/policies` | S71 (v1.1), sinon S90 |
| Tout autre chemin du serveur | S90 |
| `obli-obliance://setup?server=…` | S01 pré-rempli ; si un autre serveur est déjà configuré : S93 pré-rempli ; si ce serveur est déjà connu : bascule vers lui |
| `obli-obliance://open?path=/devices/123` | Comme le chemin, sur le serveur actif |
| `obli-obliance://open?server=atelier.binaryhearts.me&path=/devices/123` | Comme le chemin, **sur le serveur désigné** (bascule annoncée si ce n'est pas le serveur actif) ; hôte inconnu → « Ce lien vise un serveur qui n'est pas configuré. » [Ajouter ce serveur] |

**Chaque lien est résolu contre un serveur.** Une notification ou une alerte porte l'identifiant local du serveur qui l'a produite ; son `navigateTo` est résolu contre ce serveur, jamais contre le serveur actif. Un App Link se résout par son hôte. Les liens sortants (partage, « Ouvrir dans le navigateur ») portent toujours `server=`.

### 2.10 Plusieurs serveurs (une app, plusieurs instances Obliance)

**Besoin.** Le propriétaire administre trois instances Obliance (BinaryHearts, Atelier, Client Durand, §4) et doit être alerté par les trois en même temps, sur un seul téléphone, sans cloner l'app. Plusieurs techniciens d'un MSP sont dans le même cas (instance du MSP + instances auto-hébergées de clients).

**Modèle.**

| Notion | Définition |
|---|---|
| **Profil de serveur** | Adresse HTTPS (origine unique), nom affiché, couleur et monogramme, compte connecté, dernier tenant utilisé, réglages de notification propres. 8 profils au plus. |
| **Serveur actif** | Le seul dont les écrans Appareils, Détail, Activité, Flotte, Plus et la vue web montrent les données. Un seul socket temps réel, un seul contexte d'action. |
| **Serveurs connectés** | Tous les profils avec une session valide. Ils alimentent **en permanence** les notifications et « À traiter », qu'ils soient actifs ou non. |
| **Périmètre** | « Serveur › Tenant ». Le tenant appartient toujours au serveur actif. |

**Ce qui est agrégé et ce qui ne l'est pas.**

| Surface | Portée | Détail |
|---|---|---|
| Notifications | Tous les serveurs connectés | Un groupe de canaux Android par serveur (§9), mêmes catégories dans chaque groupe ; titre préfixé du serveur dès qu'il y en a deux (« CRITIQUE · Client Durand › Default — SRV-DURAND01 ») ; regroupement par serveur puis par tenant. |
| À traiter (S10) | Tous les serveurs connectés, filtrable | Puce « Tous les serveurs ▾ » avant la puce de tenant ; chaque carte porte la tuile de son serveur dans le surtitre ; la carte de corrélation ne regroupe jamais deux serveurs. Approbations et enrôlements : agrégés de la même façon. |
| Badge d'À traiter, tuile Réglages rapides, widget | Tous les serveurs connectés | Somme des critiques et attentions non lues. |
| Appareils, Flotte, Activité (lots, planifications), recherche | **Serveur actif** | Les listes restent lisibles et les indicateurs justes ; la palette propose de chercher ailleurs (§2.7). |
| Sessions distantes | Chacune liée à son serveur | Elles survivent à la bascule (jeton par serveur) ; leurs onglets et la pastille portent la tuile du serveur d'origine en plus du tenant. |
| Surveillances (« Surveiller ») | Chacune liée à son serveur | Listées dans Activité avec la tuile ; elles continuent quel que soit le serveur actif. |

**Bascule de serveur.**
1. **Explicite** : puce de périmètre → S81 › section « Serveurs » → appui sur « Atelier ». Aussi par la palette (« Passer sur Atelier »), le raccourci d'app du serveur, `Alt+1…8` avec un clavier physique.
2. Effets, dans l'ordre : l'écran courant affiche l'instantané du serveur cible s'il existe (bascule perçue < 1 s) → le socket du serveur quitté se ferme, celui du serveur cible s'ouvre → `GET /api/auth/me` du serveur cible → rechargement de l'écran courant → vibration de confirmation → barre « Vous travaillez maintenant sur Atelier ». Les piles de navigation sont **mémorisées par serveur** : revenir sur BinaryHearts rend l'écran d'appareil laissé ouvert.
3. **Implicite** : ouvrir une carte, une notification ou un lien d'un autre serveur bascule automatiquement, avec la barre « Passé sur Client Durand pour ouvrir SRV-DURAND01 » et **Revenir** pendant 5 s (même modèle que la bascule implicite de tenant, §2.3). Si le tenant de l'élément diffère aussi, une seule barre annonce les deux (« Passé sur Client Durand › Default… »).
4. **Actions de boîte sans bascule** : marquer lu, supprimer, surveiller, approuver ou refuser un enrôlement (T1) depuis À traiter ou une notification partent vers le serveur de l'élément avec son propre cookie, sans changer le serveur actif. Toute autre action (T1 sur un appareil, T2, T3) exige que l'élément soit sur le serveur actif : la feuille « Agir » ne peut pas s'ouvrir sur un appareil d'un autre serveur.
5. **Session expirée sur un serveur non actif** : pas de feuille S03 intempestive ; sa ligne dans S81 et S92 passe à « Session expirée · Se reconnecter », ses cartes À traiter sont grisées avec la même mention, et une notification du canal « Compte » de son groupe le signale **une fois**. S03 ne s'affiche que pour le serveur actif.

**Identité visuelle d'un serveur.**
- **Tuile monogramme** : carré arrondi (20 dp dans les puces et surtitres, 28 dp dans les listes ; rayon 5 dp), fond de la couleur à 18 % **posé sur un fond `chrome` opaque** (sinon le violet et l'indigo tombent sous 4,5:1 sur `hover` et `active`), bordure 1 dp à 40 %, deux lettres JetBrains Mono 600 dans la couleur. La forme (tuile à lettres) distingue une identité d'un état (point, pastille).
- **Palette fermée** de 8 couleurs (§8.2), hors rouge de marque et hors couleurs d'état ; attribuée automatiquement dans l'ordre à l'ajout, modifiable dans S92.
- **Où elle apparaît** (dès deux serveurs) : puce de périmètre, bouton de périmètre du rail, surtitre des cartes d'À traiter, en-tête de S30 (sous-titre « BinaryHearts › BASH › Siège › Serveurs »), **feuilles de confirmation S41 et invites biométriques** (« Redémarrer SRV-AD2 (BinaryHearts › BASH) ? »), onglets de sessions et pastille, notifications (icône large), raccourcis d'app.
- **Jamais** : recoloration de l'accent, du chrome ou de l'indicateur de destination par serveur.
- **Un seul serveur configuré** : aucune tuile, aucune section « Serveurs » dans S81, aucune puce « Tous les serveurs » ; l'app est identique à la conception mono-serveur.

**Ajout, retrait, déconnexion.**
- **Ajouter** : Plus › Serveurs (S92) › **Ajouter un serveur** (S93), ou lien `obli-obliance://setup?server=…` / QR. Même parcours que S01 ; une session Obligate déjà ouverte dans la WebView pour le même fournisseur est réutilisée (connexion sans saisie).
- **Deux profils ne peuvent pas partager une origine** (le pot à cookies est indexé par hôte) : « Ce serveur est déjà configuré (BinaryHearts). »
- **Se déconnecter de ce serveur** : déconnexion de ce seul serveur (§10.5) ; le profil reste, ses notifications s'arrêtent, ses cartes disparaissent d'À traiter.
- **Retirer ce serveur** (T1, nomme le serveur) : déconnexion + suppression des cookies de son origine, de ses caches et instantanés, de ses surveillances, de son groupe de canaux et de ses raccourcis. Le dernier serveur ne peut pas être retiré (seulement déconnecté).
- **Serveur actif retiré ou déconnecté** : l'app passe sur le serveur connecté suivant ; sans serveur connecté, S01.

**Mise à jour de l'application.** Chaque serveur publie `GET /api/mobile/android/version`. L'app retient le **plus haut `versionCode`** offert par un serveur connecté, télécharge depuis ce serveur et vérifie comme aujourd'hui le SHA-256 et le **signataire** (empreinte figée dans l'app) : un serveur ne peut pas pousser un APK signé par une autre clé.

**Raccourcis d'app.** Un raccourci dynamique par serveur (« Atelier », icône = tuile), qui ouvre À traiter filtré sur ce serveur et le rend actif ; les raccourcis d'appareils récents portent leur serveur.

---

## 3. Inventaire des écrans

Les identifiants sont stables : ils servent aux maquettes, aux tickets, aux tests de captures et aux clés de navigation (`NavKey`). Colonne « Mode » : **N** natif, **W** vue web, **N/W** natif avec renvoi web pour la partie configuration.

| ID | Écran | Téléphone | Tablette | Mode | Sources API principales | Version |
|---|---|---|---|---|---|---|
| S00 | Verrouillage | Plein écran | Plein écran | N | — (biométrie locale) | v1 (existant, restylé) |
| S01 | Connexion (serveur, Obligate, compte local, 2FA) | Plein écran progressif | Deux moitiés : panneau de marque + carte 440 dp | N | `GET /health`, `GET /api/auth/sso-config`, `POST /api/auth/login`, `POST /api/profile/2fa/verify`, `POST /api/profile/2fa/resend-email`, `GET /api/auth/me`, `GET /api/tenants` | v1 |
| S02 | Connexion Obligate (feuille SSO) | Feuille plein écran | Dialogue 720 × 640 | W | `/auth/sso-redirect`, `/auth/callback` | v1 |
| S03 | Session expirée | Feuille | Dialogue | N | `GET /api/auth/me`, SSO silencieux | v1 |
| S04 | Premier lancement | Pagination en 3 étapes | Dialogue paginé | N | — | v1 |
| S10 | À traiter (Alertes · Approbations · Enrôlements) | Liste | Liste \| panneau appareil | N | `GET /api/live-alerts/all`, `PATCH /api/live-alerts/:id/read`, `DELETE /api/live-alerts/:id`, `POST /api/live-alerts/read-all`, `GET /api/approvals`, `GET /api/devices?approvalStatus=pending`, socket `NOTIFICATION_NEW`, `APPROVAL_*`, `DEVICE_UPDATED`, `DEVICE_METRICS_PUSHED` | v1 |
| S11 | Détail d'approbation | Écran | Volet de détail | N | `GET /api/approvals?includeResolved=true`, `POST /api/approvals/:id/approve\|deny\|cancel`, `GET /api/devices/:id` | v1 |
| S12 | Examen d'enrôlement | Feuille | Volet de détail | N | `GET /api/devices/:id`, `POST /api/devices/:id/approve\|refuse`, `POST /api/devices/bulk/approve` | v1 |
| S20 | Liste des appareils | Liste | Arbre \| liste \| détail | N | `GET /api/devices`, `GET /api/devices/summary`, socket `DEVICE_*` | v1 |
| S21 | Filtres et tri | Feuille pleine hauteur | Feuille latérale | N | `GET /api/devices/os-facets`, `GET /api/devices/tags`, `GET /api/groups/tree` | v1 |
| S22 | Arbre des groupes | Feuille pleine hauteur | Volet gauche 264 dp | N/W | `GET /api/groups/tree` | v1 |
| S23 | Détail de groupe | Écran | Volet | N/W | `GET /api/groups/:id`, `GET /api/devices?groupId=&includeSubgroups=true`, `GET /api/schedules` | v1 |
| S24 | Vues enregistrées | Puces + feuille | Puces + menu | N | Local (DataStore) | v1.1 |
| S30 | Détail d'appareil (cadre, modes normal et incident) | Écran + onglets + barre d'actions | Deux colonnes + rail d'actions | N | `GET /api/devices/:id`, `POST /api/devices/:id/live-metrics`, `GET /api/devices/:id/change-events`, `GET /api/groups`, `GET /api/oblireach/devices`, `GET /api/tenants/locate-device/:id` | v1 |
| S31 | Onglet Aperçu | Onglet | Maçonnerie 2 colonnes | N | `latestMetrics`, `GET /api/devices/:id/metrics/history`, `/custom-metrics`, `GET /api/schedules/for-device/:id` | v1 |
| S32 | Onglet Services | Onglet | Tableau triable | N | `GET /api/devices/:id/services`, `POST /api/commands` (`list_services`, `start_service`, `stop_service`, `restart_service`) | v1 |
| S33 | Onglet Processus | Onglet | Tableau + volet secondaire | N | socket `PROCESS_SUBSCRIBE` / `DEVICE_PROCESSES_UPDATED` / `PROCESS_UNSUBSCRIBE`, `POST /api/commands` (`kill_process`) | v1 |
| S34 | Onglet Scripts (appareil) | Onglet | Onglet | N | `GET /api/executions?deviceId=`, socket `EXECUTION_UPDATED` | v1 |
| S35 | Onglet Distant | Onglet | Onglet | N | `GET /api/oblireach/devices`, `/oblireach/devices/:uuid/sessions`, `POST /api/commands` (`list_wts_sessions`, `install_oblireach`), `GET /api/remote/sessions?deviceId=` | v1 |
| S36 | Onglet Tâches | Onglet | Onglet | N | `GET /api/commands?deviceId=`, `DELETE /api/commands/:id`, socket `COMMAND_UPDATED`, `COMMAND_RESULT` | v1 |
| S37 | Onglet Inventaire | Onglet + puces de saut | Onglet | N | `GET /api/inventory/:id/hardware`, `/software?search=`, `GET /api/devices/:id/disk-health`, `GET /api/licenses/device/:id`, `POST /api/inventory/:id/scan` | v1 |
| S38 | Onglet Réglages (allégé) | Onglet | Onglet | N/W | `PATCH /api/devices/:id`, `GET /api/devices/tags` | v1 |
| S39 | Onglets secondaires (Mises à jour, Hyper-V, Sauvegardes, Historique, Fichiers, Rewind, Conformité) | Onglets | Onglets | N | Voir §5.S39 | v1.1 / v2 |
| S40 | Feuille « Agir » | Feuille basse | Feuille latérale ancrée au rail d'actions | N | `POST /api/commands`, routes d'appareil dédiées | v1 |
| S41 | Confirmation d'action | Feuille | Dialogue 480 dp | N | — | v1 |
| S42 | Vérification 2FA | Feuille non fermable | Dialogue | N | Renvoi du même corps + `twoFactorCode` | v1 |
| S43 | Demande d'approbation envoyée | Feuille | Dialogue | N | `POST /api/approvals/:id/cancel`, socket `APPROVAL_UPDATED` | v1 |
| S44 | Déverrouillage de confidentialité | Feuille | Dialogue | N | `POST /api/devices/:id/privacy/unlock`, `GET /api/devices/:id/privacy/unlocks`, `/privacy/disable-with-password`, `/privacy-mode/disable` | v1 |
| S45 | Clé de récupération BitLocker | Plein écran | Dialogue | N | Inventaire matériel (`bitlocker[].recoveryKeys`) | v1 |
| S50 | Choix du script | Écran | Liste \| aperçu | N | `GET /api/scripts?platform=`, `/scripts/categories`, `GET /api/scripts/:id` | v1 |
| S51 | Préparation de l'exécution | Écran plein | Feuille latérale 420 dp | N | `POST /api/scripts/:id/execute` | v1 |
| S52 | Lot en direct | Écran | Liste \| sortie | N | `GET /api/executions/batches/:batchId`, `GET /api/executions/:id`, `POST /api/executions/:id/stop\|cancel`, socket `EXECUTION_UPDATED`, `COMMAND_UPDATED` | v1 |
| S53 | Sortie d'exécution | Écran | Volet | N | `GET /api/executions/:id` | v1 |
| S55 | Activité | Liste + bouton flottant | Liste \| détail | N | `SessionManager` local, `GET /api/executions/batches`, `GET /api/remote/sessions?status=active`, suivi local des approbations | v1 |
| S56 | Bibliothèque de scripts | Écran | Liste \| détail | N/W | `GET /api/scripts`, `/scripts/categories` | v1 |
| S57 | Planifications (liste, pause, historique) | Écran | Liste \| historique | N/W | `GET /api/schedules`, `PATCH /api/schedules/:id {enabled}`, `GET /api/schedules/:id/history` | v1 |
| S58 | Scénarios et exécutions | Écran | Liste \| exécution | N/W | `GET /api/scenarios`, `/runs`, `/runs/:runId`, `/start-graph-run`, `/enable\|disable`, `/cancel-runs`, socket `SCENARIO_RUN_UPDATED`, `SCENARIO_NODE_UPDATED` | v1.1 |
| S60 | Terminal (PowerShell, CMD, SSH) | Plein écran | Plein écran, volet ou onglet de dock | N | `POST /api/remote/sessions`, WS `/api/remote/tunnel/<token>`, `POST /api/remote/sessions/:id/end` | v1 |
| S61 | Choix de session (WTS / ObliReach) | Feuille | Menu | N | `POST /api/commands {type:'list_wts_sessions'}`, `GET /api/oblireach/devices/:uuid/sessions` | v1 |
| S62 | Visionneuse ObliReach | Plein écran | Volet ou plein écran | W (v1) → N (v1.1) | `POST /api/remote/sessions {protocol:'oblireach'}`, WS tunnel | v1 / v1.1 |
| S63 | Outils ObliReach | Feuille | Panneau latéral 320 dp | N | Messages de contrôle du tunnel | v1.1 |
| S70 | Flotte | Défilement | Grille 3 colonnes | N | `GET /api/devices/summary`, `/fleet-hourly`, `/fleet-timeseries`, `/group-stats`, `/disk-saturated`, `GET /api/updates/stats` | v1 |
| S71 | Mises à jour de la flotte | Écran | Liste \| appareils touchés | N | `GET /api/updates/stats`, `GET /api/updates/aggregated`, `/aggregated/:updateUid/devices`, routes d'approbation et de déploiement par appareil | v1.1 |
| S80 | Plus | Liste | Liste \| contenu | N | `GET /api/auth/me` | v1 |
| S81 | Serveur et tenant (périmètre) | Feuille | Menu ancré 320 dp | N | Registre local des serveurs, `GET /api/tenants`, `POST /api/tenant/switch`, `GET /api/live-alerts/all` (par serveur) | v1 |
| S82 | Recherche et palette de commandes | Plein écran | Dialogue 640 dp | N | `GET /api/devices?search=`, scripts en cache, `GET /api/tenants` | v1 |
| S83 | Réglages de l'application | Écran | Liste \| détail | N | `PUT /api/profile` (langue) | v1 |
| S84 | Notifications et astreinte | Écran | Liste \| détail | N | Local ; `POST /api/mobile/push/subscriptions` (v1.1) | v1 |
| S85 | Profil et sécurité | Écran | Liste \| détail | N/W | `GET /api/profile`, `/profile/2fa/status`, `GET/DELETE /api/profile/trusted-ips`, `/auth/connected-apps`, `/auth/sso-logout-url`, `POST /api/auth/logout` | v1 |
| S86 | À propos et mises à jour | Écran | Liste \| détail | N | `GET /health`, `GET /api/mobile/android/version` | v1 |
| S87 | Supervision (sessions distantes, historique) | Écran | Liste \| détail | N | `GET /api/remote/sessions`, `POST /api/remote/sessions/:id/end`, historique reconstitué côté client | v1.1 |
| S88 | Raccourcis clavier | — | Surcouche | N | — | v1 |
| S90 | Vue web | Plein écran | Volet de détail | W | Pages web du serveur | v1 |
| S91 | Applications Obli | Feuille | Menu | N | `GET /api/auth/connected-apps`, `GET /api/oblitools/manifest` | v1 |
| S92 | Serveurs (liste et réglages par serveur) | Écran | Liste \| détail | N | Registre local, `GET /health`, `GET /api/auth/me` et `GET /api/live-alerts/all` de chaque serveur | v1 |
| S93 | Ajouter un serveur | Plein écran progressif | Dialogue 560 dp | N | Comme S01, sur la nouvelle origine | v1 |

---

## 4. Jeu de données de référence

Ces noms et valeurs sont utilisés **partout** : spécifications, parcours, maquettes, captures de tests. Ne pas en inventer d'autres.

**Serveurs et comptes**

| Serveur | Adresse | Version | Tuile | Couleur | Compte de Karim | Tenants | Appareils |
|---|---|---|---|---|---|---|---|
| **BinaryHearts** (principal, l'instance du MSP) | `https://obliance.binaryhearts.me` ; Obligate `id.binaryhearts.me` | 5.1.110 | BH | violet `#A78BFA` | `og_karim.benali` (Obligate, administrateur de plateforme) | Default, BASH | 312 |
| **Atelier** (préparation des postes) | `https://atelier.binaryhearts.me` ; même Obligate | 5.1.108 | AT | sarcelle `#2DD4BF` | `og_karim.benali` (Obligate, administrateur de plateforme) | Default | 18 |
| **Client Durand** (instance auto-hébergée d'un client) | `https://rmm.durand-associes.fr` ; pas d'Obligate | 5.0.94 | CD | fuchsia `#E879F9` | `karim.benali` (compte local, membre d'équipe, 2FA par application) | Default | 42 |

- Serveur actif par défaut dans les planches : **BinaryHearts**. Sauf mention contraire, tout ce qui suit (tenants, appareils, totaux, scripts) concerne BinaryHearts.
- Dernière version d'agent : 4.5.79 ; ObliReach : 1.8.2.
- Utilisateurs : Karim Benali (`og_karim.benali`, administrateur de plateforme, d'astreinte), Julien Moreau (`og_julien.moreau`, technicien BASH, non admin), Sophie Martin (`og_sophie.martin`, administratrice de plateforme), Nadia Roux (`nroux`, compte local, admin du tenant BASH).
- Les planches de maquette montrent la session de **Karim** (serveur actif BinaryHearts, tenant Default, vue globale, trois serveurs configurés), sauf mention contraire.
- IP publique de Karim en 4G : 92.184.107.21.

**Tenants**

| Tenant | id | Appareils | Hors ligne | Critique | Attention | Groupes |
|---|---|---|---|---|---|---|
| **Default** (maître, « Vue globale ») | 1 | 64 | 2 | 0 | 2 | Infra › Linux, Infra › Stockage, Infra › Virtualisation |
| **BASH** (client) | 4 | 248 | 14 | 1 | 3 | Siège › Serveurs (« Toujours actif »), Siège › Comptabilité, Siège › Direction, Siège › Accueil, Siège › Atelier |

**Totaux de flotte (vue globale)** : 312 appareils · 296 connectés (289 en ligne, 5 attention, 1 critique, 1 en mise à jour) · 16 hors ligne · 3 en attente d'enrôlement (hors total) · 47 appareils avec mises à jour en attente, dont 9 critiques · agents à jour 293/312 · 5 injoignables depuis plus de 72 h · 2 sessions distantes actives · 14 planifications dans les 24 h. Deltas : appareils ↑ 3 vs hier, hors ligne ↑ 5 vs hier, mises à jour en attente ↓ 12 vs semaine dernière.

**Appareils**

| Appareil | Tenant › Groupe | OS | IP locale | État | Détails |
|---|---|---|---|---|---|
| **SRV-AD2** | BASH › Siège › Serveurs | Windows Server 2022 Standard (build 20348) | 10.0.0.12 | Hors ligne depuis 03:08 | agent 4.5.79, ObliReach 1.8.2 ; planification « Vérif sauvegarde » en échec à 02:00 (code 1) |
| **PC-COMPTA-03** | BASH › Siège › Comptabilité | Windows 11 Pro 23H2 | 10.0.12.43 | Critique : CPU 98 % depuis 03:05 | Dell OptiPlex 7010, n° de série 7FJ2KX3 ; agent 4.5.79 ; ObliReach 1.8.2 ; dernier utilisateur `SIEGE\m.durand` ; redémarrage en attente |
| PC-COMPTA-01 / PC-COMPTA-02 | BASH › Siège › Comptabilité | Windows 11 Pro 23H2 | 10.0.12.41 / .42 | En ligne | — |
| **KIOSK-ACCUEIL-02** | BASH (clé « Site Siège » → Siège › Accueil) | Windows 11 IoT Enterprise | 10.0.3.41 | En attente d'enrôlement depuis 02:59 | — |
| **PC-ATELIER-02** | BASH › Siège › Atelier | Windows 10 Pro 22H2 | 10.0.14.22 | Hors ligne depuis 3 j | cible d'une demande de désinstallation |
| **SRV-LEGACY** | BASH › Siège › Serveurs | Windows Server 2008 R2 | 10.0.0.30 | En ligne | agent legacy 1.4 |
| **MAC-DIRECTION** | BASH › Siège › Direction | macOS 14.6 Sonoma | 10.0.12.20 | En ligne | mode confidentialité actif, avec mot de passe |
| **140** | Default › Infra › Linux | Debian 12 | 10.20.0.140 | En ligne | revenu en ligne à 00:58 après 6 min |
| **BOB01** | Default › Infra › Linux | Ubuntu 22.04.4 LTS | 10.20.0.15 | Attention : disque `/` à 94 % | 12,1 Go libres sur 200 Go ; agent 4.5.61 (obsolète) |
| **SRV-FILES01** | Default › Infra › Stockage | Windows Server 2019 | 10.20.0.30 | Attention : santé disque | disque 1 Seagate Exos 7E8 4 To, 5 secteurs réalloués |
| **HV-01** | Default › Infra › Virtualisation | Windows Server 2022 Datacenter | 10.20.0.10 | En ligne | hôte Hyper-V |

**Atelier** : NAS-ATELIER (Default, Debian 12, 10.40.0.20) — Attention : disque `/volume1` à 91 %. **Client Durand** : SRV-DURAND01 (Default › Serveurs, groupe « Toujours actif », Windows Server 2019, 192.168.10.5) — hors ligne depuis 02:53.

**Chronologie de la nuit du 25 septembre 2026 (utilisée dans les parcours)**
- 01:50 — Atelier : alerte NAS-ATELIER (disque `/volume1` à 91 %).
- 02:00 — la planification « Vérif sauvegarde » échoue sur SRV-AD2 (code 1).
- 02:40 — correctif KB5043145 installé sur PC-COMPTA-03.
- 02:47 — alerte BOB01 (disque `/` à 94 %).
- 02:58 — Client Durand : alerte « SRV-DURAND01: Hors ligne » (critique).
- 03:05 — alerte PC-COMPTA-03 critique (CPU 98 %) : `EBP.Compta.exe` bloqué dans la session restée ouverte de m.durand.
- 03:07–03:09 — cinq serveurs de BASH › Siège › Serveurs cessent de répondre (coupure du site).
- 03:12 — alerte « SRV-AD2: Hors ligne » (groupe « Toujours actif », donc `critical`).
- 03:21 — Julien Moreau, parti sur le site de BASH pour la coupure, remplace PC-ATELIER-02 et demande la désinstallation de son agent (action restreinte, expire à 03:51) ; Karim approuve à 03:24.

**Alertes** (titres et messages tels que le serveur les produit ; la carte native ajoute la catégorie)

| Heure | Titre serveur | Message serveur | Gravité serveur | Catégorie app | Serveur › Tenant |
|---|---|---|---|---|---|
| 03:12 | SRV-AD2: Hors ligne | Aucun push reçu depuis 4 min. | critical | Hors ligne | BinaryHearts › BASH |
| 03:05 | PC-COMPTA-03: Critique | CPU 98 % (seuil 90 %) | critical | Métrique | BinaryHearts › BASH |
| 02:58 | SRV-DURAND01: Hors ligne | Aucun push reçu depuis 5 min. | critical | Hors ligne | Client Durand › Default |
| 02:47 | BOB01: Alerte | Disque / 94 % (seuil 90 %) | warning | Métrique | BinaryHearts › Default |
| 01:50 | NAS-ATELIER: Alerte | Disque /volume1 91 % (seuil 90 %) | warning | Métrique | Atelier › Default |
| 01:30 | SRV-FILES01: santé disque à surveiller | Disque 1 : 5 secteurs réalloués | warning | Santé disque | BinaryHearts › Default |
| 00:58 | 140: De retour en ligne | — | info | Rétablissement | BinaryHearts › Default |

**Processus de PC-COMPTA-03 (03:06)** : 212 processus · CPU 97 % · 11,4 Go.

| Processus | PID | Utilisateur | CPU | Mémoire |
|---|---|---|---|---|
| EBP.Compta.exe | 7312 | SIEGE\m.durand | 71,4 % | 1,2 Go |
| TiWorker.exe | 5120 | AUTORITE NT\Système | 18,9 % | 410 Mo |
| MsMpEng.exe | 3308 | AUTORITE NT\Système | 4,1 % | 290 Mo |

**Scripts** : « Nettoyer les fichiers temporaires » (PowerShell, 120 s, paramètres « Âge minimum (jours) » et « Inclure le cache des navigateurs »), « Vider le cache DNS » (cmd, 30 s), « Redémarrer le spouleur d'impression » (PowerShell, 60 s), « Forcer gpupdate » (PowerShell), « Purger les journaux journald (> 7 jours) » (bash), « Espace disque détaillé » (bash).

**Planifications** : « Vérif sauvegarde » (tous les jours à 02:00, Siège › Serveurs, 6 appareils, dernier : 5 ✓ 1 ✗) ; « Nettoyage hebdo C: » (dimanche à 03:00, Siège › Comptabilité, 23 appareils, dernier : 21 ✓ 2 ✗).

**Scénarios** : « Déployer Obliview (Windows) » (déclencheur « Agent approuvé », actif, 2 exécutions en cours) ; « Durcissement SSH Linux » (manuel, brouillon).

**Lot de scripts de référence** : « Nettoyer les fichiers temporaires » lancé par Karim à 10:42 sur PC-COMPTA-01, -02, -03 : 01 réussi (code 0, 14 s), 02 réussi (code 0, 11 s), 03 échec (code 1, 4,8 s, « L'accès au chemin d'accès 'C:\Users\m.durand\AppData\Local\Temp\EBP_7312.tmp' est refusé. »).

---

## 5. Spécification détaillée des écrans

Chaque écran précise : rôle, disposition téléphone et tablette, contenu d'exemple, actions, états, sources. Les états standard s'appliquent partout où ils ont un sens :

| État | Modèle | Texte d'exemple |
|---|---|---|
| Chargement | Squelettes à la forme finale (pulsation 1,2 s), jamais de rond plein écran après le premier chargement | — |
| Vide | Icône + une phrase + une action | « Aucun appareil ne correspond à vos filtres. » [Effacer les filtres] |
| Erreur | Carte en ligne, cause courte, [Réessayer] ; « Détails » montre le code HTTP et le chemin | « Le serveur a répondu de façon inattendue. Réessayez. » |
| Hors ligne | Bandeau, cache conservé, actions désactivées avec raison | « Hors ligne — données de 03:02 » |
| Temps réel interrompu | Fine bande ambre sous la barre après 10 s | « Temps réel interrompu — reconnexion… » |
| Session expirée | Feuille S03, jamais un écran cassé | « Votre session a expiré. » |
| Interdit | En ligne, nomme le droit manquant | « Votre équipe n'a pas le droit « Alimentation » sur cet appareil. » |
| Données partielles (non-admin) | Étiquette « Vos appareils » sur les indicateurs calculés côté client | — |

**Règle de rendu selon les droits.** Masquer ce qu'un rôle ne pourra jamais faire (approbations pour un non-admin, actions réservées aux administrateurs de plateforme, protocoles sans rapport avec l'OS, commandes non gérées par l'agent legacy via `agentSupportsCommand`). Montrer mais **désactiver avec la raison** ce que l'état bloque (hors ligne, confidentialité, désinstallation en cours). Les capacités par appareil (`execute`, `remote`, `power`, `files`) ne sont pas exposées aux non-admins : l'action est affichée, et un 403 « Capability 'x' not permitted » est retenu pour la session (« refus appris ») : l'élément affiche ensuite « Non autorisé pour votre équipe ».

**Microtypographie française.** Espace fine insécable avant `%` et les unités (« 97 % », « 16 Go », « 12 Mbit/s »), guillemets « », « il y a 2 h 14 », dates « 25 sept. 14:05 », nombres à chasse fixe (`tnum`). Toute valeur métrique se copie par appui long.

### Accès et socle

#### S00 — Verrouillage
- **Rôle** : verrou biométrique existant, restylé. Au démarrage à froid et après 5 min en arrière-plan.
- **Disposition** : fond `#0B0D1A`, marque Ance centrée 64 dp, « Obliance est verrouillé », bouton **Déverrouiller** ; l'invite biométrique s'ouvre seule ; lien « Utiliser le code de l'appareil ».
- **Contexte** : si le verrou s'affiche après l'appui sur une action de notification, il nomme l'intention : « Déverrouillez pour ouvrir les processus de PC-COMPTA-03 ». Après déverrouillage, l'intention continue sans autre appui.
- **États** : téléphone sans verrouillage d'écran → option désactivée (comme aujourd'hui) ; trois échecs biométriques → code de l'appareil.

#### S01 — Connexion (écran progressif)
- **Rôle** : saisir le serveur une fois, puis se connecter par Obligate ou par un compte local, puis valider la 2FA locale. Les trois étapes vivent sur un seul écran qui se déroule.
- **Téléphone** :
  1. Marque (wordmark sombre, « ance » en blanc). Champ « Adresse du serveur », texte indicatif `obliance.binaryhearts.me`, aide « HTTPS obligatoire », bouton **Continuer**, bouton tonal **Scanner un QR code** (la page profil web affiche `obli-obliance://setup?server=…`).
  2. Une fois validé, le champ se replie en puce « obliance.binaryhearts.me · Changer » et une carte de résultat apparaît : « Obliance 5.1.110 · Connexion Obligate disponible (id.binaryhearts.me) ».
  3. Bouton principal **Se connecter avec Obligate** (si `obligateEnabled`), séparateur « ou », section repliable **Connexion locale** : « Identifiant », « Mot de passe » (remplissage automatique, gestionnaires de mots de passe), **Se connecter**.
  4. Étape 2FA (si `requires2fa`) : contrôle segmenté « Application d'authentification | E-mail », 6 cases (JetBrains Mono 24, focus automatique, envoi automatique au 6e chiffre), puce « Coller 482 913 » si le presse-papiers contient 6 chiffres, **Renvoyer le code** (e-mail, délai 30 s), **Valider**.
- **Tablette** : deux moitiés. Gauche : panneau de marque (dégradé accent 10 % → `#131728`, « Supervision et gestion à distance »). Droite : carte de formulaire de 440 dp.
- **Erreurs** :
  - « Ce serveur ne répond pas comme un serveur Obliance. »
  - « Le certificat HTTPS de ce serveur n'est pas valide. »
  - « Les adresses http:// ne sont pas prises en charge : utilisez https:// »
  - « Aucune connexion réseau. »
  - Obligate injoignable (bandeau) : « Obligate est injoignable pour le moment. Utilisez la connexion locale si votre compte en a une. »
  - 401 : « Identifiant ou mot de passe incorrect. » ; 429 : « Trop de tentatives. Réessayez dans quelques minutes. »
  - Code 2FA refusé : « Code incorrect. Vérifiez que l'heure de votre téléphone est exacte. » (secousse + vibration de rejet).
- **Après succès** : `GET /api/auth/me` puis `GET /api/tenants`.
  - `requires2faSetup` → carte native « Votre organisation impose la double authentification. » puis S90 sur la page profil ; au retour, nouvelle sonde.
  - Utilisateur local avec `enrollmentVersion < 1` → S90 sur `/` (assistant d'accueil).
  - Sinon → S04 au premier lancement, puis S10.
- **Mot de passe oublié** : lien vers S90.
- **Serveurs suivants** : S01 ne sert qu'au premier serveur ; les suivants passent par S93, qui reprend les mêmes étapes.

#### S02 — Connexion Obligate (feuille SSO)
- Feuille WebView plein écran (tablette : dialogue 720 × 640) sur `/auth/sso-redirect`, avec barre native « Obligate · id.binaryhearts.me », barre de progression et **Annuler**.
- Le flux **reste dans la WebView** : `oauthState` vit dans la session, un Custom Tab ne partage pas les cookies.
- Quand la WebView atteint `https://<serveur>/` après `/auth/callback`, l'app intercepte la navigation, ferme la feuille sans jamais afficher l'app web, et lit `connect.sid` dans le `CookieManager` partagé.
- `/login?error=sso_failed` → message natif « La connexion via Obligate a échoué. Réessayez ou utilisez la connexion locale. »

#### S03 — Session expirée
- **Déclencheur** : tout `401 Authentication required`. Feuille par-dessus l'écran courant, jamais une déconnexion.
- **Texte** : « Votre session a expiré » / « Reconnectez-vous pour continuer. Vos écrans restent ouverts. Vos 2 sessions distantes restent actives. »
- **Comportement** : d'abord un **SSO silencieux** (WebView cachée sur `/auth/sso-redirect`, délai 8 s) ; Obligate a souvent encore une session. Sinon, le contenu de S01 s'affiche dans la feuille. Actions : **Se reconnecter**, **Changer de compte**.
- **Après** : la navigation en attente continue ; les lectures sont rejouées ; **une action n'est jamais rejouée automatiquement**, l'utilisateur la confirme à nouveau. Les données en cache restent lisibles sous un bandeau.
- **Plusieurs serveurs** : S03 ne concerne que le serveur actif et nomme le serveur (« Votre session sur Client Durand a expiré ») ; un serveur non actif expiré est signalé dans S81, S92 et À traiter (§2.10).
- **Prévention** : l'app note l'heure du dernier `Set-Cookie`, par serveur. Six jours après, un bandeau apparaît : « Votre session expire demain. Reconnectez-vous maintenant pour ne pas être interrompu pendant l'astreinte. » [Se reconnecter]

#### S04 — Premier lancement
Trois étapes passables, rouvrables depuis S84 :
1. **Notifications** → `POST_NOTIFICATIONS` : « Obliance vous prévient quand un appareil tombe, qu'une approbation vous attend ou qu'un script se termine. »
2. **Astreinte** : tenants couverts, horaire (« Tous les jours 19:00–08:00 »), « Les alertes critiques peuvent ignorer Ne pas déranger » (ouvre le réglage du canal), « Autoriser Obliance à fonctionner en arrière-plan » (exemption d'optimisation de batterie, expliquée : « Sans cela, Android peut retarder vos alertes de plusieurs heures. »), proposition d'ajouter la tuile Réglages rapides.
3. **Verrouillage** : verrou biométrique (activé par défaut) ; « Confirmer les actions sensibles par biométrie » (obligatoire pour T2 et T3).
- **Tablette** : une 4e étape « Clavier et souris » avec un aide-mémoire des raccourcis et un lien vers S88.
- **Migration** : un utilisateur venant de la coquille WebView garde son serveur, son cookie, ses réglages de verrou et le repère d'alertes (même `applicationId`) ; S04 ne montre que les étapes nouvelles.

### À traiter

#### S10 — À traiter
- **Rôle** : l'écran de démarrage. Tout ce qui demande une personne, trié par urgence, traitable sur place.

```
┌────────────────────────────────────────────┐
│ [BH Default · Vue globale ▾] À traiter ⌕ (KB)│
├────────────────────────────────────────────┤
│ (Alertes 7) (Approbations 1) (Enrôlements 1) │
│ [Tous les serveurs ▾] [Tous les tenants ▾] … │
│ ┌ Possible coupure de site ───────────────┐  │
│ │ 5 appareils de BASH › Siège › Serveurs   │  │
│ │ hors ligne entre 03:07 et 03:09. [Voir]  │  │
│ └─────────────────────────────────────────┘  │
│ NON LUES                                     │
│ ▌[BH] CRITIQUE · BASH · 03:12 · il y a 4 min │
│ ▌SRV-AD2 — Hors ligne               [ ◎ ]    │
│ ▌Aucun push reçu depuis 4 min.               │
│ ▌● Toujours hors ligne                       │
│ ▌[BH] CRITIQUE · BASH · 03:05                │
│ ▌PC-COMPTA-03 — Métrique critique   [ ≡ ]    │
│ ▌CPU 98 % (seuil 90 %)                       │
│ ▌● Critique · 97 % en direct                 │
│ …                                            │
├────────────────────────────────────────────┤
│ ⚑ À traiter  ▭ Appareils  ≋ Activité  ▦ Flotte  ⋯ Plus │
└────────────────────────────────────────────┘
```

- **Régions** :
  1. Barre supérieure (§2.2).
  2. Contrôle segmenté avec compteurs en mono : **Alertes** (tous) ; **Approbations** (administrateurs de plateforme ; le demandeur suit ses demandes dans Activité) ; **Enrôlements** (admins ou `agent_config:approval`). Un segment sans droit est masqué.
  3. Puces de filtre : **serveurs** (« Tous les serveurs », puis un par serveur avec sa tuile ; présente dès deux serveurs), périmètre des tenants du serveur actif (« Tous les tenants », « Default », « BASH » ; `/live-alerts/all` couvre toutes les appartenances) et gravité.
  4. **Carte de corrélation** (calculée côté client) : au moins 3 alertes « Hors ligne » du même tenant en moins de 5 min ; groupe résolu depuis le cache d'appareils du tenant concerné. Formulation prudente et horodatée : « Possible coupure de site ». Bouton **Voir les 5** → S20 filtrée.
  5. Liste en sections : « NON LUES » triées par **priorité calculée** puis par heure ; « LUES — DERNIÈRES 24 H » repliée.
- **Priorité calculée (règles, en attendant un champ `category` serveur)** :
  - catégorie déduite du titre serveur : suffixe « : Hors ligne » → Hors ligne ; « : Critique » / « : Alerte » → Métrique ; « santé disque » → Santé disque ; « : De retour en ligne », « : retour à la normale », « santé disque revenue à la normale » → Rétablissement ; « ID agent dupliqué » → Identité ;
  - rang : critique serveur > Hors ligne d'un serveur (OS contenant « Server », ou appareil surveillé) même si le serveur l'a envoyée en `info` > attention > le reste. Une alerte « Hors ligne » d'un poste de travail envoyée en `info` reste en bas et ne réveille personne.
- **Carte d'incident (`IncidentCard`)** :
  - barre de gravité de 3 dp à gauche (critique `#DC2626`, attention `#F59E0B`, info `#3B82F6`, rétablissement `#22C55E`) ;
  - surtitre mono majuscule : [tuile du serveur, dès deux serveurs] gravité · tenant · heure · âge relatif ;
  - titre `titleSmall` : nom de l'appareil — catégorie localisée ; ligne secondaire : message serveur tel quel ;
  - **ligne d'état en direct** : pour les appareils du tenant courant (ou tous en vue globale), tenue à jour par `DEVICE_UPDATED` et `DEVICE_METRICS_PUSHED` : « ● Toujours hors ligne » (pulsation) ou « ● Rétabli à 03:19 » (vert). Autres tenants : « État actuel : ouvrez pour vérifier » ; autres serveurs : « Autre serveur · ouvrez pour vérifier » ;
  - **une action rapide contextuelle** de 48 dp : Hors ligne → **Surveiller** (`circle-dot`) ; CPU ou RAM → **Processus** ; disque → **Scripts** ; santé disque → **Disques** ;
  - les alertes répétées d'un même appareil se regroupent : « 3 alertes · BOB01 » ;
  - **fusion de rétablissement** : quand une alerte de rétablissement arrive pour un appareil qui a une carte critique ou attention non lue, la carte d'origine passe au vert (« Rétabli à 03:19 ») au lieu d'empiler une nouvelle carte ;
  - marqueur non lu : point `#60A5FA` (jamais le rouge de marque).
- **Contenu d'exemple (Alertes)** : les 7 alertes du §4, tous serveurs confondus, dans l'ordre SRV-AD2, PC-COMPTA-03, SRV-DURAND01 (Client Durand), BOB01, NAS-ATELIER (Atelier), SRV-FILES01, 140 ; action rapide respective : Surveiller, Processus, Surveiller, Scripts, Scripts, Disques, aucune.
- **Plusieurs serveurs** : une seule liste triée par priorité calculée, toutes origines confondues ; la carte de corrélation ne mélange jamais deux serveurs ; appui sur une carte d'un autre serveur → bascule implicite (§2.10) ; balayages et « Surveiller » partent vers le serveur de la carte sans bascule ; « Tout marquer comme lu » agit sur **chaque** serveur affiché (un appel par serveur, libellé « Tout marquer comme lu (3 serveurs) »). Un serveur injoignable ajoute en tête une ligne discrète « Atelier injoignable depuis 03:02 — alertes jusqu'à 03:02 » ; un serveur dont la session a expiré : « Session expirée sur Client Durand · Se reconnecter ».
- **Segment Approbations** : carte « Désinstaller l'agent — PC-ATELIER-02 », « Demandé par Julien Moreau · BASH · 03:21 », **anneau d'expiration** « expire dans 27 min » (ambre sous 10 min, rouge sous 3 min), boutons **Refuser** (tonal) et **Examiner** (plein) → S11. Jamais d'approbation depuis la liste.
- **Segment Enrôlements** : « KIOSK-ACCUEIL-02 · Windows 11 IoT Enterprise · clé « Site Siège » · 10.0.3.41 · il y a 12 min », **Refuser** et **Approuver** en ligne ; en-tête **Tout approuver (3)** (T1).
- **Actions** :
  - appui sur une carte → S30 en mode incident (téléphone) ou dans le panneau appareil (tablette) ;
  - balayage vers la droite → **Marquer comme lu** (immédiat, vibration de seuil) ;
  - balayage vers la gauche → **Supprimer**, barre « Alerte supprimée — Annuler » pendant 5 s avant l'appel ;
  - menu : « Tout marquer comme lu (BASH) » (le serveur n'agit que sur le tenant courant, le libellé le dit ; avec plusieurs serveurs, voir ci-dessus), « Effacer les alertes lues » ;
  - appui long → sélection multiple (lu, supprimer). Chaque balayage a une action TalkBack équivalente.
- **Tablette** : liste 380 dp | **panneau appareil intégré** : carte d'alerte, en-tête de S30, contexte d'incident, métriques en direct, actions rapides (Processus, Services, Terminal, Voir l'écran, Redémarrer l'agent). Le technicien agit sans quitter la boîte. Touches : J/K pour naviguer, E pour marquer lu, Entrée pour ouvrir l'appareil complet.
- **États** :
  - vide : trait plat `#1EDD8A` à 30 %, « Rien à traiter. » et « Dernière vérification 03:20 · temps réel actif » ; hors astreinte : « Bonne nuit. » ;
  - hors ligne : « Hors ligne — alertes reçues jusqu'à 03:02 » ; seule l'action « marquer lu » est mise en file ;
  - nouvelles alertes pendant le défilement : pilule « 2 nouvelles alertes » au lieu d'insérer sous le doigt.
- **Sources** : `GET /api/live-alerts/all` (JSON brut), `PATCH /api/live-alerts/:id/read`, `DELETE /api/live-alerts/:id`, `POST /api/live-alerts/read-all`, `GET /api/approvals?limit=50`, `GET /api/devices?approvalStatus=pending`, `POST /api/devices/:id/approve|refuse`, `POST /api/devices/bulk/approve` ; socket `NOTIFICATION_NEW`, `APPROVAL_CREATED`, `APPROVAL_UPDATED`, `DEVICE_APPROVED`, `DEVICE_UPDATED`, `DEVICE_METRICS_PUSHED`.

#### S11 — Détail d'approbation
- **Rôle** : décider sans risque, avant expiration.
- **Disposition** :
  1. En-tête : icône et « Désinstallation d'agent » ; pastille « En attente » ; **anneau d'expiration** et « Expire dans 27:14 » (compte à rebours en direct).
  2. **Demandeur** : avatar, « Julien Moreau (og_julien.moreau) », « 03:21 », puce tenant « BASH ».
  3. **Cible** : ligne d'appareil en direct « PC-ATELIER-02 · Windows 10 Pro 22H2 · ● Hors ligne depuis 3 j · 10.0.14.22 ». Appui → S30 en lecture.
  4. **Ce qui sera exécuté**, en français clair :
     - `device_uninstall` : « L'agent Obliance sera désinstallé. L'appareil disparaîtra de la flotte après 10 min. »
     - `batch_command` : « Redémarrer 12 appareils du groupe Siège › Comptabilité » + liste dépliable.
     - `setting_change` : « Planification « Nettoyage hebdo C: » : contourner le mode confidentialité → activé ».
     - section repliable « Détails techniques » (charge utile formatée).
  5. « Motif (facultatif) » avec puces : « Validé par téléphone », « Hors fenêtre de maintenance », « Mauvaise cible ».
  6. Barre basse : **Refuser** (tonal ; le motif devient obligatoire) et **Approuver** (T2 : invite biométrique « Approuver la désinstallation de l'agent », sous-titre « PC-ATELIER-02 · BASH »).
- **Résultats** :
  - succès : « Approuvée et exécutée à 03:24 » (coche verte) ;
  - 403 propre demande : « Vous ne pouvez pas approuver votre propre demande. » ;
  - 409 : « Déjà traitée par Sophie Martin à 03:23. » (ou par tout autre administrateur) ;
  - 410 : « Cette demande a expiré. » ;
  - 404 autre tenant : « Cette demande concerne le tenant BASH. » + **Basculer et continuer**.
- **Vue demandeur** (depuis Activité) : même écran, un seul bouton **Annuler ma demande**.
- **Sources** : `GET /api/approvals?includeResolved=true`, `POST /api/approvals/:id/approve|deny|cancel`, `APPROVAL_UPDATED`, `GET /api/devices/:id`.

#### S12 — Examen d'enrôlement
- **Rôle** : approuver ou refuser un nouvel agent avec assez de contexte pour ne pas approuver une machine inconnue.
- **Contenu** : nom d'hôte, OS, IP locale et publique avec géolocalisation (« Lyon, FR »), clé API et groupe par défaut (« Clé « Site Siège » → groupe Siège › Accueil »), première apparition, avertissement si `duplicateAgentIdSuspected`, note : « L'approbation déclenche les scénarios « Agent approuvé » de ce tenant. »
- **Actions** : **Approuver** (T1), **Approuver et déplacer vers…** (sélecteur de groupe, puis `PATCH {groupId}` qui déclenche aussi `group_join`), **Refuser** (T1). Depuis une notification, l'authentification de l'appareil est requise.
- **Après** : barre « KIOSK-ACCUEIL-02 approuvé — 2 scénarios déclenchés ».

### Appareils

#### S20 — Liste des appareils
- **Rôle** : trouver vite, voir les problèmes d'abord, sélectionner pour agir en groupe.
- **Téléphone** :
  1. Barre : « Appareils », recherche, **Groupes** (`folder-tree` → S22), filtre (badge = nombre de filtres actifs).
  2. Puces rapides défilantes : « Problèmes d'abord » (tri, actif par défaut), « Hors ligne 16 », « Critique 1 », « Attention 5 », « En attente 3 », « Windows », « Linux », « macOS ». Compteurs de `/devices/summary` pour les admins, calcul local pour les non-admins.
  3. Fil d'Ariane du groupe actif : « BASH › Siège › Serveurs ✕ ».
  4. En-têtes de section collants en surtitre mono : « CRITIQUE · 1 », « ATTENTION · 5 », « HORS LIGNE · 16 », « EN LIGNE · 289 ».
  5. Lignes `DeviceRow` (72 dp confort, 56 dp compact) : tuile OS 36 dp avec point d'état ; nom + icônes de mode (isolement `wifi-off` bleu, confidentialité `shield` orange, étiquette « legacy », mise à jour d'agent `arrow-up`) ; ligne mono « IP · OS · version d'agent » ; mini-barres « CPU 12 % · RAM 61 % · C: 78 % », ou « Hors ligne depuis 03:08 (14 min) » ; pastille d'état à droite. En vue globale, puce de tenant.
- **Lignes d'exemple** :

| Appareil | Ligne mono | Ligne 2 | Pastille |
|---|---|---|---|
| PC-COMPTA-03 | 10.0.12.43 · Windows 11 Pro 23H2 · 4.5.79 | CPU 98 % · RAM 71 % · C: 64 % | Critique |
| BOB01 | 10.20.0.15 · Ubuntu 22.04.4 LTS · 4.5.61 | CPU 6 % · RAM 38 % · / 94 % | Attention |
| SRV-AD2 | 10.0.0.12 · Windows Server 2022 · 4.5.79 | Hors ligne depuis 03:08 (14 min) | Hors ligne |
| KIOSK-ACCUEIL-02 | 10.0.3.41 · Windows 11 IoT Enterprise | En attente d'approbation | En attente |
| 140 | 10.20.0.140 · Debian 12 · 4.5.79 | CPU 4 % · RAM 22 % · / 41 % | En ligne |
| SRV-LEGACY | 10.0.0.30 · Windows Server 2008 R2 · legacy 1.4 | CPU 9 % · RAM 55 % · C: 70 % | En ligne |

- **Actions** :
  - appui → S30 (tablette : volet de détail) ;
  - balayage vers la gauche → **Agir** (ouvre S40 pour cette ligne ; n'exécute rien) ; vers la droite → **Surveiller** ;
  - appui long → sélection multiple ; barre contextuelle « 3 sélectionnés · BASH » avec **Exécuter un script**, **Redémarrer l'agent**, **Plus** (Analyser, Redémarrer, Changer de groupe, Approuver) → aperçu d'impact (§7.7) ;
  - tirer pour actualiser.
- **Tablette** : arbre des groupes (264 dp, repliable avec `[`) | liste 360 dp | détail. Menu contextuel (clic droit ou appui long) : Ouvrir · Terminal · Voir l'écran · Redémarrer l'agent · Copier le nom · Copier l'IP · Épingler · Partager la fiche. Au survol : icônes Terminal, Voir l'écran et ⋮ (équivalent tactile : appui long). Sélection : cases à cocher, Maj+clic, Ctrl+A.
- **Pagination** : admins `pageSize=100` avec défilement infini ; **non-admins `pageSize=2000`** puis pagination locale (le serveur filtre la visibilité après `LIMIT`).
- **Temps réel** : `DEVICE_UPDATED` fusionné en correctif (id = `id ?? deviceId`) ; `DEVICE_METRICS_PUSHED` appliqué aux seules lignes visibles, au plus une recomposition par seconde ; `DEVICE_OFFLINE`, `DEVICE_APPROVED`, `DEVICE_DELETED {id}`. **Le tri ne bouge jamais sous le doigt** : pilule « 3 changements · Actualiser l'ordre ». Une ligne modifiée clignote 600 ms sur la surface active neutre `#222740`.
- **États** : tenant vide « Aucun appareil dans ce tenant. » + **Ajouter un agent (vue web)** ; aucun résultat « Aucun appareil ne correspond à « compta » avec le filtre Hors ligne. » + **Effacer les filtres** ; non-admin « Affichage de vos 64 appareils accessibles ».
- **Sources** : `GET /api/devices` (`search`, `status` y compris `connected`, `disconnected`, `outdated`, `osType`, `groupId` + `includeSubgroups`, `ungrouped`, `tags`, `staleHours`, `pendingUpdates`, `approvalStatus`, `sortBy`, `sortOrder`, `tenantIds`) ; défaut `approvalStatus=approved` sauf choix contraire.

#### S21 — Filtres et tri
- **Téléphone** : feuille pleine hauteur ; **tablette** : feuille latérale ou listes déroulantes en ligne.
- **Sections** : Statut (Tous, Connectés, Déconnectés, Critique, Attention, Hors ligne, En mise à jour, Erreur de mise à jour, Agent obsolète ; choix unique tant que le serveur n'accepte pas de liste) ; Système (type d'OS puis facettes `osName` / `osVersion` avec compteurs) ; Groupe (S22 en mode sélecteur, « Inclure les sous-groupes ») ; Tags (puces avec compteurs) ; Approbation (Approuvés, En attente, Refusés, Suspendus) ; Tenant (vue globale) ; interrupteurs « Sans contact depuis plus de 72 h » et « Mises à jour en attente » ; Tri (Problèmes d'abord, Nom, Dernier contact, CPU, RAM, Disque, Version d'agent).
- **Barre basse** : **Réinitialiser** et **Afficher 12 appareils** (compteur par requête `pageSize=1` pour les admins, local pour les autres). v1.1 : « Enregistrer comme vue… » (S24).
- Les filtres sont mémorisés par tenant.

#### S22 — Arbre des groupes
- Lignes : icône `server`, nom, compteurs cumulés en points mono « Serveurs 6 · ●0 ●0 ●5 » ; chevrons ; « Sans groupe (3) » ; en vue globale, en-têtes de tenant « DEFAULT », « BASH » en surtitre.
- Appui → filtre S20 (avec sous-groupes). Appui long → S23. Création, déplacement, réordonnancement → S90.
- Le serveur n'émet pas d'événements de groupe : l'arbre est rechargé à l'affichage et au tirer-pour-actualiser.

#### S23 — Détail de groupe
- Chemin, compteurs cumulés, appareils (sous-groupes compris), planifications qui ciblent le groupe (depuis `GET /api/schedules`, `targetType=group`).
- Actions : **Exécuter un script sur ce groupe** → S51 ; **Mettre en maintenance** (admin de plateforme, v1.1) ; **Modifier (vue web)**.

#### S24 — Vues enregistrées (v1.1)
- Une vue = nom, filtres, tri, densité, filtre de tenant éventuel. Exemples : « Serveurs hors ligne BASH », « Postes avec MAJ critiques », « Agents legacy ». Vues fournies : « Problèmes », « En attente d'enrôlement », « Surveillés ».
- Stockage local (DataStore, par serveur et utilisateur). Épinglable en raccourci d'écran d'accueil ou en widget.

### Détail d'appareil

#### S30 — Détail d'appareil (cadre)
- **Rôle** : comprendre un appareil et agir dessus. Le cœur de la boucle.

```
┌────────────────────────────────────────────┐
│ ←  PC-COMPTA-03                    ☆   ⋮   │
│    BASH · Siège › Comptabilité             │
├────────────────────────────────────────────┤
│ ▌Alerte 03:05 · Métrique critique           │  bandeau d'incident
│ ▌CPU 98 % (seuil 90 %)  [Marquer lu][Masquer]│
│ ┌ CONTEXTE ─────────────────────────────┐   │
│ │ ⎇ Correctif KB5043145 installé à 02:40 │   │
│ │ ↻ Redémarrage en attente               │   │
│ │ ⚒ Aucune maintenance en cours          │   │
│ └────────────────────────────────────────┘   │
│ (● Critique) (vu à l'instant) ● En direct    │
│ Windows 11 Pro 23H2 · 10.0.12.43            │
│ agent 4.5.79 · ObliReach 1.8.2              │
│ CPU ████████████ 97 %   RAM ████████ 71 %   │
│ C:  ██████ 64 %                             │
│ Aperçu Services Processus Scripts Distant … │
│ … contenu de l'onglet …                     │
├────────────────────────────────────────────┤
│ [>_ Terminal] [▶ Script] [≡ Processus] [Agir]│  barre d'actions
└────────────────────────────────────────────┘
```

- **Régions (téléphone, de haut en bas)** :
  1. **Barre supérieure** : retour ; titre = nom affiché (Rajdhani 24), sous-titre = tenant · chemin du groupe ; **☆ Surveiller** ; menu ⋮ secondaire : Renommer, Note, Copier le résumé, Partager la fiche, Épingler à l'écran d'accueil, Ouvrir dans la vue web, Ouvrir dans Obliview / Obliguard (si lié). **Aucune action d'alimentation ou d'isolement dans ce menu** : elles vivent dans « Agir ».
  2. **Bandeau d'incident** (ouvert depuis une alerte ou une notification) : barre de gravité, titre et heure, **Marquer lu**, **Masquer**.
  3. **Carte de contexte** (avec un incident, ou dès que l'appareil n'est pas sain) : jusqu'à 4 faits, chacun cliquable :
     - voisins : « 4 autres appareils de Siège › Serveurs hors ligne depuis 03:07 » (`GET /api/devices?groupId=…&status=offline&pageSize=50`) ;
     - changements récents (6 h) : « Correctif KB5043145 installé à 02:40 », « Redémarré à 02:14 », localisés à partir de `kind` + `payload` de `GET /api/devices/:id/change-events` ;
     - maintenance : « Maintenance « Patch mardi » active jusqu'à 04:00 » (admins de plateforme, `GET /api/maintenance/effective/device/:id`) ;
     - indicateurs : « Redémarrage en attente », « Planification « Vérif sauvegarde » en échec (code 1) à 02:00 ».
  4. **Bandeaux de mode**, empilés par priorité : désinstallation en cours (compte à rebours « Désinstallation dans 8:42 » + **Annuler**) ; isolement réseau (bleu, « Réseau isolé depuis 03:30 — seul Obliance reste joignable ») ; confidentialité (orange, « Mode confidentialité actif — scripts, accès distant, processus et fichiers verrouillés » + **Déverrouiller**) ; ID d'agent dupliqué (« J'ai compris ») ; agent legacy (« Agent legacy — accès distant et certaines actions indisponibles ») ; note (`description`, par exemple « Intervention en cours — ne pas redémarrer (Karim) »). Déverrouillages actifs : puces « Accès distant · jusqu'à 03:41 ».
  5. **En-tête** : pastille d'état et pastille de dernier contact (couleur selon l'âge : < 5 min vert, < 60 min jaune, < 24 h orange, au-delà rouge) ; « ● En direct » quand les métriques en direct tournent ; ligne OS ; IP locale · publique ; « agent 4.5.79 · ObliReach 1.8.2 » ; « Dernier utilisateur : SIEGE\m.durand » ; tags.
  6. **Bande de métriques** : CPU, RAM, disque principal en barres avec valeurs ; appui → Aperçu.
  7. **Onglets** défilants collants, par fréquence d'astreinte : Aperçu · Services · Processus · Scripts · Distant · Tâches · Inventaire · Réglages ; conditionnels : Mises à jour · Hyper-V · Sauvegardes · Historique · Fichiers · Rewind · Conformité. Un onglet bloqué montre un cadenas et sa raison.
  8. **Barre d'actions basse** (64 dp, la barre de navigation est masquée) — 4 emplacements selon l'état :

| État | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| En ligne Windows | Terminal (PowerShell) | Script | Processus | **Agir** |
| En ligne Linux / macOS | Terminal (SSH) | Script | Services | **Agir** |
| Hors ligne | Surveiller | Maintenance 1 h (admin) ou Historique | Tâches | **Agir** (surtout désactivé, avec raisons) |
| En attente d'enrôlement | Refuser | — | — | **Approuver** |
| Confidentialité verrouillée | Déverrouiller | Services | Tâches | **Agir** |

  Un appui long sur Terminal propose « Invite de commandes » ou « Choisir une session… ». « Agir » est un bouton tonal accent.
- **Appareil en attente** : l'en-tête devient une carte d'approbation (clé, groupe par défaut), avec Refuser / Approuver.
- **Tablette** : deux colonnes. Gauche 360 dp : en-tête, contexte, métriques, **rail d'actions vertical libellé** (mêmes actions, même ordre). Droite : onglets. Large : volet secondaire « Activité en direct » (commandes, exécutions, sessions de cet appareil) ou terminal ancré. Alt+1…9 choisit un onglet ; T terminal, R écran, X script.
- **Fraîcheur** : écran visible → `POST /api/devices/:id/live-metrics {mode:'live', windowSec:60}` renouvelé toutes les 50 s ; arrêt en arrière-plan et, en économie de données, sur réseau mobile. Tirer pour actualiser = rechargement + `{mode:'push_now'}` ; l'en-tête affiche « Mesures demandées… » jusqu'au prochain `DEVICE_METRICS_PUSHED`.
- **États** : 404 « Cet appareil n'existe plus ou vous n'y avez plus accès. » ; autre tenant → §2.3 ; cache « Données de 03:02 — actions indisponibles hors connexion ».
- **Sources** : `GET /api/devices/:id` (pas de `groupName` : le chemin vient de `GET /api/groups`), `POST /api/devices/:id/live-metrics`, `GET /api/devices/:id/change-events`, `GET /api/oblireach/devices` ; socket `DEVICE_UPDATED`, `DEVICE_METRICS_PUSHED`, `COMMAND_UPDATED`, `COMMAND_RESULT`, `CUSTOM_METRIC_UPDATED`, `DISK_HEALTH_UPDATED`.

**Mode incident (artboard « Détail d'alerte »)** : S30 ouvert depuis l'alerte « SRV-AD2: Hors ligne ». Bandeau « Alerte 03:12 · Hors ligne — Aucun push reçu depuis 4 min. » ; carte de contexte : « 4 autres appareils de Siège › Serveurs hors ligne depuis 03:07 » [Voir les 5], « Planification « Vérif sauvegarde » en échec à 02:00 (code 1) », « Aucune maintenance en cours » ; en-tête « ● Hors ligne · vu il y a 14 min » ; bande de métriques grisée « Valeurs au 25/09 03:08 » ; barre d'actions « Surveiller · Historique · Tâches · Agir » ; bouton secondaire « Ouvrir dans Obliview » pour vérifier le lien WAN du site.

#### S31 — Aperçu
Cartes, dans l'ordre :
1. **Maintenant** : CPU « 97 % · 6 cœurs / 12 threads · Intel Core i5-12500 » avec mini-graphe par cœur ; RAM « 11,4 / 16 Go (71 %) » ; disques « C: 64 % · 152 / 237 Go » ; réseau « ↓ 2,4 Mo/s ↑ 310 Ko/s » ; GPU et températures si présents ; note de pic « Pic 99 % depuis 02:58 ».
2. **Mesures personnalisées** : une ligne par mesure avec sa couleur d'état, par exemple « Sauvegarde Veeam — dernière réussite il y a 26 h » (Attention).
3. **Tendance** : segmenté 24 h / 7 j / 30 j en mono ; CPU moyenne et pic, RAM, disques avec delta « C: +4,2 Go en 7 jours ».
4. **Identité** : nom d'hôte, nom affiché, UUID (copier), build, architecture, version d'agent (« 4.5.79 · à jour »), fuseau, localisation.
5. **Réseau** : IP locale, IP publique, MAC (copier). Détail des cartes réseau dans Inventaire.
6. **Cycle de vie** (lecture) : achat, garantie « Dell ProSupport jusqu'au 14/03/2027 », âge, statut.
7. **Automations liées** : « 2 planifications ciblent cet appareil » → S57 filtrée, avec le dernier résultat.
- **Actions contextuelles** : « Voir les processus » sur la carte CPU ; « Nettoyer le disque » sur un disque au-dessus de son seuil (ouvre S51 avec un script suggéré par tag ou catégorie).
- **Tablette** : maçonnerie en 2 colonnes.
- **Sources** : `latestMetrics`, `peakMetrics`, `customMetrics`, `GET /api/devices/:id/metrics/history`, `/custom-metrics`, `GET /api/schedules/for-device/:id`.

#### S32 — Services
- **Rôle** : la correction d'astreinte n° 1, redémarrer un service bloqué.
- **Disposition** : recherche « Filtrer les services » ; segmenté « Tous · En cours · Arrêtés · **Auto. arrêtés** » (services automatiques arrêtés, **par défaut quand l'appareil est en attention ou critique**) ; ligne d'instantané « Liste de 03:14 · Actualiser » ; lignes : nom affiché « Spouleur d'impression », nom technique mono « Spooler », type de démarrage « Automatique », pastille d'état (« Arrêté » en ambre si automatique), menu de ligne **Démarrer / Redémarrer / Arrêter**. Tablette : tableau triable.
- **Exemple Linux** : `nginx.service` (arrêté, activé), `cron.service`, `ssh.service`.
- **Flux (redémarrer)** : T1 « Redémarrer « Spouleur d'impression » sur PC-COMPTA-03 (BASH) ? » → `POST /api/commands {deviceId, type:'restart_service', payload:{name:'Spooler'}}` → suivi de commande dans la ligne « Envoyé → En cours → Redémarré (1,8 s) » → rafraîchissement automatique par `list_services`. **Arrêter** est T2.
- **Raisons de désactivation** : « L'appareil est hors ligne », « Votre équipe n'a pas le droit « Exécution » sur cet appareil ».
- **Sources** : `GET /api/devices/:id/services`, `POST /api/commands` (`list_services`, `start_service`, `stop_service`, `restart_service`), socket `DEVICE_SERVICES_UPDATED`, `COMMAND_UPDATED`. Onglet masqué si l'agent n'a jamais remonté de services.

#### S33 — Processus
- **Rôle** : répondre à « qu'est-ce qui mange le CPU » et le terminer.
- **Disposition** : en-tête « En direct · actualisé toutes les 5 s » avec **Figer** (fige l'affichage sans se désabonner) ; résumé « 212 processus · CPU 97 % · 11,4 Go » ; segmenté « CPU · Mémoire · Nom » ; recherche ; regroupement par nom avec compteur (« chrome.exe × 18 ») ; ligne : nom mono, « PID 7312 · SIEGE\m.durand », barre CPU avec %, mémoire.
- **Exemple** : tableau des processus du §4.
- **Appui sur une ligne** : feuille avec ligne de commande complète, utilisateur, **Terminer le processus** (bouton de danger).
- **Confirmations** : T1 « Terminer EBP.Compta.exe (PID 7312) sur PC-COMPTA-03 (BASH) ? Les données non enregistrées de m.durand seront perdues. » ; **T2** avec l'avertissement « Terminer ce processus peut arrêter ou déstabiliser le système. » pour la liste critique : `lsass.exe`, `csrss.exe`, `wininit.exe`, `services.exe`, `winlogon.exe`, `smss.exe`, `systemd`, `init`, `sshd` (si session SSH).
- **Confidentialité** : « Les processus sont verrouillés par le mode confidentialité. » + **Déverrouiller** (S44).
- **Cycle de vie** : `PROCESS_SUBSCRIBE` quand l'onglet est visible ; `PROCESS_UNSUBSCRIBE` en le quittant, en arrière-plan, ou après 2 min sur réseau mobile en économie de données (« Actualisation en pause (données mobiles) — Reprendre »).
- **Sources** : socket `PROCESS_SUBSCRIBE`, `DEVICE_PROCESSES_UPDATED`, `PROCESS_UNSUBSCRIBE` ; `POST /api/commands {type:'kill_process', payload:{pid, name}}`. **Jamais** `/api/processes/:id/kill`, qui contourne restrictions et confidentialité.

#### S34 — Scripts (appareil)
- Bouton tonal **Exécuter un script** → S50 avec l'appareil présélectionné ; « Récents sur cet appareil » (3 puces : un appui → S51) ; historique : « Nettoyer les fichiers temporaires · manuel · Karim Benali · 10:42 · Échec (code 1) · 4,8 s », « Vérif sauvegarde · planification · 02:00 · Réussi ».
- Sources : `GET /api/executions?deviceId=…&pageSize=50`, socket `EXECUTION_UPDATED`.

#### S35 — Distant
1. **Terminal** : Windows : **PowerShell** (défaut) et **Invite de commandes** ; Linux / macOS : **Shell (SSH)**. Ligne « Session SYSTÈME » ou « Choisir une session utilisateur… » (S61).
2. **Écran (ObliReach)** : « ObliReach 1.8.2 installé · 2 sessions : Console — m.durand (active), RDP-Tcp#3 — a.lefebvre (déconnectée) » → **Voir l'écran** ; sinon **Installer ObliReach** (`install_oblireach`) ; si obsolète « Mise à jour disponible ».
3. **Sessions en cours sur cet appareil** : les miennes **Reprendre** / **Terminer** ; celles des autres (admins) **Terminer** seulement ; l'app ne s'attache jamais au jeton d'une autre personne.
4. **Historique** : 10 dernières sessions (protocole, qui, durée, fin).
- **États désactivés** : legacy « L'accès distant n'est pas disponible avec l'agent legacy (Windows Server 2008 R2). » ; confidentialité : cadenas + **Déverrouiller**.

#### S36 — Tâches
- **Rôle** : vérifier qu'une action a vraiment tourné, ou annuler une commande mise en file par erreur.
- Segmenté « Tout · En cours · Échecs » ; lignes : libellé français, qui, quand, état, durée.
  - « Redémarrer le service Spooler · Karim Benali · 03:17 · Réussi · 1,8 s »
  - « Analyse d'inventaire · en attente (appareil hors ligne) · expire à 03:25 » + **Annuler**
  - « Désinstaller l'agent · en attente d'approbation » (actions ayant reçu un 202, suivies localement)
- Appui → feuille de résultat (stdout, stderr, erreur).
- Sources : `GET /api/commands?deviceId=…&limit=50`, `DELETE /api/commands/:id`, socket `COMMAND_UPDATED`.

#### S37 — Inventaire
- **Puces de saut** : Matériel · Disques · BitLocker · Logiciels · Réseau · Licences.
- **Matériel** : « Intel Core i5-12500 · 6 cœurs / 12 threads · 3,0 GHz » ; mémoire « 2 × 8 Go DDR4 3200 » ; carte mère « Dell Inc. OptiPlex 7010 · N° de série 7FJ2KX3 » (copier) ; BIOS « 1.18.0 (14/03/2025) » ; TPM (depuis `raw`) ; batterie pour les portables ; GPU, imprimantes, ports COM ; clé Windows masquée, révélée par biométrie.
- **Disques (SMART)** : « Disque 0 · Samsung PM9A1 512 Go · NVMe · Bon · 38 °C · usure 4 % » ; sur SRV-FILES01 : « Disque 1 · Seagate Exos 7E8 4 To · HDD · **À surveiller** · 5 secteurs réalloués · 41 213 h ».
- **BitLocker** : « C: · Chiffré à 100 % · Protection activée » + **Afficher la clé de récupération** (S45, T2).
- **Logiciels** : liste recherchable (nom, version, éditeur, date) : « Microsoft 365 Apps · 16.0.17928.20156 · Microsoft », « 214 logiciels ».
- **Réseau** : cartes (type, débit, MAC, adresses). **Licences** : lecture.
- Pied : **Relancer l'inventaire** (T0).
- États : 404 → « Aucun inventaire matériel pour le moment. Lancez une analyse. »

#### S38 — Réglages (allégé)
- « Nom affiché » ; « Note » (`description`, affichée en bandeau sur S30) ; tags (saisie avec suggestions) ; « Déplacer vers… » (`PATCH groupId`, T1) ; « Notifications pour cet appareil » (hors ligne, attention, critique, mises à jour), par exemple pour faire taire un appareil instable depuis son lit.
- Pied : **Plus de réglages (vue web)** (seuils, champs personnalisés, dates d'actif, mot de passe de confidentialité, transfert, suppression).

#### S39 — Onglets secondaires

| Onglet | Version | Périmètre natif | Sources |
|---|---|---|---|
| Mises à jour | v1.1 | Compteurs par gravité ; liste (KB, taille, « redémarrage requis ») ; **Analyser**, **Approuver les critiques**, **Déployer les approuvées (5)** (T2), **Relancer** sur échec | `GET /api/updates?deviceId=` (toujours avec `deviceId`), `POST /api/updates/device/:id/approve\|deploy\|retry/:updateId`, `POST /api/updates/scan/:id` ; suivi par `COMMAND_UPDATED` (aucun événement `UPDATE_*`) |
| Hyper-V | v1.1 | VM : état, vignette, alimentation, « Créer un point de contrôle » ; appliquer / supprimer un point en v2 (sensible) ; console de VM par la visionneuse ObliReach | Routes Hyper-V |
| Sauvegardes (Veeam) | v1.1 | Tâches, dernier résultat, prochaine exécution ; **Démarrer**, **Relancer** ; arrêter / désactiver (sensible) | Routes Veeam |
| Historique | v1.1 | Chronologie des changements (correctifs, scripts, redémarrages, sessions, logiciels) localisée depuis `kind` + `payload` | `GET /api/devices/:id/change-events` |
| Fichiers | v1.1 lecture, v2 écriture | Parcourir, télécharger et partager, aperçu texte ; puis renommer, créer un dossier, supprimer (T2) | socket `FILE_EXPLORER_CMD` / `FILE_EXPLORER_RESULT` |
| Rewind | v2 | Curseur temporel sur CPU/RAM/disque, instantanés de processus et services | `GET /api/devices/:id/rewind/range\|series\|at` |
| Conformité | v2 | Scores par politique (lecture), **Vérifier maintenant** | `GET /api/compliance/results?deviceId=` (garder le plus récent par `policyId`), `POST /api/compliance/check` |

### Garde-fous d'action (écrans du socle)

#### S40 — Feuille « Agir »
- **Rôle** : toutes les actions d'un appareil, au même endroit, à portée de pouce, groupées par intention.
- **En-tête** : « PC-COMPTA-03 · BASH · ● Critique » et « Dernière action : Redémarrer le service Spooler (03:17) ».
- **Groupes** (icône, libellé, conséquence en une ligne) :

| Groupe | Éléments |
|---|---|
| RÉPARER | Exécuter un script… · Redémarrer un service… · Terminer un processus… · Redémarrer l'agent (« L'agent se reconnecte en ~20 s ») |
| ACCÉDER | Terminal PowerShell · Invite de commandes · Terminal SSH · Voir l'écran (ObliReach) |
| ANALYSER | Tout analyser (inventaire, mises à jour, conformité) · Envoyer les mesures maintenant |
| ALIMENTATION | Redémarrer · Mettre en veille · Éteindre (« Aucune remise en marche à distance ») |
| AGENT | Mettre à jour l'agent (4.5.61 → 4.5.79), administrateurs de plateforme |
| MAINTENANCE | Mettre en maintenance 1 h / 2 h / 4 h (admins de plateforme ; techniciens en v1.1 si le serveur l'ouvre) |
| ZONE SENSIBLE (séparée, libellés `#F87171`) | Isoler du réseau · Rétablir le réseau · Désactiver le mode confidentialité · Désinstaller l'agent |

- **Visibilité** : masqué si jamais permis au rôle ou sans rapport avec l'OS ou l'agent ; affiché désactivé avec la raison si l'état bloque ; refus appris après un 403.
- **Vue globale** : ligne « Pour agir sur PC-COMPTA-03, Obliance doit passer sur le tenant BASH. » + **Basculer et continuer**.
- **Tablette** : feuille latérale ancrée au rail d'actions.

#### S41 — Confirmation d'action
Le titre nomme l'action, l'appareil et le tenant ; une ligne mono de contexte (`BASH · Windows 11 Pro 23H2 · 10.0.12.43`) ; le corps énonce la conséquence.

| Action | Palier | Titre | Corps | Suite |
|---|---|---|---|---|
| Redémarrer un service | T1 | « Redémarrer « Spouleur d'impression » sur PC-COMPTA-03 (BASH) ? » | « Les impressions en cours seront interrompues. » | Un appui |
| Redémarrer un appareil | T2 | « Redémarrer PC-COMPTA-03 (BASH) ? » | « Le poste redémarrera immédiatement. 1 utilisateur est connecté (m.durand). » | Biométrie « Confirmer le redémarrage — PC-COMPTA-03 · BASH » |
| Éteindre un serveur | T3 | « Éteindre SRV-AD2 (BASH) ? » | « Obliance ne pourra pas le rallumer à distance. » | Maintenir 1,5 s puis biométrie |
| Isoler du réseau | T2 | « Isoler PC-COMPTA-03 du réseau ? » | « Seul le serveur Obliance restera joignable. Le rétablissement peut exiger l'approbation d'un second administrateur. » | Biométrie |
| Script sur 12 appareils | T3 | « Exécuter « Vider le cache DNS » sur 12 appareils (BASH) ? » | « 2 appareils sont hors ligne et resteront en attente. » | Saisir « 12 », puis biométrie |

- Bouton de danger `#DC2626`, texte blanc, icône `triangle-alert` ; **Annuler** toujours présent ; le bouton de danger n'a jamais le focus par défaut.
- **Accessibilité** : sous TalkBack ou accès par contacteur, le maintien est remplacé par un second bouton « Confirmer définitivement » sans délai.

#### S42 — Vérification 2FA
- **Déclencheur** : `401 {twoFactorRequired:true, action, currentIp}` sur un appel. Le `ActionRunner` suspend l'appel et affiche la feuille (non fermable par appui extérieur).
- **Texte** : « Vérification requise » / « Cette action est protégée. Saisissez le code à 6 chiffres de votre application d'authentification. » (utilisateur SSO : « …le code de votre compte Obligate. »)
- **Composants** : 6 cases, envoi automatique ; **Coller le code** (actif si le presse-papiers contient 6 chiffres) ; case « Ne plus demander depuis cette adresse IP pendant 24 h » avec « IP actuelle : 92.184.107.21 — sur réseau mobile, elle change souvent. »
- **Erreurs** : « Code incorrect. Vérifiez l'heure de votre téléphone. » ; 403 sans TOTP : « Cette action exige la double authentification, qui n'est pas activée sur votre compte. » + **Activer (vue web)**.
- **Mécanique** : renvoi du **même corps JSON** avec `twoFactorCode` (et `trustIp`). Pour une boucle d'actions par appareil, le code saisi est réutilisé tant que le serveur l'accepte ; nouvelle demande au premier refus.

#### S43 — Demande d'approbation envoyée
- **Déclencheur** : `202 {data:{approvalId, status:'pending_approval'}}`.
- **Texte** : « Demande envoyée pour approbation » / « Un second administrateur doit valider « Désinstaller l'agent » sur PC-ATELIER-02 (BASH). La demande expire à 03:51. »
- **Actions** : **Suivre dans Activité**, **Annuler la demande**.
- Le bouton d'origine passe à l'état ambre « En attente d'approbation ». **Jamais de coche de succès pour un 202.**
- Suivi local par `APPROVAL_UPDATED`, puis notification locale : « Votre demande a été approuvée par Sophie Martin et exécutée. » ou « …refusée : « Hors fenêtre de maintenance ». »

#### S44 — Déverrouillage de confidentialité
- **Texte** : « Mode confidentialité actif sur MAC-DIRECTION » / « L'utilisateur a protégé ce poste. Saisissez le mot de passe de confidentialité pour déverrouiller « Accès distant » pendant 15 minutes. »
- **Champs** : puces de fonction (Scripts, Accès distant, Processus, Fichiers ; celle requise présélectionnée) ; mot de passe ; **Déverrouiller**.
- **Après** : puces « Accès distant · jusqu'à 03:41 » sur S30.
- **Sans mot de passe défini** : blocage avec « Seul un administrateur peut désactiver le mode confidentialité. » ; pour un administrateur de plateforme : **Désactiver le mode confidentialité** (T3 + action sensible).
- **Erreurs** : « Mot de passe incorrect. » ; 429 « Trop d'essais. Patientez une minute. » ; 503 « L'appareil est hors ligne. »

#### S45 — Clé de récupération BitLocker
- **Rôle** : dicter une clé à un utilisateur bloqué, au téléphone.
- **Accès** : T2 (biométrie) ; `FLAG_SECURE` toujours actif.
- **Disposition** : « Clé de récupération — C: · PC-COMPTA-03 » ; « ID de la clé : 4E7A2C1B-… » (celui que l'utilisateur voit sur son écran bleu) ; la clé de 48 chiffres en **8 groupes numérotés de 6**, un par ligne, JetBrains Mono 28 sp ; pas à pas « Groupe suivant » qui surligne un groupe à la fois ; **Lire à voix haute** (synthèse vocale chiffre par chiffre, groupe courant) ; **Copier** (presse-papiers sensible, effacé après 60 s).
- **Masquage** : après 2 min ou au passage en arrière-plan. **Jamais** mise en cache sur disque.
- Mention : « Ne communiquez cette clé qu'à l'utilisateur identifié. »

### Scripts et automations

#### S50 — Choix du script
- Recherche « Rechercher un script » ; puces : plateforme (déduite des cibles), catégories, « Favoris » (local), « Récents » ; lignes : nom, badge de rôle, environnement, délai (« Redémarrer le spouleur d'impression · PowerShell · 60 s »).
- **Appui** → feuille d'aperçu : description, paramètres, code replié en mono (« Voir le code »), « Utilisé par 2 scénarios, 1 planification », **Continuer**.
- **Vue globale** : scripts possédés par le maître vus depuis un tenant enfant → cadenas + « Géré par le tenant principal » (exécutables, non modifiables).
- **Tablette** : liste | aperçu.

#### S51 — Préparation de l'exécution
1. Carte du script (**Changer**).
2. Paramètres typés : texte, nombre, interrupteur, **secret** (masqué, jamais mis en cache ni journalisé), liste, liste multiple ; champs requis marqués, valeurs par défaut préremplies.
3. **Cibles** : puces des appareils + **Ajouter** (recherche, groupe « Siège › Comptabilité (23) », vue enregistrée, « Tous les appareils »).
4. **Vérifications préalables** (calculées localement) :
   - « 2 appareils hors ligne — l'exécution restera en attente jusqu'à leur retour et peut expirer. »
   - « BOB01 ignoré : script PowerShell pour Windows. »
   - « MAC-DIRECTION en mode confidentialité — déverrouillage requis. » (appui → S44)
   - « Vous n'avez qu'un accès en lecture à 1 appareil : il a été retiré. » (le serveur exige `rw` sur **toutes** les cibles)
5. Barre basse : **Exécuter sur 3 appareils**.
- **Paliers** : 1 appareil T1 ; 2 à 9 T2 ; 10 et plus T3 (saisie du nombre). Le serveur traite `script.execute_manual` comme sensible par défaut : attendre S42.
- **Réponse** : un 202 porte soit un tableau d'exécutions (→ S52), soit `pending_approval` (→ S43) ; distinction par la forme. 400 « No target devices found » → « Aucun appareil cible valide. »
- **Tablette** : feuille latérale de 420 dp ; la liste d'appareils reste visible et modifiable derrière.

#### S52 — Lot en direct
```
┌────────────────────────────────────────────┐
│ ←  Nettoyer les fichiers temporaires    ⋮  │
│    lancé à 10:42 par vous · BASH           │
│  (◔ 2/3)  ✓ 2  ✗ 1  ⟳ 0  … 0               │
│  La sortie de chaque appareil s'affiche    │
│  à la fin de son exécution.                │
│ [Tous] [Échecs] [En cours] [En file]       │
├────────────────────────────────────────────┤
│ ✓ PC-COMPTA-01   Réussi · code 0 · 14 s  › │
│ ✓ PC-COMPTA-02   Réussi · code 0 · 11 s  › │
│ ✗ PC-COMPTA-03   Échec · code 1 · 4,8 s  › │
│   L'accès au chemin d'accès 'C:\Users\…    │
│   [Ouvrir PowerShell sur PC-COMPTA-03]     │
├────────────────────────────────────────────┤
│ [Relancer sur les échecs (1)] [Partager]   │
└────────────────────────────────────────────┘
```
- **En-tête** : nom du script, « lancé à 10:42 par vous · BASH », **anneau de progression** segmenté (réussi vert, échec rouge, en cours bleu, en file gris) avec « 2/3 » en mono.
- **Lignes** : pas à pas à 4 points (En file → Envoyé → En cours → terminal) ; code, durée, première ligne de sortie ; sur un échec, raccourci **Ouvrir PowerShell sur PC-COMPTA-03**.
- **Honnêteté** : « La sortie de chaque appareil s'affiche à la fin de son exécution. » (le serveur ne diffuse pas la sortie ; `EXECUTION_OUTPUT` n'est jamais émis).
- **Actions** : appui → S53 ; **Arrêter** (en cours), **Annuler** (en file) ; **Relancer sur les échecs** (S51 prérempli) ; **Partager le rapport** (texte).
- **Suivi** : `GET /api/executions/:id` donne `commandQueueId` ; `COMMAND_UPDATED` fait passer « Envoyé » puis « En cours » (`ack_running`) ; `EXECUTION_UPDATED` donne l'état final ; socket coupé → sondage de `GET /api/executions/batches/:batchId` toutes les 5 s tant que l'écran est visible.
- **En quittant** : le lot continue dans Activité ; s'il se termine avec l'app en arrière-plan, notification « Script terminé : 2 réussis, 1 échec ».
- **Tablette** : liste | sortie (S53 intégrée).

#### S53 — Sortie d'exécution
- En-tête : appareil, script, pastille d'état, « code 1 », « 4,8 s », « lancé par Karim Benali à 10:42 ».
- Onglets « Sortie » (stdout) et « Erreurs » (stderr, badge si non vide, sélectionné par défaut en cas d'échec).
- Vue mono 13 sp avec rendu ANSI, retour à la ligne, pincer pour zoomer, recherche, **Copier**, **Partager (.txt)**. « Code exécuté » : instantané du script en lecture. Paramètres affichés, secrets masqués.
- **Jamais persistée** sur disque.

#### S55 — Activité
- **Rôle** : ce qui tourne, ce que j'ai lancé, ce que j'attends, et ce que je peux lancer.
- **Sections** :
  1. **Sessions ouvertes** : « PowerShell · PC-COMPTA-03 · 00:12:40 » **Reprendre** / **Terminer** ; « Ouverte ailleurs » pour les sessions démarrées par vous sur un autre client (seulement **Terminer**).
  2. **En cours** : lots avec anneau de progression, commandes que j'ai lancées non terminées.
  3. **Surveillances** : « SRV-AD2 · en attente du retour en ligne depuis 03:14 » (**Arrêter**).
  4. **Mes demandes d'approbation** (section masquée si vide) : dans la session de Julien, « Désinstaller l'agent — PC-ATELIER-02 · en attente · expire 03:51 ».
  5. **AUTOMATIONS** :
     - Scripts : 3 favoris ou récents en puces, « Tout voir (42) » → S56 ;
     - Planifications : « Vérif sauvegarde · tous les jours à 02:00 · dernier 5 ✓ 1 ✗ », « Nettoyage hebdo C: · dimanche à 03:00 · 21 ✓ 2 ✗ », « Tout voir (14 actives) » → S57 ;
     - Scénarios : « Déployer Obliview (Windows) · Agent approuvé · 2 en cours », « Tout voir » → S58 (v1.1 ; en v1 le lien ouvre la vue web).
  6. **Historique** : lots récents, filtre « Mes exécutions / Toutes ».
- **Bouton flottant étendu** : **Exécuter un script**.
- **Sources** : `SessionManager` local, `GET /api/executions/batches`, `GET /api/remote/sessions?status=active`, magasin local des demandes + `APPROVAL_UPDATED`, `EXECUTION_UPDATED`, `GET /api/schedules`, `GET /api/scenarios`.

#### S56 — Bibliothèque de scripts
- Puces de catégorie, recherche, lignes : nom, icônes de plateforme, environnement (« PowerShell », « bash »), rôle, nombre de paramètres, badge « Système », cadenas « Maître » pour la lecture seule. Tablette : liste | détail (description, paramètres, aperçu du code avec numéros de ligne, usage, code de sortie attendu, délai, « Exécuter en tant que »). Actions : **Exécuter…** → S51 ; **Modifier dans la vue web**.
- Métadonnées mises en cache ; `content` chargé à la demande.

#### S57 — Planifications
- Lignes : nom, cron en français (« Tous les jours à 02:00 »), cibles (« Siège › Serveurs · 6 appareils »), dernier résultat (« 5 ✓ 1 ✗ »), prochaine exécution, **interrupteur** (T1, `PATCH /api/schedules/:id {enabled}`).
- Appui → historique par lot (`GET /api/schedules/:id/history?limit=20`) → sorties par appareil tronquées à 4 000 caractères, avec « Sortie tronquée — export complet dans la vue web ».
- « Exécuter maintenant » → S51 prérempli avec le script, les cibles et les paramètres (il n'existe pas de route « exécuter la planification »).
- Planification du maître vue depuis un tenant enfant : cadenas, interrupteur désactivé, « Géré par le tenant principal ». Historique strictement lié au tenant : depuis la vue globale, l'avis de bascule s'affiche.
- Création et modification → vue web.

#### S58 — Scénarios et exécutions (v1.1)
- Lignes : nom, puces de déclencheurs (« Manuel », « Planifié × 2 », « Agent approuvé »), statut (Actif, Brouillon, Désactivé), exécutions actives.
- Actions : **Activer / Désactiver** (`scripts.execute`) ; **Déclencher sur…** (sélecteur d'appareils → `POST /api/scenarios/:id/start-graph-run {deviceIds}`) ; **Annuler les exécutions** (T2) ; **Modifier** → vue web (l'éditeur de graphe n'est jamais natif).
- Exécution : pas à pas vertical des nœuds (libellé, type, état, code, sortie dépliable), mis à jour par `SCENARIO_NODE_UPDATED`.
- Limite serveur : 50 premiers scénarios ; pied « 50 premiers scénarios affichés » si `total > 50`.

### Accès distant

#### S60 — Terminal (PowerShell, CMD, SSH)
```
┌────────────────────────────────────────────┐
│ ←  PowerShell · PC-COMPTA-03 · BASH  ●  ⚡ ⋮ │
│    SYSTÈME · connecté 00:04:12              │
├────────────────────────────────────────────┤
│ PS C:\Windows\system32> Get-Process |       │
│ >> Sort-Object CPU -Descending |            │
│ >> Select-Object -First 3 Name,Id,CPU       │
│                                             │
│ Name            Id     CPU                  │
│ ----            --     ---                  │
│ EBP.Compta    7312  4312,7                  │
│ TiWorker      5120  1140,2                  │
│ MsMpEng       3308   251,9                  │
│                                             │
│ PS C:\Windows\system32> _                   │
├────────────────────────────────────────────┤
│ Échap Tab Ctrl Alt ↑ ↓ ← → | ~ / -   • ○ ○ │
├────────────────────────────────────────────┤
│               [ clavier IME ]               │
└────────────────────────────────────────────┘
```
- **Téléphone** : bord à bord ; barre compacte : **←** (réduire, la session continue), titre « PC-COMPTA-03 · PowerShell », puce de tenant, sous-titre « SYSTÈME · connecté 00:04:12 » et point d'état ; **⚡ Commandes rapides** ; menu (Copier tout, Coller, Taille du texte, Reconnecter, Terminer la session).
- **Surface** : JetBrains Mono 13 sp (10–20), thème terminal §8.8 ; sélection avec poignées et loupe ; pincer pour zoomer.
- **Barre de touches** au-dessus de l'IME, pages défilantes :
  - page 1 : Échap · Tab · Ctrl · Alt · ↑ ↓ ← → · `|` · `~` · `/` · `-` ;
  - page 2 : Début · Fin · PgPréc · PgSuiv · Inser · Suppr ;
  - page 3 : F1–F12 ;
  - page 4 : ^C · ^D · ^Z · ^L · ^R · Coller ;
  - Ctrl et Alt collants : un appui = touche suivante ; appui long = verrouillé (remplissage accent).
  - **Masquée automatiquement** quand un clavier physique est détecté (`Configuration.hardKeyboardHidden`) ; forçable depuis le menu.
- **Commandes rapides** (locales, par OS, modifiables) : `Get-Service | ? {$_.Status -eq 'Stopped' -and $_.StartType -eq 'Automatic'}`, `systemctl --failed`, `df -h`, `journalctl -p err -b --no-pager | tail -50`. Elles **insèrent** le texte et n'appuient **jamais** sur Entrée.
- **États** :
  - « Connexion au serveur… » ; « En attente de l'appareil (jusqu'à 6 min)… » + **Annuler** ; connecté ;
  - « Session terminée — le shell s'est fermé. » + **Nouvelle session** ;
  - « Connexion perdue. Le shell distant a été fermé ; une commande en cours a pu être interrompue. » + **Rouvrir**, avec le conseil « Pour les commandes longues, utilisez tmux/screen ou un script Obliance. » ;
  - changement Wi-Fi ↔ 4G : « Changement de réseau détecté — la session risque d'être coupée. »
- **Toujours** : `FLAG_SECURE` ; IME sans apprentissage ni suggestions ; notification persistante du service de premier plan ; clavier physique transmis tel quel sauf Ctrl+Maj+C/V (copier/coller), Ctrl+Maj+T/W (nouvel onglet/fermer), Ctrl+Tab (session suivante), Ctrl+= / − / 0 (taille).
- **Tablette** : onglets de sessions comme un navigateur ; ancrage dans le volet secondaire à côté de l'appareil ; terminaux scindés et saisie diffusée en v2.
- **Protocole** : `POST /api/remote/sessions {deviceId, protocol:'powershell'|'cmd'|'ssh', sessionId?}` (201/202/401/403/409/423 gérés par `ActionRunner`) → WS `wss://<serveur>/api/remote/tunnel/<token>` → **rien n'est envoyé avant `{"type":"paired"}`** → premier `resize {cols, rows}` → à la fin `POST /api/remote/sessions/:id/end`.
- **Erreurs** : 409 « Le terminal n'est pas disponible avec l'agent legacy. » ; 403 « Votre équipe n'a pas le droit « Accès distant » sur cet appareil. »

#### S61 — Choix de session
- Titre : « Sur quelle session ouvrir ? »
- Lignes : « Session SYSTÈME (aucun utilisateur) » (défaut pour les shells), « Console — m.durand (active) », « RDP-Tcp#3 — a.lefebvre (déconnectée) ».
- Chargement : « Interrogation des sessions Windows… » (`list_wts_sessions`, priorité haute ; résultat via `COMMAND_UPDATED`). Pour ObliReach : `GET /api/oblireach/devices/:uuid/sessions`.

#### S62 — Visionneuse ObliReach
- **v1 (provisoire)** : la visionneuse web dans une **activité plein écran dédiée**, `FLAG_SECURE`, paysage autorisé, petite étiquette « Visionneuse web ». Elle est déjà tactile (trackpad ou direct, clavier, raccourcis, presse-papiers).
- **v1.1 (natif)** :
  - flux noir en letterbox ; **pilule d'outils flottante** déplaçable, masquée après 3 s (appui sur le bord haut pour la montrer) : infos « PC-COMPTA-03 · m.durand · 24 i/s · 3,1 Mbit/s » ; Clavier · Souris/Trackpad · Ctrl+Alt+Suppr · Raccourcis · Presse-papiers · Écrans · Plus (S63) · Quitter ;
  - **téléphone** : trackpad par défaut (curseur relatif, appui = clic, appui long = clic droit, glisser à deux doigts = défilement, pincer = zoom local jamais transmis) ; suggestion « Tournez le téléphone pour agrandir » ;
  - **tablette** : toucher direct par défaut ; souris en pointeur direct (survol = déplacement, clic droit, molette) ; stylet ; clavier physique envoyé en `code` + `key` ; Échap deux fois pour libérer la capture ; raccourcis internes Ctrl+Alt+Maj+F (plein écran), M (écran suivant), K (outils), Q (terminer) ;
  - zones d'exclusion des gestes système sur les bords gauche et droit ;
  - AZERTY : les caractères AltGr (`@ # € { } [ ] | \ ~`) ne sont pas fiables tant que l'agent n'est pas corrigé ; **Envoyer du texte** (presse-papiers distant puis Ctrl+V) est la voie sûre, signalée une fois.
- **États** : « Connexion à ObliReach… » ; « En attente de l'agent ObliReach… » ; « La session Windows a changé — reconnexion (2/5)… » ; « Aucune image reçue — passage en mode JPEG » ; bandeau d'inactivité « Déconnexion dans 30 s pour inactivité » + **Rester connecté** ; puce « Saisie du poste bloquée ».
- **Retour** = réduire (session dans la pastille ou le dock ; image dans l'image en v1.1). **Terminer** est dans la pilule.
- **Protocole** : `POST /api/remote/sessions {protocol:'oblireach', sessionId}` → WS tunnel (contrôle JSON + trames binaires `[type][charge]`).

#### S63 — Outils ObliReach (v1.1)
Panneau latéral de 320 dp sur tablette, feuille sur téléphone :

| Section | Contenu |
|---|---|
| Écrans | « Écran 1 · 2560 × 1440 », « Écran 2 · 1920 × 1080 » (minicarte sur tablette) |
| Presse-papiers | « Envoyer mon presse-papiers au poste », « Récupérer le presse-papiers du poste », « Envoyer du texte… » |
| Raccourcis système | Win+R · Alt+Tab · Ctrl+Maj+Échap · Win+L · Win+D · Win+E · Ctrl+Alt+Suppr |
| Mode tactile | Direct / Trackpad |
| Qualité | Automatique / Économie de données / JPEG ; codecs décodables par l'appareil |
| Son | Couper |
| Saisie | Bloquer la saisie du poste |
| Capture | Enregistrée dans Images/Obliance |
| Statistiques | Images/s, débit, latence |

### Flotte

#### S70 — Flotte
- **Rôle** : le second coup d'œil. Est-ce global ? Où ?
- **Téléphone (une colonne)** :
  1. **Carte vedette** : « APPAREILS » 312, ↑ 3 vs hier, **ruban de santé** (segments critique → attention → mise à jour → en ligne → hors ligne → en attente, 10 dp de haut). Les segments sont décoratifs ; **les cibles tactiles sont les puces de légende** en dessous (« Critique 1 · Attention 5 · Hors ligne 16 · En attente 3 »), chacune ouvre S20 filtrée.
  2. **Grille d'indicateurs** (appui → S20 filtrée) :

| Indicateur | Valeur | Delta |
|---|---|---|
| En ligne | 289 | ↑ 2 vs hier |
| Hors ligne | 16 | ↑ 5 vs hier (ambre) |
| Critique | 1 | — |
| Attention | 5 | — |
| MAJ en attente | 47 (dont 9 critiques) | ↓ 12 vs semaine (vert) |
| Agents à jour | 293 / 312 | — |

  3. **Attention requise** : les 5 appareils les plus problématiques (`DeviceRow` compact) + **Voir tout**.
  4. **Activité 24 h** : en ligne vs hors ligne par heure (24 h / 7 j / 30 j), ligne verte `#1EDD8A` avec aire, hors ligne en tirets `#828CAF`.
  5. **Disques saturés** : « BOB01 / 94 % », « SRV-FILES01 E: 91 % ».
  6. **Groupes** : cartes de santé « Siège · 94 % en ligne · conformité 91 », etc. ; appui → S23.
  7. **Contexte** : « 2 sessions distantes actives », « 14 planifications dans les 24 h ».
  8. **Par tenant** (vue globale ou utilisateur multi-tenant) : « BASH · 248 appareils · 14 hors ligne · 1 critique », « Default · 64 · 2 hors ligne ». Appui : en vue globale **filtre**, sinon propose « Travailler dans BASH ».
- **Tablette (grille 3 colonnes)** : gauche : carte vedette + attention requise (10) ; centre : indicateurs, mises à jour par gravité, conformité par groupe ; droite : tenants et tendance 30 j.
- **Non-admins** : les agrégats serveur ne sont pas filtrés par visibilité ; indicateurs et attention requise sont **calculés depuis la liste visible**, étiquetés « Vos appareils » ; graphiques masqués.
- **Vue globale** : sondage de `summary` et `group-stats` toutes les 60 s tant que l'écran est visible.
- **Sources** : `GET /api/devices/summary`, `/fleet-hourly?hours=24`, `/fleet-timeseries?days=30`, `/group-stats`, `/disk-saturated?threshold=0`, `/agent-versions`, `GET /api/updates/stats`, `GET /api/devices?sortBy=status&pageSize=5`.

#### S71 — Mises à jour de la flotte (v1.1)
- En-tête : Disponibles · Critiques 9 · Importantes · Approuvées · Installées (30 j) · En échec 3.
- Onglet **Par mise à jour** : titre, gravité, nombre d'appareils touchés ; **Approuver et déployer** (T2) → feuille des appareils touchés.
- Onglet **Par appareil** : `pendingUpdates=true`, tri par état → S39 Mises à jour.
- Onglet **Échecs** : relancer par appareil.
- Sources : `GET /api/updates/stats`, `GET /api/updates/aggregated`, `GET /api/updates/aggregated/:updateUid/devices`, routes d'approbation et de déploiement par appareil.

### Plus

#### S80 — Plus
- Carte de compte : avatar, « Karim Benali », « og_karim.benali · Compte Obligate », puce « [BH] BinaryHearts › Default » (le compte affiché est celui du serveur actif).
- Entrée **Serveurs** (`server`, « 3 serveurs · BinaryHearts actif ») → S92, sous la carte de compte ; avec un seul serveur, elle devient « Serveur · obliance.binaryhearts.me » et mène aussi à S92.
- Sections du §2.8 ; éléments masqués selon le rôle (jamais désactivés) ; badges (approbations en attente, mise à jour de l'app) ; la section « Administration — Vue web » porte l'icône `globe` et l'étiquette « Vue web » sur chaque ligne.

#### S81 — Serveur et tenant
- **Section « Serveurs »** (dès deux serveurs, en tête) : une ligne de 56 dp par serveur : tuile 28 dp, nom, hôte en mono, ligne d'état (« Actif · temps réel connecté », « Vérifié à 03:20 », « Injoignable depuis 03:02 », « Session expirée · Se reconnecter »), alertes non lues (« 5 non lues »), coche sur le serveur actif. Appui → bascule de serveur (§2.10). Dernière ligne : **Gérer les serveurs** → S92.
- Les sections de tenant qui suivent portent le nom du serveur actif : « Tenants de BinaryHearts ». Un serveur à un seul tenant n'a pas de section tenant.
- **Section « Filtrer la vue globale »** (session maître) : puces multi-sélection avec mini-ruban (« BASH 248 · 1 crit. », « Default 64 ») ; **Tous les tenants**.
- **Section « Travailler dans un tenant »** : recherche au-delà de 8 tenants ; lignes « Default » (badge « Vue globale »), « BASH » (rôle en mono) ; point d'état (pire état) ; alertes non lues par tenant (« 5 alertes non lues ») ; coche sur le tenant courant.
- Pied : « Le changement recharge les données et le temps réel. Vos 2 sessions restent ouvertes. » ; avec plusieurs serveurs : « … Les alertes des 3 serveurs continuent d'arriver. »
- **Bascule** : `POST /api/tenant/switch` → « Passage sur BASH… » → reconnexion socket → invalidation des caches → rechargement → vibration de confirmation → barre « Vous travaillez maintenant dans BASH ».
- Erreur 403 : « Vous n'êtes pas membre de ce tenant. »
- **Tablette** : menu ancré de 320 dp depuis le bouton de périmètre du rail (Alt+T ; Alt+1…8 pour passer directement à un serveur).

#### S82 — Recherche et palette
Voir §2.7. Aucun résultat : « Aucun résultat pour « 10.0.0.99 ». La recherche porte sur le nom, les IP, la MAC, l'utilisateur, l'UUID et les tags. » ; multi-tenant : « Passer sur un autre tenant ? ». Hors ligne : recherche dans le cache, « Résultats hors connexion ».

#### S83 — Réglages de l'application
- **Notifications et astreinte** → S84.
- **Sécurité** : verrou biométrique ; délai (immédiat / 1 / 5 / 15 min) ; « Bloquer les captures d'écran partout » (terminal, ObliReach, BitLocker toujours bloqués) ; « Confirmer par biométrie : actions sensibles (obligatoire) / toutes les actions ».
- **Apparence** : Operator / Nuit / Système ; « Nuit automatique de 22:00 à 07:00 » ou avec le mode coucher d'Android ; densité (Auto, Confort, Compacte) ; deuxième ligne des appareils ; taille du terminal ; **mode anonyme** (masque noms d'hôte, IP, MAC et utilisateurs à l'écran, dans les widgets et les notifications).
- **Sessions** : barre de touches auto / toujours / jamais ; mode tactile ObliReach par défaut par format ; codec préféré.
- **Langue** : Français / English / langue du système (langue par app, synchronisée avec `preferredLanguage`).
- **Données** : « Économie de données sur réseau mobile » ; « Vider le cache hors ligne ».
- **Serveurs** : liste des serveurs (tuile, nom, hôte) → S92 ; **Ajouter un serveur** → S93. « Changer de serveur » disparaît : on ajoute, on bascule, on retire.
- **Diagnostic** : exporter des journaux expurgés.

#### S84 — Notifications et astreinte
- **Carte d'acheminement** (une ligne par serveur quand il y en a plusieurs) : v1 « Vérification toutes les 15 min — Android peut retarder les alertes » ; v1.1 « Temps réel : UnifiedPush via ntfy — connecté » ; « Optimisation de batterie : désactivée ✓ ».
- **Astreinte** : interrupteur (aussi tuile Réglages rapides) ; horaire ; tenants couverts ; « Les critiques ignorent Ne pas déranger » ; « Rappeler une alerte critique non lue toutes les 5 min (3 fois max) » ; hors astreinte : « Critiques seulement / Silencieuses / Aucune ».
- **Matrice par catégorie** (Appareils critiques, Appareils en attention, Rétablissements, Approbations, Enrôlements, Automations, Sessions, Compte) : Son / Vibration / Silencieux / Désactivé, reflétant les canaux Android (les réglages système restent la référence).
- **Par serveur** (dès deux serveurs) : une carte par serveur avec sa tuile : « Notifications : toutes / critiques seulement / aucune », tenants couverts (« Default ✓ · BASH ✓ »), « Inclus dans l'astreinte » ; lien vers les réglages Android du **groupe de canaux** du serveur. L'horaire d'astreinte reste commun.
- **Par tenant** (un seul serveur) : « Recevoir les alertes de : Default ✓ · BASH ✓ ».
- **Diagnostic** : « Envoyer une notification de test ».

#### S85 — Profil et sécurité
- Nom affiché, identifiant (préfixe `og_` = « Compte Obligate »), e-mail ; 2FA « Application d'authentification : activée · E-mail : désactivé » (configuration dans la vue web) ; **Adresses IP de confiance** (**Révoquer**, **Tout révoquer**) ; « Session valide jusqu'au 02/10 10:42 » (déduit du dernier `Set-Cookie`) ; applications connectées ; **Gérer le profil (vue web)** ; **Se déconnecter** (URL de déconnexion Obligate d'abord, puis déconnexion locale, puis effacement des caches).

#### S86 — À propos et mises à jour
- Version de l'app, « BinaryHearts · Obliance 5.1.110 » (une ligne par serveur) ; la mise à jour proposée est la plus récente offerte par l'un des serveurs, avec sa source (« Proposée par BinaryHearts ») ; **Rechercher une mise à jour** (programme existant : vérification SHA-256 et signataire) ; notes de version ; licences (Inter, Rajdhani, JetBrains Mono sous OFL ; termlib Apache-2.0 ; libvterm MIT ; OkHttp) ; « Copier le diagnostic » (versions, état du socket et du push ; **jamais** de jetons, d'URL de tunnel, ni de noms d'hôte en mode anonyme).

#### S87 — Supervision (v1.1)
- **Sessions distantes** : actives d'abord (« Julien Moreau · PowerShell · PC-COMPTA-01 (BASH) · depuis 6 min »), puis historique ; **Terminer** (T2).
- **Historique** : chronologie fusionnée (commandes, lots, mises à jour, exécutions de scénarios), reconstituée côté client comme le fait le web (il n'existe pas d'endpoint unifié).
- Les jetons `sessionToken` des événements `REMOTE_*` sont ignorés au décodage.

#### S88 — Raccourcis clavier (tablette, DeX, Chromebook)
- `Ctrl+/` ; aussi publié via `onProvideKeyboardShortcuts` (aide système Méta+/). Contenu : tableau §7.9.

#### S90 — Vue web
Voir §2.8. Erreur de page : « Cette page n'a pas pu être chargée. » [Réessayer].

#### S91 — Applications Obli
- Feuille « Applications Obli » : point coloré et nom (Obliview `#2BC4BD`, Obliguard `#F5A623`, …). Appui : ouvre l'app installée (intent `tools.obli.action.OPEN_URL`), sinon un Custom Tab. Depuis S30 : « Ouvrir dans Obliview » passe le contexte de l'appareil.


#### S92 — Serveurs
- **Rôle** : liste et réglages de chaque serveur. Accès : Plus › Serveurs, S81 › Gérer les serveurs, S83.
- **Liste** : une carte par serveur : tuile 28 dp, nom, hôte (mono), « Obliance 5.1.110 », compte (« og_karim.benali · Obligate » / « karim.benali · compte local »), état (« Actif · temps réel connecté », « Vérifié à 03:20 », « Session expirée »), portée des notifications (« Toutes » / « Critiques seulement »). Poignée pour réordonner (l'ordre donne `Alt+1…8` et l'ordre des puces). Pied : « 3 serveurs sur 8 au plus ». Bouton tonal **Ajouter un serveur** → S93.
- **Détail d'un serveur** (écran poussé ; volet de détail sur tablette) : nom affiché ; couleur (8 pastilles de 48 dp, libellées pour TalkBack : « Fuchsia, sélectionné ») et aperçu de la tuile ; « Recevoir les notifications » (Toutes / Critiques seulement / Aucune) ; « Inclure dans À traiter » ; tenants couverts ; « Ajouter un raccourci sur l'écran d'accueil » ; session (« Valide jusqu'au 29/09 ») et **Se reconnecter** ; **Se déconnecter de ce serveur** ; **Retirer ce serveur** (texte `#F87171` dans le menu de l'écran, T1 : « Retirer Client Durand ? Ses alertes, ses caches et ses raccourcis seront supprimés de ce téléphone. Rien n'est modifié sur le serveur. »).
- **États** : un seul serveur → la liste ne montre que lui, sans poignée ni couleur ; serveur injoignable → « Injoignable depuis 03:02 · Réessayer ».

#### S93 — Ajouter un serveur
- **Rôle** : S01 pour un serveur supplémentaire, sans quitter l'app.
- **Déroulé** : « Adresse du serveur » (QR possible) → sonde `GET /health` et `GET /api/auth/sso-config` → carte « Obliance 5.1.108 · Connexion Obligate disponible (id.binaryhearts.me) » et, si une session Obligate existe déjà, « Votre session Obligate existante sera réutilisée. » → **Nom affiché** (prérempli par le nom de l'instance ou l'hôte), **couleur** (première couleur libre de la palette) et aperçu de la tuile → **Se connecter avec Obligate** ou connexion locale et 2FA (comme S01) → « Atelier est ajouté. Ses alertes arrivent désormais sur ce téléphone. » [Passer sur Atelier] [Rester sur BinaryHearts].
- **Erreurs** : celles de S01, plus « Ce serveur est déjà configuré (BinaryHearts). » et « Vous avez atteint 8 serveurs. Retirez-en un pour en ajouter un autre. »
- **Tablette** : dialogue de 560 dp.
---

## 6. Parcours clés

### F1 — Premier lancement et connexion (Karim, téléphone)

| Étape | Écran | Ce qui se passe | API |
|---|---|---|---|
| 1 | — | Karim scanne le QR de sa page profil web (`obli-obliance://setup?server=https://obliance.binaryhearts.me`) ou installe l'APK depuis `/api/mobile/android/download`. Un utilisateur de la coquille actuelle reçoit l'app native par le programme de mise à jour signé et garde son cookie. | — |
| 2 | S01 | Adresse préremplie ; carte « Obliance 5.1.110 · Connexion Obligate disponible (id.binaryhearts.me) ». **Continuer**. | `GET /api/auth/sso-config`, `GET /health` |
| 3 | S01 → S02 | **Se connecter avec Obligate** : Obligate demande mot de passe et TOTP ; le retour arrive sur `/` ; l'app ferme la feuille et récupère `connect.sid`. | `/auth/sso-redirect`, `/auth/callback` |
| 3′ | S01 (local) | Variante Obligate indisponible : identifiant et mot de passe natifs → `requires2fa` → « Application d'authentification » → 6 chiffres. | `POST /api/auth/login`, `POST /api/profile/2fa/verify` |
| 4 | — | Sonde de session : utilisateur, permissions, tenant courant (Default) ; tenants Default et BASH. | `GET /api/auth/me`, `GET /api/tenants` |
| 5 | S90 (si besoin) | `requires2faSetup` → page profil web après une carte d'explication ; nouvelle sonde au retour. | — |
| 6 | S04 | Notifications, astreinte (« Tous les jours 19:00–08:00 », deux tenants), verrou biométrique, exemption de batterie, tuile Réglages rapides. | — |
| 7 | S10 | Le socket se connecte (anneau de l'avatar vert). La boîte affiche 2 alertes non lues. | Socket.IO avec le cookie en `extraHeaders`, `GET /api/live-alerts/all` |

Objectif : moins de 60 s du lancement à la boîte. Les serveurs Atelier et Client Durand s'ajoutent ensuite par S93 (F9).

### F2 — De l'alerte à la correction (Karim, 03:05, téléphone)

1. **03:05:12** — notification du canal « Appareils critiques » (passe Ne pas déranger car l'astreinte est active ; trois longues vibrations). Titre « CRITIQUE · BASH — PC-COMPTA-03 », texte « Métrique critique : CPU 98 % (seuil 90 %) », actions **Processus** · **Surveiller** · **Marquer lu**.
2. Karim appuie sur **Processus** → S00 « Déverrouillez pour ouvrir les processus de PC-COMPTA-03 » → empreinte.
3. Sa session est sur Default (vue globale) : `locate-device` → l'appareil s'ouvre en vue globale, sans bascule. S30 › Processus : bandeau d'incident ; contexte « Correctif KB5043145 installé à 02:40 · Redémarrage en attente · Aucune maintenance » ; CPU en direct 97 %. Métriques en direct actives, `PROCESS_SUBSCRIBE` envoyé.
4. Tri par CPU : `EBP.Compta.exe` 71,4 %, `TiWorker.exe` 18,9 %. L'application comptable est bloquée.
5. Appui sur la ligne → **Terminer le processus**. La feuille affiche « Pour agir sur PC-COMPTA-03, Obliance doit passer sur le tenant BASH. » → **Basculer et continuer** → T1 « Terminer EBP.Compta.exe (PID 7312) sur PC-COMPTA-03 (BASH) ? Les données non enregistrées de m.durand seront perdues. » → **Terminer**.
6. `POST /api/commands {type:'kill_process', payload:{pid:7312, name:'EBP.Compta.exe'}}` ; suivi « Envoyé → Terminé » ; vibration de confirmation.
7. Environ 6 s plus tard, CPU en direct à 14 % ; barre « CPU revenu à 14 % ». L'alerte serveur « PC-COMPTA-03: retour à la normale » fait passer la carte d'incident au vert.
8. **Marquer lu** sur le bandeau, puis la puce « Revenir à la vue globale ». S10 affiche « Rien à traiter. »

Durée : environ 45 s, d'une main.

**Variante F2b — SRV-AD2 hors ligne (03:12).**
- La carte de corrélation « Possible coupure de site : 5 appareils de BASH › Siège › Serveurs hors ligne entre 03:07 et 03:09 » est déjà visible dans S10.
- Le mode incident de S30 confirme « 4 autres appareils de Siège › Serveurs hors ligne depuis 03:07 ».
- Karim ne tente pas de réparer le serveur : **Surveiller** (notification au retour) et **Ouvrir dans Obliview** pour vérifier le lien WAN du site.

**Variante F2c — action sensible.**
1. Après le retour de SRV-AD2, Karim veut le redémarrer : **Agir › Redémarrer** → S41 T2 « 2 utilisateurs sont connectés » → biométrie.
2. Le serveur répond `401 twoFactorRequired` → S42 ; Karim ouvre son authentificateur, copie le code, revient : **Coller le code** envoie automatiquement. Il laisse « Ne plus demander depuis cette IP » décoché (il est en 4G).
3. `200` ; **Surveiller** est armé automatiquement pour 30 min.
4. L'appareil passe hors ligne puis revient : notification « SRV-AD2 de nouveau en ligne — redémarrage en 2 min 41 s ».

### F3 — Lancer un script sur plusieurs machines et suivre les résultats (Karim, 10:42, téléphone)

1. **Activité › Exécuter un script**, ou dans S20 : appui long sur PC-COMPTA-01, -02, -03 → **Exécuter un script**.
2. S50 : recherche « temp » → « Nettoyer les fichiers temporaires » → aperçu → **Continuer**.
3. S51 : « Âge minimum (jours) » = 7, « Inclure le cache des navigateurs » = oui ; 3 cibles ; vérifications préalables sans alerte.
4. **Exécuter sur 3 appareils** → T2 (biométrie) → `POST /api/scripts/:id/execute`.
5. `401 twoFactorRequired` (`script.execute_manual` sensible) → S42 → code → renvoi du même corps.
6. `202 {data:[3 exécutions]}` → S52 : les lignes passent En file → Envoyé → En cours (`COMMAND_UPDATED`) → Réussi ou Échec (`EXECUTION_UPDATED`). Après 20 s : « Réussi 2 · Échec 1 ».
7. Ligne PC-COMPTA-03 → S53, onglet « Erreurs » : « L'accès au chemin d'accès 'C:\Users\m.durand\AppData\Local\Temp\EBP_7312.tmp' est refusé. » Le fichier est tenu par l'application comptable.
8. Deux suites possibles : **Ouvrir PowerShell sur PC-COMPTA-03** (S60) pour enquêter, ou **Relancer sur les échecs** plus tard.
9. **Partager le rapport** vers Teams : « Nettoyer les fichiers temporaires — 10:42 — 2/3 réussis — PC-COMPTA-03 : fichier temporaire verrouillé par EBP. »
10. S'il avait quitté S52, la notification « Script terminé : 2 réussis, 1 échec » l'y aurait ramené.

**Variante approbation** : si le tenant a rendu `script.execute_manual` restreint, l'étape 6 affiche S43 et la demande est suivie dans Activité.

**Variante tablette (Julien)** : S20 › arbre « Siège › Comptabilité » › puce Windows › Ctrl+A (12) → feuille latérale S51 → T3 (saisir « 12 », puis biométrie) → S52 en liste | sortie.

### F4 — Voir l'écran avec ObliReach (téléphone puis tablette)

**Téléphone (natif, v1.1)** :
1. S30 PC-COMPTA-03 › Distant (ou **Agir › Voir l'écran**) → S61 → « Console — m.durand (active) ».
2. Confidentialité éventuelle → S44 (« Accès distant ») ; vérification 2FA éventuelle → S42.
3. `POST /api/remote/sessions {protocol:'oblireach', sessionId:1}` → WS ouvert tout de suite → « Connexion à ObliReach… » → `paired` → `init {1920×1080, h264}` → première image clé en ~1 s.
4. « Tournez le téléphone pour agrandir » ; mode trackpad.
5. **Clavier** : barre de touches avec Ctrl, Alt, Win, Ctrl+Alt+Suppr. Pour un mot de passe contenant `@` sur un poste AZERTY : **Envoyer du texte**.
6. Changement de session Windows : « La session Windows a changé — reconnexion (1/5)… », nouvelle session créée automatiquement.
7. Retour → réduit dans la pastille (image dans l'image si activée). Plus de 5 min en image dans l'image, ou 10 min d'inactivité côté agent → « Session terminée pour inactivité. »

**Tablette (Julien, clavier et souris)** : clic droit sur PC-COMPTA-03 dans S20 → **Voir l'écran** ; visionneuse dans le volet de détail, F11 plein écran ; toucher direct, souris en pointeur direct ; minicarte des écrans ; le dock garde « PowerShell PC-COMPTA-01 » et « PowerShell PC-COMPTA-03 », Ctrl+Tab pour passer de l'un à l'autre.

**v1** : les mêmes points d'entrée ouvrent la visionneuse web dans son activité dédiée.

### F5 — Ouvrir un shell

**PowerShell sur PC-COMPTA-03 (téléphone)** :
1. S30 → **Terminal** (PowerShell, session SYSTÈME par défaut). Appui long : « Invite de commandes » ou « Choisir une session… » (`list_wts_sessions`).
2. `POST /api/remote/sessions {protocol:'powershell'}` → 201 → WS → « En attente de l'appareil… » → `paired` → `resize` → invite `PS C:\Windows\system32>`.
3. **⚡ Commandes rapides** › « Services automatiques arrêtés », Entrée sur la barre de touches.
4. Karim passe à son authentificateur : le service de premier plan garde la session ; notification persistante « Session PowerShell sur PC-COMPTA-03 ».
5. **←** réduit : la session apparaît dans la pastille, dans Activité « Sessions ouvertes » et en mini-puce sur S30 (« Terminal ouvert · Reprendre »).
6. `exit` : « Session terminée — le shell s'est fermé. » ; le serveur ferme la session.
7. Coupure réseau : état « Connexion perdue » ; **Rouvrir** crée une nouvelle session sur le même appareil et le même protocole.

**SSH sur 140 (Karim, tablette)** : Ctrl+K → « 140 » → Tab vers Actions → « Ouvrir un terminal SSH » → Entrée ; nouvel onglet dans le dock ; `systemctl status nginx`, `journalctl -u nginx -n 50` au clavier physique ; la barre de touches reste masquée.

### F6 — Approuver une demande

**A. Demande à deux (Julien demande, Karim approuve)** :
1. **03:21** — sur le site de BASH, Julien (tablette) lance **Agir › Désinstaller l'agent** sur PC-ATELIER-02 → T3 → `POST /api/devices/:id/uninstall` → `202 pending_approval` → S43 « Demande envoyée pour approbation… La demande expire à 03:51. » Le serveur crée la demande.
2. Téléphones des administrateurs de plateforme (Karim, Sophie) : v1 app ouverte → `APPROVAL_CREATED` → notification locale ; v1 arrière-plan → nécessite l'alerte serveur S1 (§10.12) pour que le sondage la voie ; v1.1 → push. Notification du canal « Approbations » : « Demande d'approbation — Désinstaller l'agent de PC-ATELIER-02 », « Par Julien Moreau · BASH · expire à 03:51 », action unique **Examiner**.
3. Karim : **Examiner** → S00 → S11, anneau « 27:14 ». La demande concerne BASH alors que Karim est sur Default (la route d'approbation est liée au tenant) : l'app bascule automatiquement et l'annonce (« Passé sur BASH pour traiter la demande · Revenir »).
4. Karim lit « L'agent Obliance sera désinstallé… », vérifie la cible (« Hors ligne depuis 3 j »), motif « Poste remplacé », **Approuver** → biométrie « Approuver la désinstallation de l'agent — PC-ATELIER-02 · BASH ».
5. `POST /api/approvals/:id/approve` → « Approuvée et exécutée à 03:24 ». L'entrée d'Activité de Julien passe au vert, avec une notification locale « Votre demande a été approuvée par Karim Benali et exécutée. »
6. Sophie, qui ouvre la même demande une minute plus tard, voit « Déjà traitée par Karim Benali à 03:24. » (409).
7. Autres cas limites : expirée (410), autre tenant (404 → **Basculer et continuer**).

**B. Enrôlement (Nadia, admin du tenant BASH)** :
1. Notification « Nouvel appareil en attente — KIOSK-ACCUEIL-02 (clé « Site Siège ») », actions **Approuver** / **Refuser** (authentification requise). Le serveur ne produit cette alerte qu'avec la modification S1 ; sinon, visible dans S10 › Enrôlements.
2. **Approuver** depuis la notification → authentification → `POST /api/devices/:id/approve`.
3. La notification devient « KIOSK-ACCUEIL-02 approuvé — groupe Siège › Accueil · 2 scénarios déclenchés ».

### F7 — Changer de tenant

**Filtrer la vue globale (Karim sur Default)** : puce de tenant → S81 › Filtrer › BASH → les listes se rechargent avec `tenantIds=4` ; la puce indique « BASH · filtre » ; session et socket inchangés.

**Basculer (Karim, administrateur de plateforme)** :
1. Puce « Default · Vue globale » → S81 › Travailler dans un tenant › « BASH · 5 alertes non lues ».
2. `POST /api/tenant/switch {tenantId:4}` → déconnexion et reconnexion du socket → caches du périmètre remplacés (le cache BASH s'affiche tout de suite s'il existe, puis se rafraîchit) → `GET /api/auth/me` pour les capacités du tenant.
3. Badges et contenus se mettent à jour ; barre « Vous travaillez maintenant dans BASH ». Les sessions ouvertes restent actives et gardent leur puce de tenant.

**Implicite** : une notification ou un lien vers un appareil d'un autre tenant bascule avec annonce et **Revenir** pendant 5 s (hors session maître pour la simple lecture).

**Cohérence web** : les pages S90 s'ouvrent dans le nouveau tenant ; une bascule faite dans une page web est détectée à la fermeture (`/auth/me`) et répercutée.

**Changer de serveur (Karim, trois serveurs)** : puce « [BH] Default · Vue globale » → S81 › Serveurs › « Atelier · Vérifié à 03:20 · 1 non lue » → instantané d'Atelier affiché aussitôt → socket de BinaryHearts fermé, socket d'Atelier ouvert → `GET /api/auth/me` sur Atelier → barre « Vous travaillez maintenant sur Atelier ». La puce devient « [AT] Default ». Revenir sur BinaryHearts rend la vue globale et l'écran laissé ouvert.

### F8 — Session expirée au milieu de la nuit
1. Karim appuie sur une notification ; `GET /api/auth/me` renvoie 401.
2. S03 s'affiche par-dessus l'écran de l'appareil, qui montre les données en cache.
3. **Se reconnecter** → SSO silencieux → Obligate a encore une session → retour en ~2 s.
4. L'écran se rafraîchit ; aucune action n'a été rejouée automatiquement.

La veille, le bandeau « Votre session expire demain » lui avait proposé de se reconnecter.

### F9 — Astreinte sur trois serveurs (Karim, téléphone)

**Mise en place (une fois)** :
1. Plus › Serveurs › **Ajouter un serveur** (S93) → `atelier.binaryhearts.me` → « Obliance 5.1.108 · Connexion Obligate disponible » → nom « Atelier », couleur sarcelle proposée → **Se connecter avec Obligate** : la session Obligate existante est réutilisée, aucune saisie. « Atelier est ajouté. » **Rester sur BinaryHearts**.
2. Idem pour `rmm.durand-associes.fr` : pas d'Obligate → compte local `karim.benali`, mot de passe, code TOTP → « Client Durand », fuchsia. Dans S92 › Client Durand : « Notifications : critiques seulement ».
3. S84 affiche trois cartes d'acheminement et trois groupes de canaux dans les réglages Android.

**La nuit** :
1. **02:58** — notification du groupe « Client Durand », canal « Appareils critiques » : « CRITIQUE · Client Durand › Default — SRV-DURAND01 », « Hors ligne : aucun push reçu depuis 5 min. », actions **Ouvrir** · **Surveiller** · **Marquer lu**. Le serveur actif de l'app est BinaryHearts.
2. Karim appuie sur **Surveiller** → authentification → la surveillance est créée sur Client Durand **sans bascule** ; la notification devient « Surveillance active — prévenu au retour ».
3. **03:12** — SRV-AD2 (BinaryHearts) tombe. Karim ouvre l'app : À traiter montre 7 alertes des trois serveurs, tuiles BH, CD, AT dans les surtitres ; la surveillance de SRV-DURAND01 est listée dans Activité avec la tuile CD.
4. Il traite SRV-AD2 comme en F2b, sur BinaryHearts.
5. **03:31** — « SRV-DURAND01 de nouveau en ligne » (groupe Client Durand). Karim appuie sur la notification → bascule implicite : barre « Passé sur Client Durand pour ouvrir SRV-DURAND01 · Revenir » → S30 sur Client Durand (sous-titre « Client Durand › Default › Serveurs »). Il vérifie l'uptime, puis **Revenir** : retour sur BinaryHearts, à l'écran laissé.
6. L'alerte NAS-ATELIER (attention, 01:50) reste dans À traiter ; elle n'a pas sonné (hors astreinte, attention).

**Cas limites** : Client Durand injoignable (VPN du client coupé) → ligne « Client Durand injoignable depuis 03:02 » en tête d'À traiter, sans notification répétée ; session locale expirée sur Client Durand → une seule notification « Session expirée sur Client Durand », ses cartes grisées, **aucune** feuille S03 tant que Karim reste sur BinaryHearts.

---

## 7. Modèles d'interaction

### 7.1 Gestes

| Geste | Où | Effet |
|---|---|---|
| Appui | Partout | Ouvrir, sélectionner |
| Appui long | Listes | Sélection multiple (vibration `LONG_PRESS`) ; sur une valeur : copier |
| Balayage droite | Carte d'alerte | Marquer comme lu |
| Balayage gauche | Carte d'alerte | Supprimer (annulation 5 s) |
| Balayage gauche | Ligne d'appareil | Révéler **Agir** (ouvre S40, n'exécute rien) |
| Balayage droite | Ligne d'appareil | Surveiller |
| Tirer vers le bas | Listes, S30 | Actualiser ; sur S30, envoie aussi `push_now` |
| Retour prédictif | Partout | Aperçu Android 14+ ; depuis S60 et S62, **réduit** sans terminer |
| Pincer | Terminal, sortie, ObliReach | Taille du texte ; zoom local dans ObliReach (jamais transmis) |
| Glisser à deux doigts | ObliReach | Molette |
| Glisser la poignée | Volets (tablette) | Redimensionner, mémorisé par destination |

**Règles** : un balayage ne déclenche **jamais** de commande distante ni de session ; les approbations et les actions destructrices n'ont pas de balayage ; chaque balayage a une action TalkBack personnalisée et un équivalent dans un menu ; seuil à 40 % de la largeur avec vibration `GESTURE_THRESHOLD_ACTIVATE`.

### 7.2 Feuilles, dialogues, volets

| Usage | Téléphone | Tablette |
|---|---|---|
| Choix (tenant, groupe, session WTS) | Feuille modale basse | Menu ancré ou popover |
| Confirmations (S41, S42, S43, S44) | Feuille basse | Dialogue centré, 480 dp max |
| Formulaires avec contexte (préparation de script, filtres) | Dialogue plein écran | Feuille latérale 400–420 dp, contexte interactif |
| Lectures longues (sortie, charge utile d'approbation) | Écran poussé | Volet de détail |
| Configuration web | Vue web plein écran | Vue web dans le volet de détail |

Barres d'annonce : annulation uniquement pour les opérations locales ou différables (suppression d'alerte, masquage local). Une commande déjà envoyée n'est jamais « annulée » par une barre ; tant qu'elle est `pending`, la barre propose **Annuler la commande** (`DELETE /api/commands/:id`).

### 7.3 Fraîcheur

- Chaque liste porte un **tampon de fraîcheur** mono sous l'en-tête : « En direct » (point vert), « Mis à jour à 03:14 » (gris), « Données de 03:02 » (ambre).
- Les temps relatifs se mettent à jour toutes les 5 s ; quand le socket est coupé, ils deviennent absolus (« à 03:02:31 ») et la bande « Temps réel interrompu — reconnexion… » apparaît après 10 s.
- Tirer sur S30 : `push_now` ; tirer sur Services : `list_services` ; tirer sur Inventaire ne relance **jamais** d'analyse (bouton dédié).

### 7.4 Mises à jour en temps réel

- **Fusionner, ne pas sauter** : une ligne modifiée clignote 600 ms sur `#222740` (neutre, jamais la couleur d'état) ; le point d'état fait un fondu ; les compteurs roulent (`AnimatedContent`, 150 ms).
- **Ordre stable** : rien ne bouge sous le doigt ni pendant le défilement ; pilule « N changements · Actualiser l'ordre ». Réordonnancement automatique seulement en haut de liste après 5 s d'inactivité.
- **Nouvelles cartes** : insérées en haut seulement si la liste est en haut ; sinon pilule « 2 nouvelles alertes ».
- **Plafonds** : métriques de liste ≤ 1 application par seconde ; détail d'appareil au rythme reçu (≈ 3 s en direct) ; processus toutes les 5 s (serveur).
- **Cycle de vie du socket** : connecté tant que l'app est visible **ou** qu'une session distante, un lot ou un suivi d'approbation est actif (service de premier plan) ; déconnecté 30 s après le passage en arrière-plan sinon ; abonnements aux processus et métriques en direct coupés immédiatement en arrière-plan ; au retour, reconnexion et rechargement de l'écran courant (événements manqués).
- **Filtrage** : les événements ne sont pas filtrés par visibilité côté serveur ; l'app les filtre contre l'ensemble d'appareils visibles de l'utilisateur.
- Pas de vibration pour les changements d'arrière-plan.

### 7.5 Suivi de commande (puce en ligne)

Toute action adossée à une commande affiche un suivi à l'endroit où elle a été lancée (ligne, bouton, en-tête), et apparaît dans S36 et dans Activité tant qu'elle tourne. Une puce globale « Actions en cours · 2 » dans la barre supérieure les liste toutes.

| État serveur | Texte | Visuel |
|---|---|---|
| `pending` (agent hors ligne) | « En attente de l'appareil — expire à 03:25 » | Horloge, atténué |
| `pending` / `sent` | « Envoyé » | Point 1 sur 3 |
| `ack_running` | « En cours… » | Indicateur circulaire |
| `success` | « Terminé » ou spécifique (« Redémarré », « Arrêté ») | Coche verte + vibration `CONFIRM` |
| `failure` | « Échec — voir le détail » | Croix rouge + vibration `REJECT` ; appui → feuille de résultat |
| `timeout` | « Sans réponse de l'agent » | Ambre |
| `cancelled` | « Annulé » | Atténué |
| 202 approbation | « En attente d'approbation » | Ambre, horloge |

### 7.6 Échelle de sécurité

| Palier | Expérience | Actions |
|---|---|---|
| **T0** Immédiat | Aucune confirmation ; barre d'annonce si utile | Actualiser, envoyer les mesures, analyses (inventaire, mises à jour, conformité), marquer lu, lister les services, ouvrir un onglet |
| **T1** Confirmer | Feuille compacte qui nomme l'appareil et le tenant (et le serveur, avec sa tuile, dès deux serveurs), un bouton, **sans délai** | Démarrer / redémarrer un service, terminer un processus non critique, redémarrer l'agent, script sur 1 appareil, approuver / refuser un enrôlement, mettre en pause une planification, terminer sa propre session distante, déplacer un appareil de groupe |
| **T2** Confirmer + biométrie | Feuille + BiometricPrompt (biométrie forte ou code de l'appareil) dont le sous-titre nomme l'appareil et le tenant | Arrêter un service, redémarrer, mettre en veille, isoler du réseau, script sur 2 à 9 appareils, déployer des mises à jour, approuver une demande à deux, révéler une clé BitLocker ou Windows, terminer un processus critique, terminer la session d'un autre, annuler des exécutions de scénario |
| **T3** Maintenir + biométrie | Maintien 1,5 s (anneau, vibrations à 25/50/75 %) puis biométrie ; **actions groupées ≥ 10 : saisir le nombre** ; alternative sans délai sous TalkBack | Éteindre, rétablir le réseau (isolement levé), désinstaller l'agent, désactiver le mode confidentialité, actions d'alimentation groupées, script sur 10 appareils ou plus, supprimer un appareil (v2) |

- **Fenêtre de confiance** : 60 s après une biométrie T2 réussie sur le même appareil, les T2 suivantes ne redemandent pas (la feuille indique « Confirmé par empreinte il y a 12 s »). Jamais pour T3 ni pour les actions groupées.
- **Pas de double demande** : une chaîne T2 suivie d'une vérification 2FA compte comme une seule confirmation.
- **Les garde-fous serveur s'ajoutent toujours**, dans l'ordre : `401 twoFactorRequired` → S42 ; `202 pending_approval` → S43 ; `423` → S44 ; `409` legacy, `403` capacité, `503` hors ligne → messages clairs.
- **Plusieurs serveurs** : toute confirmation (S41, invite biométrique, maintien) nomme le serveur dès que deux serveurs sont configurés : « Redémarrer SRV-AD2 (BinaryHearts › BASH) ? ». Une action n'est jamais envoyée à un autre serveur que celui de l'élément.
- **Actions depuis une notification** : T0 ou T1 uniquement, toujours avec `setAuthenticationRequired(true)`. Tout T2 et au-delà ouvre l'écran de l'app. Jamais d'approbation de demande à deux depuis une notification.
- **Hors ligne** : aucune action n'est mise en file, sauf « marquer lu » et la suppression d'une surveillance locale. Jamais d'action rejouée automatiquement après une reconnexion.

### 7.7 Actions groupées

- Entrée par appui long ou « Sélectionner » ; barre supérieure « 5 sélectionnés · BASH », **Tout sélectionner (48)** (tout le résultat de la requête, pas seulement la page chargée), **×**.
- **Un seul tenant par sélection** : en vue globale, une sélection mixte affiche « Les actions s'exécutent dans un seul tenant. Choisissez : BASH (9) · Default (3) ».
- **Aperçu d'impact** avant toute action : « 12 appareils · BASH · 10 en ligne · 2 hors ligne (mis en file) · 1 agent legacy (ignoré) ».
- Exécution : `POST /api/devices/batch` pour les administrateurs de plateforme ; sinon une `POST /api/commands` par appareil (4 en parallèle), avec une seule confirmation agrégée et réutilisation du code 2FA saisi.
- **Résultat** : feuille « Suivi de l'action » par appareil (En file → Envoyé → En cours → Réussi / Échec / Expiré), **Relancer sur les échecs**.

### 7.8 Correspondance des statuts serveur (textes FR)

| Signal serveur | Interface | Texte |
|---|---|---|
| `401 Authentication required` | S03 | « Votre session a expiré. » |
| `401 twoFactorRequired` | S42 | « Vérification requise » |
| `401 Invalid 2FA code` | S42 en ligne | « Code incorrect. » |
| `403` action sensible sans TOTP | Dialogue + lien | « Cette action exige la double authentification, qui n'est pas activée sur votre compte. » |
| `403 Capability 'x' not permitted` | Barre + refus appris | « Votre équipe n'a pas le droit « Alimentation » sur cet appareil. » |
| `403` restreinte sans circuit | Dialogue | « Cette action est restreinte et aucun circuit d'approbation n'est configuré. Contactez un administrateur. » |
| `202 pending_approval` | S43 | « Demande envoyée pour approbation » |
| `404` depuis la vue globale sur une action | Ligne dans la feuille | « Cette action doit être faite depuis le tenant BASH. » + **Basculer et continuer** |
| `409` legacy | Élément désactivé / dialogue | « Non disponible avec l'agent legacy. » |
| `423` confidentialité | S44 | « Mode confidentialité actif — déverrouillage requis. » |
| `503` | Barre | « L'appareil est hors ligne. » |
| `429` | Barre | « Trop de tentatives. Réessayez dans un instant. » |
| HTML au lieu de JSON, `5xx` | État d'erreur | « Le serveur a répondu de façon inattendue. Réessayez. » |
| Réseau | Bandeau hors ligne | « Aucune connexion — affichage des dernières données connues. » |

### 7.9 Clavier et souris (tablette, DeX, Chromebook)

| Contexte | Raccourci | Action |
|---|---|---|
| Global | `Ctrl+K` ou `/` | Recherche et palette |
| Global | `Ctrl+1…5` | À traiter, Appareils, Activité, Flotte, Plus |
| Global | `Alt+T` | Serveur et tenant |
| Global | `Alt+1…8` | Passer sur le serveur n (ordre de S92 ; dès deux serveurs) |
| Global | `Ctrl+F` · `Ctrl+R` / `F5` · `Échap` | Filtrer la liste · actualiser · fermer ou revenir |
| Global | `Ctrl+J` · `Ctrl+/` | Dock des sessions · aide des raccourcis |
| Listes | `↑↓` / `J K` · `Entrée` · `Espace` · `Maj+↑↓` · `Ctrl+A` | Naviguer · ouvrir · sélectionner · étendre · tout sélectionner |
| Listes | `Maj+F10`, touche menu, clic droit | Menu contextuel |
| À traiter | `E` · `Suppr` | Marquer lu · supprimer |
| Détail d'appareil | `Alt+1…9` | Onglets |
| Détail d'appareil | `T` · `R` · `X` · `A` | Terminal · écran · script · feuille « Agir » |
| Terminal | Tout part vers le distant, sauf : `Ctrl+Maj+C / V`, `Ctrl+Maj+T / W`, `Ctrl+Tab`, `Ctrl+= / − / 0` | Copier / coller, onglets, session suivante, taille |
| ObliReach | Tout part vers le distant, sauf `Ctrl+Alt+Maj+F / M / K / Q` et `Échap` × 2 | Plein écran, écran suivant, outils, terminer, libérer le pointeur |

Souris : survol avec infobulles (`TooltipBox`) et `PointerIcon.Hand` ; clic droit = menu contextuel partout ; molette = défilement, `Ctrl+molette` = taille du terminal ; anneau de focus de 2 dp dessiné **uniquement** pour le focus clavier. Toute affordance au survol a un équivalent tactile (appui long, menu ⋮) : en salle serveur, la tablette sert souvent sans clavier ni souris.

### 7.10 Vibrations

| Moment | Retour haptique |
|---|---|
| Seuil de balayage franchi | `GESTURE_THRESHOLD_ACTIVATE` |
| Commande réussie | `CONFIRM` |
| Échec, refus, code faux | `REJECT` |
| Entrée en sélection | `LONG_PRESS` |
| Maintien T3 à 25/50/75 % | `SEGMENT_FREQUENT_TICK` |
| Élément d'un lot terminé | `CLOCK_TICK` (limité) |
| Bascule de tenant | `CONFIRM` |
| Critique arrivant app ouverte | Double impulsion |

Pas de vibration aux changements d'onglet ni aux événements d'arrière-plan. Aucun son dans l'app : le son appartient aux canaux de notification réglés par l'utilisateur.

### 7.11 Accessibilité et langue

- Cibles ≥ 48 dp (touches de la barre du terminal : 44 dp visibles, zone d'appui étendue à 48 dp).
- **L'état n'est jamais porté par la couleur seule** : libellé + point, plus `triangle-alert` (attention) et `circle-alert` (critique) à toutes les tailles de police.
- TalkBack : étiquettes sur chaque bouton icône (« Surveiller SRV-AD2 ») ; une carte d'incident se lit en une phrase (« Critique, BASH, 3 h 12, SRV-AD2 hors ligne, toujours hors ligne ») ; actions personnalisées pour les balayages.
- Police jusqu'à 200 % : valeurs d'indicateurs en taille auto, lignes sur 3 lignes, barre de touches défilante.
- « Supprimer les animations » : pulsations remplacées par un anneau fixe, clignotement de ligne remplacé par un marqueur fixe 3 s, transitions partagées désactivées.
- Aucun motif à délai sans alternative : le maintien T3 a un chemin à deux boutons sous TalkBack ou contacteur.
- **Chaînes** : ressources natives FR (vouvoiement) et EN, pluriels (« 1 appareil », « 3 appareils »), langue par app (`locales_config`). Les titres anglais des événements de changement sont reconstruits depuis `kind` + `payload`. Les titres et messages d'alertes viennent du serveur tels quels (aujourd'hui en français, voir question ouverte Q9).

---

## 8. Langage visuel

### 8.1 Direction : « Console d'opérateur, de nuit »

- **Continuité avec le web** : même famille Obli Operator (thème `obli-operator` du web) : surfaces bleu-noir profondes, accent rouge Obliance, Rajdhani pour l'affichage, Inter pour l'interface, JetBrains Mono pour les données machine.
- **Ce qui rend l'app native et soignée** : profondeur par paliers de surface plutôt que par bordures ; espacements généreux dans la zone du pouce ; surtitres mono qui se lisent comme des étiquettes d'instrument ; mouvement calme ; deux signatures : la **carte d'incident** et le **dock de sessions**.
- **Sombre par défaut**, variante **Nuit** pour les heures d'astreinte. Pas de couleur dynamique (Material You) : la marque prime sur le fond d'écran. Aucun emoji dans l'interface.

### 8.2 Jetons de couleur

**Surfaces et texte**

| Jeton | Operator (défaut) | **Nuit** | Daylight (v2) | Usage |
|---|---|---|---|---|
| `bg` | `#0B0D1A` | `#05060C` | `#E5E9F0` | Fond de page |
| `chrome` | `#0F1220` | `#080A14` | `#ECEFF4` | Barre de navigation, rail, barre supérieure, feuilles de navigation (`--s1` du web) |
| `surface1` | `#131728` | `#0C0F1C` | `#ECEFF4` | Cartes, feuilles, dialogues (`--s2` du web) |
| `surface2` | `#181C30` | `#111526` | `#D8DEE9` | Cartes imbriquées, champs, touches du terminal |
| `hover` | `#1D2238` | `#161A2E` | `#DEE3EC` | Survol, conteneur de pastille, puce de tenant |
| `active` | `#222740` | `#1B2036` | `#D2D9E5` | Ligne sélectionnée, clignotement temps réel, barre d'annonce |
| `divider` | `#2A3048` | `#1E2336` | `#C9D0DC` | Seul séparateur autorisé, au-dessus de la barre d'actions basse |
| `text` | `#F0F4FC` | `#D6DBE8` | `#2E3440` | Texte principal |
| `text2` | `#B4BCD7` | `#9EA6C2` | `#4C566A` | Texte secondaire |
| `textMuted` | `#828CAF` (5,8:1 sur `bg`) | `#7C86A8` (5,6:1) | `#58637A` (5,0:1 sur `bg`) | Métadonnées, surtitres |
| `textFaint` | `#4B5273` | `#3A4060` | `#9AA3B5` | Désactivé **uniquement** |

**Accent Obliance (injecté par flavor)**

| Jeton | Operator | Nuit | Usage |
|---|---|---|---|
| `brand` | `#E03A3A` | `#C23434` | Logo, icônes de marque, indicateur de destination active. Jamais comme fond de bouton avec du texte blanc. |
| `accentFill` | `#C83232` (blanc 5,3:1) | `#C23434` (blanc 5,5:1) | Fond des boutons principaux pleins |
| `accentFillPressed` | `#B41E1E` | `#8E1A1A` | Bouton principal pressé |
| `accent2` | `#FF6868` (6,6:1 sur `chrome`) | `#E25A5A` (5,3:1) | Libellé et icône de destination active, libellé des boutons tonals, anneau de focus, curseur du terminal |
| `accentTonal` | `#FF6868` à 12 % sur `surface1` (≈ `#2C1B2A`) | idem Nuit | Fond des boutons tonals (« Agir ») ; libellé `accent2` à 5,7:1 |

**Couleurs d'état des appareils** (constantes du socle, jamais dérivées de l'accent)

| État | Point / texte | Libellé sur pastille | Pulsation |
|---|---|---|---|
| online | `#4ADE80` | idem | Non |
| offline | `#9CA3AF` | idem | Non |
| warning | `#FACC15` | idem | Oui |
| critical | `#F87171` | idem | Oui |
| pending / updating | `#60A5FA` | idem | updating oui |
| maintenance | `#FB7185` | idem | Non |
| suspended | `#6B7280` (point) | `#A1A8B5` (texte, ≥ 4,5:1 sur sa teinte) | Non |
| pending_uninstall / update_error | `#FB923C` | idem | pending_uninstall oui |

Pastille = couleur à 12 % en fond + libellé de la couleur + point de 8 dp.

**Gravité des alertes** (barre de 3 dp / titre) : critique `#DC2626` / `#EF4444` ; attention `#F59E0B` / `#FBBF24` ; info `#3B82F6` / `#60A5FA` ; rétablissement `#22C55E` / `#4ADE80`.

**Graphiques** : en ligne `#1EDD8A` ; ambre `#F5A623` ; bleu `#4F7BFF` ; hors ligne en tirets `#828CAF` ; grille blanc 5 % ; piste blanc 4 %. En Nuit, graphiques à 70 % d'opacité et pas de halo.

**Danger** : `#DC2626` plein, texte blanc (4,8:1), icône `triangle-alert` ; pressé `#EF4444` ; éléments de menu de danger en texte `#F87171`.

**Deltas** : amélioration `#4ADE80`, dégradation `#FACC15`, neutre `textMuted`, toujours avec une flèche. Jamais le rouge de marque.

**Identité de serveur** (palette fermée, constantes du socle, §2.10) : violet `#A78BFA` · sarcelle `#2DD4BF` · fuchsia `#E879F9` · indigo `#818CF8` · cyan `#67E8F9` · sable `#D6B98C` · lavande `#C4B5FD` · menthe `#5EEAD4`. Aucune n'est proche du rouge de marque, du rouge critique, de l'ambre, du vert ou du bleu d'information ; toutes dépassent 6:1 sur `bg` (indigo 6,5:1, les autres au-delà de 8:1). Elles ne s'emploient **que** dans la tuile monogramme (fond 18 % sur `chrome` opaque, bordure 40 %, lettres pleines ≥ 4,5:1), jamais comme fond de bouton, couleur de texte courant ou indicateur d'état.

**Réglage Material 3** : `surfaceTint = Transparent`, `tonalElevation = 0` partout (pas de teinte rouge sur les surfaces élevées).

### 8.3 Discipline du rouge (règle du design system)

Le rouge Obliance et le rouge « critique » sont proches. Dans une app d'incidents, cette ambiguïté est dangereuse :
1. **Le rouge de marque vit dans le chrome seulement** : destination active (fond tonal 12 % + libellé `#FF6868`), boutons principaux pleins (`#C83232`), anneau de focus, carte vedette, logo.
2. **Dans le contenu (listes, cartes, pastilles), le rouge signifie critique et rien d'autre.** Pas de rouge décoratif : liens et informations en `#60A5FA` / `#4F7BFF`, marqueur non lu en `#60A5FA`, deltas en vert ou ambre.
3. **Le critique ne dépend jamais de la couleur seule** : barre à gauche, `circle-alert`, surtitre « CRITIQUE », point pulsant.
4. **Le danger se distingue par la forme** : `#DC2626` + icône `triangle-alert`, uniquement dans une feuille de confirmation, jamais bouton plein de premier niveau sur un écran normal, jamais focus par défaut. Hors confirmation, le danger est un texte `#F87171` dans un menu.
5. **Actions sur un élément critique** : boutons **tonals**, jamais un bouton accent plein à côté d'une carte critique.
6. **Pas d'élément rouge permanent ou pulsant dans le chrome** (d'où l'abandon du fil d'état).
7. **Sélection** en `#222740`, jamais en rouge.

### 8.4 Typographie

| Rôle | Police | Taille / interligne | Usage |
|---|---|---|---|
| KPI vedette | Rajdhani 600 | 48/48 | Carte vedette de Flotte |
| KPI | Rajdhani 600 | 36/40 | Tuiles d'indicateurs |
| Titre d'écran | Rajdhani 600 | 24/28, +0,025 em | Barre supérieure, nom d'appareil. **Jamais de Rajdhani sous 24 sp.** |
| Titre de dialogue | Inter 600 | 20/28 | Feuilles de confirmation |
| Titre de carte | Inter 600 | 16/24 | En-têtes de carte |
| Titre de ligne | Inter 600 | 16/22 (confort), 14/20 (compact) | Noms d'appareils, titres d'incident |
| Corps | Inter 400 | 14/20 ; 16/24 dans les champs | Texte, formulaires |
| Libellé | Inter 500 | 14/20, 12/16 | Boutons, onglets, pastilles, navigation |
| Surtitre | JetBrains Mono 400 | 11/14, MAJUSCULES, +0,14 em | « CRITIQUE · BASH · 03:12 », libellés de KPI, sections |
| Légende mono | JetBrains Mono 400 | 12/16 | IP, versions, PID, horodatages, deltas |
| Terminal et sortie | JetBrains Mono 400 | 13/19 (réglable 10–20) | S53, S60 |
| Clé BitLocker | JetBrains Mono 500 | 28/36, chiffres tabulaires | S45 |
| Code 2FA | JetBrains Mono 500 | 24/32 | S01, S42 |

Plancher du texte sans empattement : 12 sp. Nombres en Inter avec `tnum`. Polices embarquées (OFL), sans services Google.

### 8.5 Formes, espacements, élévation

- **Rayons** : 6 dp (champs, éléments de menu, tuiles d'icône) ; 8 dp (cartes compactes, puces, boutons de 40–48 dp, piste segmentée) ; 12 dp (cartes, dialogues) ; 14 dp (carte vedette) ; 16 dp (coins hauts des feuilles) ; complet (pastilles, points, avatars).
- **Espacements** : échelle 4 / 6 / 8 / 10 / 12 / 14 / 18 / 20 / 24 / 32. Gouttières 16 dp (téléphone) et 24 dp (tablette). Marge intérieure des cartes 16 dp / 20 dp. Écart entre cartes 12 dp ; entre sections 18 dp. Contenu au-dessus de la barre d'actions : marge basse de 88 dp.
- **Densité** : lignes d'appareil 72 dp (confort, défaut téléphone) ou 56 dp (compact, défaut tablette avec pointeur) ; lignes d'arbre 40 dp visibles dans des zones de 48 dp.
- **Aucune bordure** sur les cartes, pastilles et boutons. Profondeur = `bg` → `surface1` → `surface2` + ombres. États pressés = changement de fond, pas de contour.

| Niveau | Surface | Ombre |
|---|---|---|
| E0 | `bg`, `chrome` | Aucune |
| E1 | Cartes (`surface1`) | `0 6 24 -8` noir 45 % + reflet haut 1 px blanc 3 % |
| E2 | Feuilles, menus, pilules flottantes | `0 -8 32 -8` noir 55 % |
| E3 | Dialogues | `0 12 40 -12` noir 60 % |
| Vedette | Carte vedette de Flotte | E1 + halo accent 20 %, flou 24 dp (désactivé en Nuit) |

### 8.6 Mouvement

- Fondu 150 ms (ease-out) ; feuilles et glissements 200 ms (ease-out) ; axe partagé X pour la navigation poussée (200 ms) ; fondu enchaîné entre destinations (150 ms).
- Insertion en liste 200 ms ; clignotement de ligne 600 ms sur `#222740`.
- Pulsation des points d'état : opacité 1 → 0,5, cycle de 2 s. **Uniquement** sur les points d'état, jamais dans le chrome.
- Transition partagée de la ligne d'appareil vers l'en-tête de S30 (nom et pastille).
- Pas de ressorts rebondissants. Tout est réduit ou coupé sous « Supprimer les animations ».

### 8.7 Iconographie et marque

- Lucide (trait 2, extrémités et jonctions arrondies, grille 24) converti en VectorDrawables dans `core:designsystem`. Tailles : 24 dp navigation, 20 dp barres, 16 dp boutons et onglets, 14 dp en ligne. Couleurs : `textMuted` inactif, `text2` secondaire, `accent2` actif.
- Icônes d'OS comme le web : Windows `monitor`, macOS `apple`, Linux `terminal`, FreeBSD `shield`, autre `monitor`.
- Sécurité : `shield-alert` (distincte de `shield-check` des politiques).
- Marque : icône adaptative Ance sur `#0F1220` et icône monochrome ; marque de 28 dp dans les barres ; wordmark sombre sur S01, rail de tablette et S86. **Le logo n'est jamais recoloré à la couleur d'accent de l'interface.**

### 8.8 Thème du terminal « Obli Operator »

| Emplacement | Couleur | Emplacement | Couleur |
|---|---|---|---|
| Fond | `#080A14` (un cran sous `bg` : le terminal se lit comme un puits) | Texte | `#D6DCEB` (14:1) |
| Curseur | Bloc `#FF6868` clignotant | Sélection | Accent à 30 % |
| noir / noir vif | `#5A6285` (3,3:1) / `#7C86A8` (≥ 5:1) | rouge / rouge vif | `#F87171` / `#FF8A8A` |
| vert / vert vif | `#4ADE80` / `#86EFAC` | jaune / jaune vif | `#FACC15` / `#FDE68A` |
| bleu / bleu vif | `#60A5FA` / `#93C5FD` | magenta / magenta vif | `#C084FC` / `#D8B4FE` |
| cyan / cyan vif | `#22D3EE` / `#67E8F9` | blanc / blanc vif | `#B4BCD7` / `#F0F4FC` |

Les couleurs ConPTY et PSReadLine passent telles quelles ; le « noir vif » (prédictions PSReadLine, sortie atténuée) reste lisible. Une variante Daylight arrive avec le thème clair.

### 8.9 Catalogue de composants (`core:designsystem`, préfixe `Obli`)

| Composant | Anatomie | Socle ou Obliance |
|---|---|---|
| `ObliTopBar` | Puce de périmètre (tuile de serveur + tenant), titre Rajdhani, recherche, avatar avec anneau temps réel ; repli au défilement | Socle |
| `ObliNavigationSuite` | Barre (compacte) ou rail (moyenne et plus), fond `chrome`, badges | Socle |
| `ObliTenantChip` | Fond `hover`, `building-2` 16 dp (remplacé par la tuile du serveur dès deux serveurs), nom, chevron ; variante maître avec micro-badge « Vue globale » ; variante filtre avec point `accent2` 6 dp | Socle |
| `ObliServerTile` | Carré arrondi 20 / 28 dp (rayon 5), fond `chrome` opaque + couleur 18 %, bordure 1 dp 40 %, deux lettres JetBrains Mono 600 ; description TalkBack = nom du serveur ; absent avec un seul serveur | Socle |
| `ServerRow` | Tuile 28 dp · nom · hôte mono · ligne d'état · compteur de non lues · coche ; 56 dp ; utilisé par S81 et S92 | Socle |
| `IncidentCard` | Barre de gravité 3 dp · surtitre mono · titre · message serveur · ligne d'état en direct avec pulsation · action rapide 48 dp · affordances de balayage ; `surface1`, rayon 12 ; marqueur non lu `#60A5FA` | Obliance |
| `ContextCard` | Carte imbriquée `surface2`, surtitre « CONTEXTE », jusqu'à 4 faits avec icône (`git-commit` changement, `network` voisins, `wrench` maintenance, `rotate-ccw` redémarrage), chacun cliquable | Obliance |
| `CorrelationCard` | Carte `surface1`, surtitre « POSSIBLE COUPURE DE SITE », phrase horodatée, bouton tonal « Voir les 5 » | Obliance |
| `DeviceRow` | Tuile OS 36 dp (`hover`) avec point d'état · nom + icônes de mode · ligne mono · mini-barres métriques (3 × 40 × 4 dp, couleur selon seuil) · pastille d'état · actions au survol (tablette) | Obliance |
| `ObliStatusPill` / `ObliStatusDot` | Fond couleur 12 %, libellé `labelMedium`, point 8 dp (6 dp compact) avec pulsation éventuelle ; description TalkBack = libellé | Socle |
| `ObliKpiTile` / `FeaturedKpiCard` | Surtitre, valeur Rajdhani colorée par état, delta mono avec flèche, barre de 4 dp ; vedette avec dégradé accent 10 % et halo | Socle |
| `HealthRibbon` | Barre segmentée 10 dp (problèmes à gauche, écarts 2 dp, rayon 5) + **puces de légende cliquables** (cibles 48 dp) ; résumé TalkBack | Socle |
| `ExpiryRing` | Anneau de compte à rebours 30 min, ambre sous 10 min, rouge sous 3 min, temps restant en mono | Socle |
| `RunProgressRing` | Anneau segmenté réussi / échec / en cours / en file + « 2/3 » en mono | Socle |
| `CommandTracker` | Pas à pas 3 points + libellé, 32 dp de haut (§7.5) | Socle |
| `FreshnessStamp` | Légende mono avec point : vert « En direct », gris « Mis à jour à 03:14 », ambre « Données de 03:02 » | Socle |
| `ActionBar` | 4 emplacements égaux, icône au-dessus du libellé, 64 dp, fond `chrome`, séparateur `divider` ; emplacement 4 « Agir » tonal ; devient rail vertical libellé sur tablette | Socle (contenu Obliance) |
| `ActionSheet` | En-tête d'appareil, groupes avec surtitres, élément = icône + libellé + conséquence, zone sensible séparée | Socle (contenu Obliance) |
| `ConfirmSheet` | Titre (action + cible + serveur › tenant dès deux serveurs), ligne mono de contexte, conséquence, bouton selon palier (simple, biométrie, maintien) | Socle |
| `HoldToConfirmButton` | `#DC2626`, anneau de progression 1,5 s, vibrations à 25/50/75 %, alternative sans délai sous TalkBack | Socle |
| `ObliOtpField` | 6 cases 48 × 56, `surface2`, mono 24, anneau de focus `accent2`, collage | Socle |
| `SessionPill` / `SessionDock` / `SessionTab` | Pastille flottante (téléphone) ; dock 44 dp (tablette) ; onglet = icône de protocole (`square-terminal` / `monitor-play`), appareil, point d'état, tuile du serveur (dès deux serveurs), puce de tenant si différent, fermer ; aperçu au survol ou appui long | Socle |
| `KeyBar` | Touches 44 dp (zone 48 dp) sur `surface2`, libellés mono 13 ; modificateur : éteint / une fois (texte `accent2`) / verrouillé (fond accent + soulignement) ; pages avec points | Socle |
| `ObliOutputView` | Texte mono avec rendu ANSI SGR, numéros de ligne, surlignage de recherche `#FACC15` à 30 % | Socle |
| `ObliBanner` | Pleine largeur, icône à gauche, fond couleur 10 % ; variantes isolement (bleu), confidentialité (orange), planification en échec (orange), désinstallation (orange, compte à rebours), note (gris) | Socle |
| `ObliStateView` | Vide, erreur, hors ligne, interdit, expiré : icône, une phrase, une action | Socle |
| `ObliCard`, `ObliTextField`, `ObliSheet` | Enveloppes qui imposent les jetons (cartes `surface1`, champs sans bordure, teinte transparente) | Socle |

---

## 9. Fonctionnalités propres au mobile

| # | Fonctionnalité | Valeur | Spécification | Version | Travail serveur |
|---|---|---|---|---|---|
| 1 | **Notifications actionnables** | Agir sans ouvrir l'app | Canaux et actions ci-dessous ; `setAuthenticationRequired(true)` sur chaque action ; un rétablissement met à jour la notification d'origine (« Rétabli à 03:19 ») ; regroupement par serveur puis par tenant avec résumé (« BinaryHearts · 5 alertes », « BASH · 5 alertes ») ; un groupe de canaux par serveur ; écran verrouillé : `VISIBILITY_PRIVATE` avec version publique « Alerte critique · BASH » | v1 (sondage) / v1.1 (push) | v1 : alertes d'approbation et d'enrôlement + `category` (S1) ; v1.1 : abonnements push (S6) |
| 2 | **Mode astreinte** | Le bon bruit au bon moment | Horaire, tenants, canal critique autorisé à passer Ne pas déranger, rappels des critiques non lues (5 min, 3 fois, local), silence des autres canaux hors astreinte | v1 | — |
| 3 | **Tuile Réglages rapides « Astreinte »** | Activer l'astreinte depuis le volet ; voir le nombre de critiques | `TileService` : actif = astreinte ; sous-titre « 1 critique » ; appui long → S84 ; `requestAddTileService` proposé dans S04 | v1 | — |
| 4 | **Surveiller un appareil** | Redémarrer, poser le téléphone, être prévenu au retour | Surveillance locale (appareil, condition « de retour en ligne » ou « retour à la normale », expiration 30 min à 4 h), alimentée par les alertes de rétablissement que le serveur produit déjà (« De retour en ligne », « retour à la normale », « santé disque revenue à la normale ») et par le socket ; listée dans Activité ; **armée automatiquement** après un redémarrage ou une extinction | v1 (socket + sondage) / v1.1 (push, instantané) | — |
| 5 | **Service de premier plan pour les sessions** | Les shells survivent au passage par l'authentificateur | Type `specialUse` (distribution hors Play) ; notification « 2 sessions actives » + **Tout terminer** | v1 | — |
| 6 | **Biométrie, presse-papiers sensible, blocage de capture par écran** | Sécurité d'un téléphone perdu ou prêté | §7.6 ; `EXTRA_IS_SENSITIVE` et effacement après 60 s ; `FLAG_SECURE` toujours sur S45, S53, S60, S62 | v1 | — |
| 7 | **Raccourcis d'app** | Deux appuis vers le bon endroit | Statiques : « Rechercher un appareil », « À traiter », « Exécuter un script », « Dernier terminal » ; dynamiques : 4 derniers appareils (avec leur serveur) et un raccourci par serveur (§2.10), dans la limite de 4 dynamiques (serveurs prioritaires) ; épinglés depuis S30 | v1 (statiques, dynamiques) / v1.1 (épinglés) | — |
| 8 | **Partage sortant** | Transmettre à un collègue ou un ticket | Résumé d'appareil en texte, sortie de script (.txt), rapport de lot, commande d'installation d'agent (v1.1) | v1 | — |
| 9 | **Intégration QR** | Un technicien configuré en un scan | La page profil web affiche `obli-obliance://setup?server=…` en QR ; lecteur dans S01 | v1 | Client web |
| 10 | **Clavier physique et souris** | L'établi tablette | §7.9, S88, menus contextuels, pointeurs | v1 | — |
| 11 | **Widgets (Glance)** | État en un coup d'œil | « À traiter » 4 × 2 (compteurs critique, attention, approbations + 3 incidents, appui → S30) ; « Santé de la flotte » 2 × 2 ; mode anonyme respecté ; contenu masqué sur l'écran verrouillé | v1.1 | — |
| 12 | **Image dans l'image ObliReach** | Regarder un redémarrage en faisant autre chose | PiP en quittant la visionneuse ; saisie désactivée ; fermeture après 5 min | v1.1 | — |
| 13 | **Cache hors ligne** | Sous-sols et trains | Liste d'appareils, groupes, alertes (v1) ; 20 derniers détails ouverts (v1.1), par serveur et par tenant, horodatés ; jamais de sortie de script, de clé ni de secret ; effacé à la déconnexion du serveur ou à son retrait | v1 / v1.1 | — |
| 14 | **Multi-fenêtre et glisser-déposer (tablette)** | ObliReach dans une fenêtre, PowerShell dans l'autre ; DeX | `FLAG_ACTIVITY_LAUNCH_ADJACENT` ; chaque fenêtre se lie au `SessionManager` partagé ; glisser un nom d'hôte ou une IP vers une autre app ; glisser un appareil sur un groupe (T1) | v1.1 | — |
| 15 | **App Links** | Liens ntfy, Teams ou e-mail qui ouvrent l'écran natif | Schéma `obli-obliance://open?path=…` toujours valable ; App Links vérifiés seulement si l'hôte est connu à la compilation et que le serveur sert `/.well-known/assetlinks.json` | v1.1 | S9 |
| 16 | **Wear OS** | Voir les critiques au poignet | Relais des notifications seulement ; actions T0/T1 | Gratuit avec la v1 | — |
| 17 | **Validation liée à l'appareil** | Remplacer la saisie TOTP par la biométrie | Clé Keystore par utilisateur et appareil qui signe un défi serveur, accepté comme vérification | v2 | S13 + revue de sécurité |
| 18 | **Mode salle serveur** | Tablette dans une baie | Écran allumé, texte agrandi ; lecture de code-barres ou NFC de n° de série | v2 | S14 |
| — | Écarté | Android Auto (dangereux, pas de catégorie adaptée) ; intents plein écran (restreints depuis Android 14) ; appli Wear dédiée | — | — | — |

**Canaux de notification**

Les canaux ci-dessous existent **une fois par serveur**, dans un groupe de canaux Android au nom du serveur (`NotificationChannelGroup` « BinaryHearts », « Atelier », « Client Durand »). L'utilisateur peut ainsi, dans les réglages système, laisser passer les critiques de BinaryHearts en Ne pas déranger et rendre Client Durand silencieux. Avec un seul serveur, un seul groupe sans nom visible. Le canal « Sessions actives » reste unique (service de premier plan). Identifiants : `<serverId>.<catégorie>` ; retirer un serveur supprime son groupe.

| Canal (FR) | Sources | Importance | Actions |
|---|---|---|---|
| Appareils critiques | Hors ligne d'un appareil serveur ou d'un groupe « Toujours actif », métrique critique, santé disque critique | Haute ; peut passer Ne pas déranger en astreinte | Ouvrir · Surveiller · Marquer lu (+ Processus pour CPU/RAM) |
| Appareils en attention | Métrique en attention, disque, santé disque à surveiller | Normale | Ouvrir · Marquer lu |
| Rétablissements | « De retour en ligne », « retour à la normale » | Basse, silencieuse (met à jour la notification d'origine) | — |
| Approbations | Demande à deux créée | Haute, sensible au temps (« expire à 03:51 ») | Examiner |
| Enrôlements | Nouvel appareil en attente | Normale | Approuver · Refuser |
| Automations | Lot terminé (local) ; échec de planification ou de scénario (serveur, v1.1) | Normale | Voir la sortie |
| Sessions actives | Service de premier plan | Basse, persistante | Tout terminer |
| Compte | Session expirée, mise à jour de l'app | Normale | Se reconnecter · Mettre à jour |

Hors astreinte, une alerte « Hors ligne » d'un poste de travail (gravité serveur `info`) n'émet pas de notification ; elle reste visible dans À traiter.

---

## 10. Architecture technique

### 10.1 Continuité avec la coquille existante

- **Même `applicationId` (`tools.obli.obliance`) et même clé de signature**, `versionCode` supérieur. Les installations actuelles se mettent à jour sur place par le programme signé et **restent connectées** (`CookieManager` conserve `connect.sid`).
- Migration unique : `ShellPrefs` (URL du serveur, réglages du verrou, repère d'alertes, état de la permission de notification) → DataStore ; l'URL du serveur devient le **premier profil** du `ServerRegistry` (nom = hôte, couleur violet), son repère d'alertes devient celui de ce profil.
- **Chaîne d'outils inchangée** : Gradle 9.7, AGP 9.3.1 à **Kotlin intégré 2.2.10** (ne jamais appliquer `org.jetbrains.kotlin.android`), Compose BOM 2026.08.00, compileSdk / targetSdk 37, minSdk 26, JDK 21 (cible JVM 17).
- **Les autres apps Obli gardent la coquille WebView** (leurs flavors) jusqu'à ce qu'elles reçoivent des modules natifs ; la coquille devient un consommateur des mêmes modules `core:*`.
- Réutilisé tel quel puis déplacé dans le socle : `nav/` (Origins, NavigationPolicy, ServerMeta), `net/ServerUrl`, `web/` (WebHost), `bridge/`, `update/`, `alerts/` (parseur et Worker), `lock/`, `notify/`, `core/` (préférences, UA, réinitialisation de session, liens entrants).

### 10.2 Graphe des modules

```
mobile/android/
├── build-logic/                 plugins de convention (android-library, compose, feature, jvm) + contrôle du graphe
├── core/                        ── AGNOSTIQUE : aucun type Obliance ──
│   ├── model/        (JVM)      ServerId, ServerProfile, ServerInfo, ObliUser, Tenant, UserPermissions, LiveAlert, SessionState, nombres tolérants
│   ├── common/       (JVM)      dispatchers, types de résultat, horloge, formats FR/EN, expurgation des journaux
│   ├── designsystem/            ObliTheme (Operator / Nuit / Daylight, accent injecté), jetons, polices, icônes, composants §8.9, thème terminal
│   ├── ui-adaptive/             classes de fenêtre, scènes de volets, dock de sessions, registre de raccourcis, palette
│   ├── navigation/              contrats NavKey, SPI ObliAppModule, routeur de liens, route de vue web
│   ├── network/                 OkHttp 5, CookieManagerJar, enveloppes, ApiOutcome, garde de Content-Type
│   ├── auth/                    ServerRegistry (profils, serveur actif), ServerSession par serveur ; S01–S03, S92–S93 : SSO WebView, connexion locale + 2FA, SSO silencieux, déconnexion, tenants
│   ├── realtime/                RealtimeClient (Socket.IO) du serveur actif, état de connexion, bus d'événements typés, reconnexion au changement de tenant ou de serveur
│   ├── security/                ActionRunner (paliers + garde-fous serveur), BiometricConfirm, S41–S43, SecureWindow, SensitiveClipboard, verrou (S00)
│   ├── notifications/           registre de canaux (un groupe par serveur), publication, actions, astreinte, tuile, moteur de surveillance, AlertsWorker multi-serveurs, sondeur des serveurs non actifs, récepteur UnifiedPush (v1.1)
│   ├── data/                    SnapshotStore (JSON chiffré, espace par serveur), DataStore, politiques de cache, migration ShellPrefs
│   ├── webfallback/             WebHost durci + pont ObliNative, S90
│   ├── updater/                 programme de mise à jour signé existant
│   ├── tunnel/                  TunnelSocket (WS OkHttp, attente de « paired », ping, file bornée)
│   ├── terminal/                SPI TerminalEngine, implémentation termlib, KeyBar, SessionManager, service de premier plan
│   └── testing/                 FakeServer (MockWebServer), faux temps réel, fixtures, aides captures
├── feature/
│   └── reach/                   visionneuse ObliReach (v1.1) ; dépend uniquement de core:tunnel et core:designsystem
├── obliance/                    ── OBLIANCE ──
│   ├── api/                     endpoints, DTO, modèles d'événements socket
│   ├── domain/       (JVM)      Device, DeviceStatus, CommandType, portage de agentSupportsCommand, résolveur de permissions, AlertClassifier, corrélation
│   ├── data/                    dépôts (Devices, Alerts, Groups, Commands, Scripts, Executions, Schedules, Scenarios, Approvals, Remote), DeviceStore, réducteurs
│   ├── triage/                  S10–S12
│   ├── devices/                 S20–S24
│   ├── device-detail/           S30–S45
│   ├── automations/             S50–S58
│   ├── remote/                  S35, S60–S61, lanceur S62
│   ├── fleet/                   S70–S71
│   ├── more/                    S80–S91
│   └── app-module/              OblianceAppModule : destinations, liens, palette, actions de notification, canaux
└── app/                         module application : flavors (table des apps inchangée), graphe, manifeste
                                 flavor obliance → obliance:* ; autres flavors → WebShellModule (comportement actuel)
```

**Règles de dépendance** (plugins de convention + contrôle CI) : `core:*` ne dépend jamais de `obliance:*` ni de `feature:*` ; `feature:reach` ne dépend que du socle (réutilisable par Oblidesk) ; les modules d'écrans Obliance ne se référencent pas entre eux et passent par `obliance:data`, `obliance:domain` et les clés de navigation.

**Injection** : manuelle par constructeur, un `AppGraph` par app (comme les singletons actuels). Pas d'annotation processing en v1. Koin acceptable si le graphe grossit.

### 10.3 Contrat agnostique

**Côté serveur**, le socle attend d'une app Obli : `GET /health` ; `GET /api/auth/sso-config`, `/auth/sso-redirect`, `/auth/callback` ; `POST /api/auth/login` + `POST /api/profile/2fa/verify` ; `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/auth/sso-logout-url` ; tenants optionnels (`GET /api/tenants`, `POST /api/tenant/switch`, localisation d'entité) ; `GET /api/live-alerts/all` (+ lu, suppression) ; `GET /api/oblitools/manifest`, `GET /api/auth/connected-apps` ; `GET /api/mobile/android/{version,download}` ; (nouveau) `POST/DELETE /api/mobile/push/subscriptions` ; l'enveloppe de restriction (`401 twoFactorRequired`, `202 pending_approval`).

**Côté client** :

```kotlin
interface ObliAppModule {
    val appId: String                                              // "obliance"
    val accent: ObliAccent                                         // brand E03A3A, fill C83232, accent2 FF6868
    fun destinations(ctx: AppContext): List<TopDestination>       // libellé, icône, NavKey, flux de badge, visibilité
    fun resolveDeepLink(path: String, ctx: AppContext): DeepLinkTarget? // "/devices/123" → localisation + bascule + pile
    val notificationChannels: List<ChannelSpec>
    fun classifyAlert(alert: LiveAlert, ctx: AppContext): AlertClassification // catégorie, priorité, actions, entité
    fun paletteProviders(): List<PaletteProvider>
    fun webFallbackEntries(ctx: AppContext): List<WebEntry>
    fun realtimeDecoders(): Map<String, (JsonElement) -> AppEvent?>
    fun sessionOpeners(): List<SessionOpener> = emptyList()        // Obliance : shells + ObliReach
    val tenancy: TenancySupport                                    // Obliance : tenant de session + locate/switch
}
```

`AppContext` expose le serveur actif (`ServerProfile`), l'utilisateur, les permissions, le tenant courant, les capacités et la classe de fenêtre.

**Registre des serveurs (socle, `core:auth`)** :

```kotlin
@JvmInline value class ServerId(val value: String)               // UUID local, jamais l'hôte
data class ServerProfile(
    val id: ServerId, val origin: HttpsOrigin, val displayName: String,
    val color: ServerColor, val monogram: String, val order: Int,
    val notify: NotifyScope, val includeInTriage: Boolean, val lastTenantId: Long?,
)
interface ServerRegistry {
    val profiles: StateFlow<List<ServerProfile>>                  // 1..8, ordre utilisateur
    val active: StateFlow<ServerId>
    suspend fun add(origin: HttpsOrigin, name: String, color: ServerColor): ServerProfile // refuse une origine déjà connue
    suspend fun remove(id: ServerId)                              // purge cookies de l'origine, caches, canaux, raccourcis
    suspend fun activate(id: ServerId)
    fun session(id: ServerId): ServerSession                      // client HTTP, état d'auth, API de l'app pour ce serveur
}
```

`ServerSession` porte tout ce qui dépend d'un serveur : base URL, `ApiOutcome` et `ActionRunner` liés à l'origine, état d'authentification, repère d'alertes, instantanés. Les dépôts de l'app sont créés **par `ServerSession`** (un `AppGraph` enfant par serveur, créé paresseusement) ; les écrans ne voient que ceux du serveur actif, sauf l'agrégateur d'À traiter et le moteur de notifications qui itèrent sur tous. Aucun type Obliance dans le registre : Obliview et les autres apps Obli héritent du multi-serveurs. Le `WebShellModule` par défaut renvoie une seule destination (la WebView). Obliview démarrera avec `core:*` + ses modules + un `ObliAppModule` : connexion, périmètre, boîte d'alertes, garde-fous, notifications, mise à jour, vue web, Plus, profil, tunnel et terminal lui sont fournis.

### 10.4 Couche de données

- **HTTP** : OkHttp 5, un seul client ; délais 10 s (connexion) / 20 s (lecture) ; `User-Agent` = UA actuel + ` ObliApp/<version> (obliance; Android)` ; HTTPS uniquement (option « Faire confiance aux autorités installées par l'utilisateur » désactivée par défaut, pour les MSP à AC interne) ; pas de nouvelle tentative automatique sur les POST.
- **Un seul pot à cookies** : `CookieManagerJar : okhttp3.CookieJar` adossé à `android.webkit.CookieManager` (`getCookie`, `setCookie`, `flush`). Appels natifs, poignée de main Socket.IO et vue web partagent une session et un tenant **par origine** : le `CookieManager` indexe par hôte, donc plusieurs serveurs coexistent sans mélange, à condition que deux profils n'aient jamais la même origine (refusé à l'ajout). Obligate (`id.binaryhearts.me`) est partagé par BinaryHearts et Atelier, ce qui permet la réutilisation de session à l'ajout.
- **Garde de Content-Type** : une réponse 200 non JSON sur `/api/*` (le serveur peut renvoyer `index.html`) devient une erreur.
- **Enveloppes déclarées par endpoint** : A `{success, data}`, B `{data}`, brut, 204 sans corps.
- **Sérialisation** : kotlinx.serialization, plugin de compilation 2.2.10 appliqué comme le plugin Compose (preuve en phase 0 ; repli : décodeurs manuels `JsonElement` existants) ; `ignoreUnknownKeys`, `explicitNulls = false`, `coerceInputValues` ; sérialiseurs `LenientDouble` / `LenientLong` (les colonnes `numeric` arrivent en chaînes, par exemple `ramTotalGb: "15.87"`) ; correctifs `DEVICE_UPDATED` décodés en `JsonObject` et fusionnés.
- **Résultat typé** :

```kotlin
sealed interface ApiOutcome<out T> {
    data class Ok<T>(val value: T) : ApiOutcome<T>
    data class Accepted<T>(val value: T) : ApiOutcome<T>                  // 202 avec charge (scripts/execute : tableau)
    data class PendingApproval(val approvalId: Long) : ApiOutcome<Nothing>
    data class StepUpRequired(val action: String?, val currentIp: String?) : ApiOutcome<Nothing>
    data class PrivacyLocked(val feature: String?, val passwordSet: Boolean) : ApiOutcome<Nothing> // 423
    data class Unsupported(val reason: String) : ApiOutcome<Nothing>     // 409 legacy
    data class Forbidden(val reason: ForbiddenReason, val message: String) : ApiOutcome<Nothing> // capacité, pas de TOTP, pas de circuit
    data class AgentOffline(val message: String) : ApiOutcome<Nothing>   // 503
    data object SessionExpired : ApiOutcome<Nothing>                     // 401 auth
    data class RateLimited(val retryAfterSec: Int?) : ApiOutcome<Nothing>
    data class Validation(val fields: Map<String, List<String>>) : ApiOutcome<Nothing>
    data class Failure(val status: Int?, val kind: FailureKind) : ApiOutcome<Nothing> // NotFound, Server, NotJson, Network
}
```

Un 202 est distingué par la forme de `data` (`approvalId` + `pending_approval` contre un tableau d'exécutions).

- **`ActionRunner`** (`core:security`), chemin unique de tout appel qui modifie :
  1. contrôle préalable fourni par l'app (legacy, hors ligne, confidentialité, droit, tenant de session) → `Blocked(raison)` ou bascule « Basculer et continuer » ;
  2. palier local (S41, biométrie, maintien, fenêtre de confiance) ;
  3. appel avec un corps `JsonObject` ;
  4. `StepUpRequired` → S42 → renvoi du **même corps** + `twoFactorCode` (+ `trustIp`), 3 essais au plus ;
  5. `PendingApproval` → S43 + suivi `APPROVAL_UPDATED` ;
  6. `PrivacyLocked` → S44 → un seul nouvel essai ;
  7. `SessionExpired` → S03, **jamais de rejeu automatique** d'une action ;
  8. suivi de la commande par `COMMAND_UPDATED`, avec repli REST.
  Le runner émet ses invites sur un `SharedFlow` ; l'hôte Compose racine les affiche et complète un `CompletableDeferred`. Les écrans fournissent `ActionSpec(palier, titre, appareil, tenant, conséquence)` et une lambda `(extra: JsonObject) -> ApiOutcome<T>`.
- **Dépôts et magasins** : `DeviceStore` = `StateFlow<Map<Long, Device>>` normalisé, alimenté par les pages REST et corrigé par les événements via un acteur à écrivain unique (règle `id = id ?: deviceId`, un `Device` complet remplace l'entrée). Les écrans collectent des flux dérivés étroits (`distinctUntilChanged`). Chaque dépôt expose `Flow<Resource<T>>` (données, fraîcheur, source réseau ou cache, erreur).
- **Permissions** : `PermissionResolver` calcule le niveau d'un appareil (ro/rw) en remontant les ancêtres du groupe (`parentId` de `/api/groups`), plus `ungrouped:0`, la clé API par défaut et le contournement admin ; `DenialMemory` retient les 403 de capacité par (appareil, capacité) pour la session.
- **Pagination** : admins pagination serveur (100) ; non-admins une requête `pageSize=2000` puis pagination locale.
- **Cache** :
  - v1 : mémoire (stale-while-revalidate, clé `(serverId, utilisateur, tenant, requête)`) + `SnapshotStore` : instantanés JSON chiffrés (AES-GCM, clé Keystore) dans `noBackupFilesDir` pour la liste d'appareils, l'arbre, le résumé et les alertes ;
  - v1.1 : 20 derniers détails ; **Room** avec KSP 2.3.12 (preuve P5 : KSP 2.2.10-2.0.2 est refusé par Kotlin intégré, KSP 2.3.x fonctionne) ;
  - **jamais sur disque** : clés BitLocker ou Windows, sorties de scripts, paramètres secrets, jetons de tunnel, codes OTP, déverrouillages de confidentialité ;
  - purge à la déconnexion d'un serveur (ses données seulement), à son retrait, à la perte d'un tenant ; durée de vie 7 jours. Instantanés rangés par `serverId`.

### 10.5 Authentification

- **SSO** : WebView intégrée (`WebHost`) sur `/auth/sso-redirect`, politique de navigation actuelle (serveur et Obligate dans la WebView) ; fin détectée à la première navigation principale vers `https://<serveur>/` ou `/login?error=` ; puis `/auth/me`.
- **Local + 2FA** : natif (S01).
- **Par serveur** : chaque profil a sa propre session, sa sonde et son bandeau de prévention ; `SessionExpired` sur un serveur non actif ne lève pas S03 (§2.10).
- **Session** : sonde au démarrage et au retour après 5 min ; `SessionExpired` → S03 avec SSO silencieux (8 s) ; cookie valable 7 jours après le dernier `Set-Cookie` (une bascule de tenant le renouvelle) ; bandeau de prévention au 6e jour.
- **Déconnexion** (d'un serveur ; « Se déconnecter » dans S85 vise le serveur actif, S92 propose aussi « Se déconnecter de tous les serveurs ») : `GET /api/auth/sso-logout-url` → `POST /api/auth/logout` → page de déconnexion Obligate dans une WebView cachée → effacement des cookies du serveur → purge des caches du serveur → déconnexion du socket → retrait du serveur de l'agrégation et des Workers → serveur connecté suivant, ou S01 s'il n'en reste aucun. La déconnexion Obligate peut fermer la session Obligate d'un autre serveur du même fournisseur : l'app le dit (« Atelier utilise aussi Obligate : vous devrez peut-être vous y reconnecter »).
- `requires2faSetup` et `enrollmentVersion < 1` → vue web, avec carte d'explication native.

### 10.6 Temps réel

- **Client** : `io.socket:socket.io-client` 2.x (Engine.IO v4, compatible Socket.IO 4.7 du serveur), `transports=["websocket"]`, `extraHeaders = {Cookie: connect.sid=…}`, reconnexion avec attente croissante (1 → 30 s). Le serveur ignore `handshake.auth.userId` et utilise la session.
  - Risque : dépendance OkHttp 3/4 de la bibliothèque contre OkHttp 5 → **preuve faite** (P2) : 2.1.2 forcé sur OkHttp 5.5.0 fonctionne contre un serveur Socket.IO 4.8.
  - Repli : client Engine.IO v4 / Socket.IO v5 minimal sur WebSocket OkHttp (ouverture, `40`, `42[...]`, accusés, ping/pong ; environ 400 lignes) dans le socle.
- **`RealtimeClient`** : `state: StateFlow<Connecting|Connected|Reconnecting|Disconnected>`, `events(name)`, `emit(name, payload, ack)` ; `connect_error 'Unauthorized'` → `SessionExpired` ; **reconnexion à chaque changement de tenant** ; fermeture et ouverture sur le nouveau serveur à chaque changement de serveur.
- **Un seul socket, celui du serveur actif.** Les serveurs non actifs sont **sondés** : `GET /api/live-alerts/all` (au-delà de leur repère) et, pour les admins, `GET /api/approvals?limit=50`, toutes les 60 s tant que l'app est au premier plan, par le `AlertsWorker` en arrière-plan (v1) puis par push (v1.1). Un socket par serveur a été écarté : batterie, et aucun écran n'en a besoin (les listes restent sur le serveur actif).
- **Routeur d'événements Obliance** :

| Événement | Traitement |
|---|---|
| `DEVICE_UPDATED` | Fusion par `id ?? deviceId` |
| `DEVICE_METRICS_PUSHED` | Magasin mémoire par appareil ; ignoré pour les appareils hors écran ; regroupé par appareil toutes les 2 s |
| `DEVICE_OFFLINE`, `DEVICE_APPROVED`, `DEVICE_DELETED {id}` | Table des appareils |
| `COMMAND_UPDATED`, `COMMAND_RESULT` | Magasin de commandes + suivis |
| `EXECUTION_UPDATED` | Magasin des lots |
| `NOTIFICATION_NEW` | Alertes + bandeau dans l'app (pas de notification système au premier plan, sauf critique) |
| `APPROVAL_CREATED`, `APPROVAL_UPDATED` | Approbations + suivi des demandes |
| `REMOTE_SESSION_UPDATED`, `REMOTE_TUNNEL_READY` | Liste des sessions ; **le `sessionToken` est supprimé au décodage** et jamais stocké : l'app n'utilise que le jeton de sa propre réponse `POST` |
| `DEVICE_SERVICES_UPDATED`, `DEVICE_PROCESSES_UPDATED`, `CUSTOM_METRIC_UPDATED`, `DISK_HEALTH_UPDATED`, `SCENARIO_*`, `COMPLIANCE_RESULT` | Magasins respectifs |
| Inconnu | Ignoré |

- **Limites connues du serveur** : aucun événement de groupe ; aucun `UPDATE_*` ; `EXECUTION_OUTPUT` jamais émis ; les événements des tenants enfants n'arrivent pas sur le socket du maître (sondage 15 s sur un appareil ouvert, 60 s sur Flotte).
- **Repli** : déconnecté plus de 30 s sur un écran ouvert → l'écran interroge son endpoint REST toutes les 15 s.

### 10.7 Navigation et mises en page adaptatives

- **Navigation 3** (`androidx.navigation3`) avec les scènes adaptatives Material 3 : liste-détail pour À traiter, Appareils et Activité ; volet secondaire pour les panneaux en direct ; scène `SessionDockScene` pour le dock. `NavigationSuiteScaffold` choisit barre ou rail selon `currentWindowAdaptiveInfo()`.
- **Décision (preuve P4)** : Navigation 3 1.2.0 + adaptive-navigation3 1.3.0 avec le BOM 2026.08 ; le repli Navigation Compose 2.9 est abandonné.
- **Clés de route** `@Serializable` : `TriageKey(segment, selectedId?)`, `DevicesKey(filter)`, `DeviceKey(id, tab, fromAlertId?)`, `SessionKey(localId)`, `BatchKey(batchId)`, `WebKey(path, title)`…
- **Pile par destination** conservée : changer d'onglet ne perd jamais un écran d'appareil.
- **Liens profonds** : un seul point d'entrée (schéma, App Links, intents de notification, `OPEN_URL`) → `resolveDeepLink` → `locate-device` si besoin → bascule de tenant → pile synthétique (`[DevicesKey, DeviceKey(123, Processes)]`).
- **Plein écran** : S60 et S62 sont des routes immersives ; ObliReach dans sa propre activité (l'image dans l'image l'exige).
- **Mort du processus** : piles et détail sélectionné sauvegardés (clés sérialisables) ; restauration depuis le cache puis rechargement.

### 10.8 Notifications et push

- **v1** : le `AlertsWorker` existant (15 min, `GET /api/live-alerts/all` au-delà du repère) est étendu à **tous les serveurs connectés** (une passe par serveur, en parallèle, délai 20 s chacun ; un serveur injoignable n'empêche pas les autres) : classement par `classifyAlert` (catégorie déduite du titre serveur, priorité selon appareil serveur, groupe « Toujours actif », appareil surveillé), canaux et actions, mise à jour ou annulation au rétablissement, rappels d'astreinte par alarmes inexactes. Pour les administrateurs de plateforme, il lit aussi `GET /api/approvals?limit=50` (nouveaux ids). App vivante : le socket livre instantanément.
- **v1.1 — UnifiedPush** (distributeur ntfy, déjà prévu dans `docs/obli-mobile.md` §7) : l'app enregistre **un point de terminaison par serveur** (une instance UnifiedPush par `serverId`) par `POST /api/mobile/push/subscriptions {endpoint, tenants, categories}` sur chaque serveur ; le serveur envoie une **charge minimale** `{alertId, tenantId, severity, category}` ; l'app récupère le détail avec son cookie : aucun nom d'hôte ne transite par le relais. Le Worker reste un filet (toutes les heures), dédoublonné par `alertId`. Une flavor FCM reste optionnelle.
- **Actions** : chaque intent de notification porte le `serverId` ; `BroadcastReceiver` → bus d'actions du socle → gestionnaire de l'app, exécuté sur la `ServerSession` de l'élément. T0/T1 directement (marquer lu, approuver ou refuser un enrôlement, surveiller) ; le reste ouvre l'app par une activité translucide qui porte S41 et la biométrie.

### 10.9 Accès distant

- **`core:tunnel`** : WebSocket OkHttp vers `/api/remote/tunnel/<token>` (cookie et UA envoyés quand même, prêt pour la liaison du jeton) ; `pingInterval` 20 s ; machine à états `connecting → waiting → paired → open → closed/error` ; **rien n'est envoyé avant `paired`** ; file de trames bornée ; le jeton n'est jamais journalisé ni envoyé dans un rapport de plantage.
- **`core:terminal`** : SPI `TerminalEngine` (`feed(bytes)`, `resize(cols, rows)`, `keystrokes: Flow<ByteArray>`, `dispatchKey`, `paste`, `@Composable Render()`) ; implémentation **`org.connectbot:termlib` 0.2.1** figée (dernière version compilée en Kotlin 2.3, lisible par 2.2.10 ; les 0.3.x sont en Kotlin 2.4 — preuve P3) ; plan B : fork des modules `terminal-emulator` / `terminal-view` de Termux (Apache-2.0) ; plan C : xterm.js dans une WebView locale pour ce seul écran. Décodage UTF-8 incrémental (trames de 4 096 octets qui coupent des caractères) ; redimensionnement après `paired` ; touches spéciales encodées par l'émulateur (respect de DECCKM) ; `SessionManager` au niveau du processus + service `specialUse`. `abiFilters` : `arm64-v8a`, `armeabi-v7a`, `x86_64` (Chromebooks) ; la bibliothèque native ajoute ~3 Mo par ABI.
- **`feature:reach` (v1.1)** : H.264 Annex B par MediaCodec asynchrone vers `AndroidExternalSurface` ; configuration au premier IDR (SPS/PPS) ; clés basse latence ; **abandon des trames P jusqu'au prochain IDR** en cas de retard ; chemin JPEG obligatoire avec passage automatique `set_codec jpeg` après 3 s sans image (agents Linux et macOS) ; audio PCM s16le 48 kHz par `AudioTrack` basse latence ; `InputMapper` qui reprend les constantes de `useRemotePointer` (16 ms, 500 ms, 400 ms / 24 px, 40 px par cran, × 1,25, zoom 5×) ; `InputConnection` dédiée (`VISIBLE_PASSWORD`, `NO_SUGGESTIONS`, `NO_PERSONALIZED_LEARNING`) ; table evdev → `code` DOM ; séquence Ctrl+Alt+Suppr identique au web ; reconnexion par nouvelle session (5 × 2 s) ; libération du décodeur en arrière-plan, attente du prochain IDR au retour ; `FLAG_SECURE` et écran allumé pendant le flux.
- **Console de VM Hyper-V** : même visionneuse avec `protocol:'vmconsole'` et `vmId` (v1.1).

### 10.10 Sécurité

- HTTPS seulement ; `allowBackup=false` (existant) ; bases et instantanés dans le stockage sans sauvegarde.
- `FLAG_SECURE` par écran (S45, S53, S60, S62 toujours ; partout en option) ; IME sans apprentissage sur les saisies distantes ; presse-papiers sensible.
- Journaux expurgés dans `core:common` : cookies, jetons, URL de tunnel, codes TOTP, mots de passe ; noms d'hôte en mode anonyme. Aucun rapporteur de plantage qui envoie des données hors de l'appareil ; export manuel.
- Biométrie `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` pour T2 et T3 ; secrets en mémoire uniquement.
- Mode anonyme appliqué au niveau des ViewModels : écrans, widgets, notifications et partages le respectent ; le nom affiché des serveurs reste visible, leurs hôtes sont masqués.
- **Multi-serveurs** : un appel ne part jamais vers une autre origine que celle de sa `ServerSession` (contrôle dans le client HTTP) ; un `navigateTo` ou un lien qui pointe vers un hôte absolu étranger à son serveur est refusé ; les jetons de tunnel et les cookies restent par origine ; la mise à jour de l'app n'accepte que le signataire figé, quel que soit le serveur qui la propose.

### 10.11 Budgets de performance et tests

| Mesure | Cible |
|---|---|
| Démarrage à froid jusqu'à À traiter (instantané) | < 1,2 s sur un appareil de classe Pixel 7 |
| À traiter fraîche depuis le réseau | < 2,5 s en 4G |
| Liste de 2 000 appareils | Défilement à 60 i/s |
| Correctif temps réel → ligne à jour | < 250 ms |
| Taille d'APK | ≤ 25 Mo par ABI (polices ~1,5 Mo, termlib ~3 Mo) |

| Couche | Outils | Contenu |
|---|---|---|
| Contrats d'analyse | JUnit + **fixtures JSON enregistrées sur un serveur 5.1.x** (script rejoué avant chaque version ; un écart fait échouer la CI) | Enveloppes A/B/brut, nombres en chaînes, 4 variantes de `DEVICE_UPDATED`, corps 401/202/403/409/423, distinction des 202 |
| Logique | JUnit, coroutines-test, Turbine | `ActionRunner` (renvoi du même corps, 202 jamais succès, confidentialité, refus appris), `AlertClassifier`, corrélation, résolveur de permissions, `agentSupportsCommand`, routeur de liens (avec `server=`), cron en français, `ServerRegistry` (origines uniques, 8 au plus, retrait et purge), agrégateur d'À traiter multi-serveurs |
| Temps réel et tunnel | JVM + faux serveur | Fusion des correctifs, reconnexion à la bascule, filtrage de visibilité, ordre `paired` → `resize`, découpe UTF-8 |
| Interface | **Roborazzi** (Robolectric ; la machine de build n'a pas d'émulateur) + contrôles ATF | Chaque écran × {compacte, moyenne, étendue} × {FR, EN} × {police 1,0 / 2,0} × {normal, vide, erreur, hors ligne} × {Operator, Nuit} |
| Contraste | Test unitaire sur les jetons | Toute paire texte/fond déclarée ≥ 4,5:1 (3:1 pour les grands textes et icônes) |
| Laboratoire | Galaxy S23 + Tab S9 (clavier), Pixel 9, un MediaTek d'entrée de gamme, un Chromebook ; Gboard, clavier Samsung, SwiftKey ; vim, htop, mc, tmux, PSReadLine ; ObliReach 1080p / 1440p / 4K en 4G | Campagne scriptée à chaque version |
| Portes de version | `testOblianceDebugUnitTest lintOblianceDebug assembleOblianceRelease` + écart de captures + contrôle du signataire + contrôle du graphe des modules | — |

### 10.12 Modifications serveur et agent (demandes, par priorité)

| # | Modification | Pourquoi | Effort | Requis pour |
|---|---|---|---|---|
| S1 | Alertes en direct pour **demande à deux créée** et **appareil en attente d'enrôlement** (`navigateTo` `/admin/security?approval=:id` et `/devices/:id`) + champ **`category`** sur toutes les alertes | Les approbations expirent en 30 min ; le Worker ne voit que `/live-alerts/all` ; classement fiable | 1–2 j | v1 |
| S2 | **Ne plus diffuser `sessionToken`** dans `REMOTE_SESSION_UPDATED` / `REMOTE_TUNNEL_READY` et lier le tunnel au cookie de `started_by` | Aujourd'hui tout membre du tenant peut s'attacher au shell d'un autre ; le mobile augmente l'enjeu | 1–2 j | v1 (avant les shells) |
| S3 | `POST /api/scripts/:id/execute` : vérifier la capacité `execute` et le tenant du script | Sécurité | 0,5 j | v1 |
| S4 | Pagination non-admin de `GET /api/devices` (visibilité avant `LIMIT`, `total` juste) ; filtre camelCase de `/updates` et `/compliance/results` | Listes justes pour les techniciens | 1 j | v1 (contournement en place) |
| S5 | Listes séparées par virgules pour `status` sur `GET /api/devices` | Filtre « Problèmes » en un appel | 0,5 j | v1 |
| S6 | Abonnements push + diffusion UnifiedPush à charge minimale | Alertes instantanées en arrière-plan | 3–4 j | v1.1 |
| S7 | `GET /api/devices/:id/capabilities` → `{level, capabilities[], restrictions{actionKey: level}}` | Masquer ou expliquer les actions avant le 403 | 1–2 j | v1.1 |
| S8 | Alertes pour échecs de planification (`assertPass`), de scénario, Veeam, erreurs de mise à jour | Astreinte au-delà des événements d'appareil | 1–2 j | v1.1 |
| S9 | `/.well-known/assetlinks.json` depuis le manifeste mobile | App Links | 0,5 j | v1.1 |
| S10 | « Maintenance immédiate » pour les techniciens (endpoint mince, portée `rw` appareil ou groupe) | Faire taire les alertes pendant une intervention | 1 j | v1.1 |
| S11 | Relais ObliReach : abandon des trames non-IDR quand `bufferedAmount` monte | Latence bornée en 4G | 1–2 j | v1.1 |
| S12 | Agent ObliReach : injection AltGr + repli Unicode, `request_keyframe`, `set_max_bitrate`, `set_audio` (dépôt `D:\Oblireach`) | AZERTY, économie de données | 3–5 j | v1.1 (AltGr) / v2 |
| S13 | Renouvellement de session (`rolling: true` ou `POST /api/auth/refresh`) | Éviter l'expiration sèche à 7 jours pendant l'astreinte | 0,5 j | v1.1 (à arbitrer, Q8) |
| S14 | `DEVICE_SUBSCRIBE` / `DEVICE_UNSUBSCRIBE` pour borner `DEVICE_METRICS_PUSHED` ; émission des événements de groupe | Données mobiles et batterie à 2 000+ appareils ; arbre en direct | 1–2 j | v1.1 |
| S15 | Permettre au maître d'agir sur un appareil d'un tenant enfant, avec journal d'audit | Supprimer « Basculer et continuer » (Q7) | 2–3 j | v1.1 si validé |
| S16 | Diffusion réelle de la sortie des scripts (`EXECUTION_OUTPUT`) | Vraie sortie en direct | 2–3 j | v2 |
| S17 | Reprise de session shell (l'agent garde le PTY N secondes) | Survivre au passage Wi-Fi ↔ 4G | 3–5 j | v2 |
| S18 | Validation liée à l'appareil (clé Keystore enregistrée, défi signé accepté comme action sensible) | Biométrie au lieu de TOTP | 4–6 j + revue | v2 |
| S19 | N° de série carte mère / BIOS et tag d'actif dans la recherche | Scan en salle serveur | 0,5 j | v2 |
| S20 | `GET /health` expose un **identifiant d'instance** stable et le nom de l'instance (facultatif) | Détecter qu'une adresse différente mène à une instance déjà configurée ; préremplir le nom dans S93 | 0,5 j | v1 (confort) |

S2, S3 et S4 corrigent aussi des défauts qui existent aujourd'hui sur le web.

---

## 11. Plan par phases

**Hypothèses** : 2 développeurs Android seniors (A : socle, terminal puis médias ; B : Compose, fonctionnalités Obliance) ; un designer produit à 50 % pendant la phase 0 et la v1, puis 20 % ; un développeur serveur à ~30 %. Estimations en personnes-semaines (ps), tests compris, marge de 15 % incluse dans les totaux.

### Phase 0 — Fondations et preuves (3 semaines · 6 ps)

| Élément | ps |
|---|---|
| Découpage en modules, plugins de convention, déplacement de l'updater, du verrou, du WebHost et du Worker dans `core:*` ; les autres flavors se construisent toujours | 1,5 |
| `core:designsystem` : jetons Operator et Nuit, polices, icônes, composants §8.9, aperçus, test de contraste | 1,5 |
| `core:network` (pot à cookies, enveloppes, `ApiOutcome`, `ActionRunner`) + `core:auth` (S01–S03) **avec `ServerRegistry` et `ServerSession` dès le socle** (tout est indexé par `serverId`, même avec un seul serveur) | 1,5 |
| `core:realtime` + preuve Socket.IO contre OkHttp 5 avec le cookie | 0,5 |
| Preuves : termlib 0.2.0 dans la chaîne (IME, ConPTY, taille) ; Navigation 3 adaptative contre 2.9 ; plugin kotlinx-serialization et KSP2 sur AGP 9 ; décodage H.264 sur 3 SoC | 1,0 |

**Sortie** : rapport de preuves avec décision sur termlib, la bibliothèque temps réel, Navigation 3 et Room / SQLDelight — **fait** : `docs/mobile/phase0-proofs.md` (termlib 0.2.1, socket.io-client sur OkHttp 5, Navigation 3, Room + KSP 2.3.12, Roborazzi).

### v1 — « Astreinte » (≈ 17 semaines · ≈ 34 ps)

| Élément | ps |
|---|---|
| Coquille adaptative, modèle de périmètre (filtrer / basculer), recherche et palette, routeur de liens, S90, S91 | 2,5 |
| S10–S12 À traiter (classement, corrélation, fusion de rétablissement, approbations, enrôlements, balayages) | 2,0 |
| S20–S23 liste, filtres, arbre, groupe, sélection multiple, aperçu d'impact, contournement de pagination | 2,0 |
| S30 cadre (bandeaux, contexte d'incident, barre et rail d'actions, métriques en direct) | 1,25 |
| S31 Aperçu, S36 Tâches, S38 Réglages | 1,25 |
| S32 Services, S33 Processus | 1,25 |
| S37 Inventaire + S45 BitLocker | 1,0 |
| S40–S44 feuille « Agir », échelle de sécurité, vérification 2FA, approbation envoyée, confidentialité, textes d'erreur | 1,5 |
| S50–S53, S55–S57 scripts, lots, sorties, Activité, bibliothèque, planifications (liste, pause, historique) | 3,0 |
| S60–S61 terminal (termlib, barre de touches, commandes rapides, onglets), `SessionManager`, pastille et dock, service de premier plan | 3,5 |
| S62 visionneuse web ObliReach dans son activité | 0,5 |
| S70 Flotte (admin et non-admin) | 1,0 |
| Notifications : classement, canaux, actions, astreinte, tuile, moteur de surveillance, extension du Worker | 2,0 |
| **Multi-serveurs** : S92, S93, section Serveurs de S81, bascule de serveur (piles par serveur, instantanés), agrégateur d'À traiter, sondeur des serveurs non actifs, Worker multi-serveurs, groupes de canaux, liens `server=`, raccourcis par serveur, mise à jour « plus haut versionCode » | 2,6 |
| S04, S80, S83–S86, migration depuis la coquille | 1,0 |
| Clavier et souris : raccourcis, menus contextuels, S88 | 1,0 |
| Qualité : recette, accessibilité, relecture FR/EN (vouvoiement), performance à 2 000 appareils, captures | 2,5 |
| Marge (15 %) | 4,4 |
| **Total** | **≈ 34** |

- **Jalon M1** (≈ semaine 9 après la phase 0) : alpha interne en lecture (À traiter, appareils, détail, alertes) **sur les trois serveurs du propriétaire** (le multi-serveurs de base — registre, bascule, Worker multi-serveurs — est tiré dans M1) ; remplace l'accueil de la coquille pour l'astreinte du propriétaire.
- **Jalon M2** (≈ semaine 13) : actions, garde-fous, scripts, terminal ; bêta pour 3 à 5 techniciens.
- **Jalon M3** : version v1, environ 20 semaines après le lancement du projet.
- **Serveur en parallèle** : S1, S2, S3, S4, S5, S20 (~1,6 ps).

### v1.1 — « Temps réel » (≈ 11 semaines · ≈ 22 ps)

| Élément | ps |
|---|---|
| Client UnifiedPush (un point de terminaison par serveur), réglages de catégories, surveillance instantanée | 1,5 |
| ObliReach natif (H.264 + JPEG, tactile, clavier, presse-papiers, Ctrl+Alt+Suppr, reconnexion, image dans l'image) + S63 | 6,5 |
| Mises à jour : onglet appareil + S71 flotte (agrégats existants) | 1,5 |
| Hyper-V (alimentation, points de contrôle, console de VM) + Veeam | 1,5 |
| S58 scénarios, S87 supervision, onglet Historique | 2,0 |
| Maintenance immédiate | 0,5 |
| Widgets, raccourcis épinglés, vues enregistrées (S24) | 1,5 |
| Cache hors ligne des détails, économie de données | 1,0 |
| Multi-fenêtre, glisser-déposer, App Links | 1,0 |
| Qualité (campagne ObliReach comprise) | 1,5 |
| Marge (15 %) | 3,0 |
| **Total** | **≈ 22** |

Serveur : S6–S14 (~2,5 ps). Agent : S12 AltGr (~0,5 ps, dépôt Oblireach).

### v2 — « Parité » (≈ 12 semaines · ≈ 25 ps)

| Élément | ps |
|---|---|
| Parité ObliReach (enregistrement MediaMuxer + `set_recording`, minicarte, menu de codecs, économie de données côté agent) | 3,5 |
| Terminaux scindés et saisie diffusée (tablette), extraits synchronisés | 1,5 |
| Explorateur de fichiers (écriture) | 2,0 |
| Rewind | 1,5 |
| Chat avec l'utilisateur (`chat:*`, réponse depuis la notification) | 2,0 |
| Validation liée à l'appareil (client) | 1,5 |
| Conformité, CVE et audit en lecture ; urgence utilisateurs (désactiver, réinitialiser la MFA) | 2,0 |
| Thème Daylight + terminal clair | 1,0 |
| Mode salle serveur, NFC, code-barres | 1,0 |
| Réglages d'appareil complets et zone dangereuse (transfert, suppression) | 1,5 |
| **Seconde app Obli sur le socle** (squelette natif Obliview : connexion, boîte, liste et détail) | 3,0 |
| Qualité | 2,0 |
| Marge (15 %) | 2,5 |
| **Total** | **≈ 25** |

Serveur : S15–S19 (~2 ps + revue de sécurité).

**Chemin critique** : preuves de phase 0 (termlib, Socket.IO) → terminal et temps réel v1 ; S1 et S2 avant la sortie de la v1 ; ObliReach natif (développeur A à plein temps) conditionne la v1.1.

**Avec un 3e développeur** : la v1 passe à ~13 semaines, ou l'ObliReach natif remonte en v1 sans décaler la date.

---

## 12. Risques

| # | Risque | Impact | Parade |
|---|---|---|---|
| R1 | Alertes d'arrière-plan retardées (sondage 15 min, Doze, économiseurs des constructeurs) jusqu'au push | Incidents manqués en v1 | Exemption de batterie à l'accueil ; état d'acheminement honnête dans S84 ; socket quand l'app vit ; push en priorité v1.1 |
| R2 | Frappe ObliReach sur postes AZERTY (caractères AltGr faux ou perdus) | Mots de passe erronés | Correctif agent S12 ; « Envoyer du texte » par le presse-papiers ; limite signalée |
| R3 | Les shells meurent au changement de réseau | Interventions interrompues | Avertissement, conseil tmux, scripts pour les tâches longues ; reprise côté agent en v2 (S17) |
| R4 | Maturité de termlib (pré-1.0) et versions des métadonnées Kotlin | Retard du terminal | Version figée ; SPI `TerminalEngine` ; plans B et C |
| R5 | `socket.io-client` sur un vieil OkHttp | Conflits à la compilation ou à l'exécution | Preuve en phase 0 ; client Engine.IO maison |
| R6 | Capacités inconnues des non-admins | Actions montrées puis refusées | Refus appris et textes clairs ; S7 |
| R7 | Diffusion du jeton de tunnel | Détournement de session dans un tenant | S2 avant la sortie ; jetons d'événements ignorés |
| R8 | App Links impossibles à vérifier sur un domaine auto-hébergé | Liens ouverts dans le navigateur | Schéma personnalisé dans les notifications ; App Links pour les builds à hôte connu |
| R9 | Agrégats non filtrés pour les non-admins | Indicateurs trompeurs | Calcul local étiqueté « Vos appareils » |
| R10 | Dérive de forme côté serveur (pas de versionnage d'API) | Plantages après une mise à jour serveur | Décodeurs tolérants, fixtures rejouées à chaque version, détection de fonctionnalités par la version `/health` |
| R11 | Chaîne d'outils AGP 9 à Kotlin intégré qui bloque sérialisation, Navigation 3 ou KSP | Retard des fondations | Preuves en semaine 1 avec replis nommés (décodeurs manuels, Navigation 2.9, SQLDelight) |
| R12 | Charge de `DEVICE_METRICS_PUSHED` sur 2 000+ appareils | Batterie et données | Filtrage à l'écran, économie de données ; S14 |
| R13 | Agir sur la mauvaise instance (même nom de tenant « Default » sur trois serveurs) | Action chez le mauvais client | Tuile et nom du serveur dans chaque confirmation et invite biométrique ; aucune action sur un autre serveur que l'actif (sauf T0/T1 de boîte) ; bascule toujours annoncée |
| R14 | Alertes des serveurs non actifs retardées (sondage 60 s au premier plan, 15 min en arrière-plan) | Incident d'une instance cliente vu tard | Même parade que R1 ; push par serveur en v1.1 ; état d'acheminement par serveur dans S84 |
| R15 | Déconnexion Obligate partagée (BinaryHearts et Atelier utilisent le même fournisseur) | Une déconnexion en coupe deux | Avertissement dans la confirmation ; SSO silencieux à la reprise |

---

## 13. Questions ouvertes pour le propriétaire

1. **Démarrage sur « À traiter »** plutôt qu'un tableau de bord : validez-vous ce choix, cœur de la posture astreinte ?
2. **ObliReach en v1 par la visionneuse web** (0,5 ps), natif en v1.1 : acceptable, ou préférez-vous un 3e développeur pour avoir le natif dès la v1 ?
3. **Modifications serveur S1 à S5 dans le périmètre v1** : sans S1, une approbation ne peut pas réveiller un téléphone ; S2 et S3 sont des prérequis de sécurité pour les shells mobiles. Qui les porte, et quand ?
4. **Push par UnifiedPush / ntfy** par défaut en v1.1 (auto-hébergeable) : faut-il aussi une flavor FCM pour certains MSP ?
5. **Couleur du bouton principal** : le fond `#E03A3A` échoue au contraste AA avec du texte blanc. Acceptez-vous `#C83232` pour les boutons pleins, `#E03A3A` restant la couleur de marque ? Faut-il répercuter ce choix sur le web ?
6. **Thème Nuit et discipline du rouge** : à inscrire dans `docs/obli-design-system.md` pour toutes les apps Obli ?
7. **Maître qui agit sur les tenants enfants** (S15) : garder « Basculer et continuer » (plus sûr, un appui de plus) ou autoriser l'action directe avec un journal d'audit ?
8. **Renouvellement de session** (S13) : prolonger la session à chaque requête, au prix d'une session potentiellement sans fin sur un téléphone perdu (atténué par le verrou biométrique) ?
9. **Textes des alertes** : le serveur écrit aujourd'hui les titres en français en dur (« Hors ligne », « retour à la normale »). Un utilisateur anglophone les verra en français. Faut-il ajouter au serveur des clés de traduction en plus du champ `category` ?
10. **Distribution** : confirmez-vous l'APK signé auto-hébergé uniquement (pas de Play Store) ? Le service de premier plan `specialUse` et UnifiedPush en dépendent.
11. **Confirmation T3 par maintien** au lieu de la saisie du nom d'hôte : plus rapide mais moins délibérée. Validez-vous ?
12. **Notifications de postes de travail hors ligne** : le serveur les envoie en `info`. Faut-il qu'elles restent silencieuses même en astreinte (proposition actuelle) ?
13. **`script.execute_manual` sensible par défaut** : chaque exécution manuelle depuis le mobile demandera un TOTP (sauf IP de confiance, peu durable en 4G). Faut-il revoir ce défaut, ou attendre la validation liée à l'appareil (v2) ?
14. **Équipe** : 2 développeurs (v1 à ~20 semaines du lancement) ou 3 ?
15. **Seconde app sur le socle** : Obliview est-elle bien la prochaine app à passer en natif ?
16. **Multi-serveurs — sondage des serveurs non actifs** : un seul socket (serveur actif) et un sondage de 60 s au premier plan pour les autres (proposition), ou un socket par serveur connecté (alertes instantanées partout, plus de batterie) ?
17. **Multi-serveurs — actions sans bascule** : limiter aux actions de boîte T0/T1 (marquer lu, supprimer, surveiller, enrôlement) comme proposé, ou autoriser aussi l'approbation d'une demande à deux d'un autre serveur sans bascule ?
18. **Multi-serveurs — couleurs** : palette fermée de 8 (proposée) ou couleur libre ? Et les noms « BinaryHearts », « Atelier », « Client Durand » vous conviennent-ils comme données d'exemple (« Atelier » est aussi le nom du groupe Siège › Atelier de BASH) ?
19. **S20 (identifiant d'instance dans `/health`)** : à ajouter côté serveur, ou l'origine suffit-elle ?

---

## 14. Maquette

Prototype cliquable de 24 planches. Cadres : **téléphone 390 × 844** (portrait) ou **tablette 1280 × 800** (paysage). Toutes les planches utilisent exclusivement le jeu de données du §4, le thème Operator, le français au vouvoiement, les jetons du §8. La planche de notifications montre des cartes de notification sans fausse barre d'état.

| ID | Fichier | Cadre | Titre | Écrans | Liens (prototype) |
|---|---|---|---|---|---|
| A01 | `SignIn.dc.html` | Téléphone 390 × 844 | Connexion : serveur, Obligate, compte local | S01 (serveur validé, Obligate, connexion locale repliée) | A02 (après connexion) |
| A02 | `Main.dc.html` | Téléphone 390 × 844 | À traiter | S10 agrégé sur trois serveurs : segment Alertes (7), puce « Tous les serveurs », carte de corrélation, cartes d'incident avec tuiles de serveur (SRV-AD2, PC-COMPTA-03, SRV-DURAND01…), barre de navigation | A03 (carte SRV-AD2), A08 (carte PC-COMPTA-03, action Processus), A16 (segment Approbations), A19 (puce de tenant), A06 (nav Appareils), A11 (nav Activité), A05 (nav Flotte), A17 (nav Plus) |
| A03 | `AlertDetail.dc.html` | Téléphone 390 × 844 | Incident : SRV-AD2 hors ligne | S30 en mode incident (bandeau, contexte, barre d'actions hors ligne) | A02 (retour), A06 (« Voir les 5 » → liste filtrée), A09 (Agir) |
| A04 | `Notifications.dc.html` | Téléphone 390 × 844 | Exemples de notifications | Cartes nommant leur serveur (« Obliance · BinaryHearts ») : critique SRV-DURAND01 (Client Durand), résumés par serveur, puis critique SRV-AD2 (Ouvrir · Surveiller · Marquer lu), critique PC-COMPTA-03 (Processus), approbation PC-ATELIER-02 (Examiner, expire à 03:51), enrôlement KIOSK-ACCUEIL-02 (Approuver · Refuser), rétablissement 140, script terminé (2 réussis, 1 échec), session persistante, groupe « BASH · 5 alertes » | A03 (SRV-AD2), A08 (Processus), A16 (Examiner), A13 (Voir la sortie) |
| A05 | `Fleet.dc.html` | Téléphone 390 × 844 | Flotte | S70 : carte vedette 312 et ruban, grille d'indicateurs, attention requise, activité 24 h, par tenant | A06 (tuiles et puces de légende), A08 (PC-COMPTA-03 dans Attention requise), A19 (puce de tenant), A02, A11, A17 (nav) |
| A06 | `DeviceList.dc.html` | Téléphone 390 × 844 | Appareils | S20 : puces rapides, sections CRITIQUE / ATTENTION / HORS LIGNE / EN LIGNE, 6 lignes d'exemple, ligne BOB01 en balayage « Agir » | A07 (filtre), A08 (PC-COMPTA-03), A09 (balayage Agir), A02, A11, A05, A17 (nav) |
| A07 | `DeviceFilters.dc.html` | Téléphone 390 × 844 | Filtres et tri | S21 en feuille pleine hauteur sur la liste assombrie | A06 (Afficher 12 appareils, Réinitialiser) |
| A08 | `DeviceOverview.dc.html` | Téléphone 390 × 844 | PC-COMPTA-03 · Aperçu | S30 + S31 : contexte, en-tête, bande de métriques en direct, onglet Aperçu (Maintenant, Tendance), barre d'actions Windows | A09 (Agir), A10 (onglet Inventaire), A14 (Terminal), A12 (Script), A06 (retour) |
| A09 | `ActionSheet.dc.html` | Téléphone 390 × 844 | Agir sur PC-COMPTA-03 | S40 sur S30 assombri : groupes RÉPARER, ACCÉDER, ANALYSER, ALIMENTATION, ZONE SENSIBLE | A14 (Terminal PowerShell), A15 (Voir l'écran), A12 (Exécuter un script), A08 (fermer) |
| A10 | `DeviceInventory.dc.html` | Téléphone 390 × 844 | PC-COMPTA-03 · Inventaire | S37 : puces de saut, matériel (n° de série 7FJ2KX3), disque SMART, BitLocker C: avec « Afficher la clé de récupération » | A08 (onglet Aperçu) |
| A11 | `Activity.dc.html` | Téléphone 390 × 844 | Activité et automations | S55 : sessions ouvertes, lot en cours, surveillance SRV-AD2, section AUTOMATIONS (scripts, planifications, scénarios), bouton « Exécuter un script », pastille de session | A12 (Exécuter un script), A13 (lot en cours), A14 (Reprendre la session), A02, A06, A05, A17 (nav) |
| A12 | `RunScriptSetup.dc.html` | Téléphone 390 × 844 | Exécuter « Nettoyer les fichiers temporaires » | S51 : script, paramètres, 3 cibles, vérifications préalables, bouton « Exécuter sur 3 appareils » | A13 (Exécuter), A11 (retour) |
| A13 | `RunLive.dc.html` | Téléphone 390 × 844 | Lot en direct · 2 réussis, 1 échec | S52 avec la sortie d'erreur de PC-COMPTA-03 dépliée et « Ouvrir PowerShell sur PC-COMPTA-03 » | A14 (Ouvrir PowerShell), A12 (Relancer sur les échecs), A11 (retour) |
| A14 | `Terminal.dc.html` | Téléphone 390 × 844 | PowerShell · PC-COMPTA-03 | S60 : sortie `Get-Process`, barre de touches page 1, clavier IME esquissé | A08 (réduire) |
| A15 | `ReachPhone.dc.html` | Téléphone 390 × 844 | ObliReach · PC-COMPTA-03 | S62 natif (cible v1.1) : flux en letterbox, pilule d'outils, curseur trackpad, suggestion de rotation, étiquette de statistiques | A08 (réduire) |
| A16 | `ApprovalDetail.dc.html` | Téléphone 390 × 844 | Approbation : désinstaller l'agent de PC-ATELIER-02 | S11 vu par Karim : anneau d'expiration 27:14, demandeur Julien Moreau, cible PC-ATELIER-02, conséquence, motif, Refuser / Approuver | A02 (après décision) |
| A17 | `More.dc.html` | Téléphone 390 × 844 | Plus | S80 : carte de compte (« BinaryHearts › Default »), entrée Serveurs, sections, bloc « Administration — Vue web » | A23 (Serveurs), A18 (Réglages de l'application), A19 (tenant), A02, A06, A11, A05 (nav) |
| A18 | `AppSettings.dc.html` | Téléphone 390 × 844 | Réglages de l'application | S83 : sécurité, apparence (Operator / Nuit), sessions, langue, données, section Serveurs (3 serveurs, Ajouter) | A17 (retour), A23, A24 |
| A19 | `TenantSwitch.dc.html` | Téléphone 390 × 844 | Serveur et tenant | S81 : section Serveurs (BinaryHearts actif, Atelier, Client Durand), puis « Tenants de BinaryHearts » (filtrer, travailler dans un tenant), sessions préservées | A02 (après bascule), A23 (Gérer les serveurs) |
| A20 | `TabletDeviceListDetail.dc.html` | Tablette 1280 × 800 | Appareils · arbre, liste et détail | S20 + S30 étendus : rail, arbre BASH, liste, détail PC-COMPTA-03 avec rail d'actions libellé, dock (PowerShell PC-COMPTA-03, SSH 140) | A21 (Voir l'écran ou onglet du dock), A22 (rail Flotte) |
| A21 | `TabletRemoteSession.dc.html` | Tablette 1280 × 800 | Session ObliReach · PC-COMPTA-03 (tablette) | S62 dans le volet de détail, panneau S63 ouvert, dock des sessions, minicarte des écrans | A20 (réduire) |
| A23 | `ServerManage.dc.html` | Téléphone 390 × 844 | Serveurs | S92 : trois cartes de serveur, détail de Client Durand (nom, couleur, notifications, raccourci, déconnexion, retrait) | A17 (retour), A24 (Ajouter un serveur) |
| A24 | `AddServer.dc.html` | Téléphone 390 × 844 | Ajouter un serveur | S93 : atelier.binaryhearts.me vérifié, session Obligate réutilisée, nom, couleur, tuile « AT » | A23 (retour) |
| A22 | `TabletFleetDashboard.dc.html` | Tablette 1280 × 800 | Flotte (tablette) | S70 en 3 colonnes : carte vedette et attention requise, indicateurs et mises à jour, tenants et tendance 30 j | A20 (tuiles ou rail Appareils) |

Enchaînement principal du prototype : A01 → A02 → A08 → A09 → A14, puis A02 → A03, A02 → A16, A11 → A12 → A13 ; multi-serveurs : A02 → A19 → A23 → A24 ; tablette : A22 → A20 → A21.

*Build à lancer : aucun — ce document ne modifie ni le serveur, ni le client, ni l'agent.*

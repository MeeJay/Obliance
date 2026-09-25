# Obliance mobile — document de reprise (sessions cloud et locales)

> CLAUDE.md est local (ignoré par git). Ce fichier porte ce qu'une session **cloud** doit savoir pour reprendre le chantier mobile. Le lire en entier avant de coder.

## Règles du projet à respecter
- Branche de travail : `dev` (la prod sort de `main` via le script de promotion local). En cloud : travailler sur une branche `mobileappdev/...` (ou `claude/...`) et ouvrir une PR vers `dev` ; le propriétaire redescend le travail en local avec `sync-cloud.ps1`.
- Ne jamais ajouter `Co-Authored-By` dans les commits. Ne jamais committer de secret (clé de signature, mots de passe, `local.properties`).
- Les fichiers `*.bat` sont exclus du dépôt ; ne jamais retirer cette règle.
- i18n obligatoire : tout texte visible passe par `t('ns.cle', 'Repli anglais')` (forme à 2 arguments : avec la config i18next du projet, `t(k) || repli` ne marche pas). Clés au minimum en `en` et `fr`. Français : **vouvoiement ou tournure neutre, jamais de tutoiement**.
- Android : chaînes visibles dans `res/values/strings.xml` (anglais) et `res/values-fr/strings.xml` (français, vouvoiement). Code et commentaires en anglais.
- Sécurité multi-tenant (serveur) : toute requête par `id` sur une table tenant-scopée doit aussi filtrer `tenant_id` (sauf tenant maître id=1, vue globale). Écriture/édition/suppression toujours strictement `WHERE id = ? AND tenant_id = req.tenantId`.
- Le propriétaire est francophone : répondre en français.
- Ne jamais annoncer « fait » pour quelque chose de seulement codé : dire ce qui est vérifié (compilé, testé) et ce qui ne l'est pas.

## App mobile Android — NATIVE (état et reprise)

**Décision du propriétaire (ferme)** : l'app Android est une **vraie app native
Kotlin / Jetpack Compose** qui appelle l'API. L'interface web dans une WebView a
été **rejetée**. Le web responsive ne sert qu'aux pages de configuration ouvertes
en vue web depuis « Plus ».

**Références (lire avant de coder)**
- `docs/obliance-mobile-design.md` : conception finale validée (navigation,
  écrans S.., parcours, jetons visuels, architecture modules `core:*` agnostiques +
  `obliance:*`, plan Phase 0 / v1 / v1.1 / v2, modifications serveur S1..S19).
- `docs/mobile/mockup/` : maquette validée (« magnifique ») — artboards `.dc.html`
  + `canvas.json` + `STYLEKIT.md` (composants et jetons). En ligne :
  https://claude.ai/artifact/5GCTuai8ps8xQ6CoyVT3hu
- `docs/obli-mobile.md` : contrat du pont web `window.ObliNative` + primitives web
  responsives (pour les pages en vue web).
- `docs/mobile/research/` et `docs/mobile/audits/` : rapports (API, build LifeTrack,
  shell desktop ObliTools, surface serveur) et audits responsive par zone.

**Arbitrages validés** : démarrage sur « À traiter » ; 5 destinations identiques
téléphone/tablette (À traiter · Appareils · Activité · Flotte · Plus) ; ObliReach =
visionneuse web en v1, natif (MediaCodec) en v1.1 ; actions destructrices =
maintien 1,5 s + biométrie ; boutons pleins `#C83232` (app ET web), `#E03A3A`
reste la couleur de marque ; modifications serveur au fil de l'eau, **signalées au
propriétaire avant chaque build serveur** ; **multi-serveurs en v1** : une seule
app, plusieurs profils de serveur (le propriétaire a 3 Obliance), bascule rapide
« Serveur › Tenant », notifications des 3 serveurs en permanence (groupe de
canaux par serveur), « À traiter » agrégé multi-serveurs. Pas de clones d'app.

**Projet** : `mobile/android` (Gradle 9.7 wrapper, AGP 9.3.1 avec Kotlin intégré
2.2.10 — ne jamais appliquer `org.jetbrains.kotlin.android` —, compileSdk 37,
minSdk 26, flavors = une par app Obli, `applicationId tools.obli.<app>`).
Aujourd'hui c'est encore la coquille WebView (setup, réglages, updater, alertes
en arrière-plan, pont, verrou biométrique) : la Phase 0 du design doc la
restructure en modules `core:*` + `obliance:*`.

**Build**
- Local (Windows) : `JAVA_HOME=C:\Program Files\Android\openjdk\jdk-21.0.8`,
  SDK `D:\LifeTrack\.android-sdk` (dans `local.properties`, ignoré par git).
  Release signée : `mobile/build-android.ps1` (clé `D:\keys\obli-release.jks`,
  empreinte `8c7e67f8…6d82ac8d`, mot de passe hors dépôt).
- Cloud (Claude Code web) : coller le **contenu** de `mobile/android/cloud-setup.sh`
  (pas son chemin) dans le script d'installation de l'environnement, accès
  réseau « Custom » + `dl.google.com` (fait par le propriétaire le 25/09).
  Le nouveau `sdkmanager` liste `platforms/android-37.x` (barre oblique) : le
  script le gère depuis le 25/09. Maven Central peut répondre 429 derrière le
  proxy : réessayer, ou ajouter localement (hors dépôt) un script d'init Gradle
  qui place le miroir `https://maven-central.storage-download.googleapis.com/maven2/`
  en premier. Puis `cd mobile/android && chmod +x gradlew &&
  ./gradlew testOblianceDebugUnitTest assembleOblianceDebug`. **Jamais de clé de
  signature dans le cloud** : le cloud livre du code (branche + PR), la release
  signée se fait sur le poste Windows.
- Pas d'émulateur (ni en local ni dans le cloud) : tests JVM, captures Compose
  hors émulateur (Roborazzi/Paparazzi) ; la vraie recette se fait sur le
  téléphone du propriétaire.

## ÉTAT APRÈS LA SESSION CLOUD DU 2026-09-25 (branche `mobileappdev/multiserver-web-phase0`)

Tout ce qui suit est sur la branche de la PR vers `dev`, **rien n'est déployé**.

### D. Multi-serveurs — FAIT (à relire par le propriétaire)
- `docs/obliance-mobile-design.md` révision v1.1 complète : §2.10 (modèle,
  agrégé / serveur actif, bascule explicite et implicite, actions de boîte sans
  bascule, tuile monogramme, ajout / retrait, mise à jour « plus haut
  versionCode », raccourcis), barre du haut, S10, S80, S81 « Serveur et tenant »,
  S83, S84, S86, **S92 Serveurs**, **S93 Ajouter un serveur**, routeur de liens
  (`server=`), §4 (Obliance Prod / Obliance Dev / Obliance Qual, alertes SRV-QUAL01
  et NAS-DEV01), confirmations nommant le serveur, palette serveur (§8.2),
  groupes de canaux par serveur (§9), architecture (`ServerRegistry`,
  `ServerSession`, un socket = serveur actif + sondage des autres), plan (v1
  ≈ 34 ps), risques R13–R15, questions 16–19, serveur S20.
- Maquette `docs/mobile/mockup/` : Main, TenantSwitch (« Serveur et tenant »),
  AppSettings, Notifications, More modifiés ; **ServerManage (A23)** et
  **AddServer (A24)** ajoutés ; hôtes `votre-msp` remplacés partout ;
  `canvas.json` à jour. **Le canevas en ligne (Artifact) n'a PAS été mis à
  jour** : republier depuis les fichiers.
- Tuile serveur : teinte 18 % posée sur `chrome` opaque (sinon violet / indigo
  < 4,5:1 sur `hover`) — doc, STYLEKIT et code alignés.

### A. Passe responsive web — FAITE
- A.1 : 56 clés manquantes en `en`, 59 en `fr` (appels statiques), + clés
  dynamiques (`agents.notifType.*`, `privacy.feature.*`,
  `devices.addModal.freebsd`, `terminalKeys.key.f1..f12`) ajoutées ;
  vérification = 0 manquante. Reste de l'anglais en dur dans l'onglet distant de
  `DeviceDetailPage` et dans `ProfilePage` (hors périmètre).
- A.2 : bundle esbuild OK (sans `--external:@xyflow/react` une fois les
  dépendances installées) ; `npm run build` du client OK.
- A.3 : variantes Tailwind compilées ; motifs interdits restants tous légitimes
  (passent par les utilitaires) — rien à remplacer.
- A.4 : relecture « desktop identique » : pas de régression nette trouvée
  (restent les écarts connus d'en-tête de `Modal`).
- `tsc --noEmit` : client 0 erreur ; serveur 0 erreur **une fois `shared`
  construit** (`npm run build` dans `shared/`).

### B. Tunnels distants — côté client FAIT, build serveur + client PRÊT
- Client : « Voir » / « Ouvrir » masqués sur les sessions d'un autre ;
  jamais d'onglet ni de visionneuse sans `sessionToken` (session orpheline
  terminée + message) ; 409 de la console VM affichée ; planification : message
  quand le contournement de confidentialité attend une approbation.
- Serveur : `/relay/validate-agent` corrigé (jointure via `devices.api_key_id`,
  clés actives seulement ; l'ancienne jointure sur `agent_api_keys.device_id`
  inexistant renvoyait 500 à chaque appel).
- **Build à lancer par le propriétaire : server + client** (S2/S3 du commit
  6c90079 + ce correctif + les changements client). Non testé contre une vraie
  base ni un vrai agent.
- Défauts connus toujours ouverts : exécution manuelle de script approuvée sans
  contenu de script (`approval.service._executeBatch`) ; un non-admin peut
  créer / activer des scénarios sur des machines sans `execute` (non revérifié) ;
  `PATCH /schedules/:id` : quand le contournement est restreint, le reste du
  formulaire n'est pas enregistré (202 et retour).

### C. App Android — Phase 0 : socle et preuves FAITS, reste le déplacement de la coquille
- Vérifié dans le cloud : `./gradlew test assembleDebug lintOblianceDebug` **vert**
  (7 flavors ; les 77 tests restés dans `:app` passent sur chaque flavor ; 100 tests
  dans les nouveaux modules).
- Modules du socle : `core:common` (utilitaires JVM de la coquille déplacés,
  paquets inchangés), `core:model` (profils de serveur, utilisateur),
  `core:network` (`ObliHttp` OkHttp 5 lié à une origine, `ApiOutcome` /
  `ApiResponses`, `WebCookieJar`), `core:auth` (`ServerRegistry`,
  `ServerSession`, `ServerSessions` : un seul socket, celui du serveur actif),
  `core:realtime` (Socket.IO sur OkHttp 5), `core:security` (`ActionRunner` :
  paliers, 2FA avec renvoi du même corps, approbation, confidentialité, jamais de
  rejeu), `core:data` (Android : `CookieManager`, registre en DataStore),
  `core:designsystem` (jetons Operator / Nuit, thème, typographie avec **polices
  embarquées** Inter / Rajdhani / JetBrains Mono, `ObliServerTile`, pastilles,
  tests de contraste, **captures Roborazzi**), `obliance:domain` (classement des
  alertes, À traiter multi-serveurs, corrélation). Graphe de modules vérifié à
  chaque build.
- **Preuves : `docs/mobile/phase0-proofs.md`** — sérialisation ✅, Socket.IO sur
  OkHttp 5 contre un vrai serveur Socket.IO 4.8 ✅, termlib **0.2.1** ✅ (0.3.x en
  Kotlin 2.4 ❌), Navigation 3 adaptative ✅, Room avec **KSP 2.3.12** ✅
  (KSP 2.2.10-2.0.2 ❌), Roborazzi ✅. H.264 : à faire sur appareil.
- **Reste de la Phase 0** : déplacer updater / verrou / WebHost / Worker /
  notifications dans `core:*`. Ils dépendent de `BuildConfig`, des ressources, du
  singleton `Shell` et de `MainActivity` : il faut une abstraction `AppInfo` /
  `AppGraph` et une recette sur le téléphone (la coquille 1.0.0 est en
  production) → à faire avec le début de la coquille native (v1).
- Le module `:proofs` n'est jamais embarqué ; il reste comme garde-fou de la chaîne
  d'outils (une montée d'AGP / Kotlin qui casse une preuve casse le build).

## ÉTAT AU MOMENT DE LA BASCULE CLOUD (2026-09-25, historique)

État vérifié à l'arrêt : `npx tsc --noEmit -p .` **propre** dans `client/` (hors
bruit connu `@xyflow`, module non installé localement) et dans `server/` (hors
bruit connu exceljs, bcryptjs, cron-parser, multer, playwright-chromium,
softwareRepo.routes.ts). Rien de ce qui suit n'est déployé, sauf mention.

### A. Passe responsive web (`client/`) — ≈ 95 %, reste la vérification finale
- **Fait** (implémenté, relu par un agent adversarial, correctifs appliqués) :
  fondations (`native/bridge.ts`, `utils/download|openExternal|clipboard`, hooks
  `useMediaQuery|useNativeBack|useDndSensors|useClickOutside`, primitives
  `components/common/{Modal,Drawer,ConfirmDialog,IconButton,TableScroll,
  SegmentedTabs,Tip,ActionMenu,MasterDetail,PageContainer}`), shell (tiroir sous
  1024 px, header dégradé, `FloatingDock`), et les 8 zones : composants communs +
  connexion, parc (Dashboard, Devices…), fiche machine (+ hyperv, veeam…), accès
  distant (ObliReachViewer tactile, `components/remote/*`, FileExplorer…),
  éditeur de scénarios (xyflow tactile), automatisations, politiques, admin ;
  puis un balayage global des motifs interdits.
- **Traductions** : les 13 paires `client/src/i18n/_pending/*.json` sont
  fusionnées dans `locales/en` et `locales/fr` (1 092 clés) et `_pending` est
  supprimé. Un seul désaccord, tranché en gardant l'existant :
  `groupPicker.title`.
- **Reste à faire (tâche « final-verify » non exécutée)** :
  1. **79 clés `t('…')` utilisées dans `client/src` sans entrée dans
     `locales/en/translation.json`** (82 côté fr ; plusieurs sont antérieures au
     chantier, ex. `devices.filters.*`, `cves.*`, `deviceStatus.update_error`).
     Les appels `t('clé', 'Repli')` affichent le repli ; ceux sans repli affichent
     la clé brute. Ajouter les clés manquantes en en + fr (vouvoiement).
  2. Test de bundle : `npx esbuild client/src/main.tsx --bundle
     --outfile=/tmp/b.js --loader:.svg=file --loader:.png=file
     --external:@xyflow/react --alias:@=client/src
     --alias:@obliance/shared=shared/src --define:__APP_VERSION__='"0"'
     --target=es2020 --jsx=automatic` (erreurs d'import/export que tsc rate).
  3. Compilation Tailwind (classes `coarse:`, `can-hover:`, `supports-[…]`,
     `max-*`) et comptage des motifs restants (`confirm(`, `prompt(`,
     `createObjectURL`, `navigator.clipboard`, `target="_blank"`, `window.open`,
     `opacity-0 group-hover`, `onDoubleClick`, `h-screen`, `100vh`).
  4. Relecture « desktop identique » du diff `client/` (≥ 1024 px + souris).
- **Laissé volontairement** : pas de découpage des routes en `React.lazy`
  (flash de chargement sur desktop + « Failed to fetch dynamically imported
  module » sur les WebViews longues après un redéploiement). `Modal` n'a pas de
  prop `headerClassName` : quelques en-têtes de dialogues diffèrent légèrement du
  look d'avant. Tablettes tactiles ≥ 1280 px : colonne groupes inline conservée.
- **Règles** : repli dvh = `h-dvh supports-[not(height:100dvh)]:h-screen`
  (PAS `h-screen h-dvh`, Tailwind trie les classes et vh gagne) ; i18n en forme
  `t('clé', 'Repli')`.

### B. Sécurité des tunnels distants S2/S3 (`server/`) — code fait, NON déployé
- Tunnel navigateur : authentification par cookie, seul `started_by` s'y
  connecte ; token jamais diffusé au tenant ni renvoyé dans les commandes / listes /
  logs (`services/remoteSessionSecurity.ts`, `remote.service.ts`, `index.ts`).
- Tunnel agent : la clé API doit être celle de l'appareil de la session, un seul
  agent par session, sessions fermées refusées. Canal ObliReach : uuid lié à la clé.
- S3 : capability `execute` par appareil + script du tenant sur `/scripts/:id/execute`,
  planifications (POST/PATCH) et lancements manuels de scénarios.
- Vérifié : compilation + 20 contrôles sur base simulée (pas de vraie base).
- **À faire AVANT le build serveur** (côté client, sinon régression admin) :
  masquer « Voir » / « Ouvrir » sur les sessions distantes dont
  `startedBy !== utilisateur courant` (`RemoteSessionsPage`, onglet distant de
  `DeviceDetailPage`) ; ne pas relancer de connexion ni ajouter d'onglet sans
  `sessionToken` (`ObliReachViewer` `onReconnect`, `GlobalShellPanel`) ; afficher
  l'erreur 409 de `startSession` pour la console VM (hôte injoignable) ; option :
  afficher `bypassPrivacyApproval` à la création d'une planification.
- **Défauts connus non traités** : un non-admin peut encore créer/activer des
  scénarios qui s'exécutent sur des machines sans `execute` ; une exécution
  manuelle de script approuvée ne transmet pas le contenu du script (ne peut pas
  aboutir) ; `/relay/validate-agent` joint sur `agent_api_keys.device_id` (colonne
  probablement inexistante).
- Build : le propriétaire lance lui-même `000-RegularUpdate.bat` + promotion en
  local (fichiers `.bat` hors dépôt). Le lui signaler, avec le contenu.

### C. App Android (`mobile/`)
- Coquille WebView actuelle : construite, testée (96 tests JVM), **APK release
  signé 1.0.0 (versionCode 10000)** produit en local ; `mobile/release/manifest.json`
  le décrit (l'APK lui-même est ignoré par git et reste sur le poste Windows).
  `mobile/build-android.ps1` + `RELEASE-FINGERPRINT.txt` = pipeline de release.
- **App native** : conception validée (`docs/obliance-mobile-design.md`) et
  maquette validée (`docs/mobile/mockup/`). **Prochaine étape = Phase 0**
  (design doc §10–11) : modules `core:*` agnostiques + `obliance:*`, design system
  Compose aux jetons de `docs/mobile/mockup/STYLEKIT.md`, réseau/auth/temps réel,
  preuves (terminal, navigation adaptative, sérialisation, KSP) — **en intégrant
  le multi-serveurs dès le socle** (`ServerRegistry`, session par serveur).

### D. Multi-serveurs dans la conception et la maquette — à REFAIRE (à peine commencé)
- Exigence : voir « Arbitrages validés » ci-dessus (3 serveurs, une seule app,
  bascule « Serveur › Tenant », notifications des 3 serveurs en permanence avec un
  groupe de canaux par serveur, « À traiter » agrégé avec une puce couleur par
  serveur et un filtre serveur, les listes Appareils/Flotte restent sur le serveur
  actif, raccourcis lanceur par serveur, mise à jour = plus haut versionCode
  offert par un serveur).
- `docs/obliance-mobile-design.md` contient une **édition partielle** (16 lignes
  ajoutées / 10 retirées) laissée par l'agent interrompu : la relire et la
  compléter (nouvelle section « Multi-serveurs » dans le chapitre navigation +
  mise à jour cohérente : barre du haut, À traiter, notifications, routeur de
  liens, réglages, sécurité, architecture, plan, questions ouvertes).
- Maquette à mettre à jour dans `docs/mobile/mockup/` (et sur le canevas en ligne
  si l'outil Artifact est disponible) : modifier `Main` (À traiter agrégé),
  `TenantSwitch` (devient « Serveur et tenant »), `AppSettings` (section
  Serveurs), `Notifications` (plusieurs serveurs), `More` (entrée Serveurs) ;
  ajouter `ServerManage` (liste et réglages par serveur) et `AddServer` (URL,
  vérification, SSO). Données d'exemple : serveur principal « Obliance Prod »
  (https://obliance-prod.example.org, tenants Default et ACME) + « Obliance Dev » et
  « Obliance Qual » avec leurs couleurs (distinctes du rouge de marque et des
  couleurs de statut). Format des artboards : `docs/mobile/mockup/mockup-format.md`.

### Ordre conseillé pour la session cloud
1. D (multi-serveurs doc + maquette) — le propriétaire veut le voir.
2. A.1 à A.4 (finir la passe web) puis B (ajustements client) → prévenir le
   propriétaire qu'un build **server + client** est prêt.
3. C : Phase 0 de l'app native.

**Synchronisation cloud → local** : `powershell -ExecutionPolicy Bypass -File
D:\Obliance\sync-cloud.ps1` (option `-Branch claude/xxx` pour une branche de
session cloud, `-List` pour voir les branches). Il met de côté les modifications
locales, fusionne sans jamais forcer, et s'arrête proprement en cas de conflit.

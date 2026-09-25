# Obliance mobile — document de reprise (sessions cloud et locales)

> CLAUDE.md est local (ignoré par git). Ce fichier porte ce qu'une session **cloud** doit savoir pour reprendre le chantier mobile. Le lire en entier avant de coder.

## Règles du projet à respecter
- Branche de travail : `dev` (la prod sort de `main` via le script de promotion local). En cloud : travailler sur une branche `claude/...` et ouvrir une PR vers `dev` ; le propriétaire redescend le travail en local avec `sync-cloud.ps1`.
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
- Cloud (Claude Code web) : coller `mobile/android/cloud-setup.sh` dans le
  script d'installation de l'environnement, accès réseau « Custom » +
  `dl.google.com`. Puis `cd mobile/android && chmod +x gradlew &&
  ./gradlew testOblianceDebugUnitTest assembleOblianceDebug`. **Jamais de clé de
  signature dans le cloud** : le cloud livre du code (branche + PR), la release
  signée se fait sur le poste Windows.
- Pas d'émulateur (ni en local ni dans le cloud) : tests JVM, captures Compose
  hors émulateur (Roborazzi/Paparazzi) ; la vraie recette se fait sur le
  téléphone du propriétaire.

**Travail en cours au moment de la bascule cloud (2026-09-25)**
1. **Passe responsive web** (`client/`) : partiellement faite (shell, primitives
   `components/common/*`, pont `native/bridge.ts`, utilitaires, zones communes /
   graph / admin / devices / automations). Restent : fiche machine
   (`DeviceDetailPage`, hyperv, veeam…), accès distant (`ObliReachViewer`,
   `FileExplorerTab`, `RemoteSessionsPage`), politiques, balayage global.
   **Avant tout build client** : `npx tsc --noEmit -p .` dans `client/` propre
   (hors bruit `@xyflow`) ET fusion des clés `client/src/i18n/_pending/*.json`
   dans `locales/en` et `locales/fr` puis suppression de `_pending` (sinon des clés
   brutes s'affichent). Le motif de repli dvh correct est
   `h-dvh supports-[not(height:100dvh)]:h-screen` (PAS `h-screen h-dvh`).
2. **Sécurité tunnels S2/S3** (`server/`) : fait, **non déployé**. Le build
   serveur doit partir AVEC ces ajustements client : masquer « Voir »/« Ouvrir »
   sur les sessions distantes lancées par un autre utilisateur
   (`RemoteSessionsPage`, onglet distant de `DeviceDetailPage`), ne pas relancer
   de connexion sans `sessionToken` (`ObliReachViewer`, `GlobalShellPanel`),
   afficher l'erreur 409 de la console VM.
3. **App native** : conception + maquette faites ; mise à jour « multi-serveurs »
   du design doc et de la maquette en cours ; prochaine étape = **Phase 0** du
   design doc (§10–11).

**Synchronisation cloud → local** : `powershell -ExecutionPolicy Bypass -File
D:\Obliance\sync-cloud.ps1` (option `-Branch claude/xxx` pour une branche de
session cloud, `-List` pour voir les branches). Il met de côté les modifications
locales, fusionne sans jamais forcer, et s'arrête proprement en cas de conflit.

# Obliance mobile — état d'avancement

> Tenu à jour à chaque étape. Branche `mobileappdev/multiserver-web-phase0`, PR MeeJay/Obliance#1 vers `dev`.
> Détail technique et historique : `docs/mobile/README.md` ; conception : `docs/obliance-mobile-design.md` ; preuves : `docs/mobile/phase0-proofs.md`.

## Où on en est (25/09/2026)

| Bloc | État | Vérifié | Pas vérifié |
|---|---|---|---|
| Conception multi-serveurs (doc + maquette) | Fait | Relu | Canevas en ligne pas republié |
| Passe responsive web + i18n | Fait | `tsc`, bundle, `vite build`, 0 clé manquante | Pas de recette navigateur réelle |
| Sécurité serveur (tunnels S2/S3, IP client, scénarios, fixation de session, approbations, import) | Fait | `tsc`, tests du résolveur d'IP, revue adversariale | **Pas déployé** : build server + client à lancer par le propriétaire |
| Android Phase 0 (socle `core:*`, preuves) | Fait sauf déplacement de la coquille WebView | Build, tests JVM/Robolectric, lint | — |
| **Android alpha 0.1.0 « Obliance Next »** | APK de debug livré | 880 tests, lint, captures | **Jamais lancé sur un vrai téléphone ni contre un vrai serveur** |

### Ce que fait l'alpha 0.1.0
- Connexion Obligate (WebView) ou compte local + 2FA ; plusieurs serveurs, bascule, gestion (nom, couleur, retrait).
- Thème du serveur actif (Operator / Neon / Modern) ; couleurs d'état constantes.
- À traiter multi-serveurs (escalades de droits à part, coupure de site, balayages), approbations (avec bascule de tenant).
- Appareils : liste « problèmes d'abord », fiche avec métriques CPU / RAM / disques en direct.
- Flotte, Plus.

### Ce qui manque (retour du propriétaire : « je ne peux pas faire grand-chose à part être notifié »)
- Aucune **action** sur un appareil (feuille « Agir » désactivée) : redémarrer, redémarrer l'agent, services, processus.
- **Scripts** : lancer un script sur un appareil ou plusieurs, suivre le lot, lire la sortie.
- **Scénarios** : voir, lancer ; créer / éditer (dans la vue web, comme prévu par la conception).
- **ObliReach** (visionneuse web en v1, natif en v1.1) et **terminal** (PowerShell / CMD / SSH).
- Activité, enrôlements, notifications (Worker + canaux), filtre de la vue globale, réglages de l'app, recherche.

## Livré — alpha 0.2.0 « Agir » (APK de debug, versionCode 2)

Vérifié : `./gradlew test :obliance:app:assembleDebug :obliance:app:lintDebug lintOblianceDebug` vert (1 091 tests, captures Robolectric). **Pas vérifié : aucun essai sur un vrai téléphone ni contre un vrai serveur** (bibliothèque native du terminal, biométrie, WebView, tunnels).

- Confirmations par palier (simple / empreinte / maintien 1,5 s + empreinte, alternative TalkBack), code 2FA, « demande envoyée pour approbation », déverrouillage de confidentialité ; vue web intégrée qui partage la session.
- Fiche appareil : barre d'actions selon l'OS et l'état, feuille « Agir » (redémarrer l'agent, redémarrer, veille, éteindre, analyses, isolement réseau), onglets Services, Processus (en direct, terminer), Tâches (annuler) ; sélection multiple dans la liste.
- Terminal natif PowerShell / CMD / SSH (choix de la session Windows, barre de touches, sessions conservées en arrière-plan avec notification « Tout terminer ») ; ObliReach par la visionneuse web intégrée (`/devices/:id?remote=reach`, **nécessite le prochain build client** pour s'ouvrir tout seul).
- Scripts : choix, paramètres, lot en direct, sortie, relance sur les échecs ; planifications (lecture, pause) ; scénarios (liste, exécutions, chronologie, lancement, activer / désactiver ; édition dans la vue web) ; écran Activité.

### Reste à faire (prochains incréments)
- Notifications de fond (Worker multi-serveurs, canaux par serveur), enrôlements, filtre de la vue globale, recherche / palette, réglages de l'app (forcer un thème), BitLocker, mise à jour / désinstallation de l'agent, maintenance.
- Tablette : dock de sessions ; badge de sessions sur Activité.
- ObliReach natif (v1.1), push UnifiedPush (v1.1, modification serveur S6).
- Serveur : `approvalService.sweepExpired()` jamais appelé ; approbations de gestion équipes / utilisateurs jamais exécutées ; lien direct vers un scénario dans l'éditeur web.

## Passation cloud → local (25/09/2026, fin de la session cloud)

**Récupérer** : `powershell -ExecutionPolicy Bypass -File D:\Obliance\sync-cloud.ps1 -Branch mobileappdev/multiserver-web-phase0` (26 commits au-dessus de `dev`, PR MeeJay/Obliance#1 ouverte, non fusionnée). Arbre propre, tout est poussé.

### Ce qui a été fait dans la session cloud (résumé)
1. **Conception multi-serveurs** (design doc v1.1 §2.10, écrans S92/S93, décisions 16–19 du propriétaire, thème du serveur actif) + **maquette** (A19, A23, A24). Canevas en ligne **pas** republié.
2. **Noms réels retirés** du dépôt (données d'exemple : « Obliance Prod / Dev / Qual », tenant ACME, `example.org`). ⚠️ Ils restent dans l'**historique git** (dépôt public) : commits `3d9b79b`, `6c90079`, `2b4bf1e` sur `dev`/`main` et les premiers commits de la branche. Purge = `git filter-repo --replace-text` sur toutes les branches + push forcé + support GitHub — décision du propriétaire (refusée par le garde-fou en cloud).
3. **Web** : passe responsive terminée (i18n 0 clé manquante, build OK), ajustements client des tunnels (S2), `/devices/:id?remote=reach` (ouvre ObliReach tout seul).
4. **Serveur (sécurité)** : IP client via proxys de confiance (`TRUSTED_PROXIES`, défaut `loopback, self, 172.16.0.0/12`, `TRUSTED_PROXY_HOPS=2` — rien à régler pour la stack Oblihub), porte `execute` sur les scénarios automatiques, régénération de session (fixation), exécutions de script approuvées (contenu figé par hash, double approbation impossible), planifications importées désactivées, import « écraser » limité au tenant, `/relay/validate-agent` corrigé.
5. **Android** : Phase 0 (socle `core:*`, preuves), alpha 0.1.0 puis **0.2.0 « Agir »** (voir plus haut).

### À faire côté propriétaire
- **Build server + client** (`000-RegularUpdate.bat` + promotion) : embarque tout le point 4 et le paramètre ObliReach. Non testé contre une vraie base.
- ~~Tester l'APK 0.2.0 sur le téléphone~~ **Fait le 25/09/2026 : l'APK 0.2.0 construite par le cloud est installée sur le téléphone du propriétaire et fonctionne bien** (premier essai réel).
- Décider : purge de l'historique git ; localisation visible dans `docs/screenshots/device-overview.png` (« Ormesson-sur-Marne »).
- Défauts serveur signalés, non corrigés : édition d'un script utilisé par le scénario d'un admin (hors contrôle `execute`), approbations équipes/utilisateurs jamais exécutées, `sweepExpired()` jamais appelé, responsable de scénario supprimé = pas de contrôle.

### Construire l'app en local (Windows)
- `cd mobile\android` puis `gradlew testOblianceDebugUnitTest test :obliance:app:assembleDebug` (JDK 21, SDK dans `local.properties`). APK : `obliance/app/build/outputs/apk/debug/app-debug.apk` (≈ 33 Mo, 4 ABI ; `tools.obli.obliance.next`, installable à côté de l'app WebView).
- La clé de debug locale diffère de celle du cloud : désinstaller l'APK envoyé depuis le cloud avant d'installer un build local.
- Le miroir Maven (`~/.gradle/init.d/central-mirror.gradle.kts`) n'existait que dans le conteneur cloud ; inutile en local.
- Règles de travail des modules : `mobile/android/obliance/CONTRACT.md`.

### Prochain incrément conseillé (0.3.0)
Notifications de fond multi-serveurs (Worker + canaux par serveur, escalades poussées), enrôlements, filtre de la vue globale, réglages de l'app (thème forcé, verrou), puis déplacement de la coquille WebView dans le socle (avec recette sur téléphone).

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

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

## En cours — incrément 0.2.0 « Agir »

1. Socle des actions : hôte des confirmations (paliers T1–T3, biométrie, maintien), vérification 2FA, demande d'approbation envoyée, confidentialité ; vue web intégrée (S90) qui partage la session.
2. Feuille « Agir » sur la fiche appareil : redémarrer l'agent, redémarrer, éteindre, services, processus, exécuter un script, ouvrir un terminal, voir l'écran.
3. Scripts et automations : choix du script, préparation (paramètres, cibles), lot en direct, sortie ; scénarios (liste, exécutions, lancement ; édition dans la vue web) ; écran Activité.
4. Accès distant : terminal natif (termlib 0.2.1 sur le tunnel) et ObliReach par la visionneuse web.

Chaque étape : build + tests + captures, puis APK envoyé au propriétaire.

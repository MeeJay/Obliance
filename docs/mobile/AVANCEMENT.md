# Obliance mobile — état d'avancement

> Tenu à jour à chaque étape. Branche `mobileappdev/multiserver-web-phase0`, PR MeeJay/Obliance#1 vers `dev`.
> Détail technique et historique : `docs/mobile/README.md` ; conception : `docs/obliance-mobile-design.md` ; preuves : `docs/mobile/phase0-proofs.md`.

## Où on en est (26/09/2026)

| Bloc | État | Vérifié | Pas vérifié |
|---|---|---|---|
| Conception multi-serveurs (doc + maquette) | Fait | Relu | Canevas en ligne pas republié |
| Passe responsive web + i18n | Fait | `tsc`, bundle, `vite build`, 0 clé manquante | Pas de recette navigateur réelle |
| Sécurité serveur (tunnels S2/S3, IP client, scénarios, fixation de session, approbations, import) | Fait | `tsc`, tests du résolveur d'IP, revue adversariale | **Pas déployé** : build server + client à lancer par le propriétaire |
| Android Phase 0 (socle `core:*`, preuves) | Fait sauf déplacement de la coquille WebView | Build, tests JVM/Robolectric, lint | — |
| **Android alpha 0.1.0 « Obliance Next »** | APK de debug livré | 880 tests, lint, captures | **Jamais lancé sur un vrai téléphone ni contre un vrai serveur** |
| **Android alpha 0.3.0** (notifications, enrôlements, filtre, réglages) | APK release signé `mobile/release-native/Obliance-0.3.0.apk` | 1 383 tests, lint, signataire | Pas encore installé sur le téléphone (0.2.0 : oui, fonctionne) |

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

## Livré — alpha 0.3.0 (versionCode 3, `0.3.0-alpha`, build local du 26/09/2026)

**APK release signé : `mobile/release-native/Obliance-0.3.0.apk`** (git-ignoré, 30,1 Mo, `tools.obli.obliance.next`, non minifié). Signataire (apksigner, schéma v2, un signataire) : certificat SHA-256 `8C:7E:67:F8:60:BE:AC:DE:55:AB:24:37:A4:1F:50:C6:E2:C8:F0:77:7F:2F:AC:A8:88:76:67:6C:6D:82:AC:8D`, égal à `RELEASE-FINGERPRINT.txt`.

> **Désinstallation unique avant d'installer.** La 0.2.0 du téléphone a été signée par la clé de **debug du cloud** : Android refuse de la remplacer par cette release (signataire différent). Désinstaller une fois « Obliance Next », installer la 0.3.0, puis se reconnecter aux serveurs et refaire les réglages. Les versions suivantes, signées avec la même clé, s'installeront par-dessus (et S86 pourra les proposer).

### Contenu
- **Notifications de fond de tous les serveurs** : passe WorkManager toutes les 15 min, un groupe de canaux par serveur, alertes critiques / attention, escalades, enrôlements, « Session expirée » une seule fois, astreinte (horaire, jours, règle hors astreinte, rappels des critiques), « Marquer lu » et Approuver / Refuser depuis la notification, tuile « Astreinte », écran S84, S04 (notifications, batterie, puis verrou).
- **Enrôlements** dans À traiter (segment, S12, « Tout approuver ») sur tous les serveurs.
- **Filtre de la vue globale** (S81, listes d'appareils, Flotte, puce « ACME · filtre ») ; À traiter l'applique au serveur actif.
- **Réglages de l'app** (S83 : verrou S00, captures bloquées, thème, Nuit automatique) ; **S86** À propos et mises à jour signées.
- Ouverture depuis une notification (navigation seulement, bascule serveur / tenant annoncée) ; temps réel au premier plan seulement.

### Corrections de la revue (26/09), toutes appliquées
1. **Verrou et navigation** : l'écran ouvert, les piles de chaque destination et l'état saisi survivent au verrouillage (état sauvegardé hors du verrou) ; une confirmation S41–S44 ouverte est annulée, jamais rejouée.
2. **Verrou jamais imposé** : sans choix enregistré, le verrou n'est pas armé (une 0.2.0 mise à jour ne se verrouille pas d'elle-même). S04 étape 3 « Verrouiller Obliance » le propose une fois, après les étapes des notifications ([Activer] confirme par l'empreinte, [Pas maintenant]).
3. **Passe de notifications** : chaque étape (connexion, alertes, escalades, enrôlements) a son délai de 20 s et est enregistrée dès qu'elle est finie ; une étape lente ne fait plus resonner les alertes ni perdre leurs rappels. S84 affiche « Alertes vérifiées à … ; approbations ou enrôlements non vérifiés » au lieu de « Injoignable ».
4. **Rafales** (déploiement de masse) : 3 enrôlements et 3 escalades par serveur et par passe, le reste dans une notification « N appareils / demandes en attente » qui ouvre le bon segment d'À traiter. L'app libère de la place (anciennes notifications non critiques) avant la limite d'Android (~50, au-delà les nouvelles sont perdues sans erreur) et vérifie 1,5 s après chaque passe que les critiques sont bien affichées, sinon les reposte.
5. **Rétablissements** : « De retour en ligne » ne remplace que la notification « Hors ligne » de l'appareil (la plus récente), « santé disque revenue à la normale » la santé disque, « retour à la normale » la métrique.
6. **Android 8 à 11** (l'authentification des actions de notification n'y existe pas) : l'enrôlement ne propose que « Examiner » ; une action reçue d'un téléphone verrouillé n'envoie rien.
7. **Routes de notification signées** (jeton aléatoire propre à l'installation + action attendue) : une autre app ne peut plus faire changer de serveur ou de tenant, ouvrir une page ou afficher son texte sur l'écran de verrouillage.
8. **À traiter et le filtre** : sur le serveur actif, les éléments des autres tenants sont masqués et comptés (« Filtre de la vue globale : N éléments d'autres tenants masqués ») ; les autres serveurs ne sont pas filtrés ; une notification retrouve quand même un élément masqué.

### Vérifié (26/09/2026, Windows, JDK 21)
- `gradlew.bat --no-daemon test :obliance:app:lintDebug lintOblianceDebug :obliance:app:assembleRelease` → **BUILD SUCCESSFUL**.
- **Tests : 1 383, 0 échec, 0 ignoré** (tous modules, coquille WebView comprise : 7 × 77) : `:obliance:notifications` 86, `:obliance:triage` 117, `:obliance:more` 81, `:obliance:app` 41 (dont verrouiller / déverrouiller dans la vraie coquille), 2 tests Robolectric sous Android 11 (API 30) pour les actions depuis un téléphone verrouillé. Tous les tests de la 0.2.0 passent.
- Lint : 0 erreur (`:obliance:app:lintDebug` 7 avertissements, `lintOblianceDebug` 17).
- `aapt2 dump badging` : `tools.obli.obliance.next`, versionCode 3, `0.3.0-alpha`.

### Pas vérifié (aucun essai sur le téléphone ni contre un vrai serveur)
- Passe de 15 min sous Doze (délai réel), avec et sans exemption de batterie ; comportement réel près de la limite de ~50 notifications.
- Actions de notification derrière l'authentification (Android 12+) et depuis l'écran verrouillé.
- Verrou S00 (empreinte, code, délais, retour sur l'écran quitté), S04 étape 3, blocage des captures (miniature des récents).
- Tuile « Astreinte », autorisation POST_NOTIFICATIONS (Android 13+), ouverture d'une notification à froid, bascule de tenant réelle.
- Mise à jour depuis S86 (aucun serveur ne publie de manifeste pour `tools.obli.obliance.next`).

### Modifications serveur nécessaires (non faites, contournées côté app)
1. **Alertes live (S1)** : aucune alerte à la création d'une approbation à deux ni à l'arrivée d'un agent en attente d'enrôlement, pas de champ `category`. Ajouter ces deux alertes (`/admin/security?approval=:id`, `/devices/:id`, `stableKey device:<id>:pending_enrolment`) et `category` (offline | metric | disk_health | recovery | identity | approval | enrolment). *Contournement* : interrogation de `/api/approvals` et `/api/devices?approvalStatus=pending` à chaque passe, catégorie déduite du titre français.
2. **Approuver / refuser depuis le tenant maître** (`POST /api/devices/:id/approve|refuse`, `/bulk/approve`) : l'UPDATE vise le tenant 1, l'appareil d'un tenant enfant reste en attente mais la route répond 200, déclenche `agent_approved` et l'audit ; le bulk renvoie `ids.length`. Agir dans le tenant de l'appareil (audité) ou répondre 404/409 ; déclencheur et audit seulement si une ligne a changé ; vrai compte. *Contournement* : bascule de tenant avant, statut vérifié après, rechargement.
3. **`GET /api/agent/keys`** renvoie le secret `key` à qui n'a que `agent_config:approval`. Le masquer sauf administrateur ou `agent_config:keys`. *Contournement* : le DTO de l'app ignore ce champ.
4. **Aucun événement socket à l'arrivée d'un agent en attente** : émettre `DEVICE_UPDATED` (ou `DEVICE_REGISTERED`) au salon du tenant et à la vue maître. *Contournement* : interrogation toutes les 60 s (écran) et à chaque passe.
5. **Filtre de la vue globale** : `tenantIds` (tenant maître) sur `/api/devices/summary`, `/group-stats`, `/disk-saturated`, `/fleet-hourly`, `/fleet-timeseries`, `/api/updates/stats`, plus un point « comptes par tenant » (`/api/devices/tenant-facets`). *Contournement* : comptes par requêtes filtrées (12 tenants max), cartes non filtrées légendées.
6. **Canal de mise à jour de l'app native** : `GET /api/mobile/android/version` et `/download` ne servent que la coquille WebView. Ajouter p. ex. `?app=obliance-next` (`manifest-next.json` + `obliance-next.apk`, mêmes contrôles, accès public). *Contournement* : S86 dit qu'aucune mise à jour n'est publiée ; installation manuelle.
7. **`approvalService.sweepExpired()` jamais appelé** : l'appeler périodiquement (et émettre `APPROVAL_UPDATED`). *Contournement* : filtre sur `expiresAt`.
8. **Renouvellement de session** (S13) : le cookie expire 7 jours après le dernier `Set-Cookie`, donc une notification « Session expirée » par serveur et par semaine environ. Sessions glissantes ou `POST /api/auth/refresh`.
9. **`/api/live-alerts/all` limité aux 200 plus récentes** : ajouter `?sinceId=`. *Contournement* : une alerte sortie de la liste est considérée comme résolue.
10. **Push instantané** (S6, v1.1, pas pour la 0.3.0) : `POST/DELETE /api/mobile/push/subscriptions` + UnifiedPush.

### À faire côté propriétaire
- Désinstaller la 0.2.0, installer `Obliance-0.3.0.apk`, dérouler la liste « Pas vérifié ».
- Git : rien n'est commité ; le commit `4d91c96` contenait une version intermédiaire de `NotificationChannelsTest.kt` qui ne compile pas, la bonne est dans l'arbre de travail.

### Prochain incrément conseillé (0.4.0)
Recherche / palette (S82), « Surveiller » (suivi d'un appareil jusqu'au rétablissement), tenant restauré et piles mémorisées par serveur (§2.10), puis push UnifiedPush (v1.1, modification serveur S6).

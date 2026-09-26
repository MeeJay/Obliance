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
| **Android alpha 0.3.1** (alertes résolues, escalade qui remplace) | APK release signé `mobile/release-native/Obliance-0.3.1.apk` | 1 413 tests, lint, signataire | Ni téléphone ni serveur réel : exige le prochain build **server + client** (> 5.1.113 / 5.1.105) ; champ serveur `activeIds` (grand parc) encore à faire |

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

## Livré — alpha 0.3.1 (versionCode 4, `0.3.1-alpha`, build local du 26/09/2026) — un rétablissement remplace l'alerte

**APK release signé : `mobile/release-native/Obliance-0.3.1.apk`** (git-ignoré, 30,1 Mo, `tools.obli.obliance.next`, non minifié, SHA-256 du fichier `E125BEE1…6467B72E`). Signataire (apksigner, schéma v2, un signataire) : certificat SHA-256 `8C:7E:67:F8:…:6D:82:AC:8D`, égal à `RELEASE-FINGERPRINT.txt`. S'installe par-dessus la 0.3.0 (même clé) ; depuis la 0.2.0 (clé de debug du cloud), désinstaller d'abord.

> **Exige le serveur et le web suivants** (build **server + client** après 5.1.113 / 5.1.105, migration 126). Contre un serveur plus ancien, l'app garde le comportement 0.3.0 (« Rétabli à HH:mm »), en remplaçant au lieu d'empiler.

Demande du propriétaire : « une notification de rétablissement remplace voire supprime une notification d'alerte/critique », pour ne pas noyer les notifications sous le flap. Côté serveur (fait en parallèle, contrat S1–S8) : une alerte dont l'incident se rétablit ou s'aggrave est **résolue** (cachée de toutes les listes, plus de ligne « retour à la normale »), et l'événement socket `NOTIFICATION_RESOLVED {ids}` part vers les mêmes salons que `NOTIFICATION_NEW`.

### Contenu (app)
- **À traiter** : alertes actives seulement ; `NOTIFICATION_RESOLVED` du serveur actif les retire aussitôt, badge compris ; un rafraîchissement en vol ne les fait pas revenir.
- **Notifications de fond** : à chaque passe, une notification dont l'alerte n'est plus active (résolue, supprimée) disparaît avec son rappel. Décidé seulement sur une liste lue en entier : échec, délai dépassé ou forme inattendue ne retirent rien. La liste s'arrête à 200 lignes, seuil atteint chaque soir sur un grand parc (chaque poste éteint garde une alerte « Hors ligne » active) : le champ `activeIds` de la réponse (tous les ids actifs, sans plafond) tranche pour les plus anciennes. Sans lui (serveur qui ne l'envoie pas) ou s'il est douteux (malformé, ou il y manque plus de quelques lignes listées), une liste pleine garde ce qui est plus ancien que sa dernière ligne. Un serveur 0.3.1 ne produit plus de « Rétabli » : la notification d'alerte disparaît, tout simplement (les canaux du serveur — ntfy, mail… — gardent leur message de rétablissement).
- **Escalade** (attention → critique, nouvelle panne après un retour) : remplace la notification précédente du même incident (appareil + type : métrique, hors ligne, santé disque, ID agent dupliqué ; `Incidents` dans `:obliance:domain`) au lieu d'empiler ; de plusieurs nouvelles alertes d'un même incident, seule la plus récente est notifiée.
- **App ouverte** : `NOTIFICATION_RESOLVED` retire les notifications tout de suite (puis encore une fois après une passe en cours, dans une coroutine à part : l'écoute du socket n'attend jamais le verrou des passes, sinon son tampon perdrait les événements suivants).
- **À traiter, course** : un rafraîchissement en vol ne fait pas disparaître l'alerte qu'un `NOTIFICATION_NEW` a apportée pendant sa lecture (la nouvelle moitié d'une escalade) ; le rafraîchissement suivant tranche.
- **Serveur plus ancien** (lignes « retour à la normale ») : comportement 0.3.0 conservé (la notification devient « Rétabli à HH:mm ») ; la panne suivante du même appareil la remplace, donc une seule notification par appareil et type pendant un flap. Un retour à la normale ne vise qu'une notification plus ancienne que lui, et ne fait rien si une alerte plus récente du même incident l'a dépassé (attention → normal → critique : la critique reste critique, avec ses rappels). La plus récente alerte d'un incident est choisie parmi celles qui peuvent sonner (portée, astreinte, app au premier plan) : en « Critiques seulement », une attention plus récente ne masque plus une critique encore active.

### Vérifié (26/09/2026, Windows, JDK 21)
- `gradlew.bat --no-daemon --continue test :obliance:app:assembleRelease :obliance:app:lintDebug` → **BUILD SUCCESSFUL** (4 min 32 s).
- **Tests : 1 413, 0 échec, 0 ignoré** (tous modules, coquille WebView comprise : 7 × 77) : `:obliance:notifications` 105 (dont 18 `NotificationResolveTest`), `:obliance:triage` 117, `:obliance:devices` 116, `:obliance:more` 81, `:obliance:app` 41, data 32, api 15, domain 13 (`IncidentsTest`). Tous les tests de la 0.3.0 passent.
- Lint `:obliance:app:lintDebug` : 0 erreur, 7 avertissements (les mêmes qu'en 0.3.0).
- `aapt2 dump badging` : `tools.obli.obliance.next`, versionCode 4, `0.3.1-alpha`, minSdk 26, targetSdk 37.
- Un test 0.3.0 (« 9 alertes → 5 notifications ») utilisait 9 alertes de 2 appareils : réécrit avec 9 appareils (une notification par incident désormais).
- Corrections de revue (26/09/2026) : `activeIds`, écoute du socket hors verrou, course escalade / rafraîchissement, retours à la normale d'un serveur ancien, plus récente alerte choisie parmi celles qui sonnent. 7 tests ajoutés (api 15, data 32, `NotificationResolveTest` 18) ; chacun échoue quand on retire sa correction (vérifié par mutation).

### Pas vérifié
- Rien n'a tourné contre un vrai serveur (build server + client pas encore lancé) ni sur le téléphone : disparition réelle des notifications au rétablissement (passe de 15 min et app ouverte), escalade attention → critique, flap hors ligne / en ligne, badge d'À traiter.
- Côté serveur/web, seulement `tsc`, le script PGlite (17 vérifications) et le script du store web : ni migration 126 sur la vraie base, ni recette navigateur.

### À faire côté propriétaire
- Lancer le build **server + client**, puis installer `Obliance-0.3.1.apk` par-dessus la 0.3.0 et dérouler la liste « Pas vérifié ».

### Dépend du serveur (à confirmer au build serveur)
1. `GET /api/live-alerts/all` : alertes **actives** seulement, lues ET non lues, 200 au plus, id décroissant.
2. `NOTIFICATION_RESOLVED` avec `{ids: number[]}` (ids numériques) au salon `tenant:<id>:notifications`, pour toute résolution (rétablissement, escalade, métrique mise en sourdine).
3. Escalade ou nouvelle occurrence = nouvelle ligne à l'id plus grand (sinon le téléphone ne la notifie pas).
4. Clés stables inchangées (`device:<id>:metric:warning|critical`, `offline`, `diskhealth:caution|bad`, `duplicate_agent_id`) ; titres inchangés (repli quand la clé manque).
5. **À faire côté serveur** : `GET /api/live-alerts/all` renvoie aussi `activeIds: number[]`, les ids de TOUTES les alertes actives (`resolved_at IS NULL`) des mêmes tenants que `alerts` (`user_tenants`), sans plafond (index partiel `live_alerts_active_tenant_id_idx` de la migration 126). **Pas encore écrit** dans `liveAlert.controller.ts`. Sans ce champ, sur un grand parc, une notification plus ancienne que les 200 lignes listées reste affichée jusqu'à ce que la liste redescende sous 200 (souvent le lendemain matin). L'app s'en sert dès qu'il est présent et reste compatible sans.
6. **À signaler côté serveur** : `trimTenant` garde d'abord les lignes actives, mais au-delà de 200 alertes actives dans un tenant il supprime les plus anciennes sans événement : une alerte encore ouverte disparaît alors du web et, avec `activeIds`, sa notification aussi.

### Prochain incrément conseillé (0.4.0)
Recherche / palette (S82), « Surveiller » (suivi d'un appareil jusqu'au rétablissement), tenant restauré et piles mémorisées par serveur (§2.10), puis push UnifiedPush (v1.1, modification serveur S6).

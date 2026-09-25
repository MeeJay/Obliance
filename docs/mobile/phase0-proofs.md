# Obliance Android — rapport des preuves de la Phase 0

Chaîne d'outils visée (design doc §10.1) : Gradle 9.7, AGP 9.3.1 à **Kotlin intégré 2.2.10**, Compose BOM 2026.08.00, compileSdk 37, JDK 21.
Toutes les preuves sont exécutées dans le build (`./gradlew test`) ; le code est dans `mobile/android/proofs`, `core/realtime`, `core/designsystem`.
Vérifié le 25/09/2026 dans une session cloud (Linux, SDK 37, sans émulateur).

| # | Sujet | Résultat | Décision | Où |
|---|---|---|---|---|
| P1 | **kotlinx.serialization** (plugin de compilation) avec Kotlin intégré | ✅ Compile et tourne (classe valeur, énumérations, valeurs par défaut, décodage tolérant) | Plugin `org.jetbrains.kotlin.plugin.serialization` 2.2.10 adopté pour les modules natifs ; la coquille garde l'API arbre | `core:model`, `core:auth` (tests) |
| P2 | **Socket.IO** : `io.socket:socket.io-client` 2.1.2 (déclare OkHttp 3.12) forcé sur **OkHttp 5.5.0** | ✅ Contre un vrai serveur Socket.IO **4.8.3** (Node) : cookie de session dans la poignée de main, événements, accusés, refus « Unauthorized », reconnexion | Bibliothèque retenue, OkHttp 3 exclu ; le client Engine.IO maison (repli R5) n'est pas nécessaire | `core:realtime` `RealtimeProofTest` (sauté si Node absent) |
| P3 | **termlib** (libvterm + rendu Compose) | ✅ **0.2.1** compile et se lie (API `TerminalEmulatorFactory.create`, `Terminal(...)`). ❌ 0.3.x est compilé avec Kotlin **2.4** : métadonnées illisibles par 2.2.10 | Figer **0.2.1** (dernière version compilée en Kotlin 2.3) tant qu'AGP n'embarque pas Kotlin ≥ 2.3. Taille native : 3,5 Mo (arm64), 2,6 Mo (armv7), 3,2 Mo (x86_64). L'exécution (JNI) reste à vérifier sur le téléphone | `proofs/TerminalProof.kt` |
| P4 | **Navigation 3** 1.2.0 + **adaptive-navigation3** 1.3.0 (scène liste-détail) | ✅ Exécuté sous Robolectric : téléphone 390 dp = un seul volet (détail), tablette 1280 dp = liste + détail, espace réservé « Sélectionnez un appareil » | Navigation 3 adoptée (le repli Navigation Compose 2.9 est abandonné). API 1.2 : `sceneStrategies = listOf(...)` | `proofs/NavigationProof*.kt` |
| P5 | **KSP2 + Room** 2.8.4 | ❌ KSP `2.2.10-2.0.2` refusé par Kotlin intégré (« kotlin.sourceSets DSL … not allowed »). ✅ **KSP 2.3.12** (versionné indépendamment de Kotlin) : Room généré et exécuté (SQLite Robolectric) | **Room** retenu pour le cache v1.1 (SQLDelight écarté), avec KSP ≥ 2.3.12 | `proofs/RoomProof*.kt` |
| P6 | **Captures sans émulateur** : Roborazzi 1.75.0 + Robolectric 4.17 (SDK 35, rendu natif) | ✅ Captures PNG des jetons et composants, thèmes Operator et Nuit | Outil de captures retenu (§10.11) ; les images de référence restent à enregistrer | `core/designsystem` `DesignSystemScreenshotTest` → `build/outputs/roborazzi` |
| P7 | Décodage H.264 sur 3 SoC | ⏳ Non faisable sans appareil | À faire sur le téléphone du propriétaire (v1.1) | — |

**Environnement cloud** : SDK installé par `mobile/android/cloud-setup.sh` (réseau « Custom » + `dl.google.com`). Maven Central répond parfois 429 derrière le proxy : un script d'init Gradle local (hors dépôt) place le miroir `maven-central.storage-download.googleapis.com` en premier.

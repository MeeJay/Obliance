# Obli Shell — coquille Android de la suite Obli

Application Android native (Kotlin) qui affiche le client web d'une app Obli
**chargé depuis son serveur** (`https://<serveur>/`) dans une WebView durcie, et
qui lui ajoute ce qu'un navigateur ne sait pas faire : pont natif, téléchargements
authentifiés, notifications en arrière-plan, verrouillage biométrique, mises à jour
signées depuis le serveur.

Un seul projet, **une _flavor_ par app Obli** (Obliance, Obliview, Obliguard,
Oblimap, Obliplan, Oblidesk, Oblihub). Aucune ligne de Kotlin n'est propre à une
app : seules les ressources (nom, couleurs, icône) changent.

Le contrat commun avec le client web (détection, pont `window.ObliNative`, retour
Android, téléchargements, distribution de l'APK, notifications) est
**[`docs/obli-mobile.md`](../../docs/obli-mobile.md)**. Toute évolution du pont
commence par ce document.

---

## Sommaire

1. [Architecture](#1-architecture)
2. [Construire](#2-construire)
3. [Ajouter une app Obli (flavor)](#3-ajouter-une-app-obli-flavor)
4. [Signature](#4-signature)
5. [Processus de release](#5-processus-de-release)
6. [Le keystore — trois copies, trois histoires](#6-le-keystore--trois-copies-trois-histoires)
7. [Comportements détaillés](#7-comportements-détaillés)
8. [Limites connues](#8-limites-connues)

---

## 1. Architecture

### Chaîne d'outils

| Élément | Version |
|---|---|
| Gradle (wrapper) | 9.7.0 |
| Android Gradle Plugin | 9.3.1 — **Kotlin intégré** (ne jamais appliquer `org.jetbrains.kotlin.android`) |
| Kotlin / plugin Compose | 2.2.10 (imposé : égal au Kotlin embarqué par AGP 9.3.1) |
| Compose BOM | 2026.08.00 (Material 3) |
| compileSdk / targetSdk / minSdk | 37 / 37 / 26 |
| JDK | 21 (`C:\Program Files\Android\openjdk\jdk-21.0.8`), cible JVM 17 |
| Bibliothèques clés | androidx.webkit 1.17.1, androidx.browser 1.10.0 (Custom Tabs), androidx.biometric 1.1.0, WorkManager 2.11.2, kotlinx-serialization-json 1.9.0 (API `JsonElement` seulement, sans plugin) |

Pas de filtre d'ABI (Kotlin pur) : l'APK s'installe sur ARM 32/64 bits et x86.
R8 est **actif** en release (minification + réduction des ressources).

### Arborescence

```
mobile/build-android.ps1         # script de release : build, vérifications, dépôt dans mobile/release/ (§5)
mobile/android/
├── VERSION                      # versionName (MAJOR.MINOR.PATCH) — source unique de la version
├── RELEASE-FINGERPRINT.txt      # empreinte SHA-256 attendue du certificat de signature (§4)
├── app/build.gradle.kts         # LA table des apps + signature + versionCode
├── app/proguard-rules.pro       # règles R8 (pont WebView)
├── app/lint.xml
└── app/src/
    ├── main/kotlin/tools/obli/shell/
    │   ├── MainActivity.kt          # activité unique : WebView + surcouches Compose
    │   ├── ObliShellApplication.kt  # singletons (Shell), canaux, verrou, WorkManager
    │   ├── core/     # préférences, JSON, UA, réinitialisation de session, liens entrants
    │   ├── nav/      # Origins + NavigationPolicy (JVM pur, testé) + parsing sso-config / manifest
    │   ├── net/      # normalisation d'URL serveur, HTTPS GET minimal, appels serveur
    │   ├── web/      # WebHost (WebView), clients WebView/Chrome, téléchargements, liens externes
    │   ├── bridge/   # protocole, validation, script injecté, NativeBridge
    │   ├── update/   # manifeste, vérification SHA-256 + certificat, installation
    │   ├── alerts/   # parsing /api/live-alerts/all, high-water mark, Worker périodique
    │   ├── lock/     # verrouillage biométrique
    │   ├── notify/   # canaux et publication des notifications
    │   ├── settings/ # écran de réglages natif (Compose)
    │   └── ui/       # thème Obli, écrans (configuration, erreur, WebView obsolète, verrou), dialogues
    ├── main/res/                    # chaînes EN (values/) et FR (values-fr/), icônes génériques
    ├── obliance/res/drawable/       # icônes propres à Obliance (générées depuis D:\Logos\SVG\Ance.svg)
    └── test/kotlin/...              # tests JVM
```

### Principe de fonctionnement

1. **Configuration** : au premier lancement, l'écran natif demande l'URL du serveur
   (pré-remplie par `BuildConfig.DEFAULT_SERVER_URL`, ou par le lien profond
   `obli-<id>://setup?server=https://…`). L'URL est normalisée (espaces, `https://`
   ajouté, barre oblique finale retirée, **seule l'origine est conservée** — les apps
   Obli sont servies à la racine) et **HTTPS est obligatoire** (le cookie de session
   est `Secure`). Elle est validée par `GET <serveur>/api/auth/sso-config` (JSON
   attendu), ce qui fournit aussi l'origine Obligate.
2. **WebView** : une seule, jamais rechargée par une rotation ou le clavier
   (`configChanges`). JavaScript + DOM storage actifs, aucun accès fichier/contenu,
   contenu mixte interdit, Safe Browsing actif, multi-fenêtres activé pour capter
   `window.open`/`target=_blank`, UA = UA par défaut + ` ObliShell/<version> (<id>; Android)`.
   Plein écran bord à bord : barres système + clavier appliqués en marge, barres en
   `#0f1220` (modifiables par le pont).
3. **Politique de navigation** (`nav/NavigationPolicy.kt`) : serveur et Obligate
   restent dans la WebView (le SSO doit rester dans le même stock de cookies) ; les
   autres apps Obli (apprises via `/api/oblitools/manifest`) ouvrent leur propre
   coquille Android si elle est installée, sinon un Custom Tab ; tout autre lien web
   ouvre un Custom Tab ; `mailto:`/`tel:`/`otpauth:`/`intent:` partent vers Android ;
   le reste est bloqué.
4. **Pont** : `window.__obli_native` et `window.ObliNative` sont injectés au début de
   chaque document **de l'origine du serveur uniquement**
   (`addDocumentStartJavaScript` + `addWebMessageListener`).
5. **Surcouches natives** (Compose, au-dessus de la WebView) : configuration, erreur
   de chargement, WebView obsolète, verrouillage, dialogues JavaScript, mise à jour.

---

## 2. Construire

Prérequis sur la machine de build (PowerShell, une commande par ligne) :

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
cd D:\Obliance\mobile\android
```

`local.properties` (ignoré par git, modèle : `local.properties.example`) doit
contenir le SDK :

```properties
sdk.dir=D\:/LifeTrack/.android-sdk
```

Commandes :

```powershell
.\gradlew.bat testOblianceDebugUnitTest      # tests JVM
.\gradlew.bat assembleOblianceDebug           # APK debug (tools.obli.obliance.debug)
.\gradlew.bat assembleOblianceRelease         # APK release (R8), signé si la signature est configurée
.\gradlew.bat lintOblianceDebug               # lint (abortOnError : les erreurs cassent le build)
```

Sorties :

- `app/build/outputs/apk/obliance/debug/app-obliance-debug.apk`
- `app/build/outputs/apk/obliance/release/app-obliance-release.apk` (signé) ou
  `app-obliance-release-unsigned.apk` (sans signature configurée)
- `app/build/outputs/mapping/oblianceRelease/mapping.txt` (à archiver avec chaque
  release pour décoder les traces)

Serveur par défaut d'une flavor (facultatif ; vide = écran de configuration vide) :
propriété `obli.<id>.server.url` en `-P`, dans `local.properties`, ou en variable
d'environnement `OBLI_<ID>_SERVER_URL`. Exemple :

```powershell
.\gradlew.bat assembleOblianceRelease "-Pobli.obliance.server.url=https://obliance.exemple.fr"
```

Pour publier une release, ne pas assembler à la main : utiliser
`mobile/build-android.ps1` (§5), qui vérifie la signature et écrit le manifeste.

Les builds debug portent le suffixe `.debug` : debug et release s'installent côte à
côte. Le premier build télécharge les dépendances absentes du cache Gradle (réseau
requis).

---

## 3. Ajouter une app Obli (flavor)

1. **Une ligne dans la table** de `app/build.gradle.kts` :
   ```kotlin
   ObliApp("oblinew", "Oblinew", "#aabbcc", "#ccddee"),
   ```
   Cela crée la flavor `oblinew`, l'`applicationId` `tools.obli.oblinew`, le schéma de
   lien profond `obli-oblinew://`, `BuildConfig.OBLI_APP`, les couleurs
   `obli_accent`/`obli_accent2` et le nom `app_name`. L'id est aussi ajouté à
   `BuildConfig.OBLI_APP_IDS`, utilisé pour reconnaître les autres apps Obli.
2. **Icône** (facultatif) : sans rien faire, l'app reçoit l'icône générique « O » à sa
   couleur. Pour un vrai logo, créer `app/src/oblinew/res/drawable/` avec :
   - `ic_launcher_foreground.xml` — premier plan de l'icône adaptative (108 dp, logo
     de 60 dp centré dans la zone sûre de 66 dp) ;
   - `ic_launcher_monochrome.xml` — même tracé, une seule couleur (icônes thématiques
     Android 13+) ;
   - `ic_brand_mark.xml` — tracé plein monochrome (teinté par l'UI) ;
   - `ic_notification.xml` — tracé blanc sur transparent (barre d'état).

   Les fichiers d'Obliance ont été générés depuis `D:\Logos\SVG\Ance.svg` (chemins SVG
   convertis tels quels en `VectorDrawable`, dégradés linéaires compris) : reprendre la
   même méthode avec le SVG de l'app.
3. **Aucun Kotlin à écrire.** Côté serveur, l'app doit exposer le même contrat :
   `GET /api/auth/sso-config`, `GET /api/oblitools/manifest`,
   `GET /api/live-alerts/all` et `GET /api/mobile/android/{version,download}`
   (`docs/obli-mobile.md` §6–7). Côté client web, adopter le module `native/bridge.ts`.
4. Construire : `.\gradlew.bat assembleOblinewRelease` (tâches générées :
   `test<Id>DebugUnitTest`, `assemble<Id>Debug`, `lint<Id>Debug`…).

---

## 4. Signature

| | |
|---|---|
| **Keystore** | `D:\keys\obli-release.jks` — **hors du dépôt**, 4 372 octets, ne change jamais |
| **Alias** | `obli` (RSA 4096, `CN=Obli Shell, OU=Self-hosted, O=BinaryHearts, L=Paris, C=FR`, valide jusqu'au 2056-09-16) |
| **Mot de passe** | `D:\keys\obli-release-password.txt` — le même mot de passe **sur deux lignes identiques** (format `--ks-pass file:` / `--key-pass file:` d'`apksigner`, qui lit une ligne par mot de passe demandé dans le même fichier ; `keytool -storepass:file` lit la première) |
| **Empreinte du certificat** | [`RELEASE-FINGERPRINT.txt`](RELEASE-FINGERPRINT.txt) : `8C:7E:67:F8:…:6D:82:AC:8D` — c'est le `signerSha256` du manifeste |
| **Portée** | une seule clé signe **toutes** les flavors (toutes les apps Obli) |

- Gradle signe la release avec les quatre valeurs `obli.keystore.file`,
  `obli.keystore.password`, `obli.key.alias`, `obli.key.password`, déjà renseignées dans
  `local.properties` (ignoré par git). Elles peuvent aussi venir de `-P` ou des variables
  d'environnement `OBLI_KEYSTORE_FILE`, `OBLI_KEYSTORE_PASSWORD`, `OBLI_KEY_ALIAS`,
  `OBLI_KEY_PASSWORD`. Sans aucune : APK release **non signé** (pas d'erreur Gradle, mais
  `build-android.ps1` refuse de le publier). Avec seulement une partie : le build
  **échoue** (erreur de configuration explicite).
- `local.properties` est chargé explicitement par `app/build.gradle.kts` (Gradle ne le
  fait pas seul : c'est ainsi que LifeTrack a un jour perdu sa clé).
- **Ne jamais** afficher, journaliser, copier ou commiter les mots de passe ni le
  keystore ; ne jamais déplacer le keystore (`local.properties` pointe dessus). `*.jks`,
  `*.keystore`, `.secrets/` et `local.properties` sont ignorés par git, et tout
  `mobile/android/` est hors du contexte Docker.
- **Ne jamais régénérer la clé** : un APK signé par une autre clé ne peut pas mettre à
  jour les installations existantes (voir §6).
- Relire l'empreinte à la main (sur un JDK en français, `-J-Duser.language=en` est
  indispensable pour obtenir les libellés anglais) :
  ```powershell
  & 'C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe' '-J-Duser.language=en' -list -v -keystore D:\keys\obli-release.jks -alias obli -storepass:file D:\keys\obli-release-password.txt
  ```
  ```powershell
  & 'D:\LifeTrack\.android-sdk\build-tools\37.0.0\apksigner.bat' verify --print-certs D:\Obliance\mobile\release\obliance.apk
  ```
  → la ligne `SHA256:` de `keytool` et la ligne `certificate SHA-256 digest:`
  d'`apksigner` doivent valoir `RELEASE-FINGERPRINT.txt` (casse et `:` ignorés).
  **Si elle diffère : s'arrêter et ne rien publier.**

---

## 5. Processus de release

Une seule commande (PowerShell, depuis n'importe quel dossier) :

```powershell
powershell -ExecutionPolicy Bypass -File D:\Obliance\mobile\build-android.ps1
```

1. **Avant** : incrémenter `mobile/android/VERSION` (`MAJOR.MINOR.PATCH`, minor et
   patch ≤ 99). Le `versionCode` en découle : `major*10000 + minor*100 + patch`
   (`1.0.0` → 10000, `1.2.3` → 10203). Seul le `versionCode` est comparé par la coquille.
2. **Le script** (`mobile/build-android.ps1`, Windows PowerShell 5.1) :
   - positionne `JAVA_HOME` (`C:\Program Files\Android\openjdk\jdk-21.0.8`) et lit
     `VERSION` ;
   - supprime les APK release périmés de la flavor, puis lance
     `gradlew test<App>DebugUnitTest assemble<App>Release` (`--no-daemon` et Kotlin en
     processus : aucun démon ne survit au script, sinon un appelant qui lit sa sortie
     par un tube attendrait des heures) ; `lintVital` tourne pendant l'assemblage ;
   - **refuse** un APK non signé (message explicite sur la configuration de signature) ;
   - `apksigner verify --print-certs` : l'empreinte du certificat doit être **égale** à
     `RELEASE-FINGERPRINT.txt`, sinon arrêt **avant** toute copie ;
   - `aapt2 dump badging` : `package` (= `tools.obli.<app>`), `versionCode` et
     `versionName` (= `VERSION`), `minSdk` ;
   - copie l'APK dans `mobile/release/<app>.apk` (copie vérifiée par SHA-256) et écrit
     `mobile/release/manifest.json` (UTF-8 sans BOM) avec exactement les champs lus par
     `server/src/controllers/mobileApp.controller.ts` : `schema`, `app`, `packageName`,
     `version`, `versionCode`, `minSupportedVersionCode`, `minSdk`, `sha256`,
     `sizeBytes`, `signerSha256`, `builtAt` ;
   - affiche une ligne de résumé ; code de sortie **non nul** à la moindre erreur.

   Paramètres : `-App obliance` (défaut ; une flavor de la table), `-MinSupported 10000`
   (défaut : 1.0.0, la première release ; les coquilles sous ce `versionCode` sont forcées
   à se mettre à jour ; il ne peut pas dépasser le `versionCode` construit),
   `-JavaHome`, `-BuildToolsVersion 37.0.0`. Le lint complet reste à lancer à part si
   besoin : `.\gradlew.bat lintOblianceDebug`.
3. Facultatif : `mobile/release/RELEASE_NOTES.md` (affiché dans le dialogue de mise à jour).
4. Reconstruire l'image **server** (l'APK y est embarqué) et déployer. Le serveur annonce
   `available: true` dès que `versionCode > 0` et que `obliance.apk` existe.
5. Archiver `app/build/outputs/mapping/<app>Release/mapping.txt` avec cette version
   (le script affiche son chemin) : sans lui, les traces R8 sont illisibles.

Côté appareil : vérification automatique au plus une fois par 24 h (et à la demande
dans les réglages ou via `ObliNative.checkForUpdate()`), téléchargement par
`DownloadManager` dans le dossier privé de l'app, puis vérification **du SHA-256 et
du certificat signataire** (égal à celui de l'app installée — rotation v3 acceptée —
et à `signerSha256`), et enfin installateur Android via `FileProvider`
(`<applicationId>.updates`), après l'autorisation « installer des applis inconnues »
si besoin.

---

## 6. Le keystore — trois copies, trois histoires

`D:\keys\obli-release.jks` est **le seul fichier irremplaçable** de la coquille Android.
Le perdre signifie qu'**aucune mise à jour ne s'installera plus jamais** par-dessus les
coquilles déjà installées, pour **toutes** les apps Obli : Android refuse une mise à jour
signée par une autre clé, et la coquille elle-même refuse tout APK dont le signataire
diffère du sien. Seule issue alors : désinstaller puis réinstaller à la main sur chaque
appareil (serveur à reconfigurer, réglages et verrouillage perdus), sans aucun moyen de
le faire à distance.

Aujourd'hui il n'en existe **qu'une copie**, sur le disque de la machine de build : un
disque qui meurt emporte la clé. La politique, reprise de LifeTrack
(`D:\LifeTrack\ops\README.md`, « Le keystore Android — trois copies, trois histoires »),
est d'en tenir **trois copies hors machine dont les histoires de récupération sont
indépendantes** :

| Copie | Où | Histoire de récupération |
|---|---|---|
| **A** | pièce jointe dans le **gestionnaire de mots de passe** (le `.jks` et le mot de passe dans la même entrée) | n'implique **aucune** clé de chiffrement ni aucun support physique |
| **B** | **archive chiffrée** (`age` vers deux identités, ou 7-Zip AES-256 avec `-mhe=on` et une phrase de passe **différente** du mot de passe du keystore) sur un **support hors machine** (clé USB rangée ailleurs, disque d'une autre machine) | n'implique **pas** le gestionnaire de mots de passe |
| **C** | **papier** : le keystore en base64 (4 372 octets → 5 832 caractères) coupé en six blocs, un QR code par bloc, sur une feuille A4 | n'implique **aucun** outil, compte ni format |

Ces trois histoires sont **indépendantes** : perdre le gestionnaire n'empêche pas de
retrouver la clé (B et C), perdre la phrase de passe de l'archive non plus (A et C).
L'indépendance est la conception ; la redondance n'en est que la conséquence.

> La feuille papier ne sert que si elle porte **aussi le mot de passe** : le seul scénario
> où elle est utile est la perte simultanée de la machine, du gestionnaire et du support
> hors machine. C'est alors un secret complet, à ranger comme un passeport — jamais
> photographié, jamais scanné vers un service en ligne.

**Faire les copies sans outil supplémentaire** (Git Bash, rien ne sort de la machine) :

```bash
base64 -w0 /d/keys/obli-release.jks > keystore.b64
split -n 6 -d keystore.b64 bloc
cat bloc0? > recompose.b64 && cmp keystore.b64 recompose.b64
base64 -d recompose.b64 > restaure.jks && cmp /d/keys/obli-release.jks restaure.jks
```

(`cmp` doit rester silencieux.) Chaque `bloc0N` devient un QR code
(`qrencode -o blocN.png < bloc0N`, sur une machine qui l'a, hors réseau), ou à défaut
s'imprime en police monospace.

**Puis la seule étape qui prouve quelque chose** : signer réellement un APK jetable avec
la copie restaurée et relire l'empreinte. Un keystore qui s'ouvre n'est pas un keystore
qui signe. Dans le dossier de `restaure.jks` (PowerShell, une commande par ligne) :

```powershell
Copy-Item D:\Obliance\mobile\release\obliance.apk .\jetable.apk
```
```powershell
& 'D:\LifeTrack\.android-sdk\build-tools\37.0.0\apksigner.bat' sign --ks .\restaure.jks --ks-key-alias obli --ks-pass file:D:\keys\obli-release-password.txt --key-pass file:D:\keys\obli-release-password.txt --out .\resigne.apk .\jetable.apk
```
```powershell
& 'D:\LifeTrack\.android-sdk\build-tools\37.0.0\apksigner.bat' verify --print-certs .\resigne.apk
```

→ `certificate SHA-256 digest:` doit valoir exactement `RELEASE-FINGERPRINT.txt`. Si
elle diffère : **s'arrêter**, la copie est mauvaise.

Effacer ensuite `keystore.b64`, `bloc0?`, `recompose.b64`, `restaure.jks`,
`jetable.apk` et `resigne.apk` : c'est le keystore en clair, ou ce qu'il a produit.

**Une fois par an**, comme un rendez-vous et non une suggestion : ouvrir chaque copie
(`keytool -list -v -keystore …`, voir §4) et comparer l'empreinte. Une copie jamais
ouverte est une hypothèse.

> **État au 2026-09-25 : les trois copies ne sont PAS encore faites.** Tant qu'elles ne
> le sont pas, la clé de toutes les coquilles Obli tient sur un seul disque.

---

## 7. Comportements détaillés

### Pont `window.ObliNative` (bridgeVersion 1)

Référence : `docs/obli-mobile.md` §3. Transport : objet `__obliBridge`
(`addWebMessageListener`, origine du serveur seulement, cadre principal seulement),
requête `{id, method, params}`, réponse `{id, ok, result}` / `{id, ok:false, error}`.
`params` peut être un objet nommé (ce qu'envoie le wrapper injecté) ou un tableau
positionnel dans l'ordre du contrat. Tous les paramètres sont validés (types, tailles,
noms de fichiers assainis, URL même origine pour `downloadUrl`, schémas autorisés pour
`openExternal`, chemins relatifs même origine pour `notify`).

Précisions d'implémentation :

- `saveFile` : MediaStore Téléchargements (API 29+) ; en dessous, dossier public
  Téléchargements avec `WRITE_EXTERNAL_STORAGE` (demandée au besoin, `maxSdkVersion
  28`). Résout `{uri}` (URI `content://` de l'app, jamais un chemin). Base64 accepté
  avec ou sans préfixe `data:…;base64,`, 48 Mio de texte au plus.
- `downloadUrl` : résout `{id}` (identifiant `DownloadManager`).
- `notify` : résout `true` si la notification a été publiée, `false` sinon
  (permission refusée).
- `setSystemBars(colorHex, lightTheme)` : `lightTheme = true` signifie « le thème
  web est **clair** » → icônes **sombres** (`isAppearanceLightStatusBars`) ;
  `false` → thème sombre, icônes claires. Pour une couleur nettement sombre ou
  nettement claire, la coquille impose le contraste lisible quelle que soit la valeur
  reçue ; `lightTheme` ne décide que pour les tons moyens (absent : icônes sombres,
  meilleur contraste dans cette plage). Logique : `SystemBarContrast.lightIcons`.
- `checkForUpdate({prompt})` : résout `{available, versionName, versionCode}` et, si
  une mise à jour est disponible, affiche aussi le dialogue natif (sauf
  `{prompt:false}`).
- `requestNotificationPermission` : `'granted'` ou `'denied'`.
- Retour Android : `window.__obliHandleBack()` d'abord (s'il renvoie `true`, l'appui
  est consommé), puis `goBack()`, puis fermeture.
- Événements `obli:pause` / `obli:resume` à la mise en arrière-plan / au retour.

### Téléchargements

- Même origine que le serveur : `DownloadManager` avec le cookie de session et l'UA,
  nom tiré de `Content-Disposition` (`filename*` UTF-8 d'abord), notification visible.
- Autre origine : Custom Tab.
- `blob:` / `data:` : ignorés (journalisés) — le client web passe par `saveFile`.

### Notifications en arrière-plan

Tâche WorkManager toutes les 15 min (réseau requis) sur `GET /api/live-alerts/all`
avec le cookie de la WebView. Premier passage après activation : seul le repère
(plus grand id) est enregistré. Ensuite, seules les alertes non lues d'id supérieur
sont notifiées (5 au plus par passage, plus un résumé). Un canal par sévérité
(critique, avertissement, information). Un tap ouvre l'app sur `navigateTo`
(chemin relatif du serveur uniquement). Session expirée (401) : une seule
notification « Reconnectez-vous » et suspension jusqu'à la prochaine ouverture de
l'app.

### Verrouillage et confidentialité

Biométrie forte ou code de l'appareil (sur Android 9–10, biométrie « faible » ou
code, la combinaison forte + code n'y étant pas prise en charge), au démarrage à
froid et après 5 minutes en arrière-plan. Si l'appareil n'a plus aucun verrouillage,
l'option est désactivée plutôt que de bloquer l'utilisateur. Option « Bloquer les
captures d'écran » (`FLAG_SECURE`). Aucune sauvegarde (`allowBackup=false`, règles
d'extraction vides).

### WebView système

La page est rendue par la WebView Chromium du système (mise à jour par le Play Store,
indépendamment d'Android). Au démarrage, la coquille affiche l'écran « WebView
obsolète » (« Mettre à jour » ouvre sa fiche du store, « Continuer quand même »
l'écarte) si la version majeure est **inférieure à 100**
(`WebViewVersion.MIN_MAJOR`) ou si `WEB_MESSAGE_LISTENER` / `DOCUMENT_START_SCRIPT`
manquent (pont impossible). Seuil volontairement bas : Android 8 (minSdk 26) sans mises
à jour peut rester sur de vieilles versions.

Entre 100 et 107, l'app fonctionne mais **sans les unités CSS `dvh`** (arrivées avec
Chromium 108). Le client web accompagne ses hauteurs en `dvh` de replis en `vh` : sur
ces versions les hauteurs plein écran retombent sur `vh`. Dans la WebView (pas de barre
d'adresse escamotable, fenêtre redimensionnée par le clavier) l'écart est minime, d'où
l'absence d'avertissement. Relever `MIN_MAJOR` au-delà de 100 seulement si le client
web cesse de fournir ces replis.

### Autres apps Obli

Une coquille ouvre un lien d'une autre app Obli en envoyant l'action
`tools.obli.action.OPEN_URL` au paquet `tools.obli.<app>`. La coquille destinataire
n'ouvre que les pages de **son** serveur (jamais `/api/…` ni `/auth/…` sauf
`/auth/sso-redirect`) ; non configurée, elle propose ce serveur à l'écran de
configuration.

---

## 8. Limites connues

- Les tests couvrent la logique pure (politique de navigation, URL, pont, manifeste,
  versionCode, alertes, verrouillage) et exécutent le script injecté dans Node ; il
  n'y a pas de test instrumenté (pas d'émulateur sur la machine de build). Le
  comportement WebView réel se vérifie sur appareil.
- Notifications en arrière-plan par sondage (15 min minimum, retardées par Doze et
  les surcouches constructeur) : le temps réel en arrière-plan viendra avec
  UnifiedPush (contrat §7, v2).
- La session web dure 7 jours côté serveur : au-delà, la notification « Reconnectez-vous »
  apparaît.

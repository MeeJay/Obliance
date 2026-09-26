# Validation liée à l'appareil (item 17) : spécification d'implémentation

> **Statut.** Spécification finale, prête à découper en lots. Aucun code n'est écrit.
> Rédigée le 2026-09-26 à partir de trois sources : le brouillon de conception, deux revues de sécurité et une relecture du code en lecture seule.
> Toutes les références `fichier:ligne` datent de ce jour. Un autre chantier modifie le dépôt en ce moment : **revérifier chaque référence avant de patcher.**
>
> **Décision du propriétaire.** Sur l'app Android native, une biométrie forte (empreinte, ou visage de classe 3) remplace la saisie du code 2FA (TOTP), **sans abaisser la sécurité**.
>
> Les choix que le propriétaire peut encore changer sont marqués **[Dn]**. Ils sont tous regroupés au §14, chacun avec une recommandation.
>
> Conventions : prose en français, identifiants (routes, champs, colonnes, classes) en anglais. « Le téléphone » désigne l'app native `tools.obli.obliance.next` (`:obliance:app`). « La clé » désigne la clé Keystore d'un couple (utilisateur, serveur) sur ce téléphone.

---

## 0. Résumé

**La clé.** Chaque couple (utilisateur, serveur) reçoit, sur chaque téléphone, une clé ECDSA P-256 :
- elle est générée dans l'Android Keystore (StrongBox si le téléphone en a un, sinon TEE) et n'est pas exportable ;
- chaque signature exige une biométrie **BIOMETRIC_STRONG**, et le code de l'appareil n'est jamais accepté. C'est le Keystore qui l'impose, pas seulement l'invite, et l'attestation le prouve au serveur ;
- la clé meurt si une nouvelle biométrie est ajoutée ou si le verrouillage d'écran est retiré.

**L'enrôlement.**
- Il se fait une fois par serveur, depuis l'app.
- Il exige le **mot de passe** et un **code TOTP neuf**, c'est-à-dire jamais vu, ni même à la connexion.
- Le serveur ne garde que la clé publique, après avoir vérifié l'attestation Android jusqu'aux racines matérielles de Google.

**La session liée.** Dès que le serveur voit la clé d'un téléphone, la session de ce téléphone lui est rattachée. Toute requête portant ce cookie, écrans natifs comme pages web de l'app, suit alors trois règles :
- plus de raccourci « IP de confiance » ;
- code seul refusé : il faut l'empreinte, ou **mot de passe + code** en secours [D2] ;
- révoquer la clé tue la session.

**Chaque usage.**
- Le serveur émet un **défi** : usage unique, 120 s, lié à l'utilisateur, à la session, à la clé, au tenant, à l'action et à l'empreinte (hash) de la requête exacte.
- L'app le signe après la biométrie, puis le serveur vérifie la signature.
- La signature est acceptée partout où un code l'est aujourd'hui : l'enveloppe de restriction (32 appels directs), `requireFreshTotp` sauf `ssh-authorize-ip` [D6], et la connexion des comptes locaux (mot de passe + empreinte) [D7].

**Ce qu'elle ne remplace jamais :** l'enrôlement, la gestion du TOTP, le mot de passe de confidentialité, les approbations à deux et la MFA de connexion d'Obligate.

**La révocation** agit par deux mécanismes complémentaires :
- des hooks, pour l'effet immédiat et l'audit ;
- une **version d'identifiants** tenue par un trigger PostgreSQL. Tout changement de mot de passe, de TOTP ou d'activation invalide les clés, même par un chemin qui aurait oublié son hook.

Toute révocation tue les sessions liées et les IP de confiance de l'utilisateur.

**Comptes Obligate (SSO).**
- Ils sont **refusés tant qu'Obligate n'a pas le lot O** (§6.10, annexe C) : réauthentification fraîche, anti-rejeu du TOTP, époque MFA et synchronisation des réinitialisations.
- Obliance détecte cette capacité chez Obligate et ouvre le SSO automatiquement quand elle est là, en échec fermé [D1].
- Le persona principal utilise des comptes `og_` : **sans le lot O, la fonctionnalité ne sert pas au quotidien.**

**Compatibilité.**
- Le web de bureau ne change pas : il n'a jamais de session liée.
- Un ancien app ne change pas : il n'envoie jamais l'en-tête.
- Un nouvel app sur un ancien serveur retombe sur le code, puisque `GET /api/profile/device-keys` répond 404.

**Prérequis serveur (§6.0).** P1 à P6 corrigent des failles existantes qui rendraient l'enrôlement exploitable. Ils peuvent partir seuls, avant tout le reste.

---

## 1. Périmètre

**Dans le périmètre**
- **Android** : l'app native `:obliance:app` (package `tools.obli.obliance.next`), seule détentrice de clés, avec les modules `core:*` et `obliance:*` touchés (§7).
- **Serveur** :
  - stockage, vérification, session liée, révocation, audit et politiques ;
  - les prérequis P1 à P6 ;
  - l'intégration Obligate (lot O, détecté par capacité).
- **Web** :
  - la liste des téléphones dans le profil et dans l'administration des utilisateurs, avec révocation ;
  - les réglages de plateforme ;
  - la fenêtre 2FA, qui gère « mot de passe + code » et le pont natif pour les pages web ouvertes dans l'app (S90).

**Hors périmètre (inchangé)**
- Les passkeys et WebAuthn : le web ne signe jamais.
- La MFA de **connexion** Obligate. Pour un compte `og_`, le téléphone ne remplace que le code de step-up.
- Le mot de passe et le déverrouillage de confidentialité (`privacyGate.routes.ts`). C'est le consentement du propriétaire de la machine : une assertion n'y est **jamais** acceptée.
- L'approbation ou le refus d'une demande à deux (`approval.routes.ts`), qui n'a pas de 2FA aujourd'hui [D20].
- Le ProxyJump SSH (`sshBastion/jumpAuthz.ts`) : aucun corps HTTP ne peut y porter une assertion.
- L'explorateur de fichiers par socket (`socket.ts`), qui n'accepte aucun code aujourd'hui.
- Les actions depuis une notification : paliers T0 ou T1 seulement, et aucune activité ne peut afficher d'invite (design §7.6).
- L'ancienne coquille WebView `:app`.
- Les corps `multipart` (upload d'avatar), qui ne portent pas de preuve aujourd'hui non plus.

---

## 2. Suite donnée à la revue de sécurité

Toutes les constatations bloquantes et majeures sont retenues. Aucune n'est rejetée. Deux constatations mineures sont traitées autrement que proposé, et la raison est donnée dans la colonne « Décision ».

| # | Gravité | Constat (résumé) | Décision | Où |
|---|---|---|---|---|
| R1 | **Bloquant** | Pour un compte SSO, une clé rend le step-up indépendant d'Obligate. Une réinitialisation MFA côté Obligate ne la révoque pas. | **Accepté.** Enrôlement SSO refusé tant qu'Obligate n'a pas le lot O, détecté par capacité en échec fermé. Lot O : époque MFA vérifiée à chaque usage (cache 5 min, échec fermé), synchronisation `credentials-changed` avec file et reprise, réauthentification fraîche avec OTP pour enrôler, et anti-rejeu des pas TOTP chez Obligate. | §4.10, §6.10, annexe C, [D1] |
| R2 | Majeur | Un téléphone déverrouillé ou prêté (PIN connu) contourne l'empreinte de trois façons : l'IP de confiance, le code lu dans l'authentificateur du même téléphone, et la bascule silencieuse sur le code après invalidation. La formule « TOTP ∧ clé » était fausse. | **Accepté.** Session liée : l'IP de confiance est ignorée et jamais accordée, le code seul est refusé (mot de passe + code en secours), et une clé invalidée ou révoquée tue la session. Le §3 est corrigé : sans session liée, c'est TOTP **ou** clé. | §4.7, §6.2, §3, [D2] |
| R3 | Majeur | Fraîcheur de l'enrôlement : le code de connexion n'avance pas `totp_last_step`, et le code Obligate n'a pas de mémoire. | **Accepté.** Toutes les vérifications TOTP locales passent par `verifyTotpStep`, connexion comprise. L'enrôlement exige mot de passe + pas strictement nouveau. Pour le SSO, réauthentification Obligate fraîche, et Obligate enregistre les pas. | §6.0 P3, §6.5, annexe C |
| R4 | Majeur | Force brute : 10 échecs / 15 min donnent 83 % de succès en un an, et un succès devient une clé permanente. | **Accepté.** Compteurs persistés : 10 / 15 min puis 429, et 30 / 24 h qui bloquent le code jusqu'à une reconnexion complète. Enrôlement : 3 échecs / 24 h le bloquent 24 h. E-mail au 5e échec, audit de chaque échec, fenêtre TOTP ±30 s [D11]. Le mot de passe est exigé à l'enrôlement. | §6.8, [D11], [D12] |
| R5 | Majeur | La liaison ne couvre pas le tenant de session, qui peut basculer entre le défi et la signature. | **Accepté.** Le tenant entre dans la liaison et dans le défi. L'app refuse de signer si le tenant du défi diffère du sien, et l'invite nomme le tenant. Nouveaux vecteurs. | §4.5, §7 |
| R6 | Majeur | Révoquer un téléphone ne coupe ni sa session ni les IP de confiance. | **Accepté.** `session.deviceKeyId` est posé à la liaison. Chaque révocation supprime les sessions liées et toutes les IP de confiance de l'utilisateur. Le middleware détruit une session liée dont la clé n'est plus active (cache 30 s). | §4.7, §6.4, §6.7 |
| R7 | Majeur | Assertion refusée puis code : l'assertion périmée reste dans le corps, et le serveur ne regarde jamais le code. | **Accepté.** Côté serveur : si `twoFactorCode` est présent, seul le code est évalué. Côté app : chaque réponse retire les preuves de l'autre type. Test dédié. | §6.2, §7.2 |
| R8 | Majeur | Révocation par hooks seuls : un chemin oublié ou un retour arrière de version laisse une clé vivante. | **Accepté.** Colonne `users.credential_version` incrémentée par un trigger sur mot de passe, TOTP, activation et identité SSO. La clé mémorise la version à l'enrôlement. Un écart à l'usage révoque la clé (`credentials_changed`). | §5.2, §6.7 |
| r1 | Mineur | L'origine d'enrôlement est tirée de `Host` par défaut. | **Accepté.** Plus de repli sur `Host` : `APP_URL` ou `DEVICE_KEY_ORIGINS` est obligatoire, sinon 403 `device_keys_origin_unset`. Le passage du `X-Forwarded-Proto` du client dans `client/nginx.conf` n'influence plus la fonctionnalité ; il reste un durcissement séparé (P7, non bloquant). | §4.6, [D17] |
| r2 | Mineur | Assertion groupée : jusqu'à 50 défis d'actions différentes pour une seule empreinte. | **Accepté.** Si `count > 1` : même `action_key`, même `bulk_id` déclaré à l'émission, même tenant, défis émis à moins de 60 s d'écart. L'invite affiche N et l'action. | §4.9.4 |
| r3 | Mineur | Attestation : keybox fuitée, lecture des tags dans la mauvaise liste, `allApplications`, et échec ouvert si Google est injoignable. | **Accepté.** Tags lus uniquement dans la liste matérielle du niveau attesté, niveaux égaux, `allApplications` refusé, échec fermé si la liste de révocation date de plus de 7 jours [D4]. Le résidu « keybox fuitée » est documenté. RKP obligatoire reporté [D5]. | §4.3, §3 |
| r4 | Mineur | Des clés « non vérifiées » survivent au passage `require_attestation=true`. | **Accepté.** Révocation `policy` au basculement, plus un contrôle à l'usage. | §6.7, §9 |
| r5 | Mineur | Les compteurs couplés permettent un déni de service. | **Accepté.** Compteurs séparés : code par utilisateur, assertion par session. Émission de défis limitée par session et par utilisateur. | §6.8 |
| r6 | Mineur | Course entre sélection, vérification et consommation du défi. | **Accepté.** Consommation par une seule instruction `UPDATE … FROM` conditionnée à la clé active et à la version d'identifiants. `exp` est lu en base. La signature ne sert jamais de clé anti-rejeu. | §6.3 |
| r7 | Mineur | L'app choisit la clé par origine seule, ce qui pose problème après un changement de compte. | **Accepté.** Clé et en-tête indexés par (origine, userId serveur). Purge seulement si l'utilisateur de la clé est celui de la session. `origin` de `StepUpRequired` rempli depuis `response.request.url`. Test « pas de redirection ». | §7.1, §7.2 |
| r8 | Mineur | `ssh-authorize-ip` ouvrirait l'IP CGNAT de l'opérateur. | **Accepté.** `allowDevice:false` sur `profile.ssh_authorize_ip`. | §6.6, [D6] |
| r9 | Mineur | Les biométries déjà présentes (famille) peuvent valider. | **Accepté.** Documenté au §3 et affiché à l'enrôlement (S85). | §3, annexe B |

**Constats trouvés pendant la relecture**
- **P5 revu.** Recopier `twoFactorCode` dans `req.body` après `validate()` aurait fait fuiter les preuves dans les journaux (`schedule.routes.ts:266`, `:369` journalisent `req.body`), dans les charges d'approbation (`users.controller.ts:54`, `:86`, `teams.controller.ts:58`) et dans les insertions qui étalent le corps. La solution retenue est l'inverse : un middleware global **retire** les preuves du corps avant tout routeur et les range dans `req.stepUpProof` (§6.0 P5).
- **Hors périmètre, à traiter séparément.** `users.controller.ts:54` stocke le corps de création d'un utilisateur, **mot de passe compris**, dans `approvalPayload` (chemin « restricted »).

---

## 3. Modèle de menace et risques résiduels

**Propriété visée.** Pour chaque requête, les preuves acceptées sont :
- sans session liée : celles d'aujourd'hui (IP de confiance, code), avec l'anti-rejeu et les plafonds en plus ;
- en session liée : l'assertion de la clé liée, ou mot de passe + code (comptes locaux), ou réauthentification Obligate + code (SSO, lot O).

L'assertion n'est acceptée **qu'en session liée**, et elle est au moins aussi forte qu'un code :
- elle n'est pas exportable ;
- elle ne peut pas être relayée ;
- elle est liée à la requête exacte ;
- elle exige le doigt.

La sécurité n'est donc jamais inférieure à aujourd'hui, et elle est supérieure sur le téléphone enrôlé.

| Menace | Parade | Ce qui reste |
|---|---|---|
| **Téléphone perdu ou volé, verrouillé** | Clé `setUnlockedDeviceRequired(true)` (API 28+), biométrie à chaque usage, non exportable. Verrou d'app S00, chiffrement au repos. L'utilisateur révoque depuis le web, ce qui **tue la session du téléphone** (§6.7). | Rien d'utilisable sans déverrouiller le téléphone. |
| **Téléphone volé déverrouillé ou prêté (PIN connu)** | La clé refuse le PIN (`userAuthType` = biométrie seule, attesté). En session liée : IP de confiance ignorée, code seul refusé, il faut mot de passe + code. Ajouter son empreinte invalide la clé : l'app le signale, et le serveur tue la session, donc reconnexion avec mot de passe (§4.9.5). Retirer le verrouillage d'écran détruit la clé. | Les actions **non sensibles** restent exposées comme aujourd'hui (le S00 accepte le PIN). |
| **Biométries déjà enregistrées (conjoint, enfant)** | Texte explicite à l'enrôlement : « Toute empreinte ou tout visage enregistré sur ce téléphone pourra valider. Retirez ceux des autres personnes avant d'activer. » | Accepté : c'est la définition de BIOMETRIC_STRONG. |
| **Téléphone rooté, bootloader déverrouillé** | Attestation : `deviceLocked=true` et `verifiedBootState=Verified`, sinon refus [D3]. | (1) Un exploit root à l'exécution sur un téléphone verrouillé peut substituer les octets signés après une vraie empreinte : au plus un abus par contact, lié à cette session et à ce défi. (2) Une **keybox d'usine fuitée**, pas encore révoquée par Google (TrickyStore et consorts), peut produire une chaîne « Verified » pour une clé logicielle. Parade partielle : liste de révocation en échec fermé [D4], RKP obligatoire en option [D5]. Toute 2FA sur téléphone compromis a cette limite. |
| **Clonage des données de l'app, sauvegarde** | `allowBackup=false`, `fullBackupContent=false` (manifeste actuel). La clé ne quitte jamais le matériel sécurisé. Un enregistrement restauré sans sa clé est détecté (alias absent) puis purgé. | Aucun. |
| **Cookie de session volé (web ou téléphone)** | Le voleur peut obtenir un défi mais pas le signer. Il ne peut pas enrôler (mot de passe + pas TOTP neuf) ni remplacer le TOTP (P2). Force brute bornée à 30 essais avant blocage du code (§6.8). Les assertions du téléphone sont liées à ses propres requêtes et consommées une fois. | Le voleur peut lister ou révoquer des clés (déni de service), et utiliser une IP de confiance web existante comme aujourd'hui si la session volée n'est pas liée. |
| **Force brute du code** | 10 échecs / 15 min, puis 30 / 24 h : le code est bloqué jusqu'à une reconnexion complète. E-mail au 5e échec, audit de chaque échec. Fenêtre ±30 s [D11]. | Au plus 30 essais par cycle de blocage, soit une probabilité d'environ 9·10⁻⁵ par cycle avec la fenêtre ±30 s. L'utilisateur est prévenu. |
| **Phishing en temps réel (relais)** | Seule l'app signe, et seulement les défis reçus en réponse à ses propres requêtes vers son origine configurée. L'origine d'enrôlement est fixée par la configuration, jamais par `Host`. L'enrôlement exige mot de passe + un **second** code distinct de celui de la connexion. E-mail d'enrôlement [D13] et liste dans le profil. | Un phisher qui relaie en direct le mot de passe **et deux codes successifs** peut enrôler son téléphone : c'est la même persistance qu'aujourd'hui en remplaçant le TOTP. L'e-mail et la liste le rendent visible. |
| **Serveur B malveillant (autre profil de l'app)** | Clés indexées par (origine, userId). L'origine vient de `ObliHttp`, jamais d'une réponse, et elle est signée. Le serveur A exige `origin == key.origin`. `followRedirects(false)` est testé. | B ne peut abuser que de sa propre clé. |
| **Rejeu** | Nonce aléatoire de 32 octets, usage unique atomique, TTL 120 s, liés à la session, au tenant et à la requête. | Aucun. |
| **Bascule de tenant entre défi et signature** | Tenant dans la liaison, dans le défi et dans l'invite. L'app refuse si le tenant du défi diffère du tenant attendu par l'action. | Aucun. |
| **Doigt contraint (force, sommeil)** | `setConfirmationRequired(true)`. L'invite nomme l'action, la cible, le serveur et le tenant. Les actions « restricted » exigent toujours un second administrateur. Tout est audité. Le mode « verrouillage » d'Android coupe la biométrie. | Accepté, comme toute biométrie. |
| **Prise de compte par l'enrôlement** | Mot de passe + pas TOTP neuf, utilisateur actif, 3 échecs / 24 h, 5 clés au plus, e-mail, audit. P1 et P2 ferment les chemins « gestionnaire d'utilisateurs » et « cookie seul ». | Voir le phishing ci-dessus. |
| **Révocation d'un téléphone perdu** | Effet immédiat sur les nouvelles requêtes : sessions liées supprimées, IP de confiance de l'utilisateur supprimées, défis ouverts brûlés. | Une requête déjà en cours se termine. |
| **Changement d'identifiants par un chemin sans hook, ou retour arrière de version** | `credential_version` tenue par un trigger en base. Tout écart révoque à l'usage, et le trigger survit à un retour arrière du code. | Aucun, tant que la migration n'est pas annulée. |
| **Départ de l'utilisateur** | Désactivation locale ou `deactivate` Obligate : sessions tuées (P6), clés révoquées, `credential_version` incrémentée. Suppression : cascade. | Retirer l'utilisateur d'une équipe laisse la clé, mais il n'a plus de droits. |
| **Compte SSO : réinitialisation MFA chez Obligate** | Sans lot O, l'enrôlement SSO est refusé. Avec le lot O : époque MFA vérifiée à l'usage (5 min, échec fermé) et synchronisation poussée. | Fenêtre de 5 min au plus si la synchronisation poussée échoue. |
| **Script malveillant dans une page web de l'app (XSS)** | Le pont `signDeviceChallenge` ne signe que pour l'origine de la vue web, qui doit être l'origine du serveur actif, et pour la clé liée à la session. L'invite est construite en natif à partir du défi. Chaque signature exige le doigt. | Même exposition qu'un XSS qui afficherait la fenêtre de code aujourd'hui. |
| **Déni de service par les compteurs** | Compteurs d'assertion par session, compteurs de code par utilisateur, émission limitée par session. | Le détenteur d'un cookie peut gêner **sa** session et bloquer le code (pas l'empreinte). |
| **Fuite de la base** | Seules des clés publiques sont stockées. | Aucun. |

---

## 4. Protocole

### 4.1 Vocabulaire

- **Clé** : ligne `user_device_keys`, ou alias Keystore côté app. Un `keyId` (UUID généré par le serveur) par couple (utilisateur, serveur, installation).
- **Session liée** : session Express dont `req.session.deviceKeyId` désigne une clé **active** de `req.session.userId`, alors que la politique est active (§9). Tant que la politique est coupée, une session liée se comporte comme une session non liée.
- **Défi** : ligne `device_key_challenges`, à usage unique.
- **Assertion** : signature d'une **charge** (§4.4) couvrant 1 à 50 défis.
- **Preuves** : champs de corps `twoFactorCode`, `trustIp`, `stepUpPassword`, `deviceAssertion` et `deviceBulkId`. Ils sont retirés du corps avant tout routeur (P5) et exclus de la liaison.

### 4.2 La clé (Android)

- EC P-256 (`secp256r1`), `SHA256withECDSA`, signatures DER, usage SIGN uniquement.
- Clé publique envoyée en SubjectPublicKeyInfo DER (`PublicKey.getEncoded()`), base64 standard.
- **Alias** : `obli.devkey.v1.<hex16>` avec `hex16` = 16 premiers caractères hexadécimaux de `sha256(origin + "\n" + userId + "\n" + installId)`.

Paramètres communs à tous les niveaux d'API :

```kotlin
KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
    .setDigests(KeyProperties.DIGEST_SHA256)
    .setUserAuthenticationRequired(true)
    .setInvalidatedByBiometricEnrollment(true)
    .setAttestationChallenge(nonce)          // 32 octets, reçus de enrol/begin
```

| API | Paramètres ajoutés | Invite |
|---|---|---|
| 26–27 | `setUserAuthenticationValidityDurationSeconds(-1)` : authentification par opération, empreinte seule. Pas de StrongBox. | androidx.biometric bascule sur FingerprintManager avec `CryptoObject` |
| 28–29 | Idem, plus :<br>• `setIsStrongBoxBacked(true)` si `FEATURE_STRONGBOX_KEYSTORE`. Sur `StrongBoxUnavailableException` **ou toute `ProviderException`**, on recommence sans StrongBox (TEE).<br>• `setUnlockedDeviceRequired(true)`. | `BiometricPrompt` du framework + `CryptoObject` |
| 30–37 | `setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)` au lieu de la validité -1. StrongBox et « déverrouillé » comme en 28–29. | Idem |

**Paramètres toujours exclus.**
- `setDevicePropertiesAttestationIncluded(true)`, qui exposerait l'IMEI et le numéro de série.
- Android Protected Confirmation.
- `setAttestKeyAlias`.

**Contrôle local après génération.** Sur API 31+, `KeyInfo.securityLevel` doit valoir STRONGBOX ou TRUSTED_ENVIRONMENT ; en dessous de 31, `isInsideSecureHardware` doit être vrai. Sinon l'alias est supprimé et l'app affiche « non protégée par le matériel ». Ce contrôle ne sert qu'au message : c'est le serveur qui décide, sur l'attestation.

**Santé de la clé (`keyHealth`).** L'app appelle `Signature.initSign(privateKey)` sans authentification.
- Sur une clé saine à authentification par opération, l'appel réussit.
- Une `KeyPermanentlyInvalidatedException` signifie que la clé est invalidée.
- Un alias absent signifie que la clé a été perdue.

L'app fait ce contrôle au retour au premier plan et avant chaque signature.

### 4.3 Attestation (serveur, à l'enrôlement seulement)

L'app envoie `KeyStore.getCertificateChain(alias)` (feuille en premier), en base64 DER. Le serveur vérifie, dans cet ordre :

1. **Forme.** 2 à 10 certificats, chacun lisible par `crypto.X509Certificate`.
2. **Chaîne.** Pour tout `i < n-1` : `chain[i].checkIssued(chain[i+1])` et `chain[i].verify(chain[i+1].publicKey)`. Les certificats autres que la feuille doivent être dans leur validité (tolérance 5 min). La validité de la feuille est ignorée, car Android y met des dates arbitraires.
3. **Racine.**
   - Elle est auto-signée, et `sha256(SPKI DER)` figure parmi les **clés racines d'attestation matérielle de Google épinglées** : la racine RSA et la nouvelle racine ECDSA.
   - Les valeurs sont prises sur `https://android.googleapis.com/attestation/root` **au moment de l'implémentation**, puis écrites en dur dans `attestationRoots.ts`. Elles ne sont jamais téléchargées à l'exécution, pour que les installations sans accès Internet fonctionnent.
   - On épingle les clés, pas les certificats, parce que Google réémet les racines avec la même clé.
4. **Révocation.**
   - Aucun numéro de série de la chaîne (hexadécimal minuscule, sans zéros de tête) ne doit être `REVOKED` ni `SUSPENDED` dans `https://android.googleapis.com/attestation/status`.
   - La liste est mise en cache 24 h en mémoire et dans `/custom/device-keys/attestation-status.json`.
   - Si Google est injoignable, un cache de 7 jours au plus est accepté. Au-delà, ou sans cache : avec `require_attestation`, refus `422 attestation_failed {reason:'status_unavailable'}` [D4] ; sans lui, la clé est acceptée en `unverified`.
5. **Clé.** La SPKI de la feuille est identique, octet pour octet, à `publicKey`.
6. **Extension KeyDescription.** L'extension (OID `1.3.6.1.4.1.11129.2.1.17`) est présente dans la feuille et **dans aucun autre certificat**. Cela bloque l'astuce « clé attestée utilisée comme AC ».
7. **KeyDescription.**
   - `attestationSecurityLevel` **égal à** `keyMintSecurityLevel`, et valant 1 (TEE) ou 2 (StrongBox). 0 (logiciel) est refusé. Le niveau stocké est `strongbox` pour 2, `tee` sinon.
   - `attestationChallenge` est égal au nonce du ticket.
8. **Liste d'autorisations.** Elle est lue **uniquement dans la liste matérielle** (`hardwareEnforced` / `teeEnforced`), jamais dans `softwareEnforced`. Elle doit contenir :
   - `purpose` qui inclut SIGN (2) ;
   - `algorithm` = EC (3), `ecCurve` = P_256 (1), `keySize` = 256 ;
   - `origin` = GENERATED (0) ;
   - **ni** `noAuthRequired` [503] **ni** `allApplications` [600] ;
   - `userAuthType` [504] avec le bit biométrie (2) **à 1** et le bit mot de passe (1) **à 0** ;
   - **pas** de `authTimeout` [505] : authentification à chaque usage.
9. **`rootOfTrust` [704]**, lu dans la liste matérielle : `deviceLocked = true` et `verifiedBootState = Verified (0)`. `SelfSigned` (GrapheneOS et similaires) est refusé par défaut [D3].
10. **`attestationApplicationId` [709].** C'est la seule exception à la règle du point 8 : Android le place dans `softwareEnforced`.
    - Le nom de package doit figurer dans `DEVICE_KEY_APP_IDS` (défaut `tools.obli.obliance.next`, cf. `obliance/app/build.gradle.kts:53`).
    - Le condensé de signature doit figurer dans `DEVICE_KEY_APP_SIGNERS`. La valeur par défaut est celle de `mobile/android/RELEASE-FINGERPRINT.txt` : `8c7e67f860beacde55ab2437a41f50c6e2c8f0777f2faca88876676c6d82ac8d`.
    - Les builds debug ne passent que si leur signataire est ajouté par variable d'environnement, sur un serveur de développement [D19].
11. **Option RKP [D5], désactivée par défaut.** Si `osVersion ≥ 130000`, exiger un intermédiaire émis par Google (chaîne RKP), ce qui écarte les keybox d'usine. En v1, l'information est seulement **journalisée** (`rkp: true|false`).

**Ce qui est stocké.** `attestation` (JSONB) contient :
- `attestationVersion`, `keyMintVersion`, `securityLevel`, `osVersion`, `osPatchLevel`, `vendorPatchLevel`, `bootState`, `deviceLocked`, `appPackage`, `appVersion`, `rkp`, `revocationCheckedAt` ;
- les numéros de série de la chaîne ;
- la chaîne brute en base64, pour l'investigation.

**Ce que l'attestation ne prouve pas** : `invalidatedByBiometricEnrollment` et `unlockedDeviceRequired`. Ces deux propriétés reposent sur le code de l'app.

**Échec d'attestation.**
- Avec `device_keys_require_attestation='true'` (défaut), réponse `422 {error:'attestation_failed', reason}`.
- Avec `'false'`, la clé est acceptée en `security_level='unverified'`, avec un badge d'avertissement sur le web et dans l'app.

**Bibliothèque : aucune.** Le parseur est un **lecteur DER tolérant écrit à la main** (`deviceKey/der.ts`, environ 250 lignes), limité aux structures ci-dessus. Il tolère des tags hors d'ordre, que certaines versions de KeyMint émettent.
- Les chaînes et signatures X.509 passent par `crypto.X509Certificate`, natif de Node.
- Le lecteur extrait les extensions en parcourant `TBSCertificate`.
- Raison de ce choix : ne pas ajouter de dépendance au `package-lock.json` pendant qu'un autre chantier le touche, et garder un code auditable.
- Le paquet `asn1` tiré par `ssh2` n'est pas utilisé.

### 4.4 La charge signée (canonique, partagée entre serveur et app)

- Texte UTF-8, lignes séparées par `\n`, ordre fixe, sans saut de ligne final.
- Aucun champ ne peut contenir `\r` ni `\n` : les deux constructeurs lèvent une exception.

```
obli-devkey-v1
purpose:<enrol|login|stepup>
origin:<origine normalisée du serveur, telle que l'APP la connaît>
user:<id utilisateur serveur, décimal>
key:<keyId>                         (enrôlement : "spki-sha256:" + hex sha256 de la SPKI DER)
count:<N, 1..50>
challenge:<challengeId>          ┐
nonce:<base64url sans padding>   │ répété N fois, dans l'ordre de
action:<actionKey ou ->          │ deviceAssertion.challengeIds
binding:<hex sha256 ou ->        │
exp:<secondes unix, horloge BD>  ┘
```

- **Origine** : schéma et hôte en minuscules, port seulement s'il n'est pas le port par défaut, sans chemin ni barre finale.
  - Côté app, elle vient de `ObliHttp.origin` (`Origins.of`) ; côté serveur, de `new URL(x).origin`.
  - **Les hôtes non ASCII (IDN) sont refusés** à l'enrôlement, par l'app comme par le serveur. `Origins.of` accepte les lettres Unicode, alors que `new URL` convertit en punycode : les deux côtés ne donneraient pas la même chaîne.
- **`count > 1`** sert aux actions groupées (§4.9.4). Le serveur l'accepte dès le premier jour.
- **L'app ne calcule jamais `binding`.** Elle recopie la valeur du défi, ce qui évite toute canonicalisation JSON entre langages.
- `exp` vient de `expires_at` **lu en base**.
- Vecteurs V1 (simple) et V2 (groupé, port non standard), vérifiés sur Node 24.14 : annexe A.

### 4.5 Liaison de requête (serveur seulement)

```
binding = sha256hex(
    "obli-binding-v1\n"
  + METHOD + "\n"
  + req.originalUrl + "\n"                         // chemin + query, tels que reçus
  + (bindingTenant ?? "-") + "\n"                  // req.tenantId ?? req.session.currentTenantId
  + actionKey + "\n"
  + sortedUniqueDeviceIds.join(",") + "\n"         // tri numérique, sans doublons
  + sha256hex(canonicalJson(req.body)) )           // corps SANS les preuves (déjà retirées, P5)
```

- `canonicalJson` trie récursivement les clés des objets, garde l'ordre des tableaux, ignore `undefined` et utilise `JSON.stringify` pour les valeurs simples.
- La liaison est calculée **au moment où `enforce()` s'exécute**, donc après `validate()`. Une route qui modifie `req.body` avant `enforce()` doit le faire de façon déterministe.
- **Règle pour l'app** (ajoutée au CONTRACT.md) : le corps renvoyé est **identique** au premier envoi, sans UUID ni horodatage par appel. Les preuves passent par `extra` et sont retirées côté serveur.
- Vecteurs B1 à B6 : annexe A.

### 4.6 Origine du serveur

Les origines autorisées à l'enrôlement sont :
- `new URL(APP_URL).origin` si `APP_URL` est défini (`config.ts:12`) ;
- chaque origine de `DEVICE_KEY_ORIGINS`, séparées par des virgules, pour un accès LAN plus un accès public.

Si les deux sont vides, **l'enrôlement est refusé** avec `403 {error:'device_keys_origin_unset'}` [D17]. Il n'y a **jamais** de repli sur `Host` ni sur `X-Forwarded-*`.

L'origine acceptée est stockée dans `user_device_keys.origin`. À l'usage, la charge est **toujours** reconstruite avec `key.origin`.

Ajouter `APP_URL` et `DEVICE_KEY_ORIGINS` à `.env.example` et, en commentaire, aux `docker-compose*.yml`.

### 4.7 En-tête, session liée et règles d'acceptation

**L'en-tête `X-Obli-Device-Key: <keyId>`.** Il est ajouté par l'app (intercepteur OkHttp) à **chaque** requête vers l'origine O, **si et seulement si** l'app détient une clé pour (O, userId de la session active sur O).
- À la connexion, avant que la session existe, l'app le passe explicitement : c'est la clé dont l'identifiant mémorisé correspond, sans tenir compte de la casse, au nom d'utilisateur saisi.
- Le web ne l'envoie jamais.
- Le pont web (S90) ne l'ajoute pas. La vue web partage **le même cookie**, donc la même session liée.

**La liaison.** Le middleware `deviceKeySession` (§6.4) pose `req.session.deviceKeyId` dans trois cas :
- à la fin d'un enrôlement ;
- à la fin d'une connexion dont la requête portait l'en-tête d'une clé active de cet utilisateur, que la connexion ait été validée par empreinte ou par code ;
- à la première requête authentifiée portant l'en-tête d'une clé active de l'utilisateur de la session.

Une session déjà liée n'est jamais reliée à une autre clé : un autre en-tête est ignoré.

**En session liée** (politique active) :

| Élément | Règle |
|---|---|
| Raccourci IP de confiance | **Ignoré.** `trustIpAllowed:false` dans les 401. `trustIp` n'est jamais accordé. |
| `deviceAssertion` | Accepté si `keyId == session.deviceKeyId` (§6.3). |
| `twoFactorCode` seul | **Refusé** [D2] : `401 twoFactorRequired` avec `codeRequiresPassword:true` (compte local) ou `codeRequiresReauth:true` (SSO, lot O), plus un nouveau défi. |
| `twoFactorCode` + `stepUpPassword` (compte local) | Accepté. C'est le secours « empreinte indisponible ». |
| `twoFactorCode` après réauthentification Obligate de moins de 5 min (SSO, lot O) | Accepté. |
| En-tête d'une clé révoquée de l'utilisateur | Session détruite, puis `401 {error:'Authentication required', deviceKeyStatus:'revoked'}`. |
| En-tête d'une clé inconnue ou d'un autre utilisateur | Ignoré, sans aucune information renvoyée. |

**Sans session liée** (web de bureau, ancien app, téléphone sans clé, politique coupée) : le comportement d'aujourd'hui, plus les prérequis (anti-rejeu, plafonds).

### 4.8 Formats JSON

**Défi.** Il est envoyé dans un 401 de step-up, dans la réponse de connexion ou par `device-challenge`.

```json
{ "v": 1, "keyId": "…", "challengeId": "…", "purpose": "stepup", "userId": 42,
  "tenantId": 3, "tenantName": "ACME", "nonce": "<b64url 32 o>", "action": "command.reboot",
  "binding": "<hex64>", "expiresAt": 1790000120, "bulkId": null }
```

- `tenantName` sert **uniquement à l'affichage** ; `tenantId` est couvert par `binding`.
- Pour une connexion, `purpose:'login'`, `action:'-'`, `binding:'-'` et `tenantId:null`.

**Assertion.** Envoyée en champ de corps, au même niveau que `twoFactorCode` aujourd'hui.

```json
"deviceAssertion": { "v": 1, "keyId": "…", "challengeIds": ["…"], "signature": "<base64 DER>" }
```

**401 de step-up.** La forme actuelle gagne des champs **optionnels**, que les anciens clients ignorent :

```json
{ "error": "twoFactorCode required", "twoFactorRequired": true, "action": "command.reboot",
  "currentIp": "…", "trustIpAllowed": false,
  "codeRequiresPassword": true, "codeRequiresReauth": false,
  "deviceKeyStatus": "active", "deviceChallenge": { … }, "deviceError": "challenge_expired" }
```

- `deviceKeyStatus` ∈ `active | disabled | throttled`. Il n'est présent que si la session est liée ou si l'en-tête a été envoyé.
- `deviceChallenge` n'est présent que si le statut est `active` et que le site accepte l'empreinte (`allowDevice`).

**Rejets d'une assertion.**

| Cas | Réponse |
|---|---|
| Défi expiré, consommé ou inconnu, mais un défi de **même liaison** existe | `401 twoFactorRequired` + `deviceError:'challenge_expired'` + **nouveau** `deviceChallenge` |
| Signature, liaison, session, tenant, lot, origine ou but invalides, ou `keyId` différent de la clé liée | `401 twoFactorRequired` + `deviceError:'invalid_assertion'`, sans défi. Code possible selon §4.7. |
| Clé révoquée, ou `credential_version` différente | Session détruite, `401 {error:'Authentication required', deviceKeyStatus:'revoked'}` |
| Politique coupée | `401 twoFactorRequired` + `deviceKeyStatus:'disabled'` : la session redevient non liée, le code seul est accepté |
| Trop d'échecs d'assertion dans cette session | `401 twoFactorRequired` + `deviceKeyStatus:'throttled'` : mot de passe + code |
| `twoFactorCode` **et** `deviceAssertion` envoyés ensemble | Seul le code est évalué ; l'assertion est ignorée |
| Assertion mal formée | `400 Validation` |

Les codes gardent exactement leur réponse actuelle, `401 {error:'Invalid 2FA code'}`. Un mauvais `stepUpPassword` renvoie la même réponse, pour ne rien révéler.

**Correspondance côté app** (`ApiResponses`) :

| HTTP | Corps | `ApiOutcome` |
|---|---|---|
| 401 | `twoFactorRequired` (+ champs ci-dessus) | `StepUpRequired(action, currentIp, trustIpAllowed, codeRequiresPassword, codeRequiresReauth, device: DeviceStepUp?, origin)` |
| 401 | `Invalid 2FA code` | `StepUpRejected` |
| 401 | autre (dont `deviceKeyStatus:'revoked'`) | `SessionExpired` (+ purge locale si la clé est celle de l'utilisateur de la session) |
| 403 | `…enable TOTP…` | `Forbidden(NO_TOTP)` |
| 403 | `device_keys_disabled`, `device_keys_origin_unset`, `device_keys_sso_unsupported`, `enrol_locked` | `Forbidden(OTHER, message)` : S85 affiche le texte de l'annexe B |
| 400 | `invalid_ticket`, `origin_mismatch`, `bad_key`, `bad_signature` | `Validation` |
| 409 | `too_many_keys`, `already_enrolled` | `Unsupported` |
| 422 | `attestation_failed` + `reason` | `Failure(CLIENT, reason)` |
| 429 | `Too many verification attempts` (+ `Retry-After`) ou `codeLocked:true` | `RateLimited` |

### 4.9 Déroulés

#### 4.9.1 Enrôlement (compte local)

1. S85 › **Valider par empreinte** vérifie trois préconditions :
   - `BiometricManager.canAuthenticate(BIOMETRIC_STRONG) == SUCCESS` et écran verrouillé par un code ;
   - `GET /api/profile/device-keys` répond 200 avec `policy.enabled` et `policy.originConfigured` ;
   - le compte est local avec TOTP, ou SSO avec `policy.ssoSupported`.
2. Écran d'explication (annexe B, dont la phrase sur les biométries déjà présentes).
3. Feuille : **mot de passe + code** puis `POST /api/profile/device-keys/enrol/begin {installId, stepUpPassword, twoFactorCode}`.
4. L'app vérifie que `ObliHttp.origin` figure dans `allowedOrigins` et qu'il est en ASCII, puis génère la clé avec `setAttestationChallenge(nonce)`.
5. Elle construit la charge :
   - `purpose:'enrol'`, `origin` = `ObliHttp.origin`, `user` = `userId` ;
   - `key:'spki-sha256:'+fp` ;
   - un seul défi `[ticketId, nonce, 'device_key.enrol', '-', expiresAt]`.

   Elle affiche ensuite `BiometricPrompt` + `CryptoObject(Signature)` et signe.
6. `POST …/enrol/finish {ticketId, origin, publicKey, attestation[], signature, label, installId, appVersion}`, puis réponse `201`. Le serveur lie la session courante à la nouvelle clé.
7. L'app enregistre (origine, userId, username, keyId, alias, installId, securityLevel, createdAt). En cas d'échec, elle supprime l'alias.

#### 4.9.2 Step-up

1. Premier envoi du corps, sans preuve. Si le serveur répond `401 twoFactorRequired` avec `deviceChallenge`, l'app contrôle trois choses :
   - `challenge.userId` et `challenge.keyId` correspondent à la clé de (origine, utilisateur de la session) ;
   - `challenge.tenantId` est égal au tenant de l'action (`ActionSpec.tenantId`) quand les deux sont connus ;
   - la réponse vient bien de l'origine du client (`StepUpRequired.origin`).

   Si un contrôle échoue, l'app ne signe pas et bascule sur le secours.
2. Invite biométrique :
   - titre = l'action (« Redémarrer SRV-AD2 ») ;
   - sous-titre = « Obliance Prod › ACME » ;
   - description = « Validation à deux facteurs, pour cette action uniquement » ;
   - bouton négatif « Utiliser un code ».
3. Nouvel envoi du **même corps** + `deviceAssertion`.
4. Suite selon la réponse :
   - `challenge_expired` : une nouvelle signature au plus (2 contacts par action au maximum) ;
   - `invalid_assertion`, `throttled`, « Utiliser un code » ou biométrie verrouillée : S42 en variante « mot de passe + code » si `codeRequiresPassword` ;
   - `disabled` : S42 normal.

#### 4.9.3 Connexion (comptes locaux, [D7])

1. `POST /api/auth/login` avec l'en-tête de la clé du nom d'utilisateur saisi. Si la clé est éligible, la réponse porte `data.methods.device = true` et `data.deviceChallenge` (`purpose:'login'`), et l'e-mail OTP automatique n'est **pas** envoyé.
2. Invite biométrique : titre « Connexion à Obliance Prod », sous-titre = le nom d'utilisateur, bouton négatif « Utiliser un code ».
3. `POST /api/profile/2fa/verify {method:'device', deviceAssertion}`, puis `200 {data:{user}}`. La session régénérée est liée.
4. Si l'invite est restée ouverte plus de 120 s : `POST /api/profile/2fa/device-challenge`.

#### 4.9.4 Actions groupées

Utilisé par les boucles « une requête par appareil » (lot A6).
1. **Premier passage.** Chaque requête porte `deviceBulkId` (un UUID par lot, dans `extra`, retiré de la liaison). Chaque réponse est soit un succès (niveau `none`, l'action s'exécute), soit un 401 avec un défi portant `bulkId`.
2. **Une seule invite** : « Redémarrer 12 appareils · Obliance Prod › ACME ». Une signature couvre `count = N ≤ 50` défis.
3. **Second passage** : chaque requête renvoie la **même** assertion.

Pour chaque requête, le serveur vérifie la charge entière et ne consomme **que** son propre défi. Il exige en plus :
- la même `action_key` pour tous les défis ;
- le même `bulk_id`, non nul ;
- le même tenant ;
- `max(created_at) − min(created_at) ≤ 60 s`.

#### 4.9.5 Invalidation (nouvelle biométrie, verrouillage retiré)

1. `keyHealth()` renvoie invalidée, au retour au premier plan ou juste avant une signature.
2. L'app appelle `POST /api/profile/device-keys/:id/invalidated`. Le serveur révoque la clé (`invalidated`) et tue **toutes** ses sessions liées, y compris la courante [D10].
3. L'app supprime l'alias et l'enregistrement, **efface localement le cookie de cette origine** (même si l'appel a échoué, faute de réseau), puis affiche S03 : il faut se reconnecter avec mot de passe + code.
4. S85 propose ensuite de réactiver l'empreinte.

#### 4.9.6 Déconnexion et retrait d'un serveur

1. `POST /api/auth/logout` avec l'en-tête. Le serveur révoque cette clé (`logout`), tue les autres sessions liées et détruit la session courante.
2. L'app supprime l'alias et l'enregistrement.
3. Hors ligne, la suppression locale se fait quand même. La ligne serveur reste alors visible dans la liste jusqu'à une révocation manuelle ou jusqu'à la péremption (§6.9). Ce n'est pas un risque, puisque plus personne ne peut signer avec cette clé.

« Se déconnecter de ce serveur » et « Retirer ce serveur » (S92) passent par ce chemin.

### 4.10 Comptes SSO (Obligate), activés par capacité

Obliance appelle `GET {obligate}/api/oauth/capabilities` (lot O), avec un cache de 10 min. Il n'active le SSO que si la réponse contient `{"stepUpEpoch": 1, "reauth": 1, "totpReplayGuard": 1}`. Sinon, l'enrôlement d'un compte `og_` renvoie `403 device_keys_sso_unsupported`.

Avec le lot O, les différences avec un compte local sont les suivantes :
- **Enrôlement** : au lieu du mot de passe + code, une **réauthentification Obligate fraîche**.
  - L'app ouvre la feuille SSO sur `/api/auth/sso-redirect?reauth=1`, et Obligate impose mot de passe + TOTP.
  - La réponse d'échange porte `authTime` et `amr` contenant `otp`, pour **le même** `foreign_id`.
  - Obliance pose alors `session.ssoReauthAt`, que `enrol/begin` exige à moins de 5 min.
  - Obligate enregistre le pas TOTP utilisé : un code relayé depuis une connexion ne passe pas.
- **Usage** : en plus des contrôles du §6.3, l'époque MFA Obligate (`mfaEpoch`) doit être égale à `user_device_keys.sso_epoch`. Elle est lue avec un cache de 5 min, en **échec fermé** : si Obligate est injoignable, l'assertion est refusée avec `deviceKeyStatus:'disabled'` pour cette requête. Le code serait de toute façon refusé lui aussi.
- **Secours en session liée** : `codeRequiresReauth:true`, c'est-à-dire réauthentification Obligate puis code (5 min).
- **Révocation poussée** : l'action `credentials-changed` de `sso-user-sync` révoque les clés (`sso_mfa_changed`) et tue les sessions.
- **Connexion par empreinte : jamais.** La connexion SSO reste celle d'Obligate.

---

## 5. Données et migrations

Numéros à confirmer au moment d'implémenter : les dernières migrations sont `125_metric_alert_status.ts` et `126_live_alert_resolution.ts`, et un autre chantier peut en ajouter. Les deux migrations sont idempotentes (gardes `hasTable` / `hasColumn`), et leur `down` défait tout.

### 5.1 `127_totp_step_guard.ts` (prérequis P3)

```ts
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'totp_last_step'))) {
    await knex.schema.alterTable('users', (t) => {
      t.bigInteger('totp_last_step');            // dernier pas TOTP accepté (floor(unix/30))
      t.string('totp_last_session', 64);         // sha256(sessionID) de la session qui l'a utilisé
    });
  }
  if (!(await knex.schema.hasTable('step_up_throttle'))) {
    await knex.schema.createTable('step_up_throttle', (t) => {
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('kind', 16).notNullable();        // 'code' | 'enrol'
      t.timestamp('window_start', { useTz: true });   // fenêtre de 15 min
      t.integer('window_failures').notNullable().defaultTo(0);
      t.timestamp('day_start', { useTz: true });      // fenêtre de 24 h
      t.integer('day_failures').notNullable().defaultTo(0);
      t.boolean('locked').notNullable().defaultTo(false); // code : jusqu'à reconnexion complète
      t.timestamp('locked_until', { useTz: true });        // enrôlement : 24 h
      t.timestamp('notified_at', { useTz: true });
      t.primary(['user_id', 'kind']);
    });
  }
}
```

### 5.2 `128_device_keys.ts`

```ts
export async function up(knex: Knex): Promise<void> {
  // 1. Version d'identifiants, tenue par la base (R8)
  if (!(await knex.schema.hasColumn('users', 'credential_version'))) {
    await knex.schema.alterTable('users', (t) => {
      t.integer('credential_version').notNullable().defaultTo(1);
    });
  }
  await knex.raw(`
    CREATE OR REPLACE FUNCTION users_bump_credential_version() RETURNS trigger AS $$
    BEGIN
      IF NEW.password_hash  IS DISTINCT FROM OLD.password_hash      -- [D8]
      OR NEW.totp_secret    IS DISTINCT FROM OLD.totp_secret
      OR NEW.totp_enabled   IS DISTINCT FROM OLD.totp_enabled
      OR NEW.is_active      IS DISTINCT FROM OLD.is_active
      OR NEW.foreign_source IS DISTINCT FROM OLD.foreign_source
      OR NEW.foreign_id     IS DISTINCT FROM OLD.foreign_id THEN
        NEW.credential_version := OLD.credential_version + 1;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS users_credential_version ON users;
    CREATE TRIGGER users_credential_version BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION users_bump_credential_version();
  `);

  // 2. Clés
  if (!(await knex.schema.hasTable('user_device_keys'))) {
    await knex.schema.createTable('user_device_keys', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));   // = keyId
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('platform', 16).notNullable().defaultTo('android');
      t.binary('public_key_spki').notNullable();
      t.string('public_key_fp', 64).notNullable().unique();              // sha256 hex de la SPKI
      t.string('origin', 255).notNullable();                             // §4.6
      t.string('install_id', 64).notNullable();
      t.string('label', 120);                                            // Build.MANUFACTURER + MODEL, nettoyé
      t.string('app_version', 32);
      t.string('security_level', 16).notNullable();                      // strongbox | tee | unverified
      t.jsonb('attestation');
      t.integer('credential_version').notNullable();                     // copie de users.credential_version
      t.integer('sso_epoch');                                            // lot O ; null pour un compte local
      t.string('status', 16).notNullable().defaultTo('active');          // active | revoked
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('last_used_at', { useTz: true });
      t.string('last_used_ip', 64);
      t.integer('use_count').notNullable().defaultTo(0);
      t.timestamp('revoked_at', { useTz: true });
      t.integer('revoked_by').references('id').inTable('users').onDelete('SET NULL');
      t.string('revoke_reason', 40);
      // user | logout | admin | password_change | password_reset | totp_changed | totp_disabled |
      // totp_reset | user_disabled | credentials_changed | sso_mfa_changed | replaced |
      // invalidated | stale | policy
      t.index(['user_id', 'status']);
    });
  }

  // 3. Défis
  if (!(await knex.schema.hasTable('device_key_challenges'))) {
    await knex.schema.createTable('device_key_challenges', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));   // challengeId ou ticketId
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.uuid('key_id').references('id').inTable('user_device_keys').onDelete('CASCADE'); // null : enrôlement
      t.string('purpose', 16).notNullable();                             // enrol | login | stepup
      t.string('session_hash', 64).notNullable();                        // sha256(req.sessionID)
      t.integer('tenant_id');                                            // tenant de liaison (null : login/enrol)
      t.uuid('bulk_id');
      t.binary('nonce').notNullable();                                   // 32 octets aléatoires
      t.string('action_key', 120);
      t.string('binding_hash', 64);
      t.specificType('device_ids', 'integer[]');                         // audit seulement
      t.string('ip', 64);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('consumed_at', { useTz: true });
      t.string('result', 24);  // ok | bad_signature | binding_mismatch | revoked | expired | attestation_failed
      t.index(['user_id', 'created_at']);
      t.index(['key_id', 'consumed_at']);
      t.index('expires_at');
    });
  }
}
```

**Pas de colonne tenant sur les clés.** Elles appartiennent à l'utilisateur de plateforme, comme `user_ssh_keys`. L'audit prend son tenant dans la session (§10).

**Remarque sur le trigger.** Un changement de `totp_last_step`, de `updated_at`, du rôle ou des préférences ne l'incrémente pas. Une réactivation (`is_active` de false à true) l'incrémente : les clés antérieures à une désactivation meurent.

### 5.3 Session

Ajouts à `SessionData` (`middleware/auth.ts`) :
- `deviceKeyId?: string` : la liaison ;
- `ssoReauthAt?: number` : lot O ;
- `pendingReauth?: { startedAt: number; foreignId: number }` : lot O.

Les requêtes de nettoyage portent sur la table `session` (`app.ts:90`, colonne `sess` en JSON) :

```sql
DELETE FROM session WHERE sess::jsonb->>'deviceKeyId' = ?;          -- sessions liées à une clé
DELETE FROM session WHERE (sess::jsonb->>'userId')::int = ?;         -- P6 : toutes les sessions d'un utilisateur
```

---

## 6. Serveur

### 6.0 Prérequis (livrables seuls, avant tout le reste)

| # | Correctif | Fichiers | Taille |
|---|---|---|---|
| P1 | **Portée de `users.manage`.**<br>• Seul un administrateur de plateforme (`req.session.role==='admin'`) peut modifier `role`.<br>• `PUT /:id/password`, `DELETE /:id/2fa` et les nouvelles routes `/:id/device-keys` doivent viser un utilisateur de `req.tenantId` qui n'est pas administrateur. Un administrateur peut viser n'importe qui.<br>• Ces routes passent par l'enveloppe `tenant.manage_users` et sont auditées (`user.password_reset_admin`, `user.2fa_reset`, `device_key.revoked`). | `routes/users.routes.ts:14-23`, `controllers/users.controller.ts:79-150`, `:223-237` | 0,5 j |
| P2 | **Gestion du TOTP.**<br>• `POST /2fa/totp/setup` quand le TOTP est déjà actif, et `DELETE /2fa/totp`, exigent `checkSecondFactor(…, {actionKey:'profile.totp_manage', allowDevice:false, allowTrustedIp:false, requireNewStep:true})`, soit un **code actuel** (+ mot de passe en session liée).<br>• `totpEnable` enregistre le pas du nouveau secret.<br>• Les révocations associées : voir §6.7. | `controllers/twoFactor.controller.ts:37-96`, `routes/twoFactor.routes.ts` | 0,5 j |
| P3 | **Anti-rejeu TOTP et plafonds.**<br>• Migration `127` (§5.1).<br>• `twoFactorService.verifyTotpStep(secret, code, window)` renvoie le pas trouvé (`validate()` + `floor(now/30)`).<br>• **Toutes** les vérifications TOTP locales passent par `acceptTotpStep(userId, step, sessionHash, mode)`, une mise à jour atomique :<br>&nbsp;&nbsp;– `mode:'strict'` (connexion, enrôlement, gestion du TOTP) : `step > totp_last_step` ;<br>&nbsp;&nbsp;– `mode:'stepup'` (enveloppe, `requireFreshTotp`) : `step > totp_last_step`, **ou** même session et `step ≥ totp_last_step − 4`. Cela garde la réutilisation du code saisi pour les boucles (design §7.7).<br>• La connexion enregistre le pas avec le hash de la **nouvelle** session : le code de connexion reste réutilisable pour un step-up dans cette session, mais jamais pour enrôler.<br>• Plafonds persistés (§6.8), fenêtre [D11]. | `services/twoFactor.service.ts:31-46`, `controllers/twoFactor.controller.ts:67`, `:164`, nouveau `services/deviceKey/stepUpProof.ts` | 1 j |
| P4 | **Tenant sur `/api/profile`.** Le routeur n'est pas monté sous `tenantRouter` (`routes/index.ts:83`), donc `req.tenantId` n'y existe pas.<br>• Poser `req.tenantId = req.session.currentTenantId` en tête de `profile.routes.ts`, ce qui corrige `gateProfileWrite` (`getMap(undefined)` renvoie 500) et `trustWindowMs(undefined)`.<br>• Utiliser ce tenant pour l'audit. | `routes/profile.routes.ts:11-35` | 0,25 j |
| P5 | **Preuves hors du corps.** Nouveau middleware global `captureStepUpProof`, monté dans `app.ts` juste après `express.json()` et la session :<br>• si `req.body` est un objet simple, il **déplace** `twoFactorCode`, `trustIp`, `stepUpPassword`, `deviceAssertion` et `deviceBulkId` vers `req.stepUpProof`, puis les supprime du corps ;<br>• tous les lecteurs lisent `req.stepUpProof` : `restriction.service.ts:326`, `:353`, `sshBastion/stepUp.ts:27`, et le nouveau code.<br>Effets :<br>• `validate()` ne peut plus les retirer (sites `users`, `teams`, `profile`) ;<br>• ils n'arrivent plus dans les journaux (`schedule.routes.ts:266`, `:369`), ni dans `approvalPayload`, ni dans une insertion.<br>Aucune modification de `validate.ts`. | `app.ts`, `services/restriction.service.ts`, `services/sshBastion/stepUp.ts` | 0,25 j |
| P6 | **Désactivation.**<br>• `users.controller.ts` `update` avec `isActive:false`, et `obligateCallback.routes.ts:726` (`deactivate`) : `DELETE FROM session WHERE (sess::jsonb->>'userId')::int = ?`, puis `revokeAllForUser(uid, 'user_disabled')`.<br>• `requireAuth` ne vérifie pas `is_active` (`middleware/auth.ts:21`), d'où la suppression des sessions. | `controllers/users.controller.ts:79-131`, `routes/obligateCallback.routes.ts:726-733` | 0,25 j |
| P7 | *(Non bloquant.)* `client/nginx.conf:50,69,84,105` transmet le `X-Forwarded-Proto` du client. À épingler si le port 3003 peut être joint directement. La fonctionnalité n'en dépend plus (§4.6). | `client/nginx.conf` | 0,1 j |

Recommandés mais non bloquants (constats 12.6 et 12.8 du brouillon) :
- `force_2fa` lu comme une chaîne ;
- un compte SSO muni d'un mot de passe local se connecte sans MFA. La connexion par empreinte est de toute façon refusée aux comptes SSO.

### 6.1 Nouveaux fichiers

| Fichier | Contenu |
|---|---|
| `server/src/services/deviceKey/payload.ts` | `buildPayload()`, `canonicalJson()`, `computeBinding()`, `normaliseOrigin()`. Sans aucun import du projet, pour être testable par `node --test`. |
| `server/src/services/deviceKey/der.ts` | Lecteur DER tolérant (TLV, OID, INTEGER, ENUMERATED, SET, OCTET STRING, tags de contexte explicites). Sans import du projet. |
| `server/src/services/deviceKey/attestation.ts` | `verifyAttestation(chainB64[], publicKeySpki, nonce, policy)`, qui renvoie `{ok, level, summary} \| {ok:false, reason}`. |
| `server/src/services/deviceKey/attestationRoots.ts` | Condensés SPKI épinglés des racines Google. |
| `server/src/services/deviceKey/attestationStatus.ts` | Liste de révocation Google : cache mémoire 24 h + fichier `/custom/device-keys/attestation-status.json`, 7 jours au plus. |
| `server/src/services/deviceKey/deviceKey.service.ts` | Opérations sur les clés et les défis :<br>• `beginEnrol`, `finishEnrol`, `list`, `revoke`, `revokeAllForUser` ;<br>• `issueStepUpChallenge`, `issueLoginChallenge`, `verifyAssertion` ;<br>• `keyStatusCached`, `killSessionsForKey`, `killSessionsForUser` ;<br>• `sweep`. |
| `server/src/services/deviceKey/stepUpProof.ts` | `checkSecondFactor()` (§6.2), `acceptTotpStep()`, plafonds (§6.8). |
| `server/src/middleware/captureStepUpProof.ts` | P5. |
| `server/src/middleware/deviceKeySession.ts` | Liaison, destruction des sessions sur clé révoquée (§6.4). |
| `server/src/routes/deviceKey.routes.ts` | Routes du §6.5, montées `router.use('/profile/device-keys', requireAuth, deviceKeyRoutes)` **avant** `/profile` (`routes/index.ts:82-83`). |
| `server/src/services/deviceKey/*.test.ts` | Tests `node --test` (§12.1). Syntaxe TypeScript effaçable uniquement (ni `enum` ni `namespace`) : Node 24 retire les types nativement. |
| `server/scripts/device-key-e2e.mjs` | Scénario de bout en bout contre une instance de développement : un faux téléphone en `crypto` Node, avec `require_attestation=false` (§12.2). |
| `shared/src/deviceKeys.ts` | Types `DeviceChallenge`, `DeviceAssertion`, `DeviceKeyInfo`, `DeviceKeyPolicy`, `StepUpProof`, ré-exportés par `shared/src/index.ts`. |

### 6.2 `checkSecondFactor` : le vérificateur unique

```ts
export type StepUpOpts = {
  actionKey: string;
  deviceIds?: number[];
  allowTrustedIp: boolean;
  allowDevice: boolean;
  requireNewStep?: boolean;      // 'strict' au lieu de 'stepup' pour le pas TOTP
};
export async function checkSecondFactor(req: Request, o: StepUpOpts):
  Promise<{ ok: true; via: 'trusted_ip' | 'totp' | 'obligate_totp' | 'device_key' }
        | { ok: false; status: number; body: Record<string, unknown> }>
```

Les étapes s'exécutent dans cet ordre :

1. **Utilisateur.** Charger `is_active`, `totp_enabled`, `totp_secret`, `foreign_source`, `foreign_id`, `password_hash`, `credential_version`. Absent ou inactif : destruction de la session, puis `401 Unauthenticated`.
2. **Facteur disponible.** Ni TOTP local ni SSO : les textes 403 actuels. Garder « enable TOTP » dans le texte de l'enveloppe, que l'app reconnaît.
3. **Session liée.** `bound = await deviceKeyService.boundKey(req)`, qui vaut `null` si la politique est coupée ou si la session n'est pas liée.
4. **IP de confiance.** Si `o.allowTrustedIp && !bound`, que l'adresse n'est pas un relais et qu'elle est de confiance : ok (`trusted_ip`). C'est le raccourci existant, déplacé tel quel.
5. **`proof.twoFactorCode` présent** (`req.stepUpProof`). Une assertion éventuelle est **ignorée** (R7).
   - `code` bloqué ou fenêtre dépassée (§6.8) : 429.
   - Session liée, politique stricte [D2] :
     - compte local sans `proof.stepUpPassword` : `401 twoFactorRequired` avec `codeRequiresPassword:true` et un défi (étape 7) ;
     - `stepUpPassword` présent : `comparePassword`. En cas d'échec, compter l'échec et répondre `401 Invalid 2FA code` ;
     - compte SSO : `session.ssoReauthAt` doit dater de moins de 5 min, sinon `401 twoFactorRequired` avec `codeRequiresReauth:true`.
   - Vérifier le code :
     - compte local : `verifyTotpStep`, puis `acceptTotpStep(mode = o.requireNewStep ? 'strict' : 'stepup')` ;
     - compte SSO : `obligateService.verifyTotp`. Avec le lot O, il passe `consume:true` et reçoit `step`.
   - Échec : compter l'échec, auditer `auth.step_up_failed`, répondre `401 {error:'Invalid 2FA code'}`.
   - Succès : remettre à zéro la fenêtre de 15 min (pas le compteur de 24 h). Accorder l'IP de confiance seulement si `o.allowTrustedIp && !bound && proof.trustIp === true` et que l'adresse n'est pas un relais. Ok (`totp` ou `obligate_totp`).
6. **`o.allowDevice` et `proof.deviceAssertion`** : `deviceKeyService.verifyAssertion(req, {purpose:'stepup', actionKey, deviceIds, bound})` (§6.3). Si `allowDevice` est faux, le champ est ignoré.
7. **Aucune preuve.** Réponse `401` :
   - champs actuels : `twoFactorRequired`, `action`, `currentIp` ;
   - `trustIpAllowed: o.allowTrustedIp && !bound && !relay` ;
   - `codeRequiresPassword` ou `codeRequiresReauth` si la session est liée ;
   - `deviceKeyStatus` ;
   - `deviceChallenge` si `o.allowDevice && bound && statut actif`, via `issueStepUpChallenge` qui calcule la liaison et applique les limites d'émission.
8. **Audit** du résultat (§10).

**Sites d'appel.**
- **Enveloppe** (`restriction.service.ts:295-358`, branche `sensitive`) : `checkSecondFactor(req, {actionKey, deviceIds: params.deviceIds, allowTrustedIp:true, allowDevice:true})`. Les branches `restricted` (`:360`) et `none` ne changent pas.
- **`requireFreshTotp`** (`sshBastion/stepUp.ts:16-41`) : `checkSecondFactor(req, {actionKey: action, allowTrustedIp:false, allowDevice: action === 'profile.ssh_key_add'})` [D6].
- **Enrôlement** : `{allowDevice:false, allowTrustedIp:false, requireNewStep:true}`, **plus** `stepUpPassword` obligatoire (compte local) ou `ssoReauthAt` (SSO), même hors session liée.
- **Gestion du TOTP (P2)** : `{allowDevice:false, allowTrustedIp:false, requireNewStep:true}`.

### 6.3 `verifyAssertion`

1. **Forme.**
   - `v === 1`, `keyId` est un UUID, 1 à 50 `challengeIds` uniques, signature en base64 de 200 caractères au plus.
   - `keyId === bound.id`. Sinon `invalid_assertion` : une assertion n'est valable que dans une session liée à **cette** clé.
2. **Compteurs.** Session limitée par les échecs d'assertion (§6.8) : `throttled`.
3. **Clé.** `status='active'`, `user_id = uid`, `credential_version` égale à celle de l'utilisateur, `security_level ≠ 'unverified'` quand `require_attestation` est actif. Avec le lot O, contrôle `sso_epoch`.
   - Version différente : `revoke(key, 'credentials_changed')`, destruction de la session, réponse `401 Authentication required`.
4. **Défis listés.** Charger tous les défis. Chacun doit avoir le même `user_id`, le même `key_id`, `purpose = 'stepup'`, `session_hash = sha256(req.sessionID)` et `tenant_id = bindingTenant`. Si `count > 1`, appliquer les règles de lot du §4.9.4. Toute différence : `invalid_assertion`.
5. **Défi de cette requête.** `mine` est la ligne dont `binding_hash = computeBinding(req, actionKey, deviceIds)`.
   - Aucune ligne n'a cette liaison : `invalid_assertion`.
   - `mine` est déjà consommé ou expiré : `challenge_expired` avec un nouveau défi.
6. **Signature.** Reconstruire la charge avec `key.origin`, les lignes dans l'ordre de `challengeIds` et `exp = floor(expires_at)` lu en base, puis `crypto.verify('sha256', payload, {key: spki, dsaEncoding:'der'}, sig)`.
   - Échec : consommer `mine` avec `result='bad_signature'` (même instruction qu'à l'étape 7), compter l'échec, puis `invalid_assertion`.
7. **Consommation atomique** : une seule instruction.

   ```sql
   UPDATE device_key_challenges c SET consumed_at = now(), result = 'ok'
   FROM user_device_keys k, users u
   WHERE c.id = :mine AND c.consumed_at IS NULL AND c.expires_at > now()
     AND k.id = c.key_id AND k.status = 'active'
     AND u.id = k.user_id AND u.is_active AND u.credential_version = k.credential_version
   RETURNING c.id;
   ```

   Aucune ligne renvoyée : rejet (`challenge_expired` si le défi a expiré, sinon `invalid_assertion`). **La signature ne sert jamais de clé anti-rejeu** : la malléabilité ECDSA (s → n−s) a été vérifiée sur Node 24.14.
8. **Mise à jour de la clé** : `last_used_at`, `last_used_ip`, `use_count + 1`. Audit `device_key.used`.

### 6.4 Middleware `deviceKeySession`

Il est monté dans `app.ts` après la session et `captureStepUpProof`, avant les routes. Il ne fait rien si `DEVICE_KEYS_DISABLED` est vrai ou si `device_keys_enabled !== 'true'`.

```text
si pas de req.session.userId : next()                       // la connexion est traitée dans le contrôleur
k = req.session.deviceKeyId
si k :
    st = keyStatusCached(k)            // {status, userId, credOk}, TTL 30 s, vidé localement à chaque révocation
    si st.status !== 'active' ou !st.credOk ou st.userId !== session.userId :
        si st.status === 'active' et !st.credOk : revoke(k, 'credentials_changed')
        détruire la session ; 401 {error:'Authentication required', deviceKeyStatus:'revoked'}
    next()
h = req.get('X-Obli-Device-Key')
si h est un UUID :
    st = keyStatusCached(h)
    si st.userId === session.userId :
        si st.status === 'active' et st.credOk : req.session.deviceKeyId = h      // liaison
        sinon : détruire la session ; 401 revoked                            // la propre clé révoquée de l'utilisateur
    // clé inconnue ou d'un autre utilisateur : ignorée
next()
```

Ce contrôle par requête couvre aussi la « résurrection » d'une session supprimée par un `set` concurrent de `connect-pg-simple`.

La requête SQL de `keyStatusCached` :

```sql
SELECT k.status, k.user_id, (k.credential_version = u.credential_version AND u.is_active) AS cred_ok
FROM user_device_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?
```

### 6.5 Endpoints

**Profil** (`deviceKey.routes.ts`, session requise). `req.tenantId` est posé comme en P4.

| Méthode et route | Corps | Réponse | Règles |
|---|---|---|---|
| `GET /api/profile/device-keys` | — | `{data:{policy:{enabled, loginEnabled, requireAttestation, strictSession, originConfigured, ssoSupported}, allowedOrigins, boundKeyId, eligibility:{ok, reason?}, keys:[{id,label,platform,securityLevel,osPatchLevel,createdAt,lastUsedAt,lastUsedIp,useCount,current}]}}` | Clés actives seulement. `current` vaut vrai pour la clé liée à la session. Cet endpoint sert aussi de test de capacité : un ancien serveur répond 404. |
| `POST …/enrol/begin` | `{installId}` + preuves `stepUpPassword`, `twoFactorCode` (local), ou `ssoReauthAt` en session (SSO) | `200 {data:{ticketId, nonce, expiresAt, userId, allowedOrigins, requireAttestation}}` | Dans cet ordre :<br>1. politique active, sinon 403 `device_keys_disabled` ;<br>2. origine configurée, sinon 403 `device_keys_origin_unset` ;<br>3. compte SSO sans lot O : 403 `device_keys_sso_unsupported` ;<br>4. compte local sans TOTP : 403 (texte « enable TOTP ») ;<br>5. enrôlement verrouillé : 403 `enrol_locked` ;<br>6. mot de passe + code strict. Un échec compte pour `enrol` et pour `code`, réponse `401 Invalid 2FA code` ;<br>7. 5 clés actives au plus, hors même `installId` : sinon 409 `too_many_keys` [D14] ;<br>8. insertion d'un défi `purpose:'enrol'`, TTL 180 s [D16] ;<br>9. audit `device_key.enrol_begin`. |
| `POST …/enrol/finish` | `{ticketId, origin, publicKey, attestation[], signature, label, installId, appVersion}` | `201 {data:{keyId,label,securityLevel,createdAt}}` | 1. Consommation atomique du ticket (`purpose='enrol'`, même utilisateur, même session, non expiré), sinon 400 `invalid_ticket`.<br>2. `origin` ASCII et dans `allowedOrigins`, sinon 400 `origin_mismatch`.<br>3. SPKI P-256 (`asymmetricKeyType==='ec'`, `namedCurve==='prime256v1'`), sinon 400 `bad_key`. Empreinte déjà connue : 409 `already_enrolled`.<br>4. Signature de la charge d'enrôlement, sinon 400 `bad_signature`.<br>5. Attestation (§4.3), sinon 422.<br>6. Transaction : révocation `replaced` des clés actives du même utilisateur et du même `install_id`, puis insertion avec `credential_version` (et `sso_epoch` en SSO).<br>7. `session.deviceKeyId = keyId`.<br>8. Audit et e-mail [D13].<br>Ne répond jamais 401. |
| `DELETE /api/profile/device-keys/:id` | — | 204 ou 404 | Seulement une clé de l'appelant. Pas de step-up [D8b]. Raison `user`, puis §6.7. |
| `DELETE /api/profile/device-keys` | — | 204 | Toutes les clés de l'appelant, raison `user`. |
| `POST /api/profile/device-keys/:id/invalidated` | — | 204 | Seulement une clé de l'appelant. Raison `invalidated`, puis §6.7, ce qui tue aussi la session courante. |

**Connexion** (`auth.controller.ts`, `twoFactor.controller.ts`, `twoFactor.routes.ts`) :

| Route | Changement |
|---|---|
| `POST /api/auth/login` (`auth.controller.ts:22-62`) | Après `regenerateSession` et `pendingMfaUserId`, si toutes ces conditions sont réunies :<br>• l'en-tête désigne une clé active de **cet** utilisateur, avec `credential_version` à jour ;<br>• le compte est local (`foreign_source IS NULL`), avec `totp_enabled` ;<br>• `device_keys_enabled` et `device_keys_login` sont actifs ;<br>• la clé est acceptable au regard de l'attestation.<br>Alors émettre un défi `purpose:'login'` sur `sha256(nouveau sessionID)`, ajouter `methods.device:true` et `deviceChallenge`, et **ne pas** envoyer l'e-mail OTP automatique. |
| `POST /api/profile/2fa/device-challenge` (nouveau, `mfaLimiter` + 10 / 15 min par session en attente) | Exige `pendingMfaUserId` et l'en-tête. Répond `{data:{deviceChallenge}}`. |
| `POST /api/profile/2fa/verify` (`twoFactor.controller.ts:149-194`) | Ajoute `method:'device'` : `verifyAssertion` avec `purpose:'login'` contre `pendingMfaUserId`, **avant** `regenerateSession`, puis la même fin de session qu'avec le code.<br>Échec : `401 {error:'Invalid code', deviceError}`.<br>Pour la méthode TOTP : `verifyTotpStep` + `acceptTotpStep('strict')`, avec le pas enregistré sur la nouvelle session.<br>Dans les deux cas, après `regenerateSession`, lier la session si l'en-tête désigne une clé active de l'utilisateur. Remise à zéro de `step_up_throttle.locked` (`code`). Audit `auth.login` avec `via:'password+device_key'` ou `'password+totp'`. |
| `POST /api/auth/logout` (`auth.controller.ts:92`) | Avant `session.destroy` : si l'en-tête (ou `session.deviceKeyId`) désigne une clé de l'utilisateur, `revoke(key, 'logout')`, qui tue aussi les autres sessions liées. |
| `GET /api/auth/me` | Ajoute `data.deviceKey: {bound: boolean, keyId?: string}`. |

**Administration** (`users.routes.ts`, routeur tenant, `users.manage` + portée P1) :
- `GET /api/users/:id/device-keys` ;
- `DELETE /api/users/:id/device-keys/:keyId` ;
- `DELETE /api/users/:id/device-keys` : raison `admin`, `revoked_by` = l'appelant.

**Réglages de plateforme** (`appConfig.controller.ts:6`, `ALLOWED_KEYS`) : `device_keys_enabled`, `device_keys_login`, `device_keys_require_attestation` et `device_keys_strict_session`, avec leurs défauts dans `appConfigService.getAll`.
- Toutes les lectures se font par `=== 'true'`.
- Le passage de `device_keys_require_attestation` à `'true'` révoque les clés `unverified` (`policy`).

### 6.6 Couverture des sites d'appel

| Site | Fichier(s) | Accepte l'empreinte | Notes |
|---|---|---|---|
| Commandes (`command.<type>`, dont `enable/disable_airgap`, `enable/disable_privacy_mode`, `uninstall_agent`, alimentation) | `routes/command.routes.ts` (1 appel, clé dynamique) | Oui (enveloppe) | `deviceIds` passé. |
| Appareils : suppression, transfert de tenant (×2), changement de groupe groupé, confidentialité, etc. | `routes/device.routes.ts` (10 appels) | Oui | Vérifier que chaque appel passe `deviceIds`, et que le corps ne change pas entre les deux envois. |
| Session distante (`remote.session_start`) | `routes/remote.routes.ts` | Oui | |
| Script manuel (`script.execute_manual`) | `routes/script.routes.ts` | Oui | Un seul appel avec `deviceIds[]` : `count = 1`. |
| Remédiation logicielle | `routes/softwareCompliance.routes.ts` | Oui | |
| Hyper-V, Veeam | `routes/hyperv.routes.ts`, `routes/veeam.routes.ts` | Oui | |
| Planifications (`schedule.bypass_privacy_mode`, ×3) | `routes/schedule.routes.ts` | Oui | La création appelle `applyRestriction` **avant** l'insertion. L'`enforce` après insertion ne concerne que la branche `restricted`. |
| Scénarios (`scenario.bypass_privacy_mode`) | `routes/scenario.routes.ts` | Oui | |
| Restrictions, effacement de l'audit, configuration | `routes/restriction.routes.ts`, `routes/audit.routes.ts`, `routes/appConfig.routes.ts` | Oui | Tenant dans la liaison (R5). |
| Utilisateurs (`tenant.manage_users` ×3), équipes (`tenant.manage_teams` ×3, `tenant.manage_permissions` ×2) | `controllers/users.controller.ts`, `controllers/teams.controller.ts` | Oui | Fonctionne grâce à P5 (preuves hors du corps). |
| Profil (`tenant.manage_profile`) | `routes/profile.routes.ts:17-35` | Oui | Fonctionne grâce à P4 et P5. |
| `requireFreshTotp('profile.ssh_key_add')` | `routes/profile.routes.ts:93` | Oui [D6] | |
| `requireFreshTotp('profile.ssh_authorize_ip')` | `routes/profile.routes.ts:142` | **Non** [D6] | IP de l'opérateur mobile (CGNAT). En session liée : mot de passe + code. |
| Connexion (comptes locaux) | `auth.controller.ts`, `twoFactor.controller.ts` | Oui [D7] | |
| Gestion du TOTP (P2), enrôlement | `twoFactor.controller.ts`, `deviceKey.routes.ts` | **Non** | Il faut un vrai code. |
| ProxyJump, déverrouillage de confidentialité, approbations, explorateur par socket, lectures déléguées | `sshBastion/jumpAuthz.ts`, `routes/privacyGate.routes.ts`, `routes/approval.routes.ts`, `socket.ts`, `middleware/delegatedAuth.ts` | **Inchangés** | Pas de corps de session, autre facteur, ou hors périmètre. |

Les 32 appels directs à `applyRestriction` ou `restrictionService.enforce` sont couverts sans modification par route. Liste à regénérer avant de patcher :

```
grep -rn "applyRestriction(\|restrictionService.enforce(" server/src
```

### 6.7 Révocation

**Fonction unique : `deviceKeyService.revoke(keyIds, reason, byUserId?)`.** Dans une transaction, elle enchaîne quatre opérations :
1. `status='revoked'`, `revoked_at`, `revoked_by`, `revoke_reason` ;
2. les défis ouverts de la clé passent à `consumed_at=now(), result='revoked'` ;
3. `killSessionsForKey(id)` pour chaque clé ;
4. suppression de toutes les IP de confiance de l'utilisateur (`tfaTrustService.revokeAllForUser`), **sauf** pour les raisons `replaced`, `stale` et `policy`.

Elle vide aussi l'entrée du cache de statut et écrit une ligne d'audit `device_key.revoked` par clé.

**Déclencheurs.**

| Déclencheur | Fichier | Raison | Filet |
|---|---|---|---|
| Déconnexion de l'app (clé de l'en-tête ou clé liée) | `controllers/auth.controller.ts:92` | `logout` | — |
| Révocation depuis le profil (web ou app) | `routes/deviceKey.routes.ts` | `user` | — |
| Invalidation signalée par l'app | `routes/deviceKey.routes.ts` | `invalidated` | — |
| Révocation par un administrateur | `routes/users.routes.ts` | `admin` | — |
| Changement de son propre mot de passe | `controllers/profile.controller.ts:106-123` | `password_change` [D8] | trigger |
| Mot de passe changé par un administrateur | `controllers/users.controller.ts:133-150` | `password_reset` | trigger |
| Réinitialisation par e-mail | `services/passwordReset.service.ts:90-110`, après la transaction | `password_reset` | trigger |
| Remplacement ou désactivation du TOTP | `controllers/twoFactor.controller.ts` `totpEnable`, `totpDisable` | `totp_changed` / `totp_disabled` | trigger |
| Réinitialisation MFA par un administrateur | `controllers/users.controller.ts:223-237` | `totp_reset` | trigger |
| Désactivation (locale ou Obligate) | `controllers/users.controller.ts:79-131`, `routes/obligateCallback.routes.ts:726` | `user_disabled` (+ P6) | trigger |
| Changement d'identifiants par un chemin sans hook (`obligateCallback.routes.ts:548`, amorçage `index.ts:~441`, code futur, retour arrière de version) | — | `credentials_changed`, à l'usage | **trigger seul** |
| Obligate `credentials-changed` (lot O) | `routes/obligateCallback.routes.ts` `sso-user-sync` | `sso_mfa_changed` | époque vérifiée à l'usage |
| Réenrôlement depuis la même installation | `enrol/finish` | `replaced` | — |
| 180 jours sans usage | tâche quotidienne | `stale` [D14] | — |
| `require_attestation` activé | `appConfig.controller.ts` | `policy` (clés `unverified`) | contrôle à l'usage |
| Suppression de l'utilisateur | cascade de clé étrangère | — | — |

### 6.8 Limites et plafonds

| Compteur | Portée | Limite | Effet | Stockage |
|---|---|---|---|---|
| Échecs de code (enveloppe, `requireFreshTotp`, gestion du TOTP, enrôlement) | utilisateur | 10 / 15 min | `429 {error:'Too many verification attempts'}` + `Retry-After` | `step_up_throttle` (`code`) |
| Même compteur | utilisateur | 30 / 24 h | `locked=true` : code refusé (`429 {codeLocked:true}`) jusqu'à une **connexion complète réussie** ou une réinitialisation MFA par un administrateur | idem |
| Même compteur | utilisateur | 5e échec en 24 h | E-mail « tentatives de code » (une fois par 24 h) + audit `auth.step_up_locked` au blocage | idem (`notified_at`) |
| Échecs d'enrôlement (mot de passe ou code) | utilisateur | 3 / 24 h | Enrôlement refusé 24 h (`403 enrol_locked`) | `step_up_throttle` (`enrol`) |
| Échecs d'assertion (`invalid_assertion`, `bad_signature`) | **session** | 5 / 15 min | `deviceKeyStatus:'throttled'` pour cette session | `Map` en mémoire |
| Émission de défis | session et utilisateur | 30 / min par session, 300 / h par utilisateur | `throttled` | `Map` en mémoire |
| Connexion par empreinte | existant | `mfaLimiter` (50 / 15 min par IP), `mfaAccountLimiter` (10 / 15 min par utilisateur en attente) | inchangé | `middleware/rateLimiter.ts:62-100` |

Deux règles de séparation :
- les échecs de code ne bloquent pas l'empreinte ;
- les échecs d'assertion ne bloquent pas le code.

La fenêtre TOTP passe de ±2 pas à ±1 pas pour toutes les vérifications locales [D11].

### 6.9 Tâches périodiques

Elles tournent dans la boucle cron de `index.ts`, à côté de `tfaTrustService.sweepExpired` :
- **toutes les heures** : suppression des défis expirés depuis plus de 7 jours ;
- **une fois par jour** : révocation `stale` des clés inutilisées depuis 180 jours (`last_used_at`, ou `created_at` si elles n'ont jamais servi) ;
- **une fois par jour** : rafraîchissement de la liste de révocation Google, sans effet si elle est injoignable.

### 6.10 Lot O côté Obliance (SSO)

- **`obligateService`** :
  - `capabilities()` : cache de 10 min ;
  - `verifyTotp(foreignId, code, {consume})` renvoie `{valid, step, mfaEpoch}` ;
  - `getMfaEpoch(foreignId)` : cache de 5 min, échec fermé.
- **`/api/auth/sso-redirect?reauth=1`** : pose `session.pendingReauth` et ajoute `prompt=login&max_age=0` à l'URL d'autorisation Obligate.
- **`/api/auth/callback`**, si `pendingReauth` est posé :
  - l'assertion doit porter le même `foreign_id`, `authTime ≥ startedAt` et `amr` contenant `otp` ;
  - le callback pose alors `session.ssoReauthAt = now` **sans changer d'utilisateur**. Le `sessionID` est conservé, ou régénéré en recopiant `userId`, `currentTenantId` et `deviceKeyId`.
- **`sso-user-sync`** : nouvelle action `credentials-changed {remoteUserId, mfaEpoch}`, qui révoque avec `sso_mfa_changed` et tue les sessions de l'utilisateur.

---

## 7. Android : plan par module

Toutes les classes nouvelles ou modifiées gardent la règle du dépôt : **aucun type Obliance dans `core:*`**. Le protocole « obli-devkey-v1 » est commun à toutes les apps Obli. Seuls les chemins d'API sont propres à Obliance.

### 7.1 `:core:network` (JVM pur)

- `ApiOutcome.StepUpRequired` gagne des champs **par défaut**, pour garder la compatibilité de source :
  - `trustIpAllowed: Boolean = true`, `codeRequiresPassword: Boolean = false`, `codeRequiresReauth: Boolean = false` ;
  - `device: DeviceStepUp? = null`, avec `DeviceStepUp(status: DeviceKeyStatus, challenge: DeviceChallenge?, error: DeviceError?)` ;
  - `origin: String? = null`.
- `ApiResponses.classify` lit ces champs, ainsi que `codeLocked`. Les tests portent sur des corps enregistrés (annexe A, J1 à J8).
- `ObliHttp.call(…, headers: Map<String,String> = emptyMap())` sert à l'en-tête explicite de la connexion. `origin` est rempli dans `StepUpRequired` **seulement si** `Origins.of(response.request.url) == this.origin`.
- `DeviceKeyHeaderInterceptor(source: (origin: String) -> String?)`, ajouté à `ObliHttp.defaultClient` :
  - il pose `X-Obli-Device-Key` seulement si la source renvoie une clé pour cette origine **et** pour l'utilisateur de la session active de cette origine ;
  - il ne remplace jamais un en-tête explicite.
- Tests :
  - `defaultClient` ne suit pas les redirections ;
  - l'en-tête n'est jamais posé vers une autre origine ;
  - il n'est pas posé après un changement de compte.

### 7.2 `:core:security` (JVM pur)

- `DeviceProof.kt` :
  - modèles `DeviceChallenge`, `DeviceAssertion` ;
  - `DeviceProofPayload.build(purpose, origin, userId, keyRef, challenges): String`, qui refuse `\r`, `\n`, `count` hors de 1..50 et une origine non ASCII ;
  - `SignPrompt(title, subtitle, description, negative)`.
- **Interfaces** :
  - `DeviceKeyStore`, qui gère les enregistrements `DeviceKeyRecord(origin, userId, username, keyId, alias, installId, securityLevel, createdAt)` et expose `find(origin, userId)`, `findByUsername(origin, username)`, `put`, `remove`, `installId(origin)` ;
  - `DeviceSigner`, avec `suspend fun sign(record, payload: ByteArray, prompt: SignPrompt): SignResult`, où `SignResult` vaut `Signed(der)`, `UseCode`, `Cancelled`, `Invalidated`, `LockedOut` ou `Unavailable(reason)`.
- `ActionSpec` gagne `tenantId: Long? = null` et `serverName: String? = null`.
- `ActionPrompter` gagne :
  - `askTwoFactor(spec, currentIp, previousWasWrong, options: TwoFactorOptions = TwoFactorOptions())`, avec `TwoFactorOptions(trustIpAllowed, passwordRequired, reauthRequired)` ;
  - `TwoFactorAnswer(code, trustIp, password: String? = null)` ;
  - `signStepUp(spec, request: DeviceSignRequest): SignResult`, qui construit l'invite à partir de `spec` et du défi, pour un ou N défis ;
  - `deviceKeyInvalidated(origin, keyId)`, qui signale l'invalidation, purge, efface le cookie et affiche S03 ;
  - `reauthenticateSso(origin): Boolean` (lot O).
- `ActionRunner`, sur `StepUpRequired` :
  1. Tant que `device?.challenge != null`, `signAttempts < 2` et `!preferCode` :
     - vérifier l'origine, l'utilisateur, la clé et le tenant. En cas d'écart, ne pas signer ; un tenant différent renvoie `ActionResult.Blocked(TENANT_CHANGED)` ;
     - puis `signStepUp`. `Signed` : `extra = base + deviceAssertion`. `UseCode`, `LockedOut` ou `Unavailable` : `preferCode = true`. `Cancelled` : `Cancelled`. `Invalidated` : `deviceKeyInvalidated`, puis `SessionExpired`.
  2. Sinon, S42 avec `TwoFactorOptions(trustIpAllowed, codeRequiresPassword, codeRequiresReauth)`. Avec `reauthRequired`, `reauthenticateSso` passe d'abord. Ensuite `extra = base + twoFactorCode (+ stepUpPassword) (+ trustIp si permis)`.
  3. `base` = `extra` sans `twoFactorCode`, `trustIp`, `stepUpPassword` ni `deviceAssertion` (R7). `deviceBulkId` est conservé.
  4. `deviceError:'invalid_assertion'` ou statut `throttled` : `preferCode = true`. `disabled` : S42 normal.
  5. Le mot de passe n'est **jamais** mémorisé au-delà de l'appel. Dans une boucle, il reste en mémoire jusqu'à la fin de la boucle, puis il est effacé.
- `BulkStepUp` (lot A6) : premier passage avec `deviceBulkId`, collecte des défis, une seule signature, second passage (§4.9.4).
- `DeviceKeyEnrolment`, orchestration pure sur des interfaces : `begin`, génération de la clé, signature, `finish`, et suppression de l'alias en cas d'échec.

### 7.3 `:core:devicekey` (nouveau, bibliothèque Android, sans UI)

- `KeystoreDeviceKeys` :
  - `generate(alias, nonce): GeneratedKey(spki, chain, securityLevel)`, avec les paramètres par niveau d'API du §4.2 et la reprise sans StrongBox ;
  - `keyHealth(alias): Healthy | Invalidated | Missing` ;
  - `signature(alias): Signature` pour le `CryptoObject` ;
  - `delete(alias)`.
- `KeySpecPlan.forSdk(sdk, hasStrongBox)` est une fonction pure qui décrit les paramètres. Elle est testée sur JVM, car Robolectric n'a pas de Keystore.
- `DataStoreDeviceKeyStore` implémente `DeviceKeyStore` (DataStore Preferences, JSON). Il peut aussi vivre dans `:core:data`, comme `DataStoreServerRegistryStore`.
- Au démarrage, `reconcile()` supprime les enregistrements sans alias, et les alias `obli.devkey.v1.*` sans enregistrement.

### 7.4 `:core:security-ui`

- `BiometricDeviceSigner(activity)` implémente `DeviceSigner` :
  - `BiometricPrompt` avec `CryptoObject(signature)` et `setAllowedAuthenticators(BIOMETRIC_STRONG)` **seul** : pas de `DEVICE_CREDENTIAL`, donc un bouton négatif est obligatoire ;
  - `setConfirmationRequired(true)` ;
  - erreurs : `ERROR_LOCKOUT` et `ERROR_LOCKOUT_PERMANENT` donnent `LockedOut` ; `ERROR_NEGATIVE_BUTTON` donne `UseCode` ; `ERROR_USER_CANCELED` et `ERROR_CANCELED` donnent `Cancelled` ; `KeyPermanentlyInvalidatedException` à `initSign` donne `Invalidated`.
- S42 gagne deux variantes :
  - « **mot de passe + code** » : un champ mot de passe au-dessus des 6 cases, sans case « IP de confiance » ;
  - « **réauthentification Obligate** » (lot O).

  Dans les deux, la case IP est masquée si `trustIpAllowed` est faux.
- L'invite de signature nomme l'action, la cible, « serveur › tenant » (le serveur est toujours nommé ici) et, pour un lot, « 12 appareils ».
- **Double contact [D9].** Pour une action T2 ou T3, la biométrie locale reste suivie de l'empreinte 2FA en v1. Les messages le disent : « Deuxième validation : double authentification ».

### 7.5 `:core:auth`

- `ServerSession` expose `userId` (depuis le `probe`).
- L'intercepteur tire la clé de `ServerSessions` et de `DeviceKeyStore`.
- `markSignedOut()` appelle d'abord la déconnexion serveur, avec l'en-tête posé par l'intercepteur, puis la purge de la clé.

### 7.6 `:core:webfallback` (S90, lot A5)

- Pont `window.ObliNative.signDeviceChallenge(challengeJson): Promise<{deviceAssertion} | {cancelled:true} | {useCode:true} | {error}>`, en `bridgeVersion` 2. Le contrat est à ajouter à `docs/obli-mobile.md`.
- Avant de signer, la méthode vérifie :
  - que l'origine courante de la vue web est l'origine du serveur actif ;
  - que `challenge.userId` et `challenge.keyId` correspondent à la clé (origine, utilisateur de la session) ;
  - que le but est `stepup`.
- L'invite est construite en natif, à partir de `challenge.action` et `challenge.tenantName`.
- Une seule invite à la fois ; une nouvelle demande pendant une invite est refusée.

### 7.7 `:obliance:api` et `:obliance:data`

- `DeviceKeysApi` : `list()`, `enrolBegin(installId, password, code)`, `enrolFinish(...)`, `revoke(id)`, `revokeAll()`, `reportInvalidated(id)`.
- `AuthApi` :
  - `login(username, password, deviceKeyId: String?)` renvoie `TwoFactorRequired(methods, deviceChallenge?)` ;
  - `verifyDevice(assertion)` ;
  - `deviceChallenge()`.
- `DeviceKeysRepository` dans `ObliServices`, par serveur :
  - `state(serverId)` : non disponible sur ce serveur / désactivée / non enrôlé / actif (niveau) / invalidé ;
  - `enrol(serverId)` ;
  - `revoke(serverId, keyId)` ;
  - `keys(serverId)`.

### 7.8 `:obliance:access` (S01, S03, S93)

- Connexion locale : si `methods.device` est vrai, l'invite biométrique s'affiche directement (titre « Connexion à Obliance Prod »), avec le lien « Utiliser un code ». Le repli se fait sur l'écran de code actuel.
- L'en-tête explicite utilise la clé de `findByUsername(origin, username)`.
- L'empreinte n'est jamais proposée pour une connexion Obligate.

### 7.9 `:obliance:more` (S85, Profil et sécurité)

Nouvelle section « **Validation par empreinte** », une ligne par serveur. Les états possibles :
- non disponible (ancien serveur) ;
- désactivée par l'administrateur ;
- origine non configurée ;
- compte Obligate non pris en charge ;
- biométrie forte absente ;
- non activée → **Activer** ;
- active (« StrongBox » / « Environnement sécurisé ») → **Désactiver sur ce téléphone** ;
- invalidée → **Réactiver**.

L'écran « Téléphones de ce compte » liste les clés, avec **Révoquer** (T1) et **Tout révoquer** (T2).

Le déroulé d'enrôlement suit le §4.9.1. Les textes sont à l'annexe B.

### 7.10 `:obliance:app`

- Câblage `AppGraph` : `DeviceKeyStore`, intercepteur, `BiometricDeviceSigner` et prompter.
- `keyHealth()` sur `onResume` pour le serveur actif, et avant chaque signature.
- La déconnexion et le retrait d'un serveur passent par §4.9.6.
- Le manifeste ne change pas : `USE_BIOMETRIC` vient d'androidx.biometric, et `allowBackup` est déjà à `false`.

### 7.11 `CONTRACT.md` (à mettre à jour avec le lot A1)

- §12 :
  - règle « corps identique à chaque envoi » ;
  - `extra` peut contenir `deviceAssertion`, `stepUpPassword` et `deviceBulkId` ;
  - nouveaux paramètres de `ActionSpec` (`tenantId`, `serverName`).
- Nouveau §14 « Validation par empreinte » : entrées publiques, états de S85, interdictions (ne jamais signer une charge construite ailleurs que par `DeviceProofPayload`, ne jamais journaliser une assertion ni un mot de passe).

---

## 8. Web (`client/`)

| Élément | Fichier(s) | Détail |
|---|---|---|
| Liste des téléphones (profil) | `pages/ProfilePage.tsx`, `api/profile.api.ts` | Section « Téléphones de validation » :<br>• pour chaque clé : libellé, badge de niveau (StrongBox / Environnement sécurisé / **Non vérifié**, en ambre), date d'ajout, dernier usage avec IP, nombre d'usages, mention « cette session » si `current` ;<br>• **Révoquer** (confirmation) et **Tout révoquer** ;<br>• texte : « L'ajout se fait depuis l'application Android, dans Profil et sécurité » ;<br>• compte SSO sans lot O : « Pas encore disponible pour les comptes Obligate ». |
| Téléphones d'un utilisateur (administration) | `pages/AdminUsersPage.tsx`, `api/users.api.ts` | Même liste, en lecture, avec **Révoquer** et **Tout révoquer**. Visibilité selon la portée P1. |
| Réglages de plateforme | `pages/SettingsPage.tsx` | Bloc « Validation par téléphone » :<br>• 4 interrupteurs (activée, connexion, attestation obligatoire, session stricte) ;<br>• état de l'origine : « Origine autorisée : https://… (APP_URL) », ou en rouge « Non configurée : l'enrôlement est refusé ». |
| Fenêtre 2FA | `components/common/TwoFactorPromptModal.tsx`, `utils/twoFactorGate.ts`, `utils/withTwoFactor.ts`, `api/client.ts` | • `codeRequiresPassword` : champ mot de passe (`stepUpPassword`) ;<br>• `trustIpAllowed === false` : case IP masquée ;<br>• `deviceChallenge` avec `canUseNative('signDeviceChallenge')` : appel du pont, puis renvoi avec `deviceAssertion`. `useCode` bascule sur la fenêtre de code ;<br>• `codeLocked` / 429 : message de blocage ;<br>• `codeRequiresReauth` (lot O) : bouton « Reconfirmer avec Obligate ». |
| Pont natif | `native/bridge.ts` | Méthode `signDeviceChallenge`, capacité `deviceKey`. |
| i18n | `i18n/locales/en`, `fr` | Espace `deviceKeys.*`, au minimum en et fr, avec repli inline obligatoire (règle CLAUDE.md). Textes à l'annexe B. |

Le web de bureau n'a jamais de session liée : pour lui, seuls la liste, les réglages et la case IP masquée en `requireFreshTotp` changent.

**Le lot web part avec le lot serveur S2**, et non après. Sans lui, une page S90 dans une session liée boucle sur la fenêtre de code.

---

## 9. Politiques et valeurs par défaut

**Réglages de plateforme** (`app_config` global, pas de réglage par tenant [D15]) :

| Clé | Défaut | Effet |
|---|---|---|
| `device_keys_enabled` | `'true'` | À `'false'`, trois effets :<br>• aucun défi, aucune liaison ; les sessions liées redeviennent normales ;<br>• assertions refusées (`disabled`) et enrôlement refusé ;<br>• les clés sont **gardées**, et les réactiver les rétablit. |
| `device_keys_login` | `'true'` | Autorise la connexion par empreinte (comptes locaux). |
| `device_keys_require_attestation` | `'true'` | Refuse l'enrôlement si l'attestation échoue. Le passage à `'true'` révoque les clés `unverified`. |
| `device_keys_strict_session` | `'true'` | En session liée, refuse le code seul [D2]. |

**Variables d'environnement** (`config.ts`, `.env.example`) :

| Variable | Défaut | Effet |
|---|---|---|
| `DEVICE_KEYS_DISABLED` | `false` | Coupure d'urgence, prioritaire sur les réglages. |
| `APP_URL` (existe déjà) / `DEVICE_KEY_ORIGINS` | vide | Origines autorisées. Les deux vides : enrôlement refusé [D17]. |
| `DEVICE_KEY_APP_IDS` | `tools.obli.obliance.next` | Packages acceptés dans l'attestation. |
| `DEVICE_KEY_APP_SIGNERS` | `8c7e67f8…6d82ac8d` (complet au §4.3) | Signataires acceptés. On y ajoute celui du build debug seulement sur un serveur de développement [D19]. |

**Constantes dans le code** :

| Constante | Valeur |
|---|---|
| Durée de vie d'un défi | 120 s [D16] |
| Durée de vie d'un ticket d'enrôlement | 180 s [D16] |
| Clés par utilisateur | 5 au plus [D14] |
| Péremption | 180 jours [D14] |
| Lot | 50 défis au plus, émis sur 60 s au plus |
| Fenêtre TOTP | ±1 pas [D11] |
| Plafonds | §6.8 [D12] |
| Réauthentification Obligate | 5 min |
| Cache époque Obligate | 5 min |
| Cache capacités Obligate | 10 min |
| Cache statut de clé | 30 s |

---

## 10. Audit et notifications

**Journal d'audit.** Tenant = `req.tenantId ?? req.session.currentTenantId ?? MASTER_TENANT_ID`. `resourceType: 'user'`, `resourcePath: String(userId)`. Jamais de mot de passe, de code, de signature ni de nonce dans les détails.

| Action | Détails |
|---|---|
| `device_key.enrol_begin` | `installId`, IP |
| `device_key.enrol_failed` | `reason` (`bad_password_or_code`, `attestation_failed:<reason>`, `origin_mismatch`, `bad_signature`, `too_many_keys`, `locked`) |
| `device_key.enrolled` | `keyId`, `label`, `securityLevel`, `origin`, `osPatchLevel`, `appVersion`, `rkp`, `revocationChecked` |
| `device_key.used` | `keyId`, `action`, `purpose`, `count`, `deviceIds`, `tenantId`, IP. **Chaque usage.** |
| `device_key.assertion_rejected` | `keyId`, `deviceError`, `result` |
| `device_key.revoked` | `keyId`, `reason`, `by` (une ligne par clé) |
| `device_key.sessions_killed` | `keyId` ou `userId`, `count` |
| `auth.login` | `via: 'password+device_key' \| 'password+totp' \| …` (existant, enrichi) |
| `auth.step_up_failed` | `action`, `via:'totp'`, compteurs |
| `auth.step_up_locked` | `kind:'code' \| 'enrol'` |

**E-mails** [D13]. Ils sont envoyés si `otp_smtp_server_id` est configuré et que l'utilisateur a une adresse. Le texte est en anglais, comme les OTP actuels (`twoFactor.service.ts:54-79`).
- « A phone was registered for two-factor validation on <server> (label, date, IP). If this was not you, revoke it in your profile and change your password. »
- « Several wrong verification codes were entered on your account (<n> in 24 h). »

**Notification dans l'app.** Après un enrôlement réussi, confirmation dans S85. Il n'y a pas de notification poussée.

---

## 11. Compatibilité et déploiement

| Client ↓ / Serveur → | Ancien serveur | Nouveau serveur, politique active | Nouveau serveur, politique coupée |
|---|---|---|---|
| Web de bureau | inchangé | inchangé + anti-rejeu, plafonds, fenêtre ±30 s | idem |
| Ancien app | inchangé | inchangé + anti-rejeu, plafonds (jamais d'en-tête, jamais lié) | idem |
| Nouvel app sans clé | code | code ; S85 propose d'activer | code ; S85 « désactivée par l'administrateur » |
| Nouvel app avec clé | en-tête ignoré ; `GET /device-keys` → 404 ; S85 « non disponible » | empreinte ; session liée | code (session non liée) |
| Vue web S90 de l'app | inchangé | pont natif ; sinon mot de passe + code | code |

- **Retour arrière du serveur vers une version sans la fonctionnalité** : les tables restent, l'en-tête est ignoré, le code redevient suffisant. On revient à la sécurité d'aujourd'hui, jamais en dessous.
- **Ordre de mise en production** :
  1. P1 à P6 ;
  2. serveur S1 à S3 avec le web W1, qui partent ensemble ;
  3. l'app A1 à A4 ;
  4. le pont A5 et W2 ;
  5. les lots A6 et O.
- Conformément au CLAUDE.md (section mobile), chaque modification serveur est **signalée au propriétaire avant le build serveur**.

---

## 12. Plan de tests

### 12.1 Tests automatisés côté serveur (`node --test`, sans dépendance)

- **`payload.test.ts`** :
  - vecteurs V1 et V2 : même `sha256`, et signature vérifiée avec la SPKI fournie ;
  - refus de `\r` et `\n`, de `count` égal à 0 ou 51, d'une origine non ASCII ;
  - `normaliseOrigin('https://Obliance.Example.com:443/x')` donne `https://obliance.example.com`.
- **`binding.test.ts`** :
  - vecteurs B1 à B6 ;
  - tenant `-` ;
  - tri et dédoublonnage des `deviceIds` ;
  - indifférence à l'ordre des clés, sensibilité à l'ordre des tableaux ;
  - preuves absentes du hash.
- **`der.test.ts` et `attestation.test.ts`** :
  - **vraies chaînes** capturées sur les téléphones du propriétaire avec un build debug, en fixtures ;
  - chaînes négatives dérivées : niveau 0, niveaux différents, bit mot de passe à 1, `authTimeout` présent, `noAuthRequired`, `allApplications`, tags placés seulement dans `softwareEnforced`, extension dans un intermédiaire, `deviceLocked=false`, `SelfSigned`, mauvais package, mauvais signataire, mauvais challenge, SPKI différente, racine inconnue, numéro de série révoqué, liste de révocation trop ancienne ;
  - tags hors d'ordre (tolérance).
- **`totpStep.test.ts`** : table des règles `strict` et `stepup`, réutilisation dans la même session, refus dans une autre session, connexion suivie d'un enrôlement avec le même code (refus).
- **`throttle.test.ts`** : 10 / 15 min, 30 / 24 h (blocage), remise à zéro à la connexion, enrôlement 3 / 24 h, compteurs code et assertion séparés.

### 12.2 Bout en bout côté serveur (`server/scripts/device-key-e2e.mjs`)

Il tourne contre une instance de développement avec `require_attestation=false`. Un faux téléphone en `crypto` Node tient le rôle de l'app. Chaque ligne est un cas à vérifier.

1. `enrol/begin` sans mot de passe → 401. Avec le code de la connexion → refus. Avec un nouveau code → 200. 3 échecs → `enrol_locked`.
2. `finish` :
   - rejoué → `invalid_ticket` ;
   - autre session → `invalid_ticket` ;
   - origine hors liste → `origin_mismatch` ;
   - sans `APP_URL` ni `DEVICE_KEY_ORIGINS` → 403.
3. Step-up `POST /api/commands`, avec un redémarrage d'un appareil de test marqué sensible :
   - défi → assertion → 200 ;
   - rejeu → refus ;
   - autre session avec le même cookie et une autre clé → refus ;
   - corps modifié → `invalid_assertion` ;
   - **bascule de tenant entre défi et renvoi** → `invalid_assertion` ;
   - après 121 s → `challenge_expired` avec un nouveau défi ;
   - deux renvois identiques en parallèle → exactement un 200.
4. Session liée :
   - code seul → `codeRequiresPassword` ; mot de passe + code → 200 ;
   - IP de confiance existante ignorée ; `trustIp` jamais accordé ;
   - code + assertion ensemble → seul le code est évalué.
5. Révocation depuis le profil :
   - la requête suivante du « téléphone » → 401 `revoked` ;
   - `tfa_trusted_sessions` vide ;
   - défis ouverts brûlés.
6. `UPDATE users SET password_hash=… ` en SQL direct (chemin sans hook) → la requête suivante révoque la clé (`credentials_changed`).
7. Politique :
   - coupée → code seul accepté, `disabled` ;
   - rétablie → la clé fonctionne à nouveau ;
   - `require_attestation` à `'true'` → clé `unverified` révoquée (`policy`).
8. Déconnexion avec en-tête → clé révoquée (`logout`), autres sessions liées supprimées.
9. Connexion par empreinte → session liée, audit `password+device_key`. Pas d'e-mail OTP envoyé.
10. Lot :
    - 2 défis, même `bulkId` → une signature, deux 200 ;
    - actions différentes → refus ;
    - `bulkId` absent → refus.
11. P1 : un gestionnaire d'utilisateurs de tenant ne peut ni changer un rôle, ni toucher un administrateur, ni un utilisateur d'un autre tenant.
12. P5 : `tenant.manage_users` marqué sensible → le code passe (plus de boucle) ; `twoFactorCode` absent des journaux et des approbations.

### 12.3 Tests automatisés côté Android (JVM + Robolectric)

- `DeviceProofPayloadTest` : V1 et V2, vérifiées par JCA (`KeyFactory.getInstance("EC")` sur la SPKI, `Signature.getInstance("SHA256withECDSA")`), plus les refus.
- `ApiResponsesTest` : corps enregistrés J1 à J8 (annexe A) → `StepUpRequired` complet, `SessionExpired` sur `revoked`, `RateLimited` sur `codeLocked`, et les anciens corps inchangés.
- `ActionRunnerTest` :
  - défi → signature → renvoi ;
  - « Utiliser un code » → S42 avec mot de passe ;
  - assertion refusée → le code part **sans** `deviceAssertion` ;
  - `challenge_expired` → une seconde signature, jamais une troisième ;
  - `Invalidated` → `deviceKeyInvalidated` puis `SessionExpired` ;
  - tenant différent → `Blocked` sans invite ;
  - utilisateur ou clé différents → pas de signature ;
  - `trustIpAllowed=false` → case absente ;
  - `disabled` → S42 normal ;
  - la variante `reauthRequired` appelle `reauthenticateSso` avant S42.
- `DeviceKeyHeaderInterceptorTest` : origine, utilisateur, changement de compte, en-tête explicite prioritaire. `ObliHttpTest` : pas de redirection, `origin` rempli seulement pour la bonne origine.
- `KeySpecPlanTest` : paramètres pour les API 26, 28, 30 et 35, avec et sans StrongBox.
- `DeviceKeyEnrolmentTest` : échec à chaque étape → alias supprimé ; origine non ASCII → refus.
- Captures Roborazzi :
  - S85, dans tous ses états ;
  - S42 en variante mot de passe ;
  - écran d'explication de l'enrôlement ;
  - liste des téléphones.

### 12.4 À vérifier par le propriétaire sur un vrai téléphone

À faire sur le Galaxy S23 (StrongBox Samsung), et si possible sur un second téléphone TEE seul ou sous API < 30.

1. **Activer** depuis S85 sur Obliance Qual (compte local). Mot de passe + **nouveau** code : si l'on réutilise le code qui vient de servir à la connexion, le refus est attendu.
2. Le web profil affiche le téléphone, avec le niveau « StrongBox » et l'e-mail d'enrôlement reçu.
3. Redémarrer un appareil de test marqué sensible. Vérifier que :
   - l'invite nomme l'action, l'appareil et « serveur › tenant » ;
   - **le code PIN n'est pas proposé** ;
   - l'action passe ;
   - le journal d'audit montre `device_key.used`.
4. Refaire l'action en choisissant « Utiliser un code » : le mot de passe est demandé avec le code.
5. Sur le Wi-Fi d'une IP marquée « de confiance » depuis le PC : l'empreinte est **quand même** demandée sur le téléphone.
6. Ouvrir une page web de l'app (S90) qui déclenche une action sensible : l'empreinte est demandée (pont), sinon mot de passe + code.
7. **Ajouter une empreinte** dans les réglages Android, revenir dans l'app : déconnexion de ce serveur, reconnexion avec mot de passe + code, S85 propose « Réactiver ».
8. Retirer puis remettre le verrouillage d'écran : la clé est détruite, même effet.
9. Depuis le PC, **révoquer** le téléphone : en 30 s au plus, l'app affiche S03.
10. Se déconnecter du serveur dans l'app : le téléphone disparaît de la liste web.
11. Connexion : mot de passe, puis **empreinte** au lieu du code. Pas d'e-mail OTP.
12. Échouer 5 fois l'empreinte (biométrie verrouillée) : bascule sur mot de passe + code.
13. Ouvrir une invite puis toucher une notification d'un autre tenant : l'action est refusée (« Le tenant a changé »).
14. Deux profils de serveur : chacun a sa clé ; révoquer l'un n'affecte pas l'autre.
15. Installer un build **debug** : l'enrôlement sur le serveur de production est refusé (`attestation_failed: app_signer`).
16. Redémarrer le téléphone et, avant tout déverrouillage, toucher une notification : rien ne se signe.
17. Obliance Prod (compte `og_`) avant le lot O : S85 affiche « Pas encore disponible pour les comptes Obligate ».

---

## 13. Découpage du travail et contrat partagé

### 13.1 Contrat partagé (figé avant de commencer)

Toute évolution de ce contrat passe par `v:2` : un pair ignore une `v` qu'il ne connaît pas et retombe sur le code.

1. **En-tête** : `X-Obli-Device-Key: <keyId>` (§4.7).
2. **Champs de corps « preuves »** : `twoFactorCode`, `trustIp`, `stepUpPassword`, `deviceAssertion{v,keyId,challengeIds,signature}` et `deviceBulkId`. Ils sont retirés par le serveur et exclus de la liaison.
3. **Réponses** :
   - 401 de step-up et ses champs (§4.8) ;
   - table des rejets (§4.8) ;
   - erreurs d'enrôlement (§6.5) ;
   - table de correspondance `ApiOutcome` (§4.8).
4. **Charge** `obli-devkey-v1` (§4.4) et vecteurs V1 et V2.
5. **Liaison** : serveur seulement, l'app recopie. Vecteurs B1 à B6.
6. **Endpoints** et formes JSON (§6.5), y compris `GET /api/auth/me` → `deviceKey`.
7. **Paramètres de clé et exigences d'attestation** (§4.2, §4.3) : l'app doit produire exactement ce que le serveur exige.
8. **Pont web** `signDeviceChallenge` (§7.6), à ajouter à `docs/obli-mobile.md`.
9. **Corps enregistrés J1 à J8** (annexe A), communs aux tests serveur et Android.

### 13.2 Lot S : serveur et web (propriétaire de `server/`, `client/`, `shared/`)

| Lot | Contenu | Dépend de | Estimation |
|---|---|---|---|
| S0 | P1 à P6 (+ P7 facultatif). Livrable seul. | — | 2,5 j |
| S1 | Migrations 127/128, `payload.ts`, `der.ts`, `attestation*.ts`, `deviceKey.service.ts`, tests `node --test`, `shared/src/deviceKeys.ts` | S0 | 3 j |
| S2 | `stepUpProof.ts` et branchement de l'enveloppe + `requireFreshTotp`, middleware `deviceKeySession`, routes du profil, révocations et hooks, plafonds, tâches, réglages, audit, e-mails, script e2e | S1 | 3 j |
| S3 | Connexion et déconnexion (§6.5), `/me` | S2 | 1 j |
| W1 | Web : liste du profil, administration, réglages, fenêtre 2FA (mot de passe, case IP, blocage), i18n en/fr. **Livré avec S2.** | S2 | 2 j |
| W2 | Pont côté web (`bridge.ts`, fenêtre 2FA), avec A5 | W1 | 0,5 j |

### 13.3 Lot A : Android (propriétaire de `mobile/android`)

| Lot | Contenu | Dépend de | Estimation |
|---|---|---|---|
| A1 | `core:network` (champs, intercepteur, en-tête explicite, tests), `core:security` (modèles, `DeviceProofPayload`, interfaces, `ActionRunner`, tests), `CONTRACT.md` | contrat | 2,5 j |
| A2 | `:core:devicekey` (Keystore, `KeySpecPlan`, santé, réconciliation), stockage, `BiometricDeviceSigner`, S42 en variante mot de passe | A1 | 2,5 j |
| A3 | `:obliance:api` + `:obliance:data` (`DeviceKeysApi`, dépôt), S85 et enrôlement, liste, `keyHealth` et invalidation, déconnexion | A2, S2 déployé pour l'essai réel | 2,5 j |
| A4 | Connexion par empreinte (S01, S03, S93) | A3, S3 | 1 j |
| A5 | Pont `signDeviceChallenge` (S90) | A3, W2 | 1 j |
| A6 | `BulkStepUp` pour les boucles par appareil existantes | A3 | 1 j |

### 13.4 Lot O : Obligate (dépôt `D:\Obligate`) + Obliance §6.10

Environ 3 j côté Obligate et 1 j côté Obliance. Voir l'annexe C. Il se fait dans le même cycle si [D1] = oui.

**Parallélisme.** S0 et A1 démarrent en même temps. A2 n'a besoin que du contrat. L'essai réel commence dès que S2 et A3 sont prêts, avec des chaînes d'attestation réelles capturées tôt en debug pour les fixtures de S1.

---

## 14. Décisions ouvertes pour le propriétaire

| # | Décision | Recommandation |
|---|---|---|
| **D1** | Comptes Obligate (SSO) : les ouvrir avec le lot O dans le même cycle ? Vos comptes quotidiens de Prod et Dev sont `og_` (persona §4) : sans le lot O, l'empreinte ne servira que sur les comptes locaux. | **Oui, même cycle.** Le serveur détecte la capacité, donc rien ne s'ouvre avant qu'Obligate soit prêt. |
| **D2** | Session liée stricte : sur le téléphone enrôlé, le code seul est refusé (mot de passe + code en secours) et l'IP de confiance est ignorée. | **Oui.** C'est ce qui rend vraie la phrase « il faut le doigt du propriétaire ». |
| **D3** | Refuser les téléphones au bootloader déverrouillé ou aux ROM auto-signées (GrapheneOS, `SelfSigned`). | **Oui.** |
| **D4** | Liste de révocation Google injoignable depuis plus de 7 jours : refuser l'enrôlement. | **Oui** (échec fermé). |
| **D5** | Exiger RKP (clés provisionnées à distance par Google) pour Android 13+. | **Non en v1.** Journalisé ; à réévaluer après 3 mois de relevés. |
| **D6** | Empreinte acceptée pour ajouter une clé SSH, **refusée** pour le bouton « SSH » (autorisation d'IP). | **Oui aux deux.** |
| **D7** | Connexion « mot de passe + empreinte » pour les comptes locaux. | **Oui.** |
| **D8** | Changer son **propre** mot de passe révoque aussi ses téléphones. | **Oui.** Il faudra réactiver l'empreinte. |
| **D8b** | Révoquer un téléphone depuis son profil sans 2FA. | **Oui** (action restrictive). |
| **D9** | Actions T2/T3 : garder deux contacts (confirmation locale puis empreinte 2FA). | **Oui en v1.** On mesure la gêne avant d'optimiser. |
| **D10** | Nouvelle empreinte ajoutée sur le téléphone : déconnexion de ce serveur, puis réactivation. | **Oui.** |
| **D11** | Fenêtre TOTP ±30 s au lieu de ±60 s, pour tous. | **Oui.** |
| **D12** | Plafonds : 10 échecs / 15 min ; 30 / 24 h bloquent le code jusqu'à reconnexion ; enrôlement 3 / 24 h. | **Oui.** |
| **D13** | E-mail à chaque enrôlement et au 5e mauvais code en 24 h (si SMTP). | **Oui.** |
| **D14** | 5 téléphones au plus par utilisateur ; révocation après 180 jours sans usage. | **Oui.** |
| **D15** | Réglages de plateforme seulement (pas par tenant), activés par défaut. | **Oui.** |
| **D16** | Défi 120 s ; ticket d'enrôlement 180 s. | **Oui.** |
| **D17** | Sans `APP_URL` ni `DEVICE_KEY_ORIGINS`, l'enrôlement est refusé. Il faut renseigner `APP_URL` sur les 3 serveurs. | **Oui.** |
| **D18** | Pont « empreinte dans les pages web de l'app » (S90) livré avec la fonctionnalité (A5 + W2). | **Oui**, juste après A4. |
| **D19** | Builds debug : leur signataire n'est accepté que par variable d'environnement, sur un serveur de développement. | **Oui.** |
| **D20** | Approbations à deux (approuver / refuser) : pas de 2FA ajoutée. | **Inchangé.** |

---

## Annexe A : vecteurs de test

Tous les vecteurs ont été recalculés et vérifiés sur Node 24.14 le 2026-09-26. Les signatures ECDSA sont aléatoires : les tests **vérifient** une signature, ils ne comparent jamais des octets.

### V1 : charge simple (`count:1`)

```
obli-devkey-v1
purpose:stepup
origin:https://obliance.example.com
user:42
key:6f1c2d4e-8a8b-4c1e-9d2f-0a1b2c3d4e5f
count:1
challenge:1b4e28ba-2fa1-41d2-883f-0016d3cca427
nonce:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
action:command.reboot
binding:50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c
exp:1790000120
```

- Le nonce correspond aux octets 0x00 à 0x1f. Le binding vaut `sha256("example")`.
- `sha256(charge)` = `5d75a9e6d6cb5dfcc0d2d9ef7fc7348a5c59fa428ece8b07f11d769fe7695fc2`
- SPKI : `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEO6H1i3djvlx3Y3QnxD9qrYXeL/aREhQFgpFHkpHxU8Mmx2pp9AyQNrB//ENPMpE+Ve5VvKU0+5kXma3m+toVxg==`
- `sha256(SPKI DER)`, soit la valeur de `public_key_fp` = `6145231539132278683d273815557b66512d14d4fb6b093867122cc38b2b5770`
- Signature (vérifie) : `MEYCIQC/VWdsOwkNPoBmjkWg/yJWksa7HvMYqrJbp19TJefv4gIhALhNJMRDnHhOwotAVnDT6eLY+aR/Siq6JMZ1VCBD56OJ`

### V2 : charge groupée (`count:2`, port non standard)

```
obli-devkey-v1
purpose:stepup
origin:https://obliance.example.com:8443
user:42
key:6f1c2d4e-8a8b-4c1e-9d2f-0a1b2c3d4e5f
count:2
challenge:0f8fad5b-d9cb-469f-a165-70867728950e
nonce:q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s
action:command.reboot
binding:42e94dc1a0b1fca10ff77a22a2c4ec22ae1fb558ffcd31f9971da0c3b8c6b5f4
exp:1790000200
challenge:7c9e6679-7425-40de-944b-e07fc1f90ae7
nonce:zc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0
action:command.reboot
binding:d1cfff2ae8c88d7fadb9f02e95153f8c71d8d29d9cf4b86ec41247da70908405
exp:1790000201
```

- Nonces : 32 × 0xab et 32 × 0xcd.
- `sha256(charge)` = `eeb4ef7a7d8eb846fbb7aa67afe62d280c71810f5cfd54106395f16f878b7cfb`
- SPKI : `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEC8l1DDFcl+02mbjMgVVJGGAfDvqE7NZdjWWbj0n1v9A29R/hz0CAPWnt9UNheUOo+m3Cm62qxTOPALLXVW0npg==`
- Signature (vérifie) : `MEUCIBUBAT1EvUVDSgblSbU7jfUCDVzhzoxgvJ+CRpp+l4rRAiEAlgDjiTKua6d6K55etd0ygmMnyC8jP4xwLZQgklo2vPU=`

### B : liaison (`obli-binding-v1`, tenant compris)

| # | Méthode, URL | Tenant | actionKey | deviceIds | Corps (sans preuves) | `canonicalJson` | binding |
|---|---|---|---|---|---|---|---|
| B1 | `POST /api/commands` | 3 | `command.reboot` | `[17]` | `{type:'reboot',deviceId:17,payload:{}}` | `{"deviceId":17,"payload":{},"type":"reboot"}` (sha256 `44e33a15fba0119817d28f38ebe2298e35502cc22b3df40e60ce28b8442d9961`) | `42e94dc1a0b1fca10ff77a22a2c4ec22ae1fb558ffcd31f9971da0c3b8c6b5f4` |
| B2 | idem | **1** | idem | idem | idem | idem | `610b2c89a74f638b09d601b11db5d640891ba32706e729afdd522c04f6ccca76` |
| B3 | `PUT /api/restrictions` | 5 | `tenant.manage_restrictions` | `[]` | `{restrictions:{'command.reboot':'sensitive'}}` | `{"restrictions":{"command.reboot":"sensitive"}}` | `ee111027a7086d5dfa8015c7b969f8eef9d930805dc7fd97f138f627d19191c3` |
| B4 | idem | **6** | idem | idem | idem | idem | `fcf03fbb22552c631c8e5f08e331fb4e0d4ed624f5c2c0f7c63a183ff068c1d6` |
| B5 | `POST /api/profile/ssh-keys` | aucun (`-`) | `profile.ssh_key_add` | `[]` | `{name:'laptop',publicKey:'ssh-ed25519 AAAA'}` | `{"name":"laptop","publicKey":"ssh-ed25519 AAAA"}` | `ddb388ab3ada04a39c9039f30b7872e68f643df8a699e5e7c166c53b264437e1` |
| B6 | `POST /api/scripts/5/execute?dryRun=0` | 3 | `script.execute_manual` | `[18,17,18]` → `17,18` | `{deviceIds:[18,17,18],scriptId:5,params:{b:2,a:1}}` | `{"deviceIds":[18,17,18],"params":{"a":1,"b":2},"scriptId":5}` | `a81a5da7782c7e87d8f6a090c1256c53cb669606422d690678ecfdef13227316` |

B2 et B4 montrent qu'un changement de tenant change la liaison (R5). Préimage complète de B6 (JSON) :

```
"obli-binding-v1\nPOST\n/api/scripts/5/execute?dryRun=0\n3\nscript.execute_manual\n17,18\nc20b4115dc10964e0f3d8e7456acfadb0dcfe5e7f09895a84e069d3cc1abf215"
```

### J : corps enregistrés (tests `ApiResponses` et e2e)

- **J1.** 401, session liée, défi :
  `{"error":"twoFactorCode required","twoFactorRequired":true,"action":"command.reboot","currentIp":"92.184.107.21","trustIpAllowed":false,"codeRequiresPassword":true,"deviceKeyStatus":"active","deviceChallenge":{"v":1,"keyId":"6f1c2d4e-8a8b-4c1e-9d2f-0a1b2c3d4e5f","challengeId":"1b4e28ba-2fa1-41d2-883f-0016d3cca427","purpose":"stepup","userId":42,"tenantId":3,"tenantName":"ACME","nonce":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","action":"command.reboot","binding":"42e94dc1a0b1fca10ff77a22a2c4ec22ae1fb558ffcd31f9971da0c3b8c6b5f4","expiresAt":1790000120,"bulkId":null}}`
- **J2.** 401, défi expiré :
  `{"error":"twoFactorCode required","twoFactorRequired":true,"action":"command.reboot","deviceKeyStatus":"active","deviceError":"challenge_expired","deviceChallenge":{…}}`
- **J3.** 401, assertion invalide : `{"error":"twoFactorCode required","twoFactorRequired":true,"action":"command.reboot","deviceKeyStatus":"active","deviceError":"invalid_assertion","codeRequiresPassword":true,"trustIpAllowed":false}`
- **J4.** 401, clé révoquée : `{"success":false,"error":"Authentication required","deviceKeyStatus":"revoked"}`
- **J5.** 401, politique coupée : `{"error":"twoFactorCode required","twoFactorRequired":true,"action":"command.reboot","currentIp":"…","trustIpAllowed":true,"deviceKeyStatus":"disabled"}`
- **J6.** 429, code bloqué : `{"error":"Too many verification attempts","codeLocked":true}`
- **J7.** Connexion : `{"success":true,"data":{"requires2fa":true,"methods":{"totp":true,"email":false,"device":true},"deviceChallenge":{"v":1,"keyId":"…","challengeId":"…","purpose":"login","userId":42,"tenantId":null,"nonce":"…","action":"-","binding":"-","expiresAt":1790000120,"bulkId":null}}}`
- **J8.** Ancien serveur (inchangé) : `{"error":"twoFactorCode required","twoFactorRequired":true,"action":"command.reboot","currentIp":"…"}`

---

## Annexe B : textes UI (FR ; clés `deviceKeys.*` côté web, `strings.xml` côté app)

Vouvoiement ou tournure neutre, jamais de tutoiement.

| Clé | Texte |
|---|---|
| `deviceKeys.title` | Validation par empreinte |
| `deviceKeys.intro` | Validez les actions protégées avec votre empreinte au lieu de saisir un code. La clé reste dans la puce de sécurité de ce téléphone et ne sert qu'à ce compte sur ce serveur. |
| `deviceKeys.warnOthers` | Toute empreinte ou tout visage enregistré sur ce téléphone pourra valider. Retirez ceux des autres personnes avant d'activer. |
| `deviceKeys.warnNewBiometric` | Si une empreinte ou un visage est ajouté plus tard, la validation sera désactivée et vous devrez vous reconnecter. |
| `deviceKeys.enrolAsk` | Pour activer, saisissez votre mot de passe et un nouveau code de votre application d'authentification. |
| `deviceKeys.enrolAskSso` | Pour activer, reconfirmez votre identité auprès d'Obligate. |
| `deviceKeys.enrolled` | Validation par empreinte activée sur ce téléphone ({{level}}). |
| `deviceKeys.level.strongbox` | Puce de sécurité (StrongBox) |
| `deviceKeys.level.tee` | Environnement sécurisé |
| `deviceKeys.level.unverified` | Non vérifié |
| `deviceKeys.disabledByAdmin` | Désactivée par l'administrateur de ce serveur. |
| `deviceKeys.originUnset` | Le serveur n'a pas d'adresse publique configurée (APP_URL). Demandez à l'administrateur. |
| `deviceKeys.ssoUnsupported` | Pas encore disponible pour les comptes Obligate. |
| `deviceKeys.noStrongBiometric` | Ce téléphone n'a pas de biométrie forte configurée. |
| `deviceKeys.notAvailable` | Ce serveur ne prend pas encore en charge la validation par empreinte. Mettez-le à jour. |
| `deviceKeys.invalidated` | Une nouvelle empreinte ou un nouveau visage a été ajouté : la validation par empreinte a été désactivée. Reconnectez-vous puis réactivez-la. |
| `deviceKeys.attestationFailed` | Ce téléphone n'a pas pu prouver que la clé est protégée par le matériel ({{reason}}). |
| `deviceKeys.tooMany` | Vous avez déjà 5 téléphones enregistrés. Révoquez-en un depuis votre profil. |
| `deviceKeys.enrolLocked` | Trop d'essais. L'activation est bloquée pendant 24 heures. |
| `deviceKeys.prompt.description` | Double authentification, pour cette action uniquement |
| `deviceKeys.prompt.bulk` | {{action}} sur {{count}} appareils |
| `deviceKeys.prompt.login` | Connexion à {{server}} |
| `deviceKeys.prompt.useCode` | Utiliser un code |
| `deviceKeys.secondStep` | Deuxième validation : double authentification |
| `deviceKeys.tenantChanged` | Le tenant a changé pendant la validation. Relancez l'action. |
| `deviceKeys.codeNeedsPassword` | Sur ce téléphone, la validation se fait par empreinte. Pour utiliser un code à la place, saisissez aussi votre mot de passe. |
| `deviceKeys.codeLocked` | Trop de codes incorrects. Reconnectez-vous pour débloquer la saisie de code. |
| `deviceKeys.list.title` | Téléphones de validation |
| `deviceKeys.list.addHint` | L'ajout se fait depuis l'application Android, dans Profil et sécurité. |
| `deviceKeys.list.thisSession` | Cette session |
| `deviceKeys.list.revoke` / `revokeAll` | Révoquer / Tout révoquer |
| `deviceKeys.list.revokeConfirm` | Révoquer {{label}} ? Ce téléphone sera déconnecté immédiatement. |
| `deviceKeys.settings.title` | Validation par téléphone |
| `deviceKeys.settings.origin` | Origine autorisée : {{origin}} |
| `deviceKeys.settings.originMissing` | Non configurée : l'enrôlement est refusé. Renseignez APP_URL ou DEVICE_KEY_ORIGINS. |

---

## Annexe C : lot O (Obligate, `D:\Obligate`) pour les comptes SSO

À réaliser dans le dépôt Obligate, en suivant son `CLAUDE.md`. Obliance n'active le SSO que lorsque `capabilities` annonce les trois drapeaux.

| # | Changement Obligate | Pourquoi |
|---|---|---|
| O1 | **Anti-rejeu TOTP.** Colonne `totp_last_step` par utilisateur, mise à jour par **toutes** les vérifications TOTP d'Obligate (connexion, step-up des apps). `POST /api/oauth/verify-totp` (`server/src/routes/oauth.routes.ts`, route vers l.113-218) accepte `{userId, code, consume?: boolean}` et renvoie `{valid, step, mfaEpoch}`. Avec `consume:true`, il exige `step > totp_last_step`. | Un code vu à la connexion Obligate ne peut plus servir ailleurs (R3). |
| O2 | **Époque MFA.** Entier `mfa_epoch` par utilisateur, incrémenté à chaque réinitialisation, remplacement ou désactivation du TOTP, changement ou réinitialisation du mot de passe, désactivation et réinitialisation MFA par un administrateur. `GET /api/oauth/users/:id/mfa-epoch` (Bearer clé d'app) renvoie `{mfaEpoch}`. | Obliance vérifie à l'usage que rien n'a changé depuis l'enrôlement (R1). |
| O3 | **Synchronisation poussée.** Nouvelle action `credentials-changed {remoteUserId, mfaEpoch}` dans l'appel `sso-user-sync` vers chaque app liée, avec une **file persistée et des reprises** (backoff exponentiel pendant 24 h, puis alerte admin). | Révocation immédiate, sans attendre le cache de 5 min. |
| O4 | **Réauthentification.** `authorize` accepte `prompt=login` et `max_age=0` : Obligate impose mot de passe + TOTP, même avec une session Obligate valide. L'assertion d'échange porte `authTime` (secondes unix) et `amr` (`['pwd','otp']`). | Équivalent SSO de « mot de passe + nouveau code » pour l'enrôlement et le secours en session liée. |
| O5 | **Capacités.** `GET /api/oauth/capabilities` renvoie `{stepUpEpoch:1, reauth:1, totpReplayGuard:1}`. | Activation automatique et en échec fermé côté Obliance (§4.10). |

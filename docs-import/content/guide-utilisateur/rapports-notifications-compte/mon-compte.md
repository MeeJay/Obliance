La page **Profile** regroupe tous les reglages lies a votre compte personnel : identite, mot de passe, apparence, securite et preferences d'utilisation.

## Acces a mon profil

La page **Profile** est accessible a tout utilisateur connecte, quel que soit son role. C'est l'endroit unique ou gerer vos informations personnelles et vos preferences.

> Si votre compte est gere via une connexion unique externe (SSO Obligate), la page Profile est remplacee par un message **"Profile managed by Obligate"** avec un lien vers la page de compte Obligate. Dans ce cas, le mot de passe et certains reglages ne sont pas modifiables depuis Obliance : ils se gerent directement sur Obligate.

## Informations de profil

Dans la section **Profile** :

- **Username** : votre identifiant de connexion (lecture seule, non modifiable).
- **Display name** : le nom affiche dans l'interface, modifiable.
- **Email** : votre adresse email de contact.
- **Preferred language** : la langue d'affichage de l'interface, a choisir dans la liste des langues disponibles.

## Photo de profil

Vous pouvez ajouter une image d'avatar depuis la section dediee en haut de la page :

1. Cliquez sur la zone d'upload et selectionnez une image.
2. L'image doit rester d'une taille raisonnable (environ 366 Ko maximum) ; un fichier trop lourd sera refuse.
3. Une option dediee permet de retirer votre photo actuelle a tout moment.

## Changer de mot de passe

Dans la section **Password** (masquee si votre compte est gere par Obligate) :

1. Saisissez votre **Current password**.
2. Saisissez le **New password** (6 caracteres minimum).
3. Confirmez-le dans **Confirm password**.
4. Validez pour appliquer le changement.

## Apparence

Dans la section **Appearance**, choisissez le theme visuel de l'interface parmi quatre options :

| Theme | Description |
|---|---|
| Obli Operator | Theme sombre, applique par defaut |
| Obli Daylight | Variante claire du theme Operator |
| Modern UI | Theme moderne alternatif |
| Neon UI | Theme aux tons contrastes et neon |

Le theme choisi s'applique immediatement a titre d'apercu et reste actif a vos prochaines connexions.

## Bureau a distance : codec video

Si vous utilisez les sessions de prise en main a distance (ObliReach), la section **Remote Desktop** vous permet de choisir le codec video preferentiel utilise pour la retransmission de l'ecran :

- **H.264 (OpenH264)** — choix par defaut, le plus compatible.
- **H.265 (HEVC)** — meilleure compression.
- **VP9** — bonne compression.
- **AV1** — compression maximale, plus exigeant en ressources processeur.
- **JPEG** — solution de repli en cas de faible qualite de connexion.

Si l'appareil distant ne prend pas en charge le codec choisi, la connexion bascule automatiquement sur JPEG.

## Reponses rapides personnelles

La section **Quick Replies** vous permet de preparer jusqu'a 50 messages types, reutilisables rapidement dans le chat de support ou d'assistance a distance :

1. Saisissez le texte du message.
2. Enregistrez-le pour l'ajouter a votre liste de reponses rapides.

Ces reponses rapides sont personnelles et s'ajoutent aux modeles communs eventuellement mis a disposition par votre organisation.

## Securite et double authentification (2FA)

Lorsque la double authentification est proposee sur votre compte, la section **Security** apparait avec deux methodes independantes, activables separement :

- **TOTP** : via une application d'authentification (scan d'un QR code puis saisie d'un code a 6 chiffres pour activer).
- **Email OTP** : un code a 6 chiffres est envoye a une adresse email que vous renseignez, a saisir pour activer.

Chaque methode peut etre activee ou desactivee independamment de l'autre depuis cette section.

> Si votre administrateur a impose la mise en place de la 2FA sur votre compte, un bandeau d'avertissement s'affiche en haut de la section tant que vous ne l'avez pas configuree.

## Adresses IP de confiance

La section **Trusted IPs (2FA)** liste les adresses depuis lesquelles vous avez choisi de faire confiance a votre navigateur pendant 24 heures (option cochee lors d'une demande de code de securite pour une action sensible). Pour chaque entree, vous pouvez :

- Consulter le temps restant avant expiration (par exemple "3h 12m").
- Retirer la confiance a une adresse precise.
- Tout revoquer d'un coup (une confirmation vous sera demandee).
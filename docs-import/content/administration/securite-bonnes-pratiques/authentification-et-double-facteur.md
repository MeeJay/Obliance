Ce guide explique comment configurer l'authentification des utilisateurs sur Obliance : mot de passe, double facteur (2FA) et connexion via une passerelle SSO Obligate.

## Mot de passe

Obliance impose une longueur minimale de mot de passe cote serveur : **6 caracteres minimum**, avec un maximum de 128 a 255 caracteres selon l'ecran (creation d'utilisateur ou changement de mot de passe depuis le profil). Il n'existe pas de regle de complexite imposee (majuscule, chiffre, caractere special) au-dela de cette longueur minimale : il est recommande de sensibiliser vos utilisateurs a choisir des mots de passe longs et uniques, ou de coupler Obliance a votre gestionnaire de mots de passe habituel.

## Activer le double facteur (2FA)

La configuration du 2FA se fait dans **Parametres > section Securite**. Deux reglages independants sont disponibles :

| Reglage | Effet |
|---|---|
| Autoriser le 2FA (`allow_2fa`) | Permet a chaque utilisateur d'activer le 2FA sur son propre compte, depuis sa page de profil. |
| Forcer le 2FA (`force_2fa`) | Rend le 2FA obligatoire pour **tous** les utilisateurs de l'installation. |

Tant que "Forcer le 2FA" n'est pas active, le 2FA reste une option laissee au choix de chaque utilisateur.

### Deux methodes de verification

Obliance propose deux methodes de second facteur, activables independamment par chaque utilisateur depuis la section securite de son profil :

1. **TOTP (application d'authentification)** : generation d'un QR code a scanner avec une application type Google Authenticator, Microsoft Authenticator ou equivalent. Le code a usage unique change toutes les 30 secondes, avec une tolerance d'environ 60 secondes pour absorber les decalages d'horloge entre l'appareil et le serveur.
2. **OTP par email** : un code a 6 chiffres est envoye par email, valable 10 minutes. Cette methode necessite qu'un serveur SMTP soit configure sur l'installation. Sans SMTP configure, seule la methode TOTP peut fonctionner.

### Configurer le 2FA cote utilisateur

1. Se rendre dans la section securite de son profil.
2. Choisir la methode (TOTP ou OTP email) et suivre l'assistant d'activation.
3. Pour le TOTP : scanner le QR code affiche avec l'application d'authentification, puis saisir le code genere pour confirmer l'activation.
4. Le 2FA peut ensuite etre desactive depuis le meme ecran si "Forcer le 2FA" n'est pas actif pour l'installation.

## Faire confiance a une adresse IP ("Trust this IP")

Pour eviter de redemander un code 2FA a chaque action sensible depuis un meme poste, Obliance propose un mecanisme de confiance par adresse IP :

- Apres une verification TOTP reussie, l'utilisateur peut choisir de faire confiance a l'IP en cours, pour une duree definie par un reglage administrateur (une valeur a 0 desactive completement cette fonctionnalite pour toute l'installation).
- Tant que l'IP reste en confiance, les actions sensibles suivantes ne redemandent pas de code 2FA.
- Depuis la section securite de son profil, l'utilisateur voit la liste des IPs actuellement en confiance et peut revoquer une IP individuelle, ou toutes les IPs d'un coup.

Cette revocation est utile si un poste a ete partage ou compromis : elle force une nouvelle verification 2FA a la prochaine action sensible depuis cette IP.

## Connexion via SSO (Obligate)

Obliance peut deleguer l'authentification a une passerelle **Obligate**, configurable dans **Parametres**, section dediee a la passerelle SSO Obligate :

1. Renseigner l'**URL de la passerelle** Obligate.
2. Renseigner la **cle API** associee.
3. Enregistrer : activer le SSO desactive l'authentification locale par mot de passe pour les utilisateurs concernes.

Les comptes provisionnes automatiquement via Obligate sont prefixes `og_` (par exemple `og_john.doe`), ce qui permet de les distinguer des comptes locaux dans les listes d'utilisateurs.

**Fallback automatique** : si la passerelle Obligate devient injoignable (panne reseau, service arrete, etc.), Obliance bascule automatiquement sur l'authentification locale pour ne pas bloquer completement l'acces a l'installation. Il est recommande de conserver au moins un compte administrateur local fonctionnel meme lorsque le SSO est actif, afin de pouvoir toujours se connecter en cas de probleme sur la passerelle.
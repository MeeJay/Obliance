Trois sections de la page ParamÃ¨tres concernent l'envoi d'e-mail et l'authentification des utilisateurs : les serveurs SMTP, le double facteur d'authentification, et la passerelle SSO Obligate.

## Serveurs SMTP

Cette section permet de dÃ©clarer un ou plusieurs serveurs d'envoi d'e-mail, utilisÃ©s pour les notifications et pour l'envoi des codes 2FA par e-mail.

### Ajouter un serveur

1. Cliquer sur **Ajouter un serveur**.
2. Renseigner les champs :

| Champ | Description |
|---|---|
| Nom | Nom libre pour identifier le serveur dans les listes dÃ©roulantes |
| HÃ´te | Adresse du serveur SMTP |
| Port | Port de connexion (25, 587, 465...) |
| Utiliser TLS (port 465) | Case Ã  cocher pour forcer une connexion chiffrÃ©e sur le port 465 |
| Identifiant | Compte d'authentification SMTP |
| Mot de passe | Mot de passe du compte SMTP |
| Adresse d'expÃ©dition | Adresse Â« From Â» utilisÃ©e sur les e-mails envoyÃ©s |

3. Cliquer sur **Tester la connexion** avant d'enregistrer, pour vÃ©rifier que le serveur rÃ©pond correctement.

Un serveur dÃ©jÃ  enregistrÃ© peut ensuite Ãªtre modifiÃ© ou supprimÃ© depuis la liste des serveurs SMTP configurÃ©s.

### Ã€ propos du test de connexion

Si le test Ã©choue, l'interface n'affiche **volontairement pas** le message d'erreur brut renvoyÃ© par le serveur de messagerie : ce message peut contenir des informations sensibles, y compris potentiellement le mot de passe saisi. Ã€ la place, un message gÃ©nÃ©rique accompagnÃ© d'un code d'erreur s'affiche. Pour un diagnostic plus poussÃ© (mauvais port, TLS refusÃ©, identifiants invalides...), il faut consulter les logs serveur ou tester la connexion SMTP indÃ©pendamment (client mail, outil en ligne de commande).

### PortÃ©e

Ã€ la diffÃ©rence de la sÃ©curitÃ© 2FA et du SSO Obligate dÃ©crits plus bas, les serveurs SMTP sont **propres Ã  chaque tenant** : un serveur crÃ©Ã© sur un tenant n'est pas visible ni utilisable depuis un autre tenant.

## SÃ©curitÃ© â€” double authentification (2FA)

Cette section contrÃ´le la politique 2FA pour l'ensemble des utilisateurs de l'installation :

- **Autoriser les utilisateurs Ã  configurer le 2FA** â€” bascule qui rend l'option 2FA disponible dans les profils utilisateurs.
- **Forcer le 2FA pour tous les utilisateurs** â€” bascule qui rend le 2FA obligatoire. Elle reste grisÃ©e et inactive tant que Â« Autoriser... Â» n'est pas activÃ© au prÃ©alable.
- **Serveur SMTP pour l'OTP par e-mail** â€” liste dÃ©roulante pour choisir, parmi les serveurs SMTP configurÃ©s (ou Â« â€” Aucun â€” Â»), celui qui enverra les codes Ã  usage unique par e-mail aux utilisateurs n'ayant pas d'application d'authentification.

**Point Ã  connaÃ®tre** : un mÃ©canisme de secours rÃ©servÃ© Ã  la configuration technique du serveur (en dehors de cette interface) permet, dans des situations exceptionnelles (par exemple un compte admin bloquÃ©), de lever temporairement l'obligation du 2FA. Ce type d'Ã©chappatoire doit Ãªtre maniÃ© avec la plus grande prudence, rÃ©servÃ© aux administrateurs systÃ¨me de l'installation, documentÃ© en interne, et dÃ©sactivÃ© aussitÃ´t l'incident rÃ©solu.

### PortÃ©e

Contrairement aux serveurs SMTP, les rÃ©glages 2FA (Autoriser / Forcer) sont **partagÃ©s par toute l'installation**, tous tenants confondus â€” ils ne peuvent pas Ãªtre diffÃ©renciÃ©s par tenant.

## Obligate SSO Gateway

Cette section connecte Obliance Ã  **Obligate**, la passerelle d'authentification unique (SSO) de l'Ã©diteur.

### Champs

| Champ | Description |
|---|---|
| Obligate URL | Adresse de la passerelle Obligate (doit commencer par `https://`) |
| API Key | ClÃ© d'API fournie par Obligate. MasquÃ©e une fois enregistrÃ©e (badge Â« SET Â»), avec un bouton pour l'afficher/la masquer temporairement |
| Enable SSO | Bascule d'activation |

### Garde-fou anti-boucle

L'URL Obligate ne peut pas Ãªtre identique Ã  l'origine de l'application Obliance elle-mÃªme : le formulaire refuse cette valeur pour Ã©viter une boucle de redirection de connexion.

### Activation

La bascule **Enable SSO** n'apparaÃ®t dans l'interface que lorsque **l'URL et la clÃ© API sont toutes les deux renseignÃ©es**. Une fois activÃ©e, elle :

- Bascule la page de connexion vers Obligate.
- Provisionne automatiquement les comptes utilisateurs lors de leur toute premiÃ¨re connexion via Obligate.
- Restaure automatiquement l'authentification locale en secours (fallback) si la passerelle Obligate devient injoignable â€” les utilisateurs ne restent donc pas bloquÃ©s en cas de panne cÃ´tÃ© Obligate.

### PortÃ©e

Comme les rÃ©glages 2FA, la configuration Obligate est **partagÃ©e par toute l'installation** et non isolÃ©e par tenant.

## Sur la validation des modifications

L'enregistrement de certains de ces rÃ©glages (2FA, Obligate...) peut Ãªtre soumis Ã  une politique de restriction d'actions configurÃ©e par ailleurs : selon la configuration active, l'Ã©criture peut Ãªtre purement et simplement bloquÃ©e, exiger la saisie d'un code de validation Ã  usage unique fraÃ®chement gÃ©nÃ©rÃ©, ou Ãªtre redirigÃ©e vers une demande d'approbation avant de prendre effet. Si vous constatez qu'un enregistrement de rÃ©glage ne passe pas ou dÃ©clenche une demande inattendue, consultez le chapitre dÃ©diÃ© aux restrictions d'actions / sÃ©curitÃ© pour comprendre la politique en vigueur sur votre installation.
Ces sections, toutes rÃ©servÃ©es aux administrateurs, contrÃ´lent l'authentification des utilisateurs et l'envoi d'e-mails depuis Obliance.

## Section Â« SMTP Servers Â»

Avant de pouvoir envoyer des codes de double authentification par e-mail, il faut dÃ©clarer au moins un serveur SMTP.

- Table listant les serveurs configurÃ©s avec les colonnes **Nom**, **Host**, **From**.
- Actions disponibles par ligne : **Tester la connexion** (icÃ´ne Wifi), **Ã‰diter**, **Supprimer**.
- Un formulaire de crÃ©ation/Ã©dition demande : nom, host, port, activation TLS, nom d'utilisateur, mot de passe, adresse d'expÃ©dition (from).
- Il est possible de dÃ©clarer plusieurs serveurs SMTP (par exemple un serveur principal et un serveur de secours), chacun pouvant ensuite Ãªtre sÃ©lectionnÃ© indÃ©pendamment comme Ã©metteur des codes OTP dans la section Security.

Toujours utiliser le bouton **Tester la connexion** aprÃ¨s une crÃ©ation ou modification, avant de s'en servir pour l'envoi des codes 2FA : une erreur de configuration SMTP bloquerait la connexion des utilisateurs si le 2FA par e-mail est actif. PrivilÃ©gier une connexion SMTP chiffrÃ©e (TLS) et un mot de passe dÃ©diÃ© et robuste pour le compte d'envoi.

## Section Â« Security Â»

Trois contrÃ´les pilotent la politique de double authentification (2FA) de l'installation :

| ContrÃ´le | Effet |
|---|---|
| **Allow 2FA** | Autorise les utilisateurs Ã  activer eux-mÃªmes la double authentification sur leur compte |
| **Force 2FA** | Rend la double authentification obligatoire pour tous les comptes. Ce toggle est automatiquement dÃ©sactivÃ© (grisÃ©) si Â« Allow 2FA Â» est dÃ©cochÃ© â€” il faut d'abord autoriser le 2FA avant de pouvoir le forcer |
| **OTP via SMTP** | Liste dÃ©roulante pour choisir quel serveur SMTP (parmi ceux configurÃ©s dans Â« SMTP Servers Â») sert Ã  envoyer les codes OTP par e-mail. Option Â« None Â» disponible pour dÃ©sactiver l'envoi par e-mail |

> **ProcÃ©dure de dÃ©blocage d'urgence** : l'interface mentionne l'existence d'un mÃ©canisme de contournement exceptionnel du 2FA forcÃ©, rÃ©servÃ© aux situations de blocage total (par exemple un compte administrateur unique verrouillÃ© hors de son second facteur) et nÃ©cessitant un accÃ¨s direct Ã  l'hÃ©bergement du serveur â€” pas seulement Ã  l'interface web. Pour des raisons de sÃ©curitÃ©, la procÃ©dure prÃ©cise n'est volontairement pas dÃ©taillÃ©e dans cette documentation : se rÃ©fÃ©rer Ã  la documentation technique interne ou contacter le support Obliance, et veiller Ã  dÃ©sactiver ce contournement dÃ¨s l'incident rÃ©solu.

Activer la double authentification (au minimum en option, idÃ©alement en obligatoire pour les comptes admin) est recommandÃ© sur toute installation exposÃ©e sur Internet.

## Section Â« Obligate SSO Gateway Â»

Permet de dÃ©lÃ©guer l'authentification des utilisateurs Ã  Obligate, la passerelle SSO tierce d'Obliance.

1. Renseigner l'**URL du gateway Obligate**. L'interface vÃ©rifie que cette URL ne pointe pas vers l'application Obliance elle-mÃªme (protection contre une mauvaise configuration).
2. Renseigner une **API Key**, gÃ©nÃ©rÃ©e cÃ´tÃ© Obligate dans *Connected Apps â†’ Add App*. Le champ est masquÃ© Ã  l'affichage ; un badge **SET** indique qu'une clÃ© est dÃ©jÃ  enregistrÃ©e sans la rÃ©vÃ©ler.
3. Une fois l'URL et la clÃ© API renseignÃ©es, le toggle **Enable SSO** devient disponible.

Quand **Enable SSO** est activÃ© :

- La page de connexion redirige automatiquement vers Obligate.
- Les comptes utilisateurs sont provisionnÃ©s automatiquement au premier login via Obligate.
- Des boutons de navigation croisÃ©e entre Obliance et Obligate apparaissent dans l'en-tÃªte de l'application.
- L'authentification locale (identifiant/mot de passe direct dans Obliance) est dÃ©sactivÃ©e.

> **Filet de sÃ©curitÃ© intÃ©grÃ©** : si le gateway Obligate devient injoignable, Obliance restaure automatiquement l'authentification locale en secours, afin de ne jamais bloquer complÃ¨tement l'accÃ¨s Ã  l'installation.

Penser Ã  faire tourner (rÃ©gÃ©nÃ©rer) l'API Key cÃ´tÃ© Obligate en cas de doute sur sa confidentialitÃ©, et Ã  limiter au strict nÃ©cessaire les personnes ayant accÃ¨s Ã  la section Obligate SSO Gateway (principe du moindre privilÃ¨ge).

Pour la configuration dÃ©taillÃ©e cÃ´tÃ© Obligate (crÃ©ation de l'application connectÃ©e, gestion de la clÃ© API), se rÃ©fÃ©rer Ã  la documentation dÃ©diÃ©e Ã  Obligate.
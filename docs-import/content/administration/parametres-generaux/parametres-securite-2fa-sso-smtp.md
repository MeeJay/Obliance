Ces sections, toutes réservées aux administrateurs, contrôlent l'authentification des utilisateurs et l'envoi d'e-mails depuis Obliance.

## Section « SMTP Servers »

Avant de pouvoir envoyer des codes de double authentification par e-mail, il faut déclarer au moins un serveur SMTP.

- Table listant les serveurs configurés avec les colonnes **Nom**, **Host**, **From**.
- Actions disponibles par ligne : **Tester la connexion** (icône Wifi), **Éditer**, **Supprimer**.
- Un formulaire de création/édition demande : nom, host, port, activation TLS, nom d'utilisateur, mot de passe, adresse d'expédition (from).
- Il est possible de déclarer plusieurs serveurs SMTP (par exemple un serveur principal et un serveur de secours), chacun pouvant ensuite être sélectionné indépendamment comme émetteur des codes OTP dans la section Security.

Toujours utiliser le bouton **Tester la connexion** après une création ou modification, avant de s'en servir pour l'envoi des codes 2FA : une erreur de configuration SMTP bloquerait la connexion des utilisateurs si le 2FA par e-mail est actif. Privilégier une connexion SMTP chiffrée (TLS) et un mot de passe dédié et robuste pour le compte d'envoi.

## Section « Security »

Trois contrôles pilotent la politique de double authentification (2FA) de l'installation :

| Contrôle | Effet |
|---|---|
| **Allow 2FA** | Autorise les utilisateurs à activer eux-mêmes la double authentification sur leur compte |
| **Force 2FA** | Rend la double authentification obligatoire pour tous les comptes. Ce toggle est automatiquement désactivé (grisé) si « Allow 2FA » est décoché — il faut d'abord autoriser le 2FA avant de pouvoir le forcer |
| **OTP via SMTP** | Liste déroulante pour choisir quel serveur SMTP (parmi ceux configurés dans « SMTP Servers ») sert à envoyer les codes OTP par e-mail. Option « None » disponible pour désactiver l'envoi par e-mail |

> **Procédure de déblocage d'urgence** : l'interface mentionne l'existence d'un mécanisme de contournement exceptionnel du 2FA forcé, réservé aux situations de blocage total (par exemple un compte administrateur unique verrouillé hors de son second facteur) et nécessitant un accès direct à l'hébergement du serveur — pas seulement à l'interface web. Pour des raisons de sécurité, la procédure précise n'est volontairement pas détaillée dans cette documentation : se référer à la documentation technique interne ou contacter le support Obliance, et veiller à désactiver ce contournement dès l'incident résolu.

Activer la double authentification (au minimum en option, idéalement en obligatoire pour les comptes admin) est recommandé sur toute installation exposée sur Internet.

## Section « Obligate SSO Gateway »

Permet de déléguer l'authentification des utilisateurs à Obligate, la passerelle SSO tierce d'Obliance.

1. Renseigner l'**URL du gateway Obligate**. L'interface vérifie que cette URL ne pointe pas vers l'application Obliance elle-même (protection contre une mauvaise configuration).
2. Renseigner une **API Key**, générée côté Obligate dans *Connected Apps → Add App*. Le champ est masqué à l'affichage ; un badge **SET** indique qu'une clé est déjà enregistrée sans la révéler.
3. Une fois l'URL et la clé API renseignées, le toggle **Enable SSO** devient disponible.

Quand **Enable SSO** est activé :

- La page de connexion redirige automatiquement vers Obligate.
- Les comptes utilisateurs sont provisionnés automatiquement au premier login via Obligate.
- Des boutons de navigation croisée entre Obliance et Obligate apparaissent dans l'en-tête de l'application.
- L'authentification locale (identifiant/mot de passe direct dans Obliance) est désactivée.

> **Filet de sécurité intégré** : si le gateway Obligate devient injoignable, Obliance restaure automatiquement l'authentification locale en secours, afin de ne jamais bloquer complètement l'accès à l'installation.

Penser à faire tourner (régénérer) l'API Key côté Obligate en cas de doute sur sa confidentialité, et à limiter au strict nécessaire les personnes ayant accès à la section Obligate SSO Gateway (principe du moindre privilège).

Pour la configuration détaillée côté Obligate (création de l'application connectée, gestion de la clé API), se référer à la documentation dédiée à Obligate.
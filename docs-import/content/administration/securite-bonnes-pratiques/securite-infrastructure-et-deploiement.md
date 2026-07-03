# SÃ©curitÃ© de l'infrastructure et bonnes pratiques de dÃ©ploiement

Cette page couvre la traÃ§abilitÃ© des actions, le durcissement rÃ©seau/HTTP intÃ©grÃ© Ã  Obliance, et les points de configuration Ã  sÃ©curiser avant une mise en production.

## Journal d'audit

Le journal d'audit enregistre les actions des utilisateurs, tenant par tenant, et n'est consultable que par les administrateurs, sur la page **Security** (`/admin/security`), onglet **Audit log**.

Purger le journal d'audit est lui-mÃªme une action sensible, auditÃ©e et soumise par dÃ©faut au niveau **Restricted** de la matrice de restrictions : elle nÃ©cessite donc l'approbation d'un second administrateur. AprÃ¨s une purge, une entrÃ©e permanente `audit.cleared` est systÃ©matiquement conservÃ©e, indiquant qui a effectuÃ© la purge et combien d'entrÃ©es ont Ã©tÃ© supprimÃ©es â€” l'acte de purger le journal ne peut donc jamais passer inaperÃ§u.

## En-tÃªtes de sÃ©curitÃ© HTTP

Le serveur applique automatiquement un ensemble d'en-tÃªtes de sÃ©curitÃ© HTTP Ã  toutes les rÃ©ponses :

- **Content-Security-Policy** : restreint par dÃ©faut le chargement de scripts, styles, images, connexions et polices Ã  l'origine de l'application elle-mÃªme (`'self'`), avec seulement les exceptions documentÃ©es nÃ©cessaires (styles inline pour Tailwind, connexions WebSocket pour Socket.io).
- **Strict-Transport-Security (HSTS)** : durÃ©e d'un an, appliquÃ©e aussi aux sous-domaines.
- **Referrer-Policy** : `strict-origin-when-cross-origin`.
- **X-Permitted-Cross-Domain-Policies** : `none`.

Un point Ã  connaÃ®tre : la protection anti-cadrage (`frameguard` / `X-Frame-Options`) est **volontairement dÃ©sactivÃ©e** et l'en-tÃªte `frame-ancestors` n'est pas dÃ©fini. Ce choix est dÃ©libÃ©rÃ© : il permet Ã  Obliance d'Ãªtre intÃ©grÃ© dans un cadre (iframe) par l'application compagnon **ObliTools**. Si votre installation n'utilise pas ObliTools et que vous souhaitez interdire tout affichage d'Obliance en iframe, ce contrÃ´le doit Ãªtre ajoutÃ© au niveau de votre reverse proxy plutÃ´t que dans Obliance lui-mÃªme.

## TLS et reverse proxy

Obliance ne termine pas le TLS/HTTPS lui-mÃªme : le `docker-compose.yml` fourni ne configure pas de certificat. Il est prÃ©vu et recommandÃ© de placer un reverse proxy (Nginx, Nginx Proxy Manager, ou Ã©quivalent) devant la stack Obliance pour gÃ©rer le certificat TLS et servir l'application en HTTPS aux utilisateurs.

Le serveur est configurÃ© pour faire confiance Ã  exactement un niveau de proxy en amont (`trust proxy = 1`). Cela lui permet de lire correctement l'adresse IP rÃ©elle du client transmise par le reverse proxy, ce qui est indispensable au bon fonctionnement des limitations de tentatives (connexion, 2FA...) dÃ©crites dans les autres pages de ce chapitre : sans cela, toutes les requÃªtes semblent provenir de l'IP du reverse proxy et les limites par IP perdent leur sens. Veillez Ã  ce que votre reverse proxy transmette correctement l'en-tÃªte `X-Forwarded-For`, et Ã  ne pas empiler plusieurs proxies non dÃ©clarÃ©s devant Obliance.

## CORS

Le serveur n'autorise que l'origine explicitement configurÃ©e (variable `CLIENT_ORIGIN`) Ã  effectuer des requÃªtes avec envoi des cookies de session (`credentials`). Toute requÃªte cross-origin provenant d'un autre domaine que celui dÃ©clarÃ© est rejetÃ©e par dÃ©faut.

## Variables d'environnement Ã  changer avant la mise en production

Le fichier `docker-compose.yml` fourni contient des valeurs d'exemple pour plusieurs variables sensibles. Aucune d'entre elles ne doit rester Ã  sa valeur d'exemple sur une installation de production :

| Variable | RÃ´le | Ã€ faire |
|---|---|---|
| `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` | CrÃ©e le compte administrateur intÃ©grÃ© lors du tout premier dÃ©marrage. | DÃ©finir un nom d'utilisateur et un mot de passe forts avant le premier dÃ©marrage, puis changer le mot de passe depuis l'interface aprÃ¨s la premiÃ¨re connexion. Si la valeur d'exemple est conservÃ©e, ou si le mot de passe fait moins de 12 caractÃ¨res, le serveur affiche un avertissement bien visible dans ses journaux au dÃ©marrage (sans pour autant bloquer le dÃ©marrage). |
| `SESSION_SECRET` | Signe les cookies de session. | GÃ©nÃ©rer une chaÃ®ne alÃ©atoire d'au moins 32 caractÃ¨res. En production, le serveur refuse de dÃ©marrer si cette variable est absente, laissÃ©e Ã  sa valeur d'exemple, ou trop courte. |
| `DB_PASSWORD` | Mot de passe de la base PostgreSQL. | DÃ©finir un mot de passe fort et unique, diffÃ©rent de la valeur d'exemple fournie. |
| `CLIENT_ORIGIN` | Origine autorisÃ©e pour les requÃªtes CORS. | Renseigner l'URL publique rÃ©elle de votre installation (ex. `https://obliance.monentreprise.com`), jamais une valeur gÃ©nÃ©rique. |

## ClÃ©s SSH pour les scripts et automatisations

Si vous dÃ©posez des clÃ©s SSH dans le rÃ©pertoire persistant `custom` (utilisÃ© par certains scripts et automatisations), appliquez des permissions Unix restrictives : `chmod 700` sur le rÃ©pertoire `.ssh` et `chmod 600` sur les fichiers de clÃ© privÃ©e. Des permissions trop ouvertes sur ces fichiers exposent les clÃ©s Ã  tout autre processus ou utilisateur ayant accÃ¨s au systÃ¨me de fichiers du conteneur ou de l'hÃ´te.